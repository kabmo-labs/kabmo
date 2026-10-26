/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The launch surface, from the tap until the console paints.
 *
 * A page cannot report its own readiness — its bundle is what renders the app —
 * and a splash drawn BY the page would vanish exactly when the page fails to
 * load. So this is a sibling of the webview, owned by the shell.
 *
 * The same four things the Android and iOS shells draw, in the same order: the
 * README's wordmark, a progress bar, one sentence, and — on a failure — Retry.
 * Every state decision is `SplashState`'s and this class only draws it, because
 * the orderings that fail (a late estimate resurrecting a finished splash, an
 * error page's own `didFinish`) are not visible in a view.
 */

import AppKit

/// The launch surface, in the LIBRARY rather than the app target.
///
/// It was in `kabmo-desktop` (the executable) and that put it out of reach of
/// `TestsWindow`, which drives a real window: the state machine could be tested
/// and the view that draws it could not, so a splash that rendered the wrong
/// phase — or nothing at all — passed every suite. It needs only AppKit, so the
/// library can hold it, and `ShellWindow.swift` already lives there for the same
/// reason.
public final class SplashView: NSView {

  /// Called when the user asks to try the address again.
  public var onRetry: (() -> Void)?

  private let wordmark = NSImageView()
  private let bar = NSProgressIndicator()
  private let status = NSTextField(labelWithString: "")
  private let retry = NSButton(title: "Retry", target: nil, action: nil)

  public override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    autoresizingMask = [.width, .height]

    // The wordmark is the ARTWORK, not the app's name in a text field: it is the
    // same lockup README.md embeds (`public/kabmo-wordmark.svg`), rasterized from
    // the SVG's own path data because AppKit has no renderer for one.
    wordmark.image = WordmarkImage.make(height: 58)
    wordmark.imageScaling = .scaleProportionallyUpOrDown
    wordmark.setAccessibilityLabel("Kabmo")

    bar.style = .bar
    bar.isIndeterminate = true
    bar.controlSize = .small
    bar.minValue = 0
    bar.maxValue = 100
    bar.startAnimation(nil)

    status.font = .systemFont(ofSize: 12)
    status.textColor = .secondaryLabelColor
    status.alignment = .center
    status.maximumNumberOfLines = 3
    status.lineBreakMode = .byWordWrapping
    status.preferredMaxLayoutWidth = 460

    retry.bezelStyle = .rounded
    retry.isHidden = true
    retry.target = self
    retry.action = #selector(retryTapped)

    for view in [wordmark, bar, status, retry] {
      view.translatesAutoresizingMaskIntoConstraints = false
      addSubview(view)
    }
    NSLayoutConstraint.activate([
      // 180 points wide is the artwork's own intrinsic width at the height above,
      // fixed rather than intrinsic so the column's height does not depend on how
      // a given scale measures the bitmap.
      wordmark.widthAnchor.constraint(equalToConstant: 180),
      wordmark.heightAnchor.constraint(equalToConstant: 58),
      wordmark.centerXAnchor.constraint(equalTo: centerXAnchor),
      wordmark.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -34),
      bar.widthAnchor.constraint(equalToConstant: 180),
      bar.centerXAnchor.constraint(equalTo: centerXAnchor),
      bar.topAnchor.constraint(equalTo: wordmark.bottomAnchor, constant: 16),
      status.centerXAnchor.constraint(equalTo: centerXAnchor),
      status.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 10),
      status.widthAnchor.constraint(lessThanOrEqualToConstant: 460),
      retry.centerXAnchor.constraint(equalTo: centerXAnchor),
      retry.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 16),
    ])

    render(.done)
  }

  public required init?(coder: NSCoder) { nil }

  /// Draw a state. The single entry point, so no caller can leave the splash
  /// half-updated — the bar, the sentence and the actions always describe one
  /// `SplashState`.
  public func render(_ state: SplashState) {
    isHidden = !state.visible
    guard state.visible else { return }
    alphaValue = 1

    let failed = state.phase == .failed
    retry.isHidden = !failed

    // A determinate bar at 0 is the "stuck" look this splash exists to remove, so
    // the connecting phase keeps it sweeping until a real percentage arrives —
    // and a FAILED load hides it, because a frozen partial bar says "still
    // working" over a message that says the opposite.
    bar.isHidden = failed
    bar.isIndeterminate = state.indeterminate
    if state.indeterminate {
      bar.startAnimation(nil)
    } else {
      bar.stopAnimation(nil)
      bar.doubleValue = Double(state.percent)
    }

    status.stringValue = state.sentence()
    status.textColor = failed ? .systemRed : .secondaryLabelColor
  }

  /// The platform's own sentence, appended under ours on a failure.
  ///
  /// Our wording says what the user can DO; `URLError`'s names the address and
  /// the system error, which is the detail that makes a wrong port diagnosable.
  public func setDetail(_ text: String) {
    guard !isHidden else { return }
    status.stringValue = "\(status.stringValue)\n\(text)"
  }

  /// The window owns the reload; a closure keeps this view free of it.
  @objc private func retryTapped() {
    render(.connecting)
    onRetry?()
  }
}

/**
 Install a splash over `container`, sized to it.

 **The size comes from the container, and that is why this is a function rather
 than one line at the call site.** AppKit resizes a view's subviews when its own
 frame changes, so only the subviews that exist at that moment are carried along.
 The window's frame is restored by `setFrameAutosaveName` while `buildWindow`
 runs, so the container was already 2560x1335 by the time it became the content
 view — which is what carried the web view (added before it) to the full size —
 and the splash, added AFTER that assignment, kept the hard-coded 1280x860 rect
 it was built with. Measured on a bare window: a subview added before
 `contentView =` follows the container to 2200x1200, the identical subview added
 after it stays 1280x860.

 The result was a small box in the BOTTOM-LEFT corner of the window, and full
 screen did not change it: nothing resizes the parent again, so
 `autoresizingMask` never fires. Measured through the running app (lldb;
 `NSWindow` frame autosaved at 2560x1335): `container` and the web view were both
 2560x1335 while `SplashView` reported `{{0, 0}, {1280, 859}}`.
 */
@discardableResult
public func installSplash(
  in container: NSView,
  state: SplashState,
  onRetry: (() -> Void)? = nil
) -> SplashView {
  let splash = SplashView(frame: container.bounds)
  splash.onRetry = onRetry
  splash.render(state)
  container.addSubview(splash)
  return splash
}

/// The wordmark as an `NSImage`, drawn from the artwork's own geometry.
///
/// Public so `TestsWindow` can assert the splash actually paints the mark: a
/// splash that rendered only its sentence would pass every state-machine case.
///
/// There is no SVG renderer in AppKit, so the mark is rasterized once from
/// `Wordmark` (which holds the SVG's path data) through `WordmarkRenderer`, at the
/// screen's own scale. A bitmap copied out of a design tool would be the third
/// copy of one drawing; this is the second, and `SplashTests` pins it against the
/// SVG.
public enum WordmarkImage {

  /// The mark at `height` points, in the screen's own scale.
  public static func make(height: CGFloat, scale: CGFloat? = nil) -> NSImage? {
    let screenScale = scale ?? NSScreen.main?.backingScaleFactor ?? 2
    let ratio = Wordmark.size.height / Wordmark.size.width
    let width = height / ratio
    let pixelScale = screenScale * (height / Wordmark.size.height)

    guard let cgImage = try? WordmarkRenderer.image(scale: pixelScale) else { return nil }
    let size = NSSize(width: width, height: height)
    return NSImage(cgImage: cgImage, size: size)
  }
}
