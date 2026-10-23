/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where a navigation goes: inside this window, or out to the system browser.
 *
 * ## Why this exists at all
 *
 * The macOS shell had NO navigation policy. `WKNavigationDelegate` was wired for
 * the splash — started, finished, failed — and nothing decided where a link
 * pointed, so every link replaced the console. That is a trap for the update
 * control the console now draws (its `url` is the RELEASE PAGE for a desktop
 * shell, because every desktop artifact is per-architecture and the server
 * cannot name one), and it was already wrong for the release notes, the social
 * links and every citation in a chat: a user following one lost Kabmo with no way
 * back except ⌘R.
 *
 * ## The rules, and why each is a table entry rather than a branch
 *
 * A same-origin link stays: the console is a single-page app whose own routes and
 * asset loads are same-origin by definition.
 *
 * Everything else — another host, another scheme — leaves for the system browser.
 * A non-http scheme (`mailto:`, `tel:`) has no page to load at all, so it is the
 * same answer.
 *
 * `about:blank` and a page with no origin are treated as INTERNAL. That is the
 * conservative direction: sending one out to a browser would break the OAuth
 * popup's own handshake, which is a blank frame before it navigates.
 *
 * Pure and injectable, so the rules are pinned without a window server — the same
 * reason `SplashState` and `ShellVersion` live in the testable target.
 */
import Foundation

/// One navigation's destination.
public enum NavigationTarget: Equatable {
  /// Load it in this window.
  case inside
  /// Hand it to the system browser.
  case external
}

/**
 * The schemes that are DOCUMENT content rather than destinations.
 *
 * `about:blank` is what a popup frame is before it navigates, `blob:` and `data:`
 * are documents the page built, and `javascript:` is a link handler. Handing any
 * of them to `NSWorkspace` would open nothing and — because the decision cancels
 * — would break the navigation that needed them.
 */
private let INTERNAL_SCHEMES: Set<String> = ["about", "blob", "data", "javascript"]

public enum NavigationPolicy {
  /// The decision for a navigation from `current` to `destination`.
  ///
  /// A destination with no scheme is INTERNAL: it is a relative reference, and
  /// resolving it is the web view's job (it already knows the base URL).
  public static func decide(from current: String?, to destination: String?) -> NavigationTarget {
    guard let destination, !destination.isEmpty else { return .inside }
    guard let scheme = scheme(of: destination) else { return .inside }

    if INTERNAL_SCHEMES.contains(scheme) { return .inside }

    // A scheme with no page behind it: the system owns it. `mailto:` and `tel:`
    // are the two a chat citation really produces, and neither has a `//`.
    guard scheme == "http" || scheme == "https" else { return .external }

    // A page with no comparable origin — the first load of a window, a frame
    // before its document exists — stays. See the type's own comment for why this
    // is the safe direction.
    guard let here = origin(of: current), let there = origin(of: destination) else { return .inside }

    return here == there ? .inside : .external
  }

  /// `scheme://host:port`, or nil when the string is not an absolute http(s) URL.
  ///
  /// Written by hand rather than with `URLComponents` so a malformed port is
  /// "no origin" instead of a throw, and so `https://x` and `https://x:443` — which
  /// `URLComponents` reports differently — compare equal, as a browser treats them.
  public static func origin(of url: String?) -> String? {
    guard let url, let scheme = scheme(of: url) else { return nil }
    guard scheme == "http" || scheme == "https" else { return nil }

    let afterScheme = url.dropFirst(scheme.count + 3)
    let authority = afterScheme.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
    guard !authority.isEmpty else { return nil }

    // A userinfo segment (`user:pass@host`) is not part of the origin.
    let hostPort = authority.contains("@") ? authority.split(separator: "@").last.map(String.init) ?? "" : String(authority)
    guard !hostPort.isEmpty else { return nil }

    let host = hostPort.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)[0].lowercased()
    guard !host.isEmpty else { return nil }

    let port = hostPort.contains(":") ? hostPort.split(separator: ":", maxSplits: 1)[1] : ""
    let defaultPort = scheme == "https" ? "443" : "80"
    // A DEFAULT port is spelled without it, so `https://x` and `https://x:443`
    // compare equal — as a browser treats them — while the value stays a URL a
    // reader can recognise.
    if port.isEmpty || port == Substring(defaultPort) { return "\(scheme)://\(host)" }

    return "\(scheme)://\(host):\(port)"
  }

  /// The lowercased scheme, or nil when there is none.
  ///
  /// Two shapes, because both are real destinations: `https://host/x` (with `//`)
  /// and `mailto:someone@example.test` (without). A leading `//` with no scheme —
  /// a protocol-relative URL — is NOT a scheme, and answering one would send a
  /// same-origin link out to a browser.
  static func scheme(of url: String) -> String? {
    if let separator = url.range(of: "://") {
      let scheme = url[..<separator.lowerBound].lowercased()
      return scheme.isEmpty ? nil : scheme
    }

    guard let colon = url.firstIndex(of: ":") else { return nil }
    let scheme = url[..<colon].lowercased()
    // A scheme is `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`, and `mailto` is
    // the one a chat citation produces. A colon with anything else before it —
    // `192.168.1.20:3000` — is a host and port, not a scheme.
    guard let first = scheme.first, first.isLetter else { return nil }
    let valid = scheme.allSatisfy { $0.isLetter || $0.isNumber || $0 == "+" || $0 == "-" || $0 == "." }
    return valid ? scheme : nil
  }
}
