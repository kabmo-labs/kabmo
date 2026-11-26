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

  /// The single address a build older than the server list stored. Read ONCE, to
  /// seed the list (`servers`), and then removed — a second migration would
  /// resurrect an address the user removed from the list.
  private static let urlKey = "server_url"
  private static let serversKey = "server_list"
  private static let zoomKey = "zoom_percent"
  private static let paletteKey = "shell_palette"

  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  /// The server this shell is on, or nil on a first run.
  public var url: String? {
    servers.activeURL
  }

  /// Every server this shell knows, plus which one it is on.
  ///
  /// The list is the source of truth; `url` above is the one-address view of it,
  /// kept because the load path, the navigation policy and the settings screen
  /// all ask that question and none of them should know about a list. A pre-list
  /// build's single address is migrated on first read.
  public var servers: ServerList {
    if let wire = defaults.string(forKey: Self.serversKey) {
      return ServerList.parse(wire)
    }
    let legacy = defaults.string(forKey: Self.urlKey)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let migrated = ServerList.migrated(legacyURL: legacy)
    if let legacy, !legacy.isEmpty {
      defaults.set(migrated.wire, forKey: Self.serversKey)
      defaults.removeObject(forKey: Self.urlKey)
    }
    return migrated
  }

  public func write(servers list: ServerList) {
    defaults.set(list.wire, forKey: Self.serversKey)
  }

  /// Remember `value` and make it the active server.
  ///
  /// The settings screen's Connect calls this, so typing the address of a server
  /// that is already known must not add a second row for the same origin —
  /// `ServerList.withRemembered` owns that rule.
  public func write(url value: String) {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      // A blank write means "no address", which is what the settings screen's own
      // field asks when it is cleared — it must not add a row for an empty URL.
      write(servers: ServerList(entries: servers.entries, activeURL: nil))
      return
    }
    write(servers: servers.withRemembered(url: trimmed))
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
  /// Forget everything EXCEPT the server list.
  ///
  /// The list is an address book, not a session: signing out of one server must
  /// not make the user retype the address of the other one they added. The zoom
  /// and the palette go, because both describe the console just signed out of.
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
