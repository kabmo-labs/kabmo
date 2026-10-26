/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The colours the launch overlay paints with, as the console reported them.
 *
 * ## Why the shell stores a palette at all
 *
 * The overlay is drawn from the tap until the page paints — and the page's own
 * bundle is what would report a colour — so the shell has to already know it.
 * It learns it from the CONSOLE, on the load that hides the overlay
 * (`window.__kabmoPalette()`), and keeps the answer for the next cold start.
 *
 * ## Why the wire is a pipe-separated line
 *
 * The page publishes `variant|canvas|paper|ink|muted|hairline|error`. JSON would
 * work here, but the Android twin reads the same string with a parser that
 * cannot be unit-tested if the wire is JSON, and one wire is worth more than
 * one convenience. Every value is `#rrggbb`, so there is nothing to escape.
 *
 * ## Why the default is the shipped light palette
 *
 * A first launch has never seen a page, so there is nothing to remember. The
 * numbers are `shellPaletteWire(shellPalette(null))` from
 * `src/shared/lib/theme/shell-palette.ts`, and `ShellPaletteTests` pins the
 * whole string — a change on either side has to be made on both.
 *
 * Pure Foundation, so the rules suite runs it on a plain Mac with no simulator.
 */
public struct ShellPalette: Equatable {

  /// Which side of the light/dark split the console is painting.
  public let variant: String
  /// The page's own ground — what the overlay and the web view paint.
  public let canvas: String
  /// A raised surface: an outlined button's fill.
  public let paper: String
  /// Foreground text, and the progress bar's fill.
  public let ink: String
  /// Secondary text — the overlay's status line.
  public let muted: String
  /// The bar's trough and a button's border.
  public let hairline: String
  /// The failure sentence's colour.
  public let error: String

  public init(
    variant: String,
    canvas: String,
    paper: String,
    ink: String,
    muted: String,
    hairline: String,
    error: String
  ) {
    self.variant = variant
    self.canvas = canvas
    self.paper = paper
    self.ink = ink
    self.muted = muted
    self.hairline = hairline
    self.error = error
  }

  public var isDark: Bool { variant == "dark" }

  /// The wire form, for the preference store.
  public var wire: String {
    [variant, canvas, paper, ink, muted, hairline, error].joined(separator: "|")
  }

  /// The shipped light palette — what a first launch paints.
  public static let shipped = ShellPalette(
    variant: "light",
    canvas: "#f4f1ea",
    paper: "#faf8f3",
    ink: "#141310",
    muted: "#696763",
    hairline: "#d5d2cb",
    error: "#c8321e"
  )

  /// A stored or published wire, or nil when it is not one.
  ///
  /// Nil rather than a partial value: a field that could not be read would paint
  /// `#000000` where the console paints paper, and the caller's fallback (the
  /// stored palette, else `shipped`) is the only answer that cannot be wrong.
  public static func parse(_ wire: String?) -> ShellPalette? {
    guard let wire else { return nil }
    let parts = wire.components(separatedBy: "|")
    guard parts.count == 7 else { return nil }
    guard parts[0] == "light" || parts[0] == "dark" else { return nil }
    for value in parts.dropFirst() where !isHex(value) { return nil }
    return ShellPalette(
      variant: parts[0],
      canvas: parts[1],
      paper: parts[2],
      ink: parts[3],
      muted: parts[4],
      hairline: parts[5],
      error: parts[6]
    )
  }

  /// `#rrggbb`, in either case.
  static func isHex(_ value: String) -> Bool {
    guard value.count == 7, value.hasPrefix("#") else { return false }
    return value.dropFirst().allSatisfy { $0.isHexDigit }
  }
}
