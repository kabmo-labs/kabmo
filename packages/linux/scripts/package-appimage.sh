#!/usr/bin/env bash
# @license
# SPDX-License-Identifier: Apache-2.0
#
# Build the AppImage for the staged directory `build-app.sh` produced.
#
#   packages/linux/scripts/package-appimage.sh <staged-dir> <output-dir> <appimage-arch> <version>
#
# `<appimage-arch>` is AppImage's own spelling: `x86_64` or `aarch64`. It is also
# the asset's spelling for x86-64, which is a coincidence and not a rule — the
# caller passes it, this script does not derive it.
#
# WHY AN APPIMAGE, WHEN THERE IS ALREADY A `.deb` AND AN `.rpm`. Both of those
# declare the distribution's own library names, so each installs on its family and
# nowhere else. An AppImage bundles what it needs and runs on any glibc
# distribution — which is the format a user on Arch, NixOS, openSUSE Tumbleweed or
# an immutable distro reaches for first.
#
# **It is NOT self-contained the way an Electron AppImage is**, and pretending
# otherwise would be the bug. The shell links GTK 3 and WebKitGTK 4.1, and those
# are large system libraries with their own theme, font and sandbox integration;
# bundling them produces an app that starts and then cannot render text. So the
# AppImage carries the SHELL and expects the same two libraries a `.deb` declares
# — the difference is that it needs no package manager to install, and it can be
# moved or deleted without leaving anything behind.
#
# `appimagetool` is itself an AppImage, and running one needs FUSE — which a
# container or a minimal runner does not have. `APPIMAGE_EXTRACT_AND_RUN=1` is the
# documented fallback: it extracts to a temp directory and runs from there. Set
# here rather than left to the caller, because a missing FUSE device otherwise
# fails with "dlopen(): error loading libfuse.so.2" — a message about the TOOL, not
# about the build.
set -euo pipefail

STAGE="${1:?usage: package-appimage.sh <staged-dir> <output-dir> <arch> <version>}"
OUT="${2:?usage: package-appimage.sh <staged-dir> <output-dir> <arch> <version>}"
AI_ARCH="${3:?usage: package-appimage.sh <staged-dir> <output-dir> <arch> <version>}"
VERSION="${4:?usage: package-appimage.sh <staged-dir> <output-dir> <arch> <version>}"

[ -x "$STAGE/Kabmo" ] || { echo "package-appimage: no binary at $STAGE/Kabmo" >&2; exit 1; }
[ -f "$STAGE/kabmo.png" ] || { echo "package-appimage: no icon at $STAGE/kabmo.png" >&2; exit 1; }
[ -f "$STAGE/kabmo.desktop.in" ] || { echo "package-appimage: no launcher template" >&2; exit 1; }
[ -f "$STAGE/mime-types.txt" ] || { echo "package-appimage: no MimeType list beside the template (run build-app.sh)" >&2; exit 1; }

PKG=kabmo
NAME="Kabmo-${VERSION}-linux-${AI_ARCH}"

# ABSOLUTE, because this script changes directory twice — once to run
# `appimagetool` (which writes the `.zsync` into the cwd) and once to extract the
# finished image. A relative `$OUT` resolves against whichever directory is
# current at that moment, and measured, that made the extract step look for the
# AppImage under a path that did not exist and report "cannot be extracted" for a
# perfectly good build.
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
STAGE="$(cd "$STAGE" && pwd)"

# The tools this script needs, checked rather than assumed. Two of them are
# `appimagetool`'s OWN requirements and it reports them badly: without `file` it
# exits with "file command is missing but required, please install it" AFTER
# downloading and unpacking itself, and without `zsyncmake` it silently skips the
# `.zsync`. Naming them here makes a bare runner say what to install.
for tool in curl file desktop-file-validate; do
  command -v "$tool" >/dev/null || { echo "package-appimage: $tool is required" >&2; exit 1; }
done
# `zsyncmake` is optional on purpose — see the `.zsync` note below.

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The tool, pinned. `continuous` is a moving tag and an unpinned download in a
# release pipeline is a build that changes without a commit — so the version is
# stated and the asset is verified to be the architecture this row is building.
TOOL_VERSION="1.9.1"
TOOL="$WORK/appimagetool.AppImage"
TOOL_URL="https://github.com/AppImage/appimagetool/releases/download/${TOOL_VERSION}/appimagetool-${AI_ARCH}.AppImage"

echo "package-appimage: fetching appimagetool ${TOOL_VERSION} (${AI_ARCH})"
curl -fsSL --retry 3 --retry-delay 2 -o "$TOOL" "$TOOL_URL" \
  || { echo "package-appimage: could not download $TOOL_URL" >&2; exit 1; }
chmod +x "$TOOL"

# The AppDir, which is the format's whole contract:
#
#   Kabmo.AppDir/
#     AppRun                  → the entry point (a symlink to the binary)
#     kabmo.desktop           → at the ROOT, named after `Icon=` below
#     kabmo.png               → at the ROOT, the icon the entry names
#     usr/bin/Kabmo           → the binary itself
#
# The entry must be at the root AND under `usr/share/applications` for the
# desktop-integration path; the root copy is what `appimagetool` reads.
APPDIR="$WORK/Kabmo.AppDir"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/applications" \
  "$APPDIR/usr/share/icons/hicolor/512x512/apps"

install -m 755 "$STAGE/Kabmo" "$APPDIR/usr/bin/Kabmo"
install -m 644 "$STAGE/kabmo.png" "$APPDIR/kabmo.png"
install -m 644 "$STAGE/kabmo.png" "$APPDIR/usr/share/icons/hicolor/512x512/apps/$PKG.png"

# `.DirIcon` is what a file manager shows for the AppImage itself.
ln -sf kabmo.png "$APPDIR/.DirIcon"

# `AppRun` is a SYMLINK to the binary rather than a shell script. A script would
# have to `exec` the binary and would add a process between the launcher and the
# window, which breaks the `StartupWMClass` match GTK relies on.
ln -sf usr/bin/Kabmo "$APPDIR/AppRun"

# The entry, from the shared template. `Exec` here is the AppRun path, because
# inside the mounted AppImage that IS the absolute path — and it is the one value
# that differs from the `.deb` and the `.rpm`, where the binary is at `/usr/bin`.
sed \
  -e 's|@EXEC@|AppRun|g' \
  -e 's|@TRY_EXEC@|AppRun|g' \
  -e "s|@ICON@|$PKG|g" \
  -e "s|@MIMETYPES@|$(tr -d '\n' < "$STAGE/mime-types.txt")|g" \
  "$STAGE/kabmo.desktop.in" > "$APPDIR/$PKG.desktop"
chmod 644 "$APPDIR/$PKG.desktop"
cp "$APPDIR/$PKG.desktop" "$APPDIR/usr/share/applications/$PKG.desktop"

if grep -q '@[A-Z_]*@' "$APPDIR/$PKG.desktop"; then
  grep -o '@[A-Z_]*@' "$APPDIR/$PKG.desktop" | sort -u \
    | sed 's/^/package-appimage: unresolved token /' >&2
  exit 1
fi

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$APPDIR/$PKG.desktop" \
    || { echo "package-appimage: the launcher entry is not valid" >&2; exit 1; }
fi

mkdir -p "$OUT"

# `--no-appstream` because this project ships no AppStream metadata: without the
# flag `appimagetool` warns on every build about a file that will never exist.
#
# The update information is a `gh-releases-zsync` string, which is what
# `AppImageUpdate` reads to find the next build. It names the ASSET PATTERN, so
# the architecture has to be in it — one pattern would otherwise offer an x86-64
# build to an Arm machine.
#
# Run from INSIDE `$OUT`, and that is not cosmetic: `appimagetool` writes the
# `.zsync` beside the file it was TOLD to write only when that file is the current
# directory's — measured, an absolute destination put the AppImage in `$OUT` and
# the `.zsync` in the caller's cwd, so the delta metadata was silently left behind
# on the runner. Running here makes both land together.
export APPIMAGE_EXTRACT_AND_RUN=1
export ARCH="$AI_ARCH"
(
  cd "$OUT"
  "$TOOL" --no-appstream \
    --updateinformation "gh-releases-zsync|kabmo-labs|kabmo|latest|Kabmo-*-linux-${AI_ARCH}.AppImage.zsync" \
    "$APPDIR" "$NAME.AppImage"
)

# `appimagetool` writes the `.zsync` only when `zsyncmake` is installed. Its
# absence is not a build failure — the AppImage runs either way, and
# `AppImageUpdate` falls back to a full download — but it IS the difference between
# a delta update and a 30 MB fetch, so the caller is told which it got.
if [ -f "$OUT/$NAME.AppImage.zsync" ]; then
  echo "package-appimage: zsync metadata written (delta updates available)"
else
  echo "package-appimage: no zsync metadata (install 'zsync' for delta updates)"
fi

# Read the artifact back: the AppImage is a squashfs image behind an ELF stub, so
# `--appimage-extract` is what proves it is a real one and not a truncated
# download. Only the desktop file is read, which is the part a launcher needs.
extract="$(mktemp -d)"
trap 'rm -rf "$WORK" "$extract"' EXIT
(cd "$extract" && APPIMAGE_EXTRACT_AND_RUN=1 "$OUT/$NAME.AppImage" --appimage-extract "$PKG.desktop" >/dev/null 2>&1) \
  || { echo "package-appimage: the built AppImage cannot be extracted" >&2; exit 1; }
[ -f "$extract/squashfs-root/$PKG.desktop" ] \
  || { echo "package-appimage: the AppImage carries no launcher entry" >&2; exit 1; }
grep -qx 'Name=Kabmo' "$extract/squashfs-root/$PKG.desktop" \
  || { echo "package-appimage: the packaged entry is not named Kabmo" >&2; exit 1; }

echo "package-appimage: built $OUT/$NAME.AppImage ($(du -h "$OUT/$NAME.AppImage" | cut -f1))"
