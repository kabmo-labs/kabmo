// Render the app icon at 1024×1024, from the same geometry as `public/icon.svg`.
//
// The icon is the K lockup on a full-bleed green plate — no rounded corners,
// because iOS masks an icon itself and a rounded rect drawn here would leave the
// system's mask cutting into an already-rounded shape (a visible double edge).
//
// Run by `scripts/build-ipa.sh` before the icon sizes are derived, so the icon has
// ONE source and the sizes below are only downscales of it. A committed PNG that
// nobody can regenerate is how an icon drifts from the product.
//
// usage: swift scripts/make-icon.swift <output.png>

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let scale = CGFloat(size) / 64.0   // icon.svg's own 64-unit viewBox

func colour(_ hex: UInt32) -> CGColor {
  CGColor(
    red: CGFloat((hex >> 16) & 0xFF) / 255,
    green: CGFloat((hex >> 8) & 0xFF) / 255,
    blue: CGFloat(hex & 0xFF) / 255,
    alpha: 1
  )
}

guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: space,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
      )
else {
  FileHandle.standardError.write(Data("could not create a bitmap context\n".utf8))
  exit(1)
}

context.setShouldAntialias(true)
context.interpolationQuality = .high
context.scaleBy(x: scale, y: scale)

// The plate: full canvas, no corner radius (see the header).
context.setFillColor(colour(0x0B5D3B))
context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))

// The three K strokes, from icon.svg. Stroked, never filled.
context.setLineWidth(7)
context.setLineCap(.round)
context.setLineJoin(.round)

let strokes: [(CGPoint, CGPoint, UInt32)] = [
  (CGPoint(x: 20, y: 15), CGPoint(x: 20, y: 49), 0xF7F4EA),
  (CGPoint(x: 20, y: 32), CGPoint(x: 42, y: 15), 0xF26522),
  (CGPoint(x: 20, y: 32), CGPoint(x: 42, y: 49), 0xF7F4EA),
]

for (start, end, ink) in strokes {
  context.move(to: start)
  context.addLine(to: end)
  context.setStrokeColor(colour(ink))
  context.strokePath()
}

guard let image = context.makeImage() else {
  FileHandle.standardError.write(Data("could not render the icon\n".utf8))
  exit(1)
}

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let url = URL(fileURLWithPath: output)
guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
  FileHandle.standardError.write(Data("could not open \(output)\n".utf8))
  exit(1)
}
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
  FileHandle.standardError.write(Data("could not write \(output)\n".utf8))
  exit(1)
}
print("wrote \(output) (\(size)×\(size))")
