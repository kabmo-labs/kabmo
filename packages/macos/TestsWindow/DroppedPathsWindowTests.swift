/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A drag onto the real web view, and what the page gets from it.
 *
 * The bug this pins was invisible from every other layer: a Finder drop onto a
 * `WKWebView` gives the page BYTES and no path, and WebKit implements no
 * `getAsFileSystemHandle`, so the editor's two open routes were both dead. The
 * drop still arrived — the composer attached it — which is why nothing looked
 * broken until a user tried to OPEN a dropped file.
 *
 * Measured against a real `WKWebView` on macOS 27 with a synthesized Finder
 * pasteboard: `types ["Files"]`, `files [File]`, `getData('text/uri-list')` and
 * `getData('text/plain')` both empty, `File.path` undefined,
 * `DataTransferItem.getAsFileSystemHandle` undefined.
 *
 * The cases run against the SUITE's own web view, which is the app's
 * `DropWebView`. A second view loading its own page never finishes inside this
 * suite — measured, the load sits in `didStartProvisionalNavigation` for the
 * whole budget while the identical code at top level loads in 0.3s — so the
 * drop is delivered into the page that is already on screen. That page carries
 * the drop recorder below.
 */

import AppKit
import WebKit

import KabmoDesktop

/// The drop recorder, appended to the suite's page. A drop must still ARRIVE
/// after the shell reads the pasteboard: `super` is what delivers it, and the
/// composer depends on that event.
public let dropRecorderScript = """
<script>
  window.__drops = [];
  // `dragover` must be cancelled or the drop is REFUSED and WebKit navigates the
  // frame to the file instead — which is what the app's own handlers do, and
  // what a page that forgot it would do (measured: the suite's delegate saw
  // "Frame load interrupted", the navigation to a file it may not read).
  for (const type of ['dragenter', 'dragover']) {
    window.addEventListener(type, (e) => e.preventDefault(), true);
  }
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    window.__drops.push({
      files: Array.from(e.dataTransfer?.files || []).map((f) => f.name),
      // What the page would have used before the shell helped: both are empty
      // on a Finder drag, which is why the shell's answer is needed at all.
      uriList: e.dataTransfer?.getData('text/uri-list') || '',
    });
  }, true);
</script>
"""

/// A synthetic drag, which AppKit does not let a test perform from another
/// process. The pasteboard is real; only the pointer is not.
final class FakeDrag: NSObject, NSDraggingInfo {
  let pasteboard: NSPasteboard
  init(_ pasteboard: NSPasteboard) { self.pasteboard = pasteboard }

  var draggingDestinationWindow: NSWindow? { nil }
  var draggingSourceOperationMask: NSDragOperation { .copy }
  var draggingLocation: NSPoint { NSPoint(x: 60, y: 60) }
  var draggedImageLocation: NSPoint { NSPoint(x: 60, y: 60) }
  var draggedImage: NSImage? { nil }
  var draggingPasteboard: NSPasteboard { pasteboard }
  var draggingSource: Any? { nil }
  var draggingSequenceNumber: Int { 1 }
  func slideDraggedImage(to screenPoint: NSPoint) {}
  var draggingFormation: NSDraggingFormation = .default
  var animatesToDestination: Bool = false
  var numberOfValidItemsForDrop: Int = 1
  var springLoadingHighlight: NSSpringLoadingHighlight { .none }
  func enumerateDraggingItems(
    options enumOpts: NSDraggingItemEnumerationOptions,
    for view: NSView?,
    classes classArray: [AnyClass],
    searchOptions: [NSPasteboard.ReadingOptionKey: Any],
    using block: (NSDraggingItem, Int, UnsafeMutablePointer<ObjCBool>) -> Void
  ) {}
  func resetSpringLoading() {}
}

/// A pasteboard with the legacy filename list, which Finder writes.
func filenamesPasteboard(_ paths: [String]) -> NSPasteboard {
  let board = NSPasteboard(name: NSPasteboard.Name("kabmo-window-\(UUID().uuidString)"))
  board.clearContents()
  board.declareTypes([NSPasteboard.PasteboardType("NSFilenamesPboardType")], owner: nil)
  board.setPropertyList(paths, forType: NSPasteboard.PasteboardType("NSFilenamesPboardType"))
  return board
}

/**
 Deliver a Finder drag into the suite's real `DropWebView` and report what each
 side saw.

 Runs the app's own path: `performDragOperation` reads the pasteboard and then
 calls `super`, which is what delivers the DOM event. A view that swallowed the
 drag to fix the editor would break the composer, so both halves are asserted.
 */
func dropPathCases(
  view: DropWebView,
  check: (String, Bool) -> Void,
  pump: (TimeInterval) -> Void,
  evaluate: (String) -> Any?
) {
  print("\na Finder drop on the real web view")

  let target = NSTemporaryDirectory() + "kabmo-dropped-file.ts"
  try? "export const dropped = true;\n".write(toFile: target, atomically: true, encoding: .utf8)

  let drag = FakeDrag(filenamesPasteboard([target]))
  _ = view.draggingEntered(drag)
  let performed = view.performDragOperation(drag)
  pump(0.6)

  check("the view handled the drag", performed)

  // The DOM event still arrives: `super` was called, so a drop the editor does
  // not claim (the composer, an in-page drag) behaves exactly as before.
  let recorded = evaluate("JSON.stringify(window.__drops)") as? String ?? "[]"
  let data = recorded.data(using: .utf8) ?? Data()
  let drops = (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
  check("the drop reached the page", drops.count == 1)
  check("…as bytes, which is all WebKit offers", (drops.first?["files"] as? [String])?.count == 1)
  // The measurement the shell exists for: the page has no path of its own.
  check("…and no URI list to resolve", (drops.first?["uriList"] as? String) == "")

  // The shell's half: the paths the page could not see, answered ONCE.
  let captured = view.dropPaths.take()
  let expected = URL(fileURLWithPath: target).standardizedFileURL.path
  check("the shell captured the dropped path", captured?.paths == [expected])
  check("…with a timestamp the page can age-check", (captured?.at ?? 0) > 0)
  check("…and the second ask answers nothing", view.dropPaths.take() == nil)

  // A drag that leaves without dropping must not leave paths waiting: the next
  // gesture would otherwise open the file this one abandoned.
  view.dropPaths.capture([target])
  view.draggingExited(nil)
  check("a drag that leaves clears the capture", view.dropPaths.take() == nil)
}
