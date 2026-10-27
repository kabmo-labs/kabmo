/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The drag contract, driven through the REAL `ShellWindow`.
 *
 * Not a copy of it. The class lives in the library target precisely so this file
 * can press it: the two previous attempts both had a "test" that restated the
 * rule, and both shipped a window that could not be moved. Three bugs were found
 * by writing this the hard way, and each is now a case:
 *
 * 1. **`mouseDown` never runs for a press inside a WKWebView** — measured, only
 *    `sendEvent` fires, so an override there was dead code. The window could not
 *    be dragged at all.
 * 2. **`convert(_:from:)` already answers in the webview's flipped geometry** —
 *    subtracting the height inverted every probe, so the header never matched.
 * 3. **`NSEvent.mouseLocation` is the hardware pointer, not the event** — a drag
 *    driven by posted events left the window exactly where it was.
 *
 * The window is real, the webview is real, and the page is real markup; the only
 * thing simulated is the pointer, which AppKit does not let a test move into
 * another process (`AXIsProcessTrusted` is false on this machine).
 */

import AppKit
import WebKit

import KabmoDesktop

/// Records what the menu's Settings row sends, so the case can assert the event
/// rather than trust the script's own source.
///
/// A page-level listener is exactly what the console has (`useKabmoEvent`), so a
/// row that dispatched the wrong name — or reloaded instead of dispatching — is
/// visible here as an empty recorder.
let settingsRecorderScript = """
<script>
  window.__settingsEvents = [];
  window.addEventListener('omp:open-settings', (e) => {
    window.__settingsEvents.push(e.detail || {});
  });
</script>
"""

/// A page with the shape the shell's header has: a marked strip, a control
/// inside it, and body content below.
///
/// The `#composer` field is what the editing cases drive, and it is pinned to the
/// BOTTOM-LEFT corner on purpose: the press cases below address a body point at
/// `height - 200`, so a field anywhere in the middle would make "a press on the
/// body is NOT a drag" also be a press on a text field — a different case wearing
/// the same name.
let page = """
<!doctype html><html><body style="margin:0;font:14px system-ui">
<div data-drag-region style="height:40px;background:#e8e8e8;display:flex;align-items:center;padding-left:12px">
  <span>header</span>
  <button id="btn" style="margin-left:200px">a control</button>
</div>
<div style="height:400px;background:#fafafa">body</div>
<textarea id="composer" style="position:absolute;left:8px;bottom:8px;width:220px;height:40px"></textarea>
""" + dropRecorderScript + settingsRecorderScript + """
</body></html>
"""

/// A point on the header strip that belongs to the page: past the strip macOS
/// reserves for its traffic lights (`trafficLightInset`), which the buttons own.
let blankBarX: CGFloat = trafficLightInset + 24

var failures = 0
func check(_ label: String, _ condition: Bool) {
  if condition { print("  ok   \(label)") } else { print("  FAIL \(label)"); failures += 1 }
}

/// A `ShellWindow` that records what it decided, so a press can be classified
/// without a human watching.
final class RecordingWindow: ShellWindow {
  var claimed = false
  var passedThrough = false

  override func sendEvent(_ event: NSEvent) {
    if event.type == .leftMouseDown { claimed = false; passedThrough = false }
    super.sendEvent(event)
    // `super` returns early for a press the window took (a drag or a
    // double-click gesture), and then `sendEvent` never reaches the view — which
    // is what "passed through" is measuring.
    if event.type == .leftMouseDown, !claimed { passedThrough = true }
  }
}

final class Runner: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  var window: RecordingWindow!
  var webView: DropWebView!
  var ready = false
  /// Where the suite is, for the watchdog's message. "The suite stopped" is
  /// useless without it.
  var phase = "the page was still loading"
  /// Set only by the quit case, which needs the app's OWN terminate reply path.
  var quitProbe: TerminateCoordinator?

  /**
   The app's quit path, installed for the one case that drives it.

   `reply: false` is what keeps the suite alive: the case asserts that the reply
   REACHED AppKit — the half that broke — not that the process dies. Every other
   case runs with no probe, and then this answers `now` so the suite can never be
   left refusing a quit of its own.
   */
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let quitProbe else { return .terminateNow }
    return quitProbe.request(sender, reply: false)
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // The menu the app installs, built from the same table — a suite that
    // declared its own chords would pass while the shipped menu was missing a
    // row. It is set BEFORE the window, the order `AppDelegate` uses.
    installEditMenu()

    let rect = NSRect(x: 200, y: 200, width: 700, height: 480)
    window = RecordingWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false
    )
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true

    webView = DropWebView(frame: rect)
    webView.navigationDelegate = self
    window.contentView = webView

    // The probe the app installs, inlined: it evaluates the shell's own selector
    // against the page, synchronously, because `sendEvent` cannot await.
    window.dragRegionProbe = { [weak self] point in
      guard let self, self.ready else { return false }
      var answer = false
      var done = false
      let js = dragRegionSelector
        .replacingOccurrences(of: "%x", with: String(format: "%.1f", point.x))
        .replacingOccurrences(of: "%y", with: String(format: "%.1f", point.y))
      self.webView.evaluateJavaScript(js) { value, _ in
        answer = (value as? Bool) ?? false
        done = true
      }
      let deadline = Date().addingTimeInterval(0.5)
      while !done && Date() < deadline {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
      }
      return answer
    }

    // `claimed` is set by the window itself when the press became a drag; this
    // hook only observes it.
    window.onPress = { [weak self] claimed in
      self?.window.claimed = claimed
      self?.window.passedThrough = !claimed
    }

    webView.loadHTMLString(page, baseURL: nil)
    window.makeKeyAndOrderFront(nil)
    // The editing cases below need a KEY window: AppKit's key-equivalent pass
    // runs on the key window's responder chain, and an accessory app that was
    // never activated leaves `isKeyWindow` false — measured, ⌘V then does nothing
    // even with the menu installed, which would look exactly like the bug this
    // suite exists to catch. The press cases do not depend on it either way
    // (they post to `window.sendEvent` directly), so activating costs them
    // nothing.
    NSApp.activate(ignoringOtherApps: true)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
      self.phase = "running the cases"
      self.runCases()
    }
  }

  /**
   A page that never loads must FAIL the suite, not park it forever.

   `runCases` is reached only from `didFinish`, so a load that neither finishes
   nor errors leaves the process inside `app.run()` for as long as the job
   allows — and `publish-macos.yml` declares no `timeout-minutes`, so that is
   GitHub's six-hour default. Measured on this repository's release run: both
   macOS legs sat in this step for over an hour with every other job finished.
   */
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fail("the page failed to load: \(error.localizedDescription)")
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    fail("the page failed to load provisionally: \(error.localizedDescription)")
  }

  func fail(_ reason: String) {
    print("  FAIL \(reason)")
    print("\nwindow suite could not run")
    failures += 1
    exit(1)
  }

  func press(at point: NSPoint) {
    guard let event = NSEvent.mouseEvent(
      with: .leftMouseDown, location: point, modifierFlags: [],
      timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil,
      eventNumber: 1, clickCount: 1, pressure: 1
    ) else { return }
    window.sendEvent(event)
  }

  /**
   Evaluate one expression against the page, synchronously.

   `evaluateJavaScript` is asynchronous and `sendEvent` cannot await, so the same
   run-loop turn the drag probe uses is what makes this usable from a case that
   must read what the page recorded right after a drop.
   */
  func evaluateSync(_ script: String) -> Any? {
    var answer: Any?
    var done = false
    webView.evaluateJavaScript(script) { value, _ in
      answer = value
      done = true
    }
    let deadline = Date().addingTimeInterval(2)
    while !done && Date() < deadline {
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
    }
    return answer
  }

  /// Let the run loop run for `seconds`, so an animated window action can land.
  func pump(_ seconds: TimeInterval) {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
  }

  /**
   The editing chords, driven into the real web view.

   **This is the regression net for the reported bug**: the shell built App,
   File, View and Window and no Edit menu, and a `WKWebView` is handed ⌘C/⌘V/⌘X/
   ⌘Z/⌘A only through a menu item that declares the key equivalent. Measured A/B
   on this SDK: with no Edit menu the composer ignored ⌘V entirely (`value` came
   back unchanged, the page's own `paste` event never fired) while every other
   case in this suite still passed — a silent failure, which is why it shipped.

   The chords are posted through `NSApp.sendEvent`, not `window.sendEvent`: the
   menu bar's key-equivalent pass happens in `NSApplication`'s own dispatch, and
   a chord sent straight to the window never reaches it. Measured — both paths
   with the menu installed and a key window give the same answer, but only
   `NSApp` is the path a keystroke really takes.

   **The undo case runs FIRST, and that ordering is load-bearing.** WebKit keeps
   ONE undo stack per document, and a programmatic `el.value = …` leaves that
   stack alone while every chord-driven edit adds to it. Run after the others,
   ⌘Z undid the CUT from a previous case instead of the typing in front of it
   (measured: the field came back as `cut-me`), which reads as "undo is broken"
   when the case is what was wrong. Starting on the pristine field means the
   first undoable step really is the typing this case performed.

   The pasteboard is written by the test, so no case depends on what the machine
   had copied.
   */
  func runEditingCases() {
    let field = "document.getElementById('composer')"
    func value() -> String { (eval("\(field).value") as? String) ?? "<nil>" }
    func selection() -> String {
      (eval("\(field).selectionStart + '-' + \(field).selectionEnd") as? String) ?? "<nil>"
    }
    func reset(_ text: String = "", _ caret: Int? = nil) {
      let target = caret.map { "\($0)" } ?? "el.value.length"
      _ = eval("var el = \(field); el.value = \(text.debugDescription); el.focus(); el.setSelectionRange(\(target), \(target)); true")
      pump(0.2)
    }

    /**
     Wait until the PAGE shows `expected`, or the deadline passes.

     `sendAction` answers only that a responder ACCEPTED the command; WebKit runs
     it in the web process, several run-loop turns later. Reading `value()` on
     the same turn therefore compares against the document BEFORE the edit — the
     assertion races the web process rather than testing it. Measured on the
     x64 release runner: `⌘⇧Z redoes it` failed there while passing on arm64 and
     in five consecutive local runs, and `sendAction` had returned true in every
     one of them.
     */
    func awaitValue(_ expected: String, timeout: TimeInterval = 2) -> Bool {
      let deadline = Date().addingTimeInterval(timeout)
      while Date() < deadline {
        if value() == expected { return true }
        pump(0.05)
      }
      return value() == expected
    }

    func awaitSelection(_ expected: String, timeout: TimeInterval = 2) -> Bool {
      let deadline = Date().addingTimeInterval(timeout)
      while Date() < deadline {
        if selection() == expected { return true }
        pump(0.05)
      }
      return selection() == expected
    }

    func awaitPasteboard(_ expected: String, timeout: TimeInterval = 2) -> Bool {
      let deadline = Date().addingTimeInterval(timeout)
      while Date() < deadline {
        if NSPasteboard.general.string(forType: .string) == expected { return true }
        pump(0.05)
      }
      return NSPasteboard.general.string(forType: .string) == expected
    }

    // TWO facts, asserted separately, because the flaky way to prove them was one
    // fact that depended on the app being ACTIVE.
    //
    // `NSApp.sendEvent` routes a key equivalent through the KEY WINDOW, and a
    // non-bundled test executable cannot reliably become the active app: measured
    // over eight runs, `NSApp.activate(ignoringOtherApps: true)` left
    // `isActive == false` in most of them (and in some runs `false` still passed,
    // which is worse than a plain failure). That made eight cases flap without
    // saying anything about the shell.
    //
    // What the shell actually owns is (1) the menu bar carrying an Edit menu whose
    // rows declare these chords and (2) each declared selector performing its verb
    // on the web view. Both are deterministic, and together they cover the
    // regression this suite exists for: the shell built App, File, View and Window
    // and NO Edit menu, so a `WKWebView` was handed none of the chords.

    // (1) The app's own menu bar carries the Edit rows.
    //
    // `NSApp.mainMenu` — not a freshly built menu — because the bug this guards
    // is the menu being ABSENT from the app, not the builder being wrong. A check
    // on `buildEditMenu()` alone passes with the menu never installed, which is
    // exactly how the shell shipped without one.
    let installed = NSApp.mainMenu?.items.first?.submenu
    let shipped = installed?.items ?? []
    check("the app's menu bar is installed", NSApp.mainMenu != nil)
    check("the app's first menu carries the Edit rows",
          shipped.contains { $0.title == "Paste" })
    // `>=`, not `==`: AppKit appends its own rows to any menu titled Edit
    // (AutoFill, Start Dictation, Emoji & Symbols — measured: 17 rows for our 7).
    // The contract is that OURS are all there, in order, not that nothing else is.
    let ours = shipped.prefix(editMenuItems.count).map(\.title)
    check("the app's Edit menu starts with the shipped rows",
          ours == editMenuItems.map(\.title))
    for row in editMenuItems {
      let item = shipped.first { $0.title == row.title }
      check("Edit › \(row.title) is installed", item != nil)
      check("Edit › \(row.title) declares \(row.key) with the shipped modifiers",
            item?.keyEquivalent == row.key && item?.keyEquivalentModifierMask == row.modifiers)
      check("Edit › \(row.title) routes to \(row.action)",
            item?.action != nil && item?.action == row.action)
      // The gate the menu system asks before enabling a row. The window used to
      // answer `false` for every action it did not name itself, which made the
      // chords dead with the menu built and the rows declared.
      let probe = NSMenuItem(title: row.title, action: row.action, keyEquivalent: row.key)
      check("the window enables Edit › \(row.title)", window.validateUserInterfaceItem(probe))
    }

    // (2) Each declared selector performs its verb.
    //
    // The TARGET is the responder chain, not the web view, and that is a fact
    // about the platform rather than a shortcut: `undo:`/`redo:` are
    // `NSResponder`'s informal protocol and a `WKWebView` does NOT implement them
    // — sending one directly raises `unrecognized selector` (measured). They
    // resolve against the WINDOW, which is why `editMenuHandles` has to allow
    // them; the other five resolve against the web view.
    //
    // The target is named rather than resolved through `NSApp.target(forAction:)`,
    // because that lookup walks the KEY window's responder chain and a non-bundled
    // test executable cannot reliably become the active app — measured: the same
    // call answered a target in 6 runs of 8 and nil in the other 2. Naming the
    // responder each verb is documented to reach is both deterministic and the
    // exact rule `editMenuHandles` encodes.
    func perform(_ selector: Selector) -> Bool {
      let target: AnyObject = (selector == undoAction || selector == redoAction) ? window : webView
      return NSApp.sendAction(selector, to: target, from: nil)
    }

    // ⌘Z / ⌘⇧Z — the page's OWN undo stack, driven the way the menu does it.
    //
    // A `WKWebView` has no `undo:`/`redo:` (measured: sending either directly
    // raises `unrecognized selector`), so the chord reaches the window and the
    // window forwards it to the web view's own history. That forwarding is what
    // these two assert: type through the real key path, then undo and redo
    // through the window's own `undo:`.
    reset()
    chord("h", [], 4)
    chord("i", [], 34)
    check("typing reaches the field", awaitValue("hi"))
    let undone = NSApp.sendAction(undoAction, to: window, from: nil)
    check("⌘Z undoes the typing", undone && awaitValue(""))
    let redone = NSApp.sendAction(redoAction, to: window, from: nil)
    check("⌘⇧Z redoes it", redone && awaitValue("hi"))

    // ⌘V — the reported failure. It REPLACES the selection, which is the harder
    // proof: a dead verb leaves the field untouched rather than looking like a
    // paste that happened to match.
    reset("hi", 0)
    _ = eval("document.getElementById('composer').setSelectionRange(0, 2); true")
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString("paste-proof", forType: .string)
    check("⌘A selects the field's whole value", perform(#selector(NSText.selectAll(_:))) && awaitSelection("0-2"))
    check("⌘V pastes into the page's field", perform(#selector(NSText.paste(_:))) && awaitValue("paste-proof"))

    // ⌘C — with the pasteboard EMPTIED first, so a clipboard that already held the
    // right text cannot make this pass with the verb dead.
    check("⌘A selects the pasted value", perform(#selector(NSText.selectAll(_:))) && awaitSelection("0-11"))
    NSPasteboard.general.clearContents()
    let copied = perform(#selector(NSText.copy(_:)))
    // The write to the pasteboard is ASYNCHRONOUS — the web process answers a
    // turn later — so reading it on the same turn always sees an empty board.
    check("⌘C copies the selection", copied && awaitPasteboard("paste-proof"))

    // ⌘X — a fresh value, so "the field is empty" cannot be the starting state
    // rather than the cut's doing.
    reset("cut-me")
    check("⌘A selects the fresh value", perform(#selector(NSText.selectAll(_:))))
    check("⌘X cuts the selection out", perform(#selector(NSText.cut(_:))) && awaitValue(""))
    check("⌘X leaves the cut text on the pasteboard", awaitPasteboard("cut-me"))

    reset()
  }

  /// A chord, dispatched the way a keystroke is: through the application.
  ///
  /// Used ONLY for TYPING here. A key equivalent is deliberately not driven this
  /// way: `NSApp.sendEvent` routes it through the KEY WINDOW, and a non-bundled
  /// test executable cannot reliably become the active app — measured over eight
  /// runs, `NSApp.activate(ignoringOtherApps: true)` left `isActive == false` in
  /// most of them, which made the eight editing cases flap without saying
  /// anything about the shell. The menu contract is asserted instead: the rows
  /// are installed, each declares its chord, and each selector performs its verb
  /// on the responder the platform routes it to.
  func chord(_ characters: String, _ modifiers: NSEvent.ModifierFlags, _ keyCode: UInt16) {
    guard let event = NSEvent.keyEvent(
      with: .keyDown, location: .zero, modifierFlags: modifiers,
      timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil,
      characters: characters, charactersIgnoringModifiers: characters.lowercased(),
      isARepeat: false, keyCode: keyCode
    ) else { return }
    NSApp.sendEvent(event)
  }

  /// `evaluateJavaScript`, synchronously — the suite is a plain executable, so a
  /// callback needs a pumped run loop to land.
  func eval(_ script: String) -> Any? {
    var answer: Any?
    var done = false
    webView.evaluateJavaScript(script) { value, _ in
      answer = value
      done = true
    }
    let deadline = Date().addingTimeInterval(1)
    while !done && Date() < deadline {
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
    }
    return answer
  }

  /// The shipped Edit menu, from the shipped builder.
  func installEditMenu() {
    let top = NSMenuItem()
    let mainMenu = NSMenu()
    mainMenu.addItem(top)
    top.submenu = buildEditMenu()
    NSApp.mainMenu = mainMenu
  }

  func runCases() {
    ready = true
    let height = window.contentView!.bounds.height

    // A blank stretch of the header strip (top 40px, so near `height - 20` in
    // window coordinates, which are bottom-left) — to the RIGHT of the traffic
    // lights, because the strip behind them belongs to the buttons.
    press(at: NSPoint(x: blankBarX, y: height - 20))
    check("a press on blank header is claimed as a drag", window.claimed)
    check("...and is not passed to the page", !window.passedThrough)

    // A control inside the header must stay a control.
    press(at: NSPoint(x: 280, y: height - 20))
    check("a press on a header control is NOT a drag", !window.claimed)
    check("...and reaches the page", window.passedThrough)

    // The page body must never move the window.
    press(at: NSPoint(x: 300, y: height - 200))
    check("a press on the body is NOT a drag", !window.claimed)
    check("...and reaches the page", window.passedThrough)

    proveWindowMoves()
    runResizeBandCases()
    runTrafficLightCases()
    runShortcutCases()
    runDoubleClickCases()
    runMenuCases()
    runSettingsMenuCases()
    runEditingCases()
    proveClickCloses()
    runSplashCases()
    runSplashFillCases()
    dropPathCases(view: webView, check: check, pump: pump, evaluate: evaluateSync)
    runQuitCases()
    finish()
  }

  /**
   Quit actually completes.

   **The regression net for the reported bug.** `applicationShouldTerminate`
   returns `.terminateLater` while the child servers stop, and the reply that ends
   that wait was sent with `await MainActor.run { … }` — which NEVER runs, because
   `-[NSApplication _shouldTerminate]` waits inside a nested event loop that
   services the run loop's own blocks but not the main dispatch queue, and the
   main-actor executor IS the main dispatch queue. Measured on macOS 27 against a
   real quit: the app kept its window, ignored every later Quit and had to be
   killed from Activity Monitor.

   This case drives the real thing: `NSApp.terminate` with the app's own
   coordinator answering `.terminateLater`, so the reply is delivered by the code
   the app ships. The watchdog is the assertion for the broken shape — a reply
   that never lands leaves `NSApp.terminate` inside that nested loop forever, so
   the case would hang the suite instead of reporting.

   `reply: false` cancels the quit, which is what keeps the suite running; the
   second request then asserts the anti-wedge rule, because the old answer
   (`.terminateCancel`) could not clear the pending flag and made one impatient
   double press permanent.
   */
  func runQuitCases() {
    print("\nthe terminate reply reaches AppKit")
    let coordinator = TerminateCoordinator(supervisor: Supervisor())
    quitProbe = coordinator

    DispatchQueue.global().asyncAfter(deadline: .now() + 8) {
      print("  FAIL the terminate reply never reached AppKit — Quit would hang (this is the shipped bug)")
      exit(3)
    }

    // Blocks inside AppKit's own `_shouldTerminate` loop until the reply lands.
    NSApp.terminate(nil)
    check("a deferred quit is answered, so the app can close", coordinator.isPending)
    check("a second Quit is answered with 'now' instead of a cancel that wedges the app",
          coordinator.request(NSApp, reply: false) == .terminateNow)
    quitProbe = nil
  }

  /**
   The frame's own RESIZE BAND is not the page's drag region.

   `fullSizeContentView` puts the page under the title bar, so the page marks its
   whole top 40px `[data-drag-region]` — including the strip along the top edge
   and around both top corners that `NSThemeFrame` reserves for dragging the
   window's SIZE. The shipped window asked the page first, so every press there
   became a window MOVE: measured through the real `ShellWindow`, a press at
   (1, H-1), (6, H-6), (W-1, H-1) and (W/2, H-1) all reported "the page says drag
   handle" and started a move, which is why the reported symptom was that the
   DIAGONAL resize did nothing while the plain edges still worked (the page marks
   nothing along the bottom, left or right edge).

   The band's thickness is AppKit's, not ours — measured on macOS 27 as 3px along
   the top edge, 4px along the bottom and the sides, and 8px into the top-left
   corner because the close button's own margin is reserved there. It is
   therefore MEASURED here rather than hard-coded: a fixed probe point passes on
   one macOS and lands in the page on the next.

   As in `runTrafficLightCases`, no press is DELIVERED at these points: a
   `leftMouseDown` on the frame's resize band enters AppKit's own resize-tracking
   loop, which pulls the queue for a mouse-up a synthetic press never posts, and
   the suite hangs. What is asserted is the predicate `sendEvent` consults.
   */
  func runResizeBandCases() {
    print("\nthe frame's resize band")
    let W = window.contentView!.bounds.width
    let H = window.contentView!.bounds.height

    // Top-right: the band, then the page's header again — both directions, or
    // "fix" that refused every press in the top strip would pass.
    func topRight(_ d: CGFloat) -> NSPoint { NSPoint(x: W - d, y: H - d) }
    check("the top-right corner is the frame's resize band", window.frameOwnsPress(at: topRight(1)))
    check("...so it is NOT claimed as a window drag", !window.claimsBarPress(at: topRight(1)))
    var d: CGFloat = 1
    while d < 40, window.frameOwnsPress(at: topRight(d)) { d += 1 }
    check("the top-right band ends within 40px", d < 40)
    check("past the top-right band the header is a drag again", window.claimsBarPress(at: topRight(d)))

    // The top edge between the corners, and its inner side.
    func topEdge(_ dy: CGFloat) -> NSPoint { NSPoint(x: W / 2, y: H - dy) }
    check("the top edge is the frame's resize band", window.frameOwnsPress(at: topEdge(1)))
    check("...so it is NOT claimed as a window drag", !window.claimsBarPress(at: topEdge(1)))
    var dy: CGFloat = 1
    while dy < 40, window.frameOwnsPress(at: topEdge(dy)) { dy += 1 }
    check("the top-edge band ends within 40px", dy < 40)
    check("past the top-edge band the header is a drag again", window.claimsBarPress(at: topEdge(dy)))

    // Top-left: the band is the CLOSE BUTTON's margin here, so the inner side is
    // asserted only as "not the frame" — the point just past it belongs to the
    // button, not to the page's header, and `hitsStandardButton` already owns
    // that case.
    func topLeft(_ d: CGFloat) -> NSPoint { NSPoint(x: d, y: H - d) }
    check("the top-left corner is the frame's resize band", window.frameOwnsPress(at: topLeft(1)))
    check("...so it is NOT claimed as a window drag", !window.claimsBarPress(at: topLeft(1)))

    // The three edges the page does not mark. They resized before this change
    // and must keep doing so: the fix must not claim the frame's band anywhere.
    let edges: [(String, NSPoint)] = [
      ("bottom", NSPoint(x: W / 2, y: 1)),
      ("left", NSPoint(x: 1, y: H / 2)),
      ("right", NSPoint(x: W - 1, y: H / 2)),
    ]
    for (label, point) in edges {
      check("the \(label) edge is the frame's resize band", window.frameOwnsPress(at: point))
      check("...and is not a window drag", !window.claimsBarPress(at: point))
    }
  }

  /**
   The system's traffic lights are claimed by the SYSTEM before the page is asked.

   The page marks its whole header `[data-drag-region]` and reserves its leftmost
   76px for these buttons, so `elementFromPoint` at a traffic light answers "a
   drag handle" — the press was claimed by the window and the button never saw
   it. Close, minimise and zoom were all dead in the shipped app while the same
   strip still moved the window, which is exactly the shape of a hit test that
   asks the page before it asks the system.

   **A press is deliberately NOT delivered into one of these buttons.** A real
   `NSWindowButton` answers a bare `leftMouseDown` by entering AppKit's own
   mouse-tracking loop, which PULLS from the event queue waiting for a mouse-up
   that a lone press never posts — the case that proved the fix therefore HUNG
   the suite instead. Measured on both macOS release legs: the run printed the
   three checks below and then sat there until the 120 s watchdog killed it, on
   arm64 and x64 alike, while a local run passed because the window was never
   key and AppKit never entered the loop. That is a harness trap, not a shell
   behaviour, so what is asserted here is the predicate `sendEvent` itself
   consults — a standard button wins, and the strip beside the lights is still
   the bar. `proveClickCloses` proves the button then does its job.
   */
  func runTrafficLightCases() {
    let height = window.contentView!.bounds.height
    guard let close = window.standardWindowButton(.closeButton),
          let zoom = window.standardWindowButton(.zoomButton) else {
      check("the window has standard buttons", false)
      return
    }
    for (label, button) in [("close", close), ("zoom", zoom)] {
      let rect = button.convert(button.bounds, to: nil)
      check("\(label) is not hidden", !button.isHidden)
      check("the \(label) button's frame is a real box", rect.width > 0 && rect.height > 0)
      let centre = NSPoint(x: rect.midX, y: rect.midY)
      check("the \(label) button's centre reads as a standard button",
            window.hitsStandardButton(at: centre))
      // The page DOES mark this point as the bar — which is why the system's own
      // check has to run first. `claimsBarPress` is the ordering itself, so this
      // asserts the decision `sendEvent` makes rather than restating its inputs:
      // without the system check the answer would be `true` and the button would
      // never see the press, which is the bug this pins.
      check("the page marks the \(label) button's point as the bar",
            window.debugIsOnBar(centre))
      check("a press on \(label) is NOT claimed as the bar", !window.claimsBarPress(at: centre))
    }
    // The gap to the RIGHT of the lights is still the bar: the fix must not
    // turn the reserved strip into dead window.
    let gap = NSPoint(x: trafficLightInset - 8, y: height - 20)
    check("the gap after the lights is not a standard button",
          !window.hitsStandardButton(at: gap))
    window.claimed = false
    window.passedThrough = false
    press(at: gap)
    check("a press in the gap after the lights is still a drag", window.claimed)
  }

  /**
   The window's standard actions, which a page-drawn bar has to provide itself.

   A `titled` window answers ⌘W/⌘M/⌃⌘F through AppKit's own routing; this one is
   `fullSizeContentView` with the title hidden, and the shortcuts did nothing
   until the window declared it handles them. `validateUserInterfaceItem` is what
   the menu system asks before enabling an item, so it is also the gate that
   keeps the menu live.
   */
  func runShortcutCases() {
    let actions: [(String, Selector)] = [
      ("close", #selector(NSWindow.performClose(_:))),
      ("minimise", #selector(NSWindow.performMiniaturize(_:))),
      ("zoom", #selector(NSWindow.performZoom(_:))),
      ("full screen", #selector(NSWindow.toggleFullScreen(_:))),
    ]
    for (label, action) in actions {
      let item = NSMenuItem(title: label, action: action, keyEquivalent: "")
      check("the window handles \(label)", window.validateUserInterfaceItem(item))
    }
    // And it must not claim an action it cannot perform.
    let unrelated = NSMenuItem(title: "x", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    check("an unrelated action is not claimed", !window.validateUserInterfaceItem(unrelated))
  }

  /**
   Double-click obeys the SYSTEM preference, not a hard-coded behaviour.

   macOS exposes it as `AppleActionOnDoubleClick` (`Maximize` by default,
   `Minimize`, `None`) and a native title bar obeys it. Measured on this machine
   the key is unset, so the default branch is what runs — and a user who set
   "minimise" must get a minimised window, not a zoomed one.
   */
  func runDoubleClickCases() {
    check("the default preference is maximize", DoubleClickAction.fromPreference(nil) == .maximize)
    check("'Minimize' is read case-insensitively", DoubleClickAction.fromPreference("minimize") == .minimize)
    check("'None' disables the gesture", DoubleClickAction.fromPreference("None") == .none)
    check("an unknown value falls back to the default",
          DoubleClickAction.fromPreference("sideways") == .maximize)

    // A double-click on the bar with the preference set to None must pass the
    // click THROUGH, so a control under the pointer still receives it.
    window.doubleClickAction = { .none }
    window.claimed = false
    window.passedThrough = false
    doubleClick(at: NSPoint(x: blankBarX, y: window.contentView!.bounds.height - 20))
    check("with the preference off, a double-click is not swallowed", !window.claimed)
    check("...and reaches the page", window.passedThrough)

    // With it on, the window zooms: assert the gesture is CLAIMED, because zoom
    // itself depends on the current frame and would make this flaky.
    window.doubleClickAction = { .maximize }
    window.claimed = false
    window.passedThrough = false
    doubleClick(at: NSPoint(x: blankBarX, y: window.contentView!.bounds.height - 20))
    check("with the preference on, a double-click is claimed", !window.passedThrough)
    window.doubleClickAction = { .current() }
  }

  /**
   The bar's right-click menu, which a native title bar raises for free.

   Asserted through the window's own item list rather than by popping a menu: a
   modal menu cannot be dismissed from a test process.
   */
  func runMenuCases() {
    let titles = window.barMenuTitles()
    // "Zoom" and "Restore" are the same item in two states, so the assertion is
    // on the pair rather than on one spelling.
    let hasZoom = titles.contains("Zoom") || titles.contains("Restore")
    for expected in ["Move Window", "Minimize", "Enter Full Screen", "Close"] {
      check("the bar menu offers \(expected)", titles.contains(expected))
    }
    check("the bar menu offers Zoom/Restore", hasZoom)
  }

  /**
   Settings › opens the console's modal by ASKING THE PAGE, and never reloads.

   The row used to append `?settings=1` and load the URL again, which no client
   code reads: the document was thrown away (a live turn, the composer draft, the
   scroll position) and no settings screen appeared. The console listens for
   `omp:open-settings` in both layouts, so the case asserts that event reached a
   real page listener — through the SHIPPED script, not a copy of it.

   The document identity is captured before and after: a reload would replace it,
   and "the modal opened" on a fresh page would still be the bug.
   */
  func runSettingsMenuCases() {
    print("\nthe menu's Settings row")
    let before = eval("document.documentElement.dataset.probe = 'kept'; 'kept'") as? String
    check("the page is loaded before the row is pressed", before == "kept")

    // The shipped helper, dispatched the way the menu row calls it.
    var answered: Bool?
    openSettings(in: webView) { answered = $0 }
    pump(0.4)
    check("the shell reports a document to ask", answered == true)

    let events = eval("window.__settingsEvents.length") as? Int ?? 0
    check("the page received exactly one settings event", events == 1)
    check("the event carries the detail both layouts read",
          (eval("Object.keys(window.__settingsEvents[0] || {}).length") as? Int ?? -1) == 0)

    // The event's NAME, from the listener that fired — a wrong name would leave
    // the recorder empty while the script still "succeeded".
    check("the event name is the console's own",
          openSettingsEvent == "omp:open-settings")

    let survived = eval("document.documentElement.dataset.probe") as? String
    check("the document was not replaced by the row", survived == "kept")
  }

  func doubleClick(at point: NSPoint) {
    // `sendEvent` resets `passedThrough` on every left press, so a double-click
    // has to be observed by the WINDOW: `claimed` records that the bar took it.
    window.claimed = false
    window.passedThrough = false
    guard let event = NSEvent.mouseEvent(
      with: .leftMouseDown, location: point, modifierFlags: [],
      timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil,
      eventNumber: 1, clickCount: 2, pressure: 1
    ) else { return }
    window.sendEvent(event)
  }

  /**
   The window actually MOVES, through the shipped drag code.

   `performWindowDragWithEvent:` was the first implementation and cannot be
   proved here: its loop reads the physical pointer through the event tap, and
   with no accessibility grant a posted press moves nothing (measured — before
   (640,149), during (640,149), after (640,149), with the cursor warped and the
   events posted into the app's own queue). The shell therefore follows the
   pointer itself, and this drives that path: press the header, move the pointer
   160×90, read the origin.
   */
  func proveWindowMoves() {
    let start = window.frame.origin
    press(at: NSPoint(x: blankBarX, y: window.contentView!.bounds.height - 20))
    guard window.claimed else {
      check("the drag started", false)
      return
    }
    // The shell keeps the pointer's offset from the window, so a pointer 160×90
    // from where it was pressed moves the window exactly that far.
    guard let pressedAt = window.dragStartPointer else {
      check("the press recorded a pointer", false)
      return
    }
    window.drag(to: NSPoint(x: pressedAt.x + 160, y: pressedAt.y + 90))

    // The assertion is on the ARITHMETIC, not on the raw origin, because
    // `setFrameOrigin` CONSTRAINS the frame to the screen: measured, asking for
    // (5200, 5200) lands at (2520, 930) on a 2560×1440 display. The CI runner's
    // display is small enough that +90 in y was clamped away, so the window DID
    // move (the "origin did not move" note never printed) and the case still
    // failed — a test of the runner's screen, not of the drag.
    //
    // `constrainFrameRect` is AppKit's own prediction of that clamp, verified
    // here to match `setFrameOrigin` exactly for both an in-bounds and an
    // out-of-bounds request. Comparing against it keeps the case honest on any
    // display while still proving the window followed the pointer.
    let wanted = NSRect(
      x: start.x + 160,
      y: start.y + 90,
      width: window.frame.width,
      height: window.frame.height
    )
    let expected = window.constrainFrameRect(wanted, to: window.screen).origin
    let moved = window.frame.origin
    check("the window follows the pointer by the same delta",
          abs(moved.x - expected.x) < 0.5 && abs(moved.y - expected.y) < 0.5)
    // A window that ignored the drag entirely is still a failure, however the
    // screen constrains it — that is the bug this case exists for.
    check("...and actually moved from where it started", moved != start)
    if moved == start { print("  note: origin did not move: \(moved)") }

    window.cancelDrag()
    window.setFrameOrigin(start)
  }

  /**
   A click on close CLOSES the window.

   The cases above prove the system's own buttons win the hit test; this proves
   the button then does its job, which is the half a hit-test assertion cannot
   see. Close is the one of the three that needs no Dock and no active app:
   measured here, `performMiniaturize` answers false in an `.accessory` process
   that was never activated, so a minimise assertion would report the harness
   rather than the shell. Runs LAST because it takes the window away.

   **`performClick`, not a synthetic mouse event.** A real `NSWindowButton` opens
   AppKit's tracking loop on a `leftMouseDown` and pulls the queue for a mouse-up;
   a queued pair is no better here, because this process is never key on a
   runner (`isKeyWindow` false, measured on both CI legs) so the button's tracking
   never completes and the window stays open. `performClick` is the button's own
   action path, which is what the shipped app reaches once AppKit has tracked a
   real click.
   */
  func proveClickCloses() {
    guard let close = window.standardWindowButton(.closeButton) else {
      check("the window has a close button", false)
      return
    }
    check("the window starts visible", window.isVisible)
    close.performClick(nil)
    pump(0.4)
    check("a click on close closes the window", !window.isVisible)
  }

  /**
   The launch splash, RENDERED in a real window.

   The state machine is `Tests/SplashTests.swift`'s, and a splash that drew the
   wrong phase — or drew nothing at all — would pass every one of those cases.
   What this checks is the assembled view: the mark is on screen, the bar exists
   and is determinate only once a real percentage arrives, the sentence is the
   state's, and Retry appears only on a failure.

   Measured through the view's own subviews rather than a screenshot: the window
   is real, but a bitmap comparison would assert the machine's font rendering
   instead of the shell's behaviour.
   */
  func runSplashCases() {
    print("\nthe launch splash, rendered")
    let splash = SplashView(frame: window.contentView!.bounds)
    splash.render(.connecting)
    window.contentView?.addSubview(splash)
    // No run-loop pump: every assertion below reads a property `render` set
    // synchronously. A pump would only be needed for an ANIMATION to land, and a
    // splash whose phases depended on one would be a splash that lies for the
    // frames before it finishes.
    window.contentView?.layoutSubtreeIfNeeded()

    check("the splash is on screen while connecting", !splash.isHidden)
    let image = splash.subviews.compactMap { $0 as? NSImageView }.first
    check("the wordmark is drawn", image?.image != nil)
    if let size = image?.image?.size {
      // The artwork's own aspect: a mark stretched square is a mark that is not
      // the lockup README.md embeds.
      check("the wordmark keeps the artwork's aspect",
            abs(size.width / size.height - 486.38 / 156.25) < 0.05)
    }
    let bar = splash.subviews.compactMap { $0 as? NSProgressIndicator }.first
    check("a progress bar is present", bar != nil)
    check("the bar sweeps until a real percentage arrives", bar?.isIndeterminate == true)
    let sentence = splash.subviews.compactMap { $0 as? NSTextField }.first
    check("the sentence is the connecting state's",
          sentence?.stringValue == "Connecting to the server…")

    splash.render(SplashState.connecting.progressed(42))
    check("a real percentage makes the bar determinate", bar?.isIndeterminate == false)
    check("the bar carries the percentage", bar?.doubleValue == 42)
    check("the sentence carries the percentage",
          sentence?.stringValue == "Loading the console… 42%")

    splash.render(SplashState.connecting.failedBecause(.connect))
    check("a failure offers Retry",
          splash.subviews.compactMap { $0 as? NSButton }.contains { !$0.isHidden })
    check("a failure hides the bar, which would say 'still working'", bar?.isHidden == true)
    check("the failure sentence names what to check",
          sentence?.stringValue.contains("Could not connect") == true)

    splash.render(.done)
    check("the finished splash draws nothing", splash.isHidden)
    splash.removeFromSuperview()
  }

  /**
   The splash FILLS the window, in a window and in full screen.

   A splash sized from a hard-coded rect rather than from its container is
   invisible to every state-machine case — it drew the right phase, in the right
   corner, at 1280x860 inside a 2560x1335 window. Measured on the shipped app:
   `container` and the web view were both the window's size while `SplashView`
   reported `{{0, 0}, {1280, 859}}`, which is the reported "the overlay is only a
   small box at the bottom".

   The container here starts LARGER than the rect the splash would have been
   built with, which is the window's own situation (its frame is restored by the
   autosave name before the views are built), and it is then resized again so
   `autoresizingMask` is exercised rather than assumed.
   */
  func runSplashFillCases() {
    print("\nthe splash fills its container")
    let big = NSRect(x: 0, y: 0, width: 1900, height: 1100)
    let host = NSView(frame: big)
    host.autoresizingMask = [.width, .height]
    window.contentView?.addSubview(host)

    let installed = installSplash(in: host, state: .connecting)
    check("the splash covers a container larger than the build rect",
          installed.frame == host.bounds)

    // A resize must carry it, which is what `autoresizingMask` is for.
    host.frame = NSRect(x: 0, y: 0, width: 1500, height: 900)
    host.layoutSubtreeIfNeeded()
    check("the splash follows a container resize", installed.frame == host.bounds)

    installed.render(.done)
    host.removeFromSuperview()
  }

  func finish() {
    print(failures == 0 ? "\ndrag contract holds" : "\n\(failures) failure(s)")
    exit(failures == 0 ? 0 : 1)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let runner = Runner()
app.delegate = runner

/**
 A ceiling, because this suite runs inside a RELEASE gate.

 Everything in the suite is already deadline-bounded, but two things are not
 ours to bound: `app.run()` never returns if the page neither loads nor errors,
 and AppKit's own mouse-tracking loops block the main thread. Measured on this
 repository's release run: both macOS legs sat in `Run the window suite` for over
 an hour while every other job had finished, and there was nothing to stop them —
 the workflow declares no `timeout-minutes`, so the ceiling was GitHub's
 six-hour default.

 The timer runs on a BACKGROUND queue deliberately: the main thread is exactly
 what gets stuck, so a `RunLoop` timer would be starved by the thing it watches
 for. `exit` terminates the process from there (verified against a main thread
 blocked in a modal loop).
 */
DispatchQueue.global().asyncAfter(deadline: .now() + 120) {
  print("\nWATCHDOG: the window suite did not finish within 120s (phase: \(runner.phase))")
  exit(3)
}

app.run()
