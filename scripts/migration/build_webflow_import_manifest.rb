#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
IMPORT_ROOT = ROOT.join("imports/webflow")
MANIFEST_ROOT = IMPORT_ROOT.join("manifests")
OUTPUT = MANIFEST_ROOT.join("site-import.json")

PAGES = [
  ["/", "https://www.invillage.com.tw/", "site/html/index.html", 200],
  ["/about", "https://www.invillage.com.tw/about", "site/html/about.html", 200],
  ["/spaces", "https://www.invillage.com.tw/spaces", "site/html/spaces.html", 200],
  ["/plan", "https://www.invillage.com.tw/plan", "site/html/plan.html", 200],
  ["/contact", "https://www.invillage.com.tw/contact", "site/html/contact.html", 200],
  ["/style", "https://www.invillage.com.tw/style", "site/html/style.html", 200],
  ["/utilities", "https://www.invillage.com.tw/utilities", "site/html/utilities.html", 200],
  ["/404", "https://www.invillage.com.tw/404", "site/html/404.html", 200]
].freeze

STYLESHEETS = [
  [
    "https://cdn.prod.website-files.com/65009115380adfba3ebe2328/css/invillage.webflow.shared.6118f57c7.css",
    "site/css/invillage.webflow.shared.6118f57c7.css"
  ]
].freeze

SCRIPTS = [
  ["https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js", "site/js/webfont-1.6.26.js"],
  ["https://d3e54v103j8qbb.cloudfront.net/js/jquery-3.5.1.min.dc5e7f18c8.js?site=65009115380adfba3ebe2328", "site/js/jquery-3.5.1.min.dc5e7f18c8.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.04209413.09e2a31cc0de30ab.js", "site/js/webflow.04209413.09e2a31cc0de30ab.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.3eaf6527.387b39e31eb7d998.js", "site/js/webflow.3eaf6527.387b39e31eb7d998.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.9b6600f9.0151bffb6bd32baf.js", "site/js/webflow.9b6600f9.0151bffb6bd32baf.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.a9ba356d.d790faab5eca85f2.js", "site/js/webflow.a9ba356d.d790faab5eca85f2.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.ac711976.a8dab422d5c0d913.js", "site/js/webflow.ac711976.a8dab422d5c0d913.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.b62fa01c.b8ad0259481eb87e.js", "site/js/webflow.b62fa01c.b8ad0259481eb87e.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.schunk.35fcb6791d07f828.js", "site/js/webflow.schunk.35fcb6791d07f828.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.schunk.36b8fb49256177c8.js", "site/js/webflow.schunk.36b8fb49256177c8.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.schunk.61b534daaaeddbc7.js", "site/js/webflow.schunk.61b534daaaeddbc7.js"],
  ["https://cdn.prod.website-files.com/65009115380adfba3ebe2328/js/webflow.schunk.c2cf5e5a504fdc54.js", "site/js/webflow.schunk.c2cf5e5a504fdc54.js"]
].freeze

def file_record(relative_path)
  path = IMPORT_ROOT.join(relative_path)
  raise "Missing #{path}" unless path.file?

  {
    "localPath" => path.relative_path_from(ROOT).to_s,
    "bytes" => path.size,
    "sha256" => Digest::SHA256.file(path).hexdigest
  }
end

asset_manifest_path = MANIFEST_ROOT.join("webflow-assets.json")
image_inventory_path = MANIFEST_ROOT.join("image-inventory.json")
image_verification_path = MANIFEST_ROOT.join("download-verification.json")

[asset_manifest_path, image_inventory_path, image_verification_path].each do |path|
  raise "Missing #{path}" unless path.file?
end

asset_manifest = JSON.parse(asset_manifest_path.read)
image_inventory = JSON.parse(image_inventory_path.read)
image_verification = JSON.parse(image_verification_path.read)

pages = PAGES.map do |route, source_url, local_path, status|
  file_record(local_path).merge(
    "route" => route,
    "sourceUrl" => source_url,
    "httpStatus" => status
  )
end

stylesheets = STYLESHEETS.map do |source_url, local_path|
  file_record(local_path).merge("sourceUrl" => source_url)
end

scripts = SCRIPTS.map do |source_url, local_path|
  file_record(local_path).merge("sourceUrl" => source_url)
end

fonts = asset_manifest.fetch("assets")
  .select { |asset| asset["contentType"] == "application/x-font-ttf" }
  .map do |asset|
    local_path = "assets/fonts/#{asset.fetch("id")}.ttf"
    record = file_record(local_path)
    raise "Font size mismatch for #{asset.fetch("id")}" unless record["bytes"] == asset.fetch("size")

    record.merge(
      "id" => asset.fetch("id"),
      "displayName" => asset["displayName"],
      "sourceUrl" => asset["hostedUrl"],
      "downloadUrl" => "https://cdn.prod.website-files.com/65009115380adfba3ebe2328/#{asset.fetch("originalFileName")}",
      "contentType" => asset["contentType"]
    )
  end

html = PAGES.map { |_route, _url, path, _status| IMPORT_ROOT.join(path).read }.join("\n")
external_integrations = []
external_integrations << "facebook-customer-chat" if html.include?("connect.facebook.net/zh_TW/sdk/xfbml.customerchat.js")
external_integrations << "google-maps-embed" if html.include?("www.google.com/maps/embed")
external_integrations << "youtube-nocookie-embed" if html.include?("www.youtube-nocookie.com/embed")

payload = {
  "schemaVersion" => 1,
  "generatedAt" => Time.now.utc.iso8601,
  "sourceSiteId" => asset_manifest.fetch("siteId"),
  "sourceDomain" => "https://www.invillage.com.tw",
  "pages" => pages,
  "stylesheets" => stylesheets,
  "scripts" => scripts,
  "auxiliaryFiles" => [
    file_record("site/robots.txt").merge(
      "sourceUrl" => "https://www.invillage.com.tw/robots.txt",
      "httpStatus" => 200
    )
  ],
  "fonts" => fonts,
  "images" => {
    "manifestPath" => image_inventory_path.relative_path_from(ROOT).to_s,
    "verificationPath" => image_verification_path.relative_path_from(ROOT).to_s,
    "assetCount" => image_inventory.dig("summary", "imageAssets"),
    "sourceBytes" => image_inventory.dig("summary", "imageSourceBytes"),
    "verifiedFiles" => image_verification.dig("summary", "sizeMatchedFiles"),
    "verificationFailures" => image_verification.dig("summary", "failureCount")
  },
  "httpObservations" => {
    "robotsTxt" => { "status" => 200, "bytes" => IMPORT_ROOT.join("site/robots.txt").size },
    "sitemapXml" => { "status" => 404 },
    "unknownRoute" => { "status" => 404 },
    "direct404Page" => { "status" => 200 }
  },
  "externalIntegrations" => external_integrations.sort,
  "cmsCollections" => 0
}

OUTPUT.write(JSON.pretty_generate(payload) + "\n")
puts JSON.generate(
  "pages" => pages.length,
  "stylesheets" => stylesheets.length,
  "scripts" => scripts.length,
  "auxiliaryFiles" => payload.fetch("auxiliaryFiles").length,
  "fonts" => fonts.length,
  "images" => payload.dig("images", "assetCount"),
  "externalIntegrations" => external_integrations.length
)
