#if canImport(UIKit)
import UIKit

import KabmoShell

/// The shell's own palette, for the surfaces it draws natively.
///
/// The console paints its own theme as soon as it loads, so this exists only for
/// the frame between launch and first paint — the launch overlay, the settings
/// screen and the window background.
///
/// ## It is the CONSOLE's palette, not a second one
///
/// These values used to be literals taken from `src/client/tailwind.css`'s light
/// theme, which is the same thing as saying the shell had a palette of its own:
/// on a dark install the overlay was a paper-white rectangle for the whole cold
/// start, then a jump to a near-black console. `active` is now the palette the
/// page last reported (`ShellPalette`), read through `ShellSettings`, and the
/// constants below are only the FIRST launch's answer — the one time no page has
/// ever run.
///
/// The settings screen is deliberately not themed yet: it is a form of platform
/// controls, and repainting it half-way is a worse result than leaving it on the
/// light palette. The overlay is the surface a user sees for seconds at every
/// launch, which is why it goes first.
enum Palette {

  /// The palette in force. Replaced once the console answers.
  static var active: ShellPalette = .shipped

  static var paper: UIColor { color(active.canvas) }
  static var ink: UIColor { color(active.ink) }
  static var inkMuted: UIColor { color(active.muted) }
  static var hairline: UIColor { color(active.hairline) }
  static var error: UIColor { color(active.error) }
  static var field: UIColor { color(active.paper) }
  static var inkFaint: UIColor { color(active.muted) }

  static let success = UIColor(red: 0x0B / 255, green: 0x5D / 255, blue: 0x3B / 255, alpha: 1)
  static let warningInk = UIColor(red: 0x8A / 255, green: 0x5A / 255, blue: 0x00 / 255, alpha: 1)
  static let warningFill = UIColor(red: 0xFF / 255, green: 0xF4 / 255, blue: 0xDC / 255, alpha: 1)
  static let warningHairline = UIColor(red: 0xE8 / 255, green: 0xD4 / 255, blue: 0xA8 / 255, alpha: 1)

  /// `#rrggbb` as a colour. A value that will not parse is the shipped canvas,
  /// because an unpainted view is worse than a wrong shade.
  static func color(_ hex: String) -> UIColor {
    guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else {
      return UIColor(red: 0xF4 / 255, green: 0xF1 / 255, blue: 0xEA / 255, alpha: 1)
    }
    return UIColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1
    )
  }
}

/// A filled or outlined button in the shell's own style.
///
/// `UIButton.Configuration` rather than `UIButton(type: .system)`: the system style
/// tints every label with the app's accent, and this app has no accent — the
/// console's palette is monochrome plus a signal red for failures.
enum ShellButton {
  static func make(title: String, filled: Bool, action: UIAction) -> UIButton {
    var configuration = UIButton.Configuration.plain()
    configuration.title = title
    configuration.baseForegroundColor = filled ? Palette.paper : Palette.ink
    configuration.background.backgroundColor = filled ? Palette.ink : Palette.field
    configuration.background.strokeColor = filled ? Palette.ink : Palette.hairline
    configuration.background.strokeWidth = 1
    configuration.background.cornerRadius = 8
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
      var outgoing = incoming
      outgoing.font = .systemFont(ofSize: 14, weight: .medium)
      return outgoing
    }

    let button = UIButton(configuration: configuration, primaryAction: action)
    button.translatesAutoresizingMaskIntoConstraints = false
    return button
  }
}
#endif
