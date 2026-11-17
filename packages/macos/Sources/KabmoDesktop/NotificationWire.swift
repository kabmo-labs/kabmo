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
   files from `packages/notification-sound/` into `Contents/Resources`, and
   `UNNotificationSound` finds them there by name — a name that drifts is not a
   crash, it silently becomes the platform's tone.
   */
  public static let notificationSound = "kabmo_notification.wav"
  public static let attentionSound = "kabmo_attention.wav"

  /// Which chime an event carries. `ask` is the agent blocked on you, and must
  /// not sound like a finished run.
  public static func soundName(forKind kind: String) -> String {
    kind == "ask" ? attentionSound : notificationSound
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
