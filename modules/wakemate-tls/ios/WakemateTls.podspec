Pod::Spec.new do |s|
  s.name             = 'WakemateTls'
  s.version          = '0.1.0'
  s.summary          = 'Pinned HTTPS requests for the WakeMATE companion.'
  s.description      = 'Validates a self-signed companion certificate against the SHA-256 fingerprint delivered in its pairing QR code.'
  s.license          = { :type => 'MIT' }
  s.author           = { 'WakeMATE' => 'dev@wakemate.local' }
  s.homepage         = 'https://github.com/B14ckfoot/WakeMate-Mobile'
  s.source           = { :git => 'https://github.com/B14ckfoot/WakeMate-Mobile.git' }
  s.platforms        = { :ios => '15.1' }
  s.swift_version    = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
  s.source_files = '*.swift'
end
