# Ruby's Psych (the YAML reader of Jekyll), only where a Ruby is installed. Run: ruby ruby-yaml.rb
require 'yaml'
require 'date'
require 'json'

puts "ruby #{RUBY_VERSION}, Psych #{Psych::VERSION}"
cases = JSON.parse(File.read(File.join(__dir__, 'yaml-cases.json')))['scalars']
cases.each do |s|
  begin
    v = YAML.safe_load("v: #{s}", [Date, Time])['v']
    puts format('%-34s %s %s', s.inspect, v.class, v.inspect)
  rescue StandardError => e
    puts format('%-34s ERROR %s %s', s.inspect, e.class, e.message[0, 50])
  end
end
