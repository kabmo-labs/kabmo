import Foundation

/// The `KabmoIOS/<version>` token this shell appends to its User-Agent.
///
/// The token is the console's only channel for two questions at once: "am I
/// running inside the iOS shell" and "which build of it". It crosses the very
/// request that renders the console, so the server answers without a bridge and
/// without a round trip — and the sidebar can draw (or withhold) an update
/// control before its first paint.
///
/// The prefix is stated ONCE here and parsed by
/// `src/shared/lib/updates/shell-ua.ts` on the server; the two are pinned
/// together by `ShellUserAgentTests` against the TypeScript constant.
public enum ShellUserAgent {

  /// The token name, before the slash. Must match `SHELL_UA_PREFIXES.ios`.
  public static let prefix = "KabmoIOS/"

  /// The token for a build.
  public static func token(version: String) -> String {
    "\(prefix)\(version)"
  }

  /// A web view UA with this shell's token appended.
  ///
  /// The platform UA is kept, never replaced: it carries `iPhone`/`iPad` and
  /// `Safari`, which is what the server's `MOBILE_UA` hint and the client's own
  /// detector read to pick the phone layout. Replacing it would render the
  /// desktop console on a phone.
  ///
  /// A trailing duplicate token is not appended twice: a web view that already
  /// reports one (a restored session, a future platform change) would otherwise
  /// make the server read the FIRST token while this build reports a different
  /// one — the exact comparison the update control rests on.
  public static func applying(to base: String, version: String) -> String {
    let trimmed = base.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.split(separator: " ").contains(where: { $0.hasPrefix(prefix) }) { return trimmed }
    return "\(trimmed) \(token(version: version))"
  }
}
