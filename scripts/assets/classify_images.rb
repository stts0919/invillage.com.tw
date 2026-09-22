#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "open3"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
ASSETS = ROOT.join("imports/webflow/manifests/webflow-assets.json")
INVENTORY = ROOT.join("imports/webflow/manifests/image-inventory.json")
OUTPUT = ROOT.join("assets/manifests/asset-classification.json")
BRAND_FOLDER_ID = "650740ad2c74b09d427ed920"

def probe(path)
  stdout, stderr, status = Open3.capture3(
    "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,pix_fmt",
    "-of", "json", path.to_s
  )
  raise "ffprobe failed for #{path}: #{stderr.strip}" unless status.success?

  stream = JSON.parse(stdout).fetch("streams").first
  raise "No image stream for #{path}" unless stream

  {
    "width" => stream["width"],
    "height" => stream["height"],
    "pixelFormat" => stream["pix_fmt"]
  }
end

def transparent_png?(path, pixel_format)
  return false unless pixel_format.to_s.include?("a")

  _stdout, stderr, status = Open3.capture3(
    "ffmpeg", "-hide_banner", "-loglevel", "info", "-i", path.to_s,
    "-vf", "alphaextract,signalstats,metadata=mode=print",
    "-frames:v", "1", "-f", "null", "-"
  )
  raise "alpha inspection failed for #{path}" unless status.success?

  match = stderr.match(/lavfi\.signalstats\.YMIN=(\d+)/)
  raise "alpha inspection did not report YMIN for #{path}" unless match

  match[1].to_i < 255
end

asset_rows = JSON.parse(ASSETS.read).fetch("assets")
asset_by_id = asset_rows.each_with_object({}) { |asset, map| map[asset.fetch("id")] = asset }
images = JSON.parse(INVENTORY.read).fetch("images")

classified = images.map do |image|
  id = image.fetch("id")
  asset = asset_by_id.fetch(id)
  path = ROOT.join(image.fetch("localOriginal"))
  raise "Missing #{path}" unless path.file?

  extension = path.extname.delete_prefix(".").downcase
  raster = image["contentType"] != "image/svg+xml"
  details = raster ? probe(path) : {}
  transparent = image["contentType"] == "image/png" &&
                transparent_png?(path, details["pixelFormat"])

  placement, category, policy =
    if !image["usedOnLiveSite"]
      ["archive", "source-only", "preserve-source-only"]
    elsif image["contentType"] == "image/jpeg"
      ["r2", "content", "responsive-avif+jpeg-fallback"]
    elsif image["contentType"] == "image/webp"
      ["r2", "content", "preserve-webp+optional-avif"]
    elsif image["contentType"] == "image/png" && asset["folderId"] == BRAND_FOLDER_ID
      ["pages", "brand", "lossless-png"]
    elsif image["contentType"] == "image/png" && image["sourceBytes"].to_i > 500_000
      ["r2", "content", transparent ? "manual-review-alpha" : "responsive-avif+lossless-png"]
    elsif image["contentType"] == "image/png"
      ["pages", "icons", "lossless-png"]
    elsif image["contentType"] == "image/svg+xml"
      ["pages", "icons", "preserve-svg"]
    else
      ["manual-review", "unknown", "manual-review"]
    end

  target =
    case placement
    when "pages"
      "apps/web/public/assets/#{category}/#{id}.#{extension}"
    when "r2"
      "media/#{category}/"
    else
      nil
    end

  {
    "id" => id,
    "displayName" => image["displayName"],
    "contentType" => image["contentType"],
    "sourcePath" => image["localOriginal"],
    "sourceBytes" => image["sourceBytes"],
    "sha256" => Digest::SHA256.file(path).hexdigest,
    "usedOn" => image["usedOn"],
    "usedOnLiveSite" => image["usedOnLiveSite"],
    "folderId" => asset["folderId"],
    "width" => details["width"],
    "height" => details["height"],
    "pixelFormat" => details["pixelFormat"],
    "hasTransparency" => transparent,
    "placement" => placement,
    "category" => category,
    "optimizationPolicy" => policy,
    "target" => target
  }
end

grouped = classified.group_by { |image| image.fetch("placement") }
summary = grouped.keys.sort.each_with_object({}) do |placement, result|
  rows = grouped.fetch(placement)
  result[placement] = {
    "count" => rows.length,
    "bytes" => rows.sum { |image| image.fetch("sourceBytes").to_i }
  }
end

payload = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "rulesVersion" => 1,
  "summary" => summary,
  "manualReviewCount" => classified.count { |image| image["placement"] == "manual-review" || image["optimizationPolicy"].start_with?("manual-review") },
  "images" => classified.sort_by { |image| [image.fetch("placement"), image.fetch("id")] }
}

OUTPUT.write(JSON.pretty_generate(payload) + "\n")
puts JSON.generate(payload.fetch("summary").merge("manualReviewCount" => payload["manualReviewCount"]))
exit(payload["manualReviewCount"].zero? ? 0 : 2)
