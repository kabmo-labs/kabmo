/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the shell loads after the OS kills the web process.
 *
 * Both failure modes are silent, which is why this rule is tested rather than
 * trusted: reloading the wrong address puts the user on a page they did not ask
 * for, and recovering into nothing leaves the white window the rule exists to
 * remove. Measured on this shell with the release build: `kill -9` on
 * `com.apple.WebKit.WebContent` left the window blank until the app was quit.
 */

import Foundation

import KabmoDesktop

enum WebProcessRecoveryTests {
  static func run() {
    print("WebProcessRecovery")

    let cases: [(String, String?, String?, String?)] = [
      ("the address the page FINISHED on wins",
       "http://127.0.0.1:3000/?sessionId=abc", "http://127.0.0.1:3000/login",
       "http://127.0.0.1:3000/?sessionId=abc"),
      ("the view's own address is the fallback before any finish",
       nil, "https://kabmo.example/", "https://kabmo.example/"),
      ("an empty latched address does not win over a real one",
       "   ", "http://localhost:3000", "http://localhost:3000"),
      ("nothing to go back to answers nil rather than a guess",
       nil, nil, nil),
      // A custom scheme would load into a view that then answers nothing: the
      // server origin-checks every socket, so the console would paint and no
      // channel would ever connect.
      ("a non-http scheme is refused", "kabmo://host/x", nil, nil),
      ("an address with no host is refused", "http://", nil, nil),
    ]

    for (label, shown, current, expected) in cases {
      check(label, WebProcessRecovery.address(shown: shown, current: current) == expected)
    }
  }
}
