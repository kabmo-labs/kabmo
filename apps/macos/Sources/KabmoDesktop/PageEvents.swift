/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The page's own commands that a native menu row can only ASK for.

 The console owns every modal it draws, so "Settings…" in the menu bar is not a
 panel the shell can build: it is a request to the page. The client listens for
 exactly one shape — `omp:open-settings` on `window`, carrying an optional
 `{ category, autoOpenAdd }` detail — and BOTH of its layouts handle it
 (`useSettingsModal` on the desktop, `LayoutWrapper` on the phone), which is what
 makes one event enough.

 **This replaced a `?settings=1` reload, which could never have worked.** The
 macOS menu appended that query parameter and loaded the URL again; nothing on
 the client reads it, so the row changed nothing on screen while throwing the
 whole page away — a live run, the composer draft and the scroll position with
 it. The Linux shell had already sent the event, so the contract was known and
 this shell simply was not using it.

 It lives in the library rather than in `App.swift` so the window suite dispatches
 the SAME script the menu row does. A suite that restated the string would pass
 while the shipped row asked for something else, which is the shape of the bug
 above.
 */
import WebKit

/// The event name the console listens for, stated once.
public let openSettingsEvent = "omp:open-settings"

/**
 Ask the page to open its own Settings modal.

 The script DISPATCHES and answers whether a document existed, so a caller with
 no run loop of its own can still see the outcome.

 **The load window is a known limit, stated rather than papered over.** A document
 exists as soon as parsing starts, but the console's listener is registered by the
 client bundle, so a press during the splash dispatches into a page that is not
 listening yet and the modal does not open. There is deliberately no queue for it:
 a request replayed on `didFinish` would open a modal seconds after the press,
 which is worse than a row that does nothing while the splash says "Loading the
 console…". A failed load has no listener either, and its reason is already on
 screen.
 */
public let openSettingsScript = """
(() => {
  if (!document.documentElement) return false;
  window.dispatchEvent(new CustomEvent('\(openSettingsEvent)', { detail: {} }));
  return true;
})()
"""

/// Dispatch `openSettingsScript` into `webView`.
public func openSettings(in webView: WKWebView, completion: ((Bool) -> Void)? = nil) {
  webView.evaluateJavaScript(openSettingsScript) { value, _ in
    completion?((value as? Bool) ?? false)
  }
}

/// The event the console listens for when the menu asks for an update check.
public let checkUpdatesEvent = "omp:update-check"

/**
 Ask the console to check for updates.

 The check and its verdict live in `useUpdates` on whichever sidebar is mounted,
 so the shell cannot run it: a second copy of the request would be a second
 source of truth for the same state. One event, one owner — the same shape as
 `openSettingsScript`, and with the same load-window limit (a press during the
 splash has no listener yet).
 */
public let checkUpdatesScript = """
(() => {
  if (!document.documentElement) return false;
  window.dispatchEvent(new CustomEvent('\(checkUpdatesEvent)'));
  return true;
})()
"""

/// Dispatch `checkUpdatesScript` into `webView`.
public func requestUpdateCheck(in webView: WKWebView, completion: ((Bool) -> Void)? = nil) {
  webView.evaluateJavaScript(checkUpdatesScript) { value, _ in
    completion?((value as? Bool) ?? false)
  }
}

/**
 The script a menu row runs for one catalog command.

 The row carries NO key equivalent (see `MenuBar.swift`): the page's dispatcher
 owns every chord and the user's overrides, and the shell only reports the click
 through `window.__kabmoRunCommand`. A page that has not installed the property
 answers `undefined`, which the row treats as "not ready" rather than an error.
 */
public func runCommandScript(_ id: String) -> String {
  "window.__kabmoRunCommand ? window.__kabmoRunCommand(\(javaScriptString(id))) : false"
}

/// Dispatch `runCommandScript(id)` into `webView`.
public func runCommand(_ id: String, in webView: WKWebView, completion: ((Bool) -> Void)? = nil) {
  webView.evaluateJavaScript(runCommandScript(id)) { value, _ in
    completion?((value as? Bool) ?? false)
  }
}

/**
 A single-quoted JavaScript string literal.

 The ids this carries are catalog names, but a caller is allowed to hand it
 anything — and an unescaped quote is a syntax error that leaves the row silent.
 */
private func javaScriptString(_ value: String) -> String {
  var escaped = ""
  for character in value {
    switch character {
    case "\\": escaped += "\\\\"
    case "'": escaped += "\\'"
    case "\n": escaped += "\\n"
    case "\r": escaped += "\\r"
    case "\u{2028}": escaped += "\\u2028"
    case "\u{2029}": escaped += "\\u2029"
    default: escaped.append(character)
    }
  }
  return "'\(escaped)'"
}
