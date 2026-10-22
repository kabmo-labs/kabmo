# Kabmo desktop shell (Linux, native)

A window around a Kabmo console, for Linux. The shell is **thin**: it decides
which server the window is on, starts and stops a LOCAL one, and owns the window
chrome. Every product surface is the server's own page — the client is
same-origin relative, so a WebKitGTK webview on the real `http://host:port` URL
runs it unmodified.

Rust + GTK 3 + WebKitGTK 4.1. It is the **port of `packages/macos`** (the macOS
shell) and `packages/windows`, not a second design: the same server list, the
same ownership rule, the same bridge contract, the same launch behaviour and the
same rules suite. Nothing above `src/client/lib/desktop/` forked.

## Why GTK 3 + WebKitGTK, and not a framework

| | this shell | macOS shell | Windows shell |
|---|---|---|---|
| runtime in the bundle | none (system WebKitGTK) | none (system WebKit) | none (system WebView2) |
| language | Rust | Swift | C# |
| window chrome | `set_decorated(false)` + `begin_resize_drag` on the edges | `NSWindow` subclass | `WindowChrome` |
| drag region | **the page reports it** (see below) | selector hit test in `sendEvent` | `app-region: drag` |
| window buttons | **the page draws them** | system traffic lights | the page draws them |
| file drop gives a **path** | yes (`selection_data` URI list) | yes | yes |

The three shells differ only where the platform forces it, and each difference is
stated below rather than hidden.

## Two servers, one window

- **Mode A — local.** The shell spawns `kabmo serve --foreground --port <p>` in
  **its own process group** (`process_group(0)`), then waits for `/api/health` —
  the CLI's own readiness rule, never a parsed log line. Stop signals the GROUP,
  so the PTY shells and plugin children go with it.
- **Mode B — remote.** A URL the user adds. Nothing is spawned.

Both appear in one list, beside the servers **found on this machine**: a
`kabmo serve` in a terminal, `bun run dev` or a login entry writes
`<data>/run/<port>.json` from the process that owns the port, so it is discovered
on every read rather than stored. Those can be connected to but **not** stopped —
this window did not start them.

**The data directory is never overridden.** The managed server inherits the
environment, so its database stays where `kabmo serve` puts it (`~/.kabmo`) and
`kabmo status` keeps seeing the instance the window is on. The shell's own list
lives at `$XDG_CONFIG_HOME/Kabmo/servers.json` (else `~/.config/Kabmo/`), and the
window's own geometry in `window.txt` beside it.

### Ownership is a recorded pid, not a guess

`spawned` in that JSON maps `local:<port>` → the pid **this shell** spawned. It is
the only thing that makes a row `owned`, and the only thing a later launch may
adopt. A force-quit (SIGKILL, a crash, a logout) never runs the window's cleanup,
so its children keep serving — the next launch adopts exactly its own orphans from
that map. A server started by hand answers on a port and appears in the same
records, and is deliberately never adopted.

## The window bar

`set_decorated(false)` on a `GtkWindow` whose content is the page. Everything a
native title bar does for free then has to be done here:

- **Move.** The page reports it. `data-drag-region` is still the marker, and the
  shell's bootstrap script walks up from the press and stops at anything
  interactive — the same rule the macOS shell's selector applies. **This is the
  one place the port differs in kind, and the reason is measured:** GTK gives the
  window every press before the webview (`connect_button_press_event` fires
  first), but `run_javascript` is ASYNCHRONOUS, so the answer arrives after the
  button state has moved on — a press that never moved would still start a
  move-drag and swallow the click and the double-click. So the page decides from
  the press it already receives, and posts `window_drag` once the pointer has
  moved 4px. `-webkit-app-region` is not an option: it is a Chromium property and
  WebKitGTK ignores it entirely.
- **Resize.** An undecorated window has no resize border, so a press within 5px
  of an edge or corner starts `begin_resize_drag`, and the pointer's cursor
  advertises it. Measured under Xvfb + openbox: a press on the east edge and a
  drag widened the window 1280 → 1328.
- **The three buttons are drawn by the PAGE** (`WindowControls`), because
  `windowControls: true` in the shell's identity says so. A `GtkOverlay` child
  does receive clicks over a webview (measured: an overlay button got the click
  and the page did not), so native buttons would work — but the page's set already
  exists for Windows and is tested, and a second set would be a second thing to
  keep in step. Verified end to end: the square control maximized the window to
  the full screen and restored it to its previous geometry, the first control
  minimized it, and the last closed it.
- **Double-click** obeys `gtk-titlebar-double-click` (`toggle-maximize` by
  default, also `maximize` and `minimize`) — a native bar reads that preference,
  so a page-drawn one has to.
- **Right-click on the bar** raises the menu a native bar offers: Move Window,
  Reload, Toggle Developer Tools, Settings…, About Kabmo, Actual Size, Zoom In,
  Zoom Out, Minimize, Zoom/Restore, Enter/Exit Full Screen, Close. `F10` opens the
  same menu, so it is reachable without a pointer.
- **Full screen** is `F11`, and the page must not slide under a panel: GTK's own
  full-screen handling owns that, so no inset correction is needed here.
- **Shortcuts**: `Ctrl+R` reload, `Ctrl+Shift+I` inspector, `Ctrl+0` actual size,
  `Ctrl+±` page zoom (the same clamped ladder the menu walks), `Ctrl+,` settings,
  `Ctrl+M` minimise, `Ctrl+W` / `Ctrl+Q` close, `F10` the bar's menu, `F11` full
  screen.

## The bridge

The shell injects a user script at document start:

```js
window.__kabmoDesktop = { platform, shellVersion, overlayTitlebar, windowControls }
window.__kabmoCall(method, params) → Promise   // posts to the `kabmo` message handler
window.__kabmoReply(id, ok, payload)           // what the shell evaluates back
```

Commands: `desktop_info`, `servers_state`, `servers_add`, `servers_remove`,
`servers_activate`, `servers_start`, `servers_stop`, plus the window verbs
`window_minimize`, `window_maximize`, `window_close`, and the chrome intents
`window_drag`, `window_toggle`, `window_menu` (posted with id 0, since there is
nothing to answer). There is no capability file and no per-origin allowance: the
shell owns the webview, so the page cannot be anything but one this window chose
to load.

The transport is the **same contract the macOS and Windows shells install**, so
`src/client/lib/desktop/bridge.ts` is shared verbatim. Verified against a real
page in the running shell: `servers_state` answered, and the `servers_add` that
followed it landed in `servers.json` with the label the page built from the
answer.

A link to another origin — every `target="_blank"` in the console, an OAuth
launch — leaves the console and opens in the user's browser via `xdg-open`. The
same-origin check is what keeps a login flow from replacing the app with a
provider's page.

### The name

The app is **Kabmo** everywhere a user can see it, and that is four independent
facts rather than one string: the window title, the About panel, the launcher
entry's `Name=`, and the process name — which is what the window manager labels
the taskbar entry with. The last one is the trap: GTK derives it from the
executable's FILE NAME, so a binary called `kabmo-desktop` put that string in the
window list while the window's own title said Kabmo. The binary is therefore named
`Kabmo` (the crate keeps its lowercase name, because Cargo names are lowercase and
it is never published), `main` sets `prgname`/`application_name` from the one
`APP_NAME` constant before GTK starts, and the launcher's `StartupWMClass` is that
same word. Measured on a running window after the change:
`WM_CLASS(STRING) = "Kabmo", "Kabmo"`, `WM_NAME = "Kabmo"`, and `/proc/<pid>/comm`
= `Kabmo`. This is the same fix the macOS shell made by naming its SwiftPM product
`Kabmo`; `release/linux.test.js` asserts all four surfaces together.

### The version

`version.properties` is the ONLY place the shell's version is declared. `build.rs`
bakes it into the binary as `KABMO_SHELL_VERSION`, which is what the page receives
as `shellVersion` — never `CARGO_PKG_VERSION`, because the crate is never published
and two numbers for one build is the drift the file exists to prevent. A missing or
unparsable line FAILS the build.

**Never bump it by hand.** `.github/workflows/release.yml`'s `linux` job runs
`release/release-linux.mjs`, which ranges from the commit that last wrote the
version LINE (`git log -L`) over `packages/linux`, derives the bump level from the
same Conventional Commits rules the app uses, and commits the result. The `chore` it
commits releases nothing on its own.

There is deliberately **no User-Agent token**, unlike the Android and iOS shells.
Those two are downloaded *from the console*, which compares the published asset's
version against the one the running shell reports on every request. A Linux app is
installed by a person from the release page and nothing in the console offers it, so
nothing has to parse it.

### Releasing

`.github/workflows/publish-linux.yml` is the reusable body. `release.yml`'s
`linux-build` job calls it with `mode: build` and `ref: main` BEFORE `app` tags — so
a compile error, a missing `libwebkit2gtk-4.1-dev`, or a rules-suite failure stops
the release instead of shipping a tag whose GitHub release carries no shell — and
`linux-app` calls it again with `mode: attach` after the release exists. The asset
is `kabmo-linux-v<version>.tar.gz`, unpacked and installed with the `install.sh`
inside it (see Installing, below).

## Installing

The released archive unpacks to a `Kabmo/` directory, and `install.sh` inside it
is the whole installer:

```bash
./install.sh                  # → ~/.local (no root)
PREFIX=/usr sudo ./install.sh # system-wide
./install.sh --uninstall      # removes what it placed
```

It places three files — `bin/Kabmo`, the 512×512 icon and
`share/applications/kabmo.desktop` — and refreshes the desktop and icon caches
when the tools exist.

**The launcher entry is GENERATED, not shipped ready-made, and that is load
bearing.** A `.desktop` file's `Exec` takes an absolute path, while a tarball
unpacks wherever the user put it, so only the installer knows where the binary
landed. The first version tried to dodge that with
`Exec=sh -c 'exec "$(dirname "$1")/Kabmo"' sh %k`, which
`desktop-file-validate` rejects outright — the Desktop Entry spec has no single
quotes, and `$` must be escaped inside a quoted argument:

```
error: value "sh -c 'exec "$(dirname "$1")/Kabmo"' sh %k" for key "Exec"
       contains a reserved character "'" outside of a quote
```

An invalid entry fails **silently**: the menu lists the app and clicking it does
nothing, which reads as a broken app rather than a broken file. So
`scripts/kabmo.desktop.in` is a template of `@EXEC@` / `@TRY_EXEC@` / `@ICON@`
tokens, the installer substitutes the paths it just chose, refuses to install
while any token is unresolved, and validates the result with
`desktop-file-validate` when that tool is present.

The `Exec` value is always **quoted**, because a space is a reserved character in
`Exec` and the validator does NOT catch an unquoted one — measured: it accepts
`Exec=/tmp/my prefix/bin/Kabmo`, while a launcher splits that into two arguments
and starts nothing. `TryExec` is a bare path for the same reason inverted:
quoting it would make the desktop environment look for a file whose name starts
with a quote.

`publish-linux.yml` runs the installer into a throwaway prefix on every release
and checks what it placed, so a template token the script stopped filling in fails
the build rather than the user's menu.

## Build

```bash
cd packages/linux
cargo build                            # library + app + rules suite
cargo run --bin kabmo-desktop-tests    # the rules: 78 checks, no display needed
scripts/build-app.sh                   # → build/Kabmo/ (binary, template, icon, install.sh)
```

Dependencies, on Debian/Ubuntu:

```bash
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev \
                 desktop-file-utils   # only for install.sh's own validation
```

and the equivalent `gtk3-devel` / `webkit2gtk4.1-devel` packages elsewhere. The
crate asks for the `v2_22` WebKitGTK feature — the floor the shell's API use
actually needs — rather than the newest, so Ubuntu 22.04 and Debian 12 are
supported.

### Where the code lives

| file | what it owns |
| --- | --- |
| `src/main.rs` | the app: `main`, the `Shell` struct, and the wiring (bridge, navigation, keys, shutdown, boot) |
| `src/chrome.rs` | the window's own behaviour: the shortcut table, `window.txt`, the webview's data directories, the page's drag/double-click/contextmenu intents, external links |
| `src/commands.rs` | the commands the page may issue, and their answers |
| `src/store.rs` | the server list, its persisted shape, and the ownership rule |
| `src/system.rs` | `XDG` paths, the health probe, local-server detection, and the supervisor that owns a spawned child's process group |
| `src/bridge.rs` | the injected JS, the call parser, the reply script, and the `desktopInfo` payload |
| `src/splash.rs` | the launch overlay and its progress rules |
| `src/window.rs` | the undecorated window, edge resizing, the bar and its menu, zoom, and the geometry arithmetic |
| `rules/` | the rules suite, an ordinary executable split by domain (`support.rs` holds the runner and the fakes, the rest one file per rule family) — `bun test` has no analogue for a Rust crate |

## What is not done

- **No bundled server.** `resolve_launch()` prefers `server/kabmo` beside the
  binary, then `kabmo` on `PATH`, then `bun` + a source checkout. Shipping one
  install that needs nothing on `PATH` means building that binary per target —
  `docs/desktop-mobile-packaging-plan.md` (P0).
- **No Flatpak or Snap.** `scripts/build-app.sh` produces a directory and an
  `install.sh`; a sandboxed package needs the WebKitGTK portal wiring, which is
  its own project.
- **No auto-update.** The shell has no updater; replacing it means replacing the
  binary.
- **The window itself is not driven by a pointer in CI.** What can be wrong
  without one — the server list's rules, the probe, the record reader, the bridge's
  wire shapes, the edge arithmetic, the splash's progress rules — is unit-tested.
  The window was verified by hand under Xvfb + openbox: a press on the header and a
  drag moved it (`X 60→120, Y 20→60`), a press on the east edge and a drag widened
  it (1280→1328), the page's square control maximized and restored it
  (1280×860 ⇄ 1400×900), the first control minimized it, the last closed it, and a
  real page's `servers_state` → `servers_add` round trip landed in
  `servers.json`. A CI job would need a compositor plus `xdotool`; a shell without
  a window manager cannot move anything at all, because `begin_move_drag` is a
  window-manager operation.
- **WebGL in WebKitGTK is the least predictable of the three engines.** The
  terminal (`@xterm/addon-webgl`), Shiki and mermaid all work, but a driver
  without hardware acceleration falls back to software rendering. That is the
  risk `docs/desktop-mobile-packaging-plan.md` names for this platform, and it is
  why the shell does not bundle a second engine.
- **The tray is the server's, not the shell's.** `kabmo serve --tray` still works
  and raises its own icon, but the shell deliberately does not pass `--tray` —
  one app, one icon.
