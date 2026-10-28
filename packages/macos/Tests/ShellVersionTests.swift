/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The desktop shell's reported version, and why a literal was wrong.

 `App.swift` used to declare the version as `"0.1.0"`, and that is a second
 number for one build: the release pipeline bumps
 `packages/macos/version.properties` and the build script fills
 `CFBundleShortVersionString` from it, so the plist said `0.2.0` while the
 running app went on telling the console `0.1.0`. The console then compared a
 published artifact against a version that did not exist and could not say
 anything true about the app it was running in.

 Every case below is a way this could go wrong SILENTLY: a missing key read as a
 version, whitespace compared as a different version, or a bundle-less `swift
 run` binary claiming `0.0.0` and thereby announcing an update to itself.
 */
import Foundation

import KabmoDesktop

func shellVersionCases() {
  group("ShellVersion — reading the plist")

  check(
    "a normal plist value",
    ShellVersion.from(infoDictionary: [ShellVersion.key: "0.2.0"]) == "0.2.0"
  )
  check(
    "surrounding whitespace is trimmed",
    ShellVersion.from(infoDictionary: [ShellVersion.key: " 0.2.0 "]) == "0.2.0"
  )
  check(
    "a missing key is empty, not a version",
    ShellVersion.from(infoDictionary: [:]) == ""
  )
  check(
    "a nil dictionary is empty",
    ShellVersion.from(infoDictionary: nil) == ""
  )
  check(
    "an empty string stays empty rather than becoming 0.0.0",
    ShellVersion.from(infoDictionary: [ShellVersion.key: ""]) == ""
  )
  check(
    "a non-string value is refused rather than coerced",
    ShellVersion.from(infoDictionary: [ShellVersion.key: 2]) == ""
  )

  group("ShellVersion — the key macOS reads")

  // Pinned literally: the build script writes this key, and a rename on one side
  // is a version nobody can read.
  check("the plist key", ShellVersion.key == "CFBundleShortVersionString")
}
