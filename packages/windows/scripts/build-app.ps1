# @license
# SPDX-License-Identifier: Apache-2.0
#
# Assemble a runnable folder around the published app.
#
# It produces the INSTALLER (`build/installer/kabmo-windows-v<v>-setup.exe`) by
# compiling `packages/windows/installer/kabmo.iss` with Inno Setup, and leaves the
# plain folder beside it for a developer who just wants to run the app.
#
# Signing is the one thing it does NOT do: a distributable needs a code-signing
# certificate this repository does not carry, and a script that pretended to make
# one would be a script that fails on every machine but the author's. An unsigned
# installer runs — SmartScreen warns — which is the honest shape without a
# certificate.
#
# The folder it publishes is `Kabmo.exe`, its dependencies,
# the WebView2 loader, and — when the server binary exists — the bundled server
# the window starts on a machine with no `kabmo` on PATH.
#
# Usage:  scripts/build-app.ps1 [-Configuration Release] [-ServerPath <exe>]
#
# Requires the .NET 8 SDK. WebView2 itself is an OS component (the Evergreen
# Runtime ships with Windows 11 and is installed by Windows Update on 10); the
# package only carries the loader.

param(
  [string]$Configuration = 'Release',
  [string]$ServerPath = ''
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $PSScriptRoot
$out = Join-Path $here "build/Kabmo"

$version = (& node (Join-Path $here '../../release/windows-version.mjs')).Trim()
if (-not $version) { throw 'version.properties declares no versionName' }
Write-Host "building $Configuration (shell version $version)"
dotnet publish (Join-Path $here 'src/KabmoDesktop.App/KabmoDesktop.App.csproj') `
  -c $Configuration `
  -r win-x64 `
  --self-contained false `
  -p:PublishSingleFile=false `
  -o $out | Out-Host

if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }

# The bundled server, when the caller built one. `resolveLaunch()` in
# `Supervisor.cs` looks for `server\kabmo.exe` beside the app FIRST, so this is
# what makes the window self-contained.
if ($ServerPath -and (Test-Path $ServerPath)) {
  $serverDir = Join-Path $out 'server'
  New-Item -ItemType Directory -Force -Path $serverDir | Out-Null
  Copy-Item $ServerPath (Join-Path $serverDir 'kabmo.exe') -Force
  Write-Host "bundled server: $ServerPath"

  # The compiled server resolves its assets from the PACKAGE directory
  # (`docs/desktop-mobile-packaging-plan.md`, "Shipping the server binary"), and
  # `import.meta.dir` inside a compiled binary is `/$bunfs/root` — so `public/`,
  # `marketplace/` and the font sources have to sit beside it.
  $repo = Split-Path -Parent (Split-Path -Parent $here)
  foreach ($dir in @('public', 'marketplace', 'src')) {
    $source = Join-Path $repo $dir
    if (Test-Path $source) {
      Copy-Item $source (Join-Path $serverDir $dir) -Recurse -Force
    }
  }
} else {
  Write-Host "no bundled server: the window will look for 'kabmo' on PATH"
}

$exe = Join-Path $out 'Kabmo.exe'
if (-not (Test-Path $exe)) { throw "publish did not produce $exe" }
Write-Host "built $exe"

# The installer. `ISCC.exe` comes with Inno Setup 6; the CI runner has it
# preinstalled, and a developer needs https://jrsoftware.org/isdl.php.
$iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'
if (Test-Path $iscc) {
  & $iscc "/DAppVersion=$version" "/DSourceDir=$out" (Join-Path $here 'installer/kabmo.iss')
  if ($LASTEXITCODE -ne 0) { throw "ISCC failed ($LASTEXITCODE)" }
  Write-Host "built $(Join-Path $here "build/installer/kabmo-windows-v$version-setup.exe")"
} else {
  Write-Host "Inno Setup not found — skipping the installer; $out is runnable as-is"
}
