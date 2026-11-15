/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The shell's own QR scanner: a camera preview in a sheet, decoded by AVFoundation.

 **Why native here and a web view on Android.** `AVCaptureMetadataOutput` with
 `.qr` is part of the platform, needs no dependency, and is the same decoder the
 system Camera app uses. Android has no equivalent in the framework — its options
 are a 500 KB ZXing dependency or a hand-written Camera2 state machine — so that
 shell hosts the page whose decoder is already tested. Each platform gets the
 cheapest correct answer rather than one answer forced onto both.

 The result is the decoded TEXT, not a parsed payload: the caller already has
 `PairingLink.origin(of:)`, and a second parser here would be a second place for
 the link format to drift.

 `NSCameraUsageDescription` in the app's `Info.plist` is what the system prompt
 shows; without it the app is terminated the moment the camera is touched.
 */

import AVFoundation
import AppKit

public final class QrScannerSheet: NSObject, AVCaptureMetadataOutputObjectsDelegate {

  /// A code was read. Called once, on the main thread.
  public var onCode: ((String) -> Void)?
  /// The sheet closed without a code.
  public var onCancel: (() -> Void)?

  private let session = AVCaptureSession()
  private var sheet: NSWindow?
  private var preview: AVCaptureVideoPreviewLayer?
  private var status: NSTextField?
  private var finished = false

  /// Show the scanner over `parent`.
  public func present(over parent: NSWindow) {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 420, height: 380),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    window.title = "Scan pairing code"
    window.isReleasedWhenClosed = false

    let container = NSView(frame: window.contentLayoutRect)
    container.wantsLayer = true
    container.layer?.backgroundColor = NSColor.black.cgColor

    let previewView = NSView(frame: container.bounds)
    previewView.autoresizingMask = [.width, .height]
    container.addSubview(previewView)

    let label = NSTextField(labelWithString: "Point the camera at the pairing code")
    label.alignment = .center
    label.textColor = .secondaryLabelColor
    label.frame = NSRect(x: 0, y: 8, width: container.bounds.width, height: 18)
    label.autoresizingMask = [.width, .maxYMargin]
    container.addSubview(label)
    status = label

    window.contentView = container
    sheet = window

    parent.beginSheet(window) { [weak self] _ in
      self?.teardown()
      self?.onCancel?()
    }

    start(in: previewView)
  }

  /// Open the camera and begin reading frames.
  private func start(in view: NSView) {
    guard let device = AVCaptureDevice.default(for: .video) else {
      finish(with: "No camera was found on this device. Use the pairing link instead.")
      return
    }

    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      DispatchQueue.main.async {
        guard let self else { return }
        guard granted else {
          self.finish(with: "The camera was blocked. Allow it in System Settings, or use the pairing link instead.")
          return
        }
        self.configure(device: device, in: view)
      }
    }
  }

  private func configure(device: AVCaptureDevice, in view: NSView) {
    do {
      let input = try AVCaptureDeviceInput(device: device)
      guard session.canAddInput(input) else {
        finish(with: "The camera could not be opened. Use the pairing link instead.")
        return
      }
      session.addInput(input)

      let output = AVCaptureMetadataOutput()
      guard session.canAddOutput(output) else {
        finish(with: "The camera could not be opened. Use the pairing link instead.")
        return
      }
      session.addOutput(output)
      output.setMetadataObjectsDelegate(self, queue: .main)
      // `.qr` only: a barcode in the room is not a pairing code, and reading one
      // would stop the scan on the wrong thing.
      output.metadataObjectTypes = [.qr]

      let layer = AVCaptureVideoPreviewLayer(session: session)
      layer.frame = view.bounds
      layer.videoGravity = .resizeAspectFill
      view.layer = CALayer()
      view.wantsLayer = true
      view.layer?.addSublayer(layer)
      preview = layer

      session.startRunning()
    } catch {
      finish(with: "The camera could not be opened. Use the pairing link instead.")
    }
  }

  public func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard !finished else { return }
    for object in metadataObjects {
      guard
        let code = object as? AVMetadataMachineReadableCodeObject,
        code.type == .qr,
        let value = code.stringValue,
        !value.isEmpty
      else { continue }
      finished = true
      teardown()
      close()
      onCode?(value)
      return
    }
  }

  /// Draw a refusal in the sheet and leave it open, so the sentence is readable.
  private func finish(with message: String) {
    status?.stringValue = message
    status?.textColor = .systemRed
    teardown()
  }

  private func teardown() {
    if session.isRunning { session.stopRunning() }
    preview?.removeFromSuperlayer()
    preview = nil
  }

  private func close() {
    guard let window = sheet else { return }
    sheet = nil
    window.sheetParent?.endSheet(window)
  }
}
