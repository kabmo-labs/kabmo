import Foundation
import KabmoShell

/// The route order, pinned.
///
/// The case that matters is the one a "fastest wins" rule gets wrong: a LAN address
/// answering in 2 ms must still lose to Tailscale at 4 ms, because the LAN origin is
/// not a secure context and dictation, clipboard read and the service worker are all
/// absent there. A test that only compared round trips would pass while the product
/// regressed.
///
/// The same cases exist in `packages/android`'s `RouteChoiceTest`; the two shells
/// must rank the same addresses the same way.
enum RouteChoiceTests {
  static func run() {
    Harness.group("RouteChoice — classification")

    Harness.equal("a MagicDNS name is Tailscale", RouteChoice.kind(of: "https://laptop.tailnet.ts.net"), .tailscale)
    Harness.equal("a CGNAT address is Tailscale", RouteChoice.kind(of: "http://100.98.171.79:3000"), .tailscale)
    Harness.equal("192.168 is LAN", RouteChoice.kind(of: "http://192.168.18.79:3000"), .lan)
    Harness.equal("10/8 is LAN", RouteChoice.kind(of: "http://10.0.0.5:3000"), .lan)
    Harness.equal("172.16/12 is LAN", RouteChoice.kind(of: "http://172.16.4.2:3000"), .lan)
    Harness.equal("localhost is LAN", RouteChoice.kind(of: "http://localhost:3000"), .lan)
    Harness.equal("a public host is Cloudflare", RouteChoice.kind(of: "https://kabmo.example.com"), .cloudflare)

    Harness.group("RouteChoice — a public address is not mistaken for a private one")
    Harness.equal("172.32 is outside 172.16/12", RouteChoice.kind(of: "http://172.32.0.1:3000"), .cloudflare)
    Harness.equal("100.128 is outside 100.64/10", RouteChoice.kind(of: "http://100.128.0.1:3000"), .cloudflare)

    Harness.group("RouteChoice — pick")

    let lan = RouteChoice.Probed(url: "http://192.168.18.79:3000", kind: .lan, rttMs: 2)
    let tailscale = RouteChoice.Probed(url: "https://laptop.tailnet.ts.net", kind: .tailscale, rttMs: 4)
    let deadTailscale = RouteChoice.Probed(url: "https://laptop.tailnet.ts.net", kind: .tailscale, rttMs: nil)

    Harness.equal("Tailscale wins over a faster LAN address", RouteChoice.pick([lan, tailscale])?.url, tailscale.url)
    Harness.equal("LAN is the fallback when Tailscale did not answer", RouteChoice.pick([lan, deadTailscale])?.url, lan.url)
    Harness.check("nothing answered means nil", RouteChoice.pick([deadTailscale]) == nil)

    Harness.group("RouteChoice — shouldSwitch")

    Harness.check(
      "a better tier wins even when slower",
      RouteChoice.shouldSwitch(active: lan, candidate: RouteChoice.Probed(url: "https://x.ts.net", kind: .tailscale, rttMs: 30))
    )
    Harness.check(
      "never switches down a tier",
      RouteChoice.shouldSwitch(active: tailscale, candidate: lan) == false
    )
    Harness.check(
      "a same-tier win of 10 ms is not worth a reload",
      RouteChoice.shouldSwitch(
        active: RouteChoice.Probed(url: "https://a.ts.net", kind: .tailscale, rttMs: 40),
        candidate: RouteChoice.Probed(url: "https://b.ts.net", kind: .tailscale, rttMs: 30)
      ) == false
    )
    Harness.check(
      "a same-tier win that is large and proportional is taken",
      RouteChoice.shouldSwitch(
        active: RouteChoice.Probed(url: "https://a.ts.net", kind: .tailscale, rttMs: 200),
        candidate: RouteChoice.Probed(url: "https://b.ts.net", kind: .tailscale, rttMs: 60)
      )
    )
    Harness.check(
      "a dead active route is replaced",
      RouteChoice.shouldSwitch(active: deadTailscale, candidate: lan)
    )
  }
}
