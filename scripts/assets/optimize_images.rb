#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "open3"
require "optparse"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
SOURCE_ROOT = ROOT.join("imports/webflow/assets/images")
OUTPUT_ROOT = ROOT.join("assets/optimized")
MANIFEST_ROOT = ROOT.join("assets/manifests")
CLASSIFICATION_MANIFEST = ROOT.join("assets/manifests/asset-classification.json")

TARGET_WIDTHS = [640, 1280, 1920].freeze
AVIF_PHOTO_CRF = 24
AVIF_GRAPHIC_CRF = 28
JPEG_QSCALE = 1
SUPPORTED_EXTENSIONS = %w[.jpg .jpeg .png .webp .svg].freeze
IMAGE_ID_PATTERN = /\A[0-9a-f]{24}\z/.freeze
CHUNK_SIZE = 64 * 1024

class OptimizationError < StandardError
end

def compact_message(message)
  text = message.to_s.gsub(/\s+/, " ").strip
  text = "unknown error" if text.empty?
  text.length > 600 ? "#{text[0, 597]}..." : text
end

def run_command(*args)
  stdout, stderr, status = Open3.capture3(*args)
  [stdout, stderr, status]
rescue Errno::ENOENT => error
  raise OptimizationError, "missing command #{args.first}: #{error.message}"
end

def require_tool!(name)
  _stdout, stderr, status = run_command(name, "-version")
  return if status.success?

  raise OptimizationError, "#{name} is unavailable: #{compact_message(stderr)}"
end

def relative_path(path)
  path.relative_path_from(ROOT).to_s
end

def validate_id!(id)
  value = id.to_s
  return value if IMAGE_ID_PATTERN.match?(value)

  raise OptimizationError, "invalid image id #{value.inspect}; expected 24 lowercase hexadecimal characters"
end

def manifest_items(path)
  payload = JSON.parse(path.read)
  values =
    if payload.is_a?(Array)
      payload
    elsif payload.is_a?(Hash)
      payload["images"] || payload["assets"] || payload["items"]
    end

  unless values.is_a?(Array)
    raise OptimizationError, "manifest must contain an images, assets, or items array"
  end

  values.map do |item|
    if item.is_a?(String)
      { "id" => item }
    elsif item.is_a?(Hash)
      id = item["id"] || item["assetId"]
      raise OptimizationError, "manifest item is missing id" if id.nil?

      {
        "id" => id,
        "localOriginal" => item["localOriginal"] || item["sourcePath"] || item["path"]
      }
    else
      raise OptimizationError, "manifest item must be an object or id string"
    end
  end
rescue JSON::ParserError => error
  raise OptimizationError, "invalid manifest JSON: #{compact_message(error.message)}"
end

def manifest_path(value)
  path = Pathname.new(value.to_s)
  path = Pathname.new(Dir.pwd).join(path) unless path.absolute?
  path.expand_path
end

def source_candidates(id, hint = nil)
  candidates = SUPPORTED_EXTENSIONS.map do |extension|
    SOURCE_ROOT.join("#{id}#{extension}")
  end.select(&:file?)

  if hint
    hint_name = Pathname.new(hint.to_s).basename.to_s
    hinted = candidates.select { |candidate| candidate.basename.to_s == hint_name }
    candidates = hinted unless hinted.empty?
  end

  candidates
end

def source_for!(id, hint = nil)
  candidates = source_candidates(id, hint)
  if candidates.empty?
    raise OptimizationError, "missing source for #{id} under #{relative_path(SOURCE_ROOT)}"
  end
  if candidates.length > 1
    names = candidates.map { |candidate| candidate.basename.to_s }.join(", ")
    raise OptimizationError, "ambiguous source for #{id}: #{names}"
  end

  source = candidates.first
  source_root_real = SOURCE_ROOT.realpath
  source_real = source.realpath
  unless source_real.dirname == source_root_real
    raise OptimizationError, "source escapes image root for #{id}"
  end

  source_real
rescue Errno::ENOENT => error
  raise OptimizationError, "source cannot be resolved for #{id}: #{error.message}"
end

def probe(path)
  stdout, stderr, status = run_command(
    "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,pix_fmt,codec_name,color_range,color_space,color_transfer,color_primaries",
    "-of", "json", path.to_s
  )
  unless status.success?
    raise OptimizationError, "ffprobe failed for #{relative_path(path)}: #{compact_message(stderr)}"
  end

  stream = JSON.parse(stdout).fetch("streams", []).first
  raise OptimizationError, "ffprobe found no video stream for #{relative_path(path)}" unless stream

  {
    "width" => stream["width"].to_i,
    "height" => stream["height"].to_i,
    "pixelFormat" => stream["pix_fmt"],
    "codec" => stream["codec_name"],
    "colorRange" => stream["color_range"],
    "colorSpace" => stream["color_space"],
    "colorTransfer" => stream["color_transfer"],
    "colorPrimaries" => stream["color_primaries"]
  }
rescue JSON::ParserError, KeyError => error
  raise OptimizationError, "invalid ffprobe response for #{relative_path(path)}: #{compact_message(error.message)}"
end

def raster_dimensions!(details, path)
  width = details.fetch("width")
  height = details.fetch("height")
  return if width.positive? && height.positive?

  raise OptimizationError, "invalid raster dimensions for #{relative_path(path)}"
end

def png_opaque?(path)
  stdin, stdout, stderr, wait_thr = Open3.popen3(
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror",
    "-i", path.to_s, "-map", "0:v:0", "-frames:v", "1",
    "-vf", "alphaextract", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"
  )
  stdin.close

  opaque = true
  loop do
    chunk = stdout.read(CHUNK_SIZE)
    break if chunk.nil? || chunk.empty?

    opaque = false if opaque && chunk.bytes.any? { |value| value < 255 }
  end
  stdout.close
  diagnostics = stderr.read
  stderr.close
  status = wait_thr.value
  unless status.success?
    raise OptimizationError, "alpha inspection failed for #{relative_path(path)}: #{compact_message(diagnostics)}"
  end

  opaque
rescue IOError, Errno::EPIPE => error
  raise OptimizationError, "alpha inspection failed for #{relative_path(path)}: #{compact_message(error.message)}"
end

def frame_checksum(path)
  stdout, stderr, status = run_command(
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror",
    "-i", path.to_s, "-map", "0:v:0", "-frames:v", "1",
    "-pix_fmt", "rgba", "-f", "framemd5", "pipe:1"
  )
  unless status.success?
    raise OptimizationError, "frame checksum failed for #{relative_path(path)}: #{compact_message(stderr)}"
  end

  line = stdout.lines.reverse.find { |entry| entry =~ /,\s*([0-9a-f]{32})\s*\z/i }
  raise OptimizationError, "frame checksum missing for #{relative_path(path)}" unless line

  line.match(/,\s*([0-9a-f]{32})\s*\z/i)[1].downcase
end

def decode_verify!(path)
  _stdout, stderr, status = run_command(
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror",
    "-i", path.to_s, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"
  )
  return if status.success?

  raise OptimizationError, "decode verification failed for #{relative_path(path)}: #{compact_message(stderr)}"
end

def output_dimensions!(path)
  details = probe(path)
  raster_dimensions!(details, path)
  { "width" => details.fetch("width"), "height" => details.fetch("height") }
end

def output_path_for(id, name)
  OUTPUT_ROOT.join(id, name)
end

def temporary_path(path)
  suffix = path.extname
  basename = path.basename.to_s.sub(/#{Regexp.escape(suffix)}\z/, "")
  path.dirname.join(".#{basename}.tmp-#{$$}-#{rand(1_000_000)}#{suffix}")
end

def write_transcode!(source, destination, args)
  FileUtils.mkdir_p(destination.dirname.to_s)
  temporary = temporary_path(destination)
  begin
    _stdout, stderr, status = run_command(*(args + ["-y", temporary.to_s]))
    unless status.success?
      raise OptimizationError, "ffmpeg failed for #{relative_path(destination)}: #{compact_message(stderr)}"
    end

    yield temporary
    File.rename(temporary.to_s, destination.to_s)
  ensure
    File.delete(temporary.to_s) if temporary.file?
  end
end

def output_record(path, strategy, dimensions = nil, frame = nil)
  details = probe(path)
  record = {
    "path" => relative_path(path),
    "bytes" => path.size,
    "dimensions" => dimensions || { "width" => details["width"], "height" => details["height"] },
    "codec" => details["codec"],
    "pixelFormat" => details["pixelFormat"],
    "colorRange" => details["colorRange"],
    "colorSpace" => details["colorSpace"],
    "colorTransfer" => details["colorTransfer"],
    "colorPrimaries" => details["colorPrimaries"],
    "sha256" => Digest::SHA256.file(path).hexdigest,
    "strategy" => strategy,
    "errors" => []
  }
  if frame
    record["frameChecksum"] = frame
    record["frameChecksumAlgorithm"] = "framemd5-md5"
  end
  record
end

def source_record(path, dimensions, strategy, frame = nil, details = nil)
  record = {
    "path" => relative_path(path),
    "bytes" => path.size,
    "dimensions" => dimensions,
    "sha256" => Digest::SHA256.file(path).hexdigest,
    "strategy" => strategy,
    "errors" => []
  }
  if details
    record["codec"] = details["codec"]
    record["pixelFormat"] = details["pixelFormat"]
    record["colorRange"] = details["colorRange"]
    record["colorSpace"] = details["colorSpace"]
    record["colorTransfer"] = details["colorTransfer"]
    record["colorPrimaries"] = details["colorPrimaries"]
  end
  if frame
    record["frameChecksum"] = frame
    record["frameChecksumAlgorithm"] = "framemd5-md5"
  end
  record
end

def even_target_width(source_width, maximum)
  width = [source_width, maximum].min
  width -= width % 2
  raise OptimizationError, "source width #{source_width} is too small for yuv420p" if width < 2

  width
end

def target_widths(source_width)
  TARGET_WIDTHS.map { |maximum| even_target_width(source_width, maximum) }.uniq.sort
end

def scale_filter(width)
  "scale=#{width}:-2:flags=lanczos"
end

def generate_avif!(source, id, width, source_bytes, crf)
  destination = output_path_for(id, "#{id}-w#{width}.avif")
  args = [
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-i", source.to_s,
    "-map", "0:v:0", "-frames:v", "1", "-an", "-vf", scale_filter(width),
    "-c:v", "libsvtav1", "-preset", "9", "-crf", crf.to_s, "-pix_fmt", "yuv420p",
    "-f", "avif"
  ]
  write_transcode!(source, destination, args) do |temporary|
    decode_verify!(temporary)
  end
  if destination.size >= source_bytes
    File.delete(destination)
    return nil
  end

  output_record(
    destination,
    "avif libsvtav1 preset9 crf#{crf} yuv420p width=#{width}",
    output_dimensions!(destination)
  )
rescue OptimizationError
  raise
rescue StandardError => error
  raise OptimizationError, "AVIF generation failed for #{id}: #{compact_message(error.message)}"
end

def generate_jpeg_fallback!(source, id, width, source_bytes, pixel_format)
  destination = output_path_for(id, "#{id}-fallback-w#{width}.jpg")
  args = [
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-i", source.to_s,
    "-map", "0:v:0", "-frames:v", "1", "-an", "-vf", scale_filter(width),
    "-c:v", "mjpeg", "-q:v", JPEG_QSCALE.to_s, "-pix_fmt", pixel_format, "-f", "image2"
  ]
  write_transcode!(source, destination, args) do |temporary|
    decode_verify!(temporary)
  end
  if destination.size >= source_bytes
    File.delete(destination)
    return nil
  end

  output_record(destination, "mjpeg q:v#{JPEG_QSCALE} #{pixel_format} width=#{width}", output_dimensions!(destination))
rescue OptimizationError
  raise
rescue StandardError => error
  raise OptimizationError, "JPEG fallback generation failed for #{id}: #{compact_message(error.message)}"
end

def generate_png_lossless!(source, id, source_details, source_frame)
  destination = output_path_for(id, "#{id}-lossless.png")
  args = [
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-i", source.to_s,
    "-map", "0:v:0", "-frames:v", "1", "-an", "-c:v", "png",
    "-compression_level", "9", "-pred", "mixed", "-f", "image2"
  ]
  write_transcode!(source, destination, args) do |temporary|
    decode_verify!(temporary)
    generated_frame = frame_checksum(temporary)
    unless generated_frame == source_frame
      raise OptimizationError, "PNG frame checksum mismatch for #{id}"
    end
  end
  if destination.size >= source.size
    File.delete(destination)
    return nil
  end

  output_record(
    destination,
    "png lossless compression_level9 pred mixed",
    { "width" => source_details.fetch("width"), "height" => source_details.fetch("height") },
    source_frame
  )
rescue OptimizationError
  raise
rescue StandardError => error
  raise OptimizationError, "PNG lossless generation failed for #{id}: #{compact_message(error.message)}"
end

def r2_key(category, id, sha256, path)
  "media/#{category}/#{id}-#{sha256[0, 12]}#{Pathname.new(path).extname.downcase}"
end

def process_image(id, hint, classification)
  source = source_for!(id, hint)
  extension = source.extname.downcase
  errors = []
  outputs = []
  skipped = []
  placement = classification.fetch("placement")
  category = classification.fetch("category")
  policy = classification.fetch("optimizationPolicy")

  if policy == "preserve-svg" || policy == "preserve-source-only"
    source_info = source_record(
      source,
      { "width" => nil, "height" => nil },
      policy
    )
    source_info["pagesPath"] = classification["target"] if placement == "pages"
    return {
      "id" => id,
      "bytes" => source_info.fetch("bytes"),
      "dimensions" => source_info.fetch("dimensions"),
      "sha256" => source_info.fetch("sha256"),
      "placement" => placement,
      "category" => category,
      "target" => classification["target"],
      "strategy" => policy,
      "errors" => errors,
      "skipped" => skipped,
      "source" => source_info,
      "outputs" => outputs
    }
  end

  source_details = probe(source)
  raster_dimensions!(source_details, source)
  dimensions = {
    "width" => source_details.fetch("width"),
    "height" => source_details.fetch("height")
  }
  source_frame = extension == ".png" ? frame_checksum(source) : nil
  opaque_png = extension == ".png" ? png_opaque?(source) : nil
  if policy == "responsive-avif+lossless-png" && !opaque_png
    raise OptimizationError, "classification expects opaque PNG for #{id}"
  end

  source_info = source_record(source, dimensions, policy, source_frame, source_details)
  widths = target_widths(source_details.fetch("width"))

  case policy
  when "responsive-avif+jpeg-fallback"
    pixel_format = source_details.fetch("pixelFormat").to_s
    avif_widths = if pixel_format.include?("422")
                    []
                  elsif pixel_format.include?("444")
                    widths.select { |width| width <= 640 }
                  else
                    widths
                  end
    avif_skip_reason = pixel_format.include?("422") ? "source-422-chroma-quality-risk" : "source-444-chroma-quality-risk"
    (widths - avif_widths).each do |width|
      skipped << { "format" => "avif", "width" => width, "reason" => avif_skip_reason }
    end
    avif_widths.each do |width|
      crf = pixel_format.include?("420") ? AVIF_PHOTO_CRF : AVIF_GRAPHIC_CRF
      avif = generate_avif!(source, id, width, source.size, crf)
      avif ? outputs << avif : skipped << { "format" => "avif", "width" => width, "reason" => "not-smaller-than-source" }
    end

    widths.each do |width|
      jpeg = generate_jpeg_fallback!(source, id, width, source.size, source_details.fetch("pixelFormat"))
      jpeg ? outputs << jpeg : skipped << { "format" => "jpeg", "width" => width, "reason" => "not-smaller-than-source" }
    end

    native_width = widths.max
    native_jpeg = outputs.any? do |output|
      output.fetch("path").end_with?(".jpg") && output.dig("dimensions", "width") == native_width
    end
    unless native_jpeg
      source_info["r2Key"] = r2_key(category, id, source_info.fetch("sha256"), source)
    end
  when "responsive-avif+lossless-png"
    png = generate_png_lossless!(source, id, source_details, source_frame)
    png ? outputs << png : skipped << { "format" => "png", "width" => source_details.fetch("width"), "reason" => "not-smaller-than-source" }
    widths.each do |width|
      avif = generate_avif!(source, id, width, source.size, AVIF_GRAPHIC_CRF)
      avif ? outputs << avif : skipped << { "format" => "avif", "width" => width, "reason" => "not-smaller-than-source" }
    end
  when "preserve-webp+optional-avif"
    source_info["r2Key"] = r2_key(category, id, source_info.fetch("sha256"), source)
    widths.each do |width|
      avif = generate_avif!(source, id, width, source.size, AVIF_GRAPHIC_CRF)
      avif ? outputs << avif : skipped << { "format" => "avif", "width" => width, "reason" => "not-smaller-than-source" }
    end
  when "lossless-png"
    raise OptimizationError, "lossless-png policy requires PNG for #{id}" unless extension == ".png"

    png = generate_png_lossless!(source, id, source_details, source_frame)
    if png
      png["pagesPath"] = classification["target"]
      outputs << png
    else
      source_info["pagesPath"] = classification["target"]
      skipped << { "format" => "png", "width" => source_details.fetch("width"), "reason" => "not-smaller-than-source" }
    end
  else
    raise OptimizationError, "unsupported optimization policy #{policy.inspect} for #{id}"
  end

  if placement == "r2"
    outputs.each do |output|
      output["r2Key"] = r2_key(category, id, output.fetch("sha256"), output.fetch("path"))
    end
  end

  {
    "id" => id,
    "bytes" => source_info.fetch("bytes"),
    "dimensions" => source_info.fetch("dimensions"),
    "sha256" => source_info.fetch("sha256"),
    "placement" => placement,
    "category" => category,
    "target" => classification["target"],
    "strategy" => policy,
    "errors" => errors,
    "skipped" => skipped,
    "source" => source_info,
    "outputs" => outputs
  }
end

def atomic_write(path, content)
  FileUtils.mkdir_p(path.dirname.to_s)
  temporary = temporary_path(path)
  begin
    File.open(temporary.to_s, "wb") { |file| file.write(content) }
    File.rename(temporary.to_s, path.to_s)
  ensure
    File.delete(temporary.to_s) if temporary.file?
  end
end

options = { "ids" => [], "manifest" => nil, "limit" => nil, "outputPrefix" => "sample" }
parser = OptionParser.new do |opts|
  opts.banner = "Usage: ruby scripts/assets/optimize_images.rb --id ID [--id ID ...]"
  opts.on("--id ID", "process one 24-character image id; repeatable") { |id| options["ids"] << id }
  opts.on("--manifest PATH", "read image ids from a manifest; requires --limit") { |path| options["manifest"] = path }
  opts.on("--limit N", Integer, "maximum manifest entries to process") { |limit| options["limit"] = limit }
  opts.on("--output-prefix NAME", "write optimization-NAME.json and r2-upload-NAME.json") { |name| options["outputPrefix"] = name }
  opts.on("-h", "--help", "show this help") do
    puts opts
    exit 0
  end
end

begin
  parser.parse!(ARGV)
  raise OptimizationError, "unexpected arguments: #{ARGV.join(" ")}" unless ARGV.empty?
  raise OptimizationError, "select with --id or --manifest; full runs are disabled" if options["ids"].empty? && options["manifest"].nil?
  raise OptimizationError, "--id and --manifest cannot be combined" unless options["ids"].empty? || options["manifest"].nil?
  raise OptimizationError, "--limit is only valid with --manifest" if options["manifest"].nil? && !options["limit"].nil?
  raise OptimizationError, "--manifest requires a positive --limit" if options["manifest"] && (!options["limit"] || options["limit"] < 1)
  unless options["outputPrefix"].match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/)
    raise OptimizationError, "--output-prefix must use lowercase letters, numbers, and hyphens"
  end

  output_manifest = MANIFEST_ROOT.join("optimization-#{options["outputPrefix"]}.json")
  r2_upload_manifest = MANIFEST_ROOT.join("r2-upload-#{options["outputPrefix"]}.json")

  selections = if options["manifest"]
                 path = manifest_path(options["manifest"])
                 raise OptimizationError, "missing manifest #{path}" unless path.file?

                 entries = manifest_items(path)
                 unique = {}
                 selected = []
                 entries.each do |entry|
                   id = validate_id!(entry.fetch("id").to_s)
                   next if unique.key?(id)

                   unique[id] = true
                   selected << { "id" => id, "localOriginal" => entry["localOriginal"] }
                   break if selected.length >= options["limit"]
                 end
                 selected
               else
                 options["ids"].map { |id| { "id" => validate_id!(id), "localOriginal" => nil } }.uniq { |entry| entry["id"] }
               end
  raise OptimizationError, "selection resolved to zero images" if selections.empty?

  require_tool!("ffmpeg")
  require_tool!("ffprobe")
  raise OptimizationError, "missing classification manifest #{CLASSIFICATION_MANIFEST}" unless CLASSIFICATION_MANIFEST.file?

  classification_rows = JSON.parse(CLASSIFICATION_MANIFEST.read).fetch("images")
  classification_by_id = classification_rows.each_with_object({}) do |item, map|
    map[item.fetch("id")] = item
  end
  FileUtils.mkdir_p(OUTPUT_ROOT.to_s)

  records = []
  top_level_errors = []
  selections.each do |selection|
    id = selection.fetch("id")
    begin
      classification = classification_by_id[id]
      raise OptimizationError, "missing classification for #{id}" unless classification

      records << process_image(id, selection["localOriginal"], classification)
    rescue StandardError => error
      message = compact_message(error.message)
      top_level_errors << { "id" => id, "error" => message }
      records << {
        "id" => id,
        "bytes" => nil,
        "dimensions" => nil,
        "sha256" => nil,
        "placement" => classification_by_id.dig(id, "placement"),
        "category" => classification_by_id.dig(id, "category"),
        "target" => classification_by_id.dig(id, "target"),
        "strategy" => "error",
        "errors" => [message],
        "skipped" => [],
        "source" => nil,
        "outputs" => []
      }
      warn "#{id}: #{message}"
    end
  end

  output_bytes = records.sum do |record|
    record.fetch("outputs").sum { |output| output.fetch("bytes").to_i }
  end
  source_bytes = records.sum { |record| record.fetch("bytes").to_i }
  payload = {
    "schemaVersion" => 1,
    "generatedAt" => Time.now.utc.iso8601,
    "sourceRoot" => relative_path(SOURCE_ROOT),
    "outputRoot" => relative_path(OUTPUT_ROOT),
    "classificationManifest" => relative_path(CLASSIFICATION_MANIFEST),
    "outputPrefix" => options["outputPrefix"],
    "selection" => {
      "mode" => options["manifest"] ? "manifest" : "id",
      "manifest" => options["manifest"],
      "limit" => options["limit"],
      "ids" => selections.map { |selection| selection.fetch("id") }
    },
    "summary" => {
      "selected" => selections.length,
      "succeeded" => records.count { |record| record.fetch("errors").empty? },
      "failed" => top_level_errors.length,
      "sourceBytes" => source_bytes,
      "outputBytes" => output_bytes
    },
    "images" => records,
    "errors" => top_level_errors
  }
  atomic_write(output_manifest, JSON.pretty_generate(payload) + "\n")
  r2_items = records.flat_map do |record|
    source_items = record["source"] && record["source"]["r2Key"] ? [record["source"]] : []
    output_items = record.fetch("outputs").select { |output| output["r2Key"] }
    (source_items + output_items).map do |item|
      {
        "assetId" => record.fetch("id"),
        "r2Key" => item.fetch("r2Key"),
        "localPath" => item.fetch("path"),
        "bytes" => item.fetch("bytes"),
        "sha256" => item.fetch("sha256")
      }
    end
  end
  atomic_write(
    r2_upload_manifest,
    JSON.pretty_generate(
      "schemaVersion" => 1,
      "generatedAt" => Time.now.utc.iso8601,
      "uploadAuthorized" => false,
      "items" => r2_items
    ) + "\n"
  )
  puts JSON.generate(payload.fetch("summary"))
  exit(top_level_errors.empty? ? 0 : 1)
rescue OptionParser::ParseError, OptimizationError => error
  warn "ERROR: #{compact_message(error.message)}"
  warn parser.to_s
  exit 2
rescue StandardError => error
  warn "ERROR: #{compact_message(error.message)}"
  exit 1
end
