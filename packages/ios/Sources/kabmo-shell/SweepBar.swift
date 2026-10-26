#if canImport(UIKit)
import UIKit

/// A bar that sweeps while a load has no percentage to show.
///
/// The Android shell draws `ProgressBar` in its indeterminate mode — a segment
/// sliding along a track — and `UIProgressView` cannot: it has no indeterminate
/// state at all, which is why this shell used to swap the bar for a spinner and
/// therefore looked like a different product for the same three seconds. This is
/// the same promise drawn the same way: no number yet, and visibly moving.
///
/// The animation is on the LAYER, never a `UIView.animate` chain: the overlay
/// hides and shows with the page, and a UIView animation paused by a hidden view
/// leaves the segment wherever it stopped, which reads as a stuck bar.
final class SweepBar: UIView {

  private let track = CALayer()
  private let segment = CAGradientLayer()

  /// The segment's share of the track, the same proportion the other shells use.
  private static let segmentFraction: CGFloat = 0.32
  private static let duration: CFTimeInterval = 1.1

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    layer.addSublayer(track)
    layer.addSublayer(segment)
    segment.startPoint = CGPoint(x: 0, y: 0.5)
    segment.endPoint = CGPoint(x: 1, y: 0.5)
    applyPalette()
  }

  /// Repaint the track and the sweeping segment from the active palette.
  ///
  /// Called again when the console reports a new palette: the layers hold
  /// `CGColor`s, which do not follow `Palette` on their own — a `CALayer` copies
  /// the value at assignment, so the overlay would keep the colour it was built
  /// with for the life of the process.
  func applyPalette() {
    track.backgroundColor = Palette.hairline.cgColor
    segment.colors = [Palette.ink.withAlphaComponent(0.15).cgColor, Palette.ink.cgColor,
                      Palette.ink.withAlphaComponent(0.15).cgColor]
  }

  required init?(coder: NSCoder) {
    fatalError("SweepBar is created in code")
  }

  override var intrinsicContentSize: CGSize { CGSize(width: 180, height: 4) }

  override func layoutSubviews() {
    super.layoutSubviews()
    let height = max(bounds.height, 2)
    let radius = height / 2
    track.frame = bounds
    track.cornerRadius = radius
    let width = bounds.width * Self.segmentFraction
    segment.frame = CGRect(x: 0, y: 0, width: width, height: height)
    segment.cornerRadius = radius
    // Restart from the current geometry: the slide is a keyframe over a fixed
    // span, so a bounds change during the animation would leave it off-track.
    if !isHidden { start() }
  }

  /// Begin sweeping. Idempotent, so a re-layout does not stack animations.
  ///
  /// One direction, repeated — the shape Android's indeterminate bar has. A
  /// bouncing segment reads as a metronome rather than as a load in progress.
  /// A fresh animation each time, because `CAAnimation` is not reusable once it
  /// has been added: mutating the same instance leaves the previous run's copy in
  /// the layer's tree.
  func start() {
    guard !isHidden, bounds.width > 0 else { return }
    segment.removeAnimation(forKey: "slide")
    let width = bounds.width * Self.segmentFraction
    let slide = CABasicAnimation(keyPath: "position.x")
    slide.fromValue = width / 2
    slide.toValue = bounds.width - width / 2
    slide.duration = Self.duration
    slide.repeatCount = .infinity
    slide.timingFunction = CAMediaTimingFunction(name: .linear)
    segment.add(slide, forKey: "slide")
  }

  func stop() {
    segment.removeAnimation(forKey: "slide")
  }

  override var isHidden: Bool {
    didSet {
      if isHidden { stop() } else { start() }
    }
  }
}
#endif
