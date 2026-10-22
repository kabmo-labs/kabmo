// swift-tools-version:5.9
import PackageDescription

// The Kabmo iOS shell: a WKWebView around a Kabmo console.
//
// Deliberately dependency-free — no SwiftUI, no third-party packages. The app is
// one view controller hosting a `WKWebView`, plus a small native settings screen,
// so the binary carries only the Swift runtime and this source. Everything
// available on the platform (WebKit, URLSession, UIKit) is used as-is.
//
// TWO TARGETS, and the split is the same one `packages/macos` makes for a
// different reason: `KabmoShell` holds every rule that can be tested without a
// window server (URL normalization, the zoom mapping, the overlay's state
// machine, the update decisions, the wordmark geometry), and `kabmo-shell` is the
// UIKit app that draws them. That is what lets `swift run kabmo-shell-tests`
// exercise the real rules on a plain Mac, with no simulator and no XCTest.
//
// The app target is guarded by `#if canImport(UIKit)`, so the package still
// BUILDS on macOS (where it prints a one-line explanation and exits) while the
// same source compiles as the real application against the iOS SDK. Without the
// guard, `swift build` on a developer's Mac would fail on `import UIKit` and take
// the logic suite down with it.
let package = Package(
  name: "KabmoIOS",
  // iOS 16 is the floor: `WKWebView.pageZoom`, `WKDownload` and the file-input
  // support this shell relies on all exist from 14.5, and 16 costs nothing that
  // a current device still needs.
  platforms: [.iOS(.v16), .macOS(.v13)],
  products: [
    .executable(name: "kabmo-shell", targets: ["kabmo-shell"]),
    .library(name: "KabmoShell", targets: ["KabmoShell"]),
  ],
  targets: [
    .target(name: "KabmoShell"),
    .executableTarget(name: "kabmo-shell", dependencies: ["KabmoShell"]),
    // A plain executable rather than an XCTest bundle: XCTest ships with Xcode,
    // and a machine with only the Command Line Tools cannot resolve it. A runner
    // that exits non-zero on a failure is the honest alternative, and it is what
    // CI gates on — the same shape `packages/macos/Tests` uses.
    .executableTarget(name: "kabmo-shell-tests", dependencies: ["KabmoShell"], path: "Tests"),
  ]
)
