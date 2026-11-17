/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import AppKit
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

  /**
   The current grant, WITHOUT prompting.

   The page reads this at boot and whenever the Notifications page is focused:
   a denied grant means the platform drops every banner and its chime, so the
   console must keep its own cue and say that the system is blocking it. Asking
   here would be wrong — a prompt nobody requested is exactly what the
   shipped-false preferences exist to avoid.
   */
  static func state() async -> [String: Any] {
    let status = await withCheckedContinuation { (continuation: CheckedContinuation<String, Never>) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        continuation.resume(
          returning: NotificationWire.statusName(forRawValue: settings.authorizationStatus.rawValue)
        )
      }
    }
    return ["status": status, "canOpenSettings": true]
  }

  /**
   Open the pane that owns this app's grant.

   The Notifications pane, not the app's own page: macOS lists Kabmo there, and
   that is the switch the user has to flip. A refusal is reported so the button
   that calls this is never a silent no-op.
   */
  static func openSettings() -> Bool {
    guard let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") else {
      return false
    }
    return NSWorkspace.shared.open(url)
  }

  /// Post one notification, replacing the earlier one with the same tag.
  static func show(
    title: String,
    body: String,
    kind: String,
    tag: String,
    sessionId: String
  ) async throws {
    let content = UNMutableNotificationContent()
    content.title = title.isEmpty ? "Kabmo" : title
    content.body = body
    content.sound = UNNotificationSound(
      named: UNNotificationSoundName(NotificationWire.soundName(forKind: kind))
    )
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
