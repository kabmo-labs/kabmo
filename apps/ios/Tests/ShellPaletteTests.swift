import Foundation

import KabmoShell

/// The overlay's palette: what the console reports, and what a shell may paint.
///
/// Every case here is a colour a user sees for the seconds before the console
/// paints, and each failure is silent: a parser that accepts six fields paints
/// `#000000` where the console paints paper, one that rejects the page's own
/// quoting never updates at all, and a default that drifts from the shared
/// module leaves a first launch painting a palette no theme chose.
enum ShellPaletteTests {

  /// `shellPaletteWire(shellPalette(null))` from `src/shared/lib/theme/shell-palette.ts`.
  static let defaultWire = "light|#f4f1ea|#faf8f3|#141310|#696763|#d5d2cb|#c8321e"

  /// `shellPaletteWire(shellPalette('one-dark-pro-soft'))`.
  static let darkWire = "dark|#21252b|#282c34|#abb2bf|#777c87|#343940|#e06c75"

  static func run() {
    Harness.group("ShellPalette")

    // A hand-typed copy is what this pins: the five shells' first-launch colours
    // have to be the shared projection's, or a fresh install paints a palette
    // that exists in no theme.
    Harness.equal("the shipped palette is the shared default", ShellPalette.shipped.wire, defaultWire)
    Harness.check("the shipped palette is light", !ShellPalette.shipped.isDark)

    let dark = ShellPalette.parse(darkWire)
    Harness.equal("a wire round-trips", dark?.wire, darkWire)
    Harness.equal("the ground is the page's canvas", dark?.canvas, "#21252b")
    Harness.equal("the failure colour survives", dark?.error, "#e06c75")
    Harness.check("a dark wire is dark", dark?.isDark == true)

    // A partial palette would paint some fields and leave the rest at zero,
    // which reads as a different theme rather than as no answer.
    let rejected: [String?] = [
      nil,
      "",
      "light",
      "light|#f4f1ea|#faf8f3|#141310|#696763|#d5d2cb",
      defaultWire + "|extra",
      defaultWire.replacingOccurrences(of: "light", with: "sepia"),
      defaultWire.replacingOccurrences(of: "#f4f1ea", with: "#f4f1e"),
      defaultWire.replacingOccurrences(of: "#f4f1ea", with: "rgb(244,241,234)"),
    ]
    for bad in rejected {
      Harness.check("rejects \(bad ?? "nil")", ShellPalette.parse(bad) == nil)
    }

    Harness.check(
      "every slot is six-digit hex, which is what the shells parse",
      darkWire.split(separator: "|").dropFirst().allSatisfy { value in
        value.count == 7 && value.hasPrefix("#")
      }
    )
  }
}
