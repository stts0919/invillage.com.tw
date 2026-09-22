#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
ASSET_MANIFEST = ROOT.join("imports/webflow/manifests/webflow-assets.json")
OUTPUT = ROOT.join("imports/webflow/manifests/image-inventory.json")

unless ASSET_MANIFEST.file?
  warn "Missing #{ASSET_MANIFEST}"
  exit 1
end

if ARGV.empty?
  warn "Usage: ruby scripts/assets/build_image_inventory.rb PAGE.html [PAGE.html ...]"
  exit 1
end

page_ids = {}
ARGV.each do |file_name|
  path = Pathname.new(file_name)
  unless path.file?
    warn "Missing snapshot #{path}"
    exit 1
  end

  page = path.basename(path.extname).to_s.sub(/^invillage-/, "")
  ids = path.read.scan(/\b([0-9a-f]{24})_/).flatten.uniq.sort
  page_ids[page] = ids
end

assets = JSON.parse(ASSET_MANIFEST.read).fetch("assets")
images = assets.select { |asset| asset.fetch("contentType", "").start_with?("image/") }

extension_for = lambda do |content_type|
  {
    "image/jpeg" => "jpg",
    "image/png" => "png",
    "image/svg+xml" => "svg",
    "image/webp" => "webp"
  }.fetch(content_type) { content_type.split("/").last.gsub(/[^a-z0-9]+/i, "-") }
end

inventory = images.map do |asset|
  id = asset.fetch("id")
  used_on = page_ids.each_with_object([]) do |(page, ids), matches|
    matches << page if ids.include?(id)
  end.sort
  extension = extension_for.call(asset.fetch("contentType"))

  {
    "id" => id,
    "displayName" => asset["displayName"],
    "originalFileName" => asset["originalFileName"],
    "contentType" => asset["contentType"],
    "sourceBytes" => asset["size"],
    "sourceUrl" => asset["hostedUrl"],
    "altText" => asset["altText"],
    "folderId" => asset["folderId"],
    "usedOn" => used_on,
    "usedOnLiveSite" => !used_on.empty?,
    "localOriginal" => "imports/webflow/assets/images/#{id}.#{extension}",
    "optimizedDirectory" => "assets/optimized/#{id}"
  }
end

used = inventory.select { |asset| asset["usedOnLiveSite"] }
unused = inventory.reject { |asset| asset["usedOnLiveSite"] }

payload = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "sourceManifest" => ASSET_MANIFEST.relative_path_from(ROOT).to_s,
  "snapshotPages" => page_ids.keys.sort,
  "summary" => {
    "imageAssets" => inventory.length,
    "imageSourceBytes" => inventory.sum { |asset| asset["sourceBytes"] || 0 },
    "usedImageAssets" => used.length,
    "usedImageSourceBytes" => used.sum { |asset| asset["sourceBytes"] || 0 },
    "unusedImageAssets" => unused.length,
    "unusedImageSourceBytes" => unused.sum { |asset| asset["sourceBytes"] || 0 }
  },
  "pages" => page_ids,
  "images" => inventory.sort_by { |asset| [asset["usedOnLiveSite"] ? 0 : 1, asset["id"]] }
}

OUTPUT.write(JSON.pretty_generate(payload) + "\n")
puts JSON.generate(payload.fetch("summary"))
