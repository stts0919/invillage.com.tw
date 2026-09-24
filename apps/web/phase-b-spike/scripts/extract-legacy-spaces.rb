#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "nokogiri"
require "pathname"

root = Pathname.new(__dir__).join("../../../..").expand_path
source = root.join("apps/web/public/spaces.html")
output = Pathname.new(__dir__).join("../reference/spaces-content.json").expand_path
document = Nokogiri::HTML(source.read)
preview_media_prefix = "https://pub-a73a77b87d504498bad6ae568754e572.r2.dev/media/content/"

visible_text = lambda do |element|
  element.text.gsub(/[[:space:]]+/, " ").strip
end

visible_multiline_text = lambda do |element|
  copy = element.dup
  copy.css("br").each { |line_break| line_break.replace(Nokogiri::XML::Text.new("\n", copy.document)) }
  copy.text.split("\n").map { |line| line.gsub(/[[:space:]]+/, " ").strip }.reject(&:empty?).join("\n")
end

groups = document.css(".w-tabs").each_with_index.map do |tabs, group_index|
  links = tabs.css(".w-tab-menu > .w-tab-link")
  panes = tabs.css(".w-tab-content > .w-tab-pane")
  items = links.each_with_index.map do |link, index|
    pane = panes.find { |candidate| candidate["data-w-tab"] == link["data-w-tab"] }
    raise "missing tab panel #{group_index}:#{index}" unless pane

    image_url = pane.at_css("img")&.[]("src")
    raise "unexpected image origin #{group_index}:#{index}" unless image_url&.start_with?(preview_media_prefix)

    paragraphs = pane.css("p").map { |paragraph| visible_multiline_text.call(paragraph) }.reject(&:empty?)
    raise "missing description #{group_index}:#{index}" if paragraphs.empty?

    panel_heading = pane.at_css("h2")
    raise "missing panel heading #{group_index}:#{index}" unless panel_heading

    {
      "id" => "#{group_index.zero? ? 'room' : 'space'}-#{index + 1}",
      "label" => visible_text.call(link),
      "panelHeading" => visible_text.call(panel_heading),
      "description" => paragraphs.join("\n"),
      "imageUrl" => image_url,
      "sourceTab" => link["data-w-tab"]
    }
  end
  { "kind" => group_index.zero? ? "rooms" : "shared-spaces", "items" => items }
end

raise "expected two tab groups" unless groups.length == 2
raise "expected six rooms and ten shared spaces" unless groups.map { |group| group.fetch("items").length } == [6, 10]

outside_paragraphs = document.css("body p").reject { |paragraph| paragraph.ancestors(".w-tab-pane").any? }
  .map { |paragraph| visible_text.call(paragraph) }.reject(&:empty?)

data = {
  "schemaVersion" => 1,
  "sourcePath" => "apps/web/public/spaces.html",
  "sourceSha256" => Digest::SHA256.file(source).hexdigest,
  "intro" => outside_paragraphs.fetch(0),
  "closing" => outside_paragraphs.fetch(1),
  "groups" => groups
}

content = JSON.pretty_generate(data) + "\n"
refresh = ARGV == ["--refresh"]
abort "usage: #{$PROGRAM_NAME} [--refresh]" unless ARGV.empty? || refresh
if output.file? && output.read != content && !refresh
  abort "existing output differs; review before replacing #{output}"
end
output.write(content) if refresh || !output.file?
puts JSON.generate({ "output" => output.basename.to_s, "groups" => groups.map { |group| group.fetch("items").length }, "sha256" => Digest::SHA256.hexdigest(content) })
