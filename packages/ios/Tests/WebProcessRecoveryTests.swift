import Foundation

import KabmoShell

/// What the shell loads after iOS kills the web process.
///
/// Both failure modes are silent: reloading the wrong address puts the user on a
/// page they did not ask for, and recovering into nothing leaves the white window
/// this rule exists to remove.
enum WebProcessRecoveryTests {

  static func run() {
    Harness.group("WebProcessRecovery")

    Harness.equal(
      "the address the page FINISHED on wins",
      WebProcessRecovery.address(shown: "http://127.0.0.1:3000/?sessionId=abc", current: "http://127.0.0.1:3000/login"),
      "http://127.0.0.1:3000/?sessionId=abc"
    )

    Harness.equal(
      "the view's own address is the fallback before any finish",
      WebProcessRecovery.address(shown: nil, current: "https://kabmo.example/"),
      "https://kabmo.example/"
    )

    Harness.equal(
      "an empty latched address does not win over a real one",
      WebProcessRecovery.address(shown: "   ", current: "http://localhost:3000"),
      "http://localhost:3000"
    )

    Harness.check(
      "nothing to go back to answers nil rather than a guess",
      WebProcessRecovery.address(shown: nil, current: nil) == nil
    )

    // A custom scheme would be loaded into a view that then answers nothing: the
    // server origin-checks every socket, so the console would paint and no
    // channel would ever connect.
    Harness.check(
      "a non-http scheme is refused",
      WebProcessRecovery.address(shown: "kabmo://host/x", current: nil) == nil
    )

    Harness.check(
      "an address with no host is refused",
      WebProcessRecovery.address(shown: "http://", current: nil) == nil
    )
  }
}
