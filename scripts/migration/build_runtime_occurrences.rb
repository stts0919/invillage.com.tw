#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "pathname"
require "set"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
OUTPUT_PATH = ROOT.join("assets/manifests/runtime-occurrences.json")
URL_PATTERN = %r{https://[^"'\s<>(),]+}
GENERIC_PAGES_URLS = Set.new([
  "https://cdn.prod.website-files.com/static/page-not-found.211a85e40c.svg",
  "https://d3e54v103j8qbb.cloudfront.net/static/youtube-placeholder.2b05e7d68d.svg"
]).freeze
FORBIDDEN_HOSTS = Set.new([
  "ajax.googleapis.com",
  "cdn.prod.website-files.com",
  "d3e54v103j8qbb.cloudfront.net"
]).freeze
ALLOWED_HOSTS = Set.new([
  "cloudspring.com.tw",
  "connect.facebook.net",
  "drive.google.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "pse.is",
  "schema.org",
  "www.facebook.com",
  "www.google.com",
  "www.instagram.com",
  "www.youtube-nocookie.com"
]).freeze

def source_context(contents, offset, source_path)
  return ["css-url", "url", nil] if source_path.end_with?(".css")

  json_ld_ranges = []
  contents.to_enum(:scan, %r{<script\b[^>]*type="application/ld\+json"[^>]*>.*?</script>}im).each do
    match = Regexp.last_match
    json_ld_ranges << (match.begin(0)...match.end(0))
  end
  return ["json-ld", "json-ld", nil] if json_ld_ranges.any? { |range| range.cover?(offset) }

  prefix = contents[0...offset]
  attribute_match = prefix.match(/([:\w-]+)="[^"]*\z/)
  if attribute_match
    attribute = attribute_match[1]
    if attribute == "srcset"
      tail = contents[offset..]
      url = tail[URL_PATTERN]
      descriptor_tail = url ? tail[url.length..] : nil
      descriptor = descriptor_tail && descriptor_tail[/\A\s+(\d+(?:\.\d+)?[wx])/, 1]
      return ["html-srcset", attribute, descriptor]
    end
    return ["css-url", attribute, nil] if attribute == "style"

    return ["html-attribute", attribute, nil]
  end

  style_open = prefix.rindex("<style")
  style_close = prefix.rindex("</style>")
  return ["css-url", "url", nil] if style_open && (!style_close || style_open > style_close)

  ["html-attribute", "raw", nil]
end

def external_classification(url)
  return ["generic-pages", "localize-pages"] if GENERIC_PAGES_URLS.include?(url)

  host = URI(url).host
  return ["forbidden-webflow", "reject-network-dependency"] if FORBIDDEN_HOSTS.include?(host)
  return ["allowed-third-party", "preserve-allowlist"] if ALLOWED_HOSTS.include?(host)

  ["unknown", "manual-review"]
rescue URI::InvalidURIError
  ["unknown", "manual-review"]
end

require "uri"

classification = JSON.parse(ROOT.join("assets/manifests/asset-classification.json").read)
classified_assets = classification.fetch("images").to_h { |image| [image.fetch("id"), image] }
source_files = (
  Dir[ROOT.join("imports/webflow/site/html/*.html")].sort +
  Dir[ROOT.join("imports/webflow/site/css/*.css")].sort
).map { |path| Pathname.new(path).relative_path_from(ROOT).to_s }

raise "expected 9 HTML/CSS source files" unless source_files.length == 9

occurrences_by_asset = Hash.new { |hash, key| hash[key] = [] }
external_rows = {}

source_files.each do |source_path|
  contents = ROOT.join(source_path).read
  contents.to_enum(:scan, URL_PATTERN).each do
    match = Regexp.last_match
    url = match[0]
    context, attribute, descriptor = source_context(contents, match.begin(0), source_path)
    asset_id = url.scan(/[0-9a-f]{24}/).last

    if asset_id && classified_assets.key?(asset_id)
      occurrences_by_asset[asset_id] << {
        "sourcePath" => source_path,
        "context" => context,
        "attribute" => attribute,
        "originalUrl" => url,
        "descriptor" => descriptor
      }
      next
    end

    classification_name, expected_action = external_classification(url)
    key = [url, source_path, context]
    external_rows[key] = {
      "originalUrl" => url,
      "sourcePath" => source_path,
      "context" => context,
      "classification" => classification_name,
      "expectedAction" => expected_action
    }
  end
end

assets = classified_assets.values.select { |image| %w[pages r2].include?(image.fetch("placement")) }.sort_by do |image|
  image.fetch("id")
end.map do |image|
  asset_id = image.fetch("id")
  occurrences = occurrences_by_asset.fetch(asset_id)
  raise "live asset has no runtime occurrence: #{asset_id}" if occurrences.empty?

  {
    "assetId" => asset_id,
    "placement" => image.fetch("placement"),
    "category" => image.fetch("category"),
    "occurrences" => occurrences
  }
end

external_assets = external_rows.values.sort_by do |item|
  [item.fetch("originalUrl"), item.fetch("sourcePath"), item.fetch("context")]
end

summary = {
  "totalOccurrences" => assets.sum { |asset| asset.fetch("occurrences").length },
  "uniqueAssetCount" => assets.length,
  "pagesAssetCount" => assets.count { |asset| asset.fetch("placement") == "pages" },
  "r2AssetCount" => assets.count { |asset| asset.fetch("placement") == "r2" },
  "genericExternalCount" => external_assets.length,
  "unmappedCount" => 0
}

expected_core = {
  "totalOccurrences" => 1_239,
  "uniqueAssetCount" => 139,
  "pagesAssetCount" => 16,
  "r2AssetCount" => 123,
  "unmappedCount" => 0
}
expected_core.each do |key, value|
  raise "unexpected #{key}: #{summary.fetch(key)}" unless summary.fetch(key) == value
end

manifest = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.iso8601,
  "sourceFiles" => source_files,
  "summary" => summary,
  "assets" => assets,
  "externalAssets" => external_assets,
  "unmappedUrls" => []
}

OUTPUT_PATH.write("#{JSON.pretty_generate(manifest)}\n")
puts JSON.generate(summary)
