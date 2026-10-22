#if canImport(UIKit)
import UIKit
import WebKit
import KabmoShell

/// Navigation policy: stay inside the server, hand everything else to the system.
///
/// Two behaviours here are not optional for Kabmo, and both fail silently with the
/// default handling:
///
/// - **`window.open` / `target="_blank"`.** The provider login dialog opens its
///   OAuth page that way (`window.open(frame.launchUrl, '_blank')`), and the
///   release-notes and social links in Settings do too. Without a
///   `WKUIDelegate` implementation those clicks do nothing.
/// - **External links.** A wiki page or a chat citation pointing at another site
///   must leave the shell, not replace Kabmo inside it — replacing it would put the
///   user in a page with no way back except a gesture that no longer exists.
///
/// The decisions are `LoadingState`'s (a reload is a reload) and `ShellUpdate`'s
/// (an IPA is not a download this platform can use); this class is the wiring.
final class ShellNavigationDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {

  /// The address the web view is showing, latched by `didFinish`.
  ///
  /// `webView.url` is the document being LOADED, not the one on screen, so it
  /// cannot answer "was this the same page?" — that answer has to be recorded when
  /// a load completes, before the next one starts.
  private var shownURL: String?

  /// The saved server origin, for the "is this ours" test.
  var serverURL: String?

  /// This build's version, for the IPA refusal's wording.
  var installedVersion: String = "0"

  /// The download policy. Held here because the decision arrives in this delegate and
  /// the transfer itself is a `WKDownload` this class has to hand over.
  var downloads: ShellDownloads?

  var onLoadStarted: ((String?, String?) -> Void)?
  var onLoadFinished: (() -> Void)?
  var onLoadFailed: ((LoadingState.Failure) -> Void)?
  var onCertificateProblem: ((String) -> Void)?
  var onOpenExternally: ((URL) -> Void)?

  // MARK: - WKNavigationDelegate

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }

    // A navigation the page started itself inside our origin is always allowed —
    // including `target="_blank"`, which arrives here as a link-activated action.
    let scheme = url.scheme?.lowercased()
    if scheme != "http" && scheme != "https" {
      // `mailto:`, `tel:`, an app link: the system's, never the web view's.
      onOpenExternally?(url)
      decisionHandler(.cancel)
      return
    }

    if ShellWebView.isInternal(url.absoluteString, server: serverURL) {
      // `target="_blank"` INSIDE the console (the OAuth popup's first hop) is
      // opened in the system browser by `createWebViewWith` below, so it is
      // cancelled here rather than loaded in a second window this shell does not
      // have.
      if navigationAction.targetFrame == nil {
        onOpenExternally?(url)
        decisionHandler(.cancel)
        return
      }
      decisionHandler(.allow)
      return
    }

    // An oauth callback may come back on a different origin; that still belongs to
    // the user's provider flow, so it opens in the browser too.
    onOpenExternally?(url)
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    // Reported, not decided: whether this is a reload is the state machine's call,
    // and it needs the phase.
    onLoadStarted?(webView.url?.absoluteString, shownURL)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // Latched HERE, not read from `webView.url` later: by the time the next
    // `didStartProvisionalNavigation` arrives the view already points at the
    // incoming document, so the comparison would match every navigation.
    shownURL = webView.url?.absoluteString
    onLoadFinished?()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    report(error)
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    report(error)
  }

  /// A failed load keeps the overlay up with a reason, and the main-frame test is
  /// what makes it usable: a page that loads but cannot reach one of its assets
  /// (a favicon, a CDN font) reports an error here too, and treating that as a
  /// failed page would cover a console that already works.
  ///
  /// `WKWebView` reports asset failures through `didFailProvisionalNavigation`
  /// only for the main frame — subresource failures never reach the navigation
  /// delegate — so the distinction is structural rather than a check here. What
  /// this DOES filter is a cancelled load, which is what a redirect or a
  /// `location.replace` reports and is not a failure.
  private func report(_ error: Error) {
    let code = (error as NSError).code
    if code == NSURLErrorCancelled { return }
    onLoadFailed?(LoadingState.failure(for: URLError.Code(rawValue: code)))
  }

  /// Authentication challenges, including an untrusted certificate.
  ///
  /// The default handling already cancels an untrusted certificate, but silently —
  /// the user sees a blank page. This reports it by name instead, which is the
  /// documented workaround for `--tls`'s self-signed certificate.
  func webView(
    _ webView: WKWebView,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    let host = challenge.protectionSpace.host
    let detail = "The certificate presented by \(host) was not issued by a trusted authority "
      + "(Kabmo's --tls mode is self-signed)."
    completionHandler(.cancelAuthenticationChallenge, nil)
    onCertificateProblem?(detail)
  }

  // MARK: - WKUIDelegate

  /// `window.open(url, '_blank')`.
  ///
  /// The URL opens in the system browser rather than a second web view: an OAuth
  /// flow ends on the provider's site, and the flow's own redirect is what brings
  /// the user back. Returning nil is required — there is no window to give.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url {
      onOpenExternally?(url)
    }
    return nil
  }

  /// The composer's 📎 attach button.
  ///
  /// Handled by the view controller, because only a presented
  /// `UIDocumentPickerViewController` can answer it — and on iOS the picker's
  /// completion is a closure, not a callback on the delegate.
  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    // Kabmo draws its own dialogs; a page-level `alert()` only reaches here from a
    // plugin or a stray `console`-adjacent call, and swallowing it would leave the
    // page waiting forever.
    completionHandler()
  }

  // MARK: - Downloads

  /// A response the web view cannot render — the editor's Download button.
  ///
  /// `ShellDownloads` owns the three outcomes: an IPA is refused (iOS cannot install
  /// it), a navigable type is allowed, and anything else becomes a `WKDownload` so the
  /// request carries the session cookie. Handing the URL to Safari instead would fetch
  /// the LOGIN PAGE, which reads as a corrupt file.
  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    guard let downloads else {
      decisionHandler(.allow)
      return
    }
    decisionHandler(downloads.policy(for: navigationResponse, installedVersion: installedVersion))
  }

  /// A download started from a navigation ACTION (a link with `download`, or a form
  /// post) rather than from a response the web view could not render.
  func webView(
    _ webView: WKWebView,
    navigationAction: WKNavigationAction,
    didBecome download: WKDownload
  ) {
    download.delegate = downloads
  }

  /// A download started from a response — the path `decidePolicyFor` returns
  /// `.download` for. Without this the transfer has no delegate and its destination is
  /// never chosen, so it fails silently.
  func webView(
    _ webView: WKWebView,
    navigationResponse: WKNavigationResponse,
    didBecome download: WKDownload
  ) {
    download.delegate = downloads
  }
}
#endif
