/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The splash's "Server settings" sheet: an address field, the servers this shell
 already knows, and Connect.

 A sheet on the window rather than a second window, because the failure splash is
 MODAL in intent — the console has not loaded, so there is nothing behind it to
 interact with and a detached panel would let the user leave the shell in a state
 where the splash says one thing and the panel another.

 `NSAlert` carries an accessory view, so the form is a native sheet with the
 platform's own buttons, focus and Escape handling; nothing here reimplements a
 dialog. The RULES are `ServerSettingsForm`'s (prefill, rows, validation) and this
 file only draws them and hands the typed address back.

 **Connect hands back the RAW field text, not a validated URL.** The refusal a
 wrong address earns is one sentence and it comes from the store's own
 `normaliseUrl`; validating here as well would be a second copy of that rule —
 and the caller has to re-present the sheet on failure anyway, because the alert
 has already closed by then.
 */

import AppKit

public final class ServerSettingsSheet: NSObject {

  /// The sheet, so a caller can present it and a suite can read its views.
  public let alert = NSAlert()
  public let addressField = NSTextField()
  public let serverPicker = NSPopUpButton()

  private let form: ServerSettingsForm
  private let rows: [ServerSettingsForm.Row]

  /// Called with the field's text when Connect is pressed. Cancel never calls it.
  public var onConnect: ((String) -> Void)?

  /// Called once when the sheet closes, for either button — the caller's handle
  /// on the sheet is stale from that moment and holding it blocks the next open.
  public var onDismiss: (() -> Void)?

  public init(form: ServerSettingsForm, error: String?) {
    self.form = form
    self.rows = form.rows
    super.init()

    alert.messageText = "Server settings"
    alert.informativeText = error
      ?? "Enter the address of the Kabmo server this window loads. Use the root address, with no path."
    alert.alertStyle = error == nil ? .informational : .warning
    alert.addButton(withTitle: "Connect")
    alert.addButton(withTitle: "Cancel")

    let accessory = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 64))

    // The field on TOP: it is the value Connect submits, and it is what a user
    // who knows the address needs first. The picker is the shortcut underneath.
    addressField.frame = NSRect(x: 0, y: 36, width: 360, height: 24)
    addressField.stringValue = form.address
    addressField.placeholderString = "http://192.168.1.20:3000"
    addressField.font = .systemFont(ofSize: 13)
    addressField.setAccessibilityLabel("Server address")

    serverPicker.frame = NSRect(x: 0, y: 0, width: 360, height: 26)
    serverPicker.addItem(withTitle: "Remembered servers")
    for row in rows {
      serverPicker.addItem(withTitle: form.title(of: row))
    }
    serverPicker.target = self
    serverPicker.action = #selector(picked(_:))
    serverPicker.setAccessibilityLabel("Remembered servers")

    accessory.addSubview(addressField)
    accessory.addSubview(serverPicker)
    alert.accessoryView = accessory
    alert.window.initialFirstResponder = addressField
  }

  /// Show it over `window`; Connect reports the field text once, Cancel never.
  ///
  /// Dismissal is answered BEFORE Connect is reported, and that order is what
  /// makes a refused address work: the caller clears its handle, the store
  /// validates and probes, and a failure re-presents the sheet — all after the
  /// previous alert has released the window's sheet slot.
  public func present(over window: NSWindow) {
    alert.beginSheetModal(for: window) { [weak self] response in
      guard let self else { return }
      let typed = self.addressField.stringValue
      self.onDismiss?()
      guard response == .alertFirstButtonReturn else { return }
      self.onConnect?(typed)
    }
  }

  /// A picked row fills the field — the field stays the one submitted value.
  @objc private func picked(_ sender: NSPopUpButton) {
    let index = sender.indexOfSelectedItem - 1
    guard rows.indices.contains(index) else { return }
    addressField.stringValue = rows[index].url
  }
}
