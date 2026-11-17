/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Run a tool and wait for it, with both pipes drained.
 *
 * A tool that writes more than a pipe buffer would otherwise block forever while
 * the parent waits for it to exit — the update path and the notification heal
 * both call system tools, and both need the same answer.
 */
import Foundation

enum ShellProcess {
  /// The exit status, or `nil` when the process could not start.
  @discardableResult
  static func run(_ program: String, _ arguments: [String]) -> Int32? {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: program)
    process.arguments = arguments
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    do {
      try process.run()
    } catch {
      return nil
    }
    _ = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return process.terminationStatus
  }
}
