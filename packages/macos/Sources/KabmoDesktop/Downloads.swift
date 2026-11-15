/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A download the page asked for, saved where the user can find it.
 *
 * The macOS shell had no download handling at all: a `WKWebView` does not start
 * a transfer on its own, and `WKNavigationResponsePolicy.download` without a
 * `WKDownloadDelegate` fails with no destination — so a link that saved a file
 * in a browser did nothing here. That is the same shape as the earlier
 * "`<input type=file>` is silently cancelled without a UI delegate" bug, and it
 * made the pairing dialog's Download control dead in the shell while the web
 * console worked.
 *
 * The file goes to **~/Downloads**, not a per-app directory: a downloaded image
 * is something the user asked to have OUTSIDE the app, and a name that collides
 * with an existing file is suffixed rather than replacing it.
 */

import Foundation
import WebKit

/// Where a finished download goes, and under what name.
public enum DownloadFile {
  /// A file name safe for every filesystem this shell runs on.
  ///
  /// The server sends `Content-Disposition: attachment; filename="…"`, but the
  /// name reaches WebKit's `suggestedFilename` and is used as a path component:
  /// a name carrying `/` or `..` would escape the Downloads directory.
  public static func safeName(_ suggested: String?, fallback: String = "download") -> String {
    let base = (suggested ?? "").split(separator: "/").last.map(String.init) ?? ""
    let cleaned = base.replacingOccurrences(of: "..", with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? fallback : cleaned
  }

  /// Whether `Content-Disposition` marks the response as an attachment.
  ///
  /// The DISPOSITION TYPE is compared, not the header text: a filename may
  /// contain the word (`inline; filename="attachment-notes.txt"`), and treating
  /// that as an attachment would save a page the user asked to open.
  public static func isAttachment(_ contentDisposition: String?) -> Bool {
    guard let contentDisposition else { return false }
    let type = contentDisposition.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false)[0]
    return type.trimmingCharacters(in: .whitespaces).lowercased() == "attachment"
  }

  /// `name.png` → `name 2.png` when `name.png` is taken.
  ///
  /// A duplicate is never overwritten: the file in Downloads may be the user's
  /// own, and a download that silently replaced it would be data loss.
  public static func uniqueURL(
    name: String,
    directory: URL,
    exists: (URL) -> Bool = { FileManager.default.fileExists(atPath: $0.path) }
  ) -> URL {
    let candidate = directory.appendingPathComponent(name)
    if !exists(candidate) { return candidate }

    let withoutExtension = (name as NSString).deletingPathExtension
    let extensionPart = (name as NSString).pathExtension
    var index = 2
    while true {
      let numbered = extensionPart.isEmpty ? "\(withoutExtension) \(index)" : "\(withoutExtension) \(index).\(extensionPart)"
      let next = directory.appendingPathComponent(numbered)
      if !exists(next) { return next }
      index += 1
    }
  }

  /// The user's Downloads folder, or home when the system does not report one.
  public static func directory() -> URL {
    FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
      ?? FileManager.default.homeDirectoryForCurrentUser
  }
}

/// The `WKDownloadDelegate` the web view hands a transfer to.
public final class ShellDownloads: NSObject, WKDownloadDelegate {
  private let directory: URL
  /// The destination chosen per transfer, keyed by the `WKDownload` identity.
  private var destinations: [ObjectIdentifier: URL] = [:]

  /// Called with the finished file, on the main thread.
  public var onFinish: ((URL) -> Void)?
  /// Called with a sentence when a transfer fails, on the main thread.
  public var onFailure: ((String) -> Void)?

  public init(directory: URL = DownloadFile.directory()) {
    self.directory = directory
    super.init()
  }

  public func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let name = DownloadFile.safeName(suggestedFilename)
    let target = DownloadFile.uniqueURL(
      name: name,
      directory: directory,
      exists: { FileManager.default.fileExists(atPath: $0.path) }
    )
    destinations[ObjectIdentifier(download)] = target
    completionHandler(target)
  }

  public func downloadDidFinish(_ download: WKDownload) {
    guard let file = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
    onFinish?(file)
  }

  public func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    destinations.removeValue(forKey: ObjectIdentifier(download))
    onFailure?("The file could not be downloaded. \(error.localizedDescription)")
  }
}
