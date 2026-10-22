#if canImport(UIKit)
import UIKit
import KabmoShell

/// The launch overlay: what the shell draws from the tap until the console paints.
///
/// Without it the app shows a flat paper rectangle for the whole cold start — the
/// web view's background colour, with nothing to say whether it is loading, waiting
/// on a server that is down, or already dead. On a slow LAN or a cold server that
/// is several seconds of it.
///
/// A SIBLING of the web view, never a view inside the page: the page cannot report
/// its own readiness (its own bundle is what renders the app), and a page-drawn
/// overlay would vanish exactly when the page fails to load.
///
/// Every state decision is `LoadingState`'s, and this class only draws it — the
/// same split `packages/android` makes, for the same reason: the orderings that
/// fail (a late progress estimate, an error page's own `didFinish`) are not
/// visible in a view.
final class LoadingOverlay: UIView {

  /// Called when the user asks to try the address again.
  var onRetry: (() -> Void)?

  /// Called when the user gives up and wants the server settings screen.
  var onOpenSettings: (() -> Void)?

  private let wordmark = UIImageView()
  private let bar = UIProgressView(progressViewStyle: .bar)
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let status = UILabel()
  private let actions = UIStackView()
  private let retryButton = UIButton(type: .system)
  private let settingsButton = UIButton(type: .system)

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = Palette.paper
    // Swallows taps meant for the half-painted page.
    isUserInteractionEnabled = true

    wordmark.contentMode = .scaleAspectFit
    wordmark.image = WordmarkImage.make(height: 58)
    wordmark.accessibilityLabel = "Kabmo"
    wordmark.translatesAutoresizingMaskIntoConstraints = false

    bar.progressTintColor = Palette.ink
    bar.trackTintColor = Palette.hairline
    bar.translatesAutoresizingMaskIntoConstraints = false
    // Indeterminate is not a thing `UIProgressView` does; the connecting state
    // draws an empty bar and a spinner instead, which is the same promise: "no
    // number yet" rather than a bar stuck at zero.
    bar.progress = 0

    status.font = .systemFont(ofSize: 12)
    status.textColor = Palette.inkMuted
    status.textAlignment = .center
    status.numberOfLines = 0
    status.translatesAutoresizingMaskIntoConstraints = false

    retryButton.addAction(UIAction { [weak self] _ in self?.onRetry?() }, for: .touchUpInside)
    settingsButton.addAction(UIAction { [weak self] _ in self?.onOpenSettings?() }, for: .touchUpInside)
    configure(retryButton, title: "Retry", filled: true)
    configure(settingsButton, title: "Server settings", filled: false)

    actions.axis = .horizontal
    actions.spacing = 8
    actions.addArrangedSubview(retryButton)
    actions.addArrangedSubview(settingsButton)
    actions.isHidden = true
    actions.translatesAutoresizingMaskIntoConstraints = false

    let column = UIStackView(arrangedSubviews: [wordmark, bar, spinner, status, actions])
    column.axis = .vertical
    column.alignment = .center
    column.spacing = 16
    column.setCustomSpacing(8, after: bar)
    column.setCustomSpacing(18, after: status)
    column.translatesAutoresizingMaskIntoConstraints = false
    addSubview(column)

    NSLayoutConstraint.activate([
      column.centerXAnchor.constraint(equalTo: centerXAnchor),
      column.centerYAnchor.constraint(equalTo: centerYAnchor),
      column.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 32),
      column.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -32),
      // 180 points wide is the artwork's own intrinsic width at the height above,
      // fixed rather than intrinsic so the column's height does not depend on how
      // a given scale measures the bitmap.
      wordmark.widthAnchor.constraint(equalToConstant: 180),
      wordmark.heightAnchor.constraint(equalToConstant: 58),
      bar.widthAnchor.constraint(equalToConstant: 180),
    ])

    render(.done)
  }

  required init?(coder: NSCoder) {
    fatalError("LoadingOverlay is created in code")
  }

  /// Draw a state. The single entry point, so no caller can leave the overlay
  /// half-updated — the bar, the sentence and the actions always describe one
  /// `LoadingState`.
  func render(_ state: LoadingState) {
    isHidden = !state.visible
    guard state.visible else { return }

    let failed = state.phase == .failed
    actions.isHidden = !failed

    // A determinate bar at 0 is the "stuck" look this overlay exists to remove, so
    // the connecting phase shows the spinner instead — and a FAILED load hides both,
    // because a frozen partial bar says "still working" over a message that says the
    // opposite.
    let waiting = state.phase == .connecting
    bar.isHidden = failed || waiting
    bar.setProgress(Float(state.percent) / 100, animated: false)
    if waiting && !failed {
      spinner.startAnimating()
    } else {
      spinner.stopAnimating()
    }

    status.textColor = failed ? Palette.error : Palette.inkMuted
    status.text = sentence(for: state)
  }

  private func sentence(for state: LoadingState) -> String {
    switch state.phase {
    case .connecting:
      return "Connecting to the server…"
    case .loading:
      return "Loading the console… \(state.percent)%"
    case .failed:
      return Self.failureSentence(state.failure ?? .other)
    case .done:
      return ""
    }
  }

  /// One sentence per reason. The failure cases are what the user needs to tell
  /// apart — a server that is off, a wrong address and an untrusted certificate
  /// all look identical behind a blank screen.
  static func failureSentence(_ failure: LoadingState.Failure) -> String {
    switch failure {
    case .hostLookup:
      return "The server address could not be found. Check the host and that this device is on the same network."
    case .connect:
      return "Could not connect. Check that Kabmo is running and the port is right."
    case .timeout:
      return "The server did not answer in time. It may still be starting."
    case .ssl:
      return "The certificate is not trusted. See Server settings for the certificate details."
    case .other:
      return "The console could not be loaded. Retry, or check the server address."
    }
  }

  private func configure(_ button: UIButton, title: String, filled: Bool) {
    var configuration = UIButton.Configuration.plain()
    configuration.title = title
    configuration.baseForegroundColor = filled ? Palette.paper : Palette.ink
    configuration.background.backgroundColor = filled ? Palette.ink : Palette.field
    configuration.background.strokeColor = filled ? Palette.ink : Palette.hairline
    configuration.background.strokeWidth = 1
    configuration.background.cornerRadius = 8
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 14, bottom: 8, trailing: 14)
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
      var outgoing = incoming
      outgoing.font = .systemFont(ofSize: 13, weight: .medium)
      return outgoing
    }
    button.configuration = configuration
  }
}
#endif
