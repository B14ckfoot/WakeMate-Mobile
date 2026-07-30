#!/bin/zsh
set -euo pipefail

# Xcode Cloud runs this after cloning the repo and before resolving/building.
# The stock image has no Node.js, so `npm ci` (needed by the Podfile's
# Expo/React Native autolinking) and `pod install` (needed to generate
# Pods-WakeMATE.release.xcconfig) both have to be set up here.

readonly REPOSITORY_PATH="${CI_PRIMARY_REPOSITORY_PATH:?Xcode Cloud did not provide CI_PRIMARY_REPOSITORY_PATH}"

echo "Installing Node.js 22"
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"

echo "Installing npm dependencies"
cd "$REPOSITORY_PATH"
npm ci --no-audit --no-fund

echo "Installing CocoaPods dependencies"
cd "$REPOSITORY_PATH/ios"
pod install
