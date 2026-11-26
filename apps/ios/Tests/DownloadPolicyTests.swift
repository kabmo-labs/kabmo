import Foundation

import KabmoShell

/// When a response is a file to save, rather than a page to draw.
///
/// The case that was reported: the pairing dialog's Download button did nothing
/// in the shell. `canShowMIMEType` is `true` for `image/png`, so the policy
/// allowed the response and the image was shown instead of saved. The header
/// that means "save this" is `Content-Disposition`.
enum DownloadPolicyTests {
  static func run() {
    Harness.group("DownloadPolicy")

    Harness.equal(
      "an image served as an attachment is a download",
      DownloadPolicy.shouldDownload(
        canShowMIMEType: true,
        contentDisposition: "attachment; filename=\"kabmo-pairing-qr.png\""
      ),
      true
    )
    Harness.equal(
      "a type the web view cannot render is a download",
      DownloadPolicy.shouldDownload(canShowMIMEType: false, contentDisposition: nil),
      true
    )
    Harness.equal(
      "an inline image is still a page",
      DownloadPolicy.shouldDownload(
        canShowMIMEType: true,
        contentDisposition: "inline; filename=\"preview.png\""
      ),
      false
    )
    Harness.equal(
      "no header and a renderable type is a page",
      DownloadPolicy.shouldDownload(canShowMIMEType: true, contentDisposition: nil),
      false
    )
    // The comparison must be on the DISPOSITION TYPE, not on any substring: a
    // filename containing "attachment" is not a disposition.
    Harness.equal(
      "the word inside a filename does not make it an attachment",
      DownloadPolicy.isAttachment("inline; filename=\"attachment-notes.txt\""),
      false
    )
  }
}
