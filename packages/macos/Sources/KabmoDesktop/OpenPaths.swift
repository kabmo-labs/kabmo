/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Files the operating system handed to Kabmo.
 *
 * A double-click in Finder, "Open With → Kabmo" on a `.docx`, a drop of three
 * PDFs on the Dock icon — all of them arrive here, and the page never sees them
 * on its own: a `WKWebView` is given no `File` and no path for a launch, and the
 * browser APIs that could (`launchQueue`) are Chromium-only.
 *
 * So the shell collects the paths and hands them over, at whichever moment the
 * page can take them:
 *
 * - **Cold start** — the app launched BECAUSE of the file, so `openFiles` (or
 *   argv, for `open -a Kabmo x.pdf`) runs before the window exists. The paths
 *   wait in a queue.
 * - **Warm app** — the user opens another file while the console is running.
 *   The queue is flushed as soon as the page answers.
 *
 * The queue is deliberately not a single `lastOpened`: `openFiles` can arrive
 * with several files at once (a multi-selection in Finder), and dropping all but
 * one would open a tab for a file the user did not choose.
 *
 * **Nothing here opens a tab.** The page owns the tabs and the workspace scope;
 * this type only answers "which files did the OS hand over, and has the page
 * taken them yet". See `src/client/lib/native/open-paths.ts` for the other half.
 */

import AppKit
import Foundation

/// Paths the OS handed over that the page has not taken yet.
///
/// `@MainActor` because every caller is an AppKit delegate callback, which is
/// main-thread by contract — and because the queue is read while flushing from a
/// navigation callback, so a lock would be a second answer to the same question.
@MainActor
public final class OpenPathQueue {
  private var pending: [String] = []

  public init() {}

  /// Add paths, dropping duplicates and anything that is not a file.
  ///
  /// A duplicate is real: `openFiles` fires once per launch, but a re-open of
  /// the same file from Finder while the app is running is a second call, and
  /// the page would otherwise open two tabs for one document.
  public func add(_ paths: [String]) {
    for path in paths {
      let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty, !pending.contains(trimmed) else { continue }
      pending.append(trimmed)
    }
  }

  /// Everything waiting, and empty the queue.
  ///
  /// Taking is what makes a delivery once-only: the page asks on a load finish
  /// and on every later open, and a value left behind would be re-opened on the
  /// next navigation — a reload would reopen the file the user closed.
  public func take() -> [String] {
    let paths = pending
    pending = []
    return paths
  }

  /// Whether anything is waiting. Used to skip a pointless round trip.
  public var isEmpty: Bool { pending.isEmpty }

  /// How many paths are waiting, for the tests and a diagnostic log.
  public var count: Int { pending.count }
}

/**
 The file paths in a launch's argv.

 `open -a Kabmo report.pdf` passes the path as an argument, and so does a
 double-click when LaunchServices has already resolved the document — so argv is
 a real channel, not a formality. Three rules:

 - the executable itself is argument 0 and is skipped;
 - a `-flag` (macOS passes `-psn_0_12345` to a bundled app) is not a path;
 - a `file://` URL is accepted, because `open` can be asked for one.

 A path that does not exist is dropped rather than queued: the page would answer
 "that file no longer exists" for a document the user deleted between the click
 and the launch, and a silent drop is the honest outcome.
 */
public func launchPaths(from arguments: [String]) -> [String] {
  var paths: [String] = []
  for argument in arguments.dropFirst() {
    if argument.hasPrefix("-") { continue }
    let candidate: String
    if argument.hasPrefix("file://") {
      guard let url = URL(string: argument), url.isFileURL else { continue }
      candidate = url.path
    } else if argument.hasPrefix("/") {
      candidate = argument
    } else {
      continue
    }
    guard FileManager.default.fileExists(atPath: candidate) else { continue }
    guard !paths.contains(candidate) else { continue }
    paths.append(candidate)
  }
  return paths
}

/**
 The JavaScript that hands `paths` to the page.

 Built here rather than by string interpolation at the call site: a path may
 contain a quote, a backslash or a newline, and the JSON encoder is what makes
 the argument a value instead of source. `JSONSerialization` is used rather than
 hand-escaping for the same reason `BridgeHandler.reply` uses it.
 */
public func openPathsScript(_ paths: [String]) -> String {
  let json: String
  if let data = try? JSONSerialization.data(withJSONObject: paths),
     let text = String(data: data, encoding: .utf8) {
    json = text
  } else {
    json = "[]"
  }
  return "window.__kabmoOpenPaths ? window.__kabmoOpenPaths(\(json)) : null"
}
