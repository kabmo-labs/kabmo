# Desktop and Mobile Packaging — Research

Standalone desktop builds (macOS / Windows / Linux) and an Android APK for Kabmo.

**Status: research complete, nothing implemented.** Every claim below is either read from
this tree or measured on this machine; measured results are marked ⟦measured⟧ and the
commands are in [Verification log](#verification-log).

## Target shapes (decided by the product owner)

| Target | Role |
|---|---|
| Desktop (macOS, Windows, Linux) | **Shell** (webview pointed at a Kabmo server, local or remote) **and** **Server** (embeds and runs the Kabmo server itself) |
| Android (APK) | **Shell only** — a webview pointed at a Kabmo server |

The mobile app never runs the server. That is the right call and the evidence is below:
`omp`, PTY shells, `git`, and `rg` are all host-toolchain dependencies, and Android has
none of them.

## What exists today

- The product is already a **server-rendered web app**: one Bun process serves the API,
  the client bundle and the WebSocket routes on one listener (`src/server/index.ts`).
- The client is **same-origin relative** — 58 `fetch('/api…')` call sites and two
  `window.location.host` derivations for the sockets (`src/shared/lib/realtime/protocol.ts:295`,
  `src/shared/lib/workspace/terminal/protocol.ts:199`). Nothing hardcodes a host, so any
  webview that loads the real URL works unmodified.
- It is already **installable as a PWA** (`public/manifest.webmanifest`, `public/sw.js`,
  `PWAInstallButton`), with `display_override: ["window-controls-overlay", "standalone"]`
  and a `launchQueue` file handler (`src/client/lib/launch/file-handlers.ts`).
- The CLI already has the process supervision a desktop wrapper needs: `kabmo serve`,
  `--tray`, `--startup`, `--tls`, `--lan`, per-port instance records, port locks and a
  health endpoint (`GET /api/health` reports `pid`, `startedAt`, `port`, `tls`, `fds`).

So the packaging work is **not** "make it run outside a browser". It is:

1. wrap a webview around a URL,
2. optionally start/stop the server as a child process,
3. ship the server in a form that runs without `bun` on PATH.

## Feasibility per target

| Piece | Verdict | Evidence |
|---|---|---|
| Server as a single binary | **Works** | `bun build --compile --target=bun-darwin-arm64 src/server/index.ts` produced a 91 MB binary that booted, served the shell (24,836 B), the client bundle (16.9 MB), `/fonts.css`, `/api/health` and a realtime WS `pong` ⟦measured⟧ |
| Cross-compile to other OSes | **Works** | `bun-windows-x64` 118 MB, `bun-linux-x64` 112 MB, `bun-linux-arm64` 112 MB, `bun-darwin-x64` 100 MB, all emitted from this arm64 Mac ⟦measured⟧ |
| SQLite in a compiled binary | **Works** | `bun:sqlite` create/insert/select in a compiled probe ⟦measured⟧ |
| PTY terminal in a compiled binary | **Works** | `Bun.Terminal` + `Bun.spawn` echoed `pty-works`, exit 0 ⟦measured⟧ |
| Realtime + terminal WebSockets | **Works** | `{t:'ping'}` → `{"t":"pong","id":7}` on a compiled server ⟦measured⟧ |
| Run the server **on Android** | **Not viable** | Bun does emit `bun-linux-aarch64-android` (118 MB built here ⟦measured⟧), but Kabmo needs `omp` (a Bun CLI), a POSIX PTY shell, `git` and `rg` on the device. Android has no `/bin/sh` PTY, and `ompStartupError()` refuses to boot without the binary (`src/server/lib/omp/core/startup.ts`). |

## Desktop: two modes in one app

### Mode A — Server (standalone)

The shell owns a child process:

```
Kabmo.app
├─ Kabmo (shell binary)              ← Tauri/Electrobun main process
└─ Resources/
   ├─ server/kabmo-server            ← bun --compile output
   ├─ server/public/                 ← icons, manifest, sw.js
   ├─ server/marketplace/            ← bundled panel plugins
   └─ server/{src,node_modules}/…    ← font stylesheets + font files (see below)
```

Startup sequence, reusing what the CLI already does:

1. pick a free port (or adopt a live instance via `findLiveInstance`),
2. spawn `server/kabmo-server` with `cwd = Resources/server`, `HOST=127.0.0.1`,
   `PORT=<port>`, `KABMO_DATA_DIR=~/Library/Application Support/Kabmo` (etc.),
3. poll `GET /api/health` until `port` matches (the CLI's own readiness rule —
   never parse the log),
4. load `http://127.0.0.1:<port>`,
5. on quit: `SIGTERM` the child and wait, so the PTY children and plugin children are
   disposed (`src/server/index.ts` already awaits `disposeAllPluginsOnShutdown()`).

**Do not pass `--tray` to the child.** The desktop shell owns the tray; a second tray from
the server would be two icons for one app.

### Mode B — Shell (remote)

A URL field + connection settings, then load that URL. Everything works because the client
is same-origin relative. Requirements the shell must satisfy:

- **Load the real `http(s)://host:port` URL — never a custom scheme with a proxy.**
  Every WS upgrade is origin-checked by comparing `Origin` to the `Host` header
  (`src/server/lib/http/same-origin.ts:16`). A Tauri `tauri://localhost` origin against a
  proxied `Host` is rejected with 403 on the realtime, terminal and dictation sockets.
  Tauri's `WebviewUrl` accepts an external `http(s)` URL directly
  (`https://v2.tauri.app/reference/config/#webviewurl`), so this is the supported path.
- **Persist cookies per origin.** Sessions are `HttpOnly; SameSite=Lax`, named per port
  (`sessionCookieName`, `src/server/lib/auth/token.ts:55`).
- **Show the server's own refusal text.** `ompStartupError()` exits 1 with a multi-line
  message; the shell must surface stderr instead of a blank window.

### Framework choice

| | Tauri 2 | Electrobun 2 | Electron | PWA (today) |
|---|---|---|---|---|
| Desktop OS | macOS, Windows, Linux | macOS, Windows (x64+arm64), Linux (x64+arm64) | all | Chromium only |
| Mobile | **Android + iOS, same repo** | no | no | Android via browser install |
| Renderer | system webview (WKWebView / WebView2 / WebKitGTK) | system webview, **optional bundled CEF** | bundled Chromium | browser |
| Language for main | Rust (sidecar supported) | **Bun** (TypeScript) | Node | — |
| Bundle size | ~3–10 MB | ~1 MB + webview | ~100 MB+ | 0 |
| External URL window | yes (`WebviewUrl`) | yes (`BrowserWindow({ url })`) | yes | n/a |
| Tray / updater | built in | built in (Hutch) | built in | none |
| Build host | cross-compile via CI per OS | **current host only** (`hutch`); no cross-compile | per OS | n/a |

Two candidates, and the deciding factor is **coverage vs renderer fidelity**:

- **Tauri 2** — one codebase for macOS + Windows + Linux + Android. Main process is Rust,
  the Kabmo binary rides as an `externalBin` sidecar. Downside: on Linux the renderer is
  **WebKitGTK**, and Kabmo's heaviest surfaces are a WebGL xterm (`@xterm/addon-webgl`),
  Shiki, mermaid and a large virtualized list — WebKitGTK WebGL is the least predictable of
  the three engines.
- **Electrobun 2** — main process is Bun, so `Bun.spawn` of the Kabmo binary is native, and
  it can pin Chromium via `bundleCEF` when WebGL must be dependable. Downside: it builds
  **only for the host OS** (a 3-OS release needs 3 CI runners anyway) and it does **not**
  cover mobile, so a mobile shell is a second project.

Recommendation: **Tauri 2** as the single wrapper for all four targets, with the WebGL
question answered by a spike on Linux WebKitGTK before committing. If that spike fails,
Electrobun (desktop) + Tauri Android (mobile) is the fallback — two projects, one shared
"which URL do I load" settings model.

The PWA stays as the zero-install path; it is not replaced by either.

## Mobile APK: what actually constrains it

**Decided: Kotlin WebView shell, in `packages/android`.** The research below is
kept because it is why that shape was chosen; the shipped implementation and its
build steps live in `packages/android/README.md`.

The app cannot ship its own client as static files — `index.html` is a Bun HTML route and
the shell is rendered per request (`src/server/plugins/ssr.ts`). A mobile build therefore
**must** point at a live server. Options:

| Approach | Verdict |
|---|---|
| **Kotlin WebView** (`packages/android`, shipped) | Chosen. ~1–2 MB, JDK + SDK only, every WebView hook explicit, native settings screen, launcher shortcut |
| **Tauri 2 Android** (`tauri android init` → `build --apk`) | Rejected: the Rust/IPC/capabilities surface is unused by a URL shell, and remote-URL loading on mobile only landed in July 2025 ([#13461](https://github.com/tauri-apps/tauri/issues/13461)) |
| **Capacitor** (`server.url` + `cleartext`) | Rejected: a second native project for the same result |
| Bare WebView wrapper | Chosen shape, but not bare: the hooks below are not optional |
| **TWA/Bubblewrap** | Impossible: requires HTTPS + Digital Asset Links, and offers nowhere to put a settings screen |

Hard constraints the APK must handle:

1. **Cleartext HTTP is blocked** on Android (targetSdk 28+). `http://192.168.x.x:3000` fails
   unless the app sets `usesCleartextTraffic` or a network-security-config scoped to the
   LAN. Tauri ships its own manifest; this is a one-line change, not a rewrite.
2. **Self-signed TLS is not trusted by the WebView.** `--tls` generates a cert with
   `localhost`, `127.0.0.1`, `::1` and the machine's LAN IPv4 in its SAN
   (`src/server/lib/lifecycle/tls.ts:67`) — a *name* match, but an untrusted *issuer*.
   Android 7+ does not trust user-installed CAs for apps unless the app opts in via
   `<certificates src="user"/>`. Practical answers, in order:
   a trusted tunnel (Tailscale Serve / Cloudflare Tunnel / Caddy with a real cert), or a
   scoped cleartext allowance on a trusted LAN.
3. **Secure-context features degrade over plain http.** `getUserMedia` (the dictation mic)
   requires a secure context; `navigator.clipboard` is guarded by `window.isSecureContext`
   and falls back to `execCommand` (`src/client/hooks/ui/clipboard.ts:8`). Terminal ids
   already have a non-secure fallback (`protocol.ts:116`).
4. **No background execution guarantees.** The client's realtime channel already survives a
   frozen tab (30 s slow retry + resume probe, `src/shared/lib/realtime/connection.ts`), so
   the shell inherits a working reconnect story rather than needing one.

## Shipping the server binary: what breaks, and the fix

Four defects were found by actually running a compiled binary. All four are fixable, and
three of them are silent in a browser but fatal in a bundle.

1. **`bun build --compile` on the CLI does not apply `bunfig.toml` plugins.**
   The CLI compile emitted `warn: invalid @ rule encountered: '@theme'` and the served CSS
   contained **0** utility classes and 3 raw `@theme` blocks ⟦measured⟧ — a completely
   unstyled app. Using `Bun.build({ compile, plugins: [cssPlugin] })` fixed it: 7 `.flex`,
   78 `--theme-ink`, 47 `space-y`, 0 raw `@theme` ⟦measured⟧. The build script must be the
   JS API, exactly as `scripts/build-client.ts` already argues for `bun build`.

2. **`import.meta.dir` is `/$bunfs/root` inside a compiled binary**, so `packageDir()`
   (`src/server/lib/fs/package-root.ts:82`) falls through to `process.cwd()`. Everything
   that resolves from the package directory therefore depends on the **cwd**: `public/`
   (icons, manifest, sw.js), `marketplace/`, the font stylesheets under `src/`, and the tray
   host scripts. Measured: with `cwd` set to a directory holding `src/` + `public/` +
   `marketplace/` + a `node_modules` with the font packages, `/fonts.css` answered 4,059 B
   and all three font files served (26 KB, 23 KB, 1.1 MB); with `cwd` outside it,
   `/fonts.css` answered **200 with 0 bytes** — silent tofu, no error anywhere.

3. **`Bun.resolveSync('@kabmo-labs/kabmo-sdk')` fails inside a compiled binary**
   (`Cannot find package … imported from /$bunfs/root`) ⟦measured⟧. `kabmoPackageDirs()`
   (`src/server/lib/panels/link.server.ts:40`) therefore returns `{}` and a plugin that
   imports the kit cannot be built. Plugin install/build is a runtime feature, so a
   standalone build either ships the packages as real directories beside the binary and
   resolves them from `packageDir()`, or documents plugin building as unavailable in the
   bundled app.

4. **`resolveBunBin()` cannot return `process.execPath`** in a bundle: `isBun()` probes
   `--version`, and a Kabmo binary is not Bun. It falls through to `Bun.which('bun')`, so
   **Bun must be on PATH** for plugin builds (`panels/build.server.ts`), self-update
   (`updates/install.ts`) and the tray config. A standalone desktop app must either bundle a
   Bun runtime beside the server or hide those surfaces.

Two further product-level consequences:

- **Self-update and self-restart do not apply.** A bundled copy classifies as `unmanaged`
  (`src/server/lib/updates/install-method.ts:62`), so `POST /api/console/restart` and the
  update button answer "this instance is not managed by the kabmo CLI". The desktop shell
  owns updates (Tauri/Electrobun updater); the console's update UI must be hidden or
  re-pointed when it detects a bundled install.
- **`omp` remains a hard prerequisite.** The bundle cannot ship it meaningfully (it is a
  separate npm package with its own update cadence), so the shell must present "install
  oh-my-pi" as a setup step, not a crash. `MOCK=true` is the escape hatch for a demo build.

## Networking and security

- Default bind is loopback (`HOST || 'localhost'`, `src/server/index.ts:70`; CLI default
  `127.0.0.1`). Mode A needs nothing more.
- Mode B against a remote host needs `--lan` (or `HOST=0.0.0.0`) **and** a password; the CLI
  already warns when a non-loopback bind has no credential
  (`isLoopbackHost`, `src/server/lib/lifecycle/probe.ts:61`).
- `--tls` is self-signed by design and its SAN already covers the LAN address, so a desktop
  shell can pin/trust it; Android cannot without a user CA or a tunnel.
- `index.html` loads Inter from `fonts.googleapis.com`. Harmless but it is the only external
  request in an otherwise self-contained app — an offline desktop build should vendor it or
  accept the fallback stack.

## Defect found while researching

`public/manifest.webmanifest` declares a `file_handlers` action of `/open-file`, but no such
route exists (`src/server/routes/` has no `open-file` module). A launched file therefore
falls through to the SSR catch-all and receives the **HTML shell** (HTTP 200) instead of a
file-handling response. The client-side `launchQueue` consumer is real and tested
(`src/client/lib/launch/file-handlers.ts`), so the wiring is half-present: the manifest
promises a route the server never implemented.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Linux WebKitGTK WebGL | xterm terminal and mermaid degrade | Spike before choosing Tauri; else Electrobun + CEF |
| Compiled binary needs `cwd` = package dir | empty `/fonts.css`, missing icons — silently | Shell always sets `cwd`; add a startup check that `/fonts.css` is non-empty |
| Tailwind plugin not applied by `bun build --compile` | unstyled app | Build via `Bun.build` JS API (already the repo's rule) |
| Plugin builds need a real Bun + resolvable kit | install/build buttons fail | Ship Bun beside the server, or hide the feature |
| `omp` absent | server refuses to boot | Setup step in the shell; `MOCK=true` demo mode |
| Self-signed TLS on Android | login unusable | Tunnel or scoped cleartext config |
| Two release pipelines (npm + installers) | version drift | Installers build from the same tagged commit as the npm release |

## Proposed phases

**P0 — packaging spike (no product code).** Reproduce the four fixes above in a throwaway
script: `Bun.build` compile with the CSS plugin, a resource directory (`public`,
`marketplace`, minimal `src` with the three face stylesheets, font files), `cwd` set to it,
and a health-gated launch. Deliverable: one directory that a shell can spawn. The
`/tmp/kabmo-pkg` layout measured here is the starting point (93 MB total).

**P1 — desktop shell, Mode B first.** Tauri 2 window loading a URL from settings, cookie
persistence, the server's refusal text, and a Linux WebKitGTK render check (terminal +
mermaid). Mode B is the smaller surface and proves the webview before any process work.

**P2 — desktop shell, Mode A.** Sidecar spawn/stop, free-port selection, health gate,
data-dir default, tray ownership moved to the shell, update UI suppressed for bundled
installs.

**P3 — release plumbing.** Three CI runners (macOS, Windows, Linux) build the sidecar for
their own target and the installer around it; signing/notarization; the installer version
derived from the same tag as the npm release.

**P4 — Android APK. DONE.** Kotlin WebView shell in `packages/android`: native
settings screen (first run and re-entry), URL normalization that refuses a base
path, health-gated save, one entry point (**long-press the launcher icon → Server
settings**; there is deliberately no in-app control), and every WebView hook the
console depends on. Client side: `window.__kabmoBack()`, so the hardware back
button closes the drawer, editor and dialog before walking history. Build steps:
`packages/android/README.md`.

**Desktop shells are shipped as NATIVE ports rather than the Tauri/Electrobun
wrapper this research proposed.**

- `packages/macos` — macOS, Swift + AppKit + WKWebView (660 KB `.app`, ~40 MB RSS).
- `packages/windows` — Windows, .NET 8 + WPF + WebView2, ported from the macOS
  shell so the two share one bridge contract and the client cannot tell them
  apart.

Each is thin: it picks a server, spawns/stops a LOCAL one, and owns the window
chrome. None bundles a server by default (P0's packaging work), and none
implements the framework comparison above — the measurements in that table are
why: a native webview host needs no runtime in the bundle, and the two things
that actually broke under Electrobun (the drag region and the maximised
geometry) are one platform API each (`NSWindow.sendEvent` on macOS,
`WindowChrome` + `IsNonClientRegionSupportEnabled` on Windows).

### How the shells ship

All four shells are **release artifacts attached to the app's GitHub release**,
not registry packages, and they follow one shape:

| Shell | Version file | Build job | Asset |
|---|---|---|---|
| Android | `packages/android/version.properties` | `apk-build` | `Kabmo-<v>-android.apk` |
| iOS | `packages/ios/version.properties` | `ipa-build` | `Kabmo-<v>-ios.ipa` |
| Windows | `packages/windows/version.properties` | `win-build` | `Kabmo-<v>-win-<arch>-setup.exe` |
| macOS | `packages/macos/version.properties` | `macos-build` | `Kabmo-<v>-mac-<arch>.zip` + `.dmg` |
| Linux | `packages/linux/version.properties` | `linux-build` | `.tar.gz`, `.deb`, `.rpm`, `.AppImage` (+ `.zsync`) |

**Every shell follows ONE naming scheme** — `<App>-<version>-<platform>[-<arch>].<ext>`
— so a release page reads consistently whatever a person came for. `Kabmo` is
capitalised because it is the product's name, the same word the window title, the
installer and the `.desktop` entry carry. The three DESKTOP shells add `-<arch>`
because each ships two architectures and one name cannot describe two files; the two
MOBILE shells have no architecture segment because neither artifact is per-arch —
the APK is one universal build (the shell is pure Kotlin with no native libraries)
and the IPA holds only the device slice (`arm64-apple-ios`).

**The mobile names are PARSED, so the old spelling stays readable.** The console
answers "is a newer shell published" by reading the version out of the asset NAME
(`versionFromAssetName`, `src/server/lib/updates/shell-release.ts`), and every
release already on GitHub carries `kabmo-android-v<v>.apk` /
`kabmo-ios-v<v>.ipa`. `SHELL_ASSETS` therefore keeps a `legacyPrefix` and the parser
tries it after the current scheme — without it, an installed shell would read as
"no update" from the moment the rename shipped, silently, because a name that does
not match is indistinguishable from a release carrying no artifact. New releases
only ever write the current scheme. Nothing parses a desktop name (a desktop app is
installed by hand from the release page), which is why those three changed without
a compatibility shim.

| Shell | Architectures | Runners |
|---|---|---|
| macOS | `arm64`, `x64` | `macos-15` (Apple silicon), `macos-15-intel` |
| Windows | `x64`, `arm64` | `windows-latest` (x64), `windows-11-arm` |
| Linux | `x86_64`, `arm64` | `ubuntu-latest` (x64), `ubuntu-24.04-arm` |

**Each desktop shell ships every package format its platform actually uses**, and
each format is a different answer to "how do I install this":

| Shell | Formats | Why more than one |
|---|---|---|
| macOS | `.zip`, `.dmg` | the `.zip` is what a script or an updater consumes (`ditto`, so the signature survives); the `.dmg` is what a person downloads — `hdiutil` puts the app beside an `Applications` alias, so installing is one drag |
| Windows | `.exe` (Inno Setup) | Windows' own convention; a ZIP leaves no Add/remove-programs entry, no Start-menu entry and no uninstaller |
| Linux | `.tar.gz`, `.deb`, `.rpm`, `.AppImage` | no root needed / Debian family / Fedora family / no package manager at all (Arch, NixOS, immutable distros) |

The Linux formats are built by three scripts beside `build-app.sh`
(`package-deb.sh`, `package-rpm.sh`, `package-appimage.sh`), and two of their rules
are the kind that fail only on the user's machine:

- **The `.deb` depends on `libgtk-3-0t64`, not `libgtk-3-0`.** Ubuntu 24.04 renamed
  GTK 3's runtime package in the 64-bit `time_t` transition, and a `.deb` naming
  the old one is UNINSTALLABLE there — apt reports "no installation candidate"
  rather than a missing library, which reads as a broken download.
- **The `.rpm` requires `gtk3` / `webkit2gtk4.1`** — the Fedora-family names. The
  build host is Ubuntu, so its own package names are the wrong ones for the machine
  the RPM installs on, and a spec that copied them builds cleanly and resolves
  nowhere.

The `.deb` names its architecture `amd64`/`arm64` while the `.rpm` and the
`.AppImage` say `x86_64`/`aarch64` — each ecosystem's own spelling, which is why the
workflow's matrix carries `deb` and `host` alongside the asset label `arch`. One
spelling reused across all three would produce packages that install on nothing.

**Every row builds NATIVELY, on a runner that IS that architecture.** All three
shells link native libraries — AppKit/WebKit, WPF/WebView2, GTK/WebKitGTK — so a
cross-build would need a sysroot and a cross toolchain, and the binary it produced
would never have been executed by the job that shipped it. GitHub hosts an image per
architecture (verified in the hosted-runner reference), so each row compiles,
runs its rules suite and verifies the artifact on the machine it targets.

Each build also asserts the ARCHITECTURE of the artifact it produced, from the
file's own header — `lipo -archs` (Mach-O), the PE `machine` field (0x8664 x64 /
0xAA64 Arm64), the ELF `e_machine` field (62 x86-64 / 183 AArch64). That check is
what keeps a matrix row's NAME honest: a runtime pack or SDK that silently resolved
to the host architecture would otherwise publish an `arm64`-named file carrying an
x64 binary, which fails on the user's machine and nowhere in the pipeline.

The Windows installer's `ArchitecturesAllowed` comes from the same `/DAppArch`
value that names the file (`x64os` / `arm64`), so the Arm64 installer refuses an x64
machine and the x64 one refuses Arm64 — `x64compatible` would have matched both via
emulation, which is now the wrong file for an Arm machine to pick.

Each has a bump job (`android` / `ios` / `windows` / `macos` / `linux`), a
`publish-*.yml` reusable body with a `build` and an `attach` phase, and a place in
the chain `packages → marketplace → android → ios → windows → macos → linux →
{ipa-build, apk-build} → win-build → macos-build → linux-build → app`. **The build
is a gate, not a consequence**: `app` `needs:` every build job, so a shell that
cannot compile stops the release before a tag exists — instead of a release that
goes out with no artifact in it, repaired only by a hand-run dispatch. `attach`
runs after `app` because `gh release upload` needs the release to exist, and it
never rebuilds.

The bump is the release. Each version file is the only place its shell's version
is declared, the level comes from the same Conventional Commits rules the app
uses, and the bump commit is a `chore` that releases nothing on its own — so a
shell-only fix reaches a user on the next app release, without cutting a server
version for it.

The artifact's SHAPE follows each platform's own convention, and that is not
cosmetic: **Windows gets an installer** (`Kabmo-<v>-win-<arch>-setup.exe`, compiled
from `packages/windows/installer/kabmo.iss`), because a ZIP leaves no
Add/remove-programs entry, no Start-menu entry and no uninstaller — so "which
version is this" and "how do I remove it" both have no answer. macOS gets a `.zip`
holding the `.app`, which IS the macOS convention; Linux gets a `.tar.gz`, because
it has no installer convention to follow. The installer is unsigned (SmartScreen
warns) and therefore not an MSIX: MSIX requires a certificate bound to a publisher
identity and refuses to install without one.

Two per-shell differences are deliberate. **Android and iOS carry a User-Agent
token** (`KabmoAndroid/<v>`, `KabmoIOS/<v>`) because the console downloads them
and compares the published asset's version against the running shell's; macOS,
Windows and Linux do not, because a desktop app is installed by hand from the release page
and nothing in the console offers it. And **Android's `versionCode` is the
workflow run number**, stated at build time and nowhere else — a fixed value makes
every release after the first uninstallable over the previous one.

## Verification log

All commands ran on this machine (macOS 27, arm64, Bun 1.4.3).

```
# single-file compile (CLI — note the plugin warning)
bun build --compile --target=bun-darwin-arm64 src/server/index.ts --outfile /tmp/…/kabmo-server
  → 91 MB; warns: invalid @ rule encountered: '@theme'

# same compile through the JS API with the Tailwind plugin
Bun.build({ entrypoints:[src/server/index.ts], compile:{outfile}, target:'bun', plugins:[cssPlugin] })
  → success; served CSS 184,398 B, 7 `.flex`, 78 `--theme-ink`, 47 `space-y`, 0 raw `@theme`

# the CLI-compiled binary's CSS, for contrast
  → 538,317 B, 0 utility classes, 3 raw `@theme`   (unstyled)

# runtime probes on the compiled binary (cwd = package dir)
GET /                 → 200, 24,836 B
GET /chunk-*.js       → 200, 16,958,108 B
GET /fonts.css        → 200, 4,059 B
GET /fonts/<file>     → 200, 26,272 / 23,312 / 1,168,484 B
GET /api/health       → {"ok":true,"runtime":"bun","port":…}
WS /api/realtime/ws   → {"t":"pong","id":7}

# and with cwd OUTSIDE the package dir
GET /fonts.css        → 200, 0 B        (silent font loss)

# cross-compile targets
bun-windows-x64 118,121,472 B · bun-linux-x64 112,539,616 B ·
bun-linux-arm64 112,053,032 B · bun-darwin-x64 100,457,968 B ·
bun-linux-aarch64-android 118,101,192 B

# compiled-runtime capability probe
bun:sqlite            → ok
Bun.Terminal + spawn  → "pty-works", exit 0
import.meta.dir       → /$bunfs/root
Bun.resolveSync('@kabmo-labs/kabmo-sdk') → Cannot find package
Bun.which('bun') / Bun.which('omp')      → both resolve on this machine
```

## References

- Bun single-file executables and `--target` list — <https://bun.com/docs/bundler/executables>
- Tauri 2 `WebviewUrl` (external `http(s)` URLs) — <https://v2.tauri.app/reference/config/#webviewurl>
- Tauri 2 mobile (`tauri android dev` / `build`) — <https://v2.tauri.app/develop/>
- Electrobun compatibility (OS/arch/webview matrix, host-only builds) — <https://framework.blackboard.sh/electrobun/guides/compatability/>
- Electrobun `BrowserWindow({ url })` — <https://docs.electrobunny.ai/electrobun/apis/browser-window>
- Capacitor `server.url` / `cleartext` — <https://capacitorjs.com/docs/config>
