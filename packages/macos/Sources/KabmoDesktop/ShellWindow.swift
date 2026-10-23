/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The window's own title bar: the page's header IS the bar.
 *
 * `titlebarAppearsTransparent` + `titleVisibility = .hidden` on a
 * `fullSizeContentView` window means macOS keeps its traffic lights but draws no
 * title, so the top 40px of the page is the bar. Everything a native title bar
 * does for free then has to be done here, and this file is the list:
 *
 * 1. **Move** — decided by asking the page, not by CSS (see `dragRegionSelector`).
 * 2. **Double-click** — the system's own preference decides zoom, minimise or
 *    nothing (`AppleActionOnDoubleClick`), exactly as it does for a native bar.
 * 3. **The window menu on right-click** — Move / Resize / Minimise / Zoom /
 *    Fullscreen, the menu a native title bar raises.
 * 4. **The standard shortcuts** — ⌘W, ⌘M, ⌃⌘F, ⌘Q — which a borderless window
 *    does not get unless it says so (`validateUserInterfaceItem`).
 * 5. **Full screen and zoom** — the traffic light's green button works because
 *    the window is `resizable` and `fullSizeContentView`; what it must not do is
 *    let the page's header slide under the menu bar, which
 *    `windowDidEnterFullScreen` corrects.
 *
 * Three bugs were found by testing this on a real window, and each is a comment
 * at the place it bit: `mouseDown` never runs inside a `WKWebView`;
 * `convert(_:from:)` already answers in the webview's flipped geometry; and
 * `NSEvent.mouseLocation` is the hardware pointer, not the event.
 */

import AppKit
import WebKit

/// Width macOS reserves for its traffic lights, plus the gap after them.
public let trafficLightInset: CGFloat = 76

/**
 The CSS selector a press must satisfy to move the window.

 `data-drag-region` is the marker the page carries on its header. The walk stops
 at anything the user can press, so no per-control attribute is needed — a new
 button inside the header is inert by construction rather than by remembering.
 */
public let dragRegionSelector = """
(() => {
  const hit = document.elementFromPoint(%x, %y);
  if (!hit) return false;
  let node = hit;
  while (node && node !== document.documentElement) {
    if (node.hasAttribute && node.hasAttribute('data-no-drag')) return false;
    const tag = node.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' ||
        tag === 'TEXTAREA' || tag === 'LABEL' || tag === 'SUMMARY') return false;
    if (node.isContentEditable) return false;
    const role = node.getAttribute && node.getAttribute('role');
    if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab' ||
        role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'option') return false;
    if (node.hasAttribute && node.hasAttribute('tabindex') &&
        node.getAttribute('tabindex') !== '-1') return false;
    if (node.hasAttribute && node.hasAttribute('data-drag-region')) return true;
    node = node.parentElement;
  }
  return false;
})()
"""

/**
 What a double-click on the title bar should do, from the system preference.

 macOS exposes this as `AppleActionOnDoubleClick` with three values — `Maximize`
 (the default), `Minimize`, and `None` — and a native title bar obeys it. A
 page-drawn bar has to read it itself, or a user who set "minimise" gets a window
 that zooms instead.

 The keys are matched case-insensitively because the value is user-editable
 through `defaults write` and the capitalisation there is not guaranteed.
 */
public enum DoubleClickAction: String {
  case maximize
  case minimize
  case none

  public static func fromPreference(_ raw: String?) -> DoubleClickAction {
    switch raw?.trimmingCharacters(in: .whitespaces).lowercased() {
    case "minimize": return .minimize
    case "none": return .none
    // Unset is the default, and the default is Maximize.
    default: return .maximize
    }
  }

  /// The preference as this process sees it.
  public static func current(_ defaults: UserDefaults = .standard) -> DoubleClickAction {
    fromPreference(defaults.string(forKey: "AppleActionOnDoubleClick"))
  }
}

/**
 The window that treats its page's header as the title bar.
 */
open class ShellWindow: NSWindow {
  /// Resolves a point in the page to "this is a drag handle".
  public var dragRegionProbe: ((NSPoint) -> Bool)?
  /// Observed after a press is classified: true when it became a window drag.
  public var onPress: ((Bool) -> Void)?
  /// Where the pointer was at press time, in screen coordinates. Exposed for the
  /// window test, which drives the same path a trackpad would.
  public var dragStartPointer: NSPoint? { dragStartMouse }
  /// What a double-click on the bar does. Injectable so the window test can
  /// exercise all three outcomes without changing the machine's settings.
  public var doubleClickAction: () -> DoubleClickAction = { .current() }

  public override var canBecomeKey: Bool { true }
  public override var canBecomeMain: Bool { true }

  // ------------------------------------------------------------------ presses

  /**
   The press hook, in `sendEvent` — NOT `mouseDown`.

   Measured: a press inside a `WKWebView` never reaches `NSWindow.mouseDown`
   (only `sendEvent` runs; the webview's own view consumes it). An override on
   `mouseDown` is therefore dead code that looks right, which is exactly how the
   window ended up unmovable. `sendEvent` is the last point the window sees every
   event before a subview claims it.
   */
  open override func sendEvent(_ event: NSEvent) {
    switch event.type {
    case .leftMouseDown:
      // The system's own controls come FIRST, before the page is asked
      // anything. The page marks its whole header `[data-drag-region]` and the
      // leftmost 76px of that header is reserved for the traffic lights, so a
      // press on the close button is — as far as `elementFromPoint` can tell —
      // a press on a drag handle, and claiming it here meant the event never
      // reached the button: none of close / minimise / zoom could be clicked,
      // while the same strip still moved the window.
      if hitsStandardButton(at: event.locationInWindow) {
        break
      }
      if isOnBar(event) {
        // A double-click on the bar is the system gesture, never a drag start:
        // the first click of a double-click has already begun one, and starting
        // a second would leave two monitors on the same press.
        if event.clickCount >= 2 {
          let took = handleDoubleClick()
          onPress?(took)
          if took { return }
        } else if startDragIfHandle(event) {
          return
        }
      }
    case .rightMouseDown:
      // The title bar's own menu. A page right-click is a different gesture and
      // stays the page's — this only fires on the bar.
      if isOnBar(event) {
        showBarMenu(with: event)
        return
      }
    default:
      break
    }
    super.sendEvent(event)
  }

  /// Whether the press landed on one of the system's own title-bar controls.
  ///
  /// `standardWindowButton(_:)` is the only way to reach them: they live in the
  /// private titlebar container view, not in `contentView`, so no hit test over
  /// the content can find them. Their frames are converted to WINDOW
  /// coordinates, which is what `event.locationInWindow` is in.
  ///
  /// A hidden button (a window without `.closable` and friends) occupies no
  /// room, so it is skipped rather than reserving a dead strip.
  public func hitsStandardButton(at windowPoint: NSPoint) -> Bool {
    let types: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
    for type in types {
      guard let button = standardWindowButton(type), !button.isHidden else { continue }
      let rect = button.convert(button.bounds, to: nil)
      if NSMouseInRect(windowPoint, rect, false) { return true }
    }
    return false
  }

  /// Exposed for the window test: the same predicate a press uses, against a
  /// window-space point.
  public func debugIsOnBar(_ windowPoint: NSPoint) -> Bool {
    guard let webView = shellWebView(in: self), let probe = dragRegionProbe else { return false }
    return probe(webView.convert(windowPoint, from: nil))
  }

  /// Whether the press landed on a point the page marks as the bar.
  private func isOnBar(_ event: NSEvent) -> Bool {
    guard let webView = shellWebView(in: self), let probe = dragRegionProbe else { return false }
    // The event arrives in window coordinates; the page needs CSS pixels inside
    // its own viewport. `convert(_:from: nil)` already answers in the webview's
    // own geometry, and a `WKWebView` is FLIPPED (`isFlipped == true`, measured),
    // so that y already runs from the top — the same direction `elementFromPoint`
    // expects. Subtracting from the height here inverted every probe: a press at
    // the top of the window read as a press at the bottom, and the header never
    // matched.
    let inWeb = webView.convert(event.locationInWindow, from: nil)
    return probe(inWeb)
  }

  private func handleDoubleClick() -> Bool {
    switch doubleClickAction() {
    case .maximize:
      zoom(nil)
      return true
    case .minimize:
      miniaturize(nil)
      return true
    case .none:
      // The user asked for nothing: let the click through rather than swallowing
      // it, so a double-click on a header control still reaches the control.
      return false
    }
  }

  /**
   The menu a native title bar raises on right-click.

   `NSWindow.menu` would do this for a native window, but the item actions have
   to be the window's own (`performMiniaturize:` and friends are `NSWindow`
   selectors, so they work), and a page-drawn bar never gets the automatic one.
   Built per click so "Enter Full Screen" can name the state it will produce.
   */
  private func showBarMenu(with event: NSEvent) {
    let menu = barMenu()
    guard let view = contentView else { return }
    NSMenu.popUpContextMenu(menu, with: event, for: view)
  }

  /// The item titles of the bar's menu, in order. Exposed so a test can assert
  /// the menu without popping it — a modal menu cannot be dismissed from a test
  /// process.
  public func barMenuTitles() -> [String] {
    barMenu().items.filter { !$0.isSeparatorItem }.map(\.title)
  }

  private func barMenu() -> NSMenu {
    let menu = NSMenu()
    let fullScreenTitle = styleMask.contains(.fullScreen) ? "Exit Full Screen" : "Enter Full Screen"
    let items: [(String, Selector)] = [
      ("Move Window", #selector(beginMoveFromMenu)),
      ("Minimize", #selector(performMiniaturize(_:))),
      (isZoomed ? "Restore" : "Zoom", #selector(performZoom(_:))),
      (fullScreenTitle, #selector(toggleFullScreen(_:))),
    ]
    for (title, action) in items {
      let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
      item.target = self
      menu.addItem(item)
    }
    menu.addItem(.separator())
    let close = NSMenuItem(title: "Close", action: #selector(performClose(_:)), keyEquivalent: "")
    close.target = self
    menu.addItem(close)
    return menu
  }

  /// "Move Window" from the menu: the same drag, started without a press on the
  /// bar (the menu's own click is the press).
  @objc private func beginMoveFromMenu() {
    guard let event = NSApp.currentEvent else { return }
    beginDrag(from: event)
  }

  // ------------------------------------------------------------- drag state

  /// Where the pointer was when the drag began, in SCREEN coordinates.
  private var dragStartMouse: NSPoint?
  /// Where the window was at that moment.
  private var dragStartOrigin: NSPoint?
  /// The monitor that follows the drag. Removed on mouse-up, and on deinit so a
  /// closed window cannot leave a listener behind.
  private var dragMonitor: Any?

  deinit {
    if let monitor = dragMonitor { NSEvent.removeMonitor(monitor) }
  }

  /// True when the press was a drag handle and the window has taken it over.
  private func startDragIfHandle(_ event: NSEvent) -> Bool {
    guard isOnBar(event) else {
      onPress?(false)
      return false
    }
    beginDrag(from: event)
    onPress?(true)
    return true
  }

  /**
   Follow the pointer until it is released.

   Deliberately NOT `performWindowDragWithEvent:`. That selector runs AppKit's
   own loop, which tracks the physical pointer through the event tap — measured
   here, a press on the handle never moved the window and no drag event ever
   reached the app (`AXIsProcessTrusted` is false, so the tap has nothing to
   deliver). A loop that cannot be observed is also a loop that cannot be tested.

   This is the same arithmetic every custom-titlebar app ends up with, and it is
   one pure function (`draggedOrigin`) plus two observations of the pointer:
   screen coordinates for both, so the delta is the movement.
   */
  private func beginDrag(from event: NSEvent) {
    endDrag()
    dragStartMouse = screenPoint(of: event)
    dragStartOrigin = frame.origin
    dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { [weak self] event in
      guard let self else { return event }
      if event.type == .leftMouseUp {
        self.endDrag()
        return event
      }
      self.applyDrag(to: self.screenPoint(of: event))
      return event
    }
  }

  /**
   Where the pointer was, in SCREEN coordinates, taken from the EVENT.

   Not `NSEvent.mouseLocation`: that reports the hardware pointer's position,
   which only matches the event when a human is really dragging. Measured on the
   shipped app — a press posted into the app's queue with a synthetic drag left
   the window exactly where it was, because the global pointer never moved. The
   event's own location is the honest source, and it is what makes the drag
   testable without a trackpad.
   */
  private func screenPoint(of event: NSEvent) -> NSPoint {
    convertPoint(toScreen: event.locationInWindow)
  }

  private func applyDrag(to pointer: NSPoint) {
    guard let origin = dragStartOrigin, let start = dragStartMouse else { return }
    setFrameOrigin(draggedOrigin(windowOrigin: origin, startMouse: start, pointer: pointer))
  }

  /// Move the window to follow `pointer`, as the monitor does on every drag
  /// event. Public so the window test can drive it without a trackpad.
  public func drag(to pointer: NSPoint) {
    applyDrag(to: pointer)
  }

  /// Release the drag without a mouse-up event.
  public func cancelDrag() {
    endDrag()
  }

  private func endDrag() {
    if let monitor = dragMonitor { NSEvent.removeMonitor(monitor) }
    dragMonitor = nil
    dragStartMouse = nil
    dragStartOrigin = nil
  }

  // --------------------------------------------------------------- shortcuts

  /**
   ⌘W / ⌘M / ⌃⌘F / ⌘Q, for a window that draws its own bar.

   A `titled` window answers these because AppKit routes them to the window's
   standard actions; this one is `fullSizeContentView` with the title hidden, and
   measured, the shortcuts did nothing until the window declared it handles them.
   `validateUserInterfaceItem` is what the menu system asks before enabling an
   item, so returning true here is also what keeps the menu items live.
   */
  open override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
    switch item.action {
    case #selector(performClose(_:)), #selector(performMiniaturize(_:)),
         #selector(performZoom(_:)), #selector(toggleFullScreen(_:)):
      return true
    default:
      // Not ours: an action this window does not implement must stay unclaimed,
      // or a menu item for it is enabled and does nothing when pressed.
      return false
    }
  }

  // -------------------------------------------------------------- full screen

  /**
   The page must not sit under the menu bar in full screen.

   `fullSizeContentView` lets the page reach the window's top edge, which is
   right in a window and wrong in full screen: the menu bar and the notch both
   live there. `safeAreaInsets` reports the room they take, and the webview is
   inset by it — the same correction a native full-screen window makes.
   */
  /// Those two callbacks are `NSWindowDelegate` methods, not `NSWindow` ones, so
  /// the window cannot override them — it forwards from its own delegate. The
  /// app sets `window.fullScreenObserver` to itself and calls this.
  public func fullScreenStateChanged() {
    applyFullScreenInset()
  }

  private func applyFullScreenInset() {
    guard let container = contentView, let webView = shellWebView(in: self) else { return }
    let top = container.safeAreaInsets.top
    webView.frame = container.bounds.insetBy(dx: 0, dy: 0)
    webView.frame.origin.y = top
    webView.frame.size.height = container.bounds.height - top
  }
}

/**
 The webview this window is showing, whether it IS the content view or sits
 inside a container. The shell uses a container (the splash is a sibling), and a
 test may set the webview directly — a lookup that only walks `subviews` silently
 finds nothing in the second case and the drag never starts.
 */
public func shellWebView(in window: NSWindow) -> WKWebView? {
  if let direct = window.contentView as? WKWebView { return direct }
  return window.contentView?.subviews.compactMap { $0 as? WKWebView }.first
}

/**
 Where the window belongs while the pointer is at `pointer`.

 Screen coordinates on both sides, so the answer is a plain delta: the window
 keeps the offset it had from the pointer at press time. Extracted because it is
 the only part of the drag that can be wrong in a way nobody notices — an
 inverted axis, a flipped origin — and it is testable without a pointer.
 */
public func draggedOrigin(windowOrigin: NSPoint, startMouse: NSPoint, pointer: NSPoint) -> NSPoint {
  NSPoint(
    x: windowOrigin.x + (pointer.x - startMouse.x),
    y: windowOrigin.y + (pointer.y - startMouse.y)
  )
}

/**
 Build the window chrome: transparent title bar, hidden title, full-size content.

 `styleMask` keeps `titled` (the traffic lights are part of it) and adds
 `fullSizeContentView` so the page draws underneath the bar.
 */
public func makeWindow(contentRect: NSRect) -> ShellWindow {
  let window = ShellWindow(
    contentRect: contentRect,
    styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
    backing: .buffered,
    defer: false
  )
  window.title = "Kabmo"
  window.titleVisibility = .hidden
  window.titlebarAppearsTransparent = true
  // The bar is the page's, so the window must not also be movable by its
  // background: that would drag from anywhere the page does not claim.
  window.isMovableByWindowBackground = false
  window.minSize = NSSize(width: 720, height: 480)
  window.setFrameAutosaveName("KabmoMainWindow")
  window.collectionBehavior.insert(.fullScreenPrimary)
  return window
}
