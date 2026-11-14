import Foundation
import KabmoShell

/// The notification commands' wire.
///
/// The console settles its promise with these exact strings, so a renamed key is
/// silent: the setting reads "on" and the system never shows a banner. The
/// identifier rule is the other half — a tagged notification replaces an earlier
/// one for the same session, and an untagged call must still be unique rather
/// than replacing a stranger's banner.
enum NotificationWireTests {
  static func run() {
    Harness.group("NotificationWire")

    Harness.equal("granted true", NotificationWire.granted(true), "{\"granted\":true}")
    Harness.equal("granted false", NotificationWire.granted(false), "{\"granted\":false}")
    Harness.equal("shown true", NotificationWire.shown(true), "{\"shown\":true}")
    Harness.equal("shown false", NotificationWire.shown(false), "{\"shown\":false}")
    // The bundle copies both files from `packages/notification-sound/` under
    // these exact names; a drift silently substitutes the platform tone.
    Harness.equal("the completion chime is the shared asset", NotificationWire.notificationSound, "kabmo_notification.wav")
    Harness.equal("the attention chime is the shared asset", NotificationWire.attentionSound, "kabmo_attention.wav")
    Harness.equal(
      "an ask sounds like waiting for you, not like a finished run",
      NotificationWire.soundName(forKind: "ask"),
      "kabmo_attention.wav"
    )
    Harness.equal("a finish plays the completion chime", NotificationWire.soundName(forKind: "finish"), "kabmo_notification.wav")
    Harness.equal("an error plays the completion chime", NotificationWire.soundName(forKind: "error"), "kabmo_notification.wav")
    Harness.equal(
      "a console too old to send a kind still gets a chime",
      NotificationWire.soundName(forKind: ""),
      "kabmo_notification.wav"
    )

    Harness.equal("a tag is the identifier", NotificationWire.identifier(tag: "finish:s1"), "finish:s1")
    Harness.equal(
      "a padded tag is trimmed",
      NotificationWire.identifier(tag: "  ask:s2 \n"),
      "ask:s2"
    )
    let empty = NotificationWire.identifier(tag: "")
    Harness.check("an untagged call still gets an identifier", !empty.isEmpty)
    let other = NotificationWire.identifier(tag: "   ")
    Harness.check("and two untagged calls do not share one", empty != other)

    Harness.equal(
      "the tap script calls the page's opener with a plain id",
      NotificationWire.openSessionScript("abc-123"),
      "window.__kabmoOpenSession && window.__kabmoOpenSession(\"abc-123\")"
    )
    Harness.check(
      "a quote in the id is escaped, not interpolated",
      NotificationWire.openSessionScript("a\"b\nc").contains("a\\\"b\\nc")
    )
  }
}
