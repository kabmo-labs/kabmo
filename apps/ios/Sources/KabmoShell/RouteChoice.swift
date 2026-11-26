import Foundation

/// Which route a stored address is, and which one to use.
///
/// The order is a TIER, not a speed ranking, and the reason is measured: on a LAN,
/// `http://192.168.x.x` is not a secure context, so `getUserMedia` (dictation),
/// `navigator.clipboard.readText` and `serviceWorker` are all absent and the
/// password crosses the Wi-Fi in cleartext. Tailscale on the SAME network is a
/// direct WireGuard peer connection, so it costs a fraction of a millisecond over
/// the LAN address and restores all of them. Cloudflare is last because its edge
/// terminates TLS and can read every request.
///
/// This is the Swift port of `src/shared/lib/connect/tier.ts`; the numbers and the
/// ordering must stay identical, and both are pinned by tests.
public enum RouteKind: String, Equatable, CaseIterable {
  case tailscale
  case lan
  case cloudflare
}

public enum RouteChoice {

  /// Lower is better. Mirrors `ROUTE_TIER` in the shared TypeScript module.
  public static func tier(_ kind: RouteKind) -> Int {
    switch kind {
    case .tailscale: return 0
    case .lan: return 1
    case .cloudflare: return 2
    }
  }

  /// The route an address belongs to, from its host alone.
  ///
  /// A heuristic, and the only one available: the shell stores addresses, not the
  /// pairing payload that produced them. It is exact for the three shapes that
  /// matter — a MagicDNS name, a CGNAT address, a private address — and anything
  /// else is treated as public, which is the conservative answer because it ranks
  /// last.
  public static func kind(of url: String) -> RouteKind {
    guard let host = host(of: url) else { return .cloudflare }
    if host.hasSuffix(".ts.net") { return .tailscale }
    if let octets = ipv4(host) {
      // 100.64.0.0/10 — Tailscale's CGNAT range.
      if octets[0] == 100 && (64...127).contains(octets[1]) { return .tailscale }
      if octets[0] == 10 { return .lan }
      if octets[0] == 192 && octets[1] == 168 { return .lan }
      if octets[0] == 172 && (16...31).contains(octets[1]) { return .lan }
      if octets[0] == 127 { return .lan }
    }
    if host == "localhost" { return .lan }
    return .cloudflare
  }

  /// One address with the round trip the shell measured, or nil when it did not answer.
  public struct Probed: Equatable {
    public let url: String
    public let kind: RouteKind
    public let rttMs: Int?

    public init(url: String, kind: RouteKind, rttMs: Int?) {
      self.url = url
      self.kind = kind
      self.rttMs = rttMs
    }
  }

  /// The best reachable address, or nil when none answered.
  ///
  /// A candidate with no measurement is treated as unreachable rather than as
  /// infinitely fast: a probe that never ran must not win.
  public static func pick(_ probed: [Probed]) -> Probed? {
    var best: Probed?
    for candidate in probed {
      guard let rtt = candidate.rttMs else { continue }
      guard let current = best else {
        best = candidate
        continue
      }
      let candidateTier = tier(candidate.kind)
      let currentTier = tier(current.kind)
      if candidateTier < currentTier {
        best = candidate
        continue
      }
      if candidateTier == currentTier && rtt < (current.rttMs ?? Int.max) {
        best = candidate
      }
    }
    return best
  }

  /// Whether a newly measured winner is worth switching to.
  ///
  /// Without hysteresis two addresses with near-equal round trips take turns being
  /// "best", and every switch is a page load. A lower TIER always wins — that is a
  /// capability change, not a speed one — while a same-tier win needs to be both
  /// large and proportional.
  public static func shouldSwitch(
    active: Probed?,
    candidate: Probed?,
    minGainMs: Int = 30,
    minGainRatio: Double = 0.2
  ) -> Bool {
    guard let candidate else { return false }
    guard let active else { return true }
    guard let activeRtt = active.rttMs else { return true }

    let candidateTier = tier(candidate.kind)
    let activeTier = tier(active.kind)
    if candidateTier < activeTier { return true }
    if candidateTier > activeTier { return false }

    guard let candidateRtt = candidate.rttMs else { return false }
    let gain = activeRtt - candidateRtt
    return gain > minGainMs && Double(gain) / Double(activeRtt) > minGainRatio
  }

  /// The host of an http(s) URL, or nil.
  private static func host(of url: String) -> String? {
    guard let parsed = URL(string: url.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
    guard let scheme = parsed.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
    return parsed.host?.lowercased()
  }

  /// Four octets, or nil when `host` is not a dotted IPv4 literal.
  private static func ipv4(_ host: String) -> [Int]? {
    let parts = host.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 4 else { return nil }
    var octets: [Int] = []
    for part in parts {
      guard let value = Int(part), (0...255).contains(value) else { return nil }
      octets.append(value)
    }
    return octets
  }
}
