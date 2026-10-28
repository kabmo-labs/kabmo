/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A file the OS handed the shell, delivered into the real web view.
 *
 * The bug class this pins is the one no other layer can see: the shell builds a
 * JavaScript call by hand (`openPathsScript`), and every way it can go wrong is
 * SILENT. A wrong property name, a path that broke the string, a call evaluated
 * before the page defined its handler — each leaves a console that simply never
 * opens the document the user double-clicked, with nothing logged anywhere.
 *
 * So the cases run against the SUITE's own web view, the app's real
 * `DropWebView`, and assert what the PAGE received rather than what the script
 * says. A string comparison on the script would pass with the property misspelt
 * on both sides.
 */

import AppKit
import WebKit

import KabmoDesktop

/// Records what `window.__kabmoOpenPaths` was called with.
///
/// Installed by the case itself, not by the suite's page: the property only
/// exists once `src/client/lib/native/open-paths.ts` has run, which a test page
/// does not load — and the point is the CALL, not the console's handler.
private let openPathsRecorder = """
window.__openPathCalls = [];
window.__kabmoOpenPaths = (paths) => { window.__openPathCalls.push(paths); };
'ok'
"""

func openPathsWindowCases(
  view: WKWebView,
  check: (String, Bool) -> Void,
  pump: (TimeInterval) -> Void,
  evaluate: (String) -> Any?
) {
  print("\na file the OS handed over, delivered to the page")

  // The suite's page may be mid-load when this runs, so the recorder is
  // installed through `evaluate` (which pumps the run loop) and then READ BACK:
  // an install that silently failed would make every case below vacuous.
  _ = evaluate(openPathsRecorder)
  let installed = evaluate("typeof window.__kabmoOpenPaths") as? String ?? "missing"
  check("the recorder installs on the page", installed == "function")

  // The paths a double-click in Finder produces, including the characters a
  // hand-built string would break on: a quote and a backslash are both ordinary
  // in a filename.
  let paths = ["/Users/x/Desktop/Quarterly Report.pdf", "/Users/x/Desktop/quote\"and\\back.md"]
  view.evaluateJavaScript(openPathsScript(paths), completionHandler: nil)
  pump(0.4)

  let count = evaluate("window.__openPathCalls.length") as? Int ?? -1
  check("the page's handler was called once", count == 1)

  // Compared as DECODED values, not as JSON text: the two encoders are free to
  // spell `/` and a quote differently (`\/` is legal and identical to the page),
  // and a text comparison would fail on a correct script.
  let roundTrip = evaluate("JSON.stringify(window.__openPathCalls[0] || null)") as? String ?? "null"
  let decoded = roundTrip.data(using: .utf8)
    .flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String]
  check("the paths survive as values, quotes and backslashes included", decoded == paths)

  // A page that never loaded has no handler. `evaluateJavaScript` must not
  // throw or wedge the shell — the queue keeps the paths for the next load, so
  // the call is simply inert here.
  let before = evaluate("window.__openPathCalls.length") as? Int ?? -1
  _ = evaluate("window.__kabmoOpenPaths = undefined; 'cleared'")
  view.evaluateJavaScript(openPathsScript(["/Users/x/Desktop/late.pdf"]), completionHandler: nil)
  pump(0.3)
  let after = evaluate("typeof window.__kabmoOpenPaths === 'undefined' ? -1 : window.__openPathCalls.length") as? Int ?? -2
  check("a page with no handler is left alone rather than throwing", after == -1 || after == before)
}
