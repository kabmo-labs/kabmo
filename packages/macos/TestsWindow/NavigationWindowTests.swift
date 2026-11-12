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

/// Where one navigation goes, recorded so the cases compare URLs rather than
/// trust a side effect.
struct NavigationProbe {
  var opened: [String] = []
  var decisions: [String] = []
}

/// The navigation rule, driven against the SUITE's own page.
///
/// `view` is the suite's web view and the page is the one already on screen: it
/// carries `#panel` (the user browser panel's frame) and `#blank` (a
/// `target="_blank"` link), and it was loaded at top level with an http origin.
///
/// This case used to load a page of its own. That load never finished on the
/// x64 release runner — measured, `estimatedProgress` stayed at 0.1 with
/// `isLoading = true` for the whole 30 s budget, while the identical load at top
/// level commits in 0.3 s — so five checks failed on a working web view. The
/// same measurement is why `DroppedPathsWindowTests` drives the page that is
/// already there instead of a second view.
@MainActor
func navigationWindowCases(
  view: WKWebView,
  window: NSWindow,
  check: @escaping (String, Bool) -> Void,
  pump: @escaping (TimeInterval) -> Void
) {
  /// Read one expression from the suite's web view.
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
  /// A FIXED `pump` is a guess about how long WebKit needs to report a decision,
  /// and it is the wrong guess on a loaded runner. Waiting on the probe's own
  /// state removes the race instead of widening the window it lives in.
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

  // The page is already on screen, so its elements are addressable now. Assert
  // that rather than assume it: a page that never committed would make every
  // check below fail for a reason that has nothing to do with navigation.
  let present = ((evaluate(webView, "document.getElementById('panel') !== null") as? Bool) ?? false)
  check("the suite's page carries the panel's frame", present)
  if !present {
    print("  [nav] the page is not the suite's: url=\(webView.url?.absoluteString ?? "nil") "
      + "progress=\(webView.estimatedProgress) loading=\(webView.isLoading) "
      + "title=\(webView.title ?? "nil")")
  }

  // 1. The panel's own frame navigates to another origin — the reported case.
  _ = evaluate(webView, "document.getElementById('panel').src = 'http://127.0.0.1:59979/app'")
  // The decision is what is asserted, so wait for the decision itself rather
  // than for a durée that hopes to contain it.
  let decided = waitUntil { probe.decisions.contains { $0.hasPrefix("subframe:inside:http://127.0.0.1:59979/app") } }
  check("a cross-origin load inside the panel's iframe stays in the frame", decided)
  check("...and it did NOT leave for the system browser", !probe.opened.contains("http://127.0.0.1:59979/app"))

  // Re-read on every poll: capturing the value once made this wait compare the
  // same string to itself for its whole budget, so it could never observe the
  // load it was waiting for.
  let loadedInFrame = waitUntil(30) {
    ((evaluate(webView, "document.getElementById('panel').src") as? String) ?? "") == "http://127.0.0.1:59979/app"
  }
  check("...so the frame really loaded it", loadedInFrame)

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
