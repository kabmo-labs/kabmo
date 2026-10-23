import Foundation
import KabmoShell

/// The app-update rules, pinned without a device.
///
/// Every case here is a silent failure in a real run: a comparison that treats
/// `0.6.0` as older than `0.5.9` hides an update forever, and a failed probe read
/// as "you are up to date" is the exact silence the reported stale shell was.
enum AppReleaseTests {
  static func run() {
    Harness.group("AppRelease — the comparison")

    Harness.check(
      "a higher patch is newer",
      AppRelease.decide(AppRelease.Release(url: "https://x/a.ipa", latest: "0.6.0"), installed: "0.5.0")
        == .available(AppRelease.Release(url: "https://x/a.ipa", latest: "0.6.0"), installed: "0.5.0")
    )
    Harness.check(
      "the same build is current",
      AppRelease.decide(AppRelease.Release(url: "https://x/a.ipa", latest: "0.2.0"), installed: "0.2.0")
        == .current(latest: "0.2.0", installed: "0.2.0")
    )
    // A sideloaded build ahead of the published one is not an update.
    Harness.check(
      "an older published build is not an update",
      AppRelease.decide(AppRelease.Release(url: "https://x/a.ipa", latest: "0.1.0"), installed: "0.2.0")
        == .current(latest: "0.1.0", installed: "0.2.0")
    )

    // The console's own semver drops everything after `-`, so the two sides agree
    // about whether an update exists.
    Harness.check(
      "a prerelease compares on its numeric core",
      !ShellUpdate.isNewer("0.2.0-beta.1", than: "0.2.0")
    )
    Harness.check(
      "a missing segment counts as zero",
      ShellUpdate.isNewer("0.2.1", than: "0.2")
    )

    Harness.group("AppRelease — a failed probe is never 'current'")

    // The console answers `{url: null, latest: null}` when it could not reach
    // GitHub. Reading that as "up to date" is precisely the bug.
    Harness.equal(
      "nil is a failure",
      AppRelease.decide(nil, installed: "0.1.0"),
      AppRelease.Result.failed
    )

    Harness.group("AppRelease — parsing the console's payload")

    Harness.equal(
      "a complete payload",
      AppRelease.parse(Data(#"{"url":"https://x/a.ipa","latest":"0.2.0","releaseUrl":"https://x/r"}"#.utf8)),
      AppRelease.Release(url: "https://x/a.ipa", latest: "0.2.0", releaseUrl: "https://x/r")
    )
    Harness.equal(
      "a missing releaseUrl is nil, not empty",
      AppRelease.parse(Data(#"{"url":"https://x/a.ipa","latest":"0.2.0"}"#.utf8)),
      AppRelease.Release(url: "https://x/a.ipa", latest: "0.2.0", releaseUrl: nil)
    )
    Harness.equal(
      "the console's failed probe is refused",
      AppRelease.parse(Data(#"{"url":null,"latest":null,"releaseUrl":null}"#.utf8)),
      nil
    )
    Harness.equal(
      "a version without a link is refused",
      AppRelease.parse(Data(#"{"url":"","latest":"0.2.0"}"#.utf8)),
      nil
    )
    Harness.equal("garbage is refused", AppRelease.parse(Data("not json".utf8)), nil)

    Harness.group("AppRelease — the console URL")

    Harness.equal(
      "an origin, with and without a trailing slash",
      AppRelease.url(for: "https://kabmo.test/"),
      "https://kabmo.test/api/updates/ios"
    )
    Harness.equal(
      "surrounding whitespace is ignored",
      AppRelease.url(for: "  http://192.168.1.20:3000  "),
      "http://192.168.1.20:3000/api/updates/ios"
    )
  }
}
