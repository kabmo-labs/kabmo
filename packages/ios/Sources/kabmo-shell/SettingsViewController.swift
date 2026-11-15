#if canImport(UIKit)
import PhotosUI
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
  private let pairField = UITextField()
  private let statusLabel = UILabel()
  private let testButton = UIButton(type: .system)
  private let connectButton = UIButton(type: .system)
  private let zoomSlider = UISlider()
  private let zoomValue = UILabel()
  private let updateButton = UIButton(type: .system)
  private let updateStatus = UILabel()

  /**
   * The build the last check offered, if any.

   * ONE action handler serves the button (`updateButtonTapped`), which either
   * checks or opens what the check found. Adding a second handler per result —
   * `removeTarget(nil, …)` and a fresh `UIAction` — is how one tap ends up
   * running two actions, because `UIAction` registrations are additive.
   */
  private var pendingUpdate: AppRelease.Release?

  /// This build's version, read from the bundle.
  ///
  /// The ONE source is `Info.plist`, which `scripts/build-ipa.sh` fills from
  /// `packages/ios/version.properties` — never a literal here, because two
  /// numbers for one build is the drift the properties file exists to prevent.
  /// It is what the update check compares against, and what the console reads
  /// off `KabmoIOS/<version>`.
  private var installedVersion: String {
    (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
  }

  private var zoomPercent: Int
  private var busy = false {
    didSet { updateBusy() }
  }

  /// Called after a successful save, so the shell can re-read the address.
  var onSaved: (() -> Void)?

  /// A pairing link the user pasted, handed to the shell to load.
  ///
  /// The link is loaded in THIS app's web view, not in Safari: the cookie the
  /// server's `/pair` page receives lands in this app's cookie store, and Safari's
  /// is a different one — pairing there would leave the shell still asking for a
  /// password.
  var onPair: ((String) -> Void)?

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

    column.addArrangedSubview(SettingsControls.label("Pairing link"))
    column.addArrangedSubview(pairInput())
    column.addArrangedSubview(
      SettingsControls.hint("Copy it from Settings → Connect on the server. Pairing signs this device in without a password, and the link works once.")
    )
    column.addArrangedSubview(SettingsControls.spacer(20))

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

    // The APP's own update, above the actions: it is not part of "connect to a
    // server", and it is the one answer this screen can give that the console
    // behind it cannot.
    column.addArrangedSubview(SettingsControls.spacer(24))
    column.addArrangedSubview(updateSection())

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

  private func pairInput() -> UIView {
    pairField.placeholder = "https://…/pair#…"
    pairField.font = .systemFont(ofSize: 15)
    pairField.textColor = Palette.ink
    pairField.backgroundColor = Palette.field
    pairField.layer.cornerRadius = 8
    pairField.layer.borderWidth = 1
    pairField.layer.borderColor = Palette.hairline.cgColor
    pairField.autocapitalizationType = .none
    pairField.autocorrectionType = .no
    pairField.keyboardType = .URL
    pairField.returnKeyType = .go
    pairField.delegate = self
    pairField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
    pairField.leftViewMode = .always
    pairField.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
    pairField.rightViewMode = .always
    pairField.heightAnchor.constraint(equalToConstant: 44).isActive = true

    let scan = UIButton(type: .system)
    scan.setTitle("Scan", for: .normal)
    scan.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
    scan.addAction(UIAction { [weak self] _ in self?.scan() }, for: .touchUpInside)

    // For a device with no camera: the code arrived as a screenshot and there is
    // nothing to point at. `PHPickerViewController` needs no photo-library
    // permission, which is why it is used rather than `UIImagePickerController`.
    let image = UIButton(type: .system)
    image.setTitle("Image", for: .normal)
    image.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
    image.addAction(UIAction { [weak self] _ in self?.pickImage() }, for: .touchUpInside)

    let pair = UIButton(type: .system)
    pair.setTitle("Pair", for: .normal)
    pair.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
    pair.addAction(UIAction { [weak self] _ in self?.pair() }, for: .touchUpInside)

    let actions = UIStackView(arrangedSubviews: [scan, image, pair])
    actions.axis = .horizontal
    actions.spacing = 8
    actions.distribution = .fillEqually

    let column = UIStackView(arrangedSubviews: [pairField, actions])
    column.axis = .vertical
    column.spacing = 8
    return column
  }

  /// Pick an image of a code and read it with the platform's detector.
  private func pickImage() {
    var configuration = PHPickerConfiguration()
    configuration.filter = .images
    configuration.selectionLimit = 1
    let picker = PHPickerViewController(configuration: configuration)
    picker.delegate = self
    present(picker, animated: true)
  }

  /// Open the shell's own scanner; the code it reads lands in the field, so there
  /// is ONE submit path — the same `pair()` the paste uses.
  private func scan() {
    let scanner = QrScannerViewController()
    scanner.onCode = { [weak self] code in
      guard let self else { return }
      self.pairField.text = code
      self.pair()
    }
    let nav = UINavigationController(rootViewController: scanner)
    nav.modalPresentationStyle = .fullScreen
    present(nav, animated: true)
  }

  /// Hand the pasted link to the shell, which loads it in its own web view.
  ///
  /// The origin is stored here so the shell has an address even if the page never
  /// finishes; the link itself is what the shell loads, because only the page can
  /// redeem the code and set the cookie.
  private func pair() {
    let raw = (pairField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard let origin = PairingLink.origin(of: raw) else {
      status("That is not a pairing link. Copy the https link from Settings → Connect on the server.", tone: .failure)
      return
    }
    settings.write(url: origin)
    onPair?(raw)
    dismiss(animated: true)
  }

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

  /// "Check for update" — the app's OWN version, not the server's.
  ///
  /// Two versions are on this screen and they are different products: the console
  /// behind the web view, and this app. The health check above answers for the
  /// server; this answers for the app, which is the one thing a user cannot
  /// otherwise discover — the sidebar's offer only appears once the console has
  /// loaded, which is exactly what a stale shell may fail to do.
  ///
  /// The check reads the CONSOLE's route rather than GitHub (see `AppRelease`):
  /// the console already falls back to the public release pages when GitHub's
  /// per-IP API quota is spent, which on mobile data it routinely is.
  ///
  /// It uses the address SAVED, falling back to the one typed in the field, so a
  /// first-run user who has not connected yet can still ask.
  private func updateSection() -> UIView {
    let section = UIStackView()
    section.axis = .vertical
    section.spacing = 6

    section.addArrangedSubview(SettingsControls.label("Kabmo app"))
    section.addArrangedSubview(
      SettingsControls.hint("Installed: \(installedVersion)")
    )

    updateStatus.font = .systemFont(ofSize: 12)
    updateStatus.textColor = Palette.inkMuted
    updateStatus.numberOfLines = 0
    section.addArrangedSubview(updateStatus)

    updateButton.setTitle("Check for update", for: .normal)
    updateButton.addAction(UIAction { [weak self] _ in self?.updateButtonTapped() }, for: .touchUpInside)

    let row = UIStackView(arrangedSubviews: [SettingsControls.style(updateButton, filled: false), UIView()])
    row.axis = .horizontal
    section.addArrangedSubview(row)
    return section
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
  /// **No cookies are touched.** A cookie is scoped to its host and the session
  /// cookie is named per port (`omp_session_<port>`), so an address that changed
  /// cannot receive the previous server's session, and the previous server keeps
  /// the login that going back should restore. Clearing the store here signed the
  /// user out of EVERY server in the list — the reported "the login is gone after
  /// switching" — and this screen is also where the zoom slider lives. The
  /// explicit "Clear cookies" button is the one gesture that ends a session.
  private func save() {
    guard let base = normalizedURL() else { return }

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
      self.onSaved?()
      self.dismiss(animated: true)
    }
  }

  /// Ask the console, and either report the answer or offer the download.
  ///
  /// A newer build is not installed from here: iOS cannot install an app from a
  /// file at all, so the offer is the RELEASE PAGE (which is also what
  /// `ShellUpdate` decides for an IPA download). What this adds over the console's
  /// own sidebar button is that it works BEFORE the console has loaded — the case
  /// a stale shell is most likely to be in.
  private func checkForUpdate() {
    let typed = URLNormalizer.normalize(urlField.text ?? "")
    let base = settings.url ?? typed.url
    guard let base else {
      reportUpdate("Connect to a server first, so the app can ask what is published.", failure: true)
      return
    }

    updateButton.isEnabled = false
    // A new question supersedes the last answer: leaving the previous offer
    // armed would let a tap open a release the check just said is current.
    pendingUpdate = nil
    updateButton.setTitle("Check for update", for: .normal)
    reportUpdate("Checking for a newer app…")

    Task { @MainActor in
      let release = await Self.fetchRelease(baseURL: base)
      self.updateButton.isEnabled = true

      switch AppRelease.decide(release, installed: self.installedVersion) {
      case let .available(published, installed):
        self.reportUpdate("Kabmo \(published.latest) is published — this build is \(installed).")
        self.offerUpdate(published)
      case let .current(latest, installed):
        self.reportUpdate("Kabmo \(installed) is the newest published build (\(latest)).")
      case .failed:
        self.reportUpdate("Could not ask the server. The check needs a reachable console.", failure: true)
      }
    }
  }

  /// The console's answer, or nil when it could not be read.
  ///
  /// A failure is nil and not an empty release, so `AppRelease.decide` can keep
  /// "the read failed" and "you are up to date" apart — the distinction that made
  /// the reported stale APK invisible.
  private static func fetchRelease(baseURL: String) async -> AppRelease.Release? {
    guard let url = URL(string: AppRelease.url(for: baseURL)) else { return nil }
    var request = URLRequest(url: url)
    request.timeoutInterval = 8
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    guard
      let (data, response) = try? await URLSession.shared.data(for: request),
      let http = response as? HTTPURLResponse,
      (200..<300).contains(http.statusCode)
    else { return nil }

    return AppRelease.parse(data)
  }

  /// One action for the button: open what the check found, or ask again.
  private func updateButtonTapped() {
    guard let release = pendingUpdate else {
      checkForUpdate()
      return
    }
    guard let url = URL(string: release.releaseUrl ?? release.url) else { return }
    UIApplication.shared.open(url)
  }

  private func offerUpdate(_ release: AppRelease.Release) {
    pendingUpdate = release
    updateButton.setTitle("Open release \(release.latest)", for: .normal)
  }

  private func reportUpdate(_ text: String, failure: Bool = false) {
    updateStatus.text = text
    updateStatus.textColor = failure ? Palette.error : Palette.inkMuted
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
  // MARK: - Image picking

  /// Read the chosen image and hand the code to the same `pair()` the paste uses.
  ///
  /// Every failure here says so. Each of these guards used to `return` silently:
  /// a pick whose provider could not produce a `UIImage`, an image whose
  /// `cgImage` was nil (a `CIImage`-backed `UIImage`, which is what some HEIC and
  /// animated providers hand back), and a load the system reports as failed all
  /// looked identical to the user — nothing happened at all.
  fileprivate func handlePicked(_ result: PHPickerResult) {
    let provider = result.itemProvider
    guard provider.canLoadObject(ofClass: UIImage.self) else {
      status(
        "That file is not an image. Choose a screenshot of the pairing code.",
        tone: .failure
      )
      return
    }
    provider.loadObject(ofClass: UIImage.self) { [weak self] object, error in
      guard let self else { return }
      guard let image = object as? UIImage else {
        let reason = error?.localizedDescription
          ?? "That image could not be read. Choose a screenshot of the pairing code."
        DispatchQueue.main.async { self.status(reason, tone: .failure) }
        return
      }
      // `cgImage` is nil for some formats; `CIImage(image:)` covers those, and a
      // decode that never runs is the one outcome worse than "no code found".
      guard let bitmap = image.cgImage.map({ CIImage(cgImage: $0) }) ?? CIImage(image: image) else {
        DispatchQueue.main.async {
          self.status(
            "That image could not be read. Choose a screenshot of the pairing code.",
            tone: .failure
          )
        }
        return
      }
      let code = QrImageDecoder.decode(bitmap)
      DispatchQueue.main.async {
        guard let code else {
          self.status(
            "No QR code was found in that image. Try a sharper screenshot, or paste the link instead.",
            tone: .failure
          )
          return
        }
        self.pairField.text = code
        self.pair()
      }
    }
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    textField.resignFirstResponder()
    return true
  }
}

extension SettingsViewController: PHPickerViewControllerDelegate {
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let result = results.first else { return }
    handlePicked(result)
  }
}
#endif
