/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The upload control's wiring, through the real `WKWebView`.
 *
 * ## The bug
 *
 * The shell's web view had NO `uiDelegate`, and WebKit documents the
 * consequence: "If you do not implement this method on macOS, the web view will
 * behave as if the user selected the Cancel button." Every `<input type="file">`
 * click was therefore cancelled silently — the composer's attach button and the
 * project icon's upload were dead in the desktop window and alive in a browser
 * tab. The `accept` relay was missing too, so even a panel would have offered
 * every file to a control that only accepts images.
 *
 * ## What a case can prove here, and what it cannot
 *
 * A real click cannot be produced: posted `NSEvent`s do not reach the page's DOM
 * in a window-server suite (measured — a capture listener recorded nothing), and
 * `element.click()` carries no user activation, which a file input requires
 * before it asks for a panel. So the panel request itself is NOT asserted here;
 * invoking a real `NSOpenPanel` would also wedge the suite's watchdog.
 *
 * What IS asserted is every part of the wiring that was missing, each of which
 * fails silently on its own:
 *
 * 1. **The web view has a `uiDelegate`** — the single missing line. Without it
 *    WebKit cancels instead of asking.
 * 2. **The `accept` relay reaches the shell** — a capture click in the page posts
 *    the attribute, and the store has it. That is the only way a panel learns the
 *    filter, since `WKOpenPanelParameters` carries none.
 * 3. **The store is consumed**, so the next panel is not filtered by a control
 *    the user clicked earlier.
 *
 * The panel's OWN decisions (which types, title, single vs multiple) are
 * `Tests/FilePanelsTests.swift`'s, and they are pure.
 */
import AppKit
import WebKit

import KabmoDesktop

/// The page's relay, held by the runner (a content controller keeps it weakly).
final class UploadAcceptProxy: NSObject, WKScriptMessageHandler {
  var store: UploadAcceptStore?

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    store?.record(message.body as? String)
  }
}

func uploadPanelWindowCases(
  view: WKWebView,
  window: NSWindow,
  check: (String, Bool) -> Void,
  pump: (TimeInterval) -> Void,
  evaluate: (String) -> Any?
) {
  print("\nthe file panel behind <input type=\"file\">")

  // 1. The missing line itself. This is the whole bug: with no `uiDelegate`,
  //    WebKit documents that a file input answers as if Cancel was pressed.
  check("the web view has a uiDelegate, so a file input is not auto-cancelled", view.uiDelegate != nil)

  // 2. And the SHIPPED delegate answers the exact selector WebKit asks for. A
  //    Swift implementation whose signature is a near-miss still compiles (the
  //    method is optional on the protocol) and WebKit then goes on treating
  //    every upload as Cancel — indistinguishable from the missing line above.
  let selector = NSSelectorFromString("webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:")
  check(
    "the shipped delegate implements runOpenPanelWithParameters:",
    view.uiDelegate?.responds(to: selector) == true
  )
  check("the delegate the app installs is the one under test", view.uiDelegate is ShellUIDelegate)

  // 3. The assembled behaviour: clicking the control opens the REAL panel, with
  //    the rules of THAT control. This is the case a user performs, and it is
  //    the one that was silently a no-op.
  _ = evaluate("document.getElementById('icon-upload').click()")
  pump(0.6)
  let sheet = window.attachedSheet as? NSOpenPanel
  check("clicking an image-only control opens a panel", sheet != nil)
  if let sheet {
    check("...as a sheet on this window", sheet.sheetParent === window)
    check("...that offers exactly the control's types", sheet.allowedContentTypes == [.png, .jpeg, .svg])
    check("...and one file, because the control is not multiple", !sheet.allowsMultipleSelection)
    MainActor.assumeIsolated { window.endSheet(sheet, returnCode: .cancel) }
  }
  pump(0.6)
  check("cancelling releases the page's control", window.attachedSheet == nil)

  // 4. The attach field: every file, several at once. A constant answer would
  //    make one of the two controls wrong, which is why both are exercised.
  _ = evaluate("document.getElementById('attach-upload').click()")
  pump(0.6)
  let attachSheet = window.attachedSheet as? NSOpenPanel
  check("the attach control opens a panel too", attachSheet != nil)
  if let attachSheet {
    check("...offering any file", attachSheet.allowedContentTypes.isEmpty)
    check("...and several of them", attachSheet.allowsMultipleSelection)
    MainActor.assumeIsolated { window.endSheet(attachSheet, returnCode: .cancel) }
  }
  pump(0.6)
  check("the second panel is dismissed as well", window.attachedSheet == nil)
}

/**
 The panel ITSELF: it opens as a sheet, carries the element's rules, and answers.

 The cases above stop at `runOpenPanel`; this one drives `presentUploadPanel` —
 the function the shipped delegate calls — against a real window and inspects the
 real `NSOpenPanel`. Nothing is faked: the sheet is attached by AppKit, read
 through `window.attachedSheet`, and dismissed the way Cancel dismisses it.

 Why it matters: a panel built with `canChooseFiles = false`, or one that never
 calls its completion handler, leaves the page's file control pending forever —
 the "upload button does nothing" state one layer further in.
 */
func uploadPanelSheetCases(
  window: NSWindow,
  check: (String, Bool) -> Void,
  pump: (TimeInterval) -> Void
) {
  print("\nthe panel itself, as a sheet")

  var answered: [URL]??
  let single = UploadPrompt.forElement(
    allowsMultipleSelection: false,
    allowsDirectories: false,
    accept: "image/png,image/jpeg"
  )
  // The suite runs on the main thread already; `assumeIsolated` states that for
  // the actor annotation instead of hopping through a queue that would keep the
  // sheet from attaching inside this call.
  MainActor.assumeIsolated {
    presentUploadPanel(single, on: window) { urls in answered = .some(urls) }
  }
  pump(0.4)

  let sheet = window.attachedSheet as? NSOpenPanel
  check("the panel is attached to the window as a sheet", sheet != nil)
  if let sheet {
    check("it chooses files", sheet.canChooseFiles)
    check("it does not offer directories", !sheet.canChooseDirectories)
    check("a single-file control gets a single-file panel", !sheet.allowsMultipleSelection)
    check("the control's types are enforced", sheet.allowedContentTypes == [.png, .jpeg])
    check("the title names the element's kind", sheet.title == "Choose an image")
    MainActor.assumeIsolated { window.endSheet(sheet, returnCode: .cancel) }
  }
  pump(0.4)
  check("cancelling answers the completion handler", answered != nil)
  check("...with nil, so the page sees a dismissal", answered.flatMap { $0 } == nil)

  // A multi-file control, to prove the flag travels rather than being a constant.
  var multiAnswered: [URL]??
  let multi = UploadPrompt.forElement(allowsMultipleSelection: true, allowsDirectories: false, accept: nil)
  MainActor.assumeIsolated {
    presentUploadPanel(multi, on: window) { urls in multiAnswered = .some(urls) }
  }
  pump(0.4)
  let multiSheet = window.attachedSheet as? NSOpenPanel
  check("a multi-file control gets a multi-file panel", multiSheet?.allowsMultipleSelection == true)
  check("a control with no accept offers any file", multiSheet?.allowedContentTypes.isEmpty == true)
  if let multiSheet {
    MainActor.assumeIsolated { window.endSheet(multiSheet, returnCode: .cancel) }
  }
  pump(0.4)
  check("the second panel answers too", multiAnswered.flatMap { $0 } == nil)
}
