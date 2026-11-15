/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The image decoder, against a code this test generates.

 A stub would prove nothing: the whole job is "does the platform's detector read
 the code the console draws". `CIFilter.qrCodeGenerator` is built in, so the round
 trip is real — generate, render, detect — and it fails if the detector's accuracy
 or the image pipeline changes under us.

 The same cases exist in `packages/ios/Tests/QrImageDecoderTests.swift`.
 */

import CoreImage
import Foundation

import KabmoDesktop

func qrImageDecoderCases() {
  let link = "https://laptop.tailnet.ts.net/pair#eyJ2IjoxLCJwYWlyaW5nSWQiOiJwYWlyLTEifQ"

  guard let generated = CIFilter(name: "CIQRCodeGenerator") else {
    check("the platform can generate a QR code", false)
    return
  }
  generated.setValue(Data(link.utf8), forKey: "inputMessage")
  generated.setValue("M", forKey: "inputCorrectionLevel")
  guard let output = generated.outputImage else {
    check("the generator produced an image", false)
    return
  }

  // Scaled up: a 1-pixel-per-module code is below what the detector reads, which
  // is the same reason the console draws at an integer number of pixels per
  // module.
  let scaled = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))

  check("a generated code decodes back to its text", QrImageDecoder.decode(scaled) == link)

  // An image with no code in it must answer nil rather than the nearest thing.
  let blank = CIImage(color: CIColor(red: 1, green: 1, blue: 1)).cropped(
    to: CGRect(x: 0, y: 0, width: 200, height: 200)
  )
  check("a blank image answers nil", QrImageDecoder.decode(blank) == nil)
}
