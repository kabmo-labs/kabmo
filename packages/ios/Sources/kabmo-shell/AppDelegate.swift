#if canImport(UIKit)
import UIKit

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

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem,
       item.type == Self.openSettingsShortcut {
      pendingShortcut = true
    }

    let window = UIWindow(frame: UIScreen.main.bounds)
    let shell = ShellViewController()
    window.rootViewController = shell
    window.backgroundColor = Palette.paper
    window.makeKeyAndVisible()
    self.window = window

    if pendingShortcut {
      pendingShortcut = false
      shell.handleShortcut()
    }

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
#endif
