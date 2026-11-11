#if canImport(UIKit)
import UIKit
import UserNotifications

/// The app delegate, on the LEGACY app lifecycle.
///
/// No `UIApplicationSceneManifest` in `Info.plist`, so UIKit hands this delegate a
/// window and there is exactly one scene. That is the right shape for a shell with
/// one window: scene support would add a delegate whose only job is to create the
/// same window, and iPad multi-window would open a second shell onto the same
/// server with its own cookie store.
///
/// Thin on purpose — the shell is `ShellViewController`. This exists for the one
/// thing a view controller cannot receive: a Home Screen quick action, which
/// arrives as a launch option before any window exists.
final class AppDelegate: UIResponder, UIApplicationDelegate {

  /// The quick action the shortcut sends; must match the
  /// `UIApplicationShortcutItemType` in `Info.plist` and
  /// `ShellViewController.openSettingsShortcut`.
  static let openSettingsShortcut = "dev.kabmo.shell.openSettings"

  var window: UIWindow?

  /// A shortcut that launched the app, held until the window exists.
  ///
  /// `didFinishLaunchingWithOptions` runs before `window` is shown, so there is no
  /// view controller to hand this to yet. A shortcut pressed while the app is
  /// already running arrives through `application(_:performActionFor:)` instead,
  /// because a running app receives no launch options at all.
  private var pendingShortcut = false

  /// A document that launched the app, held until the window exists.
  ///
  /// The same shape as `pendingShortcut`, for the same reason: `didFinishLaunching`
  /// runs before there is a view controller to hand anything to, and a file
  /// opened while the app is already running arrives through
  /// `application(_:open:options:)` instead — a running app receives no launch
  /// options at all.
  private var pendingDocument: URL?

  /// The session a notification tap named, held until the shell exists.
  private var pendingNotification: String?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem,
       item.type == Self.openSettingsShortcut {
      pendingShortcut = true
    }
    // A launch by DOCUMENT does not arrive here at all — it comes through
    // `application(_:open:options:)` below, which UIKit calls after this returns.
    // The queue therefore lives in the view controller, which exists by then.

    let window = UIWindow(frame: UIScreen.main.bounds)
    let shell = ShellViewController()
    window.rootViewController = shell
    window.backgroundColor = Palette.paper
    window.makeKeyAndVisible()
    self.window = window

    // Set before `didFinishLaunching` returns: a launch BY notification delivers
    // its response after this method, and a delegate set later would never see
    // the tap that started the app.
    UNUserNotificationCenter.current().delegate = self
    if let pendingNotification {
      shell.openNotificationSession(pendingNotification)
      self.pendingNotification = nil
    }

    if pendingShortcut {
      pendingShortcut = false
      shell.handleShortcut()
    }
    if let document = pendingDocument {
      pendingDocument = nil
      shell.openDocument(at: document)
    }

    return true
  }

  /// A document another app opened with Kabmo ("Open in Kabmo", a share sheet).
  ///
  /// UIKit calls this AFTER `didFinishLaunching` on a cold start, so the window
  /// and its view controller exist by now — no queue is needed here, only a
  /// forward. The view controller owns the queue, because a page that has not
  /// loaded yet cannot take the bytes.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    guard let shell = window?.rootViewController as? ShellViewController else {
      // Nothing to hand it to (a scene-less launch still finishing). Held so the
      // document is not silently dropped.
      pendingDocument = url
      return true
    }
    shell.openDocument(at: url)
    return true
  }

  /// A quick action pressed while the app is in the foreground or background.
  func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard shortcutItem.type == Self.openSettingsShortcut else {
      completionHandler(false)
      return
    }
    (window?.rootViewController as? ShellViewController)?.handleShortcut()
    completionHandler(true)
  }
}

extension AppDelegate: UNUserNotificationCenterDelegate {

  /**
   Present the banner even while Kabmo is the active app.

   The console sends a notification for every enabled event whether or not the
   window has focus; without this the platform default (suppress for the
   foreground app) swallows it. `.list` keeps it in Notification Centre.
   */
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  /**
   The user CLICKED a notification.

   The tap is what makes a banner useful: it has to land on the session the
   banner was about, not on whichever chat happened to be on screen. The session
   id rides `userInfo`, and the controller queues it until the console exists —
   a launch by notification has no page yet.
   */
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let session = response.notification.request.content.userInfo["sessionId"] as? String
    DispatchQueue.main.async { [weak self] in
      guard let self, let session, !session.isEmpty else { return }
      if let shell = self.window?.rootViewController as? ShellViewController {
        shell.openNotificationSession(session)
      } else {
        self.pendingNotification = session
      }
    }
    completionHandler()
  }
}
#endif
