/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * When a response is a file the host should save, rather than a page it draws.
 *
 * `canShowMIMEType` is not enough. A PNG, a PDF and a text file are all
 * renderable, so a server that answers `Content-Disposition: attachment` — the
 * header that MEANS "save this" — was shown in place and nothing reached the
 * share sheet. Measured on WebKit: the response to an attachment link reports
 * `canShowMIMEType == true` for `image/png`, which is why the pairing dialog's
 * downloaded QR was reported as "the button does not work in the shell".
 *
 * Pure, so the rule is pinned on a Mac without a device (the app target is
 * `#if canImport(UIKit)` and cannot be run here).
 */

public enum DownloadPolicy {

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

  /// Whether the web view must download this response instead of displaying it.
  public static func shouldDownload(canShowMIMEType: Bool, contentDisposition: String?) -> Bool {
    if !canShowMIMEType { return true }
    return isAttachment(contentDisposition)
  }
}
