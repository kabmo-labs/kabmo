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

/// A page with the shape the shell's header has: a marked strip, a control
/// inside it, and body content below.
let page = """
<!doctype html><html><body style="margin:0;font:14px system-ui">
<div data-drag-region style="height:40px;background:#e8e8e8;display:flex;align-items:center;padding-left:12px">
  <span>header</span>
  <button id="btn" style="margin-left:200px">a control</button>
</div>
<div style="height:400px;background:#fafafa">body</div>
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
  var webView: WKWebView!
  var ready = false
  /// Where the suite is, for the watchdog's message. "The suite stopped" is
  /// useless without it.
  var phase = "the page was still loading"

  func applicationDidFinishLaunching(_ notification: Notification) {
    let rect = NSRect(x: 200, y: 200, width: 700, height: 480)
    window = RecordingWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false
    )
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true

    webView = WKWebView(frame: rect)
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

  /// Let the run loop run for `seconds`, so an animated window action can land.
  func pump(_ seconds: TimeInterval) {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
  }

  /// A whole click: a press, then the release that makes it one.
  ///
  /// Posted into the app's own queue rather than handed to `sendEvent`, because
  /// an `NSButton` tracks the mouse in a modal loop that PULLS from that queue —
  /// a press delivered directly starts the loop and then blocks it forever with
  /// no release to find. Returns once the queue has been drained.
  func click(at point: NSPoint) {
    let now = ProcessInfo.processInfo.systemUptime
    for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
      guard let event = NSEvent.mouseEvent(
        with: type, location: point, modifierFlags: [], timestamp: now,
        windowNumber: window.windowNumber, context: nil,
        eventNumber: 1, clickCount: 1, pressure: 1
      ) else { return }
      NSApp.postEvent(event, atStart: false)
    }
    let deadline = Date().addingTimeInterval(1.0)
    while Date() < deadline {
      guard let next = NSApp.nextEvent(
        matching: .any, until: Date().addingTimeInterval(0.02),
        inMode: .default, dequeue: true
      ) else { continue }
      NSApp.sendEvent(next)
      if next.type == .leftMouseUp { break }
    }
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
    runTrafficLightCases()
    runShortcutCases()
    runDoubleClickCases()
    runMenuCases()
    proveClickCloses()
    runSplashCases()
    finish()
  }

  /**
   The system's traffic lights stay clickable.

   The page marks its whole header `[data-drag-region]` and reserves its leftmost
   76px for these buttons, so `elementFromPoint` at a traffic light answers "a
   drag handle" — the press was claimed by the window and the button never saw
   it. Close, minimise and zoom were all dead in the shipped app while the same
   strip still moved the window, which is exactly the shape of a hit test that
   asks the page before it asks the system.

   The button frames are read from the window rather than hard-coded, because
   macOS decides where they sit; the assertion is that a press INSIDE one is not
   a drag, and that the strip beside them still is.
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
      window.claimed = false
      window.passedThrough = false
      press(at: centre)
      check("a press on \(label) is NOT a drag", !window.claimed)
      check("...and reaches the button", window.passedThrough)
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
   A whole click on a traffic light CLOSES the window.

   The cases above prove the press reaches the button; this proves the button
   then does its job, which is the half a press-through assertion cannot see — a
   button that never tracks the mouse still "receives" the press. Close is the
   one of the three that needs no Dock and no active app: measured here,
   `performMiniaturize` answers false in an `.accessory` process that was never
   activated, so a minimise assertion would report the harness rather than the
   shell. Runs LAST because it takes the window away.
   */
  func proveClickCloses() {
    guard let close = window.standardWindowButton(.closeButton) else {
      check("the window has a close button", false)
      return
    }
    let rect = close.convert(close.bounds, to: nil)
    check("the window starts visible", window.isVisible)
    click(at: NSPoint(x: rect.midX, y: rect.midY))
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
