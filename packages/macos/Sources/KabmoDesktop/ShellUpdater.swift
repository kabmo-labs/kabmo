/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Downloading, verifying and installing a newer Kabmo over this one.
 *
 * The RULES live in `ShellUpdate` (pure, and pinned by the logic suite). This file
 * is the part that touches the disk, `ditto` and `codesign`, which is why it is
 * separated: the rules can be tested anywhere, and the sequence here is one
 * straight line a reader can check against the platform's own behaviour.
 *
 * ## Why a bundle SWAP rather than an installer
 *
 * macOS has no equivalent of Android's `PackageInstaller` for a self-update, and
 * an installer package would need an admin password for a per-user app. A `.app`
 * is a directory, so replacing it is: rename the old one aside, move the new one
 * in, delete the old one. The running process keeps the inode it started from, so
 * the swap is safe while this app is on screen — and if any step fails, the
 * rename is undone so the user is left with a working app rather than none.
 *
 * ## The verification, and its honest limit
 *
 * `codesign --verify --deep --strict` checks the seal, and `ShellUpdate.refusal`
 * checks the identifier and the version. Together they catch a corrupt or
 * truncated download, a bundle modified after signing, and a file that is not
 * Kabmo. They do NOT prove provenance: the build is signed ad-hoc, so anyone can
 * sign another bundle. Provenance needs a Developer ID + notarisation, which is a
 * pipeline change (see `scripts/build-app.sh`), and this file's comment says so
 * rather than implying a guarantee it cannot make.
 */

import Foundation

public enum ShellUpdateError: LocalizedError {
  case refused(String)

  public var errorDescription: String? {
    switch self {
    case let .refused(reason): return reason
    }
  }
}

public struct ShellUpdater {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  /**
   * Install `url` over this app, and answer what was installed.
   *
   * It deliberately does NOT relaunch: the caller has to send the console its
   * answer FIRST, and a relaunch started here would terminate the process whose
   * reply is still in flight — the page would keep a spinner over an update that
   * actually worked. So this returns, the bridge answers, and the caller restarts.
   */
  public func apply(
    url urlString: String,
    version expectedVersion: String,
    installedBundle: URL,
    installedVersion: String,
    caches: URL
  ) async throws -> Installed {
    guard ShellUpdate.isTrustedDownload(urlString) else {
      throw ShellUpdateError.refused("That update does not come from Kabmo's release page, so it was not installed.")
    }
    guard let url = URL(string: urlString) else {
      throw ShellUpdateError.refused("That update address could not be read.")
    }
    guard ShellUpdate.isInstalledBundle(installedBundle) else {
      throw ShellUpdateError.refused("This build runs from a folder rather than a Kabmo app, so it cannot replace itself. Download the release instead.")
    }

    let staging = ShellUpdate.stagingRoot(caches: caches)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: staging) }

    let archive = staging.appendingPathComponent("Kabmo.zip")
    try await download(url, to: archive)

    // `ditto -x -k` is what extracts a `ditto`-made zip with its signature and
    // extended attributes intact. `unzip` strips both, and macOS then refuses to
    // launch the result ("damaged") with nothing on disk to say why.
    try run("/usr/bin/ditto", ["-x", "-k", archive.path, staging.path])

    let staged = staging.appendingPathComponent(ShellUpdate.appDirectoryName)
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: staged.path, isDirectory: &isDirectory), isDirectory.boolValue else {
      throw ShellUpdateError.refused("The downloaded archive does not contain Kabmo.app.")
    }

    let info = plist(at: staged.appendingPathComponent("Contents/Info.plist"))
    let stagedVersion = info?[ShellVersion.key] as? String
    if let refusal = ShellUpdate.refusal(
      stagedIdentifier: info?["CFBundleIdentifier"] as? String,
      stagedVersion: stagedVersion,
      installedVersion: installedVersion
    ) {
      throw ShellUpdateError.refused(refusal)
    }

    // The seal, not the identity. A failure here is a REFUSAL rather than a
    // warning: a bundle whose signature does not verify is a bundle something
    // rewrote, and installing it would be installing that change.
    try verifySignature(staged)

    try swap(staged: staged, installed: installedBundle)
    return Installed(version: stagedVersion ?? expectedVersion)
  }

  /// What an update installed, for the console's report.
  public struct Installed {
    public let version: String
  }

  // ---------------------------------------------------------------- the steps

  private func download(_ url: URL, to target: URL) async throws {
    let (data, response) = try await session.data(from: url)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw ShellUpdateError.refused("The update could not be downloaded.")
    }
    // Written to a file rather than kept in memory: the archive is tens of
    // megabytes, and `ditto` needs a path anyway.
    try data.write(to: target, options: .atomic)
  }

  private func plist(at url: URL) -> [String: Any]? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any]
  }

  private func verifySignature(_ bundle: URL) throws {
    let status = try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle.path], allowFailure: true)
    guard status == 0 else {
      throw ShellUpdateError.refused("The downloaded app's signature does not verify, so it was not installed.")
    }
  }

  /**
   * Put the new bundle where the old one was, and undo it if that fails.
   *
   * The rename is on the SAME volume by construction (the staged copy sits in the
   * user's caches, the bundle in `/Applications` or `~/Applications`) — a copy
   * across volumes is what would leave a half-replaced app behind. The old bundle
   * is renamed aside first and deleted only after the new one is in place, so a
   * failure at any point leaves a working app at the original path.
   */
  private func swap(staged: URL, installed: URL) throws {
    let fileManager = FileManager.default
    let aside = installed.deletingLastPathComponent()
      .appendingPathComponent(".\(installed.lastPathComponent).old-\(UUID().uuidString)")

    try fileManager.moveItem(at: installed, to: aside)
    do {
      try fileManager.moveItem(at: staged, to: installed)
    } catch {
      // Put the app the user had back. A failed update that also removed the app
      // is the one outcome this sequence exists to prevent.
      try? fileManager.moveItem(at: aside, to: installed)
      throw ShellUpdateError.refused("The new build could not be moved into place, so the installed app was left as it was.")
    }
    try? fileManager.removeItem(at: aside)
  }

  @discardableResult
  private func run(_ program: String, _ arguments: [String], allowFailure: Bool = false) throws -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: program)
    process.arguments = arguments
    // Both streams are drained: a tool that writes more than a pipe buffer
    // would otherwise block forever while this waits for it to exit.
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    try process.run()
    _ = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    if process.terminationStatus != 0 && !allowFailure {
      throw ShellUpdateError.refused("The update could not be unpacked.")
    }
    return process.terminationStatus
  }
}
