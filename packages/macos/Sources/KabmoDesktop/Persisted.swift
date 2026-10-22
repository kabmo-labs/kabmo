/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where the shell's own list lives.
 *
 * Beside the app's config, NEVER inside the data directory: `~/.kabmo` is shared
 * with the CLI and holds the database, the auth hash and the run records, and a
 * shell that wrote its own bookkeeping there would make `kabmo status` and this
 * app disagree about which files belong to whom.
 */

import Foundation

public func stateFileURL() -> URL {
  let env = ProcessInfo.processInfo.environment
  let base: URL
  if let xdg = env["XDG_CONFIG_HOME"], !xdg.isEmpty {
    base = URL(fileURLWithPath: xdg).appendingPathComponent(stateDirectoryName)
  } else {
    base = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support")
      .appendingPathComponent(stateDirectoryName)
  }
  return base.appendingPathComponent("servers.json")
}

/// The app's own directory, named for the app.
///
/// It was `kabmo-desktop` — the SwiftPM target's name — which meant a user
/// looking for their settings found a folder no product ever mentioned. The old
/// directory is MIGRATED rather than abandoned (see `migrateLegacyStateDir`), so
/// an install that has been running keeps its server list.
let stateDirectoryName = "Kabmo"
private let legacyStateDirectoryName = "kabmo-desktop"

/**
 Move `~/Library/Application Support/kabmo-desktop` to `…/Kabmo`, once.

 Only when the new directory is ABSENT, so a rename can never overwrite a list
 the current build has already written. A failure is not fatal: the caller falls
 back to the new (empty) directory, which is the state a fresh install starts in.
 */
public func migrateLegacyStateDir() {
  let support = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support")
  let legacy = support.appendingPathComponent(legacyStateDirectoryName)
  let target = support.appendingPathComponent(stateDirectoryName)
  let manager = FileManager.default
  guard manager.fileExists(atPath: legacy.path),
        !manager.fileExists(atPath: target.path)
  else { return }
  try? manager.moveItem(at: legacy, to: target)
}

public func readState() -> PersistedState? {
  guard let data = try? Data(contentsOf: stateFileURL()) else { return nil }
  return try? JSONDecoder().decode(PersistedState.self, from: data)
}

public func writeState(_ state: PersistedState) {
  let url = stateFileURL()
  try? FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(), withIntermediateDirectories: true
  )
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  guard let data = try? encoder.encode(state) else { return }
  try? data.write(to: url, options: .atomic)
}
