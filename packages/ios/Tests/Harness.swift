import Foundation

/// The shell's own test runner.
///
/// A plain executable, not an XCTest bundle: XCTest ships with Xcode, and a machine
/// with only the Command Line Tools cannot resolve it (verified — `swift test`
/// fails with "unable to resolve module dependency: 'XCTest'"). A runner that exits
/// non-zero on a failure is the honest alternative, and it is what CI gates on. The
/// same shape `packages/macos/Tests` uses.
///
/// Every case in these suites is a way the shell could LIE, because none of them
/// throws in the app: a server address accepted here and refused there, a zoom that
/// renders at 2.6× while the slider says 100%, an overlay that hides a failure, an
/// update offered for the build already installed.
enum Harness {
  static var failures = 0
  static var checks = 0

  static func check(_ label: String, _ condition: @autoclosure () -> Bool) {
    checks += 1
    if condition() {
      print("  ok   \(label)")
    } else {
      failures += 1
      print("  FAIL \(label)")
    }
  }

  static func equal<T: Equatable>(_ label: String, _ actual: T, _ expected: T) {
    checks += 1
    if actual == expected {
      print("  ok   \(label)")
    } else {
      failures += 1
      print("  FAIL \(label) — got \(actual), expected \(expected)")
    }
  }

  static func close(_ label: String, _ actual: Double, _ expected: Double, tolerance: Double = 0.01) {
    checks += 1
    if abs(actual - expected) <= tolerance {
      print("  ok   \(label)")
    } else {
      failures += 1
      print("  FAIL \(label) — got \(actual), expected \(expected)")
    }
  }

  static func throwsError(_ label: String, _ body: () throws -> Void) {
    checks += 1
    do {
      try body()
      failures += 1
      print("  FAIL \(label) (no error thrown)")
    } catch {
      print("  ok   \(label)")
    }
  }

  static func group(_ name: String) {
    print("\n\(name)")
  }

  /// Finish the run: a non-zero exit is what CI reads.
  static func finish() -> Never {
    print("\n\(checks) checks, \(failures) failure(s)")
    exit(failures == 0 ? 0 : 1)
  }

  /// The repository root, found by walking up for the shared artwork.
  ///
  /// The wordmark test reads `public/kabmo-wordmark.svg`, which is the ONE copy the
  /// README embeds — a test that could not find it must fail rather than skip,
  /// because a skipped comparison is a copy nobody is checking.
  static func repoRoot() -> URL {
    var directory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).standardizedFileURL
    for _ in 0..<8 {
      let candidate = directory.appendingPathComponent("public/kabmo-wordmark.svg")
      if FileManager.default.fileExists(atPath: candidate.path) { return directory }
      directory.deleteLastPathComponent()
    }
    fatalError("could not find public/kabmo-wordmark.svg above the working directory")
  }
}
