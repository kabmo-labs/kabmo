#!/usr/bin/env bash
# Assemble a real .app around the SwiftPM binary.
#
# There is no `xcodebuild` on a Command Line Tools–only machine (verified:
# `xcode-select -p` answers /Library/Developer/CommandLineTools and
# `xcodebuild -version` refuses), so the bundle is assembled by hand. That is a
# handful of files plus codesign, and it keeps the build reproducible from a
# checkout with no Xcode.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${CONFIG:-release}"
REPO="$(cd "$HERE/../.." && pwd)"
APP="$HERE/build/Kabmo.app"
swift build --package-path "$HERE" -c "$CONFIG"
# The PRODUCT's name, which is `Kabmo`: a process with no bundle reports its
# executable's file name, so the product is named for the app rather than for the
# folder it lives in.
BIN="$(swift build --package-path "$HERE" -c "$CONFIG" --show-bin-path)/Kabmo"

# The version comes from `version.properties`, the same file `release/release-shells.mjs`
# bumps — read through the same parser, so the number the pipeline publishes and
# the number the bundle declares cannot disagree.
VERSION="$(node "$REPO/release/macos-version.mjs")"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Kabmo"

# The MIT notice, inside the bundle so it travels in the `.zip` and survives a
# drag to /Applications — `Resources` is where a `.app` carries documents that are
# not code. Read from the repository root: a copy of the text here would be a
# second copy that drifts.
cp "$REPO/LICENSE" "$APP/Contents/Resources/LICENSE"
# Belt and braces: the copy is named `Kabmo` and the plist says so, so a launch
# from Finder, from `open`, and from the binary directly all report one name.

# The icon is the app's own artwork, at every size macOS asks for.
ICON="$REPO/public/icon-512x512.png"
if [ -f "$ICON" ]; then
  TMP="$(mktemp -d)"
  ICONSET="$TMP/Kabmo.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 64 128 256 512; do
    sips -z $size $size "$ICON" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z $double $double "$ICON" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Kabmo.icns"
  rm -rf "$TMP"
fi

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Kabmo</string>
  <key>CFBundleDisplayName</key><string>Kabmo</string>
  <key>CFBundleExecutable</key><string>Kabmo</string>
  <key>CFBundleIdentifier</key><string>dev.kabmo.desktop</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>__VERSION__</string>
  <key>CFBundleVersion</key><string>__VERSION__</string>
  <key>CFBundleIconFile</key><string>Kabmo</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <!-- The documents this app can RENDER, which is what puts it in Finder's
       "Open With" and lets a double-click open a tab. Generated from
       `release/document-types.mjs` by `scripts/shell-document-types.mjs`, so the
       list cannot drift from the one Linux and Windows declare.

       `CFBundleTypeRole: Viewer` + `LSHandlerRank: Alternate` are deliberate:
       Kabmo offers itself and never takes a type over. An `Owner` role here
       would make a `.pdf` open in Kabmo for every user who installs it. -->
  <key>CFBundleDocumentTypes</key>
  <array>
__DOCUMENT_TYPES__
  </array>
  <!-- A plain HTTP server on loopback is the normal case; without this the
       webview refuses it under App Transport Security. -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoads</key><true/>
  </dict>
</dict>
</plist>
PLIST

# The plist is written with a placeholder so the heredoc stays quoted (`<<'PLIST'`
# keeps `$` and backticks literal); the substitution happens here, where the
# version is known and cannot be re-expanded by the shell.
# BSD `sed`, which is what macOS ships — this script has no other platform.
/usr/bin/sed -i '' "s/__VERSION__/$VERSION/g" "$APP/Contents/Info.plist"

# The document types, from the ONE table the Linux entry and the Windows
# installer are also rendered from. Injected with `sed`'s `r` command rather than
# a shell substitution: the fragment is multi-line and contains `&`, `\` and `/`,
# all of which a `s|…|…|` replacement would reinterpret.
DOC_TYPES="$(mktemp)"
node "$REPO/scripts/shell-document-types.mjs" --plist > "$DOC_TYPES"
/usr/bin/sed -i '' -e "/__DOCUMENT_TYPES__/{
  r $DOC_TYPES
  d
}" "$APP/Contents/Info.plist"
rm -f "$DOC_TYPES"

# The plist is now the only place a bad document-type entry could hide, and a
# malformed one makes macOS refuse to LAUNCH the app with no message — so it is
# linted here, on the machine that assembles the bundle, rather than by a test
# that runs on a Linux runner without `plutil`.
plutil -lint "$APP/Contents/Info.plist" >/dev/null || {
  echo "build-app: Info.plist is not valid — the document types are malformed" >&2
  exit 1
}

# Ad-hoc signature: enough for local use and for the webview's own process
# launch. A distributed build needs a Developer ID and notarisation.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "built $APP"
