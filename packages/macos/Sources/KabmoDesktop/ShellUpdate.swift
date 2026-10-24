/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The rules a macOS self-update obeys, as pure values.
 *
 * Kept out of `ShellUpdater` for the reason `SplashState` and `ShellVersion` are:
 * every rule below fails SILENTLY in a real run — a wrong host allowlist
 * downloads from anywhere, a wrong identifier check installs a different product,
 * a wrong version comparison downgrades the app — and a plain suite can pin all
 * of them without a network or a bundle on disk.
 *
 * ## What this CAN and CANNOT promise
 *
 * A distributed Kabmo is signed AD-HOC (`codesign --sign -`), which seals the
 * bundle but names no identity: anyone can produce another ad-hoc signature. So
 * these checks are integrity, not authenticity — they catch a truncated download
 * and a bundle that was modified after signing, and they do NOT prove the bytes
 * came from this project. Two things bound the damage in the meantime: the
 * download must be HTTPS from a GitHub host (the same origin the console itself
 * read the release from), and the staged bundle must declare Kabmo's own
 * identifier and a HIGHER version. A Developer ID signature plus notarisation is
 * what would make this an authenticity check, and that is a pipeline change, not
 * a code change — see `scripts/build-app.sh`.
 */

import Foundation

public enum ShellUpdate {
  /// The bundle identifier this shell installs. Anything else is another app.
  public static let bundleIdentifier = "dev.kabmo.desktop"

  /// The archive member a release carries.
  public static let appDirectoryName = "Kabmo.app"

  /**
   * Hosts a self-update may download from.
   *
   * GitHub serves a release asset from `github.com` (a redirect) and then from a
   * CDN host, so the list has to cover both. It is an ALLOWLIST rather than a
   * scheme test because a console is a network service: a compromised or merely
   * misconfigured one must not be able to point this app at an arbitrary host.
   */
  public static let trustedHosts: Set<String> = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
  ]

  /// Whether a URL is something this shell will download from.
  ///
  /// HTTPS only, and only the hosts above. A URL that does not parse is refused
  /// rather than guessed at.
  public static func isTrustedDownload(_ urlString: String) -> Bool {
    guard let url = URL(string: urlString), let host = url.host?.lowercased() else { return false }
    guard url.scheme?.lowercased() == "https" else { return false }
    return trustedHosts.contains(host)
  }

  /// Whether `candidate` is a strictly newer version than `installed`.
  ///
  /// Numeric dotted segments only, ignoring a prerelease suffix — the same
  /// comparison the console makes (`src/shared/lib/updates/semver.ts`), so the
  /// two sides cannot disagree about whether an update exists. A segment that is
  /// not a number counts as 0, which makes `1.2.x` compare below `1.2.1` instead
  /// of trapping.
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

  private static func segments(_ version: String) -> [Int] {
    let core = version.trimmingCharacters(in: .whitespaces)
      .replacingOccurrences(of: "^[vV]", with: "", options: .regularExpression)
      .split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)[0]
    return core.split(separator: ".").map { Int($0) ?? 0 }
  }

  /// Why a staged bundle may not be installed, or nil when it may.
  ///
  /// Every refusal is a SENTENCE, because the console prints it: "the downloaded
  /// file is a different app" tells a user what happened, and a bare `false`
  /// tells them the update is broken.
  public static func refusal(
    stagedIdentifier: String?,
    stagedVersion: String?,
    installedVersion: String
  ) -> String? {
    if stagedIdentifier != bundleIdentifier {
      return "The downloaded file is not a Kabmo app (it declares \(stagedIdentifier ?? "no identifier"))."
    }
    guard let staged = stagedVersion, !staged.isEmpty else {
      return "The downloaded app does not declare a version, so it cannot be installed."
    }
    if !isNewer(staged, than: installedVersion) {
      return "The downloaded build (\(staged)) is not newer than the installed one (\(installedVersion))."
    }
    return nil
  }

  /// Whether this process is running from an installable `.app` bundle.
  ///
  /// A `swift run` binary has no bundle to replace, and replacing the one it
  /// runs from would be replacing a build directory. The update therefore says so
  /// instead of trying.
  public static func isInstalledBundle(_ bundleURL: URL) -> Bool {
    bundleURL.pathExtension == "app"
  }

  /// The staging directory a download is unpacked into.
  ///
  /// Caches, not Documents: a partial archive must never look like a saved file,
  /// and the system is free to reclaim it.
  public static func stagingRoot(caches: URL) -> URL {
    caches.appendingPathComponent("Kabmo/update", isDirectory: true)
  }
}
