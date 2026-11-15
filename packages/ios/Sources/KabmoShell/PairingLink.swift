import Foundation

/// The origin a pasted pairing link points at.
///
/// The shell does NOT parse the pairing payload. It loads the link in its own web
/// view and lets the server's `/pair` page redeem it — that page already decodes
/// the payload, posts the claim, and the cookie it receives lands in THIS app's
/// cookie store, which is the whole point. A second parser here would be a second
/// place for the payload format to drift.
///
/// So the only thing this needs to answer is "which server is this link for",
/// because that is what the shell stores and what it must load.
///
/// Two forms are accepted:
///
/// - `https://host[:port]/pair#<payload>` — what the QR encodes and what the
///   console's "Copy link" copies. The origin is everything before `/pair`.
/// - `kabmo://connect?v=1&p=<payload>` — the deep link. Its origin is inside the
///   encoded payload, which this deliberately does not decode, so it is refused
///   with a sentence telling the user to use the https link instead.
public enum PairingLink {

  /// The origin of a pasted pairing link, or nil when it is not one.
  public static func origin(of raw: String) -> String? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    guard let parsed = URL(string: trimmed) else { return nil }
    guard let scheme = parsed.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
    guard let host = parsed.host, !host.isEmpty else { return nil }
    // The path must be the pairing page. A link to some other page on the same
    // server is not a pairing link, and loading it would leave the user on a page
    // that never sets a cookie.
    let path = parsed.path
    guard path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == "pair" else { return nil }
    if let port = parsed.port {
      return "\(scheme)://\(host):\(port)"
    }
    return "\(scheme)://\(host)"
  }

  /// Whether `raw` looks like a pairing link at all, for the field's own hint.
  public static func looksLikePairingLink(_ raw: String) -> Bool {
    origin(of: raw) != nil
  }
}
