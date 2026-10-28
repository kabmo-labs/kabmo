#!/usr/bin/env bash
# @license
# SPDX-License-Identifier: MIT
#
# Build the RPM package for the staged directory `build-app.sh` produced.
#
#   packages/linux/scripts/package-rpm.sh <staged-dir> <output-dir> <rpm-arch> <version>
#
# `<rpm-arch>` is RPM's own spelling (`x86_64` / `aarch64`). It differs from
# Debian's (`amd64` / `arm64`) and from the asset's (`x86_64` / `arm64`), which is
# why the caller passes it explicitly rather than this script deriving one from
# another — a `.rpm` whose `Arch:` is wrong installs on nothing.
#
# WHY AN `.rpm` WHEN THERE IS A `.deb`. Fedora, RHEL, Rocky and openSUSE are not
# Debian, and `alien`-converted packages are a support burden nobody wants to own.
# `rpmbuild` is in the Ubuntu archive, so one runner builds both.
#
# The spec is generated rather than kept as a checked-in file: it carries the
# version, the architecture and the staged path, all of which the caller knows and
# a static file would have to be rewritten to express. What a static file WOULD buy
# is reviewable packaging metadata — and that is what `release/linux.test.js`
# asserts instead, against this generator's output.
set -euo pipefail

STAGE="${1:?usage: package-rpm.sh <staged-dir> <output-dir> <rpm-arch> <version>}"
OUT="${2:?usage: package-rpm.sh <staged-dir> <output-dir> <rpm-arch> <version>}"
RPM_ARCH="${3:?usage: package-rpm.sh <staged-dir> <output-dir> <rpm-arch> <version>}"
VERSION="${4:?usage: package-rpm.sh <staged-dir> <output-dir> <rpm-arch> <version>}"

for tool in rpmbuild desktop-file-validate; do
  command -v "$tool" >/dev/null || { echo "package-rpm: $tool is required" >&2; exit 1; }
done

[ -x "$STAGE/Kabmo" ] || { echo "package-rpm: no binary at $STAGE/Kabmo" >&2; exit 1; }
[ -f "$STAGE/kabmo.png" ] || { echo "package-rpm: no icon at $STAGE/kabmo.png" >&2; exit 1; }
[ -f "$STAGE/kabmo.desktop.in" ] || { echo "package-rpm: no launcher template" >&2; exit 1; }
[ -f "$STAGE/mime-types.txt" ] || { echo "package-rpm: no MimeType list beside the template (run build-app.sh)" >&2; exit 1; }
[ -f "$STAGE/LICENSE" ] || { echo "package-rpm: no LICENSE beside the binary (run build-app.sh)" >&2; exit 1; }

PKG=kabmo
NAME="Kabmo-${VERSION}-linux-${RPM_ARCH}"

# ABSOLUTE, and this is not tidiness. `rpmbuild` runs `%install` after a
# `cd` into its own `$TOP/BUILD` (measured: the script's `install -m 755
# packages/linux/build/Kabmo/Kabmo …` failed with "No such file or directory"
# while the same command worked when the caller passed absolute paths), so a
# relative `$STAGE` resolves against rpmbuild's scratch directory, not the
# caller's. The workflow passes relative paths, so this is the shape that
# actually runs.
STAGE="$(cd "$STAGE" && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

TOP="$(mktemp -d)"
trap 'rm -rf "$TOP"' EXIT

# rpmbuild wants its own tree; only SOURCES and BUILDROOT are used here, because
# the spec installs from a directory rather than unpacking a tarball.
mkdir -p "$TOP"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}

# The launcher entry, filled from the same template `install.sh` and the `.deb`
# use. Quoted `Exec` for the reason that script documents: a space is reserved in
# the value and the validator does not catch an unquoted one.
sed \
  -e 's|@EXEC@|"/usr/bin/Kabmo"|g' \
  -e 's|@TRY_EXEC@|/usr/bin/Kabmo|g' \
  -e "s|@ICON@|$PKG|g" \
  -e "s|@MIMETYPES@|$(tr -d '\n' < "$STAGE/mime-types.txt")|g" \
  "$STAGE/kabmo.desktop.in" > "$TOP/kabmo.desktop"
if grep -q '@[A-Z_]*@' "$TOP/kabmo.desktop"; then
  grep -o '@[A-Z_]*@' "$TOP/kabmo.desktop" | sort -u \
    | sed 's/^/package-rpm: unresolved token /' >&2
  exit 1
fi
desktop-file-validate "$TOP/kabmo.desktop" \
  || { echo "package-rpm: the launcher entry is not valid" >&2; exit 1; }

# The runtime dependencies. RPM's package names are the Fedora/RHEL ones, not
# Ubuntu's: `gtk3` and `webkit2gtk4.1`. A spec naming `libgtk-3-0t64` would build
# and then fail to resolve on every machine it is meant for — the build host's
# package names are not the target's.
cat > "$TOP/kabmo.spec" <<SPEC
Name:           $PKG
Version:        $VERSION
Release:        1
Summary:        Web console and diagnostic workbench for AI coding agents
License:        MIT
URL:            https://github.com/kabmo-labs/kabmo
BuildArch:      $RPM_ARCH
Requires:       gtk3
Requires:       webkit2gtk4.1

%description
Kabmo is a native window around the Kabmo console: it starts the server if one is
not already running on the chosen port, remembers the servers you added, and draws
the console in the system's own WebKit view.

%install
rm -rf %{buildroot}
install -d %{buildroot}/usr/bin
install -d %{buildroot}/usr/share/applications
install -d %{buildroot}/usr/share/icons/hicolor/512x512/apps
install -d %{buildroot}/usr/share/licenses/$PKG
install -m 755 $STAGE/Kabmo %{buildroot}/usr/bin/Kabmo
install -m 644 $STAGE/kabmo.png %{buildroot}/usr/share/icons/hicolor/512x512/apps/$PKG.png
install -m 644 $TOP/kabmo.desktop %{buildroot}/usr/share/applications/$PKG.desktop
install -m 644 $STAGE/LICENSE %{buildroot}/usr/share/licenses/$PKG/LICENSE

%files
# `%license` rather than a plain path: RPM tags the file as a licence, which is
# what `dnf repoquery --licenses` and a distro's licence audit read.
%license /usr/share/licenses/$PKG/LICENSE
/usr/bin/Kabmo
/usr/share/applications/$PKG.desktop
/usr/share/icons/hicolor/512x512/apps/$PKG.png

%changelog
* Thu Jan 01 2026 Kabmo Labs <support@kabmo.dev> - $VERSION-1
- Release $VERSION
SPEC

mkdir -p "$OUT"
# `--define "_topdir"` is what keeps this out of `~/rpmbuild`, which does not
# exist on a CI runner and is not writable state a build should depend on.
rpmbuild -bb "$TOP/kabmo.spec" \
  --define "_topdir $TOP" \
  --define "_rpmdir $OUT" \
  --define "_build_id_links none" \
  --define "debug_package %{nil}" \
  >/dev/null

built="$(find "$OUT" -name "$PKG-$VERSION-1*.rpm" -type f | head -1)"
[ -n "$built" ] || { echo "package-rpm: rpmbuild produced no package" >&2; exit 1; }

# Renamed to the release's own scheme. RPM's default is
# `kabmo-<version>-1.<arch>.rpm`, which is correct for a repository and wrong for
# a download page: it says nothing about the platform and sorts differently from
# the `.deb` beside it. The `Release:` is dropped from the name, not from the
# package.
final="$OUT/$NAME.rpm"
mv "$built" "$final"

# Read the package back rather than trusting the build: `Arch:` is what `dnf` and
# `zypper` check, and `Requires:` is what decides whether it can install at all.
echo "package-rpm: $(rpm -qp --qf '%{NAME} %{VERSION} %{ARCH}\n' "$final")"
echo "package-rpm: requires $(rpm -qp --requires "$final" | grep -E '^(gtk3|webkit2gtk4.1)' | tr '\n' ' ')"
echo "package-rpm: built $final"
