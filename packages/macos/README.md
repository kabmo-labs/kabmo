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
| file drop gives a **path** | **yes** — the SHELL reads the pasteboard (`DroppedPaths.swift`); the page gets bytes only | no | yes (`webUtils.getPathForFile`) |
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
| ⌘C ⌘V ⌘X ⌘Z ⌘⇧Z ⌘A | copy, paste, cut, undo, redo, select all — **only because of the Edit menu** |
| ⌘, (Settings…) | opens the console's own Settings modal; the shell dispatches `omp:open-settings` and never reloads the page |
| green button | full screen; the webview is inset by `safeAreaInsets` so the page does not sit under the menu bar |
| a press on any control in the bar | reaches the control — the selector stops at interactive elements |

### Settings › asks the page, because every settings screen is a modal

There is no native panel to build: Appearance, Providers, Plugins, Skills and the
rest are all rendered by the client. So the row's whole job is to dispatch the
event both layouts already listen for — `omp:open-settings`, in
`PageEvents.swift`. `useSettingsModal` handles it on the desktop and
`LayoutWrapper` on the phone, so one event is enough for both.

It used to append `?settings=1` and load the URL again, and **nothing on the
client reads that parameter**: the modal never opened, while the live document
went away — a running turn, the composer draft and the timeline's scroll
position with it. The Linux shell had already sent the event; this shell simply
was not using it.

`runSettingsMenuCases` in `TestsWindow/main.swift` dispatches the shipped script
into a real page and asserts the listener fired once and the document survived.
Restoring the reload fails four cases, including the typing ones that follow,
because the page was replaced.

### The Edit menu is what gives the page its clipboard chords

**A `WKWebView` receives no ⌘C / ⌘V / ⌘X / ⌘Z / ⌘A at all unless the app's menu
bar declares those key equivalents in an Edit menu.** The web view is the first
responder and it does see the `keydown` (a page can read `metaKey` and
`key === 'v'`), but the edit COMMANDS travel through the menu system: with no
menu item claiming the chord, AppKit never asks the responder chain, so `paste:`
never runs and the page's own `paste` event never fires either. The shell built
App, File, View and Window and nothing else, so the console's composer silently
ignored the keyboard's clipboard chords.

Measured on this SDK against a bare `WKWebView` and the same window with the
menu below:

| | no Edit menu | with the Edit menu |
|---|---|---|
| ⌘V | field unchanged, no `paste` event | `paste-proof` |
| ⌘A | selection `4-4` (unchanged) | `0-11` |
| ⌘C | pasteboard `nil` | `paste-proof` |
| ⌘X | `alpha` left in the field | field empty, text on the pasteboard |
| ⌘Z / ⌘⇧Z | no undo, no redo | `hi` → empty → `hi` |

Three details are load-bearing, and each fails silently:

- **`undo:`/`redo:` have no AppKit-declared selector** (they are `NSResponder`'s
  informal protocol — not in any public header), so they are spelled as strings.
  `NSText`'s `cut:` / `copy:` / `paste:` / `delete:` / `selectAll:` are declared
  and used as selectors, so a typo is a compile error rather than a dead row.
- **`Redo` carries `⌘⇧Z` explicitly.** A menu item's default mask is `.command`,
  so `keyEquivalent: "z"` alone would collide with Undo and the row would be
  unreachable.
- **`validateUserInterfaceItem` must allow the rows.** The window answered `false`
  for every action it did not name itself, and `undo:`/`redo:` resolve against
  the WINDOW (measured: `NSApp.target(forAction:)` answers `NSWindow` for those
  two and `WKWebView` for the other five) whose own default answer is `false` —
  so the menu was built, the chords were declared, and ⌘Z still did nothing.
  `editMenuHandles(_:)` is that gate, in `EditMenu.swift` beside the table.
- **The menu is BUILT by the library, not by `App.swift`.** `buildEditMenu()` is
  what both the app and the window suite install, so the suite exercises the
  shipped rows; a suite that declared its own chords would pass while the app's
  menu was missing one, which is how the whole Edit menu came to be missing.
- **The suite does NOT drive the chords as key equivalents, because it cannot
  reliably.** A key equivalent reaches the responder chain only through the KEY
  WINDOW, and a non-bundled test executable cannot make itself the active app:
  measured over eight runs, `NSApp.activate(ignoringOtherApps: true)` left
  `isActive == false` in most of them (and `true` in others), so the eight
  chord-driven cases flapped while asserting nothing about the shell. What the
  shell owns is asserted directly instead, and it is deterministic: the app's own
  menu bar carries the Edit rows in order, each declares its chord and modifier
  mask, each routes to the shipped selector, `validateUserInterfaceItem` enables
  every row, and each selector performs its verb on the responder the platform
  routes it to. Removing the menu fails **24** of those checks.
- **The TARGET of each verb is named, not looked up.** `undo:`/`redo:` reach the
  WINDOW and the other five reach the WEB VIEW — `NSApp.target(forAction:)` says
  so (it answers `NSWindow` for those two and `WKWebView` for the rest), and a
  `WKWebView` does not implement `undo:` at all: sending it directly raises
  `unrecognized selector` (measured). Resolving through `target(forAction:)`
  instead walks the key window's chain and is nil in exactly the runs where the
  app failed to activate, which is the same flake in a different place.

`TestsWindow/main.swift` drives every one of these into a real `WKWebView`, and
the undo case runs FIRST: WebKit keeps one undo stack per document, so an earlier
edit (a cut) would be the thing undo reaches — measured, the field came back as
`cut-me` instead of the typing.

- The header carries **`data-drag-region`**; `ShellWindow.sendEvent` evaluates
  `dragRegionSelector` at the press point. The walk stops at any interactive
  element, so a new button in the header is inert by construction rather than by
  remembering to mark it.
- **The traffic lights are asked about FIRST.** The page marks the whole header,
  including the 76px it reserves for the buttons, so a press on close / minimise
  / zoom reads as a drag handle to `elementFromPoint` — and claiming it there
  left all three unclickable while the same strip still moved the window.
  `hitsStandardButton(at:)` tests `standardWindowButton(_:)` in window
  coordinates (they live in the private titlebar container, not `contentView`)
  and lets the press through to the button.
- The window then **follows the pointer itself** (`beginDrag` → `draggedOrigin`),
  rather than calling `performWindowDragWithEvent:`. Three bugs were found by
  testing this the hard way, and each is a comment in `ShellWindow.swift`:
  `NSWindow.mouseDown` never runs for a press inside a `WKWebView` (only
  `sendEvent` does); `convert(_:from:)` already answers in the webview's flipped
  geometry, so subtracting the height inverted every probe; and
  `NSEvent.mouseLocation` is the hardware pointer rather than the event, which
  made a posted drag move nothing.
- **The frame's resize band is asked about BEFORE the page**, and that ordering is
  why diagonal resizing works. `fullSizeContentView` puts the page under the bar,
  so the page marks its whole top 40px — including the strip along the top edge
  and around both top corners that `NSThemeFrame` reserves for dragging the
  window's SIZE. Measured through the real window, a press at `(1, H-1)`,
  `(6, H-6)`, `(W-1, H-1)` and `(W/2, H-1)` all read as "the page says drag
  handle" and started a window MOVE, so every diagonal resize moved the window
  instead of resizing it — while the bottom, left and right edges kept working,
  because the page marks nothing there. `frameOwnsPress(at:)` asks the frame's own
  `hitTest` (the band's thickness is AppKit's: measured 3px along the top edge,
  4px along the bottom and the sides, 8px into the top-left corner where the close
  button's margin is reserved), and `sendEvent` breaks out of the claim so the
  platform's own resize loop takes the press.
- The leftmost **76px** is behind the traffic lights, so the first header on the
  strip uses `TRAFFIC_LIGHT_INSET` (`src/client/lib/desktop/titlebar.ts`).


## The launch splash

From the moment the window opens until the console paints, the shell draws the same
four things the Android and iOS shells draw: the **wordmark**, a **progress bar**,
one sentence, and — on a failure — **Retry**.

It is a sibling of the webview, never a view inside the page: the page cannot report
its own readiness (its bundle is what renders the app), and a page-drawn splash would
vanish exactly when the page fails to load.

- **The wordmark is the artwork `README.md` embeds.** `Wordmark.swift` is GENERATED
  from `public/kabmo-wordmark.svg` by `scripts/shell-wordmark.mjs`, and
  `SplashTests` re-derives every number from that file — the viewBox, the shift, each
  path verbatim, the plate, the gradient, the stroke weight and the inks — then
  rasterizes the mark to assert ink where the artwork has ink and none where it does
  not. Two hand copies of one drawing is exactly the shape that drifts silently.
- **The bar is indeterminate until a real estimate arrives.** `estimatedProgress` is
  KVO-only — `WKNavigationDelegate` reports started, finished and failed and nothing
  in between — so a delegate-only splash draws a bar that jumps from sweeping to
  gone, which is the "did it hang?" state the splash exists to remove.
- **100% is not a finish, and progress never moves backwards.** The estimate reaches
  1.0 before `didFinish`, and a redirect runs it back down.
- **A failed main-frame load keeps the splash up** with our sentence plus the
  platform's own (`URLError`'s names the address and the error), and Retry.
- **`didFinish` does not clear a failure**: a failed load still finishes on the error
  page WebKit renders.
- **A reload from the console's own header shows the splash again.** `location.reload()`
  arrives as an ordinary navigation with the same address; `SplashState.isDocumentReload`
  compares it against the one on screen, and only from a finished document so a cold
  start does not restart its own arm. (WebView2 exposes this as a flag, which is why
  the Windows shell does not compare addresses.)

`TestsWindow` renders the splash in a real window and asserts the assembled view —
the mark present and in the artwork's aspect, the bar determinate only once a real
percentage arrives, the sentence the state's, Retry only on a failure — because a
splash that drew the wrong phase would pass every state-machine case.

**It is installed through `installSplash(in:state:onRetry:)`, and that function
exists because sizing it by hand was a bug that reached users.** AppKit resizes a
view's subviews when its own frame changes, so only the subviews present at that
moment are carried along. `buildWindow` restores the window's frame from
`setFrameAutosaveName` before it assigns `contentView`, so the container was
already its full size when the web view was added (before the assignment — carried
along) and when the splash was added (after it — NOT carried along, and left at the
hard-coded 1280x860 it was built with). The reported symptom was the launch overlay
drawn as a small box in the window's bottom-left corner, in full screen as much as
in a window, because nothing resizes the parent again for `autoresizingMask` to
fire. Measured on a bare window: a subview added before `contentView =` follows the
container to 2200x1200, the identical subview added after it stays 1280x860; and on
the shipped app, `container` and the web view were 2560x1335 while `SplashView`
reported `{{0, 0}, {1280, 859}}`. `runSplashFillCases` pins it: the splash covers a
container larger than the build rect, and follows a container resize.

## Quitting

Four bugs made Quit fail, and each is stated here because none is visible from
the code alone:

- **The quit was a main-actor deadlock.** `applicationWillTerminate` ran a
  `Task` and then `DispatchSemaphore.wait`ed on the MAIN thread. `NSApplicationDelegate`
  methods are `@MainActor`, so the task that would signal needed the main actor
  to resume — the one blocked in the wait. The app beachballed for the whole 6 s
  timeout on every quit. `applicationShouldTerminate` + `.terminateLater` is
  AppKit's own deferral: the work runs detached, and `reply(toApplicationShouldTerminate:)`
  ends the quit when it finishes.
- **The deferred reply went to the wrong executor, and Quit became impossible.**
  `.terminateLater` puts `-[NSApplication _shouldTerminate]` into a NESTED event
  loop that services `CFRunLoopPerformBlock` but NOT the main dispatch queue —
  where Swift's main-actor executor lives. `await MainActor.run { sender.reply(…) }`
  therefore never ran: the window could not be closed, every later Quit was
  answered `cancel` against a latch nothing could clear, and only `kill -9`
  ended the process (the reported "after updating the macOS DMG the app does not
  quit"). `TerminateCoordinator` hands the reply to the main run loop instead,
  and sends `replyToApplicationShouldTerminate:` through the ObjC runtime —
  `perform(_:with:)` passes an object where the method reads a `BOOL`, which
  arrives as `false` and cancels the quit. Quit now completes in 20–40 ms.
- **The spawned child inherited a blocked SIGTERM.** `posix_spawn` copies the
  caller's signal MASK, and `POSIX_SPAWN_SETSIGDEF` resets only the DISPOSITION.
  The app blocks SIGTERM (Swift concurrency), so the server was spawned with it
  blocked, `kill(-group, SIGTERM)` left it pending, the child never died, and
  `killGroup` always ran its full 40 × 50 ms budget before SIGKILL — **2.27 s per
  server** for one that dies in 60 ms. `POSIX_SPAWN_SETSIGMASK` with an empty set
  is the missing flag; verified A/B (`died from SIGTERM? false` → `true`).
- **A zombie answered "alive".** `isAlive` polled `kill(pid, 0)`, and an
  exited-but-unreaped child still answers 0, so the grace loop never saw it go.
  It now uses `waitpid(WNOHANG)`, which also reaps — and falls back to the
  signal probe for an adopted pid that is not our child (`ECHILD`).

`swift run kabmo-desktop-tests` measures the child half: an exited child is not
"alive", a well-behaved child is released in under 0.5 s, and a child that
IGNORES SIGTERM is still killed after the escalation. The reply half is
`runQuitCases` in `swift run kabmo-desktop-window-tests`: it calls the real
`NSApp.terminate` with the shipped coordinator answering `.terminateLater`, and
fails through a watchdog if the reply never lands — the shape that used to hang
the app forever.

## The bridge

The shell injects a user script at document start:

```js
window.__kabmoDesktop = { platform, shellVersion, overlayTitlebar, trafficLightInset }
window.__kabmoCall(method, params) → Promise   // posts to the `kabmo` message handler
window.__kabmoReply(id, ok, payload)           // what the shell evaluates back
```

Commands: `desktop_info`, `servers_state`, `servers_add`, `servers_remove`,
`servers_activate`, `servers_start`, `servers_stop`, `dropped_paths`. There is
no capability file and no per-origin allowance: the shell owns the webview, so
the page cannot be anything but one this window chose to load.

## Documents opened from Finder

Kabmo registers itself as a **viewer** for the types its editor can draw — PDF,
DOCX, XLSX/XLSM, markdown, CSV/TSV, SVG, raster images, plain text and JSON — so
a double-click, a drop on the Dock icon, or "Open With → Kabmo" opens a tab in
the console.

`CFBundleDocumentTypes` in `Info.plist` is the declaration, and it is GENERATED
from `release/document-types.mjs` by `scripts/shell-document-types.mjs`
(`build-app.sh` injects it with `sed`'s `r` command, because the fragment is
multi-line and holds `&`, `\` and `/`). Two keys decide the behaviour:

- `CFBundleTypeRole: Viewer` — Kabmo can show the file, it does not own it;
- `LSHandlerRank: Alternate` — it is an OPTION in the menu and is never selected
  as the default when another app claims the type.

An `Owner` role here would make Kabmo the app every PDF on the machine opens in,
which is not a decision an installer gets to make. `build-app.sh` then
`plutil -lint`s the assembled plist: a malformed one makes macOS refuse to
LAUNCH the app, with no message anywhere.

Verified: after `lsregister -f build/Kabmo.app`,
`NSWorkspace.URLsForApplicationsToOpenURL` for a `.pdf` lists the bundle beside
Preview and Chrome.

### How the paths reach the page

No browser API can see a launch — a `WKWebView` gets no `File` for
`openFiles:`, and `launchQueue` is Chromium-only — so the shell collects the
paths and hands them over:

- `applicationWillFinishLaunching` queues `launchPaths(from:)`, which is how
  `open -a Kabmo report.pdf` arrives (the path is on argv, not in `openFiles:`);
- `application(_:openFiles:)` queues a double-click, and answers `.success`
  unconditionally: a file the editor refuses belongs on the console where the
  sentence can be read, not in Finder's own error dialog;
- both are flushed on `didFinish`, the first moment a page can answer, through
  `window.__kabmoOpenPaths(paths)`.

`OpenPathQueue` (`OpenPaths.swift`) **takes** and **de-duplicates**: a taken
batch is gone, so a reload cannot reopen the file the user closed, and the same
path arriving twice (a second activation, `open -a` delivering it on argv AND
through `openFiles:`) opens one tab. The script is built by
`JSONSerialization`, never by interpolation — a filename may contain a quote or
a backslash, and `packages/macos/TestsWindow/OpenPathsWindowTests.swift` drives a
batch carrying both into a real web view and asserts the page receives those
exact strings.

The page then grants the file's own directory (`POST /api/fs/grant`, see
AGENTS.md) and opens a tab, because a file in `~/Desktop` is outside every
workspace the fs routes are allowed to read.

## File drops carry no path, so the shell reads the pasteboard

Dropping a file from Finder onto the editor did nothing: it was refused with
"that drop carried no readable file", while the same drop attached fine in the
chat composer. Measured on macOS 27 by delivering a real Finder pasteboard into
a `WKWebView`:

    drop: types ["Files"], files [File]
          getData('text/uri-list') ''      getData('text/plain') ''
          File.path undefined              DataTransferItem.getAsFileSystemHandle undefined

Both of the page's own routes are therefore dead here. WebKit implements no File
System Access API (bug 257792 is open), so there is no handle to open; and it
stopped adding local filenames as URLs to a file drag (changeset 222257), so
there is no URI list for `/api/fs/scope` to resolve. The composer kept working
because it only needs the bytes, which is exactly why this looked like an
editor bug rather than a missing capability.

`DropWebView` (`DroppedPaths.swift`) is the fix: it reads
`NSFilenamesPboardType` (falling back to `public.file-url`) in
`performDragOperation` **before** calling `super`, records the paths, and the
page asks for them with `dropped_paths` from its own `drop` handler. Measured:
the injection lands ahead of the DOM event, so the handler sees the answer.

Three rules, and each was a bug waiting:

- **`super` is still called, and its return value is the answer.** The page needs
  the DOM event to know WHERE the drop landed — the editor column, the composer,
  or a code surface — and the composer attaches files from the bytes the payload
  carries. Swallowing the drag here would fix the editor by breaking the chat.
- **The answer is consumed once.** A drag released where no target claimed it
  leaves the record unread, and answering it to the NEXT drop would open a file
  the user had already abandoned. `draggingExited` clears it too.
- **The page age-checks the answer** (`SHELL_DROP_TTL_MS`, 2s). It asks in the
  drop's own turn, so anything older is a leftover rather than this gesture.

The Linux shell never had this bug: WebKitGTK preloads `text/uri-list` for a
file-manager drag. Windows does not either: WebView2 is Chromium, where
`DataTransferItem.getAsFileSystemHandle` is available. Neither needs the
`dropped_paths` command, and neither implements it — the page's bridge read
fails and the drop's own payload decides, which is the pre-existing behaviour.

## Build

```bash
cd packages/macos
swift build                              # library + app + test runners
scripts/build-app.sh                     # → build/Kabmo.app
swift run kabmo-desktop-tests            # the rules: 204 checks, no window needed
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
read by `release/macos-version.mjs` — the same parser the shared
`release/release-shells.mjs` bumps through, so the number the pipeline publishes and the number the bundle
declares cannot disagree. `build-app.sh` fills `CFBundleShortVersionString` and
`CFBundleVersion` from it.

**Never bump it by hand.** `.github/workflows/release.yml`'s `shells` job runs
`release/release-shells.mjs`, which ranges from the commit that last wrote the
version LINE (`git log -L`) over `packages/macos`, derives the bump level from the
same Conventional Commits rules the app uses, and commits the result — all five
shells in ONE commit. The `chore`
it commits releases nothing on its own.

There is deliberately **no User-Agent token**, unlike the Android and iOS shells.
Those two are downloaded *from the console*, which compares the published asset's
version against the one the running shell reports on every request.

The console still offers this app an **update**, and the version arrives over the
bridge instead: `App.swift` reports `ShellVersion.current()` — read from
`CFBundleShortVersionString`, which `scripts/build-app.sh` fills from
`version.properties` — as `__kabmoDesktop.shellVersion`, and the sidebar compares
it against the published asset. A literal in the source was a second number for
one build, and it drifted (the pipeline bumped the properties file while the app
kept reporting the old version), which is why the bundle is the only source.

### Releasing

`.github/workflows/publish-macos.yml` is a reusable two-phase body, and the split
is the point:

1. **`build`** compiles the package **on both architectures** (`arm64` on
   `macos-15`, `x64` on `macos-15-intel`), runs both Swift suites, assembles
   `Kabmo.app`, verifies the version the plist declares, the ad-hoc signature and
   the binary's own Mach-O slices, and uploads one artifact per architecture —
   carrying BOTH shapes, `Kabmo-<version>-mac-<arch>.zip` and
   `Kabmo-<version>-mac-<arch>.dmg`. `release.yml` calls it as `macos-build`
   **before** `app` tags — so a Swift error, a missing toolchain or a plist that
   disagrees with `version.properties` stops the release instead of shipping a tag
   whose GitHub release carries no app.
2. **`attach`** downloads both artifacts (one per architecture) and uploads them to
   the release `app` created. It builds nothing, so it cannot be the step that
   discovers a broken bundle.

**Two shapes ship, and neither replaces the other.** The `.zip` is what a script or
an updater consumes, made with `ditto` — `zip -r` strips the bundle's extended
attributes and code signature, and the result is an app macOS refuses to launch
("damaged") with nothing in the archive to say why. The `.dmg` is what a PERSON
downloads: `hdiutil create` puts `Kabmo.app` in a window beside an `Applications`
alias, so installing is one drag. A `.dmg` cannot be extracted by a build script
without mounting it, and a `.zip` gives a first-time user no obvious move — hence
both.

`hdiutil` prints a deprecation warning pointing at `diskutil image create from`,
and that alternative is unusable here: it takes no `-fs`, so a folder source
becomes an APFS volume, while HFS+ is what every macOS from 10.x up mounts.

`app` `needs: macos-build`, so the build is a gate rather than a consequence. The
whole chain is `packages → marketplace → android → ios → windows → macos →
{ipa-build, apk-build} → win-build → macos-build → app`; `tests/ci-gates.test.ts`
pins it.

## What is not done

- **A document opened from Finder still needs the console to be running.** The
  shell hands the path to the page, and the page opens a tab through
  `POST /api/fs/grant` — but if no server is up, the shell's own server picker is
  what the user sees, and the file waits in `OpenPathQueue` until a console
  loads. It is not lost; it is simply deferred.
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
