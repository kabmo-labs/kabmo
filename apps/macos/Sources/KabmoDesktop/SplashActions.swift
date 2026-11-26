/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The splash's two actions, and the geometry that makes them one control family.

 **Both buttons are drawn by this file, not by AppKit's bezel styles.** The
 shipped Retry was an `NSButton(bezelStyle: .rounded)`, which paints the SYSTEM's
 control colour: on a dark console it was a light-grey pill on the paper ground,
 and it ignored `ShellPalette` entirely — the splash recoloured its sentence, its
 bar and its background from the console's theme and left the one control a user
 actually presses in the platform's accent. The Android and iOS overlays already
 fill their Retry with the palette's `ink` and outline the secondary with `paper`
 and `hairline`, so this is that same pair, stated once for the desktop shell.

 The metrics are the mobile overlays' own, in points: 13pt label, 8pt corner,
 16 x 6 padding, 8pt between the buttons. They are constants rather than numbers
 scattered through the view because the two buttons must stay the same height —
 a Retry one line taller than the button beside it is the shape of bug that makes
 a failure splash look broken.
 */

import AppKit

/// The shared size of the splash's actions, in points.
public enum SplashActionMetrics {
  public static let fontSize: CGFloat = 13
  public static let cornerRadius: CGFloat = 8
  public static let horizontalPadding: CGFloat = 16
  public static let verticalPadding: CGFloat = 6
  /// A floor, so a one-word label cannot produce a button shorter than a thumb.
  public static let minimumHeight: CGFloat = 30
  /// The gap between the buttons in the actions row.
  public static let gap: CGFloat = 8
}

/**
 One action on the splash: filled for the primary, outlined for the secondary.

 `isBordered` is OFF and the plate comes from the layer, because every bordered
 AppKit style is system-coloured. The title is an attributed string for the same
 reason: `contentTintColor` tints an image, not a borderless title.

 The palette is applied AFTER the title exists, and re-applied by
 `SplashView.applyPalette` — a theme read from the console on a later load must
 repaint a splash that is still on screen.
 */
public final class SplashActionButton: NSButton {

  /// Whether this is the primary (ink plate) or the secondary (paper plate).
  public let filled: Bool

  private let label: String

  public init(title: String, filled: Bool) {
    self.label = title
    self.filled = filled
    super.init(frame: .zero)
    self.title = title
    isBordered = false
    bezelStyle = .regularSquare
    wantsLayer = true
    layer?.masksToBounds = false
    setButtonType(.momentaryPushIn)
    focusRingType = .none
    applyPalette(.shipped)
  }

  public required init?(coder: NSCoder) { nil }

  /// Repaint the plate and the label from `palette`.
  public func applyPalette(_ palette: ShellPalette) {
    layer?.backgroundColor = (filled ? palette.inkColor : palette.paperColor).cgColor
    layer?.borderColor = palette.hairlineColor.cgColor
    layer?.borderWidth = 1
    layer?.cornerRadius = SplashActionMetrics.cornerRadius
    attributedTitle = NSAttributedString(
      string: label,
      attributes: [
        .foregroundColor: filled ? palette.canvasColor : palette.inkColor,
        .font: NSFont.systemFont(ofSize: SplashActionMetrics.fontSize),
      ]
    )
    invalidateIntrinsicContentSize()
  }

  /// The title's own size plus the padding — AppKit has no `contentInsets` for a
  /// borderless button, so the padding is added here rather than with a spacer.
  public override var intrinsicContentSize: NSSize {
    let text = super.intrinsicContentSize
    return NSSize(
      width: text.width + 2 * SplashActionMetrics.horizontalPadding,
      height: max(text.height + 2 * SplashActionMetrics.verticalPadding, SplashActionMetrics.minimumHeight)
    )
  }

  public override var isHighlighted: Bool {
    didSet { alphaValue = isHighlighted ? 0.8 : 1 }
  }
}
