#if canImport(UIKit)
import Foundation
import KabmoShell

/// Every sentence the settings screen prints, in one place.
///
/// Split from the screen for the reason `LoadingState` is split from its overlay: a
/// refusal is a VALUE, and the wording is the part a reader checks against the server
/// it is talking to. Two refusals can look identical on screen and mean different
/// things — a port with nothing on it and a port with another web server — which is
/// why each case has its own sentence instead of one "could not connect".
enum SettingsCopy {

  static func message(for problem: URLProblem) -> String {
    switch problem {
    case .empty:
      return "Enter a server URL."
    case .scheme:
      return "Only http:// and https:// are supported."
    case .path:
      return "Use the origin only, without a path (Kabmo is served at the root)."
    case .shape:
      return "Expected something like http://192.168.1.20:3000"
    }
  }

  static func message(for problem: HealthProblem) -> String {
    switch problem {
    case .notKabmo:
      return "Something answered, but it is not a Kabmo server."
    case .status, .malformed, .unreachable:
      return "Could not reach the server. Check the address and that the device is on the same network."
    }
  }

  /// What a passing check reports: the version, the port, and the two facts that
  /// change what the user does next (a password is required, or the data is a demo).
  static func connected(_ result: HealthResult) -> String {
    let version = result.version ?? "?"
    if result.mock {
      return "Connected to Kabmo \(version) on port \(result.port) (demo data)."
    }
    if result.authEnabled {
      return "Connected to Kabmo \(version) on port \(result.port) — password required."
    }
    return "Connected to Kabmo \(version) on port \(result.port)."
  }
}
#endif
