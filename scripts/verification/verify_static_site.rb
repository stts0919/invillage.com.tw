#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "optparse"
require "pathname"
require "uri"

ROOT = Pathname.new(__dir__).join("../..").expand_path
EXPECTED_HTML = %w[
  404.html
  about.html
  contact.html
  index.html
  plan.html
  spaces.html
  style.html
  utilities.html
].freeze
FORBIDDEN_NETWORK_HOSTS = [
  "cdn.prod.website-files.com",
  "d3e54v103j8qbb.cloudfront.net",
  "ajax.googleapis.com",
  "webflow.com/api/"
].freeze

options = {
  output_root: "apps/web/public",
  media_base_url: nil
}

OptionParser.new do |parser|
  parser.on("--output-root PATH", "Static output directory") { |path| options[:output_root] = path }
  parser.on("--media-base-url URL", "Expected Preview media origin") { |url| options[:media_base_url] = url }
end.parse!

raise "--media-base-url is required" unless options[:media_base_url]
media_uri = URI.parse(options[:media_base_url])
unless media_uri.is_a?(URI::HTTPS) && media_uri.host && media_uri.path.to_s.gsub("/", "").empty?
  raise "media base URL must be an HTTPS origin without a path"
end
media_base_url = options[:media_base_url].delete_suffix("/")

output_root = Pathname.new(options[:output_root]).expand_path(ROOT)
raise "output root does not exist: #{output_root}" unless output_root.directory?

pages_runtime = JSON.parse(ROOT.join("assets/manifests/pages-runtime-assets.json").read)
r2_preview = JSON.parse(ROOT.join("assets/manifests/r2-upload-preview.json").read)
site_import = JSON.parse(ROOT.join("imports/webflow/manifests/site-import.json").read)

failures = []
html_files = Dir[output_root.join("*.html")].map { |path| File.basename(path) }.sort
failures << "HTML set mismatch: #{html_files.inspect}" unless html_files == EXPECTED_HTML
failures << "stylesheet count mismatch" unless Dir[output_root.join("css/*.css")].length == 1
failures << "script count mismatch" unless Dir[output_root.join("js/*.js")].length == 12
failures << "robots.txt missing" unless output_root.join("robots.txt").file?

pages_runtime.fetch("items").each do |item|
  relative_target = item.fetch("targetPath").delete_prefix("apps/web/public/")
  target = output_root.join(relative_target)
  unless target.file?
    failures << "missing Pages runtime asset: #{relative_target}"
    next
  end
  failures << "bytes mismatch: #{relative_target}" unless target.size == item.fetch("bytes")
  failures << "sha256 mismatch: #{relative_target}" unless Digest::SHA256.file(target).hexdigest == item.fetch("sha256")
end

site_import.fetch("scripts").each do |script|
  target = output_root.join("js", File.basename(script.fetch("localPath")))
  unless target.file?
    failures << "missing script: #{target.basename}"
    next
  end
  failures << "script bytes mismatch: #{target.basename}" unless target.size == script.fetch("bytes")
  failures << "script sha256 mismatch: #{target.basename}" unless Digest::SHA256.file(target).hexdigest == script.fetch("sha256")
end

scannable_paths = Dir[output_root.join("**/*.{html,css}")].sort
scannable_text = scannable_paths.map { |path| File.read(path) }.join("\n")

FORBIDDEN_NETWORK_HOSTS.each do |host|
  failures << "forbidden network dependency remains: #{host}" if scannable_text.include?(host)
end
failures << "unresolved media placeholder" if scannable_text.include?("PREVIEW_MEDIA_BASE_URL")
failures << "contact form guard missing" unless output_root.join("contact.html").read.scan("data-invillage-form-guard").length == 1

pages_runtime.fetch("items").each do |item|
  public_url = "/#{item.fetch('targetPath').delete_prefix('apps/web/public/')}"
  failures << "unreferenced Pages runtime asset: #{public_url}" unless scannable_text.include?(public_url)
end

local_references = []
scannable_paths.each do |path|
  contents = File.read(path)
  contents.scan(/(?:src|href)="(\/(?:assets|css|js)\/[^"?#]+)[^\"]*"/) do |match|
    local_references << [path, match.first]
  end
  contents.scan(/url\(["']?(\/(?:assets|css|js)\/[^"')?#]+)[^)]*\)/) do |match|
    local_references << [path, match.first]
  end
end
local_references.each do |source_path, public_url|
  target = output_root.join(public_url.delete_prefix("/"))
  failures << "broken local reference in #{source_path}: #{public_url}" unless target.file?
end

r2_items_by_key = r2_preview.fetch("items").to_h { |item| [item.fetch("r2Key"), item] }
media_pattern = %r{#{Regexp.escape(media_base_url)}/(media/content/[0-9a-zA-Z._/-]+)}
referenced_keys = scannable_text.scan(media_pattern).flatten.uniq.sort

unknown_keys = referenced_keys.reject { |key| r2_items_by_key.key?(key) }
failures.concat(unknown_keys.map { |key| "unknown R2 key: #{key}" })

disabled_keys = referenced_keys.select do |key|
  item = r2_items_by_key[key]
  item && !item.fetch("runtimeEnabled")
end
failures.concat(disabled_keys.map { |key| "disabled AVIF referenced before parity approval: #{key}" })

referenced_asset_ids = referenced_keys.each_with_object([]) do |key, asset_ids|
  item = r2_items_by_key[key]
  asset_ids << item.fetch("assetId") if item
end.uniq
failures << "R2 asset coverage mismatch: #{referenced_asset_ids.length}" unless referenced_asset_ids.length == 123

summary = {
  "outputRoot" => output_root.to_s,
  "htmlFiles" => html_files.length,
  "stylesheets" => Dir[output_root.join("css/*.css")].length,
  "scripts" => Dir[output_root.join("js/*.js")].length,
  "pagesRuntimeAssets" => pages_runtime.fetch("items").length,
  "localReferences" => local_references.length,
  "referencedR2Keys" => referenced_keys.length,
  "referencedR2Assets" => referenced_asset_ids.length,
  "failures" => failures
}

puts JSON.pretty_generate(summary)
exit(failures.empty? ? 0 : 1)
