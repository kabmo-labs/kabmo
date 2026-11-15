import Foundation
import KabmoShell

/// The pasted pairing link.
///
/// The refusals are the point: a link to some other page on the same server would
/// load a page that never sets a cookie, and the user would be left on a console
/// that still asks for a password. The deep link is refused on purpose — its origin
/// lives inside the encoded payload, which this deliberately does not decode.
///
/// The same cases exist in `packages/android`'s `PairingLinkTest`.
enum PairingLinkTests {
  static func run() {
    Harness.group("PairingLink — accepted")

    Harness.equal(
      "an https pairing link yields its origin",
      PairingLink.origin(of: "https://laptop.tailnet.ts.net/pair#eyJ2IjoxfQ"),
      "https://laptop.tailnet.ts.net"
    )
    Harness.equal(
      "a non-default port is kept",
      PairingLink.origin(of: "http://192.168.18.79:3000/pair#abc"),
      "http://192.168.18.79:3000"
    )
    Harness.equal(
      "a trailing slash on the path is tolerated",
      PairingLink.origin(of: "https://kabmo.example.com/pair/#abc"),
      "https://kabmo.example.com"
    )

    Harness.group("PairingLink — refused")

    Harness.check(
      "a page that is not the pairing page is refused",
      PairingLink.origin(of: "https://kabmo.example.com/settings#abc") == nil
    )
    Harness.check(
      "the bare origin is refused",
      PairingLink.origin(of: "https://kabmo.example.com/") == nil
    )
    Harness.check(
      "the deep link is refused because its origin is inside the payload",
      PairingLink.origin(of: "kabmo://connect?v=1&p=eyJ2IjoxfQ") == nil
    )
    Harness.check("an empty string is refused", PairingLink.origin(of: "") == nil)
    Harness.check("whitespace is refused", PairingLink.origin(of: "   ") == nil)
    Harness.check("a non-http scheme is refused", PairingLink.origin(of: "ftp://host/pair#x") == nil)

    Harness.group("PairingLink — the hint agrees with the parser")
    Harness.check("a pairing link looks like one", PairingLink.looksLikePairingLink("https://host/pair#x"))
    Harness.check("another page does not", PairingLink.looksLikePairingLink("https://host/other#x") == false)
  }
}
