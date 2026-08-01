---
paths:
  - "app.json"
  - "package.json"
  - "plugins/**/*.js"
  - "templates/**/*"
  - "patches/*.patch"
  - "scripts/verify-ios-project.js"
  - "ios/**/*"
  - "android/**/*"
  - "targets/**/*"
  - "modules/wakemate-tls/**/*"
---

# Expo and native projects

- Assume `ios/` and `android/` must survive Expo regeneration. Encode durable configuration in `app.json`, a config plugin, template, or maintained dependency patch; explain any unavoidable generated-file edit.
- Before `expo prebuild --clean`, inspect every plugin, template, patch, target config, and verification script that reconstructs native behavior. Do not erase native work that lacks a regeneration path.
- Preserve pinned dependency versions while corresponding `patches/` files exist; `npm install` must continue to reapply them through `patch-package`.
- Preserve the `WakeMATE.xcworkspace`, shared `WakeMATE` app scheme, `WakeMateWidgets` target, app-group entitlement, bundle IDs, signing semantics, iOS-only restrictions, and physical-device Debug fallback bundle.
- Open/build the CocoaPods workspace rather than the `.xcodeproj`. Run `npm run verify:ios` after iOS generation or native changes.
- Changes to native modules or native dependencies require a new development build; Metro restart alone cannot verify them, and Expo Go cannot exercise certificate pinning.
- Keep iOS and Android module contracts aligned. Guard intentional platform-only features and run the other platform's relevant checks when practical.
