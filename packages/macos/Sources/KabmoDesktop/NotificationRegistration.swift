/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Rebuilding the notification daemon's record of this app.
 *
 * `usernoted` keeps the app record in memory, and it caches the bundle it was
 * built from. A record built from a DIFFERENT bundle with the same
 * `CFBundleIdentifier` — a mounted DMG, a dev build, the previous install —
 * makes `UNNotificationSound(named:)` reject the chime and fall back to the
 * platform's tone. Measured on macOS 26: the bundle held
 * `kabmo_notification-0.12.5.wav`, the log named it, and `systemsoundserverd`
 * still played built-in action 22 until the bundle was re-registered and the
 * daemon restarted; after that the same notification read `mDataSize 44100`
 * instead of `252462`.
 *
 * One heal per version is enough, and it is what makes an update automatic:
 * `ShellUpdater` heals after installing, and the launch path heals a manual
 * install (a drag from the DMG) once, keyed by the version already in
 * `UserDefaults`.
 */
import Foundation

public enum NotificationRegistration {
  /// The version whose record was last rebuilt.
  public static let healedVersionKey = "kabmo.notificationRegistrationVersion"

  /// The LaunchServices tool. Its path is the one macOS itself uses; it has no
  /// public CLI name because it is a framework helper rather than a product.
  static let lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

  /// Whether a launch should rebuild the record.
  ///
  /// Empty is "this build cannot say" (`swift run`), which has no bundle for
  /// `usernoted` to resolve: healing there would kill the user's notification
  /// daemon for nothing.
  public static func shouldHeal(installedVersion: String, lastHealed: String?) -> Bool {
    let version = installedVersion.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !version.isEmpty else { return false }
    return version != lastHealed
  }

  /**
   Re-register the installed bundle and restart the two daemons that cache the
   app record.

   `killall` rather than `launchctl kickstart`: SIP refuses the kickstart
   (measured: "Operation not permitted while System Integrity Protection is
   engaged"), while the user's own daemons restart from `killall`. Everything is
   best-effort — a failed heal is a platform tone, not a failed launch.
   */
  @discardableResult
  public static func heal(installedBundle: URL) -> Bool {
    let registered = ShellProcess.run(lsregister, ["-f", installedBundle.path]) == 0
    _ = ShellProcess.run("/usr/bin/killall", ["usernoted"])
    _ = ShellProcess.run("/usr/bin/killall", ["NotificationCenter"])
    return registered
  }
}
