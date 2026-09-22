#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "optparse"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
MANIFEST_ROOT = ROOT.join("assets/manifests")

options = { "prefix" => nil }
OptionParser.new do |opts|
  opts.on("--prefix NAME", "build delivery manifests from optimization-NAME.json") { |name| options["prefix"] = name }
end.parse!(ARGV)

unless options["prefix"]&.match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/)
  warn "valid --prefix is required"
  exit 2
end

prefix = options.fetch("prefix")
optimization_path = MANIFEST_ROOT.join("optimization-#{prefix}.json")
unless optimization_path.file?
  warn "Missing #{optimization_path}"
  exit 1
end

optimization = JSON.parse(optimization_path.read)

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

pages_items = optimization.fetch("images").flat_map do |image|
  source_items = image["source"] && image["source"]["pagesPath"] ? [image["source"]] : []
  output_items = image.fetch("outputs").select { |output| output["pagesPath"] }
  (source_items + output_items).map do |item|
    {
      "assetId" => image.fetch("id"),
      "targetPath" => item.fetch("pagesPath"),
      "localPath" => item.fetch("path"),
      "bytes" => item.fetch("bytes"),
      "sha256" => item.fetch("sha256")
    }
  end
end

duplicate_r2_keys = r2_items.group_by { |item| item.fetch("r2Key") }.select { |_key, rows| rows.length > 1 }.keys
duplicate_pages_paths = pages_items.group_by { |item| item.fetch("targetPath") }.select { |_key, rows| rows.length > 1 }.keys
unless duplicate_r2_keys.empty? && duplicate_pages_paths.empty?
  warn JSON.generate("duplicateR2Keys" => duplicate_r2_keys, "duplicatePagesPaths" => duplicate_pages_paths)
  exit 1
end

MANIFEST_ROOT.join("r2-upload-#{prefix}.json").write(
  JSON.pretty_generate(
    "schemaVersion" => 1,
    "generatedAt" => Time.now.utc.iso8601,
    "uploadAuthorized" => false,
    "items" => r2_items
  ) + "\n"
)

MANIFEST_ROOT.join("pages-assets-#{prefix}.json").write(
  JSON.pretty_generate(
    "schemaVersion" => 1,
    "generatedAt" => Time.now.utc.iso8601,
    "copyAuthorized" => false,
    "items" => pages_items
  ) + "\n"
)

puts JSON.generate(
  "r2Items" => r2_items.length,
  "r2Assets" => r2_items.map { |item| item.fetch("assetId") }.uniq.length,
  "pagesItems" => pages_items.length,
  "pagesAssets" => pages_items.map { |item| item.fetch("assetId") }.uniq.length
)
