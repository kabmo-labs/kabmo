/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a downloaded file lands, and under what name.
 *
 * The shell had no download handling before the pairing dialog's Download
 * control needed it, so these are the first cases on the path. Each one is a way
 * a file could be lost, overwritten, or written OUTSIDE the Downloads folder —
 * none of them throws, and all of them look like a successful download.
 */

import Foundation

import KabmoDesktop

func downloadCases() {
  group("downloads")

  // `Content-Disposition` is server-provided text used as a path component.
  check("a slash cannot escape the Downloads folder", DownloadFile.safeName("../../.ssh/authorized_keys").contains("/") == false)
  check("a bare name survives", DownloadFile.safeName("kabmo-pairing-qr.png") == "kabmo-pairing-qr.png")
  check("an empty name falls back", DownloadFile.safeName("") == "download")

  let directory = URL(fileURLWithPath: "/tmp/kabmo-downloads-test")
  let free = DownloadFile.uniqueURL(name: "qr.png", directory: directory, exists: { _ in false })
  check("an unused name is kept", free.lastPathComponent == "qr.png")

  // A file already in Downloads may be the user's own: it is never replaced.
  var taken: Set<String> = ["qr.png"]
  let second = DownloadFile.uniqueURL(
    name: "qr.png",
    directory: directory,
    exists: { taken.contains($0.lastPathComponent) }
  )
  check("a taken name is numbered, not overwritten", second.lastPathComponent == "qr 2.png")

  taken.insert("qr 2.png")
  let third = DownloadFile.uniqueURL(
    name: "qr.png",
    directory: directory,
    exists: { taken.contains($0.lastPathComponent) }
  )
  check("the numbering keeps counting", third.lastPathComponent == "qr 3.png")

  let noExtension = DownloadFile.uniqueURL(
    name: "qr",
    directory: directory,
    exists: { $0.lastPathComponent == "qr" }
  )
  check("a name without an extension still numbers", noExtension.lastPathComponent == "qr 2")
}
