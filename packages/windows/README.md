# Kabmo desktop shell (Windows, native)

A window around a Kabmo console, for Windows. The app is called **Kabmo** — the
executable, the Start-menu entry and the taskbar all read `Kabmo`, the same name
the macOS shell ships (`Kabmo.app`). Its project is `KabmoDesktop.App` and its
library `KabmoDesktop`; a project name is a build-time fact, and the assembly
name is what a user sees.
which server the window is on, starts and stops a LOCAL one, and owns the window
chrome. Every product surface is the server's own page — the client is
same-origin relative, so a WebView2 on the real `http://host:port` URL runs it
unmodified.

.NET 8 + WPF + WebView2. It is the **port of `packages/macos`** (the macOS
shell), not a second design: the same server list, the same ownership rule, the
same bridge contract and the same launch behaviour, so the client cannot tell
which shell it is talking to and nothing above `src/client/lib/desktop/` had to
fork. `packages/linux` (Rust + GTK 3 + WebKitGTK 4.1) is the third port and makes
the same call, with two platform-forced differences: the page reports the drag
(its `run_javascript` is asynchronous, so a press cannot be classified in GTK's
handler), and the window geometry is a file because GTK has no
`setFrameAutosaveName`.

## Why WPF and not WinForms

One reason, and it decides the rest: `WindowChrome` gives a borderless window the
edge/corner resize border and the **correct maximised geometry**. A bare
`WindowStyle = None` window on WinForms or WPF covers the taskbar and cannot be
dragged down from maximised, and every hand-written fix for that is a
`WM_GETMINMAXINFO` handler per DPI. WPF's `WindowChrome` already answers it.

| | this shell | macOS shell | Electron |
|---|---|---|---|
| runtime in the bundle | none (system WebView2) | none (system WebKit) | 251 MB Chromium |
| chrome | `WindowChrome` (resize + snap) | `NSWindow` subclass | CSS `-webkit-app-region` |
| drag region | **`app-region: drag`** (WebView2 non-client regions) | selector hit test in `sendEvent` | CSS |
| file drop gives a **path** | yes (`e.Data` → `FileDrop`) | yes (`NSFilenamesPboardType`) | yes |
| language | C# | Swift | JavaScript |

## Two servers, one window

- **Mode A — local.** The shell spawns `kabmo serve --foreground --port <p>` in a
  **job object** of its own, then waits for `/api/health` — the CLI's own
  readiness rule, never a parsed log line. Stop terminates the job, so the PTY
  shells and plugin children go with it.
- **Mode B — remote.** A URL the user adds. Nothing is spawned.

Both appear in one list, beside the servers **found on this machine**: a
`kabmo serve` in a terminal, `bun run dev` or a login entry writes
`%USERPROFILE%\.kabmo\run\<port>.json` from the process that owns the port, so it
is discovered on every read rather than stored. Those can be connected to but
**not** stopped — this window did not start them.

**The data directory is never overridden.** The managed server inherits the
environment, so its database stays where `kabmo serve` puts it and
`kabmo status` keeps seeing the instance the window is on. The shell's own list
lives at `%APPDATA%\Kabmo\servers.json`, beside the webview's own user data
folder (`%LOCALAPPDATA%\Kabmo\webview`) — one folder name per install, the
app's.

### Ownership is a recorded pid, not a guess

`spawned` in that JSON maps `local:<port>` → the pid **this shell** spawned. It is
the only thing that makes a row `owned`, and the only thing a later launch may
adopt. A force-quit (SIGKILL-equivalent, a crash, a logout) never runs the
window's cleanup, so its children keep serving — the next launch adopts exactly
its own orphans from that map. A server started by hand answers on a port and
appears in the same records, and is deliberately never adopted: measured in the
macOS shell, the panel labelled a `bun run src/server/index.ts` as owned after the
first boot adopted every answering server.

## The window bar

`WindowStyle = None` + `WindowChrome { CaptionHeight = 0, UseAeroCaptionButtons =
false, ResizeBorderThickness = 6 }`: the page owns the top 40px and Windows owns
the edges.

- The header carries **`data-drag-region`** and `app-region: drag`, which WebView2
  turns into `HTCAPTION` once `IsNonClientRegionSupportEnabled` is on — so the
  system menu, double-click-to-maximise and the drag all come from the platform.
  The client's `titlebar-drag-region` class already declares the property; it is
  the same one the installed PWA uses for its Window Controls Overlay.
- **`WebView2`, not `WebView2CompositionControl`.** The composition control would
  compose with WPF and remove the airspace workaround (the splash hides the
  webview instead of layering over it), but it does **not** support non-client
  regions — `app-region: drag` is ignored there and the window becomes
  unmovable by its own header, which is the exact failure the macOS shell was
  rewritten to fix.
- **The three caption buttons are drawn by the PAGE** (`WindowControls`), because
  a WebView2 is an HWND and no WPF element can be painted on top of it. The
  shell says so with `windowControls: true` in its identity, and the navbar
  renders them only there. **Snap Layouts is the one thing a page-drawn maximise
  button cannot offer** — that is a real loss against the native bar, and it is
  stated here rather than hidden.
- The shell reports **no** left inset (`trafficLightInset` is macOS-only), so the
  navbar's padding is its own. Charging macOS's 76px to this platform is the bug
  `src/shared/lib/desktop/titlebar.test.ts` pins.

## The bridge

The shell injects a user script at document start:

```js
window.__kabmoDesktop = { platform, shellVersion, overlayTitlebar, windowControls }
window.__kabmoCall(method, params) → Promise   // posts over chrome.webview
window.__kabmoReply(id, ok, payload)           // what the shell evaluates back
```

Commands: `desktop_info`, `servers_state`, `servers_add`, `servers_remove`,
`servers_activate`, `servers_start`, `servers_stop`, plus the window verbs
`window_minimize`, `window_maximize`, `window_close`. There is no capability file
and no per-origin allowance: the shell owns the webview, so the page cannot be
anything but one this window chose to load.

The transport is the **same contract the macOS shell installs** over
`WKScriptMessageHandler`, so `src/client/lib/desktop/bridge.ts` is shared
verbatim.

## Build

```bash
# any machine with the .NET 8 SDK — including macOS and Linux
scripts/check.sh                  # compile every project + run the rules suite
scripts/check.sh --build          # compile only

# Windows
dotnet build KabmoDesktop.sln
dotnet run --project src/KabmoDesktop.App        # → Kabmo.exe
powershell -File scripts/build-app.ps1            # → build/Kabmo/Kabmo.exe
powershell -File scripts/build-app.ps1 -ServerPath <path-to-compiled-server.exe>
```

`EnableWindowsTargeting` is what makes the cross-platform compile possible: the
window's own targets cannot RUN off-Windows (WebView2 is an OS component), but
they compile, which is the gate worth having on a machine that is not Windows.

`src/KabmoDesktop` is `net8.0` with no Win32 at all — that is what lets the rules
suite run anywhere, and it is the same split the macOS shell makes between its
library and its executable.

## Release

The version lives in `version.properties` — the ONE place it is declared. The
`windows` job of `.github/workflows/release.yml` bumps it from the Conventional
Commits touching `packages/windows` (a `fix` is a patch, a `feat` a minor), and
`publish-windows.yml` builds the ZIP and attaches it to the app's release.

```bash
node release/windows-version.mjs      # the declared version
node release/release-windows.mjs      # bump it, when the shell changed (CI does this)
```

The csproj reads that file itself (`ReadShellVersion`), so the assembly's
`Version` — which the shell reports to the page as `shellVersion` — and the asset
name cannot disagree. A literal version in the project file is a second source,
and `release/windows.test.js` fails on it.

There is deliberately **no download offer in the console and no User-Agent
token**, unlike the Android and iOS shells: those are downloaded from the console,
so the server reads their published version on every request. A desktop app is
installed by hand from the release page, so a token would be a channel with no
reader. `packages/macos` makes the same call.

## The installer

`build-app.ps1` and `publish-windows.yml` produce
`kabmo-windows-v<version>-setup.exe` from `installer/kabmo.iss` (Inno Setup 6,
preinstalled on `windows-latest`).

What makes it an installer rather than a renamed archive, and each of these is
asserted by `release/windows.test.js`:

- **an uninstaller and an Add/remove-programs entry**, so "how do I remove it"
  has an answer;
- **a Start-menu entry** (and an optional desktop shortcut);
- **a stable `AppId`**, so a second release UPGRADES the install instead of
  placing a second copy beside it with two entries and two uninstallers;
- **`PrivilegesRequired=lowest`** — the app writes only to `%APPDATA%\Kabmo` and
  `%LOCALAPPDATA%\Kabmo\webview`, so the ordinary install shows no UAC prompt.
  A user who wants a machine-wide install can say so (`/ALLUSERS`);
- **a WebView2 check before anything is copied**, naming the runtime and where to
  get it — a missing runtime is why the window would paint nothing, and saying so
  up front beats a blank window later;
- **`MinVersion=10.0.17763`**, the floor the Evergreen Runtime needs.

The version is passed to the compiler as `/DAppVersion=<v>` from
`version.properties`, never written into the `.iss`, and the workflow re-reads it
off the built file's own `ProductVersion` before uploading.

## What is not done

- **No signing.** The installer is unsigned: SmartScreen shows "Windows protected
  your PC" until it has enough reputation, and a user clicks *More info → Run
  anyway*. Fixing that needs a code-signing certificate; when one exists, it is
  `SignTool=` in `kabmo.iss` plus one step in `publish-windows.yml`. There is no
  MSIX for the same reason — MSIX requires a certificate bound to a publisher
  identity and refuses to install without one.
- **No bundled server by default.** `LaunchPlan.Resolve()` prefers
  `server\kabmo.exe` beside the app, then `kabmo` on `PATH`, then `bun` + a source
  checkout. Shipping one install that needs nothing on `PATH` means building that
  binary — `docs/desktop-mobile-packaging-plan.md` (P0) has the measured layout.
- **Snap Layouts is unavailable on the maximise button** (see above).
- **No auto-update.** The shell has no updater; replacing it means replacing the
  folder.
- **The window is not driven by a synthetic pointer in CI.** What can be wrong
  without a window — the server list's rules, the probe, the record reader, the
  wire shape the client parses — is unit-tested; the window itself needs a
  Windows desktop session.
- **The tray is the server's, not the shell's.** `kabmo serve --tray` still works
  and raises its own icon, but the shell deliberately does not pass `--tray` —
  one app, one icon.
