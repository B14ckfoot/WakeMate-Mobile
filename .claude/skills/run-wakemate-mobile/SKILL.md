---
name: run-wakemate-mobile
description: Build, run, and drive the WakeMATE Expo/React Native app on an iOS simulator. Use when asked to launch the mobile app, screenshot a screen, tap through a flow, deep-link a route, run the Jest tests, typecheck the widget Swift, or verify a change in the real app.
---

WakeMATE Mobile is an Expo/React Native app with native modules (cert-pinning
transport, UDP discovery, camera). Drive it on the **iOS simulator** with
`.claude/skills/run-wakemate-mobile/driver.sh`, which wraps `xcrun simctl`
(lifecycle, screenshots, deep links) and `idb` (accessibility tree, taps,
typing). The driver is stateless — the simulator holds the state, so each
command is its own invocation.

All paths below are relative to `wakemate-mobile/`.

> **Not the web build.** `npx expo start --web` does boot and render, but
> `expo-secure-store` is unavailable there, so every pairing-token path throws
> *"Secure credential storage is unavailable on this device"*. It is not a
> valid surface for testing this app. Use the simulator.

## Prerequisites

Verified on this machine:

```bash
xcodebuild -version   # Xcode 26.4.1 (17E202)
node -v               # v22.22.2
idb --version         # installed at ~/Library/Python/3.12/bin/idb
which idb_companion   # /usr/local/bin/idb_companion
```

`idb` is what makes taps possible — `simctl` alone cannot tap anything. If it
is missing:

```bash
pip3 install --user fb-idb
brew install facebook/fb/idb-companion
```

The driver puts `~/Library/Python/3.12/bin` on `PATH` itself.

## Setup

```bash
npm install
```

## Build

```bash
./.claude/skills/run-wakemate-mobile/driver.sh boot      # boot sim + idb connect
./.claude/skills/run-wakemate-mobile/driver.sh build     # ~16 min cold
./.claude/skills/run-wakemate-mobile/driver.sh install
```

`build` runs, verbatim:

```bash
xcodebuild build -workspace ios/WakeMATE.xcworkspace -scheme WakeMATE \
  -configuration Debug -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath ios/build/DD
```

Ends in `** BUILD SUCCEEDED **`. Output is
`ios/build/DD/Build/Products/Debug-iphonesimulator/WakeMATE.app`, bundle id
`com.anonymous.wakematemobile`.

**Metro must be running before you launch** — this is a Debug build and fetches
its JS bundle at startup:

```bash
npx expo start          # port 8081
```

## Run (agent path)

```bash
D=./.claude/skills/run-wakemate-mobile/driver.sh
$D relaunch                    # terminate + launch; allow ~12s for the bundle
$D shot /tmp/shots/home.png
$D tree                        # what's on screen, with tap coordinates
$D tap "Add a device"
```

`tree` is the one to reach for first — this app has real accessibility labels,
so it doubles as an assertion surface. Verified output on the devices screen:

```
WAKEMATE                                   StaticText     tap 210,79
Your PCs, ready to wake.                   StaticText     tap 210,142
Open settings                              GenericElement tap 346,79
Refresh status                             GenericElement tap 304,336
1 device                                   StaticText     tap 42,336
PIXELPUNISHER, 10.0.0.19, Online           GenericElement tap 195,405
Scan network and auto fill device info     GenericElement tap 102,713
Scan a device QR code                      GenericElement tap 287,713
Add a device                               GenericElement tap 195,774
(12 labelled elements)
```

`tap` matches that label (exact first, then substring) and taps the smallest
matching element. A verified three-screen walk:

```bash
$D tap "PIXELPUNISHER, 10.0.0.19, Online"   # → device detail
$D tap "Control Device"                      # → remote control
```

### Commands

| Command | Effect |
|---|---|
| `boot` | boot an iPhone simulator and attach the idb companion |
| `build` / `install` | xcodebuild Debug, then install the `.app` |
| `launch` / `relaunch` / `stop` | app lifecycle |
| `shot <path>` | PNG via `simctl io`; fails if under 5KB |
| `tree` | accessibility tree: label, type, tap coordinates |
| `tap <label>` | tap by accessibility label |
| `tapxy <x> <y>` | tap raw coordinates (**points**, see Gotchas) |
| `text <string>` | type into the focused field |
| `key <code>` | send a keycode |
| `openurl <url>` | deep link, e.g. `myapp://devices` |
| `grant [service]` | pre-approve privacy prompts (default `all`) |
| `logs` | stream this app's os_log output |
| `udid` | print the target simulator |

`SIM_UDID` overrides the target; otherwise the driver uses whatever is booted.

## Test

```bash
npm run test:ci      # 53 tests, 4 suites, ~20s — all passing
npm run typecheck    # clean
npm run lint         # clean
npm run verify:ios   # "Verified iOS-only targets, device Debug bundling..."
```

`npm test` is `jest --watchAll` and never exits — use `test:ci`.

Widget Swift, without a full Xcode build. Run **both**; each catches what the
other misses, and both exit 0 today:

```bash
cd targets/widget
swiftc -typecheck -sdk $(xcrun --sdk iphoneos --show-sdk-path) \
  -target arm64-apple-ios17.0 -swift-version 5 -application-extension \
  _shared/*.swift WidgetControl.swift widgets.swift index.swift
swiftc -typecheck -sdk $(xcrun --sdk iphoneos --show-sdk-path) \
  -target arm64-apple-ios15.1 -swift-version 5 _shared/*.swift
```

`-application-extension` is **not optional** — without it the check silently
accepts APIs banned in extensions (`ForegroundContinuableIntent` is one) and
the failure only shows up in a full Xcode build. The separate iOS 15.1 pass
matters because `_shared/` compiles into the **app** target too, where the
deployment target is lower (that one catches `LocalizedStringResource` being
iOS 16+).

## Gotchas

- **A system alert freezes `idb ui describe-all` indefinitely.** `simctl
  openurl` pops *"Open in 'WakeMATE'?"*, and local-network access prompts too.
  While one is up, `tree` and `tap` hang — my first attempt burned a 3-minute
  timeout. Every idb call in the driver now has a 20s deadline and tells you
  what to do. **Taps still land during an alert**, so the escape is
  `shot` then `tapxy`.

- **idb coordinates are points; screenshots are pixels.** On this iPhone 16e
  the screenshot is 1170×2532 but the tap space is 393×852 — **divide
  screenshot pixels by 3**. I dismissed the alert above by reading its button
  at pixel (809, 1359) and tapping point (270, 453).

- **`simctl privacy` has no local-network service.** `grant all` covers camera,
  photos, location and friends, but the `NSLocalNetworkUsageDescription` prompt
  — the one that matters most for a LAN app — is not in simctl's list and must
  be tapped by hand.

- **The bundle is `WakeMATE.app`, not `wakematemobile.app`.** It is named from
  `expo.name`, while the *installed* bundle from an older `expo run:ios` is
  `wakematemobile.app`, and the executable inside is `WakeMATE`. All three
  spellings are live at once; the driver globs for the `.app` instead of
  guessing. The bundle id is `com.anonymous.wakematemobile` throughout.

- **No Metro ⇒ stuck on "Downloading 100%…" forever.** The splash never
  advances and there is no error. Start `npx expo start` first.

- **A stale Expo Go instance renders "Unmatched Route / Page could not be
  found" for `myapp:///`.** The status bar shows a `◀ Expo Go` breadcrumb when
  this is what you are looking at. Expo Go cannot host this app's native
  modules — reinstall the dev build (`install` + `relaunch`) rather than
  debugging the router.

- **`npx expo start` refuses a busy port non-interactively.** If 8081 is taken
  it asks *"Use port 8082 instead?"*, gets no answer, prints `Skipping dev
  server` and exits 1. Pass `--port` explicitly.

- **Deep links are not a shortcut past the router.** `openurl myapp:///devices`
  fired the confirmation alert and still landed on the unmatched-route screen.
  Tapping through from the launch screen is the reliable path.

- **`Pairing token was rejected by the companion`** on the Control Device screen
  is the honest unpaired state, not a crash — the simulator's stored token does
  not match whatever the real companion currently holds. Re-pairing needs the QR
  from the Windows tray app.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `tree`/`tap` hangs, then "idb timed out" | System alert on screen. `shot`, then `tapxy` (pixels ÷ 3). |
| `no element matching "..."` | Run `tree` — labels are full strings like `PIXELPUNISHER, 10.0.0.19, Online`. |
| App stuck on "Downloading 100%…" | Metro isn't running. |
| "Unmatched Route" / `◀ Expo Go` in status bar | Stale Expo Go instance; `install` + `relaunch` the dev build. |
| `no .app in .../Debug-iphonesimulator` | Build didn't run or failed; run `build`. |
| `no booted simulator` | `./driver.sh boot`, or set `SIM_UDID`. |
| idb commands fail after a sim restart | Re-attach the companion: `idb connect <udid>` (or `./driver.sh boot`). |
| `expo start` exits with `Skipping dev server` | Port busy; pass `--port`. |
