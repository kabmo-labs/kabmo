/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a drag onto the web view carried, as paths the page cannot see.
 *
 * A `WKWebView` gives its page BYTES for a Finder drag and nothing else — no
 * `getAsFileSystemHandle` (WebKit implements no File System Access API), no
 * `text/uri-list` (WebKit stopped adding local filenames as URLs to a file drag
 * on macOS) and no `File.path`. The page can therefore ATTACH a dropped file to
 * a chat and cannot OPEN one in the editor, which is the bug this exists for.
 *
 * The pasteboard still has the paths, and the shell is the only layer that can
 * read it. `DropWebView.performDragOperation` records them here BEFORE calling
 * `super`, so the page's own `drop` handler finds the answer waiting.
 *
 * Measured on macOS 27 against a synthesized Finder pasteboard
 * (`NSFilenamesPboardType` + `public.file-url`):
 *
 * - `NSFilenamesPboardType` answers the paths directly, as a property list.
 * - `public.file-url` answers one URL per item — the fallback for a drag that
 *   carries no legacy filename list, and the one a promise-based drag uses.
 * - A drag with NEITHER (a page's own in-app drag, a promise-only drag) yields
 *   no paths at all, which is the honest answer: the page's payload decides.
 */

import AppKit
import Foundation
import WebKit

/// What a drag carried, as the page asks for it.
///
/// `at` is the shell's clock in milliseconds, and the page's own age check is
/// what refuses a capture it asked for too late — a drag released where no
/// target claimed it leaves the record unread, and reopening that file on a
/// later gesture is worse than reporting nothing.
public struct CapturedDrop: Codable {
  public let paths: [String]
  public let at: Double

  public init(paths: [String], at: Double) {
    self.paths = paths
    self.at = at
  }
}

/**
 The paths a drag carried, from either pasteboard shape.

 `NSFilenamesPboardType` is the legacy list every file manager still writes on
 macOS and is checked first because it answers in the drop's own order;
 `public.file-url` is the modern shape and covers a drag from an app that writes
 only that. Duplicates are dropped, so a pasteboard carrying both spellings of
 one file opens one tab.
 */
public func droppedPaths(from pasteboard: NSPasteboard) -> [String] {
  var paths: [String] = []
  var seen = Set<String>()

  func add(_ path: String) {
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    let standard = URL(fileURLWithPath: trimmed).standardizedFileURL.path
    guard seen.insert(standard).inserted else { return }
    paths.append(standard)
  }

  let legacyType = NSPasteboard.PasteboardType("NSFilenamesPboardType")
  if let names = pasteboard.propertyList(forType: legacyType) as? [String] {
    for name in names { add(name) }
  }

  if let urls = pasteboard.readObjects(
    forClasses: [NSURL.self],
    options: [.urlReadingFileURLsOnly: true]
  ) as? [URL] {
    for url in urls where url.isFileURL { add(url.path) }
  }

  return paths
}

/**
 The answer for `dropped_paths`, consuming it.

 **One drop answers once.** The page asks from its own `drop` handler, and a
 value left behind would be answered again to the NEXT drop — a drag released
 where no target claimed it leaves the record unread, and reopening that file on
 a later gesture is worse than reporting nothing. The timestamp is what lets the
 page reject a leftover it asked for too late.
 */
public final class DropPathStore {
  private var captured: CapturedDrop?

  public init() {}

  /// Record what a drag carried. Called from `performDragOperation`, before
  /// `super`, so the page's handler cannot run first.
  public func capture(_ paths: [String]) {
    captured = paths.isEmpty
      ? nil
      : CapturedDrop(paths: paths, at: Date().timeIntervalSince1970 * 1000)
  }

  /// What the drop in flight carried, consumed.
  public func take() -> CapturedDrop? {
    defer { captured = nil }
    return captured
  }

  /// Forget anything left over — a drag that ended without a drop.
  public func clear() {
    captured = nil
  }
}

/**
 The web view that reads its own pasteboard before the page sees a drop.

 `performDragOperation` is the one hook that runs BEFORE WebKit delivers the DOM
 `drop` event — measured, the page's handler observes a value injected here — so
 it is the only place the paths can be recorded in time for the page to ask for
 them.

 **`super` is still called, and its answer is the return value.** The page needs
 the DOM event: it decides WHERE the drop landed (the editor column, the
 composer, a code surface), and the composer attaches files from bytes the
 payload carries. Swallowing the drag here would fix the editor by breaking the
 chat. A drag that carries no path is passed through untouched, which is every
 in-page drag and every promise-only drag.
 */
public final class DropWebView: WKWebView {
  /// The drop in flight, answered once to the page's `dropped_paths` command.
  public let dropPaths = DropPathStore()

  public override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    let paths = droppedPaths(from: sender.draggingPasteboard)
    if paths.isEmpty {
      dropPaths.clear()
    } else {
      dropPaths.capture(paths)
    }
    return super.performDragOperation(sender)
  }

  /// A drag that left without dropping must not leave paths waiting.
  public override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    dropPaths.clear()
    super.draggingExited(sender)
  }
}
