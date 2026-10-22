#!/usr/bin/env bash
# @license
# SPDX-License-Identifier: Apache-2.0
#
# Install the Kabmo desktop shell for the current user.
#
#   ./install.sh                 → ~/.local (no root needed)
#   PREFIX=/usr ./install.sh     → a system-wide install (run with sudo)
#   ./install.sh --uninstall     → remove what this script installed
#
# Three files are placed, and the launcher entry is GENERATED rather than shipped
# ready-made:
#
#   $PREFIX/bin/Kabmo
#   $PREFIX/share/icons/hicolor/512x512/apps/kabmo.png
#   $PREFIX/share/applications/kabmo.desktop
#
# **The entry cannot be shipped pre-written, and that was a real bug.** A desktop
# entry's `Exec` takes an absolute path, and a tarball unpacks anywhere — so the
# only way to name the binary is to know where it landed. The first version tried
# to dodge that with `Exec=sh -c 'exec "$(dirname "$1")/Kabmo"' sh %k`, and
# `desktop-file-validate` rejects it: the Desktop Entry spec has no single quotes,
# and `$` must be escaped inside a quoted argument. Measured:
#
#   error: value "sh -c 'exec "$(dirname "$1")/Kabmo"' sh %k" for key "Exec"
#          contains a reserved character ''' outside of a quote
#
# An invalid entry is not a loud failure: the launcher simply shows the app and
# does nothing when it is clicked, which reads as a broken app rather than a
# broken file. So the entry is written HERE, from `kabmo.desktop.in`, with the
# paths this script just chose — and validated before it is installed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"
APP_ID="kabmo"
WM_CLASS="Kabmo"

BIN_DEST="$PREFIX/bin/Kabmo"
ICON_DIR="$PREFIX/share/icons/hicolor/512x512/apps"
ICON_DEST="$ICON_DIR/$APP_ID.png"
ENTRY_DIR="$PREFIX/share/applications"
ENTRY_DEST="$ENTRY_DIR/$APP_ID.desktop"

say() { printf '%s\n' "$*"; }

# A path as one `Exec` ARGUMENT.
#
# The Desktop Entry spec's reserved set includes SPACE, and `desktop-file-validate`
# does not catch an unquoted one — measured: it accepts
# `Exec=/tmp/my prefix/bin/Kabmo` while a launcher reads that as two arguments and
# starts nothing. So the value is always quoted, with the four characters the spec
# requires escaped inside a quoted argument.
exec_argument() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\`/\\\`}"
  value="${value//\$/\\\$}"
  printf '"%s"' "$value"
}

die() { printf 'install: %s\n' "$*" >&2; exit 1; }

refresh_caches() {
  # Best-effort: a desktop without these tools still finds the entry on its next
  # menu rebuild, and failing the install over a cache refresh would be worse than
  # a menu that updates a little later.
  command -v update-desktop-database >/dev/null 2>&1 \
    && update-desktop-database "$ENTRY_DIR" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 \
    && gtk-update-icon-cache -q -t "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true
}

uninstall() {
  rm -f "$BIN_DEST" "$ICON_DEST" "$ENTRY_DEST"
  refresh_caches
  say "removed Kabmo from $PREFIX"
  # The shell's own state is deliberately kept: `$XDG_CONFIG_HOME/Kabmo` holds the
  # server list, and removing an app is not the same decision as forgetting which
  # servers you added. Say where it is so the user can decide.
  say "  server list kept at ${XDG_CONFIG_HOME:-$HOME/.config}/Kabmo/servers.json"
}

if [ "${1:-}" = "--uninstall" ]; then
  uninstall
  exit 0
fi

[ -x "$HERE/Kabmo" ] || die "no Kabmo binary beside this script (expected $HERE/Kabmo)"
[ -f "$HERE/kabmo.desktop.in" ] || die "no kabmo.desktop.in beside this script"
[ -f "$HERE/kabmo.png" ] || die "no kabmo.png beside this script"

mkdir -p "$PREFIX/bin" "$ICON_DIR" "$ENTRY_DIR"

install -m 755 "$HERE/Kabmo" "$BIN_DEST"
install -m 644 "$HERE/kabmo.png" "$ICON_DEST"

# The substitution is on `@PLACEHOLDER@` tokens rather than on a template with
# example paths: a placeholder cannot be confused with a real path, and a token
# the template forgot to use fails the check below instead of silently shipping an
# entry that launches nothing.
EXEC_ARG="$(exec_argument "$BIN_DEST")"
# `TryExec` is a PATH, never an argument list — quoting it would make the desktop
# environment look for a file whose NAME starts with a quote.
# `sed`'s replacement treats `&` and `\` specially, and a quoted path may contain
# either. Escaping them for `sed` is what keeps the value byte-identical.
sed_replacement() { printf '%s' "$1" | sed -e 's/[&\\|]/\\&/g'; }

sed \
  -e "s|@EXEC@|$(sed_replacement "$EXEC_ARG")|g" \
  -e "s|@TRY_EXEC@|$(sed_replacement "$BIN_DEST")|g" \
  -e "s|@ICON@|$APP_ID|g" \
  "$HERE/kabmo.desktop.in" > "$ENTRY_DEST"

# An unresolved token means the template and this script disagree, and the entry
# would launch a path literally called `@EXEC@`.
if grep -q '@[A-Z_]*@' "$ENTRY_DEST"; then
  grep -o '@[A-Z_]*@' "$ENTRY_DEST" | sort -u | sed 's/^/install: unresolved token /' >&2
  rm -f "$ENTRY_DEST"
  die "the launcher entry has unresolved placeholders; refusing to install it"
fi

chmod 644 "$ENTRY_DEST"

# Validate when the tool exists. This is the check that would have caught the
# quoted `sh -c` form, so it is not optional when it is available.
if command -v desktop-file-validate >/dev/null 2>&1; then
  if ! desktop-file-validate "$ENTRY_DEST"; then
    rm -f "$ENTRY_DEST"
    die "the generated launcher entry is not valid; nothing was installed"
  fi
fi

# The window manager matches the running window against `StartupWMClass`, which is
# the CLASS half of `WM_CLASS` — measured on a running window:
# `WM_CLASS(STRING) = "Kabmo", "Kabmo"`. A mismatch leaves a second, iconless
# taskbar entry beside the launcher's own.
grep -qx "StartupWMClass=$WM_CLASS" "$ENTRY_DEST" \
  || die "the entry's StartupWMClass is not $WM_CLASS"

refresh_caches

say "installed Kabmo to $PREFIX"
say "  $BIN_DEST"
say "  $ICON_DEST"
say "  $ENTRY_DEST"
say ""
say "Launch it from your applications menu, or run $BIN_DEST"
