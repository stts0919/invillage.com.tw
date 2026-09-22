#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "pathname"
require "set"

ROOT = Pathname.new(__dir__).join("../..").expand_path
MANIFEST_PATH = ROOT.join("assets/manifests/runtime-occurrences.json")
CLASSIFICATION_PATH = ROOT.join("assets/manifests/asset-classification.json")

TOP_LEVEL_KEYS = %w[
  assets
  externalAssets
  generatedAt
  schemaVersion
  sourceFiles
  summary
  unmappedUrls
].freeze
ASSET_KEYS = %w[assetId category occurrences placement].freeze
OCCURRENCE_KEYS = %w[attribute context descriptor originalUrl sourcePath].freeze
EXTERNAL_KEYS = %w[classification context expectedAction originalUrl sourcePath].freeze
CONTEXTS = %w[html-attribute html-srcset css-url json-ld].freeze
EXTERNAL_CLASSIFICATIONS = %w[generic-pages allowed-third-party forbidden-webflow unknown].freeze
EXTERNAL_ACTIONS = %w[localize-pages preserve-allowlist reject-network-dependency manual-review].freeze
SOURCE_PATTERN = %r{\Aimports/webflow/site/(?:html|css)/}
URL_PATTERN = %r{https://[^"'\s<>(),]+}

manifest = JSON.parse(MANIFEST_PATH.read)
classification = JSON.parse(CLASSIFICATION_PATH.read)
classified_assets = classification.fetch("images").to_h { |image| [image.fetch("id"), image] }

failures = []
failure_categories = Hash.new(0)
add_failure = lambda do |category, message|
  failure_categories[category] += 1
  failures << "#{category}: #{message}" if failures.length < 100
end

actual_top_keys = manifest.keys.sort
add_failure.call("top-level-keys", actual_top_keys.inspect) unless actual_top_keys == TOP_LEVEL_KEYS.sort
add_failure.call("schema-version", manifest["schemaVersion"].inspect) unless manifest["schemaVersion"] == 1

source_files = manifest["sourceFiles"]
unless source_files.is_a?(Array) && source_files.length == 9 && source_files.uniq.length == 9
  add_failure.call("source-files", "expected 9 unique files")
  source_files = [] unless source_files.is_a?(Array)
end
source_files.each do |relative_path|
  unless relative_path.is_a?(String) && relative_path.match?(SOURCE_PATTERN) && ROOT.join(relative_path).file?
    add_failure.call("source-file", relative_path.inspect)
  end
end
source_file_set = source_files.to_set

assets = manifest["assets"]
unless assets.is_a?(Array)
  add_failure.call("assets", "must be an array")
  assets = []
end
asset_ids = assets.each_with_object([]) do |asset, ids|
  ids << asset["assetId"] if asset.is_a?(Hash) && asset["assetId"]
end
add_failure.call("asset-count", asset_ids.length.to_s) unless asset_ids.length == 139
add_failure.call("asset-uniqueness", asset_ids.uniq.length.to_s) unless asset_ids.uniq.length == 139

reported_occurrence_pairs = Hash.new(0)
assets.each_with_index do |asset, asset_index|
  unless asset.is_a?(Hash)
    add_failure.call("asset-row", asset_index.to_s)
    next
  end

  add_failure.call("asset-keys", "row #{asset_index}") unless asset.keys.sort == ASSET_KEYS.sort
  asset_id = asset["assetId"]
  classified = classified_assets[asset_id]
  unless asset_id.is_a?(String) && asset_id.match?(/\A[0-9a-f]{24}\z/) && classified
    add_failure.call("asset-id", "row #{asset_index}: #{asset_id.inspect}")
    next
  end
  add_failure.call("placement", asset_id) unless asset["placement"] == classified.fetch("placement")
  add_failure.call("category", asset_id) unless asset["category"] == classified.fetch("category")

  occurrences = asset["occurrences"]
  unless occurrences.is_a?(Array) && !occurrences.empty?
    add_failure.call("occurrences", asset_id)
    next
  end

  occurrences.each_with_index do |occurrence, occurrence_index|
    unless occurrence.is_a?(Hash)
      add_failure.call("occurrence-row", "#{asset_id}:#{occurrence_index}")
      next
    end
    add_failure.call("occurrence-keys", "#{asset_id}:#{occurrence_index}") unless occurrence.keys.sort == OCCURRENCE_KEYS.sort
    source_path = occurrence["sourcePath"]
    context = occurrence["context"]
    attribute = occurrence["attribute"]
    original_url = occurrence["originalUrl"]
    descriptor = occurrence["descriptor"]

    add_failure.call("occurrence-source", "#{asset_id}:#{occurrence_index}") unless source_file_set.include?(source_path)
    add_failure.call("occurrence-context", "#{asset_id}:#{occurrence_index}: #{context.inspect}") unless CONTEXTS.include?(context)
    add_failure.call("occurrence-attribute", "#{asset_id}:#{occurrence_index}") unless attribute.is_a?(String) && !attribute.empty?
    unless original_url.is_a?(String) && original_url.start_with?("https://") && original_url.include?(asset_id)
      add_failure.call("occurrence-url", "#{asset_id}:#{occurrence_index}")
    end
    add_failure.call("occurrence-descriptor", "#{asset_id}:#{occurrence_index}") unless descriptor.nil? || descriptor.is_a?(String)
    if source_path.is_a?(String) && original_url.is_a?(String)
      reported_occurrence_pairs[[source_path, original_url]] += 1
    end
  end
end

actual_occurrence_pairs = Hash.new(0)
source_files.each do |relative_path|
  ROOT.join(relative_path).read.scan(URL_PATTERN).each do |url|
    asset_id = url.scan(/[0-9a-f]{24}/).last
    next unless asset_id && classified_assets.key?(asset_id)

    actual_occurrence_pairs[[relative_path, url]] += 1
  end
end

(actual_occurrence_pairs.keys | reported_occurrence_pairs.keys).each do |pair|
  expected = actual_occurrence_pairs[pair]
  reported = reported_occurrence_pairs[pair]
  next if expected == reported

  add_failure.call("occurrence-coverage", "#{pair.first}: #{pair.last} expected=#{expected} reported=#{reported}")
end

external_assets = manifest["externalAssets"]
unless external_assets.is_a?(Array)
  add_failure.call("external-assets", "must be an array")
  external_assets = []
end
external_assets.each_with_index do |item, index|
  unless item.is_a?(Hash)
    add_failure.call("external-row", index.to_s)
    next
  end
  add_failure.call("external-keys", index.to_s) unless item.keys.sort == EXTERNAL_KEYS.sort
  add_failure.call("external-source", index.to_s) unless source_file_set.include?(item["sourcePath"])
  add_failure.call("external-context", index.to_s) unless item["context"].is_a?(String) && !item["context"].empty?
  add_failure.call("external-url", index.to_s) unless item["originalUrl"].is_a?(String) && item["originalUrl"].start_with?("https://")
  add_failure.call("external-classification", "#{index}: #{item['classification'].inspect}") unless EXTERNAL_CLASSIFICATIONS.include?(item["classification"])
  add_failure.call("external-action", "#{index}: #{item['expectedAction'].inspect}") unless EXTERNAL_ACTIONS.include?(item["expectedAction"])
end

unmapped_urls = manifest["unmappedUrls"]
add_failure.call("unmapped-urls", unmapped_urls.inspect) unless unmapped_urls == []

summary = manifest["summary"]
unless summary.is_a?(Hash)
  add_failure.call("summary", "must be an object")
  summary = {}
end
actual_summary = {
  "totalOccurrences" => assets.sum { |asset| asset.is_a?(Hash) && asset["occurrences"].is_a?(Array) ? asset["occurrences"].length : 0 },
  "uniqueAssetCount" => asset_ids.uniq.length,
  "pagesAssetCount" => assets.count { |asset| asset.is_a?(Hash) && asset["placement"] == "pages" },
  "r2AssetCount" => assets.count { |asset| asset.is_a?(Hash) && asset["placement"] == "r2" },
  "genericExternalCount" => external_assets.length,
  "unmappedCount" => unmapped_urls.is_a?(Array) ? unmapped_urls.length : -1
}
add_failure.call("summary-values", "expected #{actual_summary.inspect}, got #{summary.inspect}") unless summary == actual_summary

result = {
  "manifest" => MANIFEST_PATH.relative_path_from(ROOT).to_s,
  "assetRows" => assets.length,
  "reportedOccurrences" => reported_occurrence_pairs.values.sum,
  "sourceOccurrences" => actual_occurrence_pairs.values.sum,
  "externalRows" => external_assets.length,
  "failureCount" => failure_categories.values.sum,
  "failureCategories" => failure_categories.sort.to_h,
  "failures" => failures
}

puts JSON.pretty_generate(result)
exit(result.fetch("failureCount").zero? ? 0 : 1)
