#!/usr/bin/env bash
# @license
# SPDX-License-Identifier: MIT
#
# Assemble a runnable Linux app directory around the release binary.
#
# There is no universal "app bundle" on Linux, so this produces the layout the
# desktop entry and the launcher expect:
#
#   build/Kabmo/
#     Kabmo                    the shell (named after the APP, so the process name,
#                              WM_CLASS and the taskbar label all say Kabmo)
#     kabmo.desktop.in         the launcher TEMPLATE — install.sh fills it in
#     kabmo.png                the icon, from the app's own artwork
#     install.sh               writes the entry and installs all three
#
# The version is NOT read here: `build.rs` bakes `version.properties` into the
# binary at compile time, so the packaged directory already carries the number the
# pipeline publishes and the page reports. `publish-linux.yml` reads it through
# `release/linux-version.mjs` and checks the built binary agrees — a second reader
# in this script would be a second answer.
#
# `resolve_launch()` looks for `server/kabmo` beside the binary first, so a
# compiled server dropped into `build/Kabmo/server/` is picked up with no
# change here — that is the packaging work in
# `docs/desktop-mobile-packaging-plan.md` (P0), and this script does not fake it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CONFIG="${CONFIG:-release}"
OUT="$HERE/build/Kabmo"

cargo build --release --manifest-path "$HERE/Cargo.toml"
BIN="$HERE/target/$CONFIG/Kabmo"
if [ ! -x "$BIN" ]; then
  echo "expected $BIN after the build" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

cp "$BIN" "$OUT/Kabmo"

# The icon is the app's own artwork, at the sizes a launcher asks for. A missing
# source image is not fatal: a launcher entry without an icon still starts the
# app, and failing the build over artwork would be worse.
ICON="$REPO/public/icon-512x512.png"
if [ -f "$ICON" ] && command -v convert >/dev/null 2>&1; then
  convert "$ICON" -resize 512x512 "$OUT/kabmo.png"
elif [ -f "$ICON" ]; then
  cp "$ICON" "$OUT/kabmo.png"
else
  echo "note: $ICON not found — the entry will use a generic icon" >&2
fi

# The launcher entry is a TEMPLATE plus the installer that fills it in, not a
# ready-made `.desktop`. An entry's `Exec` must be an absolute path, and a tarball
# unpacks wherever the user put it — so only the installer knows where the binary
# landed. The previous version shipped a `sh -c '...'` entry to dodge that and
# `desktop-file-validate` rejects it (no single quotes in the spec, `$` must be
# escaped inside a quoted argument); an invalid entry is silent, and the launcher
# simply does nothing when clicked.
cp "$HERE/scripts/kabmo.desktop.in" "$OUT/kabmo.desktop.in"
cp "$HERE/scripts/install.sh" "$OUT/install.sh"
chmod +x "$OUT/install.sh"

# The MIT notice travels with the archive, because the licence requires it in
# every copy and the three packagers each install it in the shape their format
# expects (`.deb` a DEP-5 `copyright`, `.rpm` a `%license`, AppImage the file).
# Read from the repository root rather than restated here: a copy of the text in
# this script would be the second copy that drifts the first time the year or the
# holder changes.
[ -f "$REPO/LICENSE" ] || { echo "build-app: no LICENSE at $REPO/LICENSE" >&2; exit 1; }
cp "$REPO/LICENSE" "$OUT/LICENSE"

# The MIME types the entry declares, GENERATED from the one table the macOS plist
# and the Windows installer are also rendered from. It travels as a file because a
# published tarball carries no `scripts/` directory for `install.sh` to call, and a
# list copied into the installer would be a fourth source that drifts silently —
# the entry still installs, it simply never appears in "Open With" for a format
# added later.
node "$REPO/scripts/shell-document-types.mjs" --mime > "$OUT/mime-types.txt"

echo "built $OUT"
echo "  $OUT/Kabmo"
echo "  $OUT/kabmo.desktop.in"
echo "  $OUT/kabmo.png"
echo "  $OUT/install.sh"
echo "  $OUT/LICENSE"
echo ""
echo "install with: $OUT/install.sh"
