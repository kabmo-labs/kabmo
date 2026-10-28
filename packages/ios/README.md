# Kabmo iOS shell

A thin iOS app that shows a Kabmo console in a `WKWebView`. It is a **shell only**:
the server (Bun + `omp` + PTY + `git`) runs elsewhere — a laptop, a workstation, a
NAS — and this app points at it.

Swift 6 + UIKit + WebKit, built with SwiftPM. No SwiftUI, no third-party packages,
no `.xcodeproj`. Everything the platform already ships (WebKit, URLSession, UIKit) is
used as-is; every dependency added here is weight the shell does not need.

## Why a shell and not a server

Kabmo's server needs `omp`, a POSIX PTY shell, `git` and `rg` on the host. iOS has
none of them, and `ompStartupError()` refuses to boot without the `omp` binary. The
phone is a viewer.

## Why the Android shell is the reference, and where iOS must differ

`packages/android` is the same product on the other mobile platform, and this package
is a port of it — feature for feature, rule for rule. The Swift twin of each Kotlin
file is named in the table below, and `Tests/` pins the same behaviours the Kotlin
suite does. Where iOS genuinely cannot do something, it says so instead of pretending:

| Feature | Android | iOS |
|---|---|---|
| Launch overlay with progress + failure reasons | `LoadingOverlay` + `LoadingState` | same, `LoadingOverlay.swift` + `LoadingState.swift` |
| Server settings screen (address, test, connect) | `SettingsActivity` | `SettingsViewController` |
| Page zoom slider 50–200%, saved | `setInitialScale` × density | `pageZoom` (already page-relative) |
| Pinch zoom | `setSupportZoom` | built into `WKWebView` |
| Cookie persistence across a restart | `CookieManager.flush()` | `WKWebsiteDataStore` (writes on its own) |
| External links open in the browser | `shouldOverrideUrlLoading` | `decidePolicyFor` |
| `window.open` (provider OAuth) | `onCreateWindow` | `createWebViewWith` |
| File picker for the composer's 📎 | `onShowFileChooser` | built into `WKWebView` on iOS 12+ |
| Certificate refusal named, not silent | `onReceivedSslError` | `didReceive challenge` |
| Downloads (session cookie kept) | `DownloadManager` + `Cookie` header | `WKDownload` + share sheet |
| Back button → page first | `onBackPressed` → `window.__kabmoBack()` | swipe/gesture → `window.__kabmoBack()` |
| Settings entry point | launcher shortcut | Home Screen quick action |
| Version on the UA | `KabmoAndroid/<v>` | `KabmoIOS/<v>` |
| In-app self-update | `PackageInstaller` — one system dialog | **impossible**; see below |

### The one feature that cannot be ported: self-update

Android can hand an APK to `PackageInstaller` and finish the install itself, because
Android allows a sideloaded app to replace itself after one system confirmation. iOS
has **no equivalent**: there is no public API for an app to install another app, and
a downloaded `.ipa` is not something the system will open. Only the App Store,
TestFlight or MDM can install.

So the iOS shell recognises an IPA download, refuses to write it somewhere useless,
and opens the release page — `ShellUpdate.action` is that decision, and it is tested.
The console still offers **Update** when a newer build is published, because the
version comparison is the same; the difference is what happens after the tap.

## Requirements

| | |
|---|---|
| Xcode | 15 or newer (the iOS SDK ships with Xcode, **not** with the Command Line Tools) |
| iOS | 16.0 floor |
| Swift | 6 (the toolchain that comes with Xcode 15+) |

The **logic tests do not need Xcode**: `swift run kabmo-shell-tests` compiles the
`KabmoShell` target (Foundation + CoreGraphics only) against the macOS SDK and runs
656 assertions. The UIKit target is guarded by `#if canImport(UIKit)`, so the package
still builds on a Command-Line-Tools-only machine — it just cannot produce an app.

## Build

```bash
cd packages/ios

# The rules, on any Mac:
swift run kabmo-shell-tests
# → 656 checks, 0 failures

# The bundle (needs Xcode's iOS SDK):
./scripts/build-ipa.sh
# → build/Kabmo-<version>-ios.ipa
```

`build-ipa.sh` assembles the `.app` by hand — there is no `xcodebuild` and no
`.xcodeproj`, the same choice `packages/macos/scripts/build-app.sh` makes for the
macOS shell. It renders the icon from geometry (`scripts/make-icon.swift`), fills
`CFBundleShortVersionString` from `version.properties` with `plutil`, verifies every
icon the plist names exists, and zips `Payload/` into an `.ipa`.

**The IPA is unsigned, and that is the platform.** Signing needs an Apple-issued
certificate bound to a team and a device set, which a checkout cannot carry. The
artifact is for a developer who re-signs it, for Xcode/TestFlight (where the archive
is signed by the team), and for CI verification.

## Signing, for a device install

```bash
# After build-ipa.sh produced an unsigned bundle, with your own team's profile:
security cms -D -i YourProfile.mobileprovision > /tmp/profile.plist
# … embed the profile, set the entitlements, then:
codesign --force --sign "Apple Development: you@example.com" \
  --entitlements /tmp/entitlements.plist Payload/Kabmo.app
```

In practice the sane route is **Xcode → open `Package.swift` → run on a device**, or
archive to TestFlight. `scripts/build-ipa.sh` exists for CI and for a reproducible
artifact, not to replace either.

## First run

1. The app opens **Server settings** (there is nothing to load yet).
2. Type the address — scheme, host and port only: `http://192.168.1.20:3000`.
   A bare `192.168.1.20:3000` works and defaults to `http`.
3. **Test connection** calls `GET /api/health` and reports the server's version,
   port, whether a password is required, and whether it is in demo mode. A response
   from something that is not Kabmo is refused by name.
4. **Connect** saves the address and clears cookies **only when the address changed**
   — a different origin is a different server, and a stale session cookie would be
   sent to it. Pressing Connect on the address already saved keeps the session,
   because this is also the screen the zoom slider lives on.

### Launch overlay

From the tap until the console paints, the shell draws the wordmark, a progress bar
and one sentence naming what is happening. It is a **sibling of the web view**, never
a view inside the page — the page cannot report its own readiness (its own bundle is
what renders the app), and a page-drawn overlay would vanish exactly when the page
fails to load.

- **The wordmark is the artwork `README.md` embeds**, carried as path data in
  `Wordmark.swift` because there is no SVG renderer in UIKit. `WordmarkTests`
  re-derives every number from `public/kabmo-wordmark.svg` — the viewBox, the shift,
  every path verbatim, the plate, the gradient, the stroke weight and the inks — and
  rasterizes the mark to assert ink where the artwork has ink.
- **The bar sweeps until the web view reports real progress.** A determinate bar at 0
  is indistinguishable from a stuck one, and `UIProgressView` has no indeterminate
  state — so `SweepBar` slides a segment along the same 180-point track, the way the
  Android shell's `ProgressBar` does. The two share one row (`barRow`), so the
  sentence does not shift when the phase changes.
- **100% is not a finish, and progress never moves backwards.** `estimatedProgress`
  reaches 1.0 before `didFinish`, and a redirect runs it back down.
- **A failed main-frame load keeps the overlay up with the reason** — host not found,
  connection refused, timeout, untrusted certificate, or a catch-all — plus **Retry**
  and **Server settings**, and WebKit's own sentence under ours (`setDetail`), which
  names the address and the system error. The macOS, Windows and Linux shells print
  the same pair.
- **`didFinish` does not clear a failure.** A failed load still finishes on the error
  page WebKit renders; hiding the overlay there is the blank screen the overlay exists
  to remove.
- **A reload from the console's own header shows the overlay too, and the URL is the
  only signal.** `location.reload()` arrives as an ordinary navigation with the same
  URL; `LoadingState.isDocumentReload` compares it against the one on screen, and only
  from a finished document so a cold start does not restart its own arm.

### Page zoom

A slider from **50% to 200% in 1% steps**, with the current percent beside the label
and a **Reset to 100%** button. It saves on every change — no Apply — because the
console behind the screen is what the user is judging.

- It applies through `WKWebView.pageZoom`, which is **page-relative**: 150% is `1.5`.
  The Android shell multiplies by the display density because `setInitialScale` counts
  percent of the *device's* scale; doing that here would render a 100% setting at 2.6×
  on a 3× phone. `ShellSettingsTests` pins the mapping for exactly that reason.
- It is re-applied on every appearance, so it survives a visit to the settings screen
  and a cold start.
- **Pinch zoom is the platform's own** and independent of the slider: the slider sets
  where a load starts, a pinch overrides it for that session.

**A path is refused on purpose.** Every client call is root-relative (`fetch('/api/…')`)
and both sockets derive their URL from `window.location`, so `http://host:3000/kabmo`
would send `/api/health` to `http://host:3000/api/health`. The field says so instead
of accepting a URL that breaks.

### Getting back to it

**One entry point: long-press the Kabmo icon → _Server settings_.**

There is deliberately no in-app control. The web view fills the display, and every
edge belongs to Kabmo's own chrome — a floating button sits on a control it is not.
The quick action is also the only entry point that still works when the saved address
no longer answers, which is exactly when it is needed.

## Plain http, and what it costs

Cleartext is permitted **for web content** (`NSAllowsArbitraryLoadsInWebContent`),
because the server address is typed at runtime and cannot be listed in a per-domain
exception. `URLSession` keeps its own rules, so the health probe still fails closed on
a certificate it does not trust.

| | |
|---|---|
| Password + session cookie | cross the network unencrypted |
| Voice dictation | **unavailable** — `getUserMedia` needs a secure context |
| Clipboard | falls back to `execCommand` |
| Realtime sockets | `ws://` permitted by the same rule |

For a network you do not trust: use a tunnel (Tailscale, Cloudflare Tunnel, Caddy) and
enter the `https://` URL. `--tls` self-signed is refused with a named alert, because
`WKWebView` fails closed on an unknown issuer.

## What the web view implements, and why each matters

Every one of these is a Kabmo feature that dies silently without it:

| WebKit hook | Feature it keeps alive |
|---|---|
| file input support (built in) | the composer's 📎 attach button |
| `createWebViewWith` | provider OAuth login (`window.open(…, '_blank')`), release notes, social links |
| `decidePolicyFor navigationResponse` + `WKDownload` | the editor's Download button, fetched WITH the session cookie |
| `didReceive challenge` | a named refusal instead of a blank page |
| `decidePolicyFor navigationAction` | external links leave the shell instead of replacing Kabmo |
| `window.__kabmoBack()` | a back gesture closes the drawer / editor / settings first |

The back button is a **page-delegated** decision: Kabmo's phone layout keeps its
screens in React state (`MobileLayoutWrapper`'s `currentScreen`), not in the URL, so
history alone would reopen a previous session while leaving the drawer on screen.
`src/client/lib/native/back.ts` owns the handler stack. iOS has no hardware back
button, so the shell does not intercept a gesture — the handler exists for a future
edge-swipe policy and for the platform's own accessibility gestures.

## Opening a document from another app

Kabmo appears in the Files app's **Share → Open in** and in another app's
"Open with" list for the types its editor can render. `CFBundleDocumentTypes` in
`Resources/Info.plist` is the declaration, GENERATED from
`release/document-types.mjs` by `scripts/shell-document-types.mjs`
(`bun run shell:docs`) into a marked region — the same table the macOS bundle and
the Windows installer are rendered from, so a format added for one cannot be
missing on the other.

Two keys decide the behaviour, and both are the macOS shell's:

- `CFBundleTypeRole: Viewer` — Kabmo shows the document, it does not own it;
- `LSHandlerRank: Alternate` — an option in the chooser, never the app a `.pdf`
  opens in by itself.

`LSSupportsOpeningDocumentsInPlace` is the iOS-only half: without it iOS copies
the document into this app's Inbox, and a 20 MiB workbook is duplicated for
nothing. With it the URL is handed over as-is and the shell brackets its read
with `startAccessingSecurityScopedResource` — a security-scoped URL read without
that bracket fails with a permission error that looks exactly like a missing
file.

### Why the bytes travel through the page

The desktop shells hand over a PATH and the server opens it — they are on the
same machine. A phone is not: the console may be across the world, so a file
picked here exists only on the DEVICE. So `ShellViewController.deliver` reads the
URL and pushes it into the page in chunks:
`__kabmoOpenFiles([{id,name,mimeType,size}])` then `__kabmoOpenChunk(id, base64,
last)` repeated, and the page decodes only on the final chunk. `DeviceFiles`
holds the rules and `Tests/DeviceFilesTests.swift` pins them without a simulator.

A document that arrives before the console has loaded is QUEUED and flushed on
the first finished load — the cold start is the common case, because the app was
launched by the file. `AppDelegate` forwards it: UIKit calls
`application(_:open:options:)` AFTER `didFinishLaunching`, so the view controller
exists by then and owns the queue.

**The tab is READ-ONLY**, and says so: there is no path to write back to and no
writable handle. A reload cannot recover the bytes either — the URI grant
belonged to the native intent — so the tab switches to a second sentence telling
the user to open it again from the app that shared it.

## The update control

The console's sidebar footer carries one control directly after *About*:

| Where | Offer | When |
|---|---|---|
| Inside the iOS shell | **Update app** — `Update Kabmo <version> for iOS` | the published IPA is newer than the one running |
| A desktop browser, an Android browser | nothing from the iOS path | an IPA cannot be installed there |
| A browser **on iOS** | nothing | iOS has no sideload-by-URL path, so there is no install offer to make |

The version travels on the User-Agent as `KabmoIOS/<version>` — appended through
`applicationNameForUserAgent`, so it is on the very first request and the server
answers without a bridge or a round trip. `GET /api/updates/ios` reads the published
asset's version out of its NAME (`Kabmo-1.2.3-ios.ipa` → `1.2.3`), because the
release tag names the *server* version and the two move independently.

Tapping the control inside the shell downloads the IPA and then explains, rather than
installing: see "The one feature that cannot be ported".

## Layout

```
packages/ios/
├── Package.swift                    SwiftPM: logic target, app target, test runner
├── version.properties               the shell's version — the ONE place it is declared
├── Sources/
│   ├── KabmoShell/                  every rule that can be tested without a screen
│   │   ├── URLNormalizer.swift      the server address, and every refusal
│   │   ├── ShellSettings.swift      address + zoom storage, the zoom mapping
│   │   ├── LoadingState.swift       the overlay's rules (pure)
│   │   ├── HealthProbe.swift        GET /api/health, and what counts as a Kabmo
│   │   ├── ShellUpdate.swift        what counts as an IPA, and the version compare
│   │   ├── ShellUserAgent.swift     the `KabmoIOS/<version>` token
│   │   ├── SVGPath.swift            the SVG subset the wordmark uses
│   │   ├── Wordmark.swift           the artwork, as path data
│   │   └── WordmarkRenderer.swift   draws it, with no UIKit
│   └── kabmo-shell/                 the app (guarded by `#if canImport(UIKit)`)
│       ├── main.swift               entry point
│       ├── AppDelegate.swift        window + the quick action
│       ├── ShellViewController.swift  web view, overlay, downloads, back
│       ├── ShellWebView.swift       configuration, UA token, origin test
│       ├── ShellNavigationDelegate.swift  navigation policy
│       ├── ShellDownloads.swift     WKDownload + share sheet (the cookie-carrying path)
│       ├── LoadingOverlay.swift     the launch overlay
│       ├── SweepBar.swift           its indeterminate bar (`UIProgressView` has none)
│       ├── SettingsViewController.swift   server settings
│       ├── SettingsControls.swift   the screen's layout pieces
│       ├── SettingsCopy.swift       every sentence it prints
│       ├── Palette.swift            paper/ink, for the two native surfaces
│       └── WordmarkImage.swift      the wordmark as a UIImage
├── Tests/                           the logic suite (plain executable, no XCTest)
├── Resources/Info.plist             the bundle
└── scripts/
    ├── build-ipa.sh                 assemble the .ipa
    └── make-icon.swift              render the icon from geometry
```

## Releases

The IPA is released by `.github/workflows/release.yml` on every push to `main` that
cuts a version. It is not an npm package: `packages/ios` is a private application, so
the only artifact is the `.ipa` attached to the GitHub release the `app` job created.

**Building the IPA is a GATE on the release, not a step after it.** The body runs in
two phases and `release.yml` calls it twice:

```
release.yml
  gates ─┐
  e2e  ──┴─> packages ─> marketplace ─> android ─> ios ─> apk-build ─> ipa-build ─> app
                                                                        (mode: build)  │
                                                                                       └─> apk, ipa   ← mode: attach
```

- **`ipa-build` runs BEFORE the tag.** It compiles, runs the logic suite, verifies the
  bundle's version and executable, and uploads the IPA as a run artifact. `app`
  `needs: ipa-build`, so a Swift error or an unavailable macOS runner stops the release
  before anything is tagged or published.
- **`ipa` only attaches.** It downloads that artifact and uploads it to the release
  `app` created. Artifacts are scoped to the run, so the uploaded bytes are exactly the
  ones the checks passed.
- **The shell has its OWN version, in `packages/ios/version.properties`, and the
  pipeline bumps it.** The `shells` job runs `release/release-shells.mjs` before
  `ipa-build` compiles: it reads the commits since the version line was last written,
  asks the same `release-rules.js` analyzer the app uses for the level (`fix` → patch,
  `feat` → minor, a `BREAKING CHANGE:` → major), rewrites the one line, and commits it.
  A `chore`/`docs`/`test`-only change to the shell asks for no bump.
- **The artifact is `Kabmo-<version>-ios.ipa`** — the shell's version, never the
  release tag, because `versionFromAssetName('ios', …)` reads the published version out
  of the asset name.
- **A shell bump reaches an installed app on the next app release.** The IPA rides the
  app's GitHub release rather than having a tag of its own.
- **A failed build can be repaired on its own**, without re-running the release:
  dispatch **Build and attach the iOS shell** with the release tag and a higher
  `build-number`.
- **The logic tests run here, not in `gates.yml`**, so a pull request never pays for the
  Apple toolchain.
