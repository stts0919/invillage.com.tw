#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "pathname"

ROOT = Pathname.new(__dir__).join("../..").expand_path
MANIFEST = ROOT.join("imports/webflow/manifests/site-import.json")
ASSETS = ROOT.join("imports/webflow/manifests/webflow-assets.json")

unless MANIFEST.file? && ASSETS.file?
  warn "Missing import manifests"
  exit 1
end

manifest = JSON.parse(MANIFEST.read)
assets = JSON.parse(ASSETS.read)
records = manifest.fetch("pages") +
          manifest.fetch("stylesheets") +
          manifest.fetch("scripts") +
          manifest.fetch("auxiliaryFiles", []) +
          manifest.fetch("fonts")

failures = []
records.each do |record|
  path = ROOT.join(record.fetch("localPath"))
  unless path.file?
    failures << "#{record.fetch("localPath")}: missing"
    next
  end

  failures << "#{record.fetch("localPath")}: size mismatch" unless path.size == record.fetch("bytes")
  failures << "#{record.fetch("localPath")}: sha256 mismatch" unless Digest::SHA256.file(path).hexdigest == record.fetch("sha256")
end

image_files = Dir[ROOT.join("imports/webflow/assets/images/*").to_s].select { |path| File.file?(path) }
font_files = Dir[ROOT.join("imports/webflow/assets/fonts/*").to_s].select { |path| File.file?(path) }
asset_images = assets.fetch("assets").count { |asset| asset.fetch("contentType", "").start_with?("image/") }
asset_fonts = assets.fetch("assets").count { |asset| asset["contentType"] == "application/x-font-ttf" }

failures << "asset manifest total mismatch" unless assets.fetch("assetCount") == 217
failures << "image file count mismatch" unless image_files.length == asset_images
failures << "font file count mismatch" unless font_files.length == asset_fonts
failures << "image verification failures" unless manifest.dig("images", "verificationFailures") == 0

summary = {
  "pages" => manifest.fetch("pages").length,
  "stylesheets" => manifest.fetch("stylesheets").length,
  "scripts" => manifest.fetch("scripts").length,
  "images" => image_files.length,
  "fonts" => font_files.length,
  "verifiedFileRecords" => records.length,
  "failures" => failures.length
}

puts JSON.generate(summary)
warn failures.join("\n") unless failures.empty?
exit(failures.empty? ? 0 : 1)
