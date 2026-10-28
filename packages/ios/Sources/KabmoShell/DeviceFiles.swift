/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A document the OS handed to Kabmo on iOS, and how it crosses to the page.
 *
 * The desktop shells hand over a PATH and the server opens it — they are on the
 * same machine. A phone is not: Kabmo there is a client of a console that may be
 * across the room, so a file picked in the Files app exists only on the DEVICE
 * and the server can never read it.
 *
 * So the bytes travel through the page: the shell reads the URL, base64-encodes
 * the file and pushes it in chunks, and the tab is READ-ONLY — the honest model,
 * and what the editor's own banner says.
 *
 * The rules live here, in the testable target, for the reason `LoadingState`
 * does: every one of them fails SILENTLY on a device (an extensionless name opens
 * in the code editor instead of its viewer, a chunk cut inside a base64 group
 * corrupts the document, a name with a quote breaks the script that carries it),
 * and this file runs on a plain Mac with no simulator.
 */

import Foundation

/// The rules for one delivered document.
public enum DeviceFiles {
  /// How many base64 characters travel per `evaluateJavaScript` call.
  ///
  /// 64 KiB is ~48 KiB of file per call: small enough that no single call is a
  /// visible pause in the page, large enough that a 20 MiB document is ~430 calls
  /// rather than thousands.
  public static let chunkChars = 64 * 1024

  /// The display name for a delivered file.
  ///
  /// Three sources, because a file URL from another app is not always what it
  /// looks like: `lastPathComponent` (the real name), the URL's `suggestedFilename`
  /// (what a provider offers), and a fallback. A name with no extension is a real
  /// case, and the extension is what decides which VIEWER opens — so the fallback
  /// appends the MIME type's own extension when one is known. A name that already
  /// carries a dot is left alone: `report.final.pdf` is not `report.final`.
  public static func displayName(
    resolved: String?,
    suggested: String?,
    mimeType: String?,
    fallback: String = "document"
  ) -> String {
    let candidates = [resolved, suggested]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && $0 != "/" }
    let candidate = candidates.first ?? fallback
    if candidate.contains(".") { return candidate }
    guard let ext = extensionFor(mimeType: mimeType) else { return candidate }
    return "\(candidate).\(ext)"
  }

  /// A file extension for a MIME type, or nil when there is no obvious one.
  ///
  /// Deliberately small and explicit: this exists to give an EXTENSIONLESS name a
  /// suffix the editor's classifier can read, not to be a MIME database. A type
  /// not listed keeps the name it was given, because guessing `bin` would open
  /// the file as text.
  public static func extensionFor(mimeType: String?) -> String? {
    guard let mimeType else { return nil }
    switch mimeType.trimmingCharacters(in: .whitespaces).lowercased() {
    case "application/pdf": return "pdf"
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx"
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "xlsx"
    case "application/vnd.ms-excel.sheet.macroenabled.12": return "xlsm"
    case "text/markdown", "text/x-markdown": return "md"
    case "text/csv": return "csv"
    case "text/tab-separated-values": return "tsv"
    case "image/svg+xml": return "svg"
    case "image/png": return "png"
    case "image/jpeg": return "jpg"
    case "image/gif": return "gif"
    case "image/webp": return "webp"
    case "text/plain": return "txt"
    case "application/json": return "json"
    default: return nil
    }
  }

  /// A MIME type from a file name, for the page's own classification.
  ///
  /// The inverse of `extensionFor`, and it exists because iOS hands over a URL
  /// and not a type: the page gets `mimeType` only when the shell can name one,
  /// and an unnamed type is fine — the extension is what the classifier reads.
  public static func mimeType(forExtension ext: String) -> String? {
    switch ext.lowercased() {
    case "pdf": return "application/pdf"
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    case "xlsm": return "application/vnd.ms-excel.sheet.macroEnabled.12"
    case "md", "markdown", "mdx": return "text/markdown"
    case "csv": return "text/csv"
    case "tsv": return "text/tab-separated-values"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "gif": return "image/gif"
    case "webp": return "image/webp"
    case "txt", "log", "text": return "text/plain"
    case "json": return "application/json"
    default: return nil
    }
  }

  /// The id one delivery is keyed by.
  ///
  /// A counter rather than the URL: opening the SAME file twice must open two
  /// tabs, and the page keys its byte registry by this id.
  public static func deliveryId(counter: Int) -> String { "device-\(counter)" }

  /// What the shell tells the page about one file, before the bytes.
  public struct Meta: Equatable {
    public let id: String
    public let name: String
    public let mimeType: String?
    public let size: Int

    public init(id: String, name: String, mimeType: String?, size: Int) {
      self.id = id
      self.name = name
      self.mimeType = mimeType
      self.size = size
    }
  }

  /// The JavaScript that announces files.
  ///
  /// Built with `JSONSerialization`, never interpolation: a filename may contain
  /// a quote or a backslash, and the encoder is the only thing standing between
  /// `a"b.pdf` and a broken script.
  public static func announceScript(_ metas: [Meta]) -> String {
    let objects: [[String: Any]] = metas.map { meta in
      var entry: [String: Any] = ["id": meta.id, "name": meta.name, "size": meta.size]
      if let mimeType = meta.mimeType { entry["mimeType"] = mimeType }
      return entry
    }
    let json = (try? JSONSerialization.data(withJSONObject: objects))
      .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    return "window.__kabmoOpenFiles && window.__kabmoOpenFiles(\(json))"
  }

  /// One chunk of a delivery. `last` closes it, and only then does the page decode.
  public static func chunkScript(id: String, base64: String, last: Bool) -> String {
    let quotedId = jsonString(id)
    let quotedChunk = jsonString(base64)
    return "window.__kabmoOpenChunk && window.__kabmoOpenChunk(\(quotedId), \(quotedChunk), \(last ? "true" : "false"))"
  }

  /// A string as a JSON literal, quotes included.
  public static func jsonString(_ value: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
    let text = String(data: data, encoding: .utf8) ?? "[\"\"]"
    // `["x"]` → `"x"`.
    return String(text.dropFirst().dropLast())
  }

  /// `base64` split into chunks that each decode on their own.
  ///
  /// The split is at a multiple of FOUR, and that is the whole point: base64
  /// encodes three bytes into four characters, so a cut inside a group decodes to
  /// different bytes. The page joins the pieces before decoding, so this is not
  /// strictly required today — but a boundary that is only correct because the
  /// other side happens to join first is a rule waiting to be broken.
  public static func chunks(_ base64: String, size: Int = chunkChars) -> [String] {
    if base64.isEmpty { return [""] }
    let width = size < 4 ? 4 : size - (size % 4)
    if base64.count <= width { return [base64] }
    var out: [String] = []
    out.reserveCapacity((base64.count / width) + 1)
    var index = base64.startIndex
    while index < base64.endIndex {
      let end = base64.index(index, offsetBy: width, limitedBy: base64.endIndex) ?? base64.endIndex
      out.append(String(base64[index..<end]))
      index = end
    }
    return out
  }

  /// The file a launch URL names, or nil when it is not a file this shell opens.
  ///
  /// iOS hands over a `file://` URL for "Open in", and the URL has to be READABLE
  /// before it is worth announcing: a URL from a provider that revoked its grant
  /// opens nothing, and announcing it would open an empty tab.
  public static func isDocumentURL(_ url: URL) -> Bool {
    url.isFileURL
  }
}
