#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "optparse"
require "pathname"
require "time"
require "uri"

ROOT = Pathname.new(__dir__).join("../..").expand_path
SOURCE_PATH = ROOT.join("assets/manifests/r2-upload-live.json")
OUTPUT_PATH = ROOT.join("assets/manifests/r2-upload-preview.json")
BUCKET_NAME = "invillage-media-preview"
CACHE_CONTROL = "public, max-age=31536000, immutable"

CONTENT_TYPES = {
  ".avif" => "image/avif",
  ".jpg" => "image/jpeg",
  ".png" => "image/png",
  ".webp" => "image/webp"
}.freeze

options = { base_url: nil, authorized: false }
OptionParser.new do |parser|
  parser.on("--base-url URL", "Populate remote URLs after public r2.dev readback") do |url|
    options[:base_url] = url
  end
  parser.on("--authorized", "Record the accepted Preview bucket/public/upload authorization") do
    options[:authorized] = true
  end
end.parse!

if options[:base_url]
  parsed_url = URI.parse(options[:base_url])
  unless parsed_url.is_a?(URI::HTTPS) && parsed_url.host && parsed_url.path.to_s.gsub("/", "").empty?
    raise "base URL must be an HTTPS origin without a path"
  end
  options[:base_url] = options[:base_url].delete_suffix("/")
end

source = JSON.parse(SOURCE_PATH.read)
items = source.fetch("items").map do |item|
  local_path = item.fetch("localPath")
  absolute_path = ROOT.join(local_path).expand_path
  unless absolute_path.to_s.start_with?("#{ROOT}/") && absolute_path.file?
    raise "missing or out-of-root file: #{local_path}"
  end

  bytes = absolute_path.size
  sha256 = Digest::SHA256.file(absolute_path).hexdigest
  raise "bytes mismatch for #{local_path}" unless bytes == item.fetch("bytes")
  raise "sha256 mismatch for #{local_path}" unless sha256 == item.fetch("sha256")

  r2_key = item.fetch("r2Key")
  extension = File.extname(r2_key).downcase
  content_type = CONTENT_TYPES.fetch(extension) { raise "unsupported R2 extension: #{r2_key}" }
  expected_suffix = "-#{sha256[0, 12]}#{extension}"
  raise "content hash key mismatch: #{r2_key}" unless r2_key.end_with?(expected_suffix)

  {
    "assetId" => item.fetch("assetId"),
    "r2Key" => r2_key,
    "localPath" => local_path,
    "bytes" => bytes,
    "sha256" => sha256,
    "contentType" => content_type,
    "cacheControl" => CACHE_CONTROL,
    "runtimeEnabled" => extension != ".avif",
    "remoteUrl" => options[:base_url] ? "#{options[:base_url]}/#{r2_key}" : nil
  }
end.sort_by { |item| item.fetch("r2Key") }

summary = {
  "objectCount" => items.length,
  "assetCount" => items.map { |item| item.fetch("assetId") }.uniq.length,
  "totalBytes" => items.sum { |item| item.fetch("bytes") },
  "avifCount" => items.count { |item| item.fetch("contentType") == "image/avif" },
  "runtimeEnabledCount" => items.count { |item| item.fetch("runtimeEnabled") }
}

expected_summary = {
  "objectCount" => 427,
  "assetCount" => 123,
  "totalBytes" => 113_523_148,
  "avifCount" => 65,
  "runtimeEnabledCount" => 362
}
raise "unexpected R2 Preview summary: #{summary.inspect}" unless summary == expected_summary

manifest = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "sourceManifest" => "assets/manifests/r2-upload-live.json",
  "bucketName" => BUCKET_NAME,
  "publicBaseUrl" => options[:base_url],
  "bucketCreationAuthorized" => options[:authorized],
  "publicAccessAuthorized" => options[:authorized],
  "uploadAuthorized" => options[:authorized],
  "summary" => summary,
  "items" => items
}

OUTPUT_PATH.write("#{JSON.pretty_generate(manifest)}\n")
puts JSON.generate(summary)
