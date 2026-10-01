#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Screenshot harness.
#
#   ./tools/shoot.sh <url-path> <out-name> [width] [height] [wait-ms] [scale]
#
# Requires the dev server to already be running on $PORT (default 4173).
# Uses the Edge already present on the machine, so there is no browser
# download and no extra npm dependency.
#
#   PORT=5173 ./tools/shoot.sh / feed 1440 2200
#
# WHY SCALE EXISTS
# Windows will not make a browser window narrower than about 500 CSS pixels,
# so `--window-size=390,...` silently lays the page out at ~497 and then
# captures only the left 390 of it. Everything to the right of the fold is
# simply absent from the picture, which reads exactly like a layout bug and
# is not one. Asking for a window of W*scale and a device scale factor of
# scale gets a true W-wide viewport at any width: the window is big enough to
# be legal and the page still lays out at W.
#
#   ./tools/shoot.sh / feed-mobile 390 1400 9000 2
# ---------------------------------------------------------------------------
set -euo pipefail

PATH_="${1:-/}"
NAME="${2:-shot}"
W="${3:-1440}"
H="${4:-2200}"
WAIT="${5:-9000}"
SCALE="${6:-1}"
PORT="${PORT:-4173}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/.shots"

EDGE=""
for candidate in \
  "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
  "/c/Program Files/Google/Chrome/Application/chrome.exe" \
  "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
do
  [ -f "$candidate" ] && EDGE="$candidate" && break
done

if [ -z "$EDGE" ]; then
  echo "No Chromium-based browser found. Set BROWSER=/path/to/browser." >&2
  exit 1
fi

mkdir -p "$OUT"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

URL="http://localhost:${PORT}${PATH_}"
TARGET="$OUT/${NAME}.png"
rm -f "$TARGET"

# The window is asked for at `scale` times the viewport so the OS minimum
# window width cannot clamp it; the device scale factor divides it back down,
# so the page lays out at exactly W x H CSS pixels.
WIN_W=$((W * SCALE))
WIN_H=$((H * SCALE))

"$EDGE" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --hide-scrollbars \
  --force-device-scale-factor="$SCALE" \
  --user-data-dir="$PROFILE" \
  --window-size="${WIN_W},${WIN_H}" \
  --virtual-time-budget="$WAIT" \
  --screenshot="$TARGET" \
  "$URL" >/dev/null 2>&1 || true

if [ -f "$TARGET" ]; then
  echo "$TARGET ($(stat -c%s "$TARGET") bytes, viewport ${W}x${H} @${SCALE}x)"
else
  echo "FAILED to capture $URL" >&2
  exit 1
fi
