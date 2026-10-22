#if canImport(UIKit)
import UIKit

/// Kabmo's paper palette, for the two surfaces the shell draws natively.
///
/// The console paints its own theme as soon as it loads, so this exists only for
/// the frame between launch and first paint — the launch overlay, the settings
/// screen and the window background. The values are the light theme's own, taken
/// from `src/client/tailwind.css`; hardcoding a different paper here would flash a
/// different product for the first second.
///
/// Not a theme engine: the shell has two screens and no dark mode of its own. The
/// console's theme is a setting inside the page, and the overlay is gone by the
/// time the page can paint anything.
enum Palette {
  static let paper = UIColor(red: 0xFA / 255, green: 0xF8 / 255, blue: 0xF3 / 255, alpha: 1)
  static let ink = UIColor(red: 0x14 / 255, green: 0x13 / 255, blue: 0x10 / 255, alpha: 1)
  static let inkMuted = UIColor(red: 0x5A / 255, green: 0x55 / 255, blue: 0x4A / 255, alpha: 1)
  static let inkFaint = UIColor(red: 0x7A / 255, green: 0x74 / 255, blue: 0x68 / 255, alpha: 1)
  static let hairline = UIColor(red: 0xD9 / 255, green: 0xD4 / 255, blue: 0xC7 / 255, alpha: 1)
  static let error = UIColor(red: 0xB3 / 255, green: 0x26 / 255, blue: 0x1E / 255, alpha: 1)
  static let success = UIColor(red: 0x0B / 255, green: 0x5D / 255, blue: 0x3B / 255, alpha: 1)
  static let warningInk = UIColor(red: 0x8A / 255, green: 0x5A / 255, blue: 0x00 / 255, alpha: 1)
  static let warningFill = UIColor(red: 0xFF / 255, green: 0xF4 / 255, blue: 0xDC / 255, alpha: 1)
  static let warningHairline = UIColor(red: 0xE8 / 255, green: 0xD4 / 255, blue: 0xA8 / 255, alpha: 1)
  static let field = UIColor.white
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
