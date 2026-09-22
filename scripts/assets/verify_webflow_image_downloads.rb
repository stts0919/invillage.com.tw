#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "pathname"
require "time"

ROOT = Pathname.new(__dir__).join("../..").expand_path
INVENTORY = ROOT.join("imports/webflow/manifests/image-inventory.json")
OUTPUT = ROOT.join("imports/webflow/manifests/download-verification.json")

unless INVENTORY.file?
  warn "Missing #{INVENTORY}"
  exit 1
end

images = JSON.parse(INVENTORY.read).fetch("images")
checks = images.map do |image|
  relative_path = image.fetch("localOriginal")
  path = ROOT.join(relative_path)
  exists = path.file?
  actual_bytes = exists ? path.size : nil
  expected_bytes = image.fetch("sourceBytes")

  {
    "id" => image.fetch("id"),
    "path" => relative_path,
    "exists" => exists,
    "expectedBytes" => expected_bytes,
    "actualBytes" => actual_bytes,
    "sizeMatches" => exists && actual_bytes == expected_bytes,
    "sha256" => exists ? Digest::SHA256.file(path).hexdigest : nil
  }
end

failures = checks.reject { |check| check["exists"] && check["sizeMatches"] }
payload = {
  "schemaVersion" => 1,
  "verifiedAt" => Time.now.utc.iso8601,
  "sourceInventory" => INVENTORY.relative_path_from(ROOT).to_s,
  "summary" => {
    "expectedFiles" => checks.length,
    "presentFiles" => checks.count { |check| check["exists"] },
    "sizeMatchedFiles" => checks.count { |check| check["sizeMatches"] },
    "expectedBytes" => checks.sum { |check| check["expectedBytes"] || 0 },
    "actualBytes" => checks.sum { |check| check["actualBytes"] || 0 },
    "failureCount" => failures.length
  },
  "failures" => failures,
  "files" => checks
}

OUTPUT.write(JSON.pretty_generate(payload) + "\n")
puts JSON.generate(payload.fetch("summary"))
exit(failures.empty? ? 0 : 1)
