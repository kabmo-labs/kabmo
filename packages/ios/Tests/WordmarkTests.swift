import CoreGraphics
import Foundation
import ImageIO
import KabmoShell
import UniformTypeIdentifiers

/// `Wordmark` against `public/kabmo-wordmark.svg`.
///
/// The overlay draws the SAME lockup README.md embeds, so the artwork exists twice:
/// once as the SVG for the README and once as the path strings in `Wordmark`. Two
/// copies of one drawing is exactly the shape that drifts silently — a colour nudged
/// in the SVG, a stroke re-exported — and nothing on screen would say so: the
/// overlay still renders, just not the mark.
///
/// So this re-derives the Swift copy from the SVG rather than trusting it, the same
/// guard `packages/android`'s `WordmarkDrawableTest` applies to its VectorDrawable:
///
/// - the viewport IS the SVG's viewBox, and the shift IS `-viewBox.y`;
/// - every path in the SVG appears here with every y coordinate moved by that shift
///   and every x untouched;
/// - the plate is the SVG's `<rect>` (same size, same radius, same fill);
/// - the gradient is the SVG's, over the same user-space span with the same stops;
/// - the stroke weight, caps and per-stroke colours are the SVG's;
/// - and the renderer puts INK where the artwork has ink and PAPER where it does
///   not, which is the half a coordinate comparison cannot see.
enum WordmarkTests {
  static func run() {
    guard let svg = try? String(contentsOf: Harness.repoRoot().appendingPathComponent("public/kabmo-wordmark.svg"), encoding: .utf8) else {
      Harness.check("the README's wordmark SVG is readable", false)
      return
    }

    Harness.group("Wordmark — viewport")

    let box = viewBox(svg)
    Harness.close("the viewport width is the SVG's", Double(Wordmark.viewBox.width), box.width)
    Harness.close("the viewport height is the SVG's", Double(Wordmark.viewBox.height), box.height)
    Harness.check("the SVG starts above the origin", box.minY < 0)
    Harness.close("the shift is -viewBox.y", Wordmark.shift, -box.minY)

    Harness.group("Wordmark — every SVG path, verbatim")

    let svgPaths = pathData(svg)
    Harness.equal("the SVG's five paths", svgPaths.count, 5)

    let swiftPaths = [Wordmark.stem, Wordmark.upperArm, Wordmark.lowerArm, Wordmark.wordA, Wordmark.wordO]
    for (index, d) in svgPaths.enumerated() where index < swiftPaths.count {
      // The strings are the SVG's OWN path data, kept verbatim: the y shift is
      // applied when a `CGPath` is built (below), so a copy that had already been
      // shifted would be shifted twice by that step and still "look right" here.
      Harness.check("path \(index): identical to the SVG", swiftPaths[index] == d)
    }

    Harness.group("Wordmark — the shift, applied to the built path")

    // The one thing the verbatim strings cannot show: that `paths()` actually moves
    // every y by `shift`. The stem is x 48.83, y -91.5…-8.5 in the SVG, so after the
    // shift its box is y 36.62…119.62 — inside the 0-based viewport, which is the
    // whole reason for the shift.
    if let built = try? Wordmark.paths(), built.count == 5 {
      let stem = built[0].boundingBox
      Harness.close("the stem keeps its x", Double(stem.minX), 48.83)
      Harness.close("the stem's top moved by the shift", Double(stem.minY), 36.62)
      Harness.close("the stem's bottom moved by the shift", Double(stem.maxY), 119.62)

      var outside = 0
      for path in built {
        let box = path.boundingBox
        if box.minY < -0.01 || box.maxY > Wordmark.size.height + 0.01 { outside += 1 }
        if box.minX < -0.01 || box.maxX > Wordmark.size.width + 0.01 { outside += 1 }
      }
      Harness.equal("every path sits inside the shifted viewport", outside, 0)
    } else {
      Harness.check("the paths build", false)
    }

    Harness.group("Wordmark — the plate")

    guard let rect = firstStringMatch(
      #"<rect width="([\d.]+)" height="([\d.]+)" y="([-\d.]+)" rx="([\d.]+)" fill="(#[0-9a-fA-F]{6})""#,
      in: svg
    ) else {
      Harness.check("the SVG declares its plate as a rect", false)
      return
    }
    Harness.close("the plate's width", Double(Wordmark.Plate.size.width), Double(rect[0]) ?? 0)
    Harness.close("the plate's height", Double(Wordmark.Plate.size.height), Double(rect[1]) ?? 0)
    Harness.close("the plate's corner radius", Double(Wordmark.Plate.cornerRadius), Double(rect[3]) ?? 0)
    Harness.equal("the plate's fill", Wordmark.Plate.color.lowercased(), rect[4].lowercased())
    Harness.close("the plate begins at the viewBox's top", (Double(rect[2]) ?? 0) + Wordmark.shift, 0)

    Harness.group("Wordmark — the gradient")

    guard let gradient = firstMatch(
      #"<linearGradient[^>]*x1="([\d.]+)"[^>]*y1="([-\d.]+)"[^>]*x2="([\d.]+)"[^>]*y2="([-\d.]+)""#,
      in: svg
    ), gradient.count == 4 else {
      Harness.check("the SVG declares its gradient span", false)
      return
    }
    Harness.close("the gradient's start x", Double(Wordmark.Gradient.start.x), gradient[0])
    Harness.close("the gradient's start y", Double(Wordmark.Gradient.start.y), gradient[1])
    Harness.close("the gradient's end x", Double(Wordmark.Gradient.end.x), gradient[2])
    Harness.close("the gradient's end y", Double(Wordmark.Gradient.end.y), gradient[3])

    let stops = allMatches(#"<stop offset="\d" stop-color="(#[0-9a-fA-F]{6})""#, in: svg)
    Harness.equal("the SVG's two stops", stops.count, 2)
    if stops.count == 2 {
      Harness.equal("the first stop", Wordmark.Gradient.startColor.lowercased(), stops[0].lowercased())
      Harness.equal("the second stop", Wordmark.Gradient.endColor.lowercased(), stops[1].lowercased())
    }

    Harness.group("Wordmark — the K's strokes")

    guard let group = firstStringMatch(
      #"<g fill="none" stroke-width="([\d.]+)" stroke-linecap="(\w+)" stroke-linejoin="(\w+)""#,
      in: svg
    ) else {
      Harness.check("the SVG declares the K's stroke style", false)
      return
    }
    let svgStrokes = allMatches(#"<path d="[^"]+" stroke="(#[0-9a-fA-F]{6})""#, in: svg)
    Harness.equal("three strokes: stem, upper arm, lower arm", svgStrokes.count, 3)
    Harness.close("the stroke weight", Double(Wordmark.Stroke.width), Double(group[0]) ?? 0)
    Harness.equal("the stroke cap", "round", group[1].lowercased())
    Harness.equal("the stroke join", "round", group[2].lowercased())

    Harness.group("Wordmark — the word's ink")

    // `mo` is one ink chosen to hold on any background; the SVG documents why it is
    // not a media query. A theme colour here would make the overlay's wordmark
    // follow the device's palette while the README's does not.
    guard let ink = firstStringMatch(#"\.kabmo-mo \{ fill: (#[0-9a-fA-F]{6}); \}"#, in: svg) else {
      Harness.check("the SVG declares the mo ink", false)
      return
    }
    Harness.equal("the word's ink", Wordmark.wordInk.lowercased(), ink[0].lowercased())

    Harness.group("Wordmark — the drawn bitmap")

    guard let image = try? WordmarkRenderer.image(scale: 2) else {
      Harness.check("the renderer produces a bitmap", false)
      return
    }
    Harness.equal("the bitmap's height", image.height, Int((Wordmark.size.height * 2).rounded()))
    Harness.equal("the bitmap's width", image.width, Int((Wordmark.size.width * 2).rounded()))

    // Ink where the artwork has ink, paper where it does not. The plate is the
    // artwork's left square, so a point just inside it is green and a point above
    // the word's baseline in the empty right margin is transparent — a mis-shifted
    // path or a gradient running the wrong way still draws a rectangle, which is why
    // the coordinates below are checked rather than only "something was drawn".
    Harness.check(
      "the plate is painted where the artwork puts it",
      !isTransparent(image, x: 40, y: 40)
    )
    Harness.check(
      "the top-right corner of the box is empty",
      isTransparent(image, x: image.width - 4, y: 4)
    )
    Harness.check(
      "the bottom-right corner of the box is empty",
      isTransparent(image, x: image.width - 4, y: image.height - 4)
    )
    Harness.check(
      "the word has ink on its baseline band",
      hasInk(in: image, xRange: 420..<470, yRange: 240..<290)
    )
  }

  // MARK: - SVG reading

  /// The SVG's viewBox as a rect.
  private static func viewBox(_ svg: String) -> CGRect {
    guard let values = firstMatch(#"viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)""#, in: svg), values.count == 4 else {
      return .zero
    }
    return CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
  }

  /// Every path's `d`, in document order.
  private static func pathData(_ svg: String) -> [String] {
    allMatches(#"<path[^>]*\sd="([^"]+)""#, in: svg)
  }

  private static func firstMatch(_ pattern: String, in text: String) -> [Double]? {
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    else { return nil }

    var out: [Double] = []
    for index in 1..<match.numberOfRanges {
      guard let range = Range(match.range(at: index), in: text) else { continue }
      let value = String(text[range])
      // A capture group that is not numeric (a colour, a cap name) is kept as 0 so
      // the positions of the numeric ones stay stable; callers read by index.
      out.append(Double(value) ?? 0)
    }
    return out
  }

  /// Capture groups as strings — for the parts that are not numbers (a colour, a
  /// cap name).
  private static func firstStringMatch(_ pattern: String, in text: String) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    else { return nil }

    var out: [String] = []
    for index in 1..<match.numberOfRanges {
      guard let range = Range(match.range(at: index), in: text) else { continue }
      out.append(String(text[range]))
    }
    return out
  }

  private static func allMatches(_ pattern: String, in text: String) -> [String] {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
    return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
      guard let range = Range(match.range(at: 1), in: text) else { return nil }
      return String(text[range])
    }
  }

  /// Whether an argument at `index` is a y coordinate for `op`.
  ///
  /// The same table `packages/android`'s wordmark test uses, so the two shells'
  /// guards agree about what a "shift" means.
  private static func isY(_ op: Character, _ index: Int) -> Bool {
    switch op {
    case "M", "L", "T": return index == 1
    case "V": return index == 0
    case "Q", "S": return index == 1 || index == 3
    case "C": return index % 2 == 1
    default: return false
    }
  }

  // MARK: - Pixel reading

  private static func isTransparent(_ image: CGImage, x: Int, y: Int) -> Bool {
    alpha(image, x: x, y: y) < 8
  }

  private static func hasInk(in image: CGImage, xRange: Range<Int>, yRange: Range<Int>) -> Bool {
    for y in stride(from: yRange.lowerBound, to: yRange.upperBound, by: 3) {
      for x in stride(from: xRange.lowerBound, to: xRange.upperBound, by: 3) where alpha(image, x: x, y: y) > 40 {
        return true
      }
    }
    return false
  }

  /// One pixel's alpha, read through a 1×1 crop so no buffer layout is assumed.
  private static func alpha(_ image: CGImage, x: Int, y: Int) -> UInt8 {
    guard x >= 0, y >= 0, x < image.width, y < image.height else { return 0 }
    guard let crop = image.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)) else { return 0 }
    var pixel: [UInt8] = [0, 0, 0, 0]
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(
            data: &pixel,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 4,
            space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          )
    else { return 0 }
    context.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    return pixel[3]
  }
}
