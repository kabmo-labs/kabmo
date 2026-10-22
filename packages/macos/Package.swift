// swift-tools-version:5.9
import PackageDescription

// A macOS-only shell, deliberately. The window, the server supervision and the
// drag region are all AppKit, so there is no portable subset to keep honest for
// another platform — Windows and Linux would be separate shells, and pretending
// otherwise would mean a framework in the middle again.
let package = Package(
  name: "KabmoDesktop",
  platforms: [.macOS(.v13)],
  products: [
    // The PRODUCT is the app's name, because a process with no bundle reports
    // its executable's file name — `swift run kabmo-desktop` showed
    // "kabmo-desktop" in the menu bar (verified with NSRunningApplication).
    .executable(name: "Kabmo", targets: ["kabmo-desktop"]),
    .library(name: "KabmoDesktop", targets: ["KabmoDesktop"]),
  ],
  targets: [
    // Everything that can be tested without a window: the server list's rules,
    // the health probe, the process supervisor.
    .target(name: "KabmoDesktop"),
    // The app itself: AppKit window, WKWebView, menu bar, and the bridge.
    .executableTarget(name: "kabmo-desktop", dependencies: ["KabmoDesktop"]),
    // A plain executable rather than an XCTest bundle: XCTest ships with Xcode,
    // and this machine has only the Command Line Tools (verified: `swift test`
    // fails with "unable to resolve module dependency: 'XCTest'").
    .executableTarget(name: "kabmo-desktop-tests", dependencies: ["KabmoDesktop"], path: "Tests"),
    // Needs AppKit + WebKit, so it is a separate executable: the logic suite must
    // stay runnable without a window server.
    .executableTarget(name: "kabmo-desktop-window-tests", dependencies: ["KabmoDesktop"], path: "TestsWindow"),
  ]
)
