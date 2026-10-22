import CoreGraphics
import Foundation

/// Draws the wordmark into a bitmap, with no UIKit in the way.
///
/// Separate from `Wordmark` (the geometry) and from the overlay (the views) so the
/// drawing can be exercised on a plain Mac: `WordmarkTests` rasterizes the lockup
/// and asserts ink where the artwork has ink and paper where it does not — a
/// mis-shifted path or a gradient running the wrong way draws a plausible-looking
/// rectangle and fails nothing else.
///
/// CoreGraphics draws with y increasing downward while the SVG is authored with y
/// increasing upward, so the context is flipped once at the top and every path is
/// then drawn in the artwork's own coordinates.
public enum WordmarkRenderer {

  /// Render the lockup at `scale` device pixels per artwork unit.
  ///
  /// `scale` is what makes the mark crisp on a 3× phone: the artwork's own units
  /// are CSS-like points, and a 1× bitmap of a 486-unit-wide mark would be blurry
  /// at any real size.
  public static func image(scale: CGFloat = 2) throws -> CGImage? {
    let width = Int((Wordmark.size.width * scale).rounded())
    let height = Int((Wordmark.size.height * scale).rounded())
    guard width > 0, height > 0 else { return nil }

    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          )
    else { return nil }

    context.setShouldAntialias(true)
    context.interpolationQuality = .high
    context.scaleBy(x: scale, y: scale)

    // The SVG's y grows upward; CoreGraphics' grows downward. Flipping here means
    // every coordinate below is the SVG's own, shifted only by `Wordmark.shift`.
    context.translateBy(x: 0, y: Wordmark.size.height)
    context.scaleBy(x: 1, y: -1)

    draw(into: context)
    return context.makeImage()
  }

  /// Draw the lockup into a context already in artwork coordinates.
  ///
  /// Exposed so a caller with its own context (a layer's `draw(in:)`) shares the
  /// one implementation rather than restating the plate, the strokes and the two
  /// fills.
  public static func draw(into context: CGContext) {
    // The plate. Drawn first: the word's fill overlaps its right edge, exactly as
    // the SVG's document order makes it.
    context.addPath(Wordmark.platePath())
    context.setFillColor(color(Wordmark.Plate.color))
    context.fillPath()

    guard let paths = try? Wordmark.paths(), paths.count == 5 else { return }

    // The three K strokes: stroked, never filled. A `CGPath` has no "unfilled"
    // state, so a caller that filled them would paint the K's triangle solid —
    // the same trap the VectorDrawable port documents.
    let strokes: [(CGPath, String)] = [
      (paths[0], "#f7f4ea"),
      (paths[1], "#f26522"),
      (paths[2], "#f7f4ea"),
    ]
    context.setLineWidth(Wordmark.Stroke.width)
    context.setLineCap(Wordmark.Stroke.cap)
    context.setLineJoin(Wordmark.Stroke.join)
    for (path, ink) in strokes {
      context.addPath(path)
      context.setStrokeColor(color(ink))
      context.strokePath()
    }

    // The `Kabm` glyphs, gradient-filled across the user-space span the SVG
    // declares.
    if let gradient = gradient(in: context) {
      context.saveGState()
      context.addPath(paths[3])
      context.clip()
      context.drawLinearGradient(
        gradient,
        start: CGPoint(x: Wordmark.Gradient.start.x, y: Wordmark.Gradient.start.y + Wordmark.shift),
        end: CGPoint(x: Wordmark.Gradient.end.x, y: Wordmark.Gradient.end.y + Wordmark.shift),
        options: []
      )
      context.restoreGState()
    }

    // The `o`, in the single `mo` ink.
    context.addPath(paths[4])
    context.setFillColor(color(Wordmark.wordInk))
    context.fillPath()
  }

  private static func gradient(in context: CGContext) -> CGGradient? {
    let colors = [color(Wordmark.Gradient.startColor), color(Wordmark.Gradient.endColor)] as CFArray
    return CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 1])
  }

  /// `#rrggbb` as a `CGColor`.
  ///
  /// Hand-parsed rather than through UIKit, so this module stays drawable in a
  /// test that has no window server.
  static func color(_ hex: String) -> CGColor {
    let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else {
      return CGColor(red: 0, green: 0, blue: 0, alpha: 1)
    }
    return CGColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1
    )
  }
}
