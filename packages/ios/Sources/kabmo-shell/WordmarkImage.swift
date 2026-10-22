#if canImport(UIKit)
import UIKit
import KabmoShell

/// The wordmark as a `UIImage`, drawn from the artwork's own geometry.
///
/// The launch overlay needs the README's lockup, and there is no SVG renderer in
/// UIKit — so the mark is rasterized once from `Wordmark` (which holds the SVG's
/// path data) through `WordmarkRenderer`, at the device's own scale. A bitmap
/// copied out of a design tool would be the third copy of one drawing; this is the
/// second, and `WordmarkTests` pins it against the SVG.
enum WordmarkImage {

  /// The mark at `height` points, in the current trait's scale.
  ///
  /// Rasterized per scale rather than from a single `UIImage` so the strokes stay
  /// crisp on a 3× phone: the artwork is authored in CSS-like units, and a 1×
  /// bitmap of a 486-unit-wide mark is visibly soft at 180 points.
  static func make(height: CGFloat, scale: CGFloat = UIScreen.main.scale) -> UIImage? {
    let ratio = Wordmark.size.height / Wordmark.size.width
    let width = height / ratio
    let pixelScale = scale * (height / Wordmark.size.height)

    guard let cgImage = try? WordmarkRenderer.image(scale: pixelScale) else { return nil }
    return UIImage(cgImage: cgImage, scale: scale, orientation: .up)
      .resizableImage(withCapInsets: .zero, resizingMode: .stretch)
      .withRenderingSize(width: width, height: height)
  }
}

private extension UIImage {
  /// A copy carrying an explicit size, so an `UIImageView` sizes it without the
  /// caller restating the aspect ratio.
  func withRenderingSize(width: CGFloat, height: CGFloat) -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height))
    let sized = renderer.image { _ in
      draw(in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return sized.withRenderingMode(.alwaysOriginal)
  }
}
#endif
