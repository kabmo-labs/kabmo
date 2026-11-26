/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The wire the console's notification commands answer with.
 *
 * Kept in the LOGIC target, like `ShellVersion`: the page resolves its
 * `__kabmoCall` promise from these values, and a renamed key is silent — a
 * permission prompt that appears to succeed while every banner is dropped. The
 * test pins the text.
 */
import Foundation

public enum NotificationWire {

  /// The current permission state, after the shell has asked if it could.
  public static func granted(_ granted: Bool) -> Bool { granted }

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

  /**
   The chimes a banner plays: the console's own two cues.

   The console stops playing its Web Audio cue inside a shell, so these names ARE
   the Kabmo notification sound on macOS. `scripts/build-app.sh` copies both
   files from `assets/notification-sound/` into `Contents/Resources`, and
   `UNNotificationSound` finds them there by name — a name that drifts is not a
   crash, it silently becomes the platform's tone.

   The names are BASE names: the file the bundle carries is versioned (see
   `soundName(forKind:version:)`), because macOS caches a failed sound lookup by
   name. A name that was ever missing stays missing even after the file is added,
   so tying it to the app's own version makes every release a fresh lookup.
   */
  public static let notificationSound = "kabmo_notification"
  public static let attentionSound = "kabmo_attention"

  /// Which chime an event carries, at the version this bundle declares.
  ///
  /// `ask` is the agent blocked on you, and must not sound like a finished run.
  /// The version comes from `CFBundleShortVersionString` — the same number
  /// `scripts/build-app.sh` puts in the file name — so the two cannot drift.
  public static func soundName(forKind kind: String, version: String = ShellVersion.current()) -> String {
    let base = kind == "ask" ? attentionSound : notificationSound
    let suffix = sanitizedVersion(version)
    return suffix.isEmpty ? "\(base).wav" : "\(base)-\(suffix).wav"
  }

  /// A version safe to put in a file name: letters, digits, `.`, `-` and `_`
  /// survive; anything else becomes `_`. An empty version is the `swift run`
  /// case, which has no bundle and therefore no versioned file to find.
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

   The page tags by session (`finish:<id>`), so a corrected reason replaces the
   earlier banner instead of stacking two for one event. An untagged call still
   needs a unique identifier: reusing one would replace whatever shared it.
   */
  public static func identifier(tag: String) -> String {
    let trimmed = tag.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? UUID().uuidString : trimmed
  }

  /**
   The script that tells the console which session a notification tap named.

   A session id is opaque, so it is encoded as JSON rather than interpolated —
   a quote in an id must not turn into source. `["x"]` is how Foundation's own
   encoder is used without a second escaping table.
   */
  public static func openSessionScript(_ sessionId: String) -> String {
    let encoded: String
    if let data = try? JSONSerialization.data(withJSONObject: [sessionId]),
       let text = String(data: data, encoding: .utf8) {
      // `["x"]` → `"x"`.
      encoded = String(text.dropFirst().dropLast())
    } else {
      encoded = "\"\""
    }
    return "window.__kabmoOpenSession && window.__kabmoOpenSession(\(encoded))"
  }
}
