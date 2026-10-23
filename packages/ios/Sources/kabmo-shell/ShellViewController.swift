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

  /// This build's version, read from the bundle. One source: `Info.plist`, which
  /// the build script fills from `version.properties`.
  private var version: String {
    (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
  }

  override func viewDidLoad() {
    super.viewDidLoad()
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

    if pendingSettings || pendingShortcut {
      pendingSettings = false
      pendingShortcut = false
      openSettings()
      return
    }

    guard let url = settings.url else { return }
    if url == loadedURL { return }

    // A saved address change is a different origin, so the previous session is
    // dropped. Without this, moving from one Kabmo instance to another on the same
    // host:port leaves a cookie for a user that does not exist there, and the login
    // screen is skipped into a 401 loop.
    if loadedURL != nil {
      clearCookies()
    }
    loadedURL = url
    startLoad(url)
  }

  /// Set when a quick action arrives while the app is already running.
  var pendingShortcut = false

  // MARK: - Web view

  private func makeWebView() -> WKWebView {
    // The UA token has to be in the CONFIGURATION: `applicationNameForUserAgent` is
    // read when the web view is created, and a value set afterwards is ignored with
    // no error — so the token would be missing from the very request that renders
    // the shell.
    let webView = WKWebView(
      frame: .zero,
      configuration: ShellWebView.makeConfiguration(version: version)
    )
    ShellWebView.configure(webView, zoomPercent: settings.zoom)

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
  private func startLoad(_ url: String) {
    guard let target = URL(string: url) else { return }
    applyLoading(.connecting)
    webView.load(URLRequest(url: target))
  }

  /// Retry from the overlay's own button.
  ///
  /// A failed load leaves the web view on WebKit's error page, which is not a
  /// document the console can recover from; reloading the saved address is the only
  /// retry that means anything. `loadedURL` is deliberately NOT cleared — it is what
  /// keeps a return from the settings screen from clearing the cookie jar.
  private func retryLoad() {
    guard let url = settings.url else { return }
    startLoad(url)
  }

  private func applyLoading(_ next: LoadingState) {
    loading = next
    overlay.render(next)
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

  private func clearCookies() {
    let store = WKWebsiteDataStore.default()
    store.httpCookieStore.getAllCookies { cookies in
      for cookie in cookies { store.httpCookieStore.delete(cookie) }
    }
  }

  // MARK: - Settings

  private func openSettings() {
    let screen = SettingsViewController(settings: settings)
    screen.onSaved = { [weak self] in
      guard let self else { return }
      // The saved address may have changed, so the origin test's input has to move
      // with it — otherwise the next navigation to the NEW server would be treated
      // as external and opened in Safari.
      self.navigation.serverURL = self.settings.url
      self.loadedURL = nil
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
