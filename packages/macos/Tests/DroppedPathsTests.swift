/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The drop path, which is the only route a WebKit webview has to a file's PATH.
 *
 * Measured on macOS 27, delivering a real Finder pasteboard into a `WKWebView`:
 *
 *     drop: types ["Files"], files [File]
 *           getData('text/uri-list') ''   getData('text/plain') ''
 *           File.path undefined
 *           DataTransferItem.getAsFileSystemHandle undefined
 *
 * Both of the page's own routes are therefore dead on this shell: there is no
 * handle to open (WebKit implements no File System Access API) and no URI list
 * to resolve. A file dropped on the editor was refused with "that drop carried
 * no readable file" while the same drop attached fine in the composer, which
 * only needs the bytes.
 *
 * The shell reads its own pasteboard. These cases pin what it reads and the one
 * rule that keeps a capture from outliving its gesture.
 */

import AppKit
import Foundation

import KabmoDesktop

/// A pasteboard with the legacy filename list, which every file manager writes.
private func filenamesPasteboard(_ paths: [String]) -> NSPasteboard {
  let board = NSPasteboard(name: NSPasteboard.Name("kabmo-test-\(UUID().uuidString)"))
  board.clearContents()
  board.declareTypes([NSPasteboard.PasteboardType("NSFilenamesPboardType")], owner: nil)
  board.setPropertyList(paths, forType: NSPasteboard.PasteboardType("NSFilenamesPboardType"))
  return board
}

/// A pasteboard carrying only file URLs — the modern shape, and what a drag from
/// an app that writes no legacy list looks like.
private func fileUrlPasteboard(_ paths: [String]) -> NSPasteboard {
  let board = NSPasteboard(name: NSPasteboard.Name("kabmo-test-\(UUID().uuidString)"))
  board.clearContents()
  board.writeObjects(paths.map { URL(fileURLWithPath: $0) as NSURL })
  return board
}

func droppedPathsCases() {
  print("\nthe paths a drop carries")

  let tmp = NSTemporaryDirectory()
  let first = tmp + "kabmo-drop-a.ts"
  let second = tmp + "kabmo-drop-b.ts"

  // The legacy list answers in the drop's own order.
  let legacy = droppedPaths(from: filenamesPasteboard([first, second]))
  check("a filename list is read", legacy.count == 2)
  check("…in the order the drag carried",
        legacy.first?.hasSuffix("kabmo-drop-a.ts") == true)
  check("…as absolute paths", legacy.allSatisfy { $0.hasPrefix("/") })

  // The modern shape is the fallback for a drag with no legacy list.
  let modern = droppedPaths(from: fileUrlPasteboard([second]))
  check("a file URL is read", modern.count == 1)
  check("…and resolves to its path", modern.first?.hasSuffix("kabmo-drop-b.ts") == true)

  // Both spellings of one file must not open two tabs.
  let both = NSPasteboard(name: NSPasteboard.Name("kabmo-test-\(UUID().uuidString)"))
  both.clearContents()
  both.declareTypes(
    [NSPasteboard.PasteboardType("NSFilenamesPboardType"), .fileURL],
    owner: nil
  )
  both.setPropertyList([first], forType: NSPasteboard.PasteboardType("NSFilenamesPboardType"))
  both.setString(URL(fileURLWithPath: first).absoluteString, forType: .fileURL)
  check("one file in two spellings is one path", droppedPaths(from: both).count == 1)

  // A drag with neither shape has no path to offer — an in-page drag, or a
  // promise-only drag. Empty is the honest answer, not a guess.
  let empty = NSPasteboard(name: NSPasteboard.Name("kabmo-test-\(UUID().uuidString)"))
  empty.clearContents()
  empty.declareTypes([.string], owner: nil)
  empty.setString("plain text", forType: .string)
  check("a text drag carries no path", droppedPaths(from: empty).isEmpty)

  print("\nthe drop capture is answered once")

  let store = DropPathStore()
  check("nothing captured answers nothing", store.take() == nil)

  store.capture([first])
  let answer = store.take()
  check("a captured drop answers its paths", answer?.paths.count == 1)
  check("…with a timestamp the page can age-check", (answer?.at ?? 0) > 0)
  // The second ask is the whole point: a value left behind would reopen the
  // previous file on the next drop, including a drag released over no target.
  check("…and the second ask answers nothing", store.take() == nil)

  store.capture([first])
  store.clear()
  check("a drag that left without dropping leaves nothing", store.take() == nil)

  // An empty capture is not an answer: it must not report a drop of no files as
  // a drop of the previous ones.
  store.capture([])
  check("a capture with no paths answers nothing", store.take() == nil)
}
