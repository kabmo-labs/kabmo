import Foundation

/// `GET /api/health`, the same readiness probe the CLI uses.
///
/// The route is deliberately dependency-free on the server (it never touches the
/// database and never throws), so it is the one endpoint that can answer while
/// Kabmo is still starting. The check is not "something responded" but "a Kabmo
/// responded": `service` must be `kabmo`, which is what stops the shell from
/// saving an address that points at some other web server and then showing an
/// unrelated page.
public struct HealthResult: Equatable {
  public let ok: Bool
  public let problem: HealthProblem?
  public let version: String?
  public let port: Int
  public let authEnabled: Bool
  public let mock: Bool

  public init(
    ok: Bool,
    problem: HealthProblem? = nil,
    version: String? = nil,
    port: Int = 0,
    authEnabled: Bool = false,
    mock: Bool = false
  ) {
    self.ok = ok
    self.problem = problem
    self.version = version
    self.port = port
    self.authEnabled = authEnabled
    self.mock = mock
  }
}

/// Why a probe did not succeed. Each case is one sentence on the settings screen.
public enum HealthProblem: String, Equatable {
  /// A non-2xx status. The health route is public by design, so this is a refusal
  /// from something else listening on that port.
  case status
  /// Something answered, but its `service` is not `kabmo`.
  case notKabmo
  /// Nothing answered at all.
  case unreachable
  /// A 2xx whose body is not the JSON shape we expect.
  case malformed
}

/// Parse a health response body.
///
/// Split from the request so every refusal can be pinned by a test without a
/// socket — the interesting cases (another product on the port, a body that is not
/// JSON at all) are exactly the ones a live call cannot produce on demand.
public enum HealthProbe {

  public static let path = "/api/health"
  public static let timeout: TimeInterval = 6

  /// A parsed body, or the reason it is not one.
  public static func parse(status: Int, body: Data) -> HealthResult {
    guard (200...299).contains(status) else {
      return HealthResult(ok: false, problem: .status)
    }
    guard
      let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
      object["service"] as? String == "kabmo"
    else {
      return HealthResult(ok: false, problem: .notKabmo)
    }

    return HealthResult(
      ok: true,
      version: (object["version"] as? String).flatMap { $0.isEmpty ? nil : $0 },
      port: object["port"] as? Int ?? 0,
      authEnabled: object["authEnabled"] as? Bool ?? false,
      mock: object["mock"] as? Bool ?? false
    )
  }

  /// Ask a normalized origin whether it is a Kabmo server.
  ///
  /// `URLSession` with an ephemeral configuration: the settings screen's probe must
  /// not carry the console's session cookie to a candidate address, and it must not
  /// write anything into the shared store either.
  ///
  /// The session is a parameter rather than a default argument, because a default
  /// `URLSession` would be constructed on every call — one per keystroke in a future
  /// caller — and an ephemeral session is the caller's decision to state.
  public static func check(baseURL: String, session: URLSession? = nil) async -> HealthResult {
    let session = session ?? URLSession(configuration: .ephemeral)
    guard let url = URL(string: baseURL + path) else {
      return HealthResult(ok: false, problem: .unreachable)
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.timeoutInterval = timeout
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    // A redirect off the health route is not an answer about THIS server.
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")

    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        return HealthResult(ok: false, problem: .malformed)
      }
      return parse(status: http.statusCode, body: data)
    } catch {
      return HealthResult(ok: false, problem: .unreachable)
    }
  }

  /// Whether a status code and body came from a Kabmo — for a caller that already
  /// has the bytes (a test, or a future shared fetch path).
  public static func isKabmo(status: Int, body: Data) -> Bool {
    parse(status: status, body: body).ok
  }
}
