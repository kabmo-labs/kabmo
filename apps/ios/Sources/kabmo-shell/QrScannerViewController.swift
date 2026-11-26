#if canImport(UIKit)
import AVFoundation
import UIKit

/// The shell's own QR scanner: a camera preview, decoded by AVFoundation.
///
/// **Why native here and a web view on Android.** `AVCaptureMetadataOutput` with
/// `.qr` is part of the platform, needs no dependency, and is the same decoder the
/// system Camera app uses. Android has no equivalent in the framework — its
/// options are a 500 KB ZXing dependency or a hand-written Camera2 state machine —
/// so that shell hosts the page whose decoder is already tested. Each platform
/// gets the cheapest correct answer rather than one answer forced onto both.
///
/// The result is the decoded TEXT, not a parsed payload: the caller already has
/// `PairingLink.origin(of:)`, and a second parser here would be a second place for
/// the link format to drift.
///
/// `NSCameraUsageDescription` in `Info.plist` is what the system prompt shows;
/// without it the app is terminated the moment the camera is touched.
final class QrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {

  /// A code was read. Called once, on the main thread, after dismissal.
  var onCode: ((String) -> Void)?

  private let session = AVCaptureSession()
  private var preview: AVCaptureVideoPreviewLayer?
  private let status = UILabel()
  private var finished = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black

    title = "Scan pairing code"
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      systemItem: .cancel,
      primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
    )

    status.text = "Point the camera at the pairing code"
    status.textColor = .white
    status.font = .systemFont(ofSize: 13)
    status.textAlignment = .center
    status.numberOfLines = 0
    status.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(status)
    NSLayoutConstraint.activate([
      status.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
      status.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
      status.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    start()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    // A backgrounded preview keeps the camera light on; the session must stop
    // before the view goes away, not when it is deallocated.
    if session.isRunning { session.stopRunning() }
  }

  private func start() {
    guard let device = AVCaptureDevice.default(for: .video) else {
      refuse("No camera was found on this device. Use the pairing link instead.")
      return
    }

    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      DispatchQueue.main.async {
        guard let self else { return }
        guard granted else {
          self.refuse("The camera was blocked. Allow it in Settings, or use the pairing link instead.")
          return
        }
        self.configure(device: device)
      }
    }
  }

  private func configure(device: AVCaptureDevice) {
    do {
      let input = try AVCaptureDeviceInput(device: device)
      guard session.canAddInput(input) else {
        refuse("The camera could not be opened. Use the pairing link instead.")
        return
      }
      session.addInput(input)

      let output = AVCaptureMetadataOutput()
      guard session.canAddOutput(output) else {
        refuse("The camera could not be opened. Use the pairing link instead.")
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
      view.layer.insertSublayer(layer, at: 0)
      preview = layer

      session.startRunning()
    } catch {
      refuse("The camera could not be opened. Use the pairing link instead.")
    }
  }

  func metadataOutput(
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
      if session.isRunning { session.stopRunning() }
      dismiss(animated: true) { [weak self] in self?.onCode?(value) }
      return
    }
  }

  /// Draw a refusal in place, so the sentence is readable before the user leaves.
  private func refuse(_ message: String) {
    status.text = message
    status.textColor = .systemRed
  }
}
#endif
