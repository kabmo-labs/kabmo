/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The self-update's rules.
 *
 * Every case here is a way an update could install the wrong thing, and NONE of
 * them throws in the app — a wrong host allowlist downloads from anywhere, a
 * missing identifier check installs another product, a wrong comparison
 * downgrades the app. The download and the bundle swap need a network and a
 * bundle on disk; these rules need neither, which is why they are separate.
 */

import Foundation

import KabmoDesktop

func shellUpdateCases() {
  group("ShellUpdate — where a download may come from")

  check(
    "a release asset on github.com",
    ShellUpdate.isTrustedDownload("https://github.com/kabmo-labs/kabmo/releases/download/v0.3.0/Kabmo-0.3.0-mac-arm64.zip")
  )
  check(
    "the CDN host GitHub redirects an asset to",
    ShellUpdate.isTrustedDownload("https://objects.githubusercontent.com/github-production-release-asset/x/y")
  )
  check(
    "release-assets.githubusercontent.com",
    ShellUpdate.isTrustedDownload("https://release-assets.githubusercontent.com/x")
  )
  check(
    "plain http is refused, because the bytes decide what gets installed",
    !ShellUpdate.isTrustedDownload("http://github.com/kabmo-labs/kabmo/releases/download/v0.3.0/x.zip")
  )
  check(
    "another host is refused, even over https",
    !ShellUpdate.isTrustedDownload("https://example.com/Kabmo.zip")
  )
  check(
    "a host that merely CONTAINS a trusted name is refused",
    !ShellUpdate.isTrustedDownload("https://github.com.example.com/Kabmo.zip")
  )
  check(
    "a URL that does not parse is refused rather than guessed at",
    !ShellUpdate.isTrustedDownload("not a url")
  )

  group("ShellUpdate — the version comparison")

  check("a higher patch is newer", ShellUpdate.isNewer("0.3.1", than: "0.3.0"))
  check("a higher minor is newer", ShellUpdate.isNewer("0.4.0", than: "0.3.9"))
  check("a higher major is newer", ShellUpdate.isNewer("1.0.0", than: "0.9.9"))
  check("the same version is not newer", !ShellUpdate.isNewer("0.3.0", than: "0.3.0"))
  check("an older version is not newer", !ShellUpdate.isNewer("0.2.9", than: "0.3.0"))
  check(
    "a prerelease suffix is ignored, as the console ignores it",
    ShellUpdate.isNewer("0.3.1-beta.2", than: "0.3.0")
  )
  check(
    "a leading v is ignored",
    ShellUpdate.isNewer("v0.3.1", than: "0.3.0")
  )
  check(
    "a non-numeric segment counts as 0 rather than trapping",
    !ShellUpdate.isNewer("0.3.x", than: "0.3.0")
  )
  check(
    "a shorter version compares against a longer one without trapping",
    !ShellUpdate.isNewer("0.3", than: "0.3.0")
  )

  group("ShellUpdate — what may be installed")

  check(
    "a Kabmo bundle with a newer version",
    ShellUpdate.refusal(
      stagedIdentifier: ShellUpdate.bundleIdentifier,
      stagedVersion: "0.3.1",
      installedVersion: "0.3.0"
    ) == nil
  )
  check(
    "another product is refused",
    ShellUpdate.refusal(
      stagedIdentifier: "com.example.other",
      stagedVersion: "9.9.9",
      installedVersion: "0.3.0"
    ) != nil
  )
  check(
    "a bundle with no identifier is refused",
    ShellUpdate.refusal(stagedIdentifier: nil, stagedVersion: "0.3.1", installedVersion: "0.3.0") != nil
  )
  check(
    "the same build is refused, because that is not an update",
    ShellUpdate.refusal(
      stagedIdentifier: ShellUpdate.bundleIdentifier,
      stagedVersion: "0.3.0",
      installedVersion: "0.3.0"
    ) != nil
  )
  check(
    "an OLDER build is refused, because installing it would be a downgrade",
    ShellUpdate.refusal(
      stagedIdentifier: ShellUpdate.bundleIdentifier,
      stagedVersion: "0.2.0",
      installedVersion: "0.3.0"
    ) != nil
  )
  check(
    "a bundle with no version is refused",
    ShellUpdate.refusal(
      stagedIdentifier: ShellUpdate.bundleIdentifier,
      stagedVersion: "",
      installedVersion: "0.3.0"
    ) != nil
  )

  group("ShellUpdate — what it will replace")

  check(
    "an .app bundle can replace itself",
    ShellUpdate.isInstalledBundle(URL(fileURLWithPath: "/Applications/Kabmo.app"))
  )
  check(
    "a swift-run build directory cannot, and says so",
    !ShellUpdate.isInstalledBundle(URL(fileURLWithPath: "/Users/x/projects/kabmo/packages/macos/.build/arm64/debug"))
  )
  check(
    "the staging root is under Caches, never Documents",
    ShellUpdate.stagingRoot(caches: URL(fileURLWithPath: "/tmp/caches")).path == "/tmp/caches/Kabmo/update"
  )
}
