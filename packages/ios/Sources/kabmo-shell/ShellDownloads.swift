#if canImport(UIKit)
import UIKit
import WebKit
import KabmoShell

/// Downloads from the editor's "Download" button.
///
/// Kabmo serves the file from its own origin, and that origin is authenticated by an
/// `HttpOnly` session cookie. Handing the URL to Safari would therefore fetch the
/// LOGIN PAGE — which looks like a corrupt file rather than an authorization failure.
/// That is exactly the bug `packages/android`'s `KabmoDownloads` exists to prevent,
/// and the fix is the same in spirit: keep the request inside the process that holds
/// the cookie.
///
/// iOS's equivalent is `WKDownload` (14.5+): it performs the transfer with the web
/// view's own cookie store, and its delegate receives the finished file. The file is
/// then offered through the system share sheet, which is where "save to Files" lives
/// — the platform's Downloads folder equivalent.
///
/// An IPA is deliberately NOT downloaded: `ShellUpdate` refuses it, because iOS
/// cannot install an app from a file and writing one would be a dead end that looks
/// like progress.
final class ShellDownloads: NSObject, WKDownloadDelegate {

  /// The view controller to present the share sheet from.
  weak var presenter: UIViewController?

  /// Called when a download cannot start, so the shell can say why.
  var onFailure: ((String) -> Void)?

  /// A destination per download, keyed by the temp URL WebKit hands out.
  ///
  /// WebKit asks for a destination BEFORE the bytes arrive, and the share sheet needs
  /// the file to exist — so the name is recorded here and the finished file is moved
  /// to the app's Documents directory, where it survives the share sheet's dismissal.
  private var destinations: [ObjectIdentifier: URL] = [:]

  // MARK: - Starting

  /// A response the web view cannot render.
  ///
  /// Three outcomes, and the order matters:
  ///
  /// 1. **An IPA** is cancelled with the release page — the one case this platform
  ///    cannot finish, and `ShellUpdate` owns the decision.
  /// 2. **A navigable type** is allowed, so a PDF or an image still opens in place.
  /// 3. **Anything else** becomes a `WKDownload`, which is what carries the session
  ///    cookie.
  func policy(
    for response: WKNavigationResponse,
    installedVersion: String
  ) -> WKNavigationResponsePolicy {
    guard !response.canShowMIMEType else { return .allow }

    let url = response.response.url
    let disposition = (response.response as? HTTPURLResponse)?
      .value(forHTTPHeaderField: "Content-Disposition")

    if let url, ShellUpdate.isIPADownload(url: url.absoluteString, contentDisposition: disposition) {
      reportIPADownload(url: url, installedVersion: installedVersion)
      return .cancel
    }

    return .download
  }

  /// The IPA refusal, as one alert.
  ///
  /// The sentence names the platform's limit rather than blaming the user: an IPA is
  /// a real build, and the only thing missing is a way to install it from here.
  private func reportIPADownload(url: URL, installedVersion: String) {
    let decision = ShellUpdate.action(
      url: url.absoluteString,
      installedVersion: installedVersion
    )
    let reason: String
    switch decision {
    case let .openReleasePage(value): reason = value
    case .openExternally: reason = "needsStore"
    }

    let body = reason == "alreadyCurrent"
      ? "This build of Kabmo is already up to date."
      : "iOS cannot install an app from a web page. Open the release page to install the new build through TestFlight or Xcode."
    onFailure?(body)
  }

  // MARK: - WKDownloadDelegate

  /// Where to put the file while it is arriving.
  ///
  /// The app's Caches directory, not Documents: a partial file must never look like a
  /// saved one, and the finished file is moved once the transfer completes.
  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let name = ShellUpdate.safeFileName(suggestedFilename, fallback: response.url?.lastPathComponent)
    let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Downloads", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

    let target = directory.appendingPathComponent(name)
    // One download at a time is the console's own shape; replacing a stale partial
    // file is better than failing the new one because an old attempt left something.
    try? FileManager.default.removeItem(at: target)
    destinations[ObjectIdentifier(download)] = target
    completionHandler(target)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let source = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
    present(source)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    destinations.removeValue(forKey: ObjectIdentifier(download))
    onFailure?("The file could not be downloaded. \(error.localizedDescription)")
  }

  // MARK: - The share sheet

  /// Offer the finished file to the system.
  ///
  /// A share sheet rather than writing straight into the app's Documents: a download
  /// from the console is something the user wants OUT of Kabmo — in Files, in another
  /// app — and the sheet is the platform's own answer to "where".
  private func present(_ url: URL) {
    guard let presenter else { return }
    let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    // iPad anchors a popover to a view; without one it traps at presentation time.
    sheet.popoverPresentationController?.sourceView = presenter.view
    sheet.popoverPresentationController?.sourceRect = CGRect(
      x: presenter.view.bounds.midX,
      y: presenter.view.bounds.maxY - 44,
      width: 1,
      height: 1
    )
    presenter.present(sheet, animated: true)
  }
}
#endif
