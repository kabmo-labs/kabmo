/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two answers the console's notification commands return.
 *
 * Kept in the LOGIC target, like `ServerWire`: the page settles its
 * `__kabmoCall` promise with these strings, and reading the wrong key
 * (`allowed` for `granted`) is not a crash — it is a permission prompt that
 * never appears, or a setting that reads "on" while the system drops every
 * banner. The text is therefore the contract, and the test pins it.
 */

import Foundation

public enum NotificationWire {

  /// The current permission state, after the shell has asked if it could.
  public static func granted(_ granted: Bool) -> String {
    "{\"granted\":\(granted ? "true" : "false")}"
  }

  /// Whether the platform accepted the notification.
  public static func shown(_ shown: Bool) -> String {
    "{\"shown\":\(shown ? "true" : "false")}"
  }

  /**
   The platform's grant, in the console's vocabulary.

   `UNAuthorizationStatus` raw values ARE the wire: 0 notDetermined, 1 denied,
   2 authorized, 3 provisional, 4 ephemeral. Only `denied` changes behaviour —
   the page keeps its own chime and says the system is blocking it — but the
   names travel verbatim so the two sides cannot disagree about which number
   meant what. Provisional and ephemeral deliver quietly rather than not at all,
   so they are `granted` here.
   */
  public static func statusName(forRawValue raw: Int) -> String {
    switch raw {
    case 0: return "notDetermined"
    case 1: return "denied"
    case 2, 3, 4: return "granted"
    default: return "unknown"
    }
  }

  /// The answer `notification_state` settles to. iOS has its own Settings page.
  public static func state(_ status: String) -> String {
    "{\"status\":\(ServerWire.jsString(status)),\"canOpenSettings\":true}"
  }

  /**
   The chime a banner plays: the console's own two cues.

   The console stops playing its Web Audio cue inside a shell, so these names ARE
   the Kabmo notification sound on iOS. The files come from
   `packages/notification-sound/` and are copied into the bundle by
   `scripts/build-ipa.sh`; `UNNotificationSound` looks them up by name, and a
   name that drifts is not a crash — the platform silently falls back to its own
   tone. The test pins both strings for that reason.

   The names are BASE names: the file the bundle carries is versioned (see
   `soundName(forKind:version:)`), because the platform caches a failed sound
   lookup by name. A name that was ever missing stays missing even after the file
   is added, so tying it to the app's own version makes every release a fresh
   lookup.
   */
  public static let notificationSound = "kabmo_notification"
  public static let attentionSound = "kabmo_attention"

  /**
   Which chime an event carries, at the version this bundle declares.

   `ask` is the agent blocked on you, and it must not sound like a finished run:
   that distinction is the whole reason the console has two cues. The version
   comes from `CFBundleShortVersionString` — the same number `build-ipa.sh` puts
   in the file name — so the two cannot drift.
   */
  public static func soundName(forKind kind: String, version: String) -> String {
    let base = kind == "ask" ? attentionSound : notificationSound
    let suffix = sanitizedVersion(version)
    return suffix.isEmpty ? "\(base).wav" : "\(base)-\(suffix).wav"
  }

  /// The chime for an event, at this bundle's own version.
  public static func soundName(forKind kind: String) -> String {
    soundName(forKind: kind, version: bundleVersion())
  }

  /// `CFBundleShortVersionString`, or `""` when the process has no bundle.
  static func bundleVersion(bundle: Bundle = .main) -> String {
    (bundle.infoDictionary?["CFBundleShortVersionString"] as? String) ?? ""
  }

  /// A version safe to put in a file name: letters, digits, `.`, `-` and `_`
  /// survive; anything else becomes `_`. An empty version is a process with no
  /// bundle, which has no versioned file to find.
  static func sanitizedVersion(_ version: String) -> String {
    let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "" }
    return String(trimmed.map { character in
      character.isASCII && (character.isLetter || character.isNumber || character == "." || character == "-" || character == "_")
        ? character
        : "_"
    })
  }

  /**
   The request identifier.

   The page tags a notification by session (`finish:<id>`), so a corrected
   reason replaces the earlier banner instead of stacking two for one event. An
   untagged call still needs a unique identifier: reusing one would silently
   replace whatever happened to share it.
   */
  public static func identifier(tag: String) -> String {
    let trimmed = tag.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? UUID().uuidString : trimmed
  }

  /**
   The script that tells the console which session a notification tap named.

   A session id is opaque (an omp UUID, or a MOCK numeric id), and interpolating
   it raw would turn a quote into source. `ServerWire.jsString` is the same JSON
   encoder the bridge answers with, so the escaping cannot drift.
   */
  public static func openSessionScript(_ sessionId: String) -> String {
    "window.__kabmoOpenSession && window.__kabmoOpenSession(\(ServerWire.jsString(sessionId)))"
  }
}
