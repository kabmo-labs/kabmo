/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 The Edit menu, and the one fact that makes it load-bearing rather than cosmetic.

 **A `WKWebView` gets no ⌘V, ⌘C, ⌘X, ⌘Z or ⌘A at all unless the app's menu bar
 carries an Edit menu whose items declare those key equivalents.** The web view
 is the first responder and it does receive the `keydown` (a page can see
 `metaKey` and `key === 'v'`), but the edit COMMANDS are dispatched through the
 menu system: with no menu item to claim the chord, AppKit never asks the
 responder chain, so nothing reaches `paste:` and the page's own `paste` event
 never fires either. Measured on macOS 27 with this SDK, a `WKWebView` in a bare
 `NSWindow` (no main menu) versus the same window with the Edit menu below:

     no Edit menu:  paste=[], selectAll=4-4 (unchanged), copy=nil, cut=alpha, undo=alpha
     Edit menu:     paste=[CLIP], selectAll=0-10, copy=CLIP, cut=[], undo=alphaalpha

 Every one of those columns is a keyboard-only user losing a standard editing
 verb, and none of them throws — the composer simply ignores ⌘V, which is what
 was reported ("copy paste dengan keyboard tidak bisa di composer").

 The shell built App, File, View and Window and nothing else, so this is not a
 missing nicety: it is the reason the web view was never offered the chords.

 Two rules are stated here rather than at the call site, because both fail
 SILENTLY:

 1. **`Undo` and `Redo` have no AppKit-declared selector.** `undo:`/`redo:` are
    `NSResponder`'s informal protocol (they are not in any public header — checked
    against this SDK), so they are spelled as strings. `NSText`'s `cut:`,
    `copy:`, `paste:`, `delete:` and `selectAll:` are declared and are used as
    selectors, which keeps a typo a compile error instead of a dead menu row.
 2. **`Redo` must carry `⌘⇧Z` EXPLICITLY.** A menu item's default modifier mask
    is `.command`, so an item with `keyEquivalent: "z"` for Redo would collide
    with Undo's and the second row would be unreachable.
 */
import AppKit

/// One row of the Edit menu.
public struct EditMenuItem: Sendable {
  public let title: String
  public let action: Selector
  public let key: String
  public let modifiers: NSEvent.ModifierFlags

  public init(title: String, action: Selector, key: String, modifiers: NSEvent.ModifierFlags = [.command]) {
    self.title = title
    self.action = action
    self.key = key
    self.modifiers = modifiers
  }

  /// The menu item this row describes, with its modifier mask applied.
  public var menuItem: NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
    item.keyEquivalentModifierMask = modifiers
    return item
  }
}

/// `undo:` — `NSResponder`'s informal action, so it has no selector to reference.
public let undoAction = Selector(("undo:"))
/// `redo:` — same, and `⌘⇧Z` (see the note on this file).
public let redoAction = Selector(("redo:"))

/**
 The Edit menu's rows, in the order macOS users expect.

 `Delete` deliberately carries NO key equivalent: its chord would be a bare
 backspace, which the page already owns, and a menu item claiming it would make
 the key ambiguous for every text field in the console.

 These are the verbs a web page needs from the menu bar, not the full set a
 native text editor offers — `Paste and Match Style` and `Substitutions` are
 absent because the console is a chat composer and a code editor, where the
 page's own behaviour is the one to keep.
 */
public let editMenuItems: [EditMenuItem] = [
  EditMenuItem(title: "Undo", action: undoAction, key: "z"),
  EditMenuItem(title: "Redo", action: redoAction, key: "z", modifiers: [.command, .shift]),
  EditMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), key: "x"),
  EditMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), key: "c"),
  EditMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), key: "v"),
  EditMenuItem(title: "Delete", action: #selector(NSText.delete(_:)), key: ""),
  EditMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), key: "a"),
]

/**
 The Edit menu, built from the table above.

 Lives in the library rather than in `App.swift` so the window suite installs the
 SAME menu the app does. A suite that declared its own chords would pass while
 the shipped menu was missing a row — which is exactly how the missing Edit menu
 shipped in the first place.
 */
public func buildEditMenu() -> NSMenu {
  let menu = NSMenu(title: "Edit")
  for row in editMenuItems {
    menu.addItem(row.menuItem)
  }
  return menu
}

/**
 Whether the window should let an Edit row be live.

 This is the gate the menu system asks before it enables an item, and answering
 `false` here is what made the first attempt at this fix look broken: the menu
 was built, the chords were declared, and ⌘Z still did nothing because the
 window claimed only its own four actions and refused everything else.

 `undo:`/`redo:` resolve against the WINDOW rather than the web view (measured:
 `NSApp.target(forAction:)` answers `NSWindow` for those two and `WKWebView` for
 the other five), and the window's own default answer is `false` — so leaving
 them to the responder chain disables both rows while the other five stay live.
 Allowing them here does not invent an undo stack: with this rule the chord
 reaches the page's own history, verified by typing `hi` and getting an empty
 field after ⌘Z and `hi` back after ⌘⇧Z.
 */
public func editMenuHandles(_ action: Selector?) -> Bool {
  guard let action else { return false }
  return editMenuItems.contains { $0.action == action }
}
