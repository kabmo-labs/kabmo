import Foundation

/// The saved server address and page zoom, and the only place they are stored.
///
/// `UserDefaults` rather than a file of our own: it is two small values, it must
/// survive process death, and the platform already gives atomic writes. The
/// bundle's `Info.plist` sets `NSPrivacyAccessedAPICategoryUserDefaults` — not
/// because this reads anything sensitive, but because the platform requires the
/// declaration for the API at all.
///
/// The store is INJECTABLE (`defaults`), which is what lets the logic suite drive
/// every rule without touching the developer's real preferences.
public struct ShellSettings {
  /// Page zoom bounds, in percent.
  ///
  /// 100 is the page's own size. Below 50 the phone layout's tap targets stop
  /// being tappable; above 200 a two-column phone view becomes a single word per
  /// line.
  ///
  /// The step is 1, so every whole percent in the range is a position the slider
  /// can land on (151 of them). A 10% grid was the first shape in the Android
  /// shell and it was too coarse to aim: the size a reader wants is usually one
  /// notch from where the grid happens to sit.
  ///
  /// These are percentages of the PAGE. `pageZoom(for:)` is what turns one into
  /// the number `WKWebView.pageZoom` wants — and unlike Android's
  /// `setInitialScale`, that one is already page-relative, so no density factor
  /// belongs here.
  public static let zoomMin = 50
  public static let zoomMax = 200
  public static let zoomStep = 1
  public static let zoomDefault = 100

  private static let urlKey = "server_url"
  private static let zoomKey = "zoom_percent"
  private static let paletteKey = "shell_palette"

  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  /// The saved origin, or nil on a first run.
  public var url: String? {
    guard let value = defaults.string(forKey: Self.urlKey) else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  public func write(url value: String) {
    defaults.set(value, forKey: Self.urlKey)
  }

  /// The saved page zoom, clamped and snapped onto the slider's grid.
  ///
  /// Snapping on READ as well as on write is what keeps a value written by an
  /// older build (or by hand, through a defaults dump) inside the range the UI can
  /// represent — a percent the slider cannot express would render as a thumb at
  /// one end while the page scaled by something else.
  public var zoom: Int {
    clampZoom(defaults.object(forKey: Self.zoomKey) as? Int ?? Self.zoomDefault)
  }

  public func write(zoom percent: Int) {
    defaults.set(clampZoom(percent), forKey: Self.zoomKey)
  }

  /// Remove everything this shell stores. Used by "Clear cookies" only when the
  /// caller also drops the web store; see `SettingsScreen`.
  public func clear() {
    defaults.removeObject(forKey: Self.urlKey)
    defaults.removeObject(forKey: Self.zoomKey)
    defaults.removeObject(forKey: Self.paletteKey)
  }

  /// The palette the console last reported, or the shipped one.
  ///
  /// Stored rather than derived: the launch overlay is drawn BEFORE any page
  /// exists, so this is the only colour the shell has on a cold start. Written
  /// on every finished load, which is what makes a theme picked in Settings the
  /// palette the NEXT launch paints.
  public var palette: ShellPalette {
    ShellPalette.parse(defaults.string(forKey: Self.paletteKey)) ?? .shipped
  }

  /// Remember the console's palette. An unreadable wire is not written: keeping
  /// the previous palette is the only answer that cannot repaint the shell with
  /// a colour no theme chose.
  public func write(palette: ShellPalette) {
    defaults.set(palette.wire, forKey: Self.paletteKey)
  }

  /// Snap a percent onto the slider's grid, inside the allowed range.
  public static func clampZoom(_ percent: Int) -> Int {
    let bounded = min(max(percent, zoomMin), zoomMax)
    let snapped = zoomMin + ((bounded - zoomMin) / zoomStep) * zoomStep
    return min(max(snapped, zoomMin), zoomMax)
  }

  public func clampZoom(_ percent: Int) -> Int {
    Self.clampZoom(percent)
  }

  /// The `WKWebView.pageZoom` value for a saved percent.
  ///
  /// A plain ratio, and that is the whole point: `pageZoom` is relative to the
  /// PAGE's own default scale, so 150% is `1.5`. Android's `setInitialScale`
  /// counts percent of the DEVICE's default scale instead, which is why its twin
  /// multiplies by the display density — copying that here would render a 100%
  /// setting at 2.6× on a 3× phone.
  public static func pageZoom(for percent: Int) -> Double {
    Double(clampZoom(percent)) / 100.0
  }
}
