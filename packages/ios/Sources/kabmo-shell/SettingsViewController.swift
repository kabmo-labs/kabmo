#if canImport(UIKit)
import UIKit
import WebKit
import KabmoShell

/// The native server-settings screen.
///
/// Built from UIKit directly rather than SwiftUI or a form framework: the whole app
/// is one web view plus this screen, and a declarative layer for two fields and
/// three buttons would dwarf the shell it is drawing.
///
/// The screen exists because the web view fills the display — Kabmo's own Settings
/// modal is reachable, but only after the server is reachable, which is exactly the
/// case a wrong address breaks. This screen is the way back, from the Home Screen
/// quick action.
final class SettingsViewController: UIViewController {

  private let settings: ShellSettings
  private let urlField = UITextField()
  private let statusLabel = UILabel()
  private let testButton = UIButton(type: .system)
  private let connectButton = UIButton(type: .system)
  private let zoomSlider = UISlider()
  private let zoomValue = UILabel()

  private var zoomPercent: Int
  private var busy = false {
    didSet { updateBusy() }
  }

  /// Called after a successful save, so the shell can re-read the address.
  var onSaved: (() -> Void)?

  init(settings: ShellSettings) {
    self.settings = settings
    // BEFORE the view tree: `zoomSection()` builds its slider from this field, and
    // reading it after the call leaves the thumb on the default while the saved
    // value is already 170.
    self.zoomPercent = settings.zoom
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("SettingsViewController is created in code")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Palette.paper
    title = "Server settings"

    navigationItem.rightBarButtonItem = UIBarButtonItem(
      systemItem: .done,
      primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
    )

    let scroll = UIScrollView()
    scroll.alwaysBounceVertical = true
    scroll.keyboardDismissMode = .interactive
    let column = UIStackView()
    column.axis = .vertical
    column.alignment = .fill
    column.spacing = 8

    for view in [scroll] { view.translatesAutoresizingMaskIntoConstraints = false }
    column.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scroll)
    scroll.addSubview(column)

    NSLayoutConstraint.activate([
      scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      column.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
      column.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -32),
      column.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 20),
      column.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -20),
    ])

    column.addArrangedSubview(SettingsControls.label("Server URL"))
    column.addArrangedSubview(urlInput())
    column.addArrangedSubview(SettingsControls.hint("Scheme, host and port only — a path is not supported."))

    statusLabel.font = .systemFont(ofSize: 12)
    statusLabel.textColor = Palette.inkMuted
    statusLabel.numberOfLines = 0
    column.addArrangedSubview(SettingsControls.spacer(12))
    column.addArrangedSubview(statusLabel)

    column.addArrangedSubview(SettingsControls.spacer(12))
    column.addArrangedSubview(SettingsControls.cleartextNotice())

    // Zoom sits ABOVE the actions: it applies on the spot (no health check, no
    // reload), so it is not part of "connect to a server" and must not read as a
    // field the Connect button submits.
    column.addArrangedSubview(SettingsControls.spacer(20))
    column.addArrangedSubview(zoomSection())

    column.addArrangedSubview(SettingsControls.spacer(20))
    column.addArrangedSubview(actions())

    column.addArrangedSubview(SettingsControls.spacer(20))
    column.addArrangedSubview(
      SettingsControls.hint("Long-press the Kabmo icon on the Home Screen → Server settings to come back here.")
    )

    urlField.text = settings.url
    updateBusy()
  }

  // MARK: - Fields

  private func urlInput() -> UIView {
    urlField.placeholder = "http://192.168.1.20:3000"
    urlField.font = .systemFont(ofSize: 15)
    urlField.textColor = Palette.ink
    urlField.keyboardType = .URL
    urlField.autocapitalizationType = .none
    urlField.autocorrectionType = .no
    urlField.returnKeyType = .done
    urlField.delegate = self
    return SettingsControls.fieldBox(urlField)
  }

  /// Page zoom: a slider with a live percentage and a reset.
  ///
  /// A slider rather than a text field because the value is a size the user is
  /// judging by eye, not a number they know: the range from 50% to 200% can be
  /// explored in one drag, and the percent is printed as the thumb moves so the
  /// exact value is readable rather than guessed. It saves on EVERY change — no
  /// Apply button — since the effect is visible in the console behind this screen,
  /// and a value that needed confirming could not be previewed.
  private func zoomSection() -> UIView {
    let section = UIStackView()
    section.axis = .vertical
    section.spacing = 6

    let header = UIStackView()
    header.axis = .horizontal
    header.addArrangedSubview(SettingsControls.label("Page zoom"))
    zoomValue.text = "\(zoomPercent)%"
    zoomValue.font = .systemFont(ofSize: 12)
    zoomValue.textColor = Palette.ink
    zoomValue.textAlignment = .right
    header.addArrangedSubview(zoomValue)

    zoomSlider.minimumValue = Float(ShellSettings.zoomMin)
    zoomSlider.maximumValue = Float(ShellSettings.zoomMax)
    zoomSlider.value = Float(zoomPercent)
    zoomSlider.isContinuous = true
    // Every whole percent is a position, so the slider's own step is 1 — the
    // platform's default is continuous, which is the same thing at this range.
    zoomSlider.addAction(
      UIAction { [weak self] _ in self?.zoomChanged() },
      for: .valueChanged
    )

    let reset = ShellButton.make(
      title: "Reset to 100%",
      filled: false,
      action: UIAction { [weak self] _ in self?.resetZoom() }
    )
    let resetRow = UIStackView(arrangedSubviews: [reset, UIView()])
    resetRow.axis = .horizontal

    section.addArrangedSubview(header)
    section.addArrangedSubview(zoomSlider)
    section.addArrangedSubview(
      SettingsControls.hint(
        "Scales the whole console. 100% is the page's own size; this applies immediately, with no reload."
      )
    )
    section.addArrangedSubview(resetRow)
    return section
  }

  private func actions() -> UIView {
    testButton.setTitle("Test connection", for: .normal)
    testButton.addAction(UIAction { [weak self] _ in self?.runHealthCheck() }, for: .touchUpInside)
    connectButton.setTitle("Connect", for: .normal)
    connectButton.addAction(UIAction { [weak self] _ in self?.save() }, for: .touchUpInside)

    let clear = UIButton(type: .system)
    clear.setTitle("Clear cookies", for: .normal)
    clear.addAction(UIAction { [weak self] _ in self?.confirmClearCookies() }, for: .touchUpInside)

    let row = UIStackView(arrangedSubviews: [
      SettingsControls.style(testButton, filled: false),
      SettingsControls.style(connectButton, filled: true),
      SettingsControls.style(clear, filled: false),
      UIView(),
    ])
    row.axis = .horizontal
    row.spacing = 8
    return row
  }

  // MARK: - Actions

  private func zoomChanged() {
    let percent = ShellSettings.clampZoom(Int(zoomSlider.value.rounded()))
    zoomPercent = percent
    zoomValue.text = "\(percent)%"
    settings.write(zoom: percent)
  }

  private func resetZoom() {
    zoomPercent = ShellSettings.zoomDefault
    zoomSlider.value = Float(ShellSettings.zoomDefault)
    zoomValue.text = "\(ShellSettings.zoomDefault)%"
    settings.write(zoom: ShellSettings.zoomDefault)
  }

  private func runHealthCheck() {
    guard let base = normalizedURL() else { return }
    setBusy(true)
    status("Checking…", tone: .neutral)

    Task { @MainActor in
      let result = await HealthProbe.check(baseURL: base)
      self.setBusy(false)
      if result.ok {
        self.status(SettingsCopy.connected(result), tone: .success)
      } else {
        self.status(SettingsCopy.message(for: result.problem ?? .unreachable), tone: .failure)
      }
    }
  }

  /// Save is gated on a passing health check.
  ///
  /// Saving an unreachable address leaves the user staring at a blank shell with no
  /// explanation, and the next launch has no way to tell a wrong address from a
  /// stopped server. The check is cheap (one dependency-free route) and the screen
  /// already has to run it to show a version.
  ///
  /// **The cookies are cleared only when the ORIGIN changes.** A cookie is scoped to
  /// a host and port, so the same address keeps its session — and this screen is also
  /// where the zoom slider lives, so pressing Connect after adjusting the zoom used
  /// to sign the user out of the server they were already on.
  private func save() {
    guard let base = normalizedURL() else { return }
    let previous = settings.url

    setBusy(true)
    status("Checking…", tone: .neutral)

    Task { @MainActor in
      let result = await HealthProbe.check(baseURL: base)
      self.setBusy(false)
      guard result.ok else {
        self.status(SettingsCopy.message(for: result.problem ?? .unreachable), tone: .failure)
        return
      }

      self.settings.write(url: base)
      if !URLNormalizer.sameOrigin(previous, base) {
        await self.clearCookies()
      }
      self.onSaved?()
      self.dismiss(animated: true)
    }
  }

  private func confirmClearCookies() {
    let alert = UIAlertController(
      title: "Clear cookies",
      message: "Sign out of this server on this device?",
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "Clear", style: .destructive) { [weak self] _ in
      Task { @MainActor in
        await self?.clearCookies()
        self?.status("Cookies cleared.", tone: .neutral)
      }
    })
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    present(alert, animated: true)
  }

  private func clearCookies() async {
    let store = WKWebsiteDataStore.default().httpCookieStore
    let cookies = await store.allCookies()
    for cookie in cookies {
      await store.deleteCookie(cookie)
    }
  }

  // MARK: - Helpers

  /// The typed address, normalized — or nil after showing the refusal.
  private func normalizedURL() -> String? {
    switch URLNormalizer.normalize(urlField.text ?? "") {
    case let .ok(url):
      return url
    case let .error(problem):
      status(SettingsCopy.message(for: problem), tone: .failure)
      return nil
    }
  }

  private func setBusy(_ value: Bool) {
    busy = value
  }

  private func updateBusy() {
    testButton.isEnabled = !busy
    connectButton.isEnabled = !busy
  }

  private enum Tone { case neutral, success, failure }

  private func status(_ text: String, tone: Tone) {
    statusLabel.text = text
    switch tone {
    case .neutral: statusLabel.textColor = Palette.inkMuted
    case .success: statusLabel.textColor = Palette.success
    case .failure: statusLabel.textColor = Palette.error
    }
  }
}

extension SettingsViewController: UITextFieldDelegate {
  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    textField.resignFirstResponder()
    return true
  }
}
#endif
