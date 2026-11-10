#if canImport(UIKit)
import Foundation
import UserNotifications
import KabmoShell

/**
 The iOS half of the console's system notifications.

 The console decides WHEN one is sent — three preferences, all off by default —
 and this file only talks to `UNUserNotificationCenter`. Permission is asked on
 `notification_request`, which the page sends when a notification preference is
 switched on, never at launch: a fresh install must not be prompted for banners
 it has not chosen.
 */
enum ShellNotifications {

  /// Ask the user, and answer with the platform's verdict.
  ///
  /// A refusal is a `false`, not an error: the console only needs to know
  /// whether notifications can work, and the in-app badge remains the record
  /// either way.
  static func request(_ completion: @escaping (Bool) -> Void) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      DispatchQueue.main.async { completion(granted) }
    }
  }

  /// Post one notification, replacing the earlier one with the same tag.
  static func show(
    title: String,
    body: String,
    tag: String,
    sessionId: String,
    _ completion: @escaping (Result<Void, Error>) -> Void
  ) {
    let content = UNMutableNotificationContent()
    content.title = title.isEmpty ? "Kabmo" : title
    content.body = body
    content.sound = .default
    // A tap has to know WHICH session the banner was about. `userInfo` survives
    // the request and is what `AppDelegate` reads in `didReceive`.
    if !sessionId.isEmpty { content.userInfo = ["sessionId": sessionId] }
    let request = UNNotificationRequest(
      identifier: NotificationWire.identifier(tag: tag),
      content: content,
      // nil trigger: deliver now. The console has already decided this event is
      // worth a banner, and a scheduled delay would report it late.
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request) { error in
      DispatchQueue.main.async {
        if let error {
          completion(.failure(error))
        } else {
          completion(.success(()))
        }
      }
    }
  }
}
#endif
