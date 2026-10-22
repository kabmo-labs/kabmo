import Foundation
import KabmoShell

/// The saved settings and the zoom mapping.
///
/// The zoom rule is the one that produced a visible bug in the Android shell, and
/// the reason it is asserted here in a different shape: `WKWebView.pageZoom` is
/// page-relative, so the twin's density multiply would render 100% at 2.6× on a 3×
/// phone. The numbers below are what the page actually scales by.
enum ShellSettingsTests {
  /// A throwaway defaults domain, so the suite never touches the developer's own.
  private static func freshDefaults(_ name: String) -> UserDefaults {
    let defaults = UserDefaults(suiteName: "dev.kabmo.shell.tests.\(name)") ?? .standard
    defaults.removePersistentDomain(forName: "dev.kabmo.shell.tests.\(name)")
    return defaults
  }

  static func run() {
    Harness.group("ShellSettings — storage")

    let defaults = freshDefaults("storage")
    let settings = ShellSettings(defaults: defaults)

    Harness.equal("a first run has no address", settings.url, nil)
    settings.write(url: "http://192.168.1.20:3000")
    Harness.equal("a written address reads back", settings.url, "http://192.168.1.20:3000")

    settings.write(url: "   ")
    Harness.equal("a blank address reads as none", settings.url, nil)

    settings.write(zoom: 170)
    Harness.equal("a written zoom reads back", settings.zoom, 170)

    Harness.group("ShellSettings — zoom clamping")

    // Every integer is snapped onto the grid, so a value written by hand (or by an
    // older build) cannot put the thumb at one end while the page scales by
    // something else.
    Harness.equal("below the floor", ShellSettings.clampZoom(10), ShellSettings.zoomMin)
    Harness.equal("above the ceiling", ShellSettings.clampZoom(400), ShellSettings.zoomMax)
    Harness.equal("inside the range", ShellSettings.clampZoom(137), 137)
    Harness.equal("the default is representable", ShellSettings.clampZoom(ShellSettings.zoomDefault), 100)
    Harness.equal("a negative value", ShellSettings.clampZoom(-5), ShellSettings.zoomMin)

    for percent in -100...400 {
      let clamped = ShellSettings.clampZoom(percent)
      Harness.check(
        "\(percent) clamps into range",
        clamped >= ShellSettings.zoomMin && clamped <= ShellSettings.zoomMax
      )
    }

    Harness.group("ShellSettings — page zoom")

    // `pageZoom` is relative to the PAGE's own default scale, so these are plain
    // ratios. The Android twin multiplies by the display density because its API
    // counts percent of the DEVICE's scale; doing that here is the bug this pins.
    Harness.close("50% is half scale", ShellSettings.pageZoom(for: 50), 0.5)
    Harness.close("100% is 1.0", ShellSettings.pageZoom(for: 100), 1.0)
    Harness.close("200% is double", ShellSettings.pageZoom(for: 200), 2.0)
    Harness.close("150% is 1.5", ShellSettings.pageZoom(for: 150), 1.5)
    Harness.close("a value outside the range is clamped, not scaled", ShellSettings.pageZoom(for: 400), 2.0)
  }
}
