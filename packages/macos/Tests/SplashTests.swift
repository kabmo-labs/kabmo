/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The launch splash, asserted against the artwork and against itself.

 Two kinds of case, and both are things that fail silently in the app:

 1. **The state machine.** Every ordering below is one `WKWebView` really
    produces, and each wrong answer is a splash that is stuck, missing or lying —
    none of which throws.
 2. **The wordmark.** `Wordmark.swift` is GENERATED from
    `public/kabmo-wordmark.svg`, and `WordmarkRenderer` draws it. A copy that
    drifted, or a shift applied twice, still renders a plausible-looking
    rectangle; only re-deriving the numbers from the SVG and rasterizing the mark
    can see it.

 The macOS suite runs with no window server in this case (the drawing goes into a
 bitmap context), so both halves are here rather than in `TestsWindow`.
 */

import CoreGraphics
import Foundation

import KabmoDesktop

func splashCases() {
  // ------------------------------------------------------------ state machine

  group("SplashState")

  check("the connecting state is visible and indeterminate",
        SplashState.connecting.visible && SplashState.connecting.indeterminate)
  check("connecting says what it is doing",
        SplashState.connecting.sentence() == "Connecting to the server…")

  var state = SplashState.connecting
  state = state.progressed(0)
  check("a 0% estimate says nothing", state.indeterminate && state.phase == .connecting)
  state = state.progressed(42)
  check("a real estimate becomes determinate",
        state.phase == .loading && !state.indeterminate && state.percent == 42)
  check("the sentence carries the percentage",
        state.sentence() == "Loading the console… 42%")

  // A redirect restarts the document: 100 then 10. A bar that snapped back reads
  // as a stall, so the maximum wins.
  state = state.progressed(100).progressed(10)
  check("progress never moves backwards within a load", state.percent == 100)
  check("100% is not a finish", state.phase == .loading)

  state = state.finished()
  check("only the load's own end closes the splash",
        state.phase == .done && !state.visible)
  check("a finished splash draws nothing", state.sentence().isEmpty)
  check("an estimate after the end is ignored",
        state.progressed(80).phase == .done)

  // A failed main-frame load still fires `didFinish` for the error page WebKit
  // renders; adopting that would hide the explanation behind a blank window.
  let failed = SplashState.connecting.progressed(60).failedBecause(.connect)
  check("a failure keeps the reason on screen",
        failed.phase == .failed && failed.visible)
  check("a failure keeps the last real estimate for the record", failed.percent == 60)
  check("finishing does not overwrite a failure", failed.finished().phase == .failed)
  check("an estimate after a failure is ignored",
        failed.progressed(90).phase == .failed)
  check("each reason has its own sentence",
        Set([
          SplashState.sentence(for: .hostLookup),
          SplashState.sentence(for: .connect),
          SplashState.sentence(for: .timeout),
          SplashState.sentence(for: .ssl),
          SplashState.sentence(for: .other),
        ]).count == 5)

  // A fraction is what `estimatedProgress` reports; `Int(nan)` traps in Swift, so
  // the guard is not decorative.
  check("a non-finite estimate is not progress",
        SplashState.connecting.progressed(fraction: .nan).phase == .connecting)
  check("a fraction becomes whole percent",
        SplashState.connecting.progressed(fraction: 0.375).percent == 38)

  group("SplashState.isDocumentReload")
  check("a reload is the same address on a finished page",
        SplashState.isDocumentReload(
          started: "http://127.0.0.1:3000/", shown: "http://127.0.0.1:3000/", phase: .done))
  check("a navigation to another address is not a reload",
        !SplashState.isDocumentReload(
          started: "http://127.0.0.1:3000/settings", shown: "http://127.0.0.1:3000/", phase: .done))
  // The cold start's own `didStartProvisionalNavigation` arrives while the view
  // still shows the previous document; treating it as a reload would restart the
  // arm the load just made.
  check("a load that has not finished is never a reload",
        !SplashState.isDocumentReload(
          started: "http://127.0.0.1:3000/", shown: "http://127.0.0.1:3000/", phase: .connecting))
  check("a missing address is not a reload",
        !SplashState.isDocumentReload(started: nil, shown: nil, phase: .done))

  group("SplashState.failure(for:)")
  let host = URLError(.cannotFindHost)
  check("host lookup", SplashState.failure(for: host) == .hostLookup)
  check("connect", SplashState.failure(for: URLError(.cannotConnectToHost)) == .connect)
  check("timeout", SplashState.failure(for: URLError(.timedOut)) == .timeout)
  check("ssl", SplashState.failure(for: URLError(.serverCertificateUntrusted)) == .ssl)
  check("anything else", SplashState.failure(for: URLError(.badURL)) == .other)
  // A cancelled load is what a redirect reports, and it is not a failure — the
  // delegate filters it before it reaches the state machine, and this pins the
  // mapping so a second caller cannot surface one.
  check("a cancelled load is not surfaced as a failure reason",
        SplashState.failure(for: URLError(.cancelled)) == .other)

  // ---------------------------------------------------------------- wordmark

  guard let svg = try? String(
    contentsOf: repoFile("public/kabmo-wordmark.svg"),
    encoding: .utf8
  ) else {
    check("the README's wordmark SVG is readable", false)
    return
  }

  group("Wordmark — the SVG's own numbers")

  let viewBox = numbers(svg, #"viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)""#)
  check("the SVG has a four-number viewBox", viewBox.count == 4)
  if viewBox.count == 4 {
    check("the viewport width is the SVG's", abs(Double(Wordmark.viewBox.width) - viewBox[2]) < 0.01)
    check("the viewport height is the SVG's", abs(Double(Wordmark.viewBox.height) - viewBox[3]) < 0.01)
    check("the SVG starts above the origin", viewBox[1] < 0)
    check("the shift is -viewBox.y", abs(Wordmark.shift + viewBox[1]) < 0.01)
  }

  let svgPaths = allStrings(svg, #"<path\b[^>]*\sd="([^"]+)""#)
  check("the SVG has five paths", svgPaths.count == 5)
  let swiftPaths = [Wordmark.stem, Wordmark.upperArm, Wordmark.lowerArm, Wordmark.wordA, Wordmark.wordO]
  for (index, d) in svgPaths.enumerated() where index < swiftPaths.count {
    // Verbatim: the y shift is applied when the `CGPath` is built, so a copy that
    // had already been shifted would be shifted twice and still "look right".
    check("path \(index) is the SVG's, verbatim", swiftPaths[index] == d)
  }

  let plate = numbers(svg, ##"<rect width="([\d.]+)" height="([\d.]+)" y="[-\d.]+" rx="([\d.]+)" fill="#[0-9a-f]{6}""##)
  check("the plate is the SVG's tile and radius",
        plate.count == 3
          && abs(Double(Wordmark.Plate.size.width) - plate[0]) < 0.01
          && abs(Double(Wordmark.Plate.cornerRadius) - plate[2]) < 0.01)
  check("the plate is the SVG's colour", svg.contains(Wordmark.Plate.color))

  let gradient = numbers(
    svg,
    #"<linearGradient[^>]*x1="([\d.]+)" y1="[-\d.]+" x2="([\d.]+)" y2="[-\d.]+""#
  )
  check("the gradient runs over the SVG's span",
        gradient.count == 2
          && abs(Double(Wordmark.Gradient.start.x) - gradient[0]) < 0.01
          && abs(Double(Wordmark.Gradient.end.x) - gradient[1]) < 0.01)
  check("the gradient keeps both stops",
        svg.contains(Wordmark.Gradient.startColor) && svg.contains(Wordmark.Gradient.endColor))
  check("the mo ink is the SVG's", svg.contains(Wordmark.wordInk))
  check("the stroke weight is the SVG's",
        svg.contains("stroke-width=\"\(trimmed(Wordmark.Stroke.width))\""))

  group("Wordmark — the shift, applied to the built path")
  if let built = try? Wordmark.paths(), built.count == 5 {
    // The stem is x 48.83, y -91.5…-8.5 in the SVG, so after the shift its box is
    // y 36.62…119.62 — inside the 0-based viewport, which is the reason for it.
    let stem = built[0].boundingBox
    check("the stem lands inside the 0-based viewport",
          abs(stem.minY - 36.62) < 0.2 && abs(stem.maxY - 119.62) < 0.2)
    check("the shift moves y only", abs(stem.minX - 48.83) < 0.2)
    check("the whole lockup fits its own viewport",
          built.allSatisfy { $0.boundingBox.minY > -0.5 })
  } else {
    check("every path parses", false)
  }

  group("Wordmark — the rendered mark")
  // The half a coordinate comparison cannot see: ink where the artwork has ink,
  // paper where it does not. A gradient running the wrong way, or a clip that
  // never applied, draws a plausible rectangle and fails nothing else.
  if let image = try? WordmarkRenderer.image(scale: 1) {
    check("the mark rasterizes at the artwork's own size",
          image.width == Int(Wordmark.size.width.rounded())
            && image.height == Int(Wordmark.size.height.rounded()))
    // The plate is the artwork's left square: (20, 78) is inside it and left of
    // the K's stem, which starts at x 48.83 less half a stroke.
    let plate = pixel(image, x: 20, y: 78)
    check("the plate is painted where the artwork puts it", plate.alpha > 200)
    check("the plate is the brand green", isNear(plate.hex, Wordmark.Plate.color))
    // The top margin is above every glyph (the tallest starts at y 28), and the
    // bottom-right corner is past the `o`.
    check("the gap above the word is empty", pixel(image, x: 300, y: 4).alpha < 8)
    check("the corner past the word is empty", pixel(image, x: 482, y: 152).alpha < 8)
    // The word is drawn to the RIGHT of the plate and in the gradient's amber,
    // never the plate's green — which is what a missing clip, a gradient built in
    // the wrong space or a path filled instead of stroked would each get wrong.
    let amber = countPixels(image, x: 160..<480, y: 20..<140) { hex, alpha in
      guard alpha > 100, let value = rgb(hex) else { return false }
      return value.0 > value.1 && value.1 > value.2
    }
    check("the word is drawn in the gradient's amber", amber > 200)
    let green = countPixels(image, x: 170..<480, y: 20..<140) { hex, alpha in
      alpha > 100 && isNear(hex, Wordmark.Plate.color, tolerance: 24)
    }
    check("no plate green spills past the tile", green == 0)
  } else {
    check("the mark rasterizes", false)
  }
}

// -------------------------------------------------------------------- helpers

/// The repository root, found by walking up for the shared artwork.
///
/// A test that could not find the SVG must FAIL rather than skip: a skipped
/// comparison is a copy nobody is checking.
func repoFile(_ relative: String) -> URL {
  var directory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).standardizedFileURL
  for _ in 0..<8 {
    let candidate = directory.appendingPathComponent(relative)
    if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
    directory.deleteLastPathComponent()
  }
  fatalError("could not find \(relative) above the working directory")
}

/// Every capture group of the FIRST match, as numbers.
private func numbers(_ source: String, _ pattern: String) -> [Double] {
  guard let regex = try? NSRegularExpression(pattern: pattern),
        let match = regex.firstMatch(in: source, range: NSRange(source.startIndex..., in: source))
  else { return [] }
  return (1..<match.numberOfRanges).compactMap { index in
    Range(match.range(at: index), in: source).flatMap { Double(source[$0]) }
  }
}

/// Every first capture group of every match.
private func allStrings(_ source: String, _ pattern: String) -> [String] {
  guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
  let range = NSRange(source.startIndex..., in: source)
  return regex.matches(in: source, range: range).compactMap { match in
    Range(match.range(at: 1), in: source).map { String(source[$0]) }
  }
}

/// A number as the SVG writes it: no trailing `.0`.
private func trimmed(_ value: CGFloat) -> String {
  value == value.rounded() ? String(Int(value)) : String(Double(value))
}

/// One pixel of the rendered mark, read through a 1×1 crop.
///
/// A crop rather than an index into a buffer: `CGImage`'s byte layout, row order
/// and premultiplication are not something a test should be restating. `y` is
/// measured from the TOP of the picture, which is how the artwork's own
/// coordinates read to a person looking at it — CoreGraphics' own origin is the
/// bottom, so the crop rect is flipped here.
private func pixel(_ image: CGImage, x: Int, y: Int) -> (hex: String, alpha: UInt8) {
  guard x >= 0, y >= 0, x < image.width, y < image.height else { return ("#000000", 0) }
  let rect = CGRect(x: x, y: image.height - 1 - y, width: 1, height: 1)
  guard let crop = image.cropping(to: rect) else { return ("#000000", 0) }
  var buffer: [UInt8] = [0, 0, 0, 0]
  guard let space = CGColorSpace(name: CGColorSpace.sRGB),
        let context = CGContext(
          data: &buffer,
          width: 1,
          height: 1,
          bitsPerComponent: 8,
          bytesPerRow: 4,
          space: space,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
  else { return ("#000000", 0) }
  context.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
  return (String(format: "#%02x%02x%02x", buffer[0], buffer[1], buffer[2]), buffer[3])
}

/// How many pixels in a box satisfy `match`, sampled every third pixel.
private func countPixels(
  _ image: CGImage,
  x: Range<Int>,
  y: Range<Int>,
  _ match: (String, UInt8) -> Bool
) -> Int {
  var count = 0
  for row in stride(from: y.lowerBound, to: y.upperBound, by: 3) {
    for column in stride(from: x.lowerBound, to: x.upperBound, by: 3) {
      let value = pixel(image, x: column, y: row)
      if match(value.hex, value.alpha) { count += 1 }
    }
  }
  return count
}

/// Whether two `#rrggbb` colours are the same to within rounding.
private func isNear(_ actual: String, _ expected: String, tolerance: Int = 12) -> Bool {
  guard let a = rgb(actual), let b = rgb(expected) else { return false }
  return abs(a.0 - b.0) <= tolerance && abs(a.1 - b.1) <= tolerance && abs(a.2 - b.2) <= tolerance
}

/// Whether a pixel is the paper the splash paints (or transparent over it).
private func isPaper(_ hex: String) -> Bool {
  guard let value = rgb(hex) else { return false }
  return value.0 > 240 && value.1 > 240 && value.2 > 240
}

private func rgb(_ hex: String) -> (Int, Int, Int)? {
  let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
  guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else { return nil }
  return (Int((value >> 16) & 0xFF), Int((value >> 8) & 0xFF), Int(value & 0xFF))
}
