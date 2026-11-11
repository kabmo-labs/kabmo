/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import Foundation
import UserNotifications

import KabmoDesktop

/**
 The macOS half of the console's system notifications.

 The console decides WHEN one is sent — three preferences, all off by default —
 and this file only talks to `UNUserNotificationCenter`. Permission is asked on
 `notification_request`, which the page sends when a notification preference is
 switched on, never at launch.

 The console sends a banner for every enabled event regardless of window state
 (only the Desktop / Mobile master switch and the event preference gate it), so
 `AppDelegate` installs a `willPresent` presentation: the platform's default is
 to SUPPRESS a notification for the app the user is looking at, which would make
 a focused Kabmo look broken.
 */
enum ShellNotifications {

  /// Ask the user, and answer with the platform's verdict.
  static func request() async -> Bool {
    await withCheckedContinuation { continuation in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
        continuation.resume(returning: granted)
      }
    }
  }

  /// Post one notification, replacing the earlier one with the same tag.
  static func show(title: String, body: String, tag: String, sessionId: String) async throws {
    let content = UNMutableNotificationContent()
    content.title = title.isEmpty ? "Kabmo" : title
    content.body = body
    content.sound = .default
    // What the click needs: the tap must land on the session the banner named.
    if !sessionId.isEmpty { content.userInfo = ["sessionId": sessionId] }
    let request = UNNotificationRequest(
      identifier: NotificationWire.identifier(tag: tag),
      content: content,
      // nil trigger: deliver now, because the console has already decided this
      // event is worth a banner.
      trigger: nil
    )
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      UNUserNotificationCenter.current().add(request) { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: ())
        }
      }
    }
  }
}
