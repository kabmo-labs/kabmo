/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The menu bar's shape, asserted from the SAME table the app installs.
 *
 * The Edit menu shipped missing once because its builder lived in the app target
 * and no suite could install it. `MenuBar.swift` moved the other five menus into
 * the library for the same reason, and these cases are what makes the move worth
 * anything: a row that disappears, a chord that moves, or a page command that
 * starts declaring a key equivalent (which would steal the chord from the page)
 * fails here instead of shipping.
 *
 * No window server is needed: `NSMenu` is a model object, and the rows are
 * asserted before AppKit ever draws them.
 */

import AppKit

import KabmoDesktop

func menuBarCases() {
  group("the menu bar")

  let parts = MenuBar.parts(includeDevTools: false)
  let menus = parts.main.items.compactMap(\.submenu)

  check("the bar has six menus", menus.count == 6)
  check("the menus are App, File, Edit, View, Window, Help",
        menus.map(\.title) == ["", "File", "Edit", "View", "Window", "Help"])

  // ------------------------------------------------------------------ App

  let app = menus[0]
  let appTitles = app.items.filter { !$0.isSeparatorItem }.map(\.title)
  check("the App menu starts with About", appTitles.first == "About Kabmo")
  check("the App menu offers Check for Updates…", appTitles.contains("Check for Updates…"))
  check("the App menu offers Settings…", appTitles.contains("Settings…"))
  check("the App menu offers Change Server…", appTitles.contains("Change Server…"))
  check("the App menu offers Services", appTitles.contains("Services"))
  check("the App menu offers Quit", appTitles.contains("Quit Kabmo"))

  let settings = app.items.first { $0.title == "Settings…" }
  check("Settings… is ⌘,", settings?.keyEquivalent == "," && settings?.keyEquivalentModifierMask == [.command])

  let servicesItem = app.items.first { $0.title == "Services" }
  check("Services carries the submenu AppKit fills", servicesItem?.submenu === parts.services)
  check("the Services submenu starts empty", parts.services.items.isEmpty)

  // ----------------------------------------------------------------- File

  let file = menus[1]
  let fileTitles = file.items.filter { !$0.isSeparatorItem }.map(\.title)
  check("File offers New Session, Open… and Close Window",
        fileTitles == ["New Session", "Open…", "Close Window"])

  let newSession = file.items.first { $0.title == "New Session" }
  check("New Session is a page command", newSession?.representedObject as? String == "workspace.newSession")
  check("New Session declares NO chord (the catalog owns ⌘N)", newSession?.keyEquivalent == "")

  let open = file.items.first { $0.title == "Open…" }
  check("Open… is ⌘O", open?.keyEquivalent == "o" && open?.keyEquivalentModifierMask == [.command])

  // ----------------------------------------------------------------- Edit

  let edit = menus[2]
  check("the Edit menu is the shipped table, separators included",
        edit.items.map(\.title) == editMenuTitles)
  check("the Edit menu groups undo/redo, clipboard and Select All",
        edit.items.map(\.isSeparatorItem) == [false, false, true, false, false, false, false, true, false])

  // ----------------------------------------------------------------- View

  let view = menus[3]
  let viewTitles = view.items.filter { !$0.isSeparatorItem && !$0.isHidden }.map(\.title)
  check("View offers the page commands first",
        Array(viewTitles.prefix(5)) == ["Command Palette", "Quick Open…", "Toggle Sidebar", "Toggle Right Panel", "Toggle Editor Panel"])
  check("View offers Reload, Open in Browser and the zoom rows",
        viewTitles.suffix(5) == ["Reload", "Open in Browser", "Actual Size", "Zoom In", "Zoom Out"])

  for title in ["Command Palette", "Quick Open…", "Toggle Sidebar", "Toggle Right Panel", "Toggle Editor Panel"] {
    let row = view.items.first { $0.title == title }
    check("View › \(title) is a page command", row?.representedObject is String)
    check("View › \(title) declares no chord", row?.keyEquivalent == "")
  }

  let zoomIn = view.items.first { $0.title == "Zoom In" && !$0.isHidden }
  check("Zoom In is ⌘+", zoomIn?.keyEquivalent == "+" && zoomIn?.keyEquivalentModifierMask == [.command])
  let zoomAlternate = view.items.first { $0.title == "Zoom In" && $0.isHidden }
  check("a hidden Zoom In answers ⌘=", zoomAlternate?.keyEquivalent == "=" && zoomAlternate?.keyEquivalentModifierMask == [.command])
  check("the hidden alternate is not drawn", zoomAlternate?.isHidden == true)

  check("a release build offers no Web Inspector row",
        !viewTitles.contains("Allow Web Inspector"))

  let debugView = MenuBar.viewMenu(includeDevTools: true)
  let inspector = debugView.items.first { $0.title == "Allow Web Inspector" }
  check("a debug build offers Allow Web Inspector",
        inspector?.keyEquivalent == "i" && inspector?.keyEquivalentModifierMask == [.command, .option])

  // --------------------------------------------------------------- Window

  let window = menus[4]
  let windowTitles = window.items.filter { !$0.isSeparatorItem }.map(\.title)
  check("Window offers Minimize, Zoom, Enter Full Screen, Keep on Top and Bring All to Front",
        windowTitles == ["Minimize", "Zoom", "Enter Full Screen", "Keep on Top", "Bring All to Front"])

  let fullScreen = window.items.first { $0.title == "Enter Full Screen" }
  check("Enter Full Screen is ⌃⌘F",
        fullScreen?.keyEquivalent == "f" && fullScreen?.keyEquivalentModifierMask == [.control, .command])

  // ----------------------------------------------------------------- Help

  let help = menus[5]
  check("Help is the menu handed to NSApp", help === parts.help)
  check("Help offers Kabmo Help, Keyboard Shortcuts and Report an Issue…",
        help.items.map(\.title) == ["Kabmo Help", "Keyboard Shortcuts", "Report an Issue…"])
  check("Help › Keyboard Shortcuts is a page command",
        help.items.first { $0.title == "Keyboard Shortcuts" }?.representedObject as? String == "workspace.keyBindings")

  // ------------------------------------------------------- page-command rows

  let pageRows = menus.flatMap(\.items).filter { $0.action == #selector(ShellMenuActions.runPageCommand(_:)) }
  check("every page row carries a catalog id", pageRows.allSatisfy { $0.representedObject is String })
  check("no page row declares a key equivalent", pageRows.allSatisfy { $0.keyEquivalent.isEmpty })
  check("the page rows are the seven the shell offers", pageRows.count == 7)
}
