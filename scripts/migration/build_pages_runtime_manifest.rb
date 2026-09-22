#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
OUTPUT_PATH = ROOT.join("assets/manifests/pages-runtime-assets.json")

CONTENT_TYPES = {
  ".png" => "image/png",
  ".svg" => "image/svg+xml",
  ".ttf" => "font/ttf"
}.freeze

GENERIC_ASSETS = [
  {
    "kind" => "vendor",
    "name" => "page-not-found",
    "sourceUrl" => "https://cdn.prod.website-files.com/static/page-not-found.211a85e40c.svg",
    "localPath" => "imports/webflow/assets/static/page-not-found.211a85e40c.svg",
    "targetPath" => "apps/web/public/assets/vendor/page-not-found.211a85e40c.svg"
  },
  {
    "kind" => "vendor",
    "name" => "youtube-placeholder",
    "sourceUrl" => "https://d3e54v103j8qbb.cloudfront.net/static/youtube-placeholder.2b05e7d68d.svg",
    "localPath" => "imports/webflow/assets/static/youtube-placeholder.2b05e7d68d.svg",
    "targetPath" => "apps/web/public/assets/vendor/youtube-placeholder.2b05e7d68d.svg"
  }
].freeze

def read_json(relative_path)
  JSON.parse(ROOT.join(relative_path).read)
end

def verify_file(relative_path, expected_bytes: nil, expected_sha256: nil)
  absolute_path = ROOT.join(relative_path).expand_path
  root_prefix = "#{ROOT}/"
  unless absolute_path.to_s.start_with?(root_prefix) && absolute_path.file?
    raise "missing or out-of-root file: #{relative_path}"
  end

  bytes = absolute_path.size
  sha256 = Digest::SHA256.file(absolute_path).hexdigest

  if expected_bytes && bytes != expected_bytes
    raise "bytes mismatch for #{relative_path}: expected #{expected_bytes}, got #{bytes}"
  end
  if expected_sha256 && sha256 != expected_sha256
    raise "sha256 mismatch for #{relative_path}: expected #{expected_sha256}, got #{sha256}"
  end

  [bytes, sha256]
end

def content_type_for(path)
  CONTENT_TYPES.fetch(File.extname(path).downcase) do
    raise "unsupported Pages runtime extension: #{path}"
  end
end

pages_manifest = read_json("assets/manifests/pages-assets-live.json")
webflow_assets = read_json("imports/webflow/manifests/webflow-assets.json")
site_import = read_json("imports/webflow/manifests/site-import.json")
assets_by_id = webflow_assets.fetch("assets").to_h { |asset| [asset.fetch("id"), asset] }

page_items = pages_manifest.fetch("items").map do |item|
  asset_id = item.fetch("assetId")
  source_asset = assets_by_id.fetch(asset_id)
  local_path = item.fetch("localPath")
  target_path = item.fetch("targetPath")
  bytes, sha256 = verify_file(
    local_path,
    expected_bytes: item.fetch("bytes"),
    expected_sha256: item.fetch("sha256")
  )

  {
    "kind" => target_path.include?("/brand/") ? "brand" : "icon",
    "assetId" => asset_id,
    "name" => source_asset.fetch("displayName"),
    "sourceUrl" => source_asset.fetch("hostedUrl"),
    "localPath" => local_path,
    "targetPath" => target_path,
    "contentType" => content_type_for(target_path),
    "bytes" => bytes,
    "sha256" => sha256
  }
end

generic_items = GENERIC_ASSETS.map do |definition|
  bytes, sha256 = verify_file(definition.fetch("localPath"))
  definition.merge(
    "assetId" => nil,
    "contentType" => content_type_for(definition.fetch("targetPath")),
    "bytes" => bytes,
    "sha256" => sha256
  )
end

font_items = site_import.fetch("fonts").map do |font|
  asset_id = font.fetch("id")
  local_path = font.fetch("localPath")
  target_path = "apps/web/public/assets/fonts/#{asset_id}.ttf"
  bytes, sha256 = verify_file(
    local_path,
    expected_bytes: font.fetch("bytes"),
    expected_sha256: font.fetch("sha256")
  )

  {
    "kind" => "font",
    "assetId" => asset_id,
    "name" => font.fetch("displayName"),
    "sourceUrl" => font.fetch("downloadUrl"),
    "localPath" => local_path,
    "targetPath" => target_path,
    "contentType" => "font/ttf",
    "bytes" => bytes,
    "sha256" => sha256
  }
end

items = (page_items + generic_items + font_items).sort_by { |item| item.fetch("targetPath") }
summary = {
  "itemCount" => items.length,
  "imageItemCount" => page_items.length,
  "genericItemCount" => generic_items.length,
  "fontItemCount" => font_items.length,
  "totalBytes" => items.sum { |item| item.fetch("bytes") }
}

expected_summary = {
  "itemCount" => 24,
  "imageItemCount" => 16,
  "genericItemCount" => 2,
  "fontItemCount" => 6,
  "totalBytes" => 24_852_679
}
raise "unexpected Pages runtime summary: #{summary.inspect}" unless summary == expected_summary

manifest = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "copyAuthorized" => true,
  "remoteMutationAuthorized" => false,
  "sources" => {
    "pagesAssets" => "assets/manifests/pages-assets-live.json",
    "webflowAssets" => "imports/webflow/manifests/webflow-assets.json",
    "siteImport" => "imports/webflow/manifests/site-import.json"
  },
  "summary" => summary,
  "items" => items
}

OUTPUT_PATH.write("#{JSON.pretty_generate(manifest)}\n")
puts JSON.generate(summary)
