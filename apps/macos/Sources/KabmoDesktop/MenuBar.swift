/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The menu bar, as data.

 **Why this is a library file and not `App.swift`.** The Edit menu shipped
 missing once, and the reason it could was that the menu was built inside the app
 target where no suite could install it. `EditMenu.swift` fixed that for one menu;
 this file finishes the job for the other five. The app calls `MenuBar.parts(…)`
 and the suites assert the SAME table, so a row that disappears fails a test
 instead of shipping.

 **Two rules decide every row here.**

 1. **A row that runs a PAGE command carries NO key equivalent.** AppKit handles
    key equivalents before the event reaches the first responder, so a native row
    declaring ⌘B would consume the chord and the page's own dispatcher would never
    see it — the exact mechanism `EditMenu.swift` documents from the other side.
    The catalog (`src/shared/lib/commands/catalog.ts`) is the single source for a
    chord, including the user's overrides; a second copy here would drift and
    would keep firing a chord the user rebound. So these rows are click-only and
    ask the page through `runPageCommand:`.
 2. **A row that runs a SHELL action may carry a chord**, because nothing else
    owns it: ⌘R, ⌘O, ⌘0, ⌘+, ⌘−, ⌥⌘I.

 The App menu's first item has an empty title on purpose: AppKit substitutes the
 app's name, which is the bundle's `CFBundleName` (or the process name for a
 non-bundled launch — see `setProcessName` in `App.swift`).
 */
import AppKit

/**
 The shell actions a menu row can invoke.

 A protocol rather than string selectors: a typo in a selector is a dead row that
 compiles, and the Edit menu's own history is a list of those. The app delegate
 conforms; the rows keep `target = nil` so AppKit routes them through the
 responder chain to whichever object implements them.
 */
@objc public protocol ShellMenuActions {
  func openConsoleSettings(_ sender: Any?)
  func changeServer(_ sender: Any?)
  func checkForUpdates(_ sender: Any?)
  func newSession(_ sender: Any?)
  func openFile(_ sender: Any?)
  func runPageCommand(_ sender: Any?)
  func reloadPage(_ sender: Any?)
  func openInBrowser(_ sender: Any?)
  func zoomActualSize(_ sender: Any?)
  func zoomIn(_ sender: Any?)
  func zoomOut(_ sender: Any?)
  func toggleWebInspector(_ sender: Any?)
  func keepOnTop(_ sender: Any?)
  func openHelp(_ sender: Any?)
  func reportIssue(_ sender: Any?)
}

public enum MenuBar {
  /// The four menus the app must also hand to `NSApp` (services, help, windows)
  /// plus the bar itself. Returned together so the app never digs a menu out of
  /// the tree by index.
  public struct Parts {
    public let main: NSMenu
    public let services: NSMenu
    public let help: NSMenu
    public let windows: NSMenu
  }

  /**
   Build the whole bar.

   `includeDevTools` is a parameter rather than a read of the environment so the
   suite can assert both shapes: a release build must not offer the Web
   Inspector, and a debug build must.
   */
  public static func parts(includeDevTools: Bool) -> Parts {
    let services = servicesMenu()
    let help = helpMenu()
    let windows = windowMenu()

    let mainMenu = NSMenu()
    for menu in [appMenu(services: services), fileMenu(), buildEditMenu(), viewMenu(includeDevTools: includeDevTools), windows, help] {
      let item = NSMenuItem()
      item.submenu = menu
      mainMenu.addItem(item)
    }
    return Parts(main: mainMenu, services: services, help: help, windows: windows)
  }

  // ------------------------------------------------------------------ App

  public static func appMenu(services: NSMenu? = nil) -> NSMenu {
    let menu = NSMenu()
    menu.addItem(row("About Kabmo", #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
    menu.addItem(row("Check for Updates…", #selector(ShellMenuActions.checkForUpdates(_:))))
    menu.addItem(.separator())
    menu.addItem(row("Settings…", #selector(ShellMenuActions.openConsoleSettings(_:)), key: ","))
    // The shell's own server sheet, which was reachable only from the splash and
    // an error — once the console was up there was no way back to it.
    menu.addItem(row("Change Server…", #selector(ShellMenuActions.changeServer(_:)), key: ",", modifiers: [.command, .shift]))
    menu.addItem(.separator())
    let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
    servicesItem.submenu = services ?? servicesMenu()
    menu.addItem(servicesItem)
    menu.addItem(.separator())
    menu.addItem(row("Hide Kabmo", #selector(NSApplication.hide(_:)), key: "h"))
    menu.addItem(row("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), key: "h", modifiers: [.command, .option]))
    menu.addItem(row("Show All", #selector(NSApplication.unhideAllApplications(_:))))
    menu.addItem(.separator())
    menu.addItem(row("Quit Kabmo", #selector(NSApplication.terminate(_:)), key: "q"))
    return menu
  }

  /**
   The Services submenu.

   AppKit fills it from the system's service providers, and it is the only route
   a selected piece of text has to "Search with Google", "Make New Sticky Note"
   and the rest. Without `NSApp.servicesMenu` the submenu is absent, which is a
   HIG gap rather than a cosmetic one.
   */
  public static func servicesMenu() -> NSMenu {
    NSMenu(title: "Services")
  }

  // ----------------------------------------------------------------- File

  public static func fileMenu() -> NSMenu {
    let menu = NSMenu(title: "File")
    // No chord: ⌘N belongs to the catalog, and the page's dispatcher owns it.
    menu.addItem(pageRow("New Session", "workspace.newSession"))
    menu.addItem(row("Open…", #selector(ShellMenuActions.openFile(_:)), key: "o"))
    menu.addItem(.separator())
    menu.addItem(row("Close Window", #selector(NSWindow.performClose(_:)), key: "w"))
    return menu
  }

  // ----------------------------------------------------------------- View

  public static func viewMenu(includeDevTools: Bool) -> NSMenu {
    let menu = NSMenu(title: "View")
    menu.addItem(pageRow("Command Palette", "workspace.commandPalette"))
    menu.addItem(pageRow("Quick Open…", "workspace.quickOpen"))
    menu.addItem(.separator())
    menu.addItem(pageRow("Toggle Sidebar", "workspace.toggleSidebar"))
    menu.addItem(pageRow("Toggle Right Panel", "workspace.toggleRightPanel"))
    menu.addItem(pageRow("Toggle Editor Panel", "workspace.toggleEditorPanel"))
    menu.addItem(.separator())
    menu.addItem(row("Reload", #selector(ShellMenuActions.reloadPage(_:)), key: "r"))
    menu.addItem(row("Open in Browser", #selector(ShellMenuActions.openInBrowser(_:))))
    menu.addItem(.separator())
    menu.addItem(row("Actual Size", #selector(ShellMenuActions.zoomActualSize(_:)), key: "0"))
    menu.addItem(row("Zoom In", #selector(ShellMenuActions.zoomIn(_:)), key: "+"))
    // ⌘= is the key a US keyboard produces without Shift, and a "+" key
    // equivalent does NOT match it (measured: `performKeyEquivalent` answers
    // false for ⌘= against an item declaring "+"). A hidden alternate is the
    // standard fix — it participates in matching and never appears in the menu.
    let zoomInAlternate = row("Zoom In", #selector(ShellMenuActions.zoomIn(_:)), key: "=")
    zoomInAlternate.isHidden = true
    menu.addItem(zoomInAlternate)
    menu.addItem(row("Zoom Out", #selector(ShellMenuActions.zoomOut(_:)), key: "-"))
    if includeDevTools {
      menu.addItem(.separator())
      menu.addItem(row("Allow Web Inspector", #selector(ShellMenuActions.toggleWebInspector(_:)), key: "i", modifiers: [.command, .option]))
    }
    return menu
  }

  // --------------------------------------------------------------- Window

  public static func windowMenu() -> NSMenu {
    let menu = NSMenu(title: "Window")
    menu.addItem(row("Minimize", #selector(NSWindow.performMiniaturize(_:)), key: "m"))
    menu.addItem(row("Zoom", #selector(NSWindow.performZoom(_:))))
    // The title is corrected to "Exit Full Screen" by `validateMenuItem` while
    // the window is full screen; a static "Toggle" is not what HIG asks for.
    menu.addItem(row("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), key: "f", modifiers: [.control, .command]))
    menu.addItem(.separator())
    menu.addItem(row("Keep on Top", #selector(ShellMenuActions.keepOnTop(_:))))
    menu.addItem(.separator())
    // AppKit appends the window list itself (measured: a window appears in the
    // menu after `update()`), but it does NOT add this row — so it is stated
    // here rather than assumed.
    menu.addItem(row("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))))
    return menu
  }

  // ----------------------------------------------------------------- Help

  public static func helpMenu() -> NSMenu {
    let menu = NSMenu(title: "Help")
    menu.addItem(row("Kabmo Help", #selector(ShellMenuActions.openHelp(_:))))
    menu.addItem(pageRow("Keyboard Shortcuts", "workspace.keyBindings"))
    menu.addItem(row("Report an Issue…", #selector(ShellMenuActions.reportIssue(_:))))
    return menu
  }

  // -------------------------------------------------------------- helpers

  /// One row with a shell action. `target` stays nil: the responder chain finds
  /// the app delegate, which is what makes the same table work in a suite.
  public static func row(
    _ title: String,
    _ action: Selector,
    key: String = "",
    modifiers: NSEvent.ModifierFlags = [.command]
  ) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
    item.keyEquivalentModifierMask = modifiers
    return item
  }

  /// One row that asks the page to run a catalog command. No key equivalent —
  /// see the file comment.
  public static func pageRow(_ title: String, _ command: String) -> NSMenuItem {
    let item = row(title, #selector(ShellMenuActions.runPageCommand(_:)))
    item.representedObject = command
    return item
  }
}
