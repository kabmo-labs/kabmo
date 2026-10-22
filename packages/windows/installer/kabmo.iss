; @license
; SPDX-License-Identifier: Apache-2.0
;
; The Windows installer, built by Inno Setup (`ISCC.exe`, preinstalled on the
; `windows-latest` runner — verified against actions/runner-images: "InnoSetup
; 6.7.1" on both Windows 2022 and 2025).
;
; WHY AN INSTALLER AND NOT A ZIP. A ZIP asks the user to unpack it somewhere and
; remember where, and it leaves no entry in Add/remove programs, no Start-menu
; entry and no uninstaller — so "how do I get rid of this" has no answer, and
; "which version am I on" has no answer either. Each desktop shell ships the
; shape its platform expects: a `.app` in a `.zip` on macOS (that IS the macOS
; convention), a `.tar.gz` on Linux (which has no installer convention), and an
; installer here, because Windows has one.
;
; WHY INNO SETUP AND NOT MSIX. MSIX requires a certificate bound to a publisher
; identity; without one Windows refuses the package, and a self-signed one shows
; a certificate warning before the installer will run at all. Inno Setup produces
; an ordinary `.exe` that installs unsigned (SmartScreen warns — see the README),
; installs per-user so no elevation prompt appears, and uninstalls cleanly. When
; a real certificate exists, signing is `SignTool=` here plus a step in
; `publish-windows.yml`; nothing else changes.
;
; `PrivilegesRequired=lowest` is deliberate: the app writes only to
; `%APPDATA%\Kabmo` and `%LOCALAPPDATA%\Kabmo\webview` (see `Persisted.cs` and
; `ShellHost.cs`), so it never needs administrator rights. An installer that
; demanded them for a per-user app would ask for a permission it does not use.

#define AppName "Kabmo"
#define AppExe "Kabmo.exe"
#define AppPublisher "Kabmo Labs"
#define AppUrl "https://github.com/kabmo-labs/kabmo"

; Filled by the build: `publish-windows.yml` passes /DAppVersion=<version> on the
; ISCC command line, where <version> comes from `release/windows-version.mjs` —
; the same file the assembly's own version is read from. Never a second copy.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\..\build\Kabmo"
#endif

[Setup]
; A STABLE AppId is what makes an upgrade an upgrade: Inno finds the previous
; install by this value and replaces it. A generated one would install a second
; copy beside the first — two Start-menu entries, two uninstallers, two copies of
; the same app.
AppId={{92360501-B797-4DE3-8EBA-9CC6313C62BC}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases

; Per-user install: no elevation prompt, and the app's own data directories are
; already per-user.
PrivilegesRequired=lowest
; `dialog` (which implies `commandline`) lets a user who wants a machine-wide
; install say so, or pass `/ALLUSERS`. The DEFAULT stays per-user, so the ordinary
; case never sees a UAC prompt.
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes

; x64 only: the publish step builds `win-x64`, and an installer that also ran on
; arm64 would advertise a build that does not exist.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; WebView2's Evergreen Runtime requires Windows 10 1803 or newer. Stated as a
; floor rather than a note in the README: an install that succeeds on an older
; build produces a window that never paints, with no error on screen.
MinVersion=10.0.17763

OutputDir=..\..\..\build\installer
OutputBaseFilename=kabmo-windows-v{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName} {#AppVersion}

; The app is a single process; a running copy must be closed before its files are
; replaced, and Inno can ask the user to do that instead of failing with a
; sharing violation.
CloseApplications=yes
RestartApplications=no

[Tasks]
; A desktop shortcut is a choice, not a default: the Start-menu entry is enough
; for a console, and a shortcut nobody asked for is clutter on the desktop.
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
; The whole publish output: `Kabmo.exe`, its managed assemblies, the WebView2
; loader (`WebView2Loader.dll`) and, when the build bundled one, `server\`.
; `recursesubdirs` is what carries `server\` — the bundled Kabmo server the
; window starts on a machine with no `kabmo` on PATH.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; Offered, not forced: a checkbox on the final page. `postinstall` runs it after
; the files are in place; `skipifsilent` keeps an unattended install from
; launching a GUI.
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The webview's own user-data folder is written by WebView2, not by the
; installer, so Inno would otherwise leave it behind. It is a CACHE (cookies,
; local storage for the console's own pages) — not the app's server list, which
; lives in `%APPDATA%\Kabmo\servers.json` and is deliberately NOT deleted: a user
; who reinstalls should find their servers still listed.
Type: filesandordirs; Name: "{localappdata}\Kabmo\webview"

[Code]
const
  // The WebView2 Evergreen Runtime's product id. Both the per-machine and the
  // per-user installs register under it, and on a 64-bit install the per-machine
  // one is under WOW6432Node.
  WebView2Client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function WebView2Version(RootKey: Integer; const SubKey: String): String;
var
  Value: String;
begin
  Result := '';
  if RegQueryStringValue(RootKey, SubKey, 'pv', Value) then
    Result := Value;
end;

function WebView2Installed: Boolean;
begin
  // Per-machine (64-bit view, then the 32-bit view an x64 app sees).
  Result :=
    (WebView2Version(HKLM64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2Client) <> '') or
    (WebView2Version(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2Client) <> '') or
    // Per-user — the shape a user who installed Edge themselves has.
    (WebView2Version(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\' + WebView2Client) <> '');
end;

function InitializeSetup(): Boolean;
begin
  // A missing runtime is not a reason to refuse the install — Windows 11 ships it
  // and Windows Update installs it on 10 — but it IS the reason the app would
  // open a blank window with nothing to explain it, so the user is told BEFORE
  // they install rather than after they run it.
  Result := True;
  if not WebView2Installed then
  begin
    if MsgBox(
      'The Microsoft Edge WebView2 Runtime was not found on this machine.' + #13#10#13#10 +
      'Kabmo draws its window with it. Windows 11 includes it, and on Windows 10 it ' +
      'arrives through Windows Update — or you can install it from ' +
      'https://developer.microsoft.com/microsoft-edge/webview2/' + #13#10#13#10 +
      'Continue anyway?',
      mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;
