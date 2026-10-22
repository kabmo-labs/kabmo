import Foundation
import KabmoShell

/// The health probe, and the UA token.
///
/// Both are contracts with the SERVER, so both are pinned against the shape the
/// server actually produces: `GET /api/health`'s payload, and the
/// `src/shared/lib/updates/shell-ua.ts` prefix the console parses. A probe that
/// accepted any 2xx would save the address of an unrelated web server; a token with
/// the wrong prefix would make the console treat this shell as a browser.
enum HealthProbeTests {
  static func run() {
    Harness.group("HealthProbe — parsing")

    let healthy = Data(#"{"service":"kabmo","version":"1.2.3","port":3000,"authEnabled":true,"mock":false}"#.utf8)
    let ok = HealthProbe.parse(status: 200, body: healthy)
    Harness.check("a real payload is accepted", ok.ok)
    Harness.equal("…with its version", ok.version, "1.2.3")
    Harness.equal("…its port", ok.port, 3000)
    Harness.check("…and its auth flag", ok.authEnabled)
    Harness.check("…and its demo flag", !ok.mock)

    // The check is not "something responded" but "a KABMO responded": this is what
    // stops the shell from saving an address that points at another web server and
    // then showing an unrelated page.
    let other = Data(#"{"service":"nginx","version":"1.25"}"#.utf8)
    Harness.equal("another product on the port", HealthProbe.parse(status: 200, body: other).problem, .notKabmo)

    Harness.equal("a non-2xx status", HealthProbe.parse(status: 404, body: healthy).problem, .status)
    Harness.equal("a 401 (the health route is public)", HealthProbe.parse(status: 401, body: healthy).problem, .status)
    Harness.equal("a body that is not JSON", HealthProbe.parse(status: 200, body: Data("<html>".utf8)).problem, .notKabmo)
    Harness.equal("an empty body", HealthProbe.parse(status: 200, body: Data()).problem, .notKabmo)

    // A missing version is not a failure: the route reports it when the build has
    // none, and the screen prints "?" for it.
    let noVersion = Data(#"{"service":"kabmo","port":3000}"#.utf8)
    Harness.check("a payload without a version is still a Kabmo", HealthProbe.parse(status: 200, body: noVersion).ok)
    Harness.equal("…and its version is nil", HealthProbe.parse(status: 200, body: noVersion).version, nil)

    Harness.check(
      "isKabmo agrees with parse",
      HealthProbe.isKabmo(status: 200, body: healthy) && !HealthProbe.isKabmo(status: 200, body: other)
    )

    Harness.group("ShellUserAgent — the token")

    // The prefix is the contract with `src/shared/lib/updates/shell-ua.ts`; a change
    // on one side only makes the console read this shell as a browser.
    Harness.equal("the token names this shell", ShellUserAgent.token(version: "0.1.0"), "KabmoIOS/0.1.0")
    Harness.equal("the prefix is the server's", ShellUserAgent.prefix, "KabmoIOS/")

    let platformUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
      + "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1"
    let applied = ShellUserAgent.applying(to: platformUA, version: "0.1.0")
    Harness.check("the platform UA is kept, not replaced", applied.hasPrefix(platformUA))
    Harness.check("…with the token appended", applied.hasSuffix("KabmoIOS/0.1.0"))

    // Appending twice would make the server read the FIRST token while this build
    // reports a different one — the exact comparison the update control rests on.
    let twice = ShellUserAgent.applying(to: applied, version: "9.9.9")
    Harness.equal("a UA that already carries a token is left alone", twice, applied)
  }
}
