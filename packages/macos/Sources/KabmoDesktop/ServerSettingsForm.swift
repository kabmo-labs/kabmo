/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The values behind the splash's "Server settings" sheet, and every rule about them.

 The sheet exists because the console's own server control is a PAGE, and the one
 moment a user needs to change the address is the one moment the page cannot load:
 a failure splash with only Retry leaves a wrong port unfixable without editing
 `servers.json` by hand. Android's `SettingsActivity` is that same way back, and
 this is the desktop's — one address field, the servers this shell already knows,
 and Connect.

 The rules live here, with no AppKit, so the parts that fail silently are
 testable without a window: what the field is prefilled with, which rows the
 picker offers, what a pick does, and what an address is refused with. The sheet
 itself is `ServerSettingsSheet.swift` and draws exactly this.
 */

import Foundation

public struct ServerSettingsForm: Equatable {

  /// One remembered-or-detected server the picker offers.
  public struct Row: Equatable {
    public let id: String
    public let label: String
    public let url: String
    public let running: Bool

    public init(id: String, label: String, url: String, running: Bool) {
      self.id = id
      self.label = label
      self.url = url
      self.running = running
    }
  }

  /// The stored list first, then the instances found on this machine.
  public let rows: [Row]

  /// What the field holds. Editing the field and picking a row both change THIS,
  /// so the two controls cannot disagree about the address being submitted.
  public private(set) var address: String

  /**
   `address` wins when it has anything in it — the sheet is re-presented after a
   refusal with what the user typed, and replacing that with the stored address
   would erase the correction they are making. Otherwise the window's own active
   URL, then the first row, then empty: never a made-up default, because
   `http://127.0.0.1:3000` prefilled with nothing behind it is an address the user
   will submit without reading.
   */
  public init(state: ServersState, address: String?) {
    rows = Self.rows(for: state)
    let trimmed = address?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !trimmed.isEmpty {
      self.address = trimmed
    } else if let active = state.activeUrl, !active.isEmpty {
      self.address = active
    } else {
      self.address = rows.first?.url ?? ""
    }
  }

  /// The picker's rows: everything stored, then everything detected.
  public static func rows(for state: ServersState) -> [Row] {
    func row(_ entry: ServerEntry) -> Row {
      Row(id: entry.id, label: entry.label, url: entry.url, running: entry.running)
    }
    return state.entries.map(row) + state.detected.map(row)
  }

  /// What the picker prints for a row: the label and whether it answers, which is
  /// the difference between "choose my NAS" and "choose the NAS that is down".
  public func title(of row: Row) -> String {
    "\(row.label) · \(row.running ? "running" : "stopped")"
  }

  /// Choose a remembered server: the field carries its address, and Connect
  /// submits that — not the row's id. A row is a shortcut, never a second value.
  public func selecting(_ row: Row) -> ServerSettingsForm {
    withAddress(row.url)
  }

  public func withAddress(_ next: String) -> ServerSettingsForm {
    var copy = self
    copy.address = next
    return copy
  }

  /// The address to connect to, or the sentence that refuses it.
  ///
  /// The same `normaliseUrl` the store uses, so the sheet cannot accept an
  /// address the store would then reject — and the refusal is a sentence a reader
  /// can act on, never "invalid input".
  public func validated() throws -> String {
    try normaliseUrl(address)
  }
}
