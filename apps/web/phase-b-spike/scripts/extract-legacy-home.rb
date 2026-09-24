#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "nokogiri"
require "pathname"

root = Pathname.new(__dir__).join("../../../..").expand_path
source = root.join("apps/web/public/index.html")
output = Pathname.new(__dir__).join("../reference/home-content.json").expand_path
document = Nokogiri::HTML(source.read)

visible_text = lambda do |element|
  element.text.gsub(/[[:space:]]+/, " ").strip
end

groups = []
document.css("body > section").each do |section|
  next unless section.at_css("h2")

  current_group = nil
  current_item = nil
  section.css("h2,h3,h4,p").each do |element|
    value = visible_text.call(element)
    next if value.empty?

    case element.name
    when "h2"
      current_group = { "heading" => value, "intro" => [], "items" => [] }
      groups << current_group
      current_item = nil
    when "h3", "h4"
      next unless current_group

      current_item = { "heading" => value, "paragraphs" => [] }
      current_group.fetch("items") << current_item
    when "p"
      next unless current_group

      (current_item ? current_item.fetch("paragraphs") : current_group.fetch("intro")) << value
    end
  end
end

headings = groups.map { |group| group.fetch("heading") }
expected = ["空間特色", "客房特色", "智慧莊園特點", "交通與周邊", "預訂紅河隱園 一日莊園主人"]
raise "home section headings changed: #{headings.inspect}" unless headings == expected

data = {
  "schemaVersion" => 1,
  "sourcePath" => "apps/web/public/index.html",
  "sourceSha256" => Digest::SHA256.file(source).hexdigest,
  "groups" => groups
}
content = JSON.pretty_generate(data) + "\n"
if output.file? && output.read != content
  abort "existing output differs; review before replacing #{output}"
end
output.write(content) unless output.file?
puts JSON.generate({ "output" => output.basename.to_s, "groups" => headings, "sha256" => Digest::SHA256.hexdigest(content) })
