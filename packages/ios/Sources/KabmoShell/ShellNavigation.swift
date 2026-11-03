import Foundation

/// Where one navigation goes, as a pure rule.
///
/// The Swift twin of `NavigationPolicy` in `packages/macos`, and deliberately the
/// same table — a URL one shell keeps inside and the other sends to Safari would
/// be two products. It lives in the LOGIC target because the UIKit delegate that
/// calls it cannot be exercised on a Mac (`#if canImport(UIKit)`), while this
/// decision is exactly the kind that fails silently: nothing throws, a page just
/// appears somewhere else.
///
/// The case that made it necessary: the console embeds the user's own browser as
/// an `<iframe>` (`components/workspace/user-browser-panel/`). `decidePolicyFor`
/// is called for subframe navigations too — measured in a real `WKWebView`, an
/// iframe navigating cross-origin arrives with `targetFrame?.isMainFrame == false`
/// — so an origin test alone sent every URL typed into that panel to the browser.
public enum ShellNavigation {

  /// Where a navigation goes.
  public enum Target: Equatable {
    /// Load it in this web view.
    case inside
    /// Hand it to the system browser.
    case external
  }

  /// The frame the navigation lands in.
  ///
  /// `newWindow` is its own case because WebKit asks twice for one click: a
  /// `target="_blank"` anchor arrives at `decidePolicyFor` with NO target frame and
  /// also reaches `createWebViewWith`. The shell opens those in the UI delegate, so
  /// answering `inside` here is what keeps one click from opening two browsers.
  public enum Frame: Equatable {
    /// The document itself.
    case main
    /// An embedded frame.
    case subframe
    /// A popup this shell does not host.
    case newWindow
  }

  /// The schemes that are DOCUMENT content rather than destinations.
  ///
  /// `about:blank` is what a popup frame is before it navigates, and `blob:` and
  /// `data:` are documents the page built. Handing any of them to the system would
  /// open nothing and — because the decision cancels — break the navigation that
  /// needed them.
  private static let internalSchemes: Set<String> = ["about", "blob", "data", "javascript"]

  /**
   The decision for a navigation.

   - Parameters:
     - destination: the address being navigated to.
     - server: the shell's own server origin, from `ShellWebView.isInternal`.
     - frame: which frame it lands in.
   */
  public static func decide(
    to destination: String?,
    server: String?,
    frame: Frame,
    scheme: String? = nil
  ) -> Target {
    // A frame is never a place to leave from, and a popup belongs to the UI
    // delegate: whatever an embedded page does is that page's own content.
    if frame != .main { return .inside }

    guard let destination, !destination.isEmpty else { return .inside }
    let resolvedScheme = (scheme ?? URLComponents(string: destination)?.scheme)?.lowercased()
    guard let resolvedScheme else { return .inside }
    if internalSchemes.contains(resolvedScheme) { return .inside }

    // A scheme with no page behind it — `mailto:`, `tel:`, an app link — is the
    // system's.
    guard resolvedScheme == "http" || resolvedScheme == "https" else { return .external }

    // Same origin stays; another one leaves. A server that cannot be compared (a
    // shell with no saved server yet) keeps its own navigation, which is the
    // conservative direction while the first page loads.
    guard let serverOrigin = URLComponents(string: server ?? "")?.origin,
      let destinationOrigin = URLComponents(string: destination)?.origin
    else { return .inside }

    return serverOrigin == destinationOrigin ? .inside : .external
  }
}

/// `scheme://host[:port]`, with a DEFAULT port spelled without it.
///
/// Written here rather than through `URLComponents.host`/`.port` so the two
/// spellings a browser treats as equal — `https://x` and `https://x:443` — compare
/// equal here too, and so a value with no authority answers nil instead of a
/// half-built string.
extension URLComponents {
  /// The comparable origin of these components, or nil when there is none.
  public var origin: String? {
    guard let scheme = scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
    guard let host = host?.lowercased(), !host.isEmpty else { return nil }
    let defaultPort = scheme == "https" ? 443 : 80
    guard let port, port != defaultPort else { return "\(scheme)://\(host)" }
    return "\(scheme)://\(host):\(port)"
  }
}
