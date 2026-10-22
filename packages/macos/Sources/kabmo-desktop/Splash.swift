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
 * A failed load keeps the splash with the reason and a Retry, instead of leaving
 * a blank paper window with nothing on screen to explain it.
 */

import AppKit

final class SplashView: NSView {
  private let wordmark = NSTextField(labelWithString: "Kabmo")
  private let status = NSTextField(labelWithString: "Starting…")
  private let retry = NSButton(title: "Retry", target: nil, action: nil)

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    autoresizingMask = [.width, .height]

    wordmark.font = .systemFont(ofSize: 26, weight: .semibold)
    wordmark.alignment = .center

    status.font = .systemFont(ofSize: 12)
    status.textColor = .secondaryLabelColor
    status.alignment = .center
    status.maximumNumberOfLines = 3
    status.lineBreakMode = .byWordWrapping
    status.preferredMaxLayoutWidth = 460

    retry.bezelStyle = .rounded
    retry.isHidden = true

    for view in [wordmark, status, retry] {
      view.translatesAutoresizingMaskIntoConstraints = false
      addSubview(view)
    }
    NSLayoutConstraint.activate([
      wordmark.centerXAnchor.constraint(equalTo: centerXAnchor),
      wordmark.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -20),
      status.centerXAnchor.constraint(equalTo: centerXAnchor),
      status.topAnchor.constraint(equalTo: wordmark.bottomAnchor, constant: 12),
      status.widthAnchor.constraint(lessThanOrEqualToConstant: 460),
      retry.centerXAnchor.constraint(equalTo: centerXAnchor),
      retry.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 16),
    ])
  }

  required init?(coder: NSCoder) { nil }

  /// Keep the splash up and say why the page did not arrive.
  func showFailure(_ reason: String) {
    alphaValue = 1
    wordmark.stringValue = "Kabmo"
    status.stringValue = "Could not load the console.\n\(reason)"
    status.textColor = .systemRed
    retry.isHidden = false
    retry.target = self
    retry.action = #selector(retryTapped)
  }

  /// The window owns the reload; a closure keeps this view free of it.
  var onRetry: (() -> Void)?

  @objc private func retryTapped() {
    status.stringValue = "Starting…"
    status.textColor = .secondaryLabelColor
    retry.isHidden = true
    onRetry?()
  }
}
