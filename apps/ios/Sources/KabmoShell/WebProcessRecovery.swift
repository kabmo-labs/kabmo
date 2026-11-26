/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import Foundation

/**
 * What to load after the OS kills the web process.
 *
 * iOS reclaims a backgrounded app's memory by killing the WebContent process,
 * and `WKWebView` then holds no document at all: the view is still there, the
 * delegate is still installed, no navigation is in flight, and nothing redraws.
 * The result is a white window that never recovers — measured with the macOS
 * shell, which has the same engine and the same delegate contract, where
 * `kill -9` on `com.apple.WebKit.WebContent` left the window blank until the app
 * was quit.
 *
 * The rule is here, in the logic target, rather than inline in the delegate,
 * because it is a decision with two ways to be wrong and both are silent: an
 * address taken from the wrong source reloads a page the user was not on (or
 * nothing at all), and a `reload()` after a termination is a no-op because there
 * is no document left to reload.
 */
public enum WebProcessRecovery {

  /**
   The address to load after a termination, or nil when the shell has nothing to
   go back to.

   `shown` is the address the view had FINISHED loading, latched by the delegate:
   `webView.url` is the document being loaded, and after a termination it may be
   nil or stale. `current` is the view's own idea, used only when nothing was
   latched — a termination that lands before the first finish still leaves a
   console the user asked for.

   Only `http`/`https` are accepted: those are the only schemes the shell can load
   (the console is same-origin relative, and every WebSocket upgrade is
   origin-checked server-side), so anything else is a state the shell cannot
   recover into and reporting it as an address would produce a blank window with a
   load error instead of a blank window.
   */
  public static func address(shown: String?, current: String?) -> String? {
    for candidate in [shown, current] {
      guard let raw = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { continue }
      guard let url = URL(string: raw), let scheme = url.scheme?.lowercased() else { continue }
      guard scheme == "http" || scheme == "https" else { continue }
      guard url.host?.isEmpty == false else { continue }
      return raw
    }
    return nil
  }
}
