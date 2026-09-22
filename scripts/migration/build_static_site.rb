#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "optparse"
require "pathname"
require "uri"

ROOT = Pathname.new(__dir__).join("../..").expand_path
PUBLIC_PREFIX = "apps/web/public/"
WEBFLOW_ASSET_URL = %r{https://(?:cdn\.prod\.website-files\.com|s3\.amazonaws\.com/webflow-prod-assets)/[^"'()\s<>]+}
FORBIDDEN_NETWORK_HOSTS = [
  "cdn.prod.website-files.com",
  "d3e54v103j8qbb.cloudfront.net",
  "ajax.googleapis.com",
  "webflow.com/api/"
].freeze

FORM_GUARD = <<~HTML.strip
  <script data-invillage-form-guard>document.addEventListener("submit",function(event){var form=event.target;if(!form||form.id!=="wf-form-Email-Form")return;event.preventDefault();event.stopImmediatePropagation();var wrapper=form.closest(".w-form");if(!wrapper)return;var done=wrapper.querySelector(".w-form-done");var fail=wrapper.querySelector(".w-form-fail");if(done)done.style.display="none";if(fail)fail.style.display="block"},true);</script>
HTML

options = {
  output_root: "apps/web/public",
  media_base_url: nil
}

OptionParser.new do |parser|
  parser.on("--output-root PATH", "Empty output directory; defaults to apps/web/public") do |path|
    options[:output_root] = path
  end
  parser.on("--media-base-url URL", "Required HTTPS origin for Preview R2") do |url|
    options[:media_base_url] = url
  end
end.parse!

raise "--media-base-url is required" unless options[:media_base_url]

media_uri = URI.parse(options[:media_base_url])
unless media_uri.is_a?(URI::HTTPS) && media_uri.host && media_uri.path.to_s.gsub("/", "").empty?
  raise "media base URL must be an HTTPS origin without a path"
end
media_base_url = options[:media_base_url].delete_suffix("/")

output_root = Pathname.new(options[:output_root]).expand_path(ROOT)
forbidden_outputs = [Pathname.new("/"), ROOT, Pathname.new(Dir.home).expand_path]
raise "unsafe output root: #{output_root}" if forbidden_outputs.include?(output_root)
raise "output root must not be a symlink: #{output_root}" if output_root.symlink?
if output_root.exist?
  populated_entries = Dir.glob(output_root.join("**/*"), File::FNM_DOTMATCH).reject do |path|
    %w[. ..].include?(File.basename(path)) || File.lstat(path).directory?
  end
  unless populated_entries.empty?
    raise "output root must be absent or contain only empty directories: #{output_root}"
  end
  FileUtils.rm_rf(output_root)
end
output_root.mkpath

def read_json(relative_path)
  JSON.parse(ROOT.join(relative_path).read)
end

def verify_source(record)
  relative_path = record.fetch("localPath")
  absolute_path = ROOT.join(relative_path).cleanpath
  unless absolute_path.to_s.start_with?("#{ROOT}/") && absolute_path.exist?
    raise "missing or out-of-root source: #{relative_path}"
  end
  raise "symlinked source is not allowed: #{relative_path}" if absolute_path.symlink?

  real_path = absolute_path.realpath
  unless real_path == absolute_path && real_path.to_s.start_with?("#{ROOT.realpath}/") && real_path.file?
    raise "non-canonical or out-of-root source: #{relative_path}"
  end

  bytes = real_path.size
  sha256 = Digest::SHA256.file(real_path).hexdigest
  raise "bytes mismatch: #{relative_path}" if record["bytes"] && bytes != record.fetch("bytes")
  raise "sha256 mismatch: #{relative_path}" if record["sha256"] && sha256 != record.fetch("sha256")
  real_path
end

def public_relative_path(target_path)
  unless target_path.start_with?(PUBLIC_PREFIX)
    raise "target is outside Pages public root: #{target_path}"
  end
  relative_path = Pathname.new(target_path.delete_prefix(PUBLIC_PREFIX))
  if relative_path.absolute? || relative_path.each_filename.any? { |part| part == ".." }
    raise "target escapes Pages public root: #{target_path}"
  end
  normalized = relative_path.cleanpath.to_s
  raise "empty Pages public target: #{target_path}" if normalized == "." || normalized.empty?
  normalized
end

def public_path(target_path)
  "/#{public_relative_path(target_path)}"
end

def asset_id_from_url(url)
  url.scan(/[0-9a-f]{24}/).last
end

site_import = read_json("imports/webflow/manifests/site-import.json")
classification = read_json("assets/manifests/asset-classification.json")
optimization = read_json("assets/manifests/optimization-live.json")
pages_runtime = read_json("assets/manifests/pages-runtime-assets.json")
r2_preview = read_json("assets/manifests/r2-upload-preview.json")

placements = classification.fetch("images").to_h do |image|
  [image.fetch("id"), image.fetch("placement")]
end

page_urls = pages_runtime.fetch("items").each_with_object({}) do |item, urls|
  asset_id = item["assetId"]
  urls[asset_id] = public_path(item.fetch("targetPath")) if asset_id
end

generic_urls = pages_runtime.fetch("items").select { |item| item.fetch("kind") == "vendor" }.to_h do |item|
  [item.fetch("sourceUrl"), public_path(item.fetch("targetPath"))]
end

dimensions_by_path = {}
optimization.fetch("images").each do |image|
  dimensions_by_path[image.fetch("source").fetch("path")] = image.fetch("source").fetch("dimensions")
  image.fetch("outputs").each do |output|
    dimensions_by_path[output.fetch("path")] = output.fetch("dimensions")
  end
end

r2_variants = r2_preview.fetch("items").select { |item| item.fetch("runtimeEnabled") }.group_by do |item|
  item.fetch("assetId")
end.transform_values do |items|
  items.map do |item|
    dimensions = dimensions_by_path.fetch(item.fetch("localPath"))
    width = dimensions.fetch("width")
    raise "missing width for #{item.fetch('localPath')}" unless width.is_a?(Integer) && width.positive?

    item.merge(
      "width" => width,
      "url" => "#{media_base_url}/#{item.fetch('r2Key')}"
    )
  end.sort_by { |item| item.fetch("width") }
end

unless r2_variants.length == 123 && r2_variants.values.sum(&:length) == 362
  raise "unexpected runtime R2 variants"
end

default_url = lambda do |asset_id|
  return page_urls.fetch(asset_id) if page_urls.key?(asset_id)

  case placements.fetch(asset_id)
  when "r2"
    r2_variants.fetch(asset_id).last.fetch("url")
  else
    raise "unsupported runtime placement for #{asset_id}: #{placements.fetch(asset_id)}"
  end
end

replace_webflow_asset_urls = lambda do |text|
  text.gsub(WEBFLOW_ASSET_URL) do |url|
    asset_id = asset_id_from_url(url)
    next url unless asset_id && (page_urls.key?(asset_id) || placements.key?(asset_id))

    default_url.call(asset_id)
  end
end

rewrite_img_tags = lambda do |html|
  html.gsub(/<img\b[^>]*>/i) do |tag|
    source_url = tag.scan(WEBFLOW_ASSET_URL).first
    next tag unless source_url

    asset_id = asset_id_from_url(source_url)
    next tag unless asset_id && placements.key?(asset_id)

    rewritten = tag.sub(/\bsrc="[^"]*"/i, "src=\"#{default_url.call(asset_id)}\"")
    if placements.fetch(asset_id) == "r2"
      variants = r2_variants.fetch(asset_id)
      srcset = variants.map { |variant| "#{variant.fetch('url')} #{variant.fetch('width')}w" }.join(", ")
      if rewritten.match?(/\bsrcset="[^"]*"/i)
        rewritten = rewritten.sub(/\bsrcset="[^"]*"/i, "srcset=\"#{srcset}\"")
      elsif variants.length > 1
        rewritten = rewritten.sub(/\s*\/>\z/, " srcset=\"#{srcset}\"/>")
      end
    else
      rewritten = rewritten.gsub(/\s+srcset="[^"]*"/i, "")
    end
    rewritten
  end
end

script_replacements = site_import.fetch("scripts").to_h do |script|
  [script.fetch("sourceUrl"), "/js/#{File.basename(script.fetch('localPath'))}"]
end
stylesheet_replacements = site_import.fetch("stylesheets").to_h do |stylesheet|
  [stylesheet.fetch("sourceUrl"), "/css/#{File.basename(stylesheet.fetch('localPath'))}"]
end

rewrite_html = lambda do |html, basename|
  rewritten = rewrite_img_tags.call(html)
  (script_replacements.merge(stylesheet_replacements).merge(generic_urls)).each do |source_url, target_url|
    rewritten = rewritten.gsub(source_url, target_url)
  end
  rewritten = replace_webflow_asset_urls.call(rewritten)
  rewritten = rewritten.gsub(%r{<link\b[^>]*href="https://cdn\.prod\.website-files\.com"[^>]*?/?>}i, "")
  rewritten = rewritten.gsub(/<(?:link|script)\b[^>]*(?:href|src)="\/(?:css|js)\/[^>]*>/i) do |tag|
    tag.gsub(/\s+integrity="[^"]*"/i, "").gsub(/\s+crossorigin="[^"]*"/i, "")
  end
  if basename == "contact.html"
    raise "contact form guard already present" if rewritten.include?("data-invillage-form-guard")
    rewritten = rewritten.sub("</head>", "#{FORM_GUARD}</head>")
  end
  rewritten
end

rewrite_css = lambda do |css|
  rewritten = css
  generic_urls.each { |source_url, target_url| rewritten = rewritten.gsub(source_url, target_url) }
  replace_webflow_asset_urls.call(rewritten)
end

site_import.fetch("pages").each do |page|
  source_path = verify_source(page)
  basename = File.basename(page.fetch("localPath"))
  output_root.join(basename).write(rewrite_html.call(source_path.read, basename))
end

site_import.fetch("stylesheets").each do |stylesheet|
  source_path = verify_source(stylesheet)
  destination = output_root.join("css", File.basename(stylesheet.fetch("localPath")))
  destination.dirname.mkpath
  destination.write(rewrite_css.call(source_path.read))
end

site_import.fetch("scripts").each do |script|
  source_path = verify_source(script)
  destination = output_root.join("js", File.basename(script.fetch("localPath")))
  destination.dirname.mkpath
  FileUtils.cp(source_path, destination)
end

site_import.fetch("auxiliaryFiles").each do |file_record|
  source_path = verify_source(file_record)
  FileUtils.cp(source_path, output_root.join(File.basename(file_record.fetch("localPath"))))
end

pages_runtime.fetch("items").each do |item|
  source_path = verify_source(item)
  relative_target = public_relative_path(item.fetch("targetPath"))
  destination = output_root.join(relative_target).cleanpath
  unless destination.to_s.start_with?("#{output_root}/")
    raise "destination escapes output root: #{item.fetch('targetPath')}"
  end
  destination.dirname.mkpath
  FileUtils.cp(source_path, destination)
end

scannable_files = Dir[output_root.join("**/*.{html,css}")]
scannable_files.each do |file_path|
  contents = File.read(file_path)
  forbidden = FORBIDDEN_NETWORK_HOSTS.select { |host| contents.include?(host) }
  raise "forbidden network dependency in #{file_path}: #{forbidden.join(', ')}" unless forbidden.empty?
end

summary = {
  "outputRoot" => output_root.to_s,
  "htmlFiles" => Dir[output_root.join("*.html")].length,
  "stylesheets" => Dir[output_root.join("css/*.css")].length,
  "scripts" => Dir[output_root.join("js/*.js")].length,
  "pagesRuntimeAssets" => pages_runtime.fetch("items").length,
  "r2RuntimeAssets" => r2_variants.length,
  "r2RuntimeVariants" => r2_variants.values.sum(&:length),
  "mediaBaseUrl" => media_base_url
}

expected_counts = [8, 1, 12, 24, 123, 362]
actual_counts = summary.values_at(
  "htmlFiles",
  "stylesheets",
  "scripts",
  "pagesRuntimeAssets",
  "r2RuntimeAssets",
  "r2RuntimeVariants"
)
raise "unexpected static output summary: #{summary.inspect}" unless actual_counts == expected_counts

puts JSON.generate(summary)
