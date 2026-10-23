/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell's application: one window, one bridge, two facts it owns.
 *
 * **This file is `App.swift`, not `main.swift`, and that is a Swift rule rather
 * than a preference.** A file named `main.swift` is compiled as TOP-LEVEL CODE,
 * and `@main` is rejected inside a module that contains any — "error: 'main'
 * attribute cannot be used in a module that contains top-level code". Measured
 * on the release runner (Swift 6.1.2), where it failed the macOS build; a newer
 * local toolchain (6.4) accepts it, which is exactly why this was not caught
 * before the pipeline ran.
 *
 * What it deliberately does NOT do:
 *
 * - **It never sets `KABMO_DATA_DIR`.** The managed server inherits the
 *   environment, so its database stays where `kabmo serve` puts it (`~/.kabmo`)
 *   and `kabmo status` keeps seeing the instance the window is on.
 * - **It does not pass `--tray`.** The server would raise a second icon.
 * - **It never proxies.** Every WebSocket upgrade is origin-checked against the
 *   `Host` header (`lib/http/same-origin.ts`), so a custom scheme in front of the
 *   server answers 403 on the realtime, terminal and dictation sockets. The
 *   webview loads the real `http://host:port` URL.
 */

import AppKit
import WebKit

import KabmoDesktop

@main
struct KabmoDesktopApp {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    // The name macOS shows in the menu bar, the Dock and Force Quit comes from
    // the BUNDLE when the app is launched from one, and from the executable's
    // own name when it is not. `swift run kabmo-desktop` therefore put
    // "kabmo-desktop" in the menu bar, which no user should ever see.
    //
    // There is no `NSApplication.applicationName` to set (checked: the selector
    // does not exist), so the process is renamed — that is the value AppKit
    // reads for a non-bundled launch. Harmless inside the .app, where the plist
    // wins anyway.
    setProcessName("Kabmo")
    let delegate = AppDelegate()
    app.delegate = delegate
    // Held for the process's life: `NSApplication.delegate` is weak.
    withExtendedLifetime(delegate) {
      app.run()
    }
  }
}

/**
 Name the app for a launch that is not from a bundle.

 `NSApplication` has no `applicationName` on this SDK (checked: the selector does
 not exist) and `ProcessInfo.processName` is read-only, so the only thing a
 process can state for itself is the `NSApplicationName` default — which is what
 AppKit consults when there is no `CFBundleName` to read. Inside the `.app` the
 plist wins, so this is a no-op there and the difference is invisible.

 Verified: the raw binary still reports `kabmo-desktop` to `NSRunningApplication`,
 because that value comes from the executable's own file name. Nothing in-process
 can change it, which is why the `.app` — where the executable IS named `Kabmo` —
 is the supported way to run this.
 */
private func setProcessName(_ name: String) {
  UserDefaults.standard.set(name, forKey: "NSApplicationName")
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, ShellCommandHost, WKNavigationDelegate {
  private var window: ShellWindow!
  private var webView: WKWebView!
  private var supervisor = Supervisor()
  private var store: ServerStore!
  private var pendingBootURL: String?
  /// Strong reference to the message handler (the content controller's is weak).
  private var bridgeHandler: BridgeHandler?
  private var splash: SplashView?
  /// What the launch splash is showing. Owned here because the window outlives
  /// every navigation; `SplashView` only draws it.
  ///
  /// It starts CONNECTING, not `done`: the window is on screen before `boot()`
  /// runs, and a splash that began hidden left the first frames as a bare paper
  /// rectangle — the exact blank start the splash exists to cover.
  private var loading = SplashState.connecting
  /// The address the web view has FINISHED on, latched by `didFinish`.
  ///
  /// `webView.url` is the document being loaded, not the one on screen, so it
  /// cannot answer "was this the same page?" — that answer has to be recorded
  /// when a load completes, before the next one starts.
  private var shownURL: String?
  /// The progress observation feeding the bar. `estimatedProgress` is KVO-only:
  /// `WKNavigationDelegate` reports started, finished and failed, and NOTHING in
  /// between — a delegate-only shell draws a bar that jumps from indeterminate to
  /// gone, which is the "did it hang?" state the splash exists to remove.
  private var progressObservation: NSKeyValueObservation?

  /// What the shell reports about itself, once, before the page asks anything.
  ///
  /// The version is READ from the bundle, never written here: `version.properties`
  /// is the one place it is declared, `scripts/build-app.sh` fills
  /// `CFBundleShortVersionString` from it, and a literal in this file was a
  /// second number that drifted — the release pipeline bumped the properties file
  /// to `0.2.0` while the app went on reporting `0.1.0` to the console.
  ///
  /// Empty from a `swift run` binary, which has no bundle; the page reads that as
  /// "this shell cannot say", so no update is offered rather than a bogus one.
  private static var desktopInfo: DesktopInfo {
    DesktopInfo(
      platform: "macos",
      shellVersion: ShellVersion.current(),
      overlayTitlebar: true,
      trafficLightInset: "5rem"
    )
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Before anything reads the list: an install that has been running keeps its
    // servers under the old folder name.
    migrateLegacyStateDir()
    store = ServerStore(
      deps: SystemDeps(supervisor: supervisor),
      load: { readState() },
      save: { writeState($0) }
    )
    buildMenu()
    buildWindow()
    // The window is up on a splash until the first probe answers; this is what
    // moves it to the server the user was last on.
    Task { await boot() }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    // A child server must not outlive the window that started it. A force-quit
    // cannot be caught, which is why the store records the pids it spawned — the
    // next launch adopts exactly those.
    let semaphore = DispatchSemaphore(value: 0)
    Task {
      await supervisor.stopAll()
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 6)
  }

  // ---------------------------------------------------------------- window

  private func buildWindow() {
    let rect = NSRect(x: 0, y: 0, width: 1280, height: 860)
    window = makeWindow(contentRect: rect)
    window.center()

    let configuration = WKWebViewConfiguration()
    let controller = WKUserContentController()
    controller.addUserScript(bootstrapScript(info: Self.desktopInfo))
    // Held: `WKUserContentController` keeps only a WEAK reference to a message
    // handler, so a temporary one is deallocated before the first command and
    // every call from the page then goes nowhere.
    bridgeHandler = BridgeHandler(host: self)
    if let bridgeHandler {
      controller.add(bridgeHandler, name: "kabmo")
    }
    configuration.userContentController = controller
    // The page is a live console: it needs its own cookies per server, and a
    // non-persistent store would drop the login on every relaunch.
    configuration.websiteDataStore = .default()
    configuration.preferences.isElementFullscreenEnabled = true

    webView = WKWebView(frame: rect, configuration: configuration)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    // The page draws the title bar, so it must reach the window's top edge.
    webView.setValue(false, forKey: "drawsBackground")

    // The progress half of the splash. Armed once, on the web view that outlives
    // every navigation — the state machine ignores an estimate after `done` or
    // `failed`, so a late one from the previous document costs nothing.
    progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
      guard let self, let fraction = change.newValue else { return }
      self.applyLoading(self.loading.progressed(fraction: fraction))
    }

    let container = NSView(frame: rect)
    container.autoresizingMask = [.width, .height]
    container.addSubview(webView)
    window.contentView = container

    // The drag probe: one selector, evaluated against the press location.
    window.dragRegionProbe = { [weak self] point in
      self?.pointIsDragRegion(point) ?? false
    }

    let splash = SplashView(frame: rect)
    splash.onRetry = { [weak self] in self?.retryLoad() }
    splash.render(loading)
    container.addSubview(splash)
    self.splash = splash

    window.delegate = self
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  /// Whether a press at `point` (CSS pixels, top-left origin) is a drag handle.
  ///
  /// Synchronous `evaluateJavaScript` is the only way this can answer inside
  /// `mouseDown` — an async round trip returns after AppKit has already decided.
  /// The cost is one blocking call per press in the header, which is the same
  /// work the platform does to hit-test a native toolbar.
  private func pointIsDragRegion(_ point: NSPoint) -> Bool {
    let selector = dragRegionSelector
      .replacingOccurrences(of: "%x", with: String(format: "%.1f", point.x))
      .replacingOccurrences(of: "%y", with: String(format: "%.1f", point.y))
    var result = false
    var finished = false
    webView.evaluateJavaScript(selector) { value, _ in
      result = (value as? Bool) ?? false
      finished = true
    }
    // A run loop turn is what lets the web process answer; without it the call
    // returns before the block runs and every press reads as "not a handle".
    let deadline = Date().addingTimeInterval(0.25)
    while !finished && Date() < deadline {
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
    }
    return result
  }

  // ---------------------------------------------------------------- boot

  private func boot() async {
    // Adopt what a previous run of THIS shell left behind before anything reads
    // the list, so the panel's Stop can reach it.
    for (id, pid) in await store.orphanedPids() {
      await supervisor.adopt(id: id, pid: pid)
    }
    let state = await store.snapshot()
    let url = state.activeUrl
      ?? state.detected.first?.url
      ?? state.entries.first(where: { $0.running })?.url
      ?? "http://127.0.0.1:3000"
    await MainActor.run {
      load(url)
    }
  }

  private func load(_ urlString: String) {
    guard let url = URL(string: urlString) else { return }
    pendingBootURL = urlString
    startLoad(url)
  }

  /// Begin a load with the splash up.
  ///
  /// The state is armed BEFORE `load`, because a cached document can call
  /// `didStartProvisionalNavigation` on the same tick: arming afterwards would let
  /// the first estimate of a real load be ignored as "already finished".
  private func startLoad(_ url: URL) {
    applyLoading(.connecting)
    webView.load(URLRequest(url: url))
  }

  private func applyLoading(_ next: SplashState) {
    loading = next
    splash?.render(next)
  }

  // ---------------------------------------------------------------- navigation

  /// `NSWindowDelegate` is where full-screen transitions arrive; the window
  /// forwards them to its own inset correction.
  func windowDidEnterFullScreen(_ notification: Notification) {
    window.fullScreenStateChanged()
  }

  func windowDidExitFullScreen(_ notification: Notification) {
    window.fullScreenStateChanged()
  }

  /// Where a link goes, and the reason the shell needs to say.
  ///
  /// Without this every link replaced the console: `WKNavigationDelegate` was
  /// wired for the splash and nothing else. That is a trap for the update control
  /// the console draws (a desktop offer links the RELEASE PAGE, since every
  /// desktop artifact is per-architecture) and it was already wrong for the
  /// release notes, the social links and every citation in a chat.
  ///
  /// A same-origin navigation stays; anything else goes to the system browser,
  /// which is what a user expects from a link that leaves the app.
  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let destination = navigationAction.request.url?.absoluteString
    // `webView.url` is the document being SHOWN at this point: the incoming one
    // has not committed yet, which is exactly the "where are we leaving from"
    // this decision needs.
    guard NavigationPolicy.decide(from: webView.url?.absoluteString, to: destination) == .external else {
      decisionHandler(.allow)
      return
    }

    if let destination, let url = URL(string: destination) {
      NSWorkspace.shared.open(url)
    }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    // Only `startLoad` and a RELOAD re-open the splash. A later in-app navigation
    // (the login submit is one) must NOT flash it: the state machine ignores
    // progress once it has finished, so a navigation after the console is up
    // costs nothing — while a FAILED main-frame load still surfaces its reason,
    // which is the blank-window case worth covering.
    //
    // The page's own Reload control is the exception, and it is what this check
    // exists for: `location.reload()` fetches the SAME address again, which from
    // the shell's side is a cold start in miniature — the console is replaced by
    // a blank document while the bundle is re-fetched, and leaving the splash
    // hidden there made the header's button look like it did nothing.
    if SplashState.isDocumentReload(
      started: webView.url?.absoluteString,
      shown: shownURL,
      phase: loading.phase
    ) {
      applyLoading(.connecting)
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // Latched HERE, not read from `webView.url` later: by the time the next
    // `didStartProvisionalNavigation` arrives the view already points at the
    // incoming document, so the comparison would match every navigation.
    shownURL = webView.url?.absoluteString
    // 100% is not a finish: the server's shell is still fetching the client
    // bundle when the estimate reaches 1.0, so only this call closes the splash.
    // The view stays MOUNTED and hidden — `render(.done)` is what hides it — so a
    // later Reload shows it again with no second instance.
    applyLoading(loading.finished())
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failSplash(error)
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    failSplash(error)
  }

  /// A failed main-frame load keeps the splash with the reason.
  ///
  /// A cancelled load is not a failure: a redirect or a `location.replace`
  /// reports `NSURLErrorCancelled`, and surfacing that would cover a page that is
  /// loading fine.
  private func failSplash(_ error: Error) {
    if (error as NSError).code == NSURLErrorCancelled { return }
    let failure = SplashState.failure(for: error)
    applyLoading(loading.failedBecause(failure))
    // WebKit's own sentence is appended under ours: it names the address and the
    // system error, which is the detail a reader needs when our wording is the
    // generic case.
    splash?.setDetail(error.localizedDescription)
  }

  /// Retry from the splash's own button.
  ///
  /// A failed load leaves the web view on WebKit's error page, which is not a
  /// document the console can recover from; reloading the saved address is the
  /// only retry that means anything.
  private func retryLoad() {
    guard let urlString = pendingBootURL, let url = URL(string: urlString) else {
      webView.reload()
      return
    }
    startLoad(url)
  }

  // ---------------------------------------------------------------- commands

  func handle(method: String, params: [String: Any]) async throws -> Any? {
    switch method {
    case "desktop_info":
      return [
        "platform": Self.desktopInfo.platform,
        "shellVersion": Self.desktopInfo.shellVersion,
        "overlayTitlebar": Self.desktopInfo.overlayTitlebar,
        "trafficLightInset": Self.desktopInfo.trafficLightInset,
      ]

    case "servers_state":
      return encode(await store.snapshot())

    case "servers_add":
      try await store.addRemote(
        label: params["label"] as? String ?? "",
        url: params["url"] as? String ?? ""
      )
      return encode(await store.snapshot())

    case "servers_remove":
      let id = params["id"] as? String ?? ""
      await store.stop(id)
      try await store.remove(id)
      return encode(await store.snapshot())

    case "servers_activate":
      let id = params["id"] as? String ?? ""
      let url = try await store.activate(id)
      await MainActor.run { load(url) }
      return encode(await store.snapshot())

    case "servers_start":
      let port = (params["port"] as? NSNumber)?.intValue ?? freePort()
      let label = params["label"] as? String
      let started = try await store.start(port: port, label: label)
      await MainActor.run { load(started.url) }
      return encode(await store.snapshot())

    case "servers_stop":
      await store.stop(params["id"] as? String ?? "")
      return encode(await store.snapshot())

    default:
      throw ServerError("Unknown shell command: \(method)")
    }
  }

  func navigate(to url: String) {
    load(url)
  }

  private func encode(_ state: ServersState) -> Any? {
    guard let data = try? JSONEncoder().encode(state),
          let object = try? JSONSerialization.jsonObject(with: data)
    else { return nil }
    return object
  }

  // ---------------------------------------------------------------- menu

  /**
   The menu bar a macOS app is expected to have.

   Four menus, because each one is where a user looks for something specific and a
   missing menu is not "minimal", it is broken: ⌘W/⌘M/⌃⌘F live in File and Window,
   the window list lives in Window, and the browser-shaped actions (Reload, zoom,
   inspector) live in View. The actions are the WINDOW's own selectors so AppKit
   routes them to whichever window is key — a target of `self` would act on this
   delegate instead.
   */
  private func buildMenu() {
    let mainMenu = NSMenu()

    // App
    let appItem = NSMenuItem()
    mainMenu.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "About Kabmo", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Settings…", action: #selector(openConsoleSettings), keyEquivalent: ",")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide Kabmo", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    appMenu.addItem(hideOthers)
    appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Quit Kabmo", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    // File — the window's own close, so ⌘W reaches the key window.
    let fileItem = NSMenuItem()
    mainMenu.addItem(fileItem)
    let fileMenu = NSMenu(title: "File")
    fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    fileItem.submenu = fileMenu

    // View — the browser-shaped actions.
    let viewItem = NSMenuItem()
    mainMenu.addItem(viewItem)
    let viewMenu = NSMenu(title: "View")
    viewMenu.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
    viewMenu.addItem(withTitle: "Toggle Developer Tools", action: #selector(toggleDevTools), keyEquivalent: "i")
    viewMenu.addItem(.separator())
    viewMenu.addItem(withTitle: "Actual Size", action: #selector(zoomActualSize), keyEquivalent: "0")
    viewMenu.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
    viewMenu.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
    viewItem.submenu = viewMenu

    // Window — minimise, zoom, full screen, and the window list. AppKit fills the
    // list itself because this menu is assigned as `NSApp.windowsMenu`.
    let windowItem = NSMenuItem()
    mainMenu.addItem(windowItem)
    let windowMenu = NSMenu(title: "Window")
    windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    let fullScreen = NSMenuItem(title: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    fullScreen.keyEquivalentModifierMask = [.control, .command]
    windowMenu.addItem(fullScreen)
    windowMenu.addItem(.separator())
    windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
    windowItem.submenu = windowMenu
    NSApp.windowsMenu = windowMenu

    NSApp.mainMenu = mainMenu
  }

  @objc private func openConsoleSettings() {
    // The console's own settings live in the page; there is no native panel.
    let state = webView.url?.absoluteString ?? "http://127.0.0.1:3000"
    if var components = URLComponents(string: state) {
      components.queryItems = (components.queryItems ?? []) + [URLQueryItem(name: "settings", value: "1")]
      if let url = components.url { webView.load(URLRequest(url: url)) }
    }
  }

  @objc private func zoomActualSize() { webView.pageZoom = 1 }
  @objc private func zoomIn() { webView.pageZoom = min(webView.pageZoom * 1.1, 3) }
  @objc private func zoomOut() { webView.pageZoom = max(webView.pageZoom / 1.1, 0.5) }

  @objc private func reloadPage() {
    webView.reload()
  }

  /// `isInspectable` is the switch that turns on the Web Inspector for a
  /// WKWebView on macOS 13.3+; without it ⌘⌥I does nothing and a rendering bug
  /// in the page cannot be looked at from inside the shell.
  @objc private func toggleDevTools() {
    if #available(macOS 13.3, *) {
      webView.isInspectable.toggle()
    }
    webView.reload()
  }
}

/// The injected side effects: the real probe, the real records, the real spawn.
struct SystemDeps: ServerDeps {
  let supervisor: Supervisor

  func probe(_ url: String) async -> Health? {
    await probeHealth(url)
  }

  func detect() async -> [ServerEntry] {
    await detectLocalServers()
  }

  func start(port: Int) async throws -> (id: String, url: String, pid: Int32?) {
    do {
      let managed = try await supervisor.start(port: port)
      return (managed.id, managed.url, managed.pid)
    } catch let already as AlreadyServed {
      // Something else serves the port. Reported with NO pid, which is what keeps
      // the panel from offering Stop for a process this shell did not spawn.
      return (already.id, already.url, nil)
    }
  }

  func stop(_ id: String) async {
    await supervisor.stop(id)
  }
}
