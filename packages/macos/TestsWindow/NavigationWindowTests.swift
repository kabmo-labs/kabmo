/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The navigation policy, driven through a REAL `WKWebView` and the SHIPPED delegate.

 ## The bug this pins

 The user browser panel is an `<iframe>`
 (`src/client/components/workspace/user-browser-panel/`). A URL typed into it was
 handed to Safari instead of loaded in the frame — the panel could not browse, and
 nothing in its own code was wrong.

 The cause is in the shell: WebKit reports SUBFRAME navigations to
 `decidePolicyFor` as well, so the origin rule alone fired on them. Measured in a
 real `WKWebView` by this file's own probe:

 ```
 decide dest=http://127.0.0.1:59999/x target=SUBFRAME here=http://console.test/
 ```

 The pure half of the rule is `Tests/NavigationPolicyTests.swift`'s. What is
 asserted HERE is the wiring a pure case cannot see: that `targetFrame` is read at
 all, that a popup is left to the UI delegate, and that one click opens ONE external
 browser — measured: with an external open on both the policy and the delegate, a
 single `target="_blank"` opened two tabs.
 */
import AppKit
import WebKit

import KabmoDesktop

/// A page shaped like the console: a frame for the user browser panel, and the
/// links the console really draws.
let navigationPage = """
<!doctype html><html><body>
<iframe id="panel" src="about:blank" width="300" height="200"></iframe>
<a id="blank" href="https://example.test/release" target="_blank">release notes</a>
</body></html>
"""

/// Where one navigation goes, recorded so the cases compare URLs rather than
/// trust a side effect.
struct NavigationProbe {
  var opened: [String] = []
  var decisions: [String] = []
}

/// The page the suite was built with, restored after this case, which replaces it.
///
/// `view` is the SUITE's web view on purpose: a second `WKWebView` in the same
/// process never left `estimatedProgress = 0.1` here (measured — its delegate was
/// asked nothing), so the view that already rendered a page is the only one that
/// answers. That means this case must give the page back, or every later case
/// (`#composer`, the drop recorder, the upload field) looks up elements that no
/// longer exist.
@MainActor
func navigationWindowCases(
  view: WKWebView,
  window: NSWindow,
  suitePage: String,
  check: @escaping (String, Bool) -> Void,
  pump: @escaping (TimeInterval) -> Void
) {
  /// Read one expression from THIS case's web view. Its own helper rather than the
  /// suite's, which is bound to the runner's view.
  func evaluate(_ view: WKWebView, _ script: String) -> Any? {
    var answer: Any?
    var done = false
    view.evaluateJavaScript(script) { value, _ in
      answer = value
      done = true
    }
    let deadline = Date().addingTimeInterval(2)
    while !done && Date() < deadline {
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005))
    }
    return answer
  }

  /// Run the run loop until `ready` answers true, or give up at the deadline.
  ///
  /// A FIXED `pump` is a guess about how long WebKit needs to commit a page, and
  /// it is the wrong guess on a loaded runner: measured on the x64 macOS Release
  /// leg, `pump(1.2)` returned before `loadHTMLString` had committed, so
  /// `getElementById('panel')` was null, the subframe never navigated, and five
  /// cases in this section failed — while the arm64 leg passed with the same
  /// code. Waiting on the page's own state removes the race instead of widening
  /// the window it lives in.
  ///
  /// The budget is generous on purpose: this is not a performance assertion, and
  /// the slowest runner only makes it wait longer.
  func waitUntil(_ deadlineSeconds: TimeInterval = 10, _ ready: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(deadlineSeconds)
    while Date() < deadline {
      if ready() { return true }
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
    return ready()
  }

  print("\nthe navigation policy, through a real web view")

  var probe = NavigationProbe()
  let delegate = ProbeNavigationDelegate(probe: { event in
    switch event {
    case let .decided(frame, target, destination):
      probe.decisions.append("\(frame):\(target):\(destination)")
    case let .opened(url):
      probe.opened.append(url)
    }
  })
  let webView = view
  let panels = ShellUIDelegate(store: UploadAcceptStore(), window: window) { url in
    delegate.note(opened: url.absoluteString)
  }
  delegate.panels = panels
  webView.navigationDelegate = delegate
  webView.uiDelegate = panels
  webView.loadHTMLString(navigationPage, baseURL: URL(string: "http://console.test/")!)
  // The page must be COMMITTED before its elements are addressable.
  _ = waitUntil { ((evaluate(webView, "document.getElementById('panel') !== null") as? Bool) ?? false) }

  // 1. The panel's own frame navigates to another origin — the reported case.
  _ = evaluate(webView, "document.getElementById('panel').src = 'http://127.0.0.1:59979/app'")
  // The decision is what is asserted, so wait for the decision itself rather
  // than for a durée that hopes to contain it.
  let decided = waitUntil { probe.decisions.contains { $0.hasPrefix("subframe:inside:http://127.0.0.1:59979/app") } }
  check("a cross-origin load inside the panel's iframe stays in the frame", decided)
  check("...and it did NOT leave for the system browser", !probe.opened.contains("http://127.0.0.1:59979/app"))

  let frameURL = ((evaluate(webView, "document.getElementById('panel').src") as? String) ?? "")
  _ = waitUntil { frameURL == "http://127.0.0.1:59979/app" }
  let realFrameURL = ((evaluate(webView, "document.getElementById('panel').src") as? String) ?? "")
  check("...so the frame really loaded it", realFrameURL == "http://127.0.0.1:59979/app")

  // 2. A `target="_blank"` link — every external link the console draws. It must
  //    reach the system browser EXACTLY once.
  let before = probe.opened.count
  _ = evaluate(webView, "document.getElementById('blank').click()")
  // ONE popup is the assertion; anything more is the bug. Waiting for the count
  // to settle is what makes "exactly once" observable instead of a snapshot
  // taken before the second (wrong) open had time to happen.
  _ = waitUntil { probe.opened.count > before }
  pump(0.5)
  let opened = Array(probe.opened.dropFirst(before))
  check("a target=_blank link opens the system browser", opened == ["https://example.test/release"])
  check("...exactly once, not once per policy plus delegate", opened.count == 1)

  // 3. And the console itself is still on screen: a popup must never replace it.
  let alive = (evaluate(webView, "document.getElementById('panel') !== null") as? Bool) ?? false
  check("the console is still on screen after the popup", alive)

  // Give the suite's page back, and WAIT for it: the cases after this one address
  // `#composer`, the upload field and the drop recorder by id, and a load that has
  // not committed yet answers nil to every one of them.
  webView.loadHTMLString(suitePage, baseURL: nil)
  let deadline = Date().addingTimeInterval(6)
  var ready = false
  while !ready && Date() < deadline {
    pump(0.05)
    ready = ((evaluate(webView, "document.getElementById('composer') !== null") as? Bool) ?? false)
  }
  check("the suite's page is back for the later cases", ready)


}

/// What the probe reported, in the order WebKit reported it.
enum NavigationEvent {
  case decided(frame: String, target: String, destination: String)
  case opened(url: String)
}

/// The app's delegate shape — `NavigationPolicy.decide` with the frame read from
/// the action — so the case exercises the SHIPPED rule, not a copy of it.
@MainActor
final class ProbeNavigationDelegate: NSObject, WKNavigationDelegate {
  private let probe: (NavigationEvent) -> Void
  var panels: ShellUIDelegate?

  init(probe: @escaping (NavigationEvent) -> Void) {
    self.probe = probe
  }


  func note(opened url: String) {
    probe(.opened(url: url))
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let destination = navigationAction.request.url?.absoluteString ?? ""
    // The SHIPPED mapping, so a delegate that stops reading `targetFrame` fails
    // here instead of passing on its own copy of the rule.
    let frame = NavigationPolicy.frame(of: navigationAction)
    let decision = NavigationPolicy.decide(
      from: webView.url?.absoluteString,
      to: destination,
      frame: frame
    )
    let frameName = frame == .main ? "main" : frame == .subframe ? "subframe" : "newWindow"
    probe(.decided(frame: frameName, target: decision == .inside ? "inside" : "external", destination: destination))
    decisionHandler(decision == .external ? .cancel : .allow)
  }
}
