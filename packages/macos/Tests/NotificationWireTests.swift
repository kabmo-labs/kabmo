/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The notification commands' identifier rule.

 The console tags a notification by session, so a corrected reason replaces the
 earlier banner. An untagged call must still be unique — reusing an identifier
 would silently replace a banner that had nothing to do with it — and the test
 is the only place that distinction is visible, because both branches look like
 a working notification in the app.
 */
import Foundation

import KabmoDesktop

func notificationWireCases() {
  group("NotificationWire")

  // The bundle copies both files from `packages/notification-sound/` under these
  // exact names; a drift silently substitutes the platform tone.
  check(
    "the completion chime is the shared asset",
    NotificationWire.notificationSound == "kabmo_notification.wav"
  )
  check("the attention chime is the shared asset", NotificationWire.attentionSound == "kabmo_attention.wav")
  check(
    "an ask sounds like waiting for you, not like a finished run",
    NotificationWire.soundName(forKind: "ask") == "kabmo_attention.wav"
  )
  check("a finish plays the completion chime", NotificationWire.soundName(forKind: "finish") == "kabmo_notification.wav")
  check("an error plays the completion chime", NotificationWire.soundName(forKind: "error") == "kabmo_notification.wav")
  check(
    "a console too old to send a kind still gets a chime",
    NotificationWire.soundName(forKind: "") == "kabmo_notification.wav"
  )
  check("a tag is the identifier", NotificationWire.identifier(tag: "finish:s1") == "finish:s1")
  // The grant names travel verbatim: the page acts only on `denied`, and a
  // renamed string would make a blocked app look like a working one.
  check(
    "notDetermined is the never-asked state",
    NotificationWire.statusName(forRawValue: 0) == "notDetermined"
  )
  check("denied is the state the page acts on", NotificationWire.statusName(forRawValue: 1) == "denied")
  check("authorized is granted", NotificationWire.statusName(forRawValue: 2) == "granted")
  check("provisional still delivers", NotificationWire.statusName(forRawValue: 3) == "granted")
  check("ephemeral still delivers", NotificationWire.statusName(forRawValue: 4) == "granted")
  check(
    "an unknown raw value is not a refusal",
    NotificationWire.statusName(forRawValue: 99) == "unknown"
  )
  check(
    "a padded tag is trimmed",
    NotificationWire.identifier(tag: "  ask:s2 \n") == "ask:s2"
  )

  let empty = NotificationWire.identifier(tag: "")
  let blank = NotificationWire.identifier(tag: "   ")
  check("an untagged call still gets an identifier", !empty.isEmpty)
  check("and two untagged calls do not share one", empty != blank)

  check(
    "the tap script calls the page's opener with a plain id",
    NotificationWire.openSessionScript("abc-123")
      == "window.__kabmoOpenSession && window.__kabmoOpenSession(\"abc-123\")"
  )
  check(
    "a quote in the id is escaped, not interpolated",
    NotificationWire.openSessionScript("a\"b\nc").contains("a\\\"b\\nc")
  )
}
