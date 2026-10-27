/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop shell's own version, read from the bundle it is running in.
 *
 * The number has ONE source: `CFBundleShortVersionString`, which
 * `scripts/build-app.sh` fills from `packages/macos/version.properties` — the
 * same file `release/release-shells.mjs` bumps. The app used to declare it as a
 * literal in `App.swift` (`shellVersion: "0.1.0"`), and that is a second number
 * for one build: the properties file was bumped to `0.2.0` by the release
 * pipeline while the running app went on reporting `0.1.0` to the console. The
 * console then compared the published asset against a version that did not exist
 * and could not tell the user anything true about their app.
 *
 * ## Why an empty answer, not "0.0.0"
 *
 * A binary run straight out of `swift build` has no bundle, so there is no
 * version to read. Reporting `0.0.0` there would make every development run
 * announce an update, and — worse — would be a NUMBER the console then compares
 * against a real artifact. `""` is "this build cannot say", which the page reads
 * as "no offer": a shell that does not know its own version must not claim to be
 * behind.
 */
import Foundation

/// Reads the shell version out of an `Info.plist` dictionary.
///
/// Pure and injectable, so the rules are testable without a bundle: the suite
/// hands it a dictionary, which is exactly what `Bundle.main.infoDictionary`
/// would have been.
public enum ShellVersion {
  /// The key macOS reads.
  public static let key = "CFBundleShortVersionString"

  /// The version in a plist dictionary, or `""` when it cannot say.
  ///
  /// Whitespace is trimmed and an empty value is `""` rather than a version: a
  /// plist with `<key>CFBundleShortVersionString</key><string></string>` is a
  /// build whose version nobody set, and treating it as `""` keeps it in the
  /// same "cannot say" state as a missing key.
  public static func from(infoDictionary: [String: Any]?) -> String {
    guard let raw = infoDictionary?[key] as? String else { return "" }
    return raw.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// This process's version.
  ///
  /// Inside the `.app` this is the plist the build script wrote; from
  /// `swift run` it is `""`, because there is no bundle to read.
  public static func current(bundle: Bundle = .main) -> String {
    from(infoDictionary: bundle.infoDictionary)
  }
}
