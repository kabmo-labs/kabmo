import Foundation
import KabmoShell

/// The update rules, pinned without a device.
///
/// Every one of these is a silent failure in a real run: a wrong download test hands
/// an IPA to the system browser (which can do nothing with it), a wrong version test
/// offers an update that is already installed, and a wrong comparison makes the
/// console's own banner disagree with this shell's dialog.
enum ShellUpdateTests {
  static func run() {
    Harness.group("ShellUpdate — what counts as an iOS build")

    Harness.check(
      "the console's own link",
      ShellUpdate.isIPADownload(url: "https://github.com/kabmo-labs/kabmo/releases/download/v1.2.3/kabmo-ios-v1.2.3.ipa")
    )
    Harness.check(
      "a signed URL keeps its extension through the query",
      ShellUpdate.isIPADownload(url: "https://x/kabmo-ios-1.2.3.ipa?X-Amz-Signature=abc")
    )
    Harness.check(
      "a Content-Disposition that names one",
      ShellUpdate.isIPADownload(url: "https://x/download/9f2", contentDisposition: "attachment; filename=\"kabmo-ios-1.2.3.ipa\"")
    )
    Harness.check(
      "the RFC 5987 spelling",
      ShellUpdate.isIPADownload(url: "https://x/download/9f2", contentDisposition: "attachment; filename*=UTF-8''kabmo-ios-1.2.3.ipa")
    )
    Harness.check(
      "the extension is case-insensitive",
      ShellUpdate.isIPADownload(url: "https://x/kabmo-ios-1.2.3.IPA")
    )

    Harness.check(
      "an APK is not an iOS build",
      !ShellUpdate.isIPADownload(url: "https://x/kabmo-android-v1.2.3.apk")
    )
    Harness.check(
      "a path with no extension is not one",
      !ShellUpdate.isIPADownload(url: "https://x/download/9f2")
    )
    Harness.check(
      "a name that merely mentions ipa is not one",
      !ShellUpdate.isIPADownload(url: "https://x/ipa-notes.md")
    )
    Harness.check(
      "a disposition that names something else is not one",
      !ShellUpdate.isIPADownload(url: "https://x/download/9f2", contentDisposition: "attachment; filename=\"notes.txt\"")
    )

    Harness.group("ShellUpdate — the decision")

    // iOS cannot install an app from a page, so an IPA always ends at the release
    // page rather than in a file nothing can open.
    Harness.equal(
      "an IPA opens the release page",
      ShellUpdate.action(
        url: "https://x/kabmo-ios-1.2.3.ipa",
        publishedVersion: "1.2.3",
        installedVersion: "1.2.2"
      ),
      .openReleasePage(reason: "needsStore")
    )
    Harness.equal(
      "an IPA for the build already installed says so",
      ShellUpdate.action(
        url: "https://x/kabmo-ios-1.2.3.ipa",
        publishedVersion: "1.2.3",
        installedVersion: "1.2.3"
      ),
      .openReleasePage(reason: "alreadyCurrent")
    )
    Harness.equal(
      "anything else goes to the system",
      ShellUpdate.action(url: "https://x/report.pdf", installedVersion: "1.2.3"),
      .openExternally
    )

    Harness.group("ShellUpdate — version comparison")

    // The same comparison the console makes (`src/shared/lib/updates/semver.ts`),
    // so the two sides cannot disagree about whether an update exists.
    Harness.check("a patch ahead", ShellUpdate.isNewer("1.2.4", than: "1.2.3"))
    Harness.check("a minor ahead", ShellUpdate.isNewer("1.3.0", than: "1.2.9"))
    Harness.check("a major ahead", ShellUpdate.isNewer("2.0.0", than: "1.99.99"))
    Harness.check("the same version is not newer", !ShellUpdate.isNewer("1.2.3", than: "1.2.3"))
    Harness.check("behind is not newer", !ShellUpdate.isNewer("1.2.2", than: "1.2.3"))
    Harness.check("a missing segment counts as zero", ShellUpdate.isNewer("1.2.1", than: "1.2"))
    Harness.check("…and the reverse is equal, not newer", !ShellUpdate.isNewer("1.2", than: "1.2.0"))
    Harness.check("a leading v is ignored", ShellUpdate.isNewer("v1.2.4", than: "1.2.3"))
    Harness.check("a prerelease suffix is ignored", !ShellUpdate.isNewer("1.2.3-beta.1", than: "1.2.3"))
    Harness.check("a non-numeric segment counts as zero", !ShellUpdate.isNewer("1.2.x", than: "1.2.1"))

    Harness.group("ShellUpdate — file names")

    // A `Content-Disposition` name is SERVER-controlled text. A name with a slash
    // appended as a path component resolves OUTSIDE the download directory, so the
    // traversal cases are the point of this rule, not an edge case.
    Harness.equal("a plain name is kept", ShellUpdate.safeFileName("report.pdf"), "report.pdf")
    // The separators become underscores and the LEADING dots are trimmed, so the
    // result is one segment. What matters is that no `/` survives: the exact spelling
    // is not a contract, the single-segment property is.
    let traversal = ShellUpdate.safeFileName("../../etc/passwd")
    Harness.check("a traversal keeps no separator", !traversal.contains("/") && !traversal.contains("\\"))
    Harness.check("…and is one path component", traversal == (traversal as NSString).lastPathComponent)
    Harness.equal("…with the name recognisable", traversal, "_.._etc_passwd")
    Harness.equal("a backslash path cannot escape", ShellUpdate.safeFileName("a\\b.txt"), "a_b.txt")
    Harness.equal("a leading dot is trimmed", ShellUpdate.safeFileName(".hidden"), "hidden")
    Harness.equal("an empty name falls back", ShellUpdate.safeFileName("", fallback: "kabmo.apk"), "kabmo.apk")
    Harness.equal("no name and no fallback", ShellUpdate.safeFileName("", fallback: nil), "download")
    Harness.equal("a name of only dots", ShellUpdate.safeFileName("...", fallback: nil), "download")

    Harness.group("ShellUpdate — path extraction")

    Harness.equal("a path with a query", ShellUpdate.path(of: "https://x/a/b.ipa?sig=1"), "/a/b.ipa")
    Harness.equal("a path with a fragment", ShellUpdate.path(of: "https://x/a/b.ipa#top"), "/a/b.ipa")
    Harness.equal("no path at all", ShellUpdate.path(of: "https://x"), "")
    Harness.equal("a bare name", ShellUpdate.path(of: "file.ipa"), "file.ipa")
  }
}
