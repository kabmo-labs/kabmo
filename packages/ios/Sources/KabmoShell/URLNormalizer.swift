import Foundation

/// A normalized server address, or the reason it cannot be one.
///
/// The Swift twin of `UrlNormalizer` in `packages/android`, and deliberately the
/// same rules — a server address accepted by one shell and refused by the other
/// would be two products.
public enum NormalizedURL: Equatable {
  case ok(String)
  case error(URLProblem)

  /// The address, when there is one.
  public var url: String? {
    if case let .ok(value) = self { return value }
    return nil
  }

  /// The refusal, when there is one.
  public var problem: URLProblem? {
    if case let .error(problem) = self { return problem }
    return nil
  }
}

/// Why an address was refused. Each case is one sentence in the settings screen.
public enum URLProblem: String, Equatable {
  /// Nothing was typed.
  case empty
  /// A scheme other than http/https.
  case scheme
  /// A base path, which the client cannot honour.
  case path
  /// Not a URL at all.
  case shape
}

/// Turn what the user typed into an origin.
///
/// The client is root-relative everywhere — every API call is `fetch('/api/…')`
/// and both sockets derive their URL from `window.location` — so a base path
/// cannot work: `http://host:3000/kabmo` would send `/api/health` to
/// `http://host:3000/api/health` and 404. Rather than accept a URL that silently
/// breaks, the path is refused with an explanation.
///
/// A missing scheme becomes `http`, because a self-hosted LAN server is the
/// common case and typing `192.168.1.20:3000` should not fail.
///
/// `URLComponents` rather than string splitting: it rejects the malformed hosts
/// a settings field must reject, and it is what percent-decodes the parts a user
/// can paste. It does NOT validate as strictly as Android's `java.net.URI`
/// (a bare `host:port` parses as scheme `host`), which is why the scheme test
/// below runs on the PARSED scheme rather than on a `contains("://")` guess.
public enum URLNormalizer {

  /// Whether `candidate` names the SAME server as `saved`.
  ///
  /// Both sides are `normalize` output, so a path, query or fragment cannot reach
  /// either one, and scheme and host are case-insensitive in an origin — which
  /// makes a case-insensitive compare of the whole string exact.
  ///
  /// This is the decision the settings screen uses to decide whether Connect must
  /// sign the user out. Clearing the cookie unconditionally signed a user out of a
  /// server whose address had not changed at all — the screen is also where the
  /// zoom slider lives.
  public static func sameOrigin(_ saved: String?, _ candidate: String) -> Bool {
    guard let saved, !saved.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
    return trimSlash(saved).caseInsensitiveCompare(trimSlash(candidate)) == .orderedSame
  }

  /// Normalize a typed address into an origin.
  public static func normalize(_ raw: String) -> NormalizedURL {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return .error(.empty) }

    // A scheme is required by `URLComponents`, so one is added when the input has
    // none. `://` rather than `:`: `192.168.1.20:3000` would otherwise parse
    // `192.168.1.20` as a scheme.
    let withScheme = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
    guard let components = URLComponents(string: withScheme) else { return .error(.shape) }

    guard let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
      return .error(.scheme)
    }

    guard let host = components.host, !host.isEmpty else { return .error(.shape) }
    if let user = components.user, !user.isEmpty { return .error(.shape) }
    if components.password != nil { return .error(.shape) }
    if components.query != nil || components.fragment != nil { return .error(.shape) }
    if let port = components.port, !(1...65535).contains(port) { return .error(.shape) }

    // A trailing slash is the root and is harmless; anything else is a base path
    // the client cannot honour.
    let path = components.path
    if !path.isEmpty && path != "/" { return .error(.path) }

    // `URLComponents.host` drops the brackets around an IPv6 literal; they are
    // required again in the URL the shell loads.
    let formatted = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    let portPart = components.port.map { ":\($0)" } ?? ""

    return .ok("\(scheme)://\(formatted)\(portPart)")
  }

  private static func trimSlash(_ value: String) -> String {
    var out = value.trimmingCharacters(in: .whitespaces)
    while out.hasSuffix("/") { out.removeLast() }
    return out
  }
}
