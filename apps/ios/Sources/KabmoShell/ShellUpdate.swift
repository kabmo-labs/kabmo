import Foundation

/// What the shell does when the console offers it a newer build.
///
/// **The iOS twin of `ApkUpdate`, and it deliberately differs in the one place
/// the platform does.** Android can hand an APK to `PackageInstaller` and finish
/// the install itself, because Android allows a sideloaded app to replace itself
/// after one system confirmation. iOS has no equivalent: there is no public API
/// for an app to install another app, no `PackageInstaller`, and a downloaded
/// `.ipa` is not something the system will open. Only App Store / TestFlight /
/// MDM can install, and none of them is reachable from a web page.
///
/// So the honest behaviour is the one below: recognise an IPA download, refuse to
/// put it anywhere useless, and send the user to the release page — where the
/// build is either distributed through TestFlight or installed by hand. A shell
/// that silently wrote `kabmo-ios-1.2.3.ipa` into Files would be imitating the
/// Android flow while doing nothing with it.
///
/// Kept as pure values, like `LoadingState`, because every rule here fails
/// SILENTLY in a real run: a wrong URL test hands an IPA to the document picker, a
/// wrong version test offers an update that is already installed.
public enum ShellUpdate {

  /// The extension a build is distributed under.
  public static let extensionName = ".ipa"

  /// The MIME type iOS assigns to an IPA when a server bothers to set one.
  public static let ipaMime = "application/octet-stream"

  /// What to do with a download the console started.
  public enum Action: Equatable {
    /// Hand it to the system browser (or `SFSafariViewController`) — an ordinary
    /// file the editor's Download button produced.
    case openExternally

    /// It is an IPA, which this platform cannot install. Show the release page
    /// instead, and say why.
    case openReleasePage(reason: String)
  }

  /// Whether a URL names an iOS build.
  ///
  /// The query string is stripped before the extension test: a signed release URL
  /// ends `…ipa?X-Amz-Signature=…`, and testing the raw string would refuse every
  /// such download. The `Content-Disposition` name is checked too, because a
  /// server may hide the extension behind a route.
  public static func isIPADownload(url: String, contentDisposition: String? = nil, mimeType: String? = nil) -> Bool {
    if let named = namedFile(in: contentDisposition), named.lowercased().hasSuffix(extensionName) {
      return true
    }
    // A MIME type cannot identify an IPA — it is either octet-stream or a
    // vendor type nothing agrees on — so the extension is the only reliable
    // signal. Kept as a parameter for a caller that already has it.
    _ = mimeType
    return path(of: url).lowercased().hasSuffix(extensionName)
  }

  /// The decision for one download.
  ///
  /// `publishedVersion` is what the console's link names (read out of the asset
  /// name by the server), and `installedVersion` is this build. They are only used
  /// to phrase the sentence: the platform cannot install either way, and an offer
  /// that turned out to be the current build should say so rather than send
  /// someone to a page with nothing new on it.
  public static func action(
    url: String,
    contentDisposition: String? = nil,
    publishedVersion: String? = nil,
    installedVersion: String
  ) -> Action {
    guard isIPADownload(url: url, contentDisposition: contentDisposition) else { return .openExternally }

    if let published = publishedVersion, !isNewer(published, than: installedVersion) {
      return .openReleasePage(reason: "alreadyCurrent")
    }
    return .openReleasePage(reason: "needsStore")
  }

  /// Whether `candidate` is a newer build than `installed`.
  ///
  /// Strictly greater on the numeric segments, ignoring a prerelease suffix — the
  /// same comparison the console makes (`src/shared/lib/updates/semver.ts`), so the
  /// two sides cannot disagree about whether an update exists. A segment that is
  /// not a number counts as 0, which is what makes `1.2.x` compare below `1.2.1`
  /// instead of trapping.
  public static func isNewer(_ candidate: String, than installed: String) -> Bool {
    let left = segments(candidate)
    let right = segments(installed)
    for index in 0..<max(left.count, right.count) {
      let a = index < left.count ? left[index] : 0
      let b = index < right.count ? right[index] : 0
      if a != b { return a > b }
    }
    return false
  }

  /// The numeric segments of a version, `v` and any suffix dropped.
  static func segments(_ version: String) -> [Int] {
    var trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("v") || trimmed.hasPrefix("V") { trimmed.removeFirst() }
    let core = trimmed.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
    return core.split(separator: ".").map { Int($0) ?? 0 }
  }

  /// The file name a `Content-Disposition` header names, or nil.
  ///
  /// Both spellings: `filename*=UTF-8''…` is RFC 5987 and a self-hosted mirror may
  /// send either.
  public static func namedFile(in contentDisposition: String?) -> String? {
    guard let disposition = contentDisposition, !disposition.isEmpty else { return nil }
    let pattern = #"filename\*?=(?:UTF-8'')?"?([^";]+)"?"#
    guard
      let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
      let match = regex.firstMatch(in: disposition, range: NSRange(disposition.startIndex..., in: disposition)),
      let range = Range(match.range(at: 1), in: disposition)
    else { return nil }
    let value = String(disposition[range]).trimmingCharacters(in: .whitespaces)
    return value.isEmpty ? nil : value
  }

  /// A file name safe to use as a single path segment.
  ///
  /// A `Content-Disposition` name is SERVER-controlled text, and
  /// `appendingPathComponent("../../etc/passwd")` resolves outside the directory it is
  /// appended to. The Android shell had the same hazard in `ApkUpdate.sanitize`, and
  /// both now answer it the same way: one segment, always.
  ///
  /// Separators become `_` rather than being stripped, so a name that HAD a path stays
  /// recognisable instead of collapsing into its last component.
  public static func safeFileName(_ suggested: String, fallback: String? = nil) -> String {
    let raw = suggested.isEmpty ? (fallback ?? "download") : suggested
    let cleaned = raw
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "\\", with: "_")
      .trimmingCharacters(in: CharacterSet(charactersIn: ". "))
    return cleaned.isEmpty ? "download" : cleaned
  }

  /// The URL's path, without scheme, host, query or fragment.
  public static func path(of url: String) -> String {
    let withoutFragment = url.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0]
    let withoutQuery = withoutFragment.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0]
    guard let schemeRange = withoutQuery.range(of: "://") else { return String(withoutQuery) }
    let afterScheme = withoutQuery[schemeRange.upperBound...]
    guard let slash = afterScheme.firstIndex(of: "/") else { return "" }
    return String(afterScheme[slash...])
  }
}
