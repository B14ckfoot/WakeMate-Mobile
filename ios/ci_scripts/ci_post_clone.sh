#!/bin/zsh
set -e
set -o pipefail

# Xcode Cloud runs this after cloning the repo and before resolving/building.
# The stock image has no Node.js, so `npm ci` (needed by the Podfile's
# Expo/React Native autolinking) and `pod install` (needed to generate
# Pods-WakeMATE.release.xcconfig) both have to be set up here.

echo "Installing Node.js"
brew install node

echo "Installing npm dependencies"
cd "$CI_WORKSPACE"
npm ci

echo "Installing CocoaPods dependencies"
cd "$CI_WORKSPACE/ios"
pod install
