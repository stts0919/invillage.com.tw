#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "digest"
require "json"
require "optparse"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
MANIFEST_ROOT = ROOT.join("assets/manifests")
OPTIMIZED_ROOT = ROOT.join("assets/optimized").realpath

options = { "prefix" => nil }
OptionParser.new do |opts|
  opts.on("--prefix NAME", "prune failed metrics from optimization-NAME.json") { |name| options["prefix"] = name }
end.parse!(ARGV)

unless options["prefix"]&.match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/)
  warn "valid --prefix is required"
  exit 2
end

prefix = options.fetch("prefix")
optimization_path = MANIFEST_ROOT.join("optimization-#{prefix}.json")
qa_path = MANIFEST_ROOT.join("optimization-#{prefix}-qa.json")
r2_path = MANIFEST_ROOT.join("r2-upload-#{prefix}.json")

[optimization_path, qa_path, r2_path].each do |path|
  unless path.file?
    warn "Missing #{path}"
    exit 1
  end
end

optimization = JSON.parse(optimization_path.read)
qa = JSON.parse(qa_path.read)
failed_metrics = qa.fetch("metrics").reject { |metric| metric["pass"] }
images_by_id = optimization.fetch("images").each_with_object({}) { |image, map| map[image.fetch("id")] = image }
removed = []

failed_metrics.each do |metric|
  id = metric.fetch("assetId")
  image = images_by_id.fetch(id)
  output_path = metric.fetch("path")
  output = image.fetch("outputs").find { |candidate| candidate.fetch("path") == output_path }
  raise "Missing failed output record #{output_path}" unless output

  path = ROOT.join(output_path)
  real_path = path.realpath
  relative = real_path.relative_path_from(OPTIMIZED_ROOT)
  if relative.each_filename.first == ".."
    raise "Refusing to delete outside optimized root: #{path}"
  end
  unless Digest::SHA256.file(real_path).hexdigest == output.fetch("sha256")
    raise "Refusing to delete checksum-mismatched output: #{path}"
  end

  File.delete(path) if path.file?
  image.fetch("outputs").delete(output)
  image.fetch("skipped") << {
    "format" => path.extname.delete_prefix("."),
    "width" => output.dig("dimensions", "width"),
    "reason" => "quality-gate-failed",
    "ssim" => metric["ssim"],
    "psnr" => metric["psnr"]
  }

  source_width = image.dig("source", "dimensions", "width")
  if path.extname.downcase == ".jpg" &&
     output.dig("dimensions", "width") == source_width &&
     image["placement"] == "r2"
    source = image.fetch("source")
    source_extension = Pathname.new(source.fetch("path")).extname.downcase
    source["r2Key"] = "media/#{image.fetch("category")}/#{id}-#{source.fetch("sha256")[0, 12]}#{source_extension}"
  end

  removed << output_path
end

optimization.fetch("summary")["outputBytes"] = optimization.fetch("images").sum do |image|
  image.fetch("outputs").sum { |output| output.fetch("bytes").to_i }
end
optimization["generatedAt"] = Time.now.utc.iso8601
optimization["qualityPruning"] = {
  "appliedAt" => Time.now.utc.iso8601,
  "removedCount" => removed.length,
  "removedPaths" => removed
}

r2_items = optimization.fetch("images").flat_map do |image|
  source_items = image["source"] && image["source"]["r2Key"] ? [image["source"]] : []
  output_items = image.fetch("outputs").select { |output| output["r2Key"] }
  (source_items + output_items).map do |item|
    {
      "assetId" => image.fetch("id"),
      "r2Key" => item.fetch("r2Key"),
      "localPath" => item.fetch("path"),
      "bytes" => item.fetch("bytes"),
      "sha256" => item.fetch("sha256")
    }
  end
end

optimization_path.write(JSON.pretty_generate(optimization) + "\n")
r2_path.write(
  JSON.pretty_generate(
    "schemaVersion" => 1,
    "generatedAt" => Time.now.utc.iso8601,
    "uploadAuthorized" => false,
    "items" => r2_items
  ) + "\n"
)

puts JSON.generate(
  "removedOutputs" => removed.length,
  "sourceFallbacks" => optimization.fetch("images").count { |image| image.dig("source", "r2Key") },
  "r2Items" => r2_items.length
)
