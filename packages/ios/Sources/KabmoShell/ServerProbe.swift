import Foundation

/// Which of the stored addresses answers fastest, and which one to use.
///
/// The probe is `GET /api/health` — the one route that is public, touches no
/// database and never throws, so it answers while the server is still starting and
/// cannot be mistaken for a login redirect. The measurement is the round trip to
/// the first byte, which is what a page load actually pays.
///
/// Probes run in PARALLEL with a short timeout. Sequentially, three dead addresses
/// would cost three timeouts before the working one is even tried, and the whole
/// point is to recover from a dead address quickly.
///
/// The choice itself is `RouteChoice`'s, which is pure and tested; this type only
/// measures. It is deliberately synchronous — the caller is a load-failure callback
/// that has to decide before it can retry — so it must NOT be called on the main
/// thread.
public enum ServerProbe {

  /// How long one address gets. A LAN RTT is 1–5 ms; a dead one must fail fast.
  public static let timeout: TimeInterval = 1.5

  /// The round trip to `/api/health`, or nil when the address did not answer.
  public static func rttMs(_ url: String, timeout: TimeInterval = ServerProbe.timeout) -> Int? {
    let trimmed = url.hasSuffix("/") ? String(url.dropLast()) : url
    guard let target = URL(string: "\(trimmed)/api/health") else { return nil }

    var request = URLRequest(url: target)
    request.httpMethod = "GET"
    request.timeoutInterval = timeout
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    // A redirect off the health route is not an answer about THIS server.
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.timeoutIntervalForResource = timeout
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    let session = URLSession(configuration: configuration)

    let started = Date()
    let done = DispatchSemaphore(value: 0)
    var result: Int?

    session.dataTask(with: request) { _, response, _ in
      defer { done.signal() }
      guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
      result = Int(Date().timeIntervalSince(started) * 1000)
    }.resume()

    // The session's own timeout is the primary bound; this is the backstop for a
    // DNS lookup that outlives it.
    _ = done.wait(timeout: .now() + timeout + 0.5)
    session.invalidateAndCancel()
    return result
  }

  /// The best reachable address among `candidates`, or nil when none answered.
  ///
  /// `candidates` is the shell's own server list, so the same address may appear
  /// once; duplicates are collapsed because two rows for one origin can never
  /// disagree and would only double the probe.
  public static func best(_ candidates: [String], timeout: TimeInterval = ServerProbe.timeout) -> String? {
    var seen = Set<String>()
    let unique = candidates
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && seen.insert($0).inserted }
    if unique.isEmpty { return nil }
    if unique.count == 1 { return rttMs(unique[0], timeout: timeout) == nil ? nil : unique[0] }

    let lock = NSLock()
    var probed: [RouteChoice.Probed] = []
    let group = DispatchGroup()

    for url in unique {
      group.enter()
      DispatchQueue.global(qos: .userInitiated).async {
        let rtt = rttMs(url, timeout: timeout)
        lock.lock()
        probed.append(RouteChoice.Probed(url: url, kind: RouteChoice.kind(of: url), rttMs: rtt))
        lock.unlock()
        group.leave()
      }
    }

    _ = group.wait(timeout: .now() + timeout + 1)
    lock.lock()
    let snapshot = probed
    lock.unlock()
    return RouteChoice.pick(snapshot)?.url
  }
}
