#if canImport(UIKit)
import UIKit
import WebKit
import KabmoShell

/// Everything the web view needs, in one place.
///
/// Several of these look like hardening but are correctness requirements for THIS
/// app, and each is explained where it sits.
enum ShellWebView {

  /// The configuration a console web view is built from.
  ///
  /// A FUNCTION rather than a mutator, because one of these settings cannot be
  /// applied to a web view that already exists: `applicationNameForUserAgent` is
  /// read when the web view is created, and a value assigned afterwards is ignored
  /// with no error. Building the configuration first is what makes the UA token
  /// arrive on the very FIRST request — the one that renders the shell.
  static func makeConfiguration(version: String) -> WKWebViewConfiguration {
    let configuration = WKWebViewConfiguration()

    // Kabmo keeps drafts in `sessionStorage` and the plugin runtime probes storage
    // availability; the default data store already persists both, and naming it
    // makes the intent explicit.
    configuration.websiteDataStore = .default()

    // The console is a single-page Preact bundle, so JS and inline media are not
    // optional. `allowsInlineMediaPlayback` is what keeps a mermaid diagram or an
    // embedded video from taking over the screen, and `mediaTypesRequiringUserActionForPlayback
    // = []` is what lets a plugin's own audio play without a tap.
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.allowsInlineMediaPlayback = true
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true

    // The UA is deliberately NOT replaced: the platform's own carries `iPhone` or
    // `iPad` plus `Safari`, which is what the server's `MOBILE_UA` hint and the
    // client's own detector read to pick the phone layout. Replacing it would render
    // the DESKTOP console on a phone.
    //
    // `applicationNameForUserAgent` APPENDS one token to the default, which is
    // exactly what this shell needs — and it is why this module does not read
    // `navigator.userAgent` from a probe web view: that read is asynchronous (or
    // deprecated, in its synchronous form), and the token has to be in place before
    // the first navigation either way.
    configuration.applicationNameForUserAgent = ShellUserAgent.token(version: version)

    return configuration
  }

  /// Apply the settings that CAN be changed on a live web view.
  ///
  /// - Parameters:
  ///   - webView: the view to configure.
  ///   - zoomPercent: the saved page zoom, applied as `pageZoom`.
  static func configure(_ webView: WKWebView, zoomPercent: Int) {
    // Page zoom, not text zoom. `pageZoom` scales the whole page — layout included
    // — which is what the slider promises. Android's `textZoom` equivalent (which
    // reflows text only) was deliberately not used there for the same reason.
    webView.pageZoom = CGFloat(ShellSettings.pageZoom(for: zoomPercent))

    // The console paints its own paper; the web view's default white flashes
    // between the launch frame and the first paint.
    webView.isOpaque = false
    webView.backgroundColor = Palette.paper
    webView.scrollView.backgroundColor = Palette.paper

    // A bounce at the top of the transcript is the platform's own gesture; the
    // console owns its scrolling, and the rubber band makes the fixed composer look
    // detached from the page.
    webView.scrollView.bounces = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never

    // Text selection drives the app's own copy buttons, and long-press must reach
    // the page rather than the native callout.
    webView.isUserInteractionEnabled = true
  }

  /// Origin of a URL, or nil when it cannot be parsed.
  static func origin(of url: String) -> String? {
    guard let components = URLComponents(string: url),
          let scheme = components.scheme?.lowercased(),
          let host = components.host
    else { return nil }
    let port = components.port.map { ":\($0)" } ?? ""
    return "\(scheme)://\(host.lowercased())\(port)"
  }

  /// Whether a URL stays inside the shell's server.
  ///
  /// The comparison is on the ORIGIN, never on a prefix of the string:
  /// `http://host:3000.evil.example` starts with the server's address and is a
  /// different server.
  static func isInternal(_ url: String, server: String?) -> Bool {
    guard let server, let serverOrigin = origin(of: server) else { return false }
    return origin(of: url) == serverOrigin
  }
}
#endif
