/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Page zoom: the arithmetic, and the key it is remembered under.
 *
 * `webView.pageZoom` is a property of the VIEW, and it is reset by every
 * navigation — so a reload (⌘R, the shell's own recovery, a server restart) put
 * the page back at 100% for a user who had zoomed in to read the timeline. The
 * shell keeps one value per HOST in `UserDefaults`, applied on `didFinish`.
 *
 * Pure values, pinned by the logic suite: a clamp that lets 0.1 through makes
 * the console illegible, and a step that is applied twice per press is a key that
 * jumps.
 */

import CoreGraphics
import Foundation

public enum ZoomStore {
  public static let defaultZoom: CGFloat = 1
  public static let minZoom: CGFloat = 0.5
  public static let maxZoom: CGFloat = 3
  /// The step a press applies. 10% reads as a visible change without overshooting.
  public static let stepFactor: CGFloat = 1.1

  /// Fit a value into the supported range. NaN is not a zoom level.
  public static func clamp(_ value: CGFloat) -> CGFloat {
    guard value.isFinite else { return defaultZoom }
    return Swift.min(Swift.max(value, minZoom), maxZoom)
  }

  public static func zoomedIn(_ value: CGFloat) -> CGFloat {
    clamp(clamp(value) * stepFactor)
  }

  public static func zoomedOut(_ value: CGFloat) -> CGFloat {
    clamp(clamp(value) / stepFactor)
  }

  /**
   The `UserDefaults` key a host's zoom is stored under.

   Host and port, lowercased: the same console served over http and https is a
   different address, and a zoom set on one must not leak onto the other. An
   empty or unchanged host (the splash's `about:blank`) still needs a key that
   cannot collide with a real one, so it is prefixed and skipped by the caller.
   */
  public static func key(forHost host: String) -> String {
    "zoom.\(host.trimmingCharacters(in: .whitespaces).lowercased())"
  }

  /// The host of a URL string, or nil when there is nothing to key on.
  public static func host(of urlString: String?) -> String? {
    guard let urlString, !urlString.isEmpty, let host = URL(string: urlString)?.host, !host.isEmpty else {
      return nil
    }
    if let port = URL(string: urlString)?.port { return "\(host):\(port)" }
    return host
  }
}
