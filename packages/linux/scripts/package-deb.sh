#!/usr/bin/env bash
# @license
# SPDX-License-Identifier: MIT
#
# Build the Debian package for the packaged directory `build-app.sh` produced.
#
#   packages/linux/scripts/package-deb.sh <staged-dir> <output-dir> <arch> <version>
#
# `<staged-dir>` is `build/Kabmo` — the binary, the launcher TEMPLATE, the icon
# and `install.sh`. `<arch>` is Debian's own spelling (`amd64` / `arm64`), which
# is NOT the asset's (`x86_64` / `arm64`): dpkg refuses a package whose
# `Architecture:` field it does not know, and the two vocabularies genuinely
# differ for x86-64. The caller maps one to the other; this script never guesses.
#
# WHY A `.deb` AT ALL. A `.tar.gz` plus `install.sh` is a fine distribution for a
# developer, and it is what this shell shipped first — but it is not a package:
# nothing records what is installed, nothing can upgrade it in place, and nothing
# removes it. A `.deb` gives all three for free, and it is what an Ubuntu or
# Debian user expects from a download page.
#
# The layout follows the FHS and the entry is the one `install.sh` already writes:
#
#   /usr/bin/Kabmo
#   /usr/share/applications/kabmo.desktop
#   /usr/share/icons/hicolor/512x512/apps/kabmo.png
#
# **The launcher entry is generated HERE, not copied as a template**, and that is
# the same rule `install.sh` documents: `Exec` takes an absolute path, so the only
# correct value is the one this script just chose. A package installs at `/usr`, so
# the value is knowable at build time — unlike the tarball, where it is not.
set -euo pipefail

STAGE="${1:?usage: package-deb.sh <staged-dir> <output-dir> <arch> <version>}"
OUT="${2:?usage: package-deb.sh <staged-dir> <output-dir> <arch> <version>}"
DEB_ARCH="${3:?usage: package-deb.sh <staged-dir> <output-dir> <arch> <version>}"
VERSION="${4:?usage: package-deb.sh <staged-dir> <output-dir> <arch> <version>}"

for tool in dpkg-deb fakeroot; do
  command -v "$tool" >/dev/null || { echo "package-deb: $tool is required" >&2; exit 1; }
done

[ -x "$STAGE/Kabmo" ] || { echo "package-deb: no binary at $STAGE/Kabmo" >&2; exit 1; }
[ -f "$STAGE/kabmo.png" ] || { echo "package-deb: no icon at $STAGE/kabmo.png" >&2; exit 1; }
[ -f "$STAGE/kabmo.desktop.in" ] || { echo "package-deb: no launcher template" >&2; exit 1; }
[ -f "$STAGE/mime-types.txt" ] || { echo "package-deb: no MimeType list beside the template (run build-app.sh)" >&2; exit 1; }

PKG=kabmo
NAME="Kabmo-${VERSION}-linux-${DEB_ARCH}"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

# The installed tree. `/usr` rather than `/usr/local` because this is a package
# the system's package manager owns; a `.tar.gz` unpacked by hand goes to
# `~/.local` through `install.sh`, and the two do not collide.
install -d "$ROOT/DEBIAN" \
  "$ROOT/usr/bin" \
  "$ROOT/usr/share/applications" \
  "$ROOT/usr/share/icons/hicolor/512x512/apps" \
  "$ROOT/usr/share/doc/$PKG"

install -m 755 "$STAGE/Kabmo" "$ROOT/usr/bin/Kabmo"
install -m 644 "$STAGE/kabmo.png" "$ROOT/usr/share/icons/hicolor/512x512/apps/$PKG.png"

# The entry, from the same template `install.sh` fills in. `Exec` is quoted for
# the reason that script documents at length: a space is a reserved character in
# the value and `desktop-file-validate` does not catch an unquoted one.
sed \
  -e 's|@EXEC@|"/usr/bin/Kabmo"|g' \
  -e 's|@TRY_EXEC@|/usr/bin/Kabmo|g' \
  -e "s|@ICON@|$PKG|g" \
  -e "s|@MIMETYPES@|$(tr -d '\n' < "$STAGE/mime-types.txt")|g" \
  "$STAGE/kabmo.desktop.in" > "$ROOT/usr/share/applications/$PKG.desktop"
chmod 644 "$ROOT/usr/share/applications/$PKG.desktop"

if grep -q '@[A-Z_]*@' "$ROOT/usr/share/applications/$PKG.desktop"; then
  grep -o '@[A-Z_]*@' "$ROOT/usr/share/applications/$PKG.desktop" | sort -u \
    | sed 's/^/package-deb: unresolved token /' >&2
  exit 1
fi

# `dpkg-deb` does not run the entry validator, and an invalid entry fails
# SILENTLY at the launcher — so it is checked here, when the tool exists.
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$ROOT/usr/share/applications/$PKG.desktop" \
    || { echo "package-deb: the launcher entry is not valid" >&2; exit 1; }
fi

# The MIT notice, in the shape Debian policy requires: an UNCOMPRESSED
# `/usr/share/doc/<pkg>/copyright` in DEP-5 format (policy §12.5 — a gzipped one
# is a violation, unlike the changelog). Generated from the archive's own
# `LICENSE` so the text has one source; only the machine-readable header is
# written here, because it is the format's, not the licence's.
[ -f "$STAGE/LICENSE" ] || { echo "package-deb: no LICENSE at $STAGE/LICENSE (run build-app.sh)" >&2; exit 1; }
# Read out of the licence rather than restated: the year and the holder are stated
# once, in `LICENSE`, and a copy here would be the second one that drifts.
COPYRIGHT_HOLDER="$(sed -n 's/^Copyright (c) \(.*\)$/\1/p' "$STAGE/LICENSE")"
[ -n "$COPYRIGHT_HOLDER" ] || { echo "package-deb: no 'Copyright (c) …' line in $STAGE/LICENSE" >&2; exit 1; }
{
  echo "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/"
  echo "Upstream-Name: kabmo"
  echo "Source: https://github.com/kabmo-labs/kabmo"
  echo
  echo "Files: *"
  echo "Copyright: $COPYRIGHT_HOLDER"
  echo "License: MIT"
  # The licence body is indented by one space and its blank lines become ` .`,
  # which is what DEP-5's continuation syntax asks for. The title and the
  # copyright line are dropped: both are already stated above, and a `Copyright:`
  # line repeated inside the body reads as a second claim.
  sed -n '/^Permission is hereby granted/,$p' "$STAGE/LICENSE" \
    | sed -e 's/^$/./' -e 's/^/ /'
} > "$ROOT/usr/share/doc/$PKG/copyright"
chmod 644 "$ROOT/usr/share/doc/$PKG/copyright"

# The dependencies are the two native libraries the crate links, named for the
# distribution this package targets. Ubuntu 24.04 renamed GTK 3's runtime package
# to `libgtk-3-0t64` (the 64-bit time_t transition), and a `.deb` naming
# `libgtk-3-0` there is UNINSTALLABLE — apt reports "no installation candidate"
# rather than a missing library. `libgtk-3-0t64 | libgtk-3-0` would be the
# portable spelling, and dpkg supports alternatives, but a package built on 24.04
# declares what 24.04 has; the `Conflicts`-free single name is what apt resolves.
DEPENDS="libgtk-3-0t64, libwebkit2gtk-4.1-0"

INSTALLED_KB="$(du -sk --exclude=DEBIAN "$ROOT" | cut -f1)"

cat > "$ROOT/DEBIAN/control" <<CONTROL
Package: $PKG
Version: $VERSION
Section: devel
Priority: optional
Architecture: $DEB_ARCH
Installed-Size: $INSTALLED_KB
Depends: $DEPENDS
Maintainer: Kabmo Labs <support@kabmo.dev>
Homepage: https://github.com/kabmo-labs/kabmo
Description: Web console and diagnostic workbench for AI coding agents
 Kabmo is a native window around the Kabmo console: it starts the server if one
 is not already running on the chosen port, remembers the servers you added, and
 draws the console in the system's own WebKit view.
CONTROL

# Maintainer scripts, and the only two things a package must do beyond placing
# files. `postinst` refreshes the menu and icon caches — without it a launcher
# appears only after the user logs out — and `postrm` refreshes them again on
# removal. Both are best-effort: a desktop without `update-desktop-database`
# still finds the entry on its next rebuild, and failing an install over a cache
# is worse than a menu that updates a little later.
cat > "$ROOT/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
  command -v update-desktop-database >/dev/null 2>&1 \
    && update-desktop-database -q /usr/share/applications || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 \
    && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
fi
exit 0
POSTINST

cat > "$ROOT/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  command -v update-desktop-database >/dev/null 2>&1 \
    && update-desktop-database -q /usr/share/applications || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 \
    && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
fi
exit 0
POSTRM

chmod 755 "$ROOT/DEBIAN/postinst" "$ROOT/DEBIAN/postrm"

mkdir -p "$OUT"
# `fakeroot` so the archive records root ownership without running as root: a
# `.deb` whose files are owned by the build user installs to a home directory's
# worth of wrong permissions.
fakeroot dpkg-deb --root-owner-group --build "$ROOT" "$OUT/$NAME.deb" >/dev/null

# Read the package back rather than trusting the build: `dpkg-deb --info` is what
# `apt` will see, and an `Architecture` it does not recognise is refused at
# install time on the user's machine.
info="$(dpkg-deb --field "$OUT/$NAME.deb" Package Version Architecture)"
echo "package-deb: $info"
echo "package-deb: built $OUT/$NAME.deb"
