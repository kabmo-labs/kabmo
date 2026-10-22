import Foundation
import KabmoShell

/// `URLNormalizer` against the same rules `packages/android`'s `UrlNormalizerTest`
/// pins.
///
/// The two shells must accept and refuse the SAME addresses: a URL one shell saves
/// and the other rejects is two products. Each refusal below is a way a typed
/// address looks fine and breaks the console — a base path sends `/api/health` to
/// the wrong route, a query string is not an origin, a bad port fails at connect
/// time with a message about the network.
enum URLNormalizerTests {
  static func run() {
    Harness.group("URLNormalizer — accepted addresses")

    Harness.equal(
      "a bare host:port defaults to http",
      URLNormalizer.normalize("192.168.1.20:3000").url,
      "http://192.168.1.20:3000"
    )
    Harness.equal(
      "a full https address is kept",
      URLNormalizer.normalize("https://kabmo.example.com").url,
      "https://kabmo.example.com"
    )
    Harness.equal(
      "a trailing slash is the root and is dropped",
      URLNormalizer.normalize("http://192.168.1.20:3000/").url,
      "http://192.168.1.20:3000"
    )
    Harness.equal(
      "surrounding whitespace is trimmed",
      URLNormalizer.normalize("  http://192.168.1.20:3000  ").url,
      "http://192.168.1.20:3000"
    )
    // The scheme is lowercased; the HOST keeps the case it was typed with, because
    // that is the address the shell loads and the one the user recognises — and
    // because `packages/android` does the same, so both shells save the same string.
    // Host case is not a difference in origin: `sameOrigin` and
    // `ShellWebView.origin` compare case-insensitively.
    Harness.equal(
      "the scheme is lowercased and the host kept",
      URLNormalizer.normalize("HTTP://Host.Example:3000").url,
      "http://Host.Example:3000"
    )
    Harness.equal(
      "an IPv6 literal keeps its brackets",
      URLNormalizer.normalize("http://[::1]:3000").url,
      "http://[::1]:3000"
    )

    Harness.group("URLNormalizer — refusals")

    Harness.equal("empty input", URLNormalizer.normalize("   ").problem, .empty)
    Harness.equal("a non-http scheme", URLNormalizer.normalize("ftp://host:3000").problem, .scheme)
    Harness.equal("a base path", URLNormalizer.normalize("http://host:3000/kabmo").problem, .path)
    Harness.equal("a query string", URLNormalizer.normalize("http://host:3000?x=1").problem, .shape)
    Harness.equal("a fragment", URLNormalizer.normalize("http://host:3000#x").problem, .shape)
    Harness.equal("a missing host", URLNormalizer.normalize("http://").problem, .shape)
    Harness.equal("a port outside the range", URLNormalizer.normalize("http://host:99999").problem, .shape)

    Harness.group("URLNormalizer — same origin")

    Harness.check(
      "the same address in different case is the same server",
      URLNormalizer.sameOrigin("http://Host.Example:3000", "http://host.example:3000")
    )
    Harness.check(
      "a trailing slash does not make it a different server",
      URLNormalizer.sameOrigin("http://host:3000/", "http://host:3000")
    )
    Harness.check(
      "another port is a different server",
      !URLNormalizer.sameOrigin("http://host:3000", "http://host:3001")
    )
    Harness.check(
      "another host is a different server",
      !URLNormalizer.sameOrigin("http://a.example:3000", "http://b.example:3000")
    )
    Harness.check("no saved address is never the same", !URLNormalizer.sameOrigin(nil, "http://host:3000"))
    Harness.check("a blank saved address is never the same", !URLNormalizer.sameOrigin("  ", "http://host:3000"))
  }
}
