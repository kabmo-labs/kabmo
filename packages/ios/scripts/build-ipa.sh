#!/usr/bin/env bash
# Build the iOS shell into an unsigned .ipa, from a checkout, with no Xcode project.
#
# There is no `.xcodeproj` and no `xcodebuild`: the app is a SwiftPM executable, and
# a `.app` is a directory of files plus an Info.plist. Assembling it by hand is a
# handful of copies, and it keeps the build reproducible from a checkout — the same
# choice `packages/macos/scripts/build-app.sh` makes for the macOS shell.
#
# **The IPA is UNSIGNED, and that is the platform, not a shortcut.** iOS will not
# install an app that is not signed by an Apple-issued certificate, and signing
# requires a provisioning profile bound to a team and a device set. There is no
# public way for an app to install another app on iOS (no `PackageInstaller`
# equivalent), so this artifact exists for three consumers:
#
#   1. a **developer** who signs it themselves (Xcode, `codesign` with their own
#      profile, or a re-signing tool) and installs it on a registered device;
#   2. **TestFlight / the App Store**, where the archive is built and signed by
#      Xcode with the team's credentials;
#   3. a **verification** run — the console's update control compares versions, and
#      CI needs a real bundle with the right version in it to check.
#
# The version comes from `version.properties`, the same file the Android shell and
# the release pipeline read.
#
# usage: scripts/build-ipa.sh [--output <path>]
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CONFIG="${CONFIG:-release}"
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --output) OUTPUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

VERSION="$(node "$REPO/release/ios-version.mjs")"
BUILD="${KABMO_IOS_BUILD:-1}"
# `<App>-<version>-<platform>.<ext>`, the project's one naming rule — the same
# shape the APK and the desktop shells use. The workflow passes an absolute path
# so the artifact lands in the workspace; this default is what a developer's own
# run produces.
OUTPUT="${OUTPUT:-$HERE/build/Kabmo-$VERSION-ios.ipa}"

echo "Shell version: $VERSION (build $BUILD)"

# A release build of the executable, for the device architecture.
#
# `--triple arm64-apple-ios16.0` is the device slice. It needs the iOS SDK, which
# ships with Xcode rather than with the Command Line Tools — so this script checks
# for it first and says exactly what is missing, instead of letting the compiler
# report a hundred missing UIKit symbols.
SDK="$(xcrun --sdk iphoneos --show-sdk-path 2>/dev/null || true)"
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  echo "error: the iOS SDK was not found." >&2
  echo "       Install Xcode and run: sudo xcode-select -s /Applications/Xcode.app" >&2
  echo "       (The logic tests do NOT need it: 'swift run kabmo-shell-tests'.)" >&2
  exit 1
fi

swift build \
  --package-path "$HERE" \
  -c "$CONFIG" \
  --triple arm64-apple-ios16.0 \
  --sdk "$SDK" \
  --product kabmo-shell

BIN="$(swift build --package-path "$HERE" -c "$CONFIG" --triple arm64-apple-ios16.0 --sdk "$SDK" --show-bin-path)/kabmo-shell"
if [ ! -f "$BIN" ]; then
  echo "error: the executable was not produced at $BIN" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/Payload/Kabmo.app"
mkdir -p "$APP"

# The executable is named `Kabmo`, not the SwiftPM product's `kabmo-shell`, so the
# file inside the bundle matches `CFBundleExecutable` and the app's own name — the
# same choice `packages/macos/scripts/build-app.sh` makes for the desktop shell.
cp "$BIN" "$APP/Kabmo"
chmod +x "$APP/Kabmo"

# The Info.plist, with the version filled from version.properties. `plutil` is the
# platform's own editor, so the result is a valid plist by construction — a `sed`
# over the template would leave the file readable by a human and possibly invalid to
# the installer.
cp "$HERE/Resources/Info.plist" "$APP/Info.plist"
# Linted BEFORE the version is written: the document types are a GENERATED region
# spliced into this template, and a malformed one makes iOS refuse to install the
# app with no message — the same reason the macOS build lints its plist.
plutil -lint "$APP/Info.plist" >/dev/null || {
  echo "build-ipa: Info.plist is not valid — the generated document types are malformed" >&2
  exit 1
}
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Info.plist"
plutil -replace CFBundleVersion -string "$BUILD" "$APP/Info.plist"

# The NAME, checked rather than assumed. `CFBundleDisplayName` is what the Home
# Screen prints, and a build that quietly renamed it would ship a shell called
# something else with nothing failing anywhere — the same class of silent drift the
# icon check below exists for.
name="$(plutil -extract CFBundleDisplayName raw "$APP/Info.plist")"
short="$(plutil -extract CFBundleName raw "$APP/Info.plist")"
executable="$(plutil -extract CFBundleExecutable raw "$APP/Info.plist")"
[ "$name" = "Kabmo" ] || { echo "error: CFBundleDisplayName is '$name', not 'Kabmo'" >&2; exit 1; }
[ "$short" = "Kabmo" ] || { echo "error: CFBundleName is '$short', not 'Kabmo'" >&2; exit 1; }
[ -x "$APP/$executable" ] || { echo "error: CFBundleExecutable names '$executable' but the bundle has no such executable" >&2; exit 1; }

# The icon. `Assets.car` would need `actool` (Xcode only), so the bundle carries the
# PNG variants `CFBundleIconFiles` names — the documented fallback, and the reason
# this script does not need Xcode's asset compiler.
ICON_DIR="$STAGE/icons"
mkdir -p "$ICON_DIR"
swift "$HERE/scripts/make-icon.swift" "$ICON_DIR/icon-1024.png"
# The names below MUST match `CFBundleIconFiles` in Resources/Info.plist. A size the
# plist names and this loop does not write is a blank icon with no error anywhere,
# so the two lists are compared at the end of the script rather than trusted.
for size in 60 76 120 152 167 180; do
  sips -z "$size" "$size" "$ICON_DIR/icon-1024.png" --out "$APP/Icon-$size.png" >/dev/null
done

# Every icon the plist names exists in the bundle.
for name in $(plutil -extract CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles json -o - "$APP/Info.plist" \
  | tr -d '[]"' | tr ',' '\n'); do
  [ -n "$name" ] || continue
  [ -f "$APP/$name.png" ] || { echo "error: Info.plist names $name but the bundle has no $name.png" >&2; exit 1; }
done

# A zip with the `Payload/` root is what an `.ipa` IS. `ditto` rather than `zip`
# because it preserves the executable bit and the extended attributes a signed
# bundle would carry.
mkdir -p "$(dirname "$OUTPUT")"
rm -f "$OUTPUT"
( cd "$STAGE" && ditto -c -k --sequesterRsrc --keepParent Payload "$OUTPUT" )

echo "built $OUTPUT"
echo "  version $VERSION (build $BUILD), unsigned — see the header for what that means"
