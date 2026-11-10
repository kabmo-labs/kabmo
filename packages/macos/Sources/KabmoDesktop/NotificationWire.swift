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
