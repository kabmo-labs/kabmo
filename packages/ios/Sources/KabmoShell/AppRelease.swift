import Foundation

/// "Is a newer Kabmo app published?", as pure values.
///
/// **The iOS twin of the Android `AppRelease`, and the same reasoning applies to
/// where it asks.** The shell could read GitHub's release API directly, and that
/// is the mistake this exists to avoid: the API is unauthenticated at 60 requests
/// an hour **per source IP**, and a phone on mobile data shares that IP with an
/// entire carrier NAT. The console's `/api/updates/ios` already answers the same
/// question, already falls back to the public release pages when the API is spent,
/// and already caches the answer for five minutes. The shell therefore reads the
/// server it is already pointed at.
///
/// Every rule below fails SILENTLY on a device — a comparison that treats `0.6.0`
/// as older than `0.5.9` hides an update forever, a failed probe read as "you are
/// up to date" is the silence this feature exists to end — which is why they are
/// pure values here rather than logic inside the settings screen.
public enum AppRelease {

  /// The published build, as the console reports it.
  public struct Release: Equatable {
    public let url: String
    public let latest: String
    public let releaseUrl: String?

    public init(url: String, latest: String, releaseUrl: String? = nil) {
      self.url = url
      self.latest = latest
      self.releaseUrl = releaseUrl
    }
  }

  /// What a check concluded. Every case is named; "something went wrong" is not an answer.
  public enum Result: Equatable {
    /// The console answered with a newer build.
    case available(Release, installed: String)
    /// The console answered, and this build is the published one (or newer).
    case current(latest: String, installed: String)
    /// The question could not be asked.
    case failed
  }

  /// The console route this asks.
  public static let path = "/api/updates/ios"

  /// The absolute URL for a saved server origin.
  public static func url(for baseUrl: String) -> String {
    var trimmed = baseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    while trimmed.hasSuffix("/") { trimmed.removeLast() }
    return trimmed + path
  }

  /// The conclusion for a parsed release and this build's version.
  ///
  /// A nil release is a FAILED probe, never "current": the console answers
  /// `{url: null, latest: null}` when it could not reach GitHub, and reading that
  /// as "you are up to date" is precisely the silence this feature ends.
  public static func decide(_ release: Release?, installed: String) -> Result {
    guard let release else { return .failed }
    if ShellUpdate.isNewer(release.latest, than: installed) {
      return .available(release, installed: installed)
    }
    return .current(latest: release.latest, installed: installed)
  }

  /// Read the console's payload.
  ///
  /// A missing `url` or `latest` is a failed read rather than a release with no
  /// link — the distinction `decide` rests on.
  public static func parse(_ data: Data) -> Release? {
    guard
      let object = try? JSONSerialization.jsonObject(with: data),
      let body = object as? [String: Any]
    else { return nil }

    guard
      let url = (body["url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !url.isEmpty,
      let latest = (body["latest"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !latest.isEmpty
    else { return nil }

    let releaseUrl = (body["releaseUrl"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    return Release(url: url, latest: latest, releaseUrl: releaseUrl)
  }
}
