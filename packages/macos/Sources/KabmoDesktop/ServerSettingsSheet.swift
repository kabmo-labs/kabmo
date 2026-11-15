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
  /// The pairing link, when the user has one. Takes precedence over the address.
  public let pairingField = NSTextField()

  private let form: ServerSettingsForm
  private let rows: [ServerSettingsForm.Row]

  /// Called with the field's text when Connect is pressed. Cancel never calls it.
  public var onConnect: ((String) -> Void)?

  /// Called with the pairing link when Connect is pressed and that field is
  /// filled. The link is loaded in THIS app's web view, so the device cookie the
  /// server's `/pair` page receives lands in this app's cookie store — pairing in
  /// Safari would leave the shell still asking for a password.
  public var onPair: ((String) -> Void)?

  /// Open the shell's own camera scanner. The code it reads comes back through
  /// `onPair`, so there is one path from a link to a connection.
  public var onScan: (() -> Void)?

  /// Pick an image of a code, for a machine with no camera. Also comes back
  /// through `onPair`.
  public var onUpload: (() -> Void)?

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

    let accessory = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 140))

    // The field on TOP: it is the value Connect submits, and it is what a user
    // who knows the address needs first. The picker is the shortcut underneath.
    addressField.frame = NSRect(x: 0, y: 112, width: 360, height: 24)
    addressField.stringValue = form.address
    addressField.placeholderString = "http://192.168.1.20:3000"
    addressField.font = .systemFont(ofSize: 13)
    addressField.setAccessibilityLabel("Server address")

    serverPicker.frame = NSRect(x: 0, y: 80, width: 360, height: 26)
    serverPicker.addItem(withTitle: "Remembered servers")
    for row in rows {
      serverPicker.addItem(withTitle: form.title(of: row))
    }
    serverPicker.target = self
    serverPicker.action = #selector(picked(_:))
    serverPicker.setAccessibilityLabel("Remembered servers")

    // Pairing sits BELOW the address, because it is the alternative to typing
    // one: a device that has a code does not need to know the address at all.
    let pairingLabel = NSTextField(labelWithString: "Pairing link (optional)")
    pairingLabel.frame = NSRect(x: 0, y: 60, width: 360, height: 16)
    pairingLabel.font = .systemFont(ofSize: 11)
    pairingLabel.textColor = .secondaryLabelColor

    pairingField.frame = NSRect(x: 0, y: 32, width: 360, height: 24)
    pairingField.placeholderString = "https://…/pair#…"
    pairingField.font = .systemFont(ofSize: 13)
    pairingField.setAccessibilityLabel("Pairing link")

    let scan = NSButton(title: "Scan with camera…", target: self, action: #selector(scanTapped))
    scan.frame = NSRect(x: 0, y: 0, width: 160, height: 24)
    scan.bezelStyle = .rounded
    scan.setAccessibilityLabel("Scan pairing code with the camera")

    let upload = NSButton(title: "Use an image…", target: self, action: #selector(uploadTapped))
    upload.frame = NSRect(x: 168, y: 0, width: 140, height: 24)
    upload.bezelStyle = .rounded
    upload.setAccessibilityLabel("Read a pairing code from an image")

    accessory.addSubview(addressField)
    accessory.addSubview(serverPicker)
    accessory.addSubview(pairingLabel)
    accessory.addSubview(pairingField)
    accessory.addSubview(scan)
    accessory.addSubview(upload)
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
      let link = self.pairingField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
      self.onDismiss?()
      guard response == .alertFirstButtonReturn else { return }
      // A filled pairing field wins: the user pasted a code, and the address
      // beside it is whatever the sheet was prefilled with.
      if !link.isEmpty {
        self.onPair?(link)
        return
      }
      self.onConnect?(typed)
    }
  }

  /// Hand the request to the caller, which owns the scanner window.
  @objc private func scanTapped() {
    onScan?()
  }

  /// Hand the request to the caller, which owns the file panel.
  @objc private func uploadTapped() {
    onUpload?()
  }

  /// A picked row fills the field — the field stays the one submitted value.
  @objc private func picked(_ sender: NSPopUpButton) {
    let index = sender.indexOfSelectedItem - 1
    guard rows.indices.contains(index) else { return }
    addressField.stringValue = rows[index].url
  }
}
