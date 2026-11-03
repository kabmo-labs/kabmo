import Foundation
import KabmoShell

/// `ShellNavigation` against the same table the other shells carry.
///
/// Every case here fails SILENTLY in the app: a page appears somewhere else and
/// nothing is logged. The one a user reported was the first group — the console's
/// own browser panel is an `<iframe>`, and answering a subframe load like a
/// main-frame link sent every typed URL to the system browser instead of the panel.
///
/// Measured in a real `WKWebView`: an iframe navigating cross-origin arrives at
/// `decidePolicyFor` with `targetFrame?.isMainFrame == false`, and a
/// `target="_blank"` click arrives with NO target frame and ALSO reaches
/// `createWebViewWith`.
enum ShellNavigationTests {
  static func run() {
    let server = "http://127.0.0.1:3000"

    Harness.group("ShellNavigation — a frame never leaves")

    Harness.equal(
      "a cross-origin page in an iframe stays",
      ShellNavigation.decide(to: "http://127.0.0.1:5173/", server: server, frame: .subframe),
      .inside
    )
    Harness.equal(
      "a mailto: in an iframe stays, because a frame is not a place to leave from",
      ShellNavigation.decide(to: "mailto:x@y.test", server: server, frame: .subframe),
      .inside
    )
    Harness.equal(
      "a popup is left to createWebViewWith",
      ShellNavigation.decide(to: "https://example.test/", server: server, frame: .newWindow),
      .inside
    )

    Harness.group("ShellNavigation — the main frame")

    Harness.equal(
      "a same-origin route stays, because the console routes itself",
      ShellNavigation.decide(to: "http://127.0.0.1:3000/s/abc", server: server, frame: .main),
      .inside
    )
    Harness.equal(
      "another origin leaves",
      ShellNavigation.decide(to: "https://github.com/kabmo-labs/kabmo", server: server, frame: .main),
      .external
    )
    Harness.equal(
      "another PORT is another origin",
      ShellNavigation.decide(to: "http://127.0.0.1:3001/", server: server, frame: .main),
      .external
    )
    Harness.equal(
      "a scheme with no page behind it leaves",
      ShellNavigation.decide(to: "mailto:someone@example.test", server: server, frame: .main),
      .external
    )
    Harness.equal(
      "a relative reference stays, because the web view resolves it",
      ShellNavigation.decide(to: "/s/abc", server: server, frame: .main),
      .inside
    )
    Harness.equal(
      "about:blank stays, because a popup frame starts there",
      ShellNavigation.decide(to: "about:blank", server: server, frame: .main),
      .inside
    )
    Harness.equal(
      "a shell with no saved server keeps its own first load",
      ShellNavigation.decide(to: "http://kabmo.test/x", server: nil, frame: .main),
      .inside
    )

    Harness.group("ShellNavigation — the origin itself")

    Harness.equal(
      "a default port is spelled without it",
      URLComponents(string: "https://kabmo.test:443/x")?.origin,
      "https://kabmo.test"
    )
    Harness.equal(
      "a host written in another case is the same origin",
      ShellNavigation.decide(to: "http://KABMO.test/x", server: "http://kabmo.test/", frame: .main),
      .inside
    )
    Harness.equal(
      "a non-http scheme has no comparable origin",
      URLComponents(string: "mailto:x@y.test")?.origin,
      nil
    )
  }
}
