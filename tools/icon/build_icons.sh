#!/usr/bin/env bash
# Regenerates the app icons in frontend/public from tools/icon/gen.py.
#   tools/icon/build_icons.sh
# Needs python3 and Chrome/Chromium (the SVG's watercolor filters are rasterised by
# a headless browser, so the PNGs look the same as the SVG in a browser tab).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../../frontend/public"
work="$(mktemp -d)"
chrome="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"

python3 -B "$here/gen.py" "$work"          # icon.svg (rounded) + icon-bleed.svg (full-bleed, art scaled into the maskable safe zone)

render() { # <svg> <size> <png> <background>
  cat > "$work/r.html" <<HTML
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:100vw;height:100vh}</style><img src="$1">
HTML
  "$chrome" --headless=new --no-sandbox --hide-scrollbars --default-background-color="$4" \
    --window-size="$2,$2" --screenshot="$out/$3" "file://$work/r.html" >/dev/null 2>&1
}

cp "$work/icon.svg" "$out/favicon.svg"
render icon.svg 192 icon-192.png 00000000
render icon.svg 512 icon-512.png 00000000
render icon.svg 32 favicon-32.png 00000000
render icon-bleed.svg 512 icon-maskable-512.png FFFFFFFF   # maskable: no transparency
render icon-bleed.svg 180 apple-touch-icon.png FFFFFFFF    # iOS applies its own rounded mask
echo "icons written to $out"
