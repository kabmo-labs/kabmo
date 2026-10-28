/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rules for a document the OS handed to Kabmo on iOS.
 *
 * Every case is a silent failure on a device: a file with no extension opens in
 * the code editor instead of its viewer, a name with a quote breaks the script
 * that carries it, and a chunk cut inside a base64 group corrupts the document
 * with no error anywhere.
 */

import Foundation

import KabmoShell

enum DeviceFilesTests {
  static func run() {
    Harness.group("DeviceFiles — the name")

    Harness.equal(
      "the file's own name wins",
      DeviceFiles.displayName(resolved: "Q3 report.pdf", suggested: "other.pdf", mimeType: "application/pdf"),
      "Q3 report.pdf"
    )
    Harness.equal(
      "the suggested name is the fallback",
      DeviceFiles.displayName(resolved: nil, suggested: "notes.md", mimeType: "text/markdown"),
      "notes.md"
    )
    // A provider that reports only "document": without an extension the
    // classifier sees text and a PDF opens in the code surface.
    Harness.equal(
      "an extensionless name takes the type's extension",
      DeviceFiles.displayName(resolved: "document", suggested: nil, mimeType: "application/pdf"),
      "document.pdf"
    )
    // `report.final.pdf` must not become `report.final.txt`.
    Harness.equal(
      "a dotted name is left alone",
      DeviceFiles.displayName(resolved: "report.final", suggested: nil, mimeType: "text/plain"),
      "report.final"
    )
    Harness.equal(
      "an unknown type keeps the name it was given",
      DeviceFiles.displayName(resolved: "document", suggested: nil, mimeType: "application/x-weird"),
      "document"
    )
    Harness.equal(
      "an empty or root name falls back",
      DeviceFiles.displayName(resolved: "", suggested: "/", mimeType: "image/png"),
      "document.png"
    )

    Harness.group("DeviceFiles — the type")

    Harness.equal("pdf", DeviceFiles.extensionFor(mimeType: "application/pdf"), "pdf")
    Harness.equal("docx", DeviceFiles.extensionFor(mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx")
    Harness.equal("xlsx", DeviceFiles.extensionFor(mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "xlsx")
    Harness.equal("md", DeviceFiles.extensionFor(mimeType: "text/markdown"), "md")
    Harness.equal("svg", DeviceFiles.extensionFor(mimeType: "image/svg+xml"), "svg")
    // Case and whitespace are what a provider actually sends.
    Harness.equal("case-insensitive", DeviceFiles.extensionFor(mimeType: "  APPLICATION/PDF "), "pdf")
    Harness.check("an unknown type is not guessed", DeviceFiles.extensionFor(mimeType: "application/octet-stream") == nil)
    Harness.check("no type at all is not guessed", DeviceFiles.extensionFor(mimeType: nil) == nil)

    // The inverse: iOS hands over a URL, so the shell has to name the type.
    Harness.equal("pdf", DeviceFiles.mimeType(forExtension: "pdf"), "application/pdf")
    Harness.equal("jpeg shares jpg", DeviceFiles.mimeType(forExtension: "jpeg"), "image/jpeg")
    Harness.check("an unknown extension has no type", DeviceFiles.mimeType(forExtension: "xyz") == nil)

    Harness.group("DeviceFiles — the chunks")

    // 12 characters is three whole groups; a chunk size of 5 must not cut
    // inside one.
    let split = DeviceFiles.chunks("abcdefghijkl", size: 5)
    Harness.check("every chunk is a whole number of groups", split.allSatisfy { $0.count % 4 == 0 })
    Harness.equal("the pieces rejoin to the payload", split.joined(), "abcdefghijkl")
    Harness.equal("a small payload is one chunk", DeviceFiles.chunks("abcd", size: 64), ["abcd"])
    // The page only decodes on `last`, so a file with no bytes still has to send
    // one frame — otherwise an empty document never opens.
    Harness.equal("an empty file is one empty chunk", DeviceFiles.chunks(""), [""])
    Harness.equal("a tiny chunk size is raised to whole groups", DeviceFiles.chunks("abcdefgh", size: 1).joined(), "abcdefgh")
    Harness.check("the default chunk is a whole number of groups", DeviceFiles.chunkChars % 4 == 0)

    Harness.group("DeviceFiles — the scripts")

    let announce = DeviceFiles.announceScript([
      DeviceFiles.Meta(id: "device-1", name: "a.pdf", mimeType: "application/pdf", size: 10),
    ])
    Harness.check("the announcement is a guarded call", announce.hasPrefix("window.__kabmoOpenFiles && window.__kabmoOpenFiles(["))
    Harness.check("it carries the id", announce.contains("\"id\":\"device-1\""))
    Harness.check("it carries the size", announce.contains("\"size\":10"))

    // A quote or a backslash in a filename is ordinary, and interpolation is how
    // one of them ends the string early.
    let tricky = DeviceFiles.announceScript([
      DeviceFiles.Meta(id: "device-2", name: "a\"b\\c.pdf", mimeType: nil, size: 1),
    ])
    Harness.check("a quote is escaped, not interpolated", tricky.contains("a\\\"b\\\\c.pdf"))
    Harness.check("a missing type is omitted rather than sent as null", !tricky.contains("mimeType"))

    Harness.check("the chunk call carries the last flag", DeviceFiles.chunkScript(id: "d", base64: "AAAA", last: true).hasSuffix(", true)"))
    Harness.check("…and false for a middle chunk", DeviceFiles.chunkScript(id: "d", base64: "AAAA", last: false).hasSuffix(", false)"))
    // Compared against the ENCODER's own output, not a spelling: `JSONSerialization`
    // writes `/` as `\/`, which is legal JSON and identical to the page — so a
    // literal comparison fails on a correct script (measured).
    Harness.check(
      "the payload goes through the JSON encoder",
      DeviceFiles.chunkScript(id: "d", base64: "AA+/", last: true)
        .contains(DeviceFiles.jsonString("AA+/"))
    )
  }
}
