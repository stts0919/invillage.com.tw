#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "open3"
require "optparse"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
MANIFEST_ROOT = ROOT.join("assets/manifests")
CLASSIFICATION = ROOT.join("assets/manifests/asset-classification.json")
MIN_SSIM = 0.98
MIN_PSNR = 35.0

def run_command(*args)
  stdout, stderr, status = Open3.capture3(*args)
  [stdout, stderr, status]
end

def decode_verify(path)
  _stdout, stderr, status = run_command(
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror",
    "-i", path.to_s, "-frames:v", "1", "-f", "null", "-"
  )
  status.success? ? nil : stderr.strip
end

def metric(source, output, width, height, filter_name)
  graph = "[0:v]scale=#{width}:#{height}:flags=lanczos,setsar=1[ref];" \
          "[1:v]setsar=1[dist];[ref][dist]#{filter_name}"
  _stdout, stderr, status = run_command(
    "ffmpeg", "-hide_banner", "-loglevel", "info",
    "-i", source.to_s, "-i", output.to_s,
    "-lavfi", graph, "-frames:v", "1", "-f", "null", "-"
  )
  raise "#{filter_name} failed: #{stderr.strip}" unless status.success?

  case filter_name
  when "ssim"
    match = stderr.match(/All:([0-9.]+)/)
    raise "SSIM missing" unless match
    match[1].to_f
  when "psnr"
    match = stderr.match(/average:([0-9.]+|inf)/)
    raise "PSNR missing" unless match
    match[1] == "inf" ? Float::INFINITY : match[1].to_f
  end
end

options = { "prefix" => "sample", "manualVisualReviewRequired" => true }
OptionParser.new do |opts|
  opts.on("--prefix NAME", "verify optimization-NAME.json") { |name| options["prefix"] = name }
  opts.on("--manual-review-complete", "record that owner-approved sample policy applies") { options["manualVisualReviewRequired"] = false }
end.parse!(ARGV)
unless options["prefix"].match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/)
  warn "invalid prefix"
  exit 2
end

manifest_path = MANIFEST_ROOT.join("optimization-#{options["prefix"]}.json")
r2_manifest_path = MANIFEST_ROOT.join("r2-upload-#{options["prefix"]}.json")
output_path = if options["prefix"] == "sample"
                MANIFEST_ROOT.join("optimization-qa.json")
              else
                MANIFEST_ROOT.join("optimization-#{options["prefix"]}-qa.json")
              end

manifest = JSON.parse(manifest_path.read)
classification = JSON.parse(CLASSIFICATION.read).fetch("images")
classification_by_id = classification.each_with_object({}) { |item, map| map[item.fetch("id")] = item }
r2_manifest = JSON.parse(r2_manifest_path.read)
failures = []
metrics = []
verified_outputs = 0
lossy_outputs = 0

manifest.fetch("images").each do |image|
  id = image.fetch("id")
  source = ROOT.join(image.fetch("source").fetch("path"))
  class_row = classification_by_id.fetch(id)

  unless source.file? && Digest::SHA256.file(source).hexdigest == image.fetch("source").fetch("sha256")
    failures << "#{id}: source checksum mismatch"
    next
  end

  image.fetch("outputs").each do |output|
    path = ROOT.join(output.fetch("path"))
    unless path.file?
      failures << "#{id}: missing #{output.fetch("path")}"
      next
    end
    failures << "#{id}: output size mismatch" unless path.size == output.fetch("bytes")
    failures << "#{id}: output checksum mismatch" unless Digest::SHA256.file(path).hexdigest == output.fetch("sha256")
    error = decode_verify(path)
    failures << "#{id}: #{error}" if error

    width = output.dig("dimensions", "width").to_i
    height = output.dig("dimensions", "height").to_i
    source_width = image.dig("source", "dimensions", "width").to_i
    source_height = image.dig("source", "dimensions", "height").to_i
    failures << "#{id}: output was upscaled" if width > source_width || height > source_height

    if source_width.positive? && source_height.positive? && width.positive? && height.positive?
      source_ratio = source_width.to_f / source_height
      output_ratio = width.to_f / height
      failures << "#{id}: aspect ratio drift" if (source_ratio - output_ratio).abs > 0.01
    end

    strategy = output.fetch("strategy")
    if strategy.start_with?("avif ") || strategy.start_with?("mjpeg ")
      lossy_outputs += 1
      begin
        ssim = metric(source, path, width, height, "ssim")
        psnr = metric(source, path, width, height, "psnr")
        pass = ssim >= MIN_SSIM && psnr >= MIN_PSNR
        failures << "#{id}: quality gate failed for #{output.fetch("path")} ssim=#{ssim} psnr=#{psnr}" unless pass
        metrics << {
          "assetId" => id,
          "path" => output.fetch("path"),
          "ssim" => ssim,
          "psnr" => psnr.finite? ? psnr : "inf",
          "pass" => pass
        }
      rescue StandardError => error
        failures << "#{id}: #{error.message}"
      end
    end

    if strategy.start_with?("png lossless")
      source_frame = image.fetch("source").fetch("frameChecksum")
      failures << "#{id}: lossless frame mismatch" unless output["frameChecksum"] == source_frame
    elsif !strategy.start_with?("avif ") && !strategy.start_with?("mjpeg ")
      failures << "#{id}: unknown output strategy #{strategy.inspect}"
    end

    failures << "#{id}: placement mismatch" unless image["placement"] == class_row["placement"]
    verified_outputs += 1
  end
end

failures << "lossy metric coverage mismatch outputs=#{lossy_outputs} metrics=#{metrics.length}" unless metrics.length == lossy_outputs

r2_manifest.fetch("items").each do |item|
  path = ROOT.join(item.fetch("localPath"))
  failures << "R2 item missing #{item.fetch("localPath")}" unless path.file?
  failures << "R2 item checksum mismatch #{item.fetch("localPath")}" if path.file? && Digest::SHA256.file(path).hexdigest != item.fetch("sha256")
end

payload = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "thresholds" => { "ssim" => MIN_SSIM, "psnrDb" => MIN_PSNR },
  "summary" => {
    "selectedImages" => manifest.dig("summary", "selected"),
    "verifiedOutputs" => verified_outputs,
    "lossyMetrics" => metrics.length,
    "lossyOutputs" => lossy_outputs,
    "qualityPasses" => metrics.count { |row| row["pass"] },
    "failures" => failures.length,
    "manualVisualReviewRequired" => options["manualVisualReviewRequired"]
  },
  "metrics" => metrics,
  "failures" => failures
}

output_path.write(JSON.pretty_generate(payload) + "\n")
puts JSON.generate(payload.fetch("summary"))
warn failures.join("\n") unless failures.empty?
exit(failures.empty? ? 0 : 1)
