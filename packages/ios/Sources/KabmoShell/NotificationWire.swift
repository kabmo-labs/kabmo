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
   The chime a banner plays: the console's own two cues.

   The console stops playing its Web Audio cue inside a shell, so these names ARE
   the Kabmo notification sound on iOS. The files come from
   `packages/notification-sound/` and are copied into the bundle by
   `scripts/build-ipa.sh`; `UNNotificationSound` looks them up by name, and a
   name that drifts is not a crash — the platform silently falls back to its own
   tone. The test pins both strings for that reason.
   */
  public static let notificationSound = "kabmo_notification.wav"
  public static let attentionSound = "kabmo_attention.wav"

  /**
   Which chime an event carries.

   `ask` is the agent blocked on you, and it must not sound like a finished run:
   that distinction is the whole reason the console has two cues.
   */
  public static func soundName(forKind kind: String) -> String {
    kind == "ask" ? attentionSound : notificationSound
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
