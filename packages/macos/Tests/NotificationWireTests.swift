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

  check("a tag is the identifier", NotificationWire.identifier(tag: "finish:s1") == "finish:s1")
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
