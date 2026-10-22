#!/usr/bin/env bash
# @license
# SPDX-License-Identifier: Apache-2.0
#
# The two things a NON-Windows machine can check, in one command.
#
# The window itself needs Windows: WebView2 is an OS component, and the WPF
# targets cannot run here. What CAN be checked off-Windows is the part that
# decides things — the server list's rules, the probe, the record reader, the
# title-bar arithmetic — plus that the window and the app COMPILE for their
# target. `EnableWindowsTargeting` is what makes the second half possible, and
# it is why the compile gate is worth having at all.
#
# Usage:  scripts/check.sh          # build + rules suite
#         scripts/check.sh --build  # build only
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DOTNET="${DOTNET:-dotnet}"
if ! command -v "$DOTNET" >/dev/null 2>&1; then
  if [ -x "$HOME/.dotnet/dotnet" ]; then DOTNET="$HOME/.dotnet/dotnet"; else
    echo "dotnet not found — install the .NET 8 SDK" >&2
    exit 1
  fi
fi

export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

"$DOTNET" build "$HERE/KabmoDesktop.sln" -v q
if [ "${1:-}" = "--build" ]; then exit 0; fi

"$DOTNET" run --project "$HERE/tests/KabmoDesktop.Tests.csproj"
