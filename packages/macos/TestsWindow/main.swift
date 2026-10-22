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

  func applicationDidFinishLaunching(_ notification: Notification) {
    let rect = NSRect(x: 200, y: 200, width: 700, height: 480)
    window = RecordingWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
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
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.runCases() }
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

  func runCases() {
    ready = true
    let height = window.contentView!.bounds.height

    // A blank stretch of the header strip (top 40px, so near `height - 20` in
    // window coordinates, which are bottom-left).
    press(at: NSPoint(x: 60, y: height - 20))
    check("a press on blank header is claimed as a drag", window.claimed)
    check("...and is not passed to the page", !window.passedThrough)

    // A control inside the header must stay a control.
    press(at: NSPoint(x: 60 + 200 + 20, y: height - 20))
    check("a press on a header control is NOT a drag", !window.claimed)
    check("...and reaches the page", window.passedThrough)

    // The page body must never move the window.
    press(at: NSPoint(x: 300, y: height - 200))
    check("a press on the body is NOT a drag", !window.claimed)
    check("...and reaches the page", window.passedThrough)

    proveWindowMoves()
    runShortcutCases()
    runDoubleClickCases()
    runMenuCases()
    finish()
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
    doubleClick(at: NSPoint(x: 60, y: window.contentView!.bounds.height - 20))
    check("with the preference off, a double-click is not swallowed", !window.claimed)
    check("...and reaches the page", window.passedThrough)

    // With it on, the window zooms: assert the gesture is CLAIMED, because zoom
    // itself depends on the current frame and would make this flaky.
    window.doubleClickAction = { .maximize }
    window.claimed = false
    window.passedThrough = false
    doubleClick(at: NSPoint(x: 60, y: window.contentView!.bounds.height - 20))
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
    press(at: NSPoint(x: 60, y: window.contentView!.bounds.height - 20))
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

    let moved = window.frame.origin
    check("the window follows the pointer by the same delta",
          abs(moved.x - (start.x + 160)) < 0.5 && abs(moved.y - (start.y + 90)) < 0.5)
    if moved == start { print("  note: origin did not move: \(moved)") }

    window.cancelDrag()
    window.setFrameOrigin(start)
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
app.run()
