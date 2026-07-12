require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'StaticServer'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Facet'
  s.homepage       = 'https://github.com/anthropics/facet'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.source_files   = '**/*.{h,m,swift}'

  s.dependency 'ExpoModulesCore'
  s.dependency 'GCDWebServer', '~> 3.5'
end
