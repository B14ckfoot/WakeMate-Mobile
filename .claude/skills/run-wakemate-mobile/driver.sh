#!/usr/bin/env bash
# WakeMATE Mobile iOS simulator driver.
#
# Wraps `xcrun simctl` (lifecycle, screenshots, deep links) and `idb`
# (accessibility tree, taps, typing) so an agent can drive the real app on a
# simulator. Unlike a browser driver this is stateless — the simulator keeps
# its own state between invocations, so every command is a separate call.
#
#   ./driver.sh boot                 # boot the simulator + connect idb
#   ./driver.sh build                # xcodebuild Debug for the simulator
#   ./driver.sh install              # install the built .app on the sim
#   ./driver.sh launch               # launch (Metro must be running)
#   ./driver.sh shot /tmp/a.png      # screenshot
#   ./driver.sh tree                 # accessibility tree: label / type / frame
#   ./driver.sh tap "Add Device"     # tap the element with that AX label
#   ./driver.sh tapxy 195 700
#   ./driver.sh text "PIXELPUNISHER" # type into the focused field
#   ./driver.sh openurl myapp://devices
#   ./driver.sh logs                 # stream this app's os_log output
#   ./driver.sh stop
#
# The app is a Debug dev build: it fetches its JS bundle from Metro at launch.
# Start Metro first (`npx expo start --dev-client`) or you get stuck on the
# "Downloading 100%…" splash forever.
set -uo pipefail

UNIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BUNDLE_ID="com.anonymous.wakematemobile"
WORKSPACE="$UNIT_DIR/ios/WakeMATE.xcworkspace"
SCHEME="WakeMATE"
DERIVED="$UNIT_DIR/ios/build/DD"
PRODUCTS="$DERIVED/Build/Products/Debug-iphonesimulator"
# The bundle is WakeMATE.app (from expo.name), NOT wakematemobile.app — the
# latter is what an older `expo run:ios` install left on the simulator. Glob
# for it rather than hardcoding either spelling.
APP_PATH="$(ls -d "$PRODUCTS"/*.app 2>/dev/null | head -1)"

# idb installs into the user Python bin dir, which is not on PATH by default.
export PATH="$PATH:$HOME/Library/Python/3.12/bin"

# Default to whatever is already booted; override with SIM_UDID.
UDID="${SIM_UDID:-$(xcrun simctl list devices booted -j 2>/dev/null \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
print(next((x["udid"] for v in d.values() for x in v if x["state"]=="Booted"), ""))')}"

need_udid() {
  if [ -z "$UDID" ]; then
    echo "error: no booted simulator. Run './driver.sh boot' or set SIM_UDID." >&2
    exit 1
  fi
}

# macOS has no coreutils `timeout`. `idb ui describe-all` blocks forever while a
# system alert ("Open in WakeMATE?", "Allow Local Network access?") is on
# screen, so every idb call gets a hard deadline instead of hanging the agent.
guard() {
  perl -e 'alarm shift; exec @ARGV' 20 "$@"
  local rc=$?
  if [ $rc -eq 142 ] || [ $rc -eq 14 ]; then
    echo "idb timed out — a system alert is probably blocking the UI." >&2
    echo "The AX tree is unreadable while one is up, but taps still land:" >&2
    echo "  $0 shot /tmp/alert.png   # look at it" >&2
    echo "  $0 tapxy <x> <y>         # screenshot px / 3 = points" >&2
    return 1
  fi
  return $rc
}

cmd="${1:-}"; shift 2>/dev/null

case "$cmd" in
  boot)
    UDID="${SIM_UDID:-${UDID:-$(xcrun simctl list devices available -j \
      | python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
c=[x for v in d.values() for x in v if "iPhone" in x["name"]]
print(c[0]["udid"] if c else "")')}}"
    [ -n "$UDID" ] || { echo "no iPhone simulator available" >&2; exit 1; }
    xcrun simctl boot "$UDID" 2>/dev/null
    open -a Simulator
    # idb needs a companion attached before ui commands work.
    idb connect "$UDID" 2>&1 | head -2
    echo "booted $UDID"
    ;;

  build)
    need_udid
    xcodebuild build \
      -workspace "$WORKSPACE" \
      -scheme "$SCHEME" \
      -configuration Debug \
      -destination "platform=iOS Simulator,id=$UDID" \
      -derivedDataPath "$DERIVED" \
      "$@" 2>&1 | tail -25
    ;;

  install)
    need_udid
    [ -n "$APP_PATH" ] && [ -d "$APP_PATH" ] \
      || { echo "no .app in $PRODUCTS — run './driver.sh build'" >&2; exit 1; }
    xcrun simctl install "$UDID" "$APP_PATH" && echo "installed $APP_PATH"
    ;;

  launch)
    need_udid
    xcrun simctl launch "$UDID" "$BUNDLE_ID" "$@"
    ;;

  relaunch)
    need_udid
    xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null
    sleep 1
    xcrun simctl launch "$UDID" "$BUNDLE_ID"
    ;;

  stop)
    need_udid
    xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null && echo "terminated"
    ;;

  shot)
    need_udid
    out="${1:?usage: shot <path>}"
    mkdir -p "$(dirname "$out")"
    xcrun simctl io "$UDID" screenshot "$out" 2>/dev/null
    bytes=$(stat -f%z "$out" 2>/dev/null || echo 0)
    echo "wrote $out ($bytes bytes)"
    [ "$bytes" -gt 5000 ] || { echo "warning: screenshot looks blank" >&2; exit 1; }
    ;;

  tree)
    need_udid
    # Flatten the AX tree to the rows that matter: anything with a label.
    guard idb ui describe-all --udid "$UDID" 2>/dev/null | python3 -c '
import json, sys
try:
    nodes = json.load(sys.stdin)
except Exception:
    print("could not parse the accessibility tree — is the app foregrounded?"); sys.exit(1)
rows = 0
for n in nodes:
    label = n.get("AXLabel") or n.get("title") or ""
    if not label:
        continue
    f = n.get("frame", {})
    cx = int(f.get("x", 0) + f.get("width", 0) / 2)
    cy = int(f.get("y", 0) + f.get("height", 0) / 2)
    print(f'"'"'{label[:48]:<50} {n.get("type") or "?":<14} tap {cx},{cy}'"'"')
    rows += 1
print(f"({rows} labelled elements)")
'
    ;;

  tap)
    need_udid
    want="${1:?usage: tap <accessibility label>}"
    coords=$(guard idb ui describe-all --udid "$UDID" 2>/dev/null | python3 -c "
import json, sys
want = sys.argv[1].lower()
nodes = json.load(sys.stdin)
best = None
for n in nodes:
    label = (n.get('AXLabel') or n.get('title') or '').strip()
    if not label:
        continue
    f = n.get('frame', {})
    if f.get('width', 0) <= 0 or f.get('height', 0) <= 0:
        continue
    # exact match wins; fall back to substring
    score = 0 if label.lower() == want else (1 if want in label.lower() else None)
    if score is None:
        continue
    area = f['width'] * f['height']
    if best is None or (score, area) < (best[0], best[1]):
        best = (score, area, int(f['x'] + f['width'] / 2), int(f['y'] + f['height'] / 2), label)
if best:
    print(best[2], best[3], best[4])
" "$want")
    if [ -z "$coords" ]; then
      echo "no element matching \"$want\" — run './driver.sh tree' to see what's there" >&2
      exit 1
    fi
    set -- $coords
    x=$1; y=$2; shift 2
    guard idb ui tap --udid "$UDID" "$x" "$y" && echo "tapped \"$*\" at $x,$y"
    ;;

  tapxy)
    need_udid
    guard idb ui tap --udid "$UDID" "${1:?x}" "${2:?y}" && echo "tapped $1,$2"
    ;;

  text)
    need_udid
    guard idb ui text --udid "$UDID" "${1:?usage: text <string>}" && echo "typed"
    ;;

  key)
    need_udid
    guard idb ui key --udid "$UDID" "${1:?usage: key <keycode>}" && echo "sent key $1"
    ;;

  openurl)
    need_udid
    xcrun simctl openurl "$UDID" "${1:?usage: openurl <url>}" && echo "opened $1"
    ;;

  # Pre-approve the permission prompts so they don't block the AX tree mid-run.
  # NOTE: simctl's service list has no "local network" entry, so the
  # NSLocalNetworkUsageDescription alert still has to be tapped by hand.
  grant)
    need_udid
    xcrun simctl privacy "$UDID" grant "${1:-all}" "$BUNDLE_ID" \
      && echo "granted ${1:-all} to $BUNDLE_ID"
    ;;

  logs)
    need_udid
    xcrun simctl spawn "$UDID" log stream \
      --predicate "subsystem CONTAINS 'wakemate' OR processImagePath CONTAINS 'wakematemobile'" \
      --style compact
    ;;

  udid)
    echo "${UDID:-<none booted>}"
    ;;

  *)
    grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' | head -30
    exit 2
    ;;
esac
