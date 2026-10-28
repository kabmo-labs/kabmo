/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The splash's palette: what the console reports, and what the shell may paint.
 *
 * Every case here is a colour a user sees for the seconds before the console
 * paints, and each failure is silent: a parser that accepts six fields paints
 * `#000000` where the console paints paper, one that rejects the page's own
 * quoting never updates at all, and a default that drifts from the shared module
 * leaves a first launch painting a palette no theme chose.
 *
 * The splash shipped `NSColor.windowBackgroundColor`, which follows the SYSTEM
 * appearance rather than the console's theme — so a dark console on a light
 * macOS opened on a white rectangle, which is the bug this pins.
 */

import AppKit
import Foundation

import KabmoDesktop

func shellPaletteCases() {
  // `shellPaletteWire(shellPalette(null))` from
  // `src/shared/lib/theme/shell-palette.ts`.
  let defaultWire = "light|#f4f1ea|#faf8f3|#141310|#696763|#d5d2cb|#c8321e"
  // `shellPaletteWire(shellPalette('one-dark-pro-soft'))`.
  let darkWire = "dark|#21252b|#282c34|#abb2bf|#777c87|#343940|#e06c75"

  group("ShellPalette")

  // A hand-typed copy is what this pins: the five shells' first-launch colours
  // have to be the shared projection's, or a fresh install paints a palette that
  // exists in no theme.
  check("the shipped palette is the shared default", ShellPalette.shipped.wire == defaultWire)
  check("the shipped palette is light", !ShellPalette.shipped.isDark)

  let dark = ShellPalette.parse(darkWire)
  check("a wire round-trips", dark?.wire == darkWire)
  check("the ground is the page's canvas", dark?.canvas == "#21252b")
  check("the failure colour survives", dark?.error == "#e06c75")
  check("a dark wire is dark", dark?.isDark == true)

  // A partial palette would paint some fields and leave the rest at zero, which
  // reads as a different theme rather than as no answer.
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
    check("rejects \(bad ?? "nil")", ShellPalette.parse(bad) == nil)
  }

  // A colour that will not parse must not paint: an unpainted view is worse than
  // the wrong shade, and the wrong shade is recoverable on the next load.
  check(
    "an unparseable colour falls back to the shipped canvas",
    ShellPalette.color("not-a-colour") == ShellPalette.color(ShellPalette.shipped.canvas)
  )
  let canvas = ShellPalette.parse(defaultWire)?.canvasColor
  check("the canvas colour is the palette's own", canvas == ShellPalette.color("#f4f1ea"))
}
