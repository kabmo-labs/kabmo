/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The files the OS hands the shell, and the rules that keep a launch from being
 * lost or opened twice.
 *
 * Three shapes reach here and each fails silently in the app:
 *
 * - a cold launch by double-click (AppKit delivers `openFiles` BEFORE
 *   `applicationDidFinishLaunching`, so the queue must exist first);
 * - `open -a Kabmo report.pdf`, where the path is an ARGUMENT and never touches
 *   `openFiles`;
 * - a warm open while the console is running.
 *
 * None of them throws when mishandled — the file simply never appears.
 */

import AppKit
import Foundation

import KabmoDesktop

/// A real file on disk, so `launchPaths` can accept it.
private func fixture(_ name: String) -> String {
  let dir = FileManager.default.temporaryDirectory
    .appendingPathComponent("kabmo-openpaths-\(UUID().uuidString)")
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  let file = dir.appendingPathComponent(name)
  FileManager.default.createFile(atPath: file.path, contents: Data("x".utf8))
  return file.path
}

/// The array literal the script passes to the page, parsed back.
///
/// The script is `window.__kabmoOpenPaths ? window.__kabmoOpenPaths([...]) : null`,
/// so the argument is everything between the first `(` after the property name
/// and the matching `)`.
private func pathsArgument(_ script: String) -> [String]? {
  guard let open = script.range(of: "window.__kabmoOpenPaths([") else { return nil }
  let rest = script[open.upperBound...]
  guard let close = rest.range(of: "])") else { return nil }
  let literal = "[" + rest[..<close.lowerBound] + "]"
  guard let data = literal.data(using: .utf8) else { return nil }
  return (try? JSONSerialization.jsonObject(with: data)) as? [String]
}

func openPathsCases() {
  group("launchPaths")

  do {
  let pdf = fixture("report.pdf")
  let docx = fixture("notes.docx")

  check("argv's own executable is not a path", launchPaths(from: ["/Applications/Kabmo.app/Kabmo"]).isEmpty)
  check("a document argument is a path", launchPaths(from: ["/bin/Kabmo", pdf]) == [pdf])
  check("two documents both survive", launchPaths(from: ["/bin/Kabmo", pdf, docx]) == [pdf, docx])

  // macOS passes `-psn_0_12345` to a bundled app, and a flag is never a file.
  check("a -flag is skipped", launchPaths(from: ["/bin/Kabmo", "-psn_0_12345", pdf]) == [pdf])
  check("a relative argument is not a path", launchPaths(from: ["/bin/Kabmo", "report.pdf"]).isEmpty)
  check("a missing file is dropped", launchPaths(from: ["/bin/Kabmo", "/tmp/kabmo-does-not-exist-\(UUID().uuidString).pdf"]).isEmpty)

  let url = "file://" + pdf.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!
  check("a file:// URL is accepted", launchPaths(from: ["/bin/Kabmo", url]) == [pdf])
  check("a duplicate argument opens once", launchPaths(from: ["/bin/Kabmo", pdf, pdf]) == [pdf])
}

  group("OpenPathQueue")

  MainActor.assumeIsolated {
  let queue = OpenPathQueue()
  check("a fresh queue is empty", queue.isEmpty && queue.count == 0)

  queue.add(["/a.pdf", "/b.pdf"])
  check("add keeps the order", queue.count == 2)
  // A warm open of a file already queued must not become two tabs.
  queue.add(["/a.pdf"])
  check("add de-duplicates", queue.count == 2)

  let taken = queue.take()
  check("take answers everything in order", taken == ["/a.pdf", "/b.pdf"])
  // The rule that makes a reload safe: a taken batch is gone, so a second
  // `didFinish` cannot reopen what the user closed.
  check("take empties the queue", queue.isEmpty && queue.take().isEmpty)

  queue.add(["   ", ""])
  check("blank paths are dropped", queue.isEmpty)
}

  group("openPathsScript")

  do {
  let plain = openPathsScript(["/a.pdf"])
  // Parsed, never matched as a string: `JSONSerialization` writes `/` as `\/`,
  // which is legal JSON and identical to the page — so a literal comparison would
  // fail on a correct script (measured).
  check("a plain path parses back as one entry", pathsArgument(plain) == ["/a.pdf"])
  check("the call is guarded", plain.contains("window.__kabmoOpenPaths ?"))

  // A quote or a backslash in a filename is ordinary on macOS, and hand-built
  // string interpolation is how one of them breaks the call.
  let tricky = "/tmp/quote\"and\\backslash.pdf"
  let script = openPathsScript([tricky])
  check("a quote is escaped, not interpolated", !script.contains("quote\"and"))
  check("the escaped form parses back", pathsArgument(script) == [tricky])
}
}
