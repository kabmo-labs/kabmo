import Foundation

/// The shell's own test runner.
///
/// `swift run kabmo-shell-tests` — a plain executable, because XCTest ships with
/// Xcode and this package must be testable with only the Command Line Tools. A
/// non-zero exit on a failure is what CI reads.
///
/// The suites cover the LOGIC target (`KabmoShell`), which is where every rule that
/// can fail silently lives. The UIKit layer is deliberately not exercised here: it
/// needs a window server and an iOS SDK, and the rules it wires are already pinned
/// on their own.
URLNormalizerTests.run()
ShellSettingsTests.run()
ShellPaletteTests.run()
LoadingStateTests.run()
ShellUpdateTests.run()
AppReleaseTests.run()
HealthProbeTests.run()
WordmarkTests.run()
DeviceFilesTests.run()
WebProcessRecoveryTests.run()

Harness.finish()
