/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 Reading a pairing code out of an IMAGE, for a device with no camera.

 The case is a desktop with no webcam, or a phone whose camera is broken: the code
 arrived as a screenshot and there is nothing to point at. `CIDetector` is part of
 the platform, so this needs no dependency and no web view — the same reason the
 camera path uses `AVCaptureMetadataOutput`.

 The image never leaves the machine: it is decoded here, and the code it carries is
 a credential.
 */

import CoreImage
import Foundation

public enum QrImageDecoder {

  /// The first QR code in the image at `url`, or nil.
  public static func decode(contentsOf url: URL) -> String? {
    guard let image = CIImage(contentsOf: url) else { return nil }
    return decode(image)
  }

  /// The first QR code in `image`, or nil.
  public static func decode(_ image: CIImage) -> String? {
    let detector = CIDetector(
      ofType: CIDetectorTypeQRCode,
      context: nil,
      // `.high` costs a little more and reads a screenshot that `.low` misses —
      // the same trade the console's decoder makes by upscaling small images.
      options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
    )
    guard let features = detector?.features(in: image) else { return nil }
    for feature in features {
      guard
        let code = feature as? CIQRCodeFeature,
        let message = code.messageString,
        !message.isEmpty
      else { continue }
      return message
    }
    return nil
  }
}
