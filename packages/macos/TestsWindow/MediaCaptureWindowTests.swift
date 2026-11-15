/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The capture permission the shell's `WKUIDelegate` has to answer.
 *
 * ## The bug
 *
 * `getUserMedia` in a `WKWebView` asks the UI delegate first, and WebKit's
 * documented default when the method is not implemented is `.prompt` — a prompt
 * this shell has no UI for, so the request never resolves and the composer's mic
 * button looks dead. The iOS shell answered it from the start; the macOS one did
 * not, and nothing said so: the page's own `isSupported` check passes (the API
 * exists), the click runs, and only the promise hangs.
 *
 * ## What a case can prove here
 *
 * A real capture request cannot be produced in this suite: it needs a user
 * gesture, a secure origin and a TCC grant, and the runner is an accessory app
 * with no microphone entitlement. What IS asserted is the wiring that fails
 * silently on its own — the shipped delegate answers the exact selector WebKit
 * asks for. A near-miss Swift signature still compiles (the method is optional
 * on the protocol) and WebKit then keeps using `.prompt`, which is
 * indistinguishable from the missing method.
 */
import AppKit
import WebKit

import KabmoDesktop

func mediaCaptureWindowCases(
  view: WKWebView,
  check: (String, Bool) -> Void
) {
  print("\nthe capture permission behind getUserMedia")

  check("the web view has a uiDelegate, so a capture request is answered", view.uiDelegate != nil)
  check("the delegate the app installs is the one under test", view.uiDelegate is ShellUIDelegate)

  // The selector WebKit sends. `requestMediaCapturePermissionFor` is the Swift
  // name; the Objective-C selector is what `responds(to:)` can ask about.
  let selector = NSSelectorFromString(
    "webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:"
  )
  check(
    "the shipped delegate implements requestMediaCapturePermissionFor",
    view.uiDelegate?.responds(to: selector) == true
  )
}
