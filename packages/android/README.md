# Kabmo Android shell

A thin Android app that shows a Kabmo console in a WebView. It is a **shell only**:
the server (Bun + `omp` + PTY + `git`) runs elsewhere — a laptop, a workstation, a
NAS — and this app points at it.

Kotlin, no AndroidX, no Compose, no Material. The APK contains the platform
WebView and this source; every dependency added here is weight the shell does not
need.

## Why a shell and not a server

Kabmo's server needs `omp`, a POSIX PTY shell, `git` and `rg` on the host. Android
has none of them, and `ompStartupError()` refuses to boot without the `omp` binary.
The phone is a viewer.

## Requirements

| | |
|---|---|
| JDK | 17 (`JAVA_HOME` must point at it — AGP rejects 8 and 11) |
| Android SDK | `platforms;android-35`, `build-tools;35.0.0`, `platform-tools` |
| Gradle | via `./gradlew` (8.9, pinned in `gradle/wrapper/`) |

`local.properties` is **not committed** — it names the SDK on this machine:

```properties
sdk.dir=/path/to/android-sdk
```

## Build

```bash
cd packages/android
export JAVA_HOME=/path/to/jdk-17
./gradlew :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk      (measured 890,798 B)

./gradlew :app:assembleRelease
# → app/build/outputs/apk/release/app-release.apk  (measured 76,917 B, R8 + resource shrink)

./gradlew :app:testDebugUnitTest
# → 44 tests: URL normalization, zoom math, the overlay's state rules (including
#   what makes a reload a reload), and the wordmark drawable against the README
#   SVG (plain JVM, no emulator)
```

The release APK is **77 KB** because it carries no library: one `classes.dex`,
the five launcher densities, the wordmark vector, and the platform WebView. The
debug build is 891 KB because it is not minified and carries the debug symbols.

Install on a connected device:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Signing

`assembleRelease` falls back to the **debug keystore** so a release APK is always
buildable. That is fine for sideloading and wrong for distribution: a debug key
cannot be upgraded over a different install, and Play rejects it.

To sign properly, create `keystore.properties` **at `packages/android/`** (gitignored).
The build reads it at configuration time and switches the release `signingConfig` to
it; without the file the debug key is used:

```properties
storeFile=/absolute/path/to/release.jks
storePassword=…
keyAlias=…
keyPassword=…
```

A keystore can be created with:

```bash
keytool -genkeypair -v -keystore release.jks -keyalg RSA -keysize 4096 \
  -validity 10000 -alias kabmo
```

## Releases

The APK is released by `.github/workflows/release.yml` on every push to `main`
that cuts a version, as its **last** job (`apk`). It is not an npm package:
`packages/android` is a private application, so the only artifact is the `.apk`
attached to the GitHub release the `app` job created.

```
release.yml
  gates ─┐
  e2e  ──┴─> packages ─> marketplace ─> android ─> app ─> app-publish
                                                        └──> apk   ← publish-android.yml
```

- **After the gates, and after `app`.** `gh release upload` needs the release to
  exist, so the job `needs: app`; the gates are transitive through
  `app → android → marketplace → packages → gates/e2e`.
- **The shell has its OWN version, in `packages/android/version.properties`, and
  the pipeline bumps it.** `versionName` is that number; `versionCode` is still
  the workflow run number, because Android refuses an install whose code does not
  increase and a counter is not a version. The `android` job runs
  `release/release-android.mjs` **before** `app` tags: it reads the commits since
  the version line was last written, asks the same `release-rules.js` analyzer the
  app uses for the level (`fix` → patch, `feat` → minor, a `BREAKING CHANGE:` →
  major), rewrites the one line, and commits it. A `chore`/`docs`/`test`-only
  change to the shell asks for no bump and none is written.
- **Why a version of its own.** The number is the entire delivery mechanism: the
  shell appends `KabmoAndroid/<versionName>` to its WebView User-Agent, and the
  console offers a download only when the published asset's version is *newer*
  than that. When `versionName` was the app's release tag, a shell-only fix could
  not reach an installed app unless the server also cut a version — and the number
  it reported said nothing about whether the shell had changed.
- **The artifact is `kabmo-android-v<versionName>.apk`** — the shell's version,
  never the release tag, because `versionFromAssetName` reads the published
  version out of the asset name. The built APK is checked with
  `aapt2 dump badging` against `version.properties` and the run number before
  upload.
- **A shell bump reaches an installed app on the next app release.** The APK rides
  the app's GitHub release rather than having a tag of its own, so the bump lands
  on `main` immediately and the artifact follows with the next tag.
- **Signing is optional.** With `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` set
  as repository secrets, the release is signed with that key; without them it is
  debug-signed, which sideloads fine but cannot upgrade a properly signed
  install. The keystore and `keystore.properties` are deleted in an `always()`
  step.
- **The Android unit tests run here, not in `gates.yml`**, so a pull request
  never pays for the Android toolchain.

## First run

1. The app opens **Server settings** (there is nothing to load yet).
2. Type the address — scheme, host and port only: `http://192.168.1.20:3000`.
   A bare `192.168.1.20:3000` works and defaults to `http`.
3. **Test connection** calls `GET /api/health` and reports the server's version,
   port, whether a password is required, and whether it is in demo mode. A
   response from something that is not Kabmo is refused by name.
4. **Connect** saves the address and clears cookies **only when the address
   changed** — a different origin is a different server, and a stale session
   cookie would be sent to it. Pressing Connect on the address already saved
   keeps the session, because this is also the screen the zoom slider lives on:
   it used to sign the user out for adjusting the zoom and then confirming.

### Launch overlay

From the tap until the console paints, the shell draws a **progress overlay**:
the wordmark, a bar, and one sentence naming what is happening. It is a
**sibling of the WebView in a `FrameLayout`**, never a view inside the page —
the page cannot report its own readiness (its own bundle is what renders the
app), and a page-drawn overlay would vanish exactly when the page fails to load.

- **The wordmark is the artwork README.md embeds, not the app's name in a
  text view.** `res/drawable/kabmo_wordmark.xml` is a port of
  `public/kabmo-wordmark.svg` — the same icon plate, the same three K strokes,
  the same outlined word, the same colours — carried as a VectorDrawable
  because the overlay is platform views and has no SVG renderer. Three things
  differ, and only because a VectorDrawable is not an SVG: every y is shifted
  by `+128.12` (the SVG is authored around a baseline at 0, and a viewport
  cannot start below the origin), the plate is a path rather than a `<rect>`,
  and the gradient is inline as `startX/startY/endX/endY` in viewport space.
  `WordmarkDrawableTest` re-derives the drawable from the SVG — every path,
  every coordinate, the gradient span and its two stops, the stroke weight and
  the per-stroke colours — so the two copies cannot drift apart silently. The
  `app_name` string stays as the `ImageView`'s `contentDescription`: the
  drawable is the mark, not a replacement for the accessible name.

- **The bar is indeterminate until the WebView reports real progress.** A
  determinate bar sitting at 0 is indistinguishable from a stuck one, and the
  first seconds of a cold start are when the user is deciding whether the app is
  broken. Chromium's 0% tick is therefore ignored (`LoadingState.progressed`).
- **100% is not a finish, and progress never moves backwards.** The WebView
  reports 100 before `onPageFinished`, and the server's shell is still fetching
  the client bundle at that point; a redirect restarts the document and reports
  100 then 10 again, which would make the bar snap back and read as a stall.
- **A failed main-frame load keeps the overlay up with the reason** — host not
  found, connection refused, timeout, untrusted certificate, or a catch-all —
  plus **Retry** and **Server settings**. The main-frame test is what makes this
  usable: a page that loads but cannot reach one of its assets reports an error
  too, and treating that as a failed page would cover a console that already
  works.
- **`onPageFinished` does not clear a failure.** A failed load still finishes on
  the error page Chromium renders; hiding the overlay there is exactly the blank
  paper screen with no explanation that the overlay exists to remove. Retry
  reloads the saved address, because the error page is not a document the
  console can recover from.
- **A reload from the console's own header shows the overlay too, and the url is
  the only signal that it is one.** The page's Reload control calls
  `location.reload()`, which the WebView reports as an ordinary document load:
  no reload flag reaches `onPageStarted` and `doUpdateVisitedHistory` says
  `isReload=false` (measured on Android 15). What it does report is the SAME url
  the WebView is already showing, while a `location.href = '/other'` navigation
  reports a different one — so `LoadingState.isDocumentReload(startedUrl,
  shownUrl, phase)` compares them. Two rules make that safe: it only fires from
  `DONE` (`startLoad` arms the overlay itself before `loadUrl`, and a cold
  start's first `onPageStarted` would otherwise restart its own arm), and the
  shown url is latched in `onPageFinished` rather than read from `view.url`,
  which already points at the incoming document once the next load begins.

The rules live in `LoadingState` (pure, JVM-tested — every one of them is an
ordering the platform actually produces) and the drawing in `LoadingOverlay`.

### Staying signed in

The session cookie is HttpOnly with a 12-hour lifetime (7 days with *Trust this
device*), and the shell keeps it across a restart in two ways:

- **`CookieManager.flush()` is called the moment a page finishes loading and on
  every `onPause`.** Chromium persists its cookie store on a timer and on a clean
  shutdown; an app swiped out of recents or force-stopped gets neither, so a
  session created seconds earlier was lost and the next launch asked for the
  password again. Measured on Android 15: the cookie row appeared in
  `app_webview/Default/Cookies` at **t+30 s** after signing in, so closing the app
  inside that window always cost a login. With the flush it is on disk by t+4 s,
  and a force-stop → reopen comes back signed in.
- **Cookies are cleared only when the origin changes** (`UrlNormalizer.sameOrigin`
  in the settings screen, and `loadedUrl` in `MainActivity`). A cookie is scoped
  to a host and port, so the same address keeps it.

### Page zoom

**Page zoom** is on the same screen: a slider from **50% to 200% in 1% steps**,
with the current percent beside the label and a **Reset to 100%** button.

- **Every whole percent is a position** (151 of them). A 10% grid was the first
  shape and it was too coarse to aim — the size a reader wants is usually one
  notch off where the grid sits, and `setInitialScale` has no sub-percent
  resolution to split the difference with. A `SeekBar` gives ~2px per step across
  a phone's track, and the percent is printed beside the label as the thumb moves
  so the exact value is readable rather than guessed.
- It saves on every change — there is no Apply — because the console behind the
  screen is what the user is judging, and a value that needed confirming could not
  be previewed.
- It applies on the WebView through `setInitialScale`, and the value is
  re-applied on every `onResume`, so it survives navigation and a cold start.
  `WebSettings.textZoom` was deliberately not used: it scales text only and
  leaves layout at 100%, which reflows a two-column phone view into something
  that no longer matches its boxes.
- **The argument is the percent times the display density**, not the percent
  (`ServerConfig.initialScaleFor`). `setInitialScale` counts percent of the
  DEVICE's default scale while the slider counts percent of the PAGE, so passing
  it the bare number is a bug that hides on a 1x emulator and ruins a real phone:
  at density 2.625 a 100% setting rendered at **0.38x**, every position from 50%
  to 100% clamped to that same 0.38x, and 200% only reached 0.76x — the console
  drew its desktop layout on a phone and no slider position appeared to do
  anything. Measured on Android 15 (WebView 124, 1080×2340): with the multiply,
  50/100/200% land on page scale 0.5/1.0/2.0 at densities 1.0, 1.5, 2.0 and
  2.625; without it the same three read 0.19/0.38/0.76 at 2.625.
- **The layout width comes from the WebView, not the page's viewport tag**
  (`useWideViewPort = false`). With it on, Blink pins the page-defined initial
  scale to 1.0 whenever the tag says `width=device-width`
  (`PageScaleConstraintsSet::AdjustForAndroidWebViewQuirks`), so the slider could
  not zoom OUT at all — 50/60/70/80/90/100% all rendered at exactly 1.0x. With it
  off the layout viewport is the device width in DIPs (413 CSS px on that
  1080px/420dpi screen — the same width the tag produced) and every position maps
  1:1. `viewport-fit=cover` still applies: Chromium logs
  `E2E_Used ViewportFitCover` and the safe-area insets resolve.
- **It is not the pinch zoom.** A two-finger spread zooms the VIEWPORT, the same
  gesture Chrome gives a page, and the two are independent: the slider sets where
  a load starts, a pinch overrides it for that session, and a fresh load returns
  to the slider's value (measured: pinch 1 → 2.88, then a cold start back at 1).
  The gesture was switched OFF in the first build (`setSupportZoom`,
  `builtInZoomControls` both false), which is why the shell felt frozen next to a
  browser; all three are on now with `displayZoomControls = false`, so the
  gesture works and no +/- buttons appear.
- A stored value is snapped onto the slider's grid on read (`ServerConfig.zoom`),
  so a percent written by hand — through `adb`, or by an older build — cannot put
  the thumb at one end while the page scales by another value. `ZoomClampTest`
  asserts that for every integer from -100 to 400, and `ZoomScaleTest` pins the
  density conversion (including the page-scale identity Blink computes from it).

**A path is refused on purpose.** Every client call is root-relative
(`fetch('/api/…')`), and both sockets derive their URL from `window.location`, so
`http://host:3000/kabmo` would send `/api/health` to `http://host:3000/api/health`.
The field says so instead of accepting a URL that breaks.

### Getting back to it

**One entry point: long-press the Kabmo icon → *Server settings*.**

There is deliberately no in-app control. The WebView fills the display, and every
edge of it belongs to Kabmo's own chrome — a floating button sits on a control it
is not, and an edge tab covers the transcript's scroll gutter. The launcher
shortcut is also the only entry point that still works when the saved address no
longer answers, which is exactly when it is needed.

The shortcut intent targets `MainActivity`, not `SettingsActivity`: a shortcut is
launched with the launcher's identity, so a non-exported target is refused
(`Permission Denial: … not exported from uid`). `SettingsActivity` stays
unexported and `MainActivity` opens it when the action arrives — on create and
again in `onNewIntent`, because `singleTask` delivers a re-launch to the running
instance.

## The APK download button

The console's sidebar footer carries one control directly after *About*, and it
is one of TWO offers:

| Where | Offer | When |
|---|---|---|
| Inside the APK | **Update** — `Update Kabmo <version> for Android` | the published APK is newer than the one running |
| Chrome / Brave / Firefox **on Android** | **Install** — `Install Kabmo <version> for Android` | an APK is published |
| A desktop browser, an iPad | nothing | an APK cannot be installed there |

The second row exists because a reader on a phone browser may not know the
native shell exists at all — and because nothing is installed there, it names the
newest published APK rather than comparing versions.

Both facts travel on the User-Agent, which the server reads for the very request
that renders the shell — no bridge, no extra round trip:

1. **Which APK is asking.** The APK appends `KabmoAndroid/<version>`, parsed into
   `shellVersion`. A browser has no token.
2. **Whether this is an Android device at all**, parsed into `isAndroid` from the
   `Android` platform token — which an Android tablet also sends (without
   `Mobile`) and an iPad does not.

The third input is the published APK itself: `GET /api/updates/android` scans the
release list and takes the newest one whose assets include an APK, reading the
version from the asset NAME (`kabmo-android-v1.2.3.apk` → `1.2.3`). The release
TAG cannot be used — the APK is attached to the app's release, whose tag names
the *server* version, and the two move independently. It is deliberately **not**
`/releases/latest`: one push publishes three artifacts and the npm packages are
released before the app, so their `kabmo-sdk/v*` release is newer than the one
carrying the APK — asking for the latest answered a release with no APK and the
button disappeared.

An app that is already current shows nothing — a button that downloads the build
already installed is worse than no button — and so does one that is *ahead* of
the published asset (a sideloaded newer build).

The probe is lazy (only when a shell is detected), cached five minutes per
process, and a failure answers `{url: null, latest: null}` rather than a 500: a
button the console cannot back with a link must not appear.

## Plain http, and what it costs

Cleartext is enabled app-wide (`res/xml/network_security_config.xml`), because the
server address is typed at runtime and cannot be listed in a per-domain exception.
The consequences are shown on the setup screen rather than hidden:

| | |
|---|---|
| Password + session cookie | cross the network unencrypted |
| Voice dictation | **unavailable** — `getUserMedia` needs a secure context |
| Clipboard | falls back to `execCommand` |
| Realtime sockets | `ws://` permitted by the same rule |

For a network you do not trust: use a tunnel (Tailscale, Cloudflare Tunnel, Caddy)
and enter the `https://` URL. `--tls` self-signed works only in debug builds, where
`debug-overrides` trusts user-installed CAs; a release APK fails closed on an
unknown issuer and says so.

## What the WebView implements, and why each matters

Every one of these is a Kabmo feature that dies silently without it:

| WebView hook | Feature it keeps alive |
|---|---|
| `onShowFileChooser` | the composer's 📎 attach button |
| `onCreateWindow` | provider OAuth login (`window.open(…, '_blank')`), release notes, social links |
| `setDownloadListener` + cookie forwarding | the editor's Download button |
| `onReceivedSslError` | a named refusal instead of a blank page |
| `shouldOverrideUrlLoading` | external links leave the shell instead of replacing Kabmo |
| `window.__kabmoBack()` | the back button closes the drawer / editor / settings first |

The back button is a **page-delegated** decision: Kabmo's phone layout keeps its
screens in React state (`MobileLayoutWrapper`'s `currentScreen`), not in the URL,
so `history.back()` alone would reopen a previous session while leaving the drawer
that opened it on screen. `src/client/lib/native/back.ts` owns the handler stack;
the shell calls it and falls back to WebView history, then to `finish()`.

## Layout

```
packages/android/
├── app/src/main/
│   ├── AndroidManifest.xml          cleartext, launcher shortcut, single Task
│   ├── java/dev/kabmo/shell/
│   │   ├── MainActivity.kt          WebView + launch overlay + back
│   │   ├── LoadingOverlay.kt        wordmark, progress bar, failure sentence, Retry
│   │   ├── LoadingState.kt          the overlay's rules (pure, JVM-tested)
│   │   ├── SettingsActivity.kt      native server settings (first run too)
│   │   ├── KabmoWebView.kt          settings, cookies, origin comparison
│   │   ├── KabmoWebViewClient.kt    navigation policy, reload signal, SSL refusals
│   │   ├── KabmoChromeClient.kt     window.open, file chooser
│   │   ├── KabmoDownloads.kt        DownloadManager + session cookie
│   │   ├── HealthProbe.kt           GET /api/health
│   │   └── ServerConfig.kt          storage + URL normalization
│   └── res/                         strings, colours, theme, icons, xml
│       └── drawable/kabmo_wordmark.xml  the README wordmark as a VectorDrawable
├── build.gradle.kts                 AGP + Kotlin pins
└── gradle/wrapper/                  Gradle 8.9
```

## Client-side counterpart

One file in the main app serves this shell:

- `src/client/lib/native/back.ts` — `window.__kabmoBack()` and the handler stack,
  which is how the hardware back button closes a drawer, the editor or a dialog
  before the shell walks WebView history.

It is inert in a browser: the shell is the only caller, and `main.tsx` installs
the dispatcher unconditionally because a function nothing calls costs nothing.
