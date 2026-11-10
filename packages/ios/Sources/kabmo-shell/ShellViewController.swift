#if canImport(UIKit)
import UIKit
import WebKit
import KabmoShell

/// The shell: one full-screen web view, the launch overlay, and the settings
/// screen behind a long-press shortcut.
///
/// Two decisions are load-bearing and each was the alternative's failure:
///
/// 1. **The URL is loaded directly, never proxied.** Every WebSocket upgrade is
///    origin-checked server-side by comparing `Origin` to `Host`, so a custom
///    scheme or a rewriting proxy is rejected with 403 on the realtime, terminal
///    and dictation sockets.
/// 2. **The settings screen is a separate view controller.** A sheet over the web
///    view would be dismissed by any navigation, and the first run has no page to
///    draw one over.
///
/// There is deliberately NO in-app control for the server address. The web view
/// fills the display, and every edge of it belongs to Kabmo's own chrome — a
/// floating button sits on a control it is not, and an edge tab covers the
/// transcript's scroll gutter. The one entry point is the **Home Screen quick
/// action** (long-press the icon → Server settings), which is also the only one
/// that still works when the saved address no longer answers.
final class ShellViewController: UIViewController {

  /// The quick action the shortcut sends. Matches `UIApplicationShortcutItemType`
  /// in `Info.plist`.
  static let openSettingsShortcut = "dev.kabmo.shell.openSettings"

  private var webView: WKWebView!
  private let overlay = LoadingOverlay()
  private let navigation = ShellNavigationDelegate()
  private var loading = LoadingState.done
  private var loadedURL: String?
  private var pendingSettings = false

  /// The observation feeding the overlay's progress bar.
  ///
  /// `estimatedProgress` is KVO-only: `WKNavigationDelegate` reports started,
  /// finished and failed, and NOTHING in between — a delegate-only shell draws a bar
  /// that jumps from indeterminate to gone, which is the "did it hang?" state the
  /// overlay exists to remove. Held so it can be removed when the view goes away;
  /// an un-removed observer on a deallocated web view is a crash.
  private var progressObservation: NSKeyValueObservation?

  /// The console's downloads. Owned here because it needs a presenter for the share
  /// sheet, and because a `WKDownload`'s delegate must outlive the navigation that
  /// started it.
  private let downloads = ShellDownloads()

  private let settings = ShellSettings()

  /// Answers the console's server panel — the same four commands the desktop
  /// shells answer, minus the two a phone cannot (there is no child process).
  private lazy var serverHost = ShellServerHost(settings: settings)

  /// This build's version, read from the bundle. One source: `Info.plist`, which
  /// the build script fills from `version.properties`.
  private var version: String {
    (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // The palette the console reported on a PREVIOUS launch, so the overlay is
    // already the right colour before anything loads.
    Palette.active = settings.palette
    view.backgroundColor = Palette.paper

    webView = makeWebView()
    view.addSubview(webView)
    view.addSubview(overlay)
    webView.translatesAutoresizingMaskIntoConstraints = false
    overlay.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      webView.topAnchor.constraint(equalTo: view.topAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      overlay.topAnchor.constraint(equalTo: view.topAnchor),
      overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])

    // The progress half of the overlay. Armed once, on the web view that outlives
    // every navigation — the state machine ignores a frame after `done` or `failed`,
    // so a late estimate from the previous document costs nothing.
    progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
      guard let self, let fraction = change.newValue else { return }
      self.applyLoading(self.loading.progressed(fraction: fraction))
    }

    downloads.presenter = self
    downloads.onFailure = { [weak self] message in
      self?.showDownloadAlert(message)
    }

    overlay.onRetry = { [weak self] in self?.retryLoad() }
    overlay.onOpenSettings = { [weak self] in self?.openSettings() }

    // First run: there is nothing to load. The setup screen saves an address and
    // dismisses; `viewDidAppear` then loads it.
    if settings.url == nil {
      pendingSettings = true
    }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)

    // Zoom is applied on EVERY appearance, not only when it changes: the settings
    // screen writes it while this controller is covered, and the value is cheap to
    // set (one assignment; the web view relayouts once).
    applyZoom()

    // Tell the page the app is back, so the realtime channel repairs itself now
    // rather than at its next watchdog tick. A backgrounded `WKWebView` may never
    // deliver `visibilitychange`, and a socket the server's heartbeat reaped while
    // the page was frozen produces no `close` — so the channel would sit on a dead
    // socket with no frames until something else woke it. Same contract as the
    // Android shell; `shared/lib/realtime/resume.ts` is the mechanism and its
    // watchdog covers the case where even this never runs.
    webView.evaluateJavaScript("window.__kabmoResume && window.__kabmoResume()", completionHandler: nil)

    if pendingSettings || pendingShortcut {
      pendingSettings = false
      pendingShortcut = false
      openSettings()
      return
    }

    guard let url = settings.url else { return }
    if url == loadedURL { return }

    // The saved address changed — the settings screen's Connect, or the list
    // losing its active row. The web store is NOT dropped: a cookie is scoped to
    // its own host and the session cookie is named per port
    // (`omp_session_<port>`), so the address being left cannot reach the one
    // being opened, and it keeps the login that coming back should restore. The
    // desktop shells never clear the store on this gesture either; the one
    // stale-session case (a cookie the server no longer accepts) is a `302
    // /login` from the auth gate, not a 401 loop.
    startLoad(url)
  }

  // MARK: - Documents the OS handed over

  /**
   Take a document another app opened with Kabmo, and open it as a tab.

   The bytes travel through the PAGE, not the server: a phone's file exists only
   on the phone, so a console on another machine could never read it. The tab
   renders and is read-only, which is what the editor's own banner says.

   A document that arrives before the console has loaded is QUEUED — the cold
   start is the common case, because the app was launched by the file.
   */
  func openDocument(at url: URL) {
    guard DeviceFiles.isDocumentURL(url) else { return }
    pendingDocuments.append(url)
    flushDocuments()
  }

  /** Hand every queued document to the page, once there is one. */
  private func flushDocuments() {
    guard pageReady, !pendingDocuments.isEmpty else { return }
    let documents = pendingDocuments
    pendingDocuments.removeAll()
    for url in documents { deliver(url) }
  }

  // MARK: - Sessions a notification tap opened

  /**
   Open the session a notification was about.

   A tap that launched the app has no page yet, so the id is QUEUED and drained
   on the first finished load — the same rule the document queue above and the
   desktop shells apply.
   */
  func openNotificationSession(_ sessionId: String) {
    let id = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !id.isEmpty else { return }
    pendingNotificationSession = id
    flushNotificationSession()
  }

  private func flushNotificationSession() {
    guard pageReady, let sessionId = pendingNotificationSession else { return }
    pendingNotificationSession = nil
    webView.evaluateJavaScript(NotificationWire.openSessionScript(sessionId), completionHandler: nil)
  }

  /// A session a notification tap named, held until the console can take it.
  private var pendingNotificationSession: String?

  /**
   Read one document and push it into the page in chunks.

   The read is bracketed by `startAccessingSecurityScopedResource` /
   `stopAccessing…`: a URL from the Files app or from another app's share sheet
   is security-scoped, and reading it without that bracket fails with a
   permission error that looks exactly like a missing file. `LSSupportsOpening
   DocumentsInPlace` in `Info.plist` is the other half — without it iOS copies
   the document into this app's Inbox instead.

   Chunked rather than one call: a 20 MiB document is ~27 MiB of base64, and a
   single `evaluateJavaScript` of that size is a multi-second main-thread stall.
   The page only decodes on the final chunk, so a transfer that dies halfway can
   never open as a truncated document.
   */
  private func deliver(_ url: URL) {
    deliveryCounter += 1
    let id = DeviceFiles.deliveryId(counter: deliveryCounter)
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }

    // No `suggested` name here, and it is not an oversight: `suggestedFilename`
    // exists only on `URLResponse` — the name a DOWNLOAD server offers, which
    // `ShellDownloads` already reads. A document URL opened through
    // `application(_:open:options:)` carries its name in `lastPathComponent`
    // alone, and `url.suggestedFilename` does not compile at all: this whole
    // target sits behind `#if canImport(UIKit)`, so the Mac-only logic suite
    // cannot see it and the IPA build is the first place a wrong member shows.
    let name = DeviceFiles.displayName(
      resolved: url.lastPathComponent,
      suggested: nil,
      mimeType: DeviceFiles.mimeType(forExtension: url.pathExtension)
    )
    let mimeType = DeviceFiles.mimeType(forExtension: url.pathExtension)

    let bytes: Data
    do {
      bytes = try Data(contentsOf: url)
    } catch {
      // Announcing a file whose bytes could not be read would open an EMPTY tab
      // named after it, which reads as "the file is empty" rather than "it could
      // not be read". The overlay's own surface is the honest place for it.
      showDownloadAlert("Could not read \(name). The app that shared it may have closed.")
      return
    }

    let meta = DeviceFiles.Meta(id: id, name: name, mimeType: mimeType, size: bytes.count)
    webView.evaluateJavaScript(DeviceFiles.announceScript([meta]), completionHandler: nil)
    let base64 = bytes.base64EncodedString()
    let pieces = DeviceFiles.chunks(base64)
    for (index, piece) in pieces.enumerated() {
      webView.evaluateJavaScript(
        DeviceFiles.chunkScript(id: id, base64: piece, last: index == pieces.count - 1),
        completionHandler: nil
      )
    }
  }

  /// Set when a quick action arrives while the app is already running.
  var pendingShortcut = false

  /// A document the OS handed over, held until the console can take it.
  ///
  /// A COLD START by "Open in Kabmo" is the case that matters: the app launched
  /// BECAUSE of the file, so no page exists yet and `evaluateJavaScript` would
  /// drop every chunk into a blank document. The queue is drained on the first
  /// finished load — the same rule the macOS and Windows shells apply.
  private var pendingDocuments: [URL] = []
  /// True once a page has finished a load, so a script has somewhere to land.
  private var pageReady = false
  /// One id per delivery, so opening the same file twice opens two tabs.
  private var deliveryCounter = 0

  // MARK: - Web view

  private func makeWebView() -> WKWebView {
    // The UA token has to be in the CONFIGURATION: `applicationNameForUserAgent` is
    // read when the web view is created, and a value set afterwards is ignored with
    // no error — so the token would be missing from the very request that renders
    // the shell.
    let webView = WKWebView(
      frame: .zero,
      configuration: ShellWebView.makeConfiguration(version: version, serverHost: serverHost)
    )
    ShellWebView.configure(webView, zoomPercent: settings.zoom)
    serverHost.attach(webView)
    // A server the user picks is loaded by the CONTROLLER, not by the host: the
    // cookie jar, the loading overlay and `loadedURL` all live here.
    serverHost.onActivate = { [weak self] url in self?.switchServer(url) }

    navigation.serverURL = settings.url
    navigation.installedVersion = version
    navigation.downloads = downloads
    navigation.onLoadStarted = { [weak self] started, shown in
      guard let self else { return }
      // Only `startLoad` and a RELOAD re-open the overlay. A later in-app
      // navigation (the login submit is one) must NOT flash it: the state machine
      // ignores progress once it has finished, so a navigation after the console
      // is up costs nothing — while a FAILED main-frame load still surfaces its
      // reason, which is the blank-screen case worth covering.
      if LoadingState.isDocumentReload(startedURL: started, shownURL: shown, phase: self.loading.phase) {
        self.applyLoading(.connecting)
      }
    }
    navigation.onLoadFinished = { [weak self] in
      guard let self else { return }
      self.applyLoading(self.loading.finished())
      // A document that arrived before the console did — a cold start by "Open
      // in Kabmo" — has been waiting since `viewDidLoad`, and this is the first
      // moment a page can take it.
      self.pageReady = true
      self.flushDocuments()
      self.flushNotificationSession()
      // The console has painted, so `window.__kabmoPalette()` answers the
      // ACTIVE theme. Stored for the next cold start — the only launch where
      // the overlay has no page to ask — and applied to the live overlay too,
      // because a theme changed in Settings is exactly the case where the
      // stored palette is stale and the overlay it describes is on screen.
      self.readPalette()
      // A successful login is a NAVIGATION, so this is the first moment the new
      // session cookie exists. WebKit writes its store on a timer; a user who
      // closes the app right after signing in never reaches it, which is the
      // reported "asked for the password again on the next launch".
      WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
        // Touching the store flushes nothing by itself, but `getAllCookies` is the
        // documented way to force WebKit to materialize the store, and it runs
        // after the navigation that created the session cookie.
        _ = cookies
      }
    }
    navigation.onLoadFailed = { [weak self] failure, detail in
      guard let self else { return }
      self.applyLoading(self.loading.failedBecause(failure))
      // The engine's own sentence under ours: it names the address and the system
      // error, which is what makes a wrong port diagnosable. Same shape as the
      // macOS, Windows and Linux shells.
      self.overlay.setDetail(detail)
    }
    navigation.onCertificateProblem = { [weak self] detail in
      self?.showCertificateAlert(detail)
    }
    navigation.onOpenExternally = { url in
      UIApplication.shared.open(url)
    }

    webView.navigationDelegate = navigation
    webView.uiDelegate = navigation
    webView.allowsBackForwardNavigationGestures = false
    return webView
  }

  /// Begin a load with the overlay up.
  ///
  /// The state is armed BEFORE `load`, because a cached document can call
  /// `didStartProvisionalNavigation` on the same tick: arming afterwards would let
  /// the first progress frame of a real load be ignored as "already finished".
  /**
   Point the window at another server, from the console's own panel.

   The saved address was already made active by `ShellServerHost` before this is
   called, so there are two steps: latch the new address and load it. (It is
   answered on the main actor, which is where `load` belongs — a phone's bridge
   runs `servers_state` off the main thread, so the hop is the contract.)

   **The cookie store is deliberately untouched**, unlike the Android shell's
   first version: a cookie is scoped to its host and named per port, so it
   cannot leak into a different server, and deleting every cookie was what made
   moving between two servers sign the user out of BOTH. A switch therefore
   resumes the session the target still holds, which is what the desktop shells
   have always done.
   */
  private func switchServer(_ url: String) {
    guard url != loadedURL else { return }
    navigation.serverURL = url
    startLoad(url)
  }

  private func startLoad(_ url: String) {
    guard let target = URL(string: url) else { return }
    // Latched HERE rather than by each caller, so the recorded address is the one
    // a load was actually started for — an address the URL parser refused must
    // not look like the window is already on it.
    loadedURL = url
    applyLoading(.connecting)
    webView.load(URLRequest(url: target))
  }

  /// Retry from the overlay's own button.
  ///
  /// A failed load leaves the web view on WebKit's error page, which is not a
  /// document the console can recover from; reloading the saved address is the only
  /// retry that means anything.
  private func retryLoad() {
    guard let url = settings.url else { return }
    startLoad(url)
  }

  private func applyLoading(_ next: LoadingState) {
    loading = next
    overlay.render(next)
  }

  /// Ask the page which palette it is painting, and keep the answer.
  ///
  /// The property is installed by `src/client/lib/native/palette.ts` before the
  /// first render, so it exists by the time a load finishes. An older build
  /// answers `undefined`, the parse returns nil, and the stored palette is left
  /// exactly as it was rather than replaced with a colour no theme chose.
  private func readPalette() {
    webView.evaluateJavaScript("window.__kabmoPalette ? window.__kabmoPalette() : null") { [weak self] result, _ in
      guard let self, let wire = result as? String, let next = ShellPalette.parse(wire) else { return }
      self.settings.write(palette: next)
      Palette.active = next
      self.overlay.applyPalette()
      self.view.backgroundColor = Palette.paper
      self.webView.backgroundColor = Palette.paper
      self.webView.scrollView.backgroundColor = Palette.paper
    }
  }

  /// Apply the saved page zoom — the page's STARTING scale, and the live one.
  ///
  /// `WKWebView.pageZoom` is page-relative (1.0 = the page's own size), which is
  /// why `ShellSettings.pageZoom` is a plain ratio. Applying it on appearance takes
  /// effect on the live page with no reload, which is what makes the slider
  /// previewable through the settings screen.
  private func applyZoom() {
    webView.pageZoom = CGFloat(ShellSettings.pageZoom(for: settings.zoom))
  }

  // MARK: - Settings

  private func openSettings() {
    let screen = SettingsViewController(settings: settings)
    screen.onSaved = { [weak self] in
      guard let self else { return }
      // The saved address may have changed, so the origin test's input has to move
      // with it — otherwise the next navigation to the NEW server would be treated
      // as external and opened in Safari. `loadedURL` is NOT cleared: a save that
      // only moved the zoom slider must not reload the console (that was the
      // phone's "pressing Save reloads the page and I lose the draft"), and a real
      // address change is caught by `viewDidAppear` comparing it to `loadedURL`.
      self.navigation.serverURL = self.settings.url
    }
    let nav = UINavigationController(rootViewController: screen)
    nav.modalPresentationStyle = .pageSheet
    present(nav, animated: true)
  }

  /// A download that could not start, or an IPA this platform cannot install.
  ///
  /// One alert for both: the sentence already names which it is, and two dialogs for
  /// two refusals the user experiences the same way would be noise.
  private func showDownloadAlert(_ message: String) {
    guard presentedViewController == nil else { return }
    let alert = UIAlertController(title: "Kabmo", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .cancel))
    present(alert, animated: true)
  }

  /// A certificate the platform does not trust is a REFUSAL with an explanation.
  ///
  /// `--tls` generates a self-signed certificate, so this is the expected state on
  /// a first connection. Cancelling is what keeps the shell from silently trusting
  /// an unknown issuer; the alert names the workaround instead of leaving a blank
  /// page.
  private func showCertificateAlert(_ detail: String) {
    guard presentedViewController == nil else { return }
    let alert = UIAlertController(
      title: "Certificate not trusted",
      message: "\(detail)\n\nInstall the certificate on this device, or connect over plain http on a trusted network.",
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "Server settings", style: .default) { [weak self] _ in
      self?.openSettings()
    })
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    present(alert, animated: true)
  }

  /// The Home Screen quick action, delivered by the app delegate.
  func handleShortcut() {
    if isViewLoaded && view.window != nil {
      openSettings()
    } else {
      pendingShortcut = true
    }
  }
}
#endif
