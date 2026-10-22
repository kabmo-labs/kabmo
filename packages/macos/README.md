# Kabmo macOS shell (native)

A window around a Kabmo console. The shell is **thin**: it decides which server
the window is on, starts and stops a LOCAL one, and owns the window chrome. Every
product surface is the server's own page — the client is same-origin relative, so
a WKWebView on the real `http://host:port` URL runs it unmodified.

Swift 6 + AppKit + WKWebView, built with SwiftPM. **macOS only, deliberately** —
there is no portable subset to keep honest for another platform, and a framework
in the middle is what the previous two attempts had.

Two other desktop shells are ports of this one rather than second designs: the
same server list, the same ownership rule and the same bridge contract, so
`src/client/lib/desktop/bridge.ts` and everything above it are shared.

- `packages/windows` (.NET 8 + WPF + WebView2) — read that README for the two
  places the platforms genuinely differ: the drag region (`app-region: drag`
  there, a selector hit test here) and the caption buttons (the page draws them
  there, because a WebView2 is an HWND).
- `packages/linux` (Rust + GTK 3 + WebKitGTK 4.1) — the drag region is reported
  by the PAGE there, because `run_javascript` is asynchronous and cannot answer
  inside a press; the edges resize through `begin_resize_drag`; and the window
  geometry is a file, because GTK has no `setFrameAutosaveName`.

## Why native

| | this shell | Electrobun 2 | Electron 45 |
|---|---|---|---|
| `.app` size | **660 KB** | 67 MB | 253 MB |
| main-process RSS | **~40 MB** | ~130 MB | ~420 MB |
| runtime in the bundle | none (system WebKit) | 63.5 MB Bun | 251 MB Chromium |
| drag region | **`NSWindow` → selector hit test** | CSS mirrored by a preload | CSS (`-webkit-app-region`) |
| file drop gives a **path** | **yes** (`NSFilenamesPboardType`) | no | yes (`webUtils.getPathForFile`) |
| languages | Swift | TypeScript | JavaScript |

The measurements are from this machine (macOS 27, arm64), taken against the same
live Kabmo server.

**The drag region is the reason for the rewrite.** In the Electrobun shell the
window could not be moved: its preload rewrites `-webkit-app-region` onto a custom
property by reading stylesheets, and against this app's real page it produced no
rule at all (the mirror held only its own two compatibility classes; the header's
computed value was empty). Here the window asks the page a question instead —
`ShellWindow.sendEvent` evaluates one selector at the press point — so the
behaviour is decided by code that can be read and tested, not by a rewrite of CSS
that may or may not happen.

## Two servers, one window

- **Mode A — local.** The shell spawns `kabmo serve --foreground --port <p>` with
  `posix_spawn` in **its own process group**, then waits for `/api/health` — the
  CLI's own readiness rule, never a parsed log line. Stop signals the GROUP, so
  the PTY shells and plugin children go with it.
- **Mode B — remote.** A URL the user adds. Nothing is spawned.

Both appear in one list, beside the servers **found on this machine**: a
`kabmo serve` in a terminal, `bun run dev` or a login entry writes
`<data>/run/<port>.json` from the process that owns the port, so it is discovered
on every read rather than stored. Those can be connected to but **not** stopped —
this window did not start them.

**The data directory is never overridden.** The managed server inherits the
environment, so its database stays where `kabmo serve` puts it (`~/.kabmo`) and
`kabmo status` keeps seeing the instance the window is on. The shell's own list
lives at `~/Library/Application Support/Kabmo/servers.json` (migrated from
`kabmo-desktop` on first launch, so an existing list survives the rename).

### Ownership is a recorded pid, not a guess

`spawned` in that JSON maps `local:<port>` → the pid **this shell** spawned. It is
the only thing that makes a row `owned`, and the only thing a later launch may
adopt. A force-quit (SIGKILL, a crash, a logout) never runs the window's cleanup,
so its children keep serving — the next launch adopts exactly its own orphans from
that map. A server started by hand answers on a port and appears in the same
records, and is deliberately never adopted: measured in the previous shell, the
panel labelled `Local :7920` — a `bun run src/server/index.ts` — as owned after
the first boot adopted every answering server.

## The window bar

`titleVisibility = .hidden` + `titlebarAppearsTransparent` over a
`fullSizeContentView` window: macOS keeps its traffic lights but draws no title,
so the top 40px of the page is the bar. Everything a native title bar does for
free is then done in `ShellWindow.swift`:

| Gesture | Behaviour |
|---|---|
| press + drag on the bar | moves the window (`sendEvent` → selector → `draggedOrigin`) |
| double-click on the bar | follows `AppleActionOnDoubleClick`: zoom (default), minimise, or nothing |
| right-click on the bar | Move Window / Minimize / Zoom / Enter Full Screen / Close |
| ⌘W ⌘M ⌃⌘F | close, minimise, full screen (`validateUserInterfaceItem` keeps them live) |
| ⌘R / ⌘⇧I / ⌘0 ⌘+ ⌘- | reload, inspector, page zoom |
| green button | full screen; the webview is inset by `safeAreaInsets` so the page does not sit under the menu bar |
| a press on any control in the bar | reaches the control — the selector stops at interactive elements |

- The header carries **`data-drag-region`**; `ShellWindow.sendEvent` evaluates
  `dragRegionSelector` at the press point. The walk stops at any interactive
  element, so a new button in the header is inert by construction rather than by
  remembering to mark it.
- The window then **follows the pointer itself** (`beginDrag` → `draggedOrigin`),
  rather than calling `performWindowDragWithEvent:`. Three bugs were found by
  testing this the hard way, and each is a comment in `ShellWindow.swift`:
  `NSWindow.mouseDown` never runs for a press inside a `WKWebView` (only
  `sendEvent` does); `convert(_:from:)` already answers in the webview's flipped
  geometry, so subtracting the height inverted every probe; and
  `NSEvent.mouseLocation` is the hardware pointer rather than the event, which
  made a posted drag move nothing.
- The leftmost **76px** is behind the traffic lights, so the first header on the
  strip uses `TRAFFIC_LIGHT_INSET` (`src/client/lib/desktop/titlebar.ts`).

## The bridge

The shell injects a user script at document start:

```js
window.__kabmoDesktop = { platform, shellVersion, overlayTitlebar, trafficLightInset }
window.__kabmoCall(method, params) → Promise   // posts to the `kabmo` message handler
window.__kabmoReply(id, ok, payload)           // what the shell evaluates back
```

Commands: `desktop_info`, `servers_state`, `servers_add`, `servers_remove`,
`servers_activate`, `servers_start`, `servers_stop`. There is no capability file
and no per-origin allowance: the shell owns the webview, so the page cannot be
anything but one this window chose to load.

## Build

```bash
cd packages/macos
swift build                              # library + app + test runners
scripts/build-app.sh                     # → build/Kabmo.app
swift run kabmo-desktop-tests            # the rules: 47 checks, no window needed
swift run kabmo-desktop-window-tests     # the drag contract, on a real window
```

The SwiftPM **product** is named `Kabmo`, not `kabmo-desktop`: a process with no
bundle reports its executable's file name, so `swift run kabmo-desktop` put
`kabmo-desktop` in the menu bar (verified with `NSRunningApplication`). Naming the
product `Kabmo` fixes that at the source, and `build-app.sh` copies it to
`Contents/MacOS/Kabmo` so the plist, the binary and the menu bar agree.

`swift build` needs only the Command Line Tools. There is no `xcodebuild` on such
a machine (verified), which is why the `.app` is assembled by
`scripts/build-app.sh` rather than by an Xcode project. `XCTest` ships with Xcode
too, which is why the test suites are plain executables that exit non-zero on a
failure.

### The version

`version.properties` is the ONLY place the shell's version is declared, and it is
read by `release/macos-version.mjs` — the same parser `release/release-macos.mjs`
bumps through, so the number the pipeline publishes and the number the bundle
declares cannot disagree. `build-app.sh` fills `CFBundleShortVersionString` and
`CFBundleVersion` from it.

**Never bump it by hand.** `.github/workflows/release.yml`'s `macos` job runs
`release/release-macos.mjs`, which ranges from the commit that last wrote the
version LINE (`git log -L`) over `packages/macos`, derives the bump level from the
same Conventional Commits rules the app uses, and commits the result. The `chore`
it commits releases nothing on its own.

There is deliberately **no User-Agent token**, unlike the Android and iOS shells.
Those two are downloaded *from the console*, which compares the published asset's
version against the one the running shell reports on every request. A macOS app is
installed by a person from the release page and nothing in the console offers it,
so nothing has to parse it.

### Releasing

`.github/workflows/publish-macos.yml` is a reusable two-phase body, and the split
is the point:

1. **`build`** compiles the package, runs both Swift suites, assembles
   `Kabmo.app`, verifies the version the plist declares and the ad-hoc signature,
   and uploads `kabmo-macos-v<version>.zip` as a run artifact. `release.yml` calls it as
   `macos-build` **before** `app` tags — so a Swift error, a missing toolchain or a
   plist that disagrees with `version.properties` stops the release instead of
   shipping a tag whose GitHub release carries no app.
2. **`attach`** downloads that artifact and uploads it to the release `app`
   created. It builds nothing, so it cannot be the step that discovers a broken
   bundle.

The archive is made with `ditto`, not `zip`: `zip -r` strips the bundle's extended
attributes and code signature, and the result is an app macOS refuses to launch
("damaged") with nothing in the archive to say why.

`app` `needs: macos-build`, so the build is a gate rather than a consequence. The
whole chain is `packages → marketplace → android → ios → windows → macos →
{ipa-build, apk-build} → win-build → macos-build → app`; `tests/ci-gates.test.ts`
pins it.

## What is not done

- **Not signed or notarised.** `build-app.sh` ad-hoc signs (`codesign -s -`),
  which is enough to run locally, and the release asset carries that same ad-hoc
  signature. A person downloading it must allow it once in System Settings →
  Privacy & Security (Gatekeeper refuses an unnotarised app on first launch).
  Distribution without that step needs a Developer ID, a hardened runtime, and
  notarisation.
- **No bundled server.** `resolveLaunch()` prefers `Contents/Resources/server/kabmo`,
  then `kabmo` on `PATH`, then `bun` + a source checkout. Shipping one install
  that needs nothing on `PATH` means building that binary per target — the
  packaging work in `docs/desktop-mobile-packaging-plan.md` (P0).
- **macOS 13+ only.** The window uses `fullSizeContentView` with a transparent
  title bar and `WKWebView.isInspectable`; nothing here was written for, or tested
  on, an older release.
- **No auto-update.** The shell has no updater; replacing it means replacing the
  `.app`.
- **The drag is not driven by a trackpad in CI.** `AXIsProcessTrusted` is false on
  a normal machine, so a synthetic pointer cannot be delivered into another
  process. `kabmo-desktop-window-tests` therefore drives the shipped
  `ShellWindow` with a synthetic press and asserts the origin changes; the
  physical drag was checked by hand.
- **The tray is the server's, not the shell's.** `kabmo serve --tray` still works
  and raises its own icon, but the shell deliberately does not pass `--tray` —
  one app, one icon.
