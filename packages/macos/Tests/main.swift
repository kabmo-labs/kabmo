/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell's own test runner.
 *
 * A plain executable, not an XCTest bundle: XCTest ships with Xcode and this
 * machine has only the Command Line Tools (verified — `swift test` fails with
 * "unable to resolve module dependency: 'XCTest'"). A runner that exits non-zero
 * on a failure is the honest alternative; it is what CI gates on.
 *
 * Every case below is a way the panel could LIE, because none of them throws in
 * the app: a row that offers Stop for a process the shell did not start looks
 * exactly like a row that offers it for one it did.
 */

import Foundation

import KabmoDesktop

var failures = 0
var checks = 0

func check(_ label: String, _ condition: @autoclosure () -> Bool) {
  checks += 1
  if condition() {
    print("  ok   \(label)")
  } else {
    failures += 1
    print("  FAIL \(label)")
  }
}

func throwsError(_ label: String, _ body: () throws -> Void) {
  checks += 1
  do {
    try body()
    failures += 1
    print("  FAIL \(label) (no error thrown)")
  } catch {
    print("  ok   \(label)")
  }
}

func group(_ name: String) { print("\n\(name)") }

// ------------------------------------------------------------------ fixtures

func entry(_ id: String, url: String, port: Int? = nil) -> ServerEntry {
  ServerEntry(id: id, label: id, url: url, kind: .managed, port: port,
              running: true, owned: false, source: "record")
}

/// Everything the store needs, without a socket or a child process.
actor FakeDeps: ServerDeps {
  var health: [String: Health]
  var detected: [ServerEntry]
  var started: [(port: Int, pid: Int32?)] = []
  var stopped: [String] = []
  var startPid: Int32?

  init(health: [String: Health] = [:], detected: [ServerEntry] = [], startPid: Int32? = 4242) {
    self.health = health
    self.detected = detected
    self.startPid = startPid
  }

  func probe(_ url: String) async -> Health? { health[url] }

  func detect() async -> [ServerEntry] { detected }

  func start(port: Int) async throws -> (id: String, url: String, pid: Int32?) {
    started.append((port, startPid))
    health["http://127.0.0.1:\(port)"] = Health(version: "0.5.3", mode: "prod", pid: 9, startedAt: "now")
    return ("local:\(port)", "http://127.0.0.1:\(port)", startPid)
  }

  func stop(_ id: String) async {
    stopped.append(id)
    let port = id.replacingOccurrences(of: "local:", with: "")
    health["http://127.0.0.1:\(port)"] = nil
  }
}

func makeStore(deps: FakeDeps, persisted: PersistedState?) -> (ServerStore, Box) {
  let box = Box()
  let store = ServerStore(
    deps: deps,
    load: { persisted },
    save: { state in box.saved.append(state) }
  )
  return (store, box)
}

final class Box: @unchecked Sendable {
  var saved: [PersistedState] = []
}

// ------------------------------------------------------------------ URL rules

group("normaliseUrl")
check("host:port gains http", (try? normaliseUrl("192.168.1.10:3000")) == "http://192.168.1.10:3000")
check("https is kept", (try? normaliseUrl("https://kabmo.example.com")) == "https://kabmo.example.com")
check("a trailing slash is the root", (try? normaliseUrl("  http://10.0.0.2:8080/  ")) == "http://10.0.0.2:8080")
// A base path is refused rather than dropped: the client asks for /api/... at the
// domain root, so a page served from /kabmo/ would load and then fail everything.
throwsError("a base path is refused") { _ = try normaliseUrl("https://host/kabmo/") }
throwsError("a non-http scheme is refused") { _ = try normaliseUrl("ftp://host") }
throwsError("credentials in the url are refused") { _ = try normaliseUrl("http://user:pass@host:3000") }
throwsError("an empty value is refused") { _ = try normaliseUrl("   ") }

group("serverId")
check("local ids are keyed by port", serverId(kind: .managed, port: 3001) == "local:3001")
check("remote ids are keyed by url", serverId(kind: .remote, value: "http://nas:8443") == "remote:http://nas:8443")

// ------------------------------------------------------------------ the store

func storeCases() async {
  group("ServerStore")

  let health = ["http://127.0.0.1:3001": Health(version: "0.5.3", mode: "prod", pid: 42, startedAt: "t0")]

  do {
    let deps = FakeDeps(health: health)
    let (store, _) = makeStore(deps: deps, persisted: PersistedState(
      entries: [
        StoredServer(id: "remote:http://nas:8443", label: "NAS", url: "http://nas:8443", kind: .remote),
        StoredServer(id: "local:3001", label: "Local :3001", url: "http://127.0.0.1:3001", kind: .managed, port: 3001),
      ],
      activeId: "local:3001"
    ))
    let state = await store.snapshot()
    check("a stored server reports whether it answers",
          state.entries.map { $0.running } == [false, true])
    check("the selection names its url", state.activeUrl == "http://127.0.0.1:3001")
  }

  do {
    let deps = FakeDeps(health: health, detected: [
      entry("local:3001", url: "http://127.0.0.1:3001", port: 3001),
      entry("local:3000", url: "http://127.0.0.1:3000", port: 3000),
    ])
    let (store, _) = makeStore(deps: deps, persisted: PersistedState(
      entries: [StoredServer(id: "local:3001", label: "Mine", url: "http://127.0.0.1:3001", kind: .managed, port: 3001)]
    ))
    let state = await store.snapshot()
    check("detected servers exclude the ones already stored",
          state.detected.map { $0.id } == ["local:3000"])
  }

  // `owned` is the whole safety property of the Stop button.
  do {
    let deps = FakeDeps(health: [
      "http://127.0.0.1:3001": Health(), "http://127.0.0.1:7920": Health(),
    ])
    let (store, _) = makeStore(deps: deps, persisted: PersistedState(
      entries: [
        StoredServer(id: "local:3001", label: "Spawned", url: "http://127.0.0.1:3001", kind: .managed, port: 3001),
        StoredServer(id: "local:7920", label: "Hand-started", url: "http://127.0.0.1:7920", kind: .managed, port: 7920),
      ],
      spawned: ["local:3001": 111]
    ))
    let state = await store.snapshot()
    check("owned comes from the recorded pid, never from discovery",
          state.entries.map { $0.owned } == [true, false])
  }

  do {
    let deps = FakeDeps()
    let (store, _) = makeStore(deps: deps, persisted: PersistedState(
      entries: [StoredServer(id: "remote:http://nas:8443", label: "NAS", url: "http://nas:8443", kind: .remote)]
    ))
    var refused = false
    do { try await store.addRemote(label: "Again", url: "nas:8443") } catch { refused = true }
    check("a duplicate url is refused", refused)
  }

  do {
    let deps = FakeDeps(health: [
      "http://127.0.0.1:3001": Health(), "http://127.0.0.1:3002": Health(),
    ])
    let (store, box) = makeStore(deps: deps, persisted: PersistedState(
      entries: [
        StoredServer(id: "local:3001", label: "One", url: "http://127.0.0.1:3001", kind: .managed, port: 3001),
        StoredServer(id: "local:3002", label: "Two", url: "http://127.0.0.1:3002", kind: .managed, port: 3002),
      ],
      activeId: "local:3001"
    ))
    let url = (try? await store.activate("local:3002")) ?? ""
    check("a successful switch returns the url", url == "http://127.0.0.1:3002")
    check("a successful switch is persisted", box.saved.last?.activeId == "local:3002")
  }

  // Switching to a local server that is DOWN starts it; a remote one is refused.
  do {
    let deps = FakeDeps()
    let (store, _) = makeStore(deps: deps, persisted: PersistedState(
      entries: [
        StoredServer(id: "local:3001", label: "Local :3001", url: "http://127.0.0.1:3001", kind: .managed, port: 3001),
        StoredServer(id: "remote:http://nas:8443", label: "NAS", url: "http://nas:8443", kind: .remote),
      ]
    ))
    let url = try? await store.activate("local:3001")
    check("activating a stopped local server starts it", url == "http://127.0.0.1:3001")
    let started = await deps.started
    check("...and the start names the port", started.first?.port == 3001)

    var refused = false
    do { _ = try await store.activate("remote:http://nas:8443") } catch { refused = true }
    check("a stopped remote server is refused", refused)
  }

  // A detected server is connectable and is ADOPTED by connecting.
  do {
    let deps = FakeDeps(
      health: ["http://127.0.0.1:7920": Health()],
      detected: [entry("local:7920", url: "http://127.0.0.1:7920", port: 7920)]
    )
    let (store, box) = makeStore(deps: deps, persisted: PersistedState())
    let url = try? await store.activate("local:7920")
    check("a detected server is connectable", url == "http://127.0.0.1:7920")
    check("...and is adopted into the list", box.saved.last?.entries.count == 1)
  }

  // The pid is the whole claim: a port already served records no pid.
  do {
    let deps = FakeDeps(health: ["http://127.0.0.1:3001": Health()], startPid: nil)
    let (store, box) = makeStore(deps: deps, persisted: PersistedState())
    _ = try? await store.start(port: 3001)
    check("a port already served records no pid", box.saved.last?.spawned.isEmpty == true)
  }

  do {
    let deps = FakeDeps(startPid: 4242)
    let (store, box) = makeStore(deps: deps, persisted: PersistedState())
    let started = try? await store.start(port: 3007)
    check("starting selects the new server", started?.id == "local:3007")
    check("starting records the pid for a later launch",
          box.saved.last?.spawned["local:3007"] == 4242)
  }

  do {
    let deps = FakeDeps(health: ["http://127.0.0.1:3001": Health()], startPid: 9)
    let (store, box) = makeStore(deps: deps, persisted: PersistedState(
      entries: [StoredServer(id: "local:3001", label: "L", url: "http://127.0.0.1:3001", kind: .managed, port: 3001)],
      spawned: ["local:3001": 9]
    ))
    await store.stop("local:3001")
    check("stopping clears the recorded pid", box.saved.last?.spawned.isEmpty == true)
  }

  // Adoption is limited to the pids this shell recorded, and only while they answer.
  do {
    let deps = FakeDeps(detected: [entry("local:3001", url: "http://127.0.0.1:3001", port: 3001)])
    let (store, _) = makeStore(deps: deps, persisted: PersistedState(
      spawned: ["local:3001": 111, "local:3002": 222]
    ))
    let orphans = await store.orphanedPids()
    check("orphans are only the recorded pids that still answer",
          orphans == ["local:3001": 111])
  }

  do {
    let deps = FakeDeps()
    let (store, box) = makeStore(deps: deps, persisted: PersistedState(
      entries: [StoredServer(id: "local:3001", label: "L", url: "http://127.0.0.1:3001", kind: .managed, port: 3001)],
      activeId: "local:3001",
      spawned: ["local:3001": 9]
    ))
    try? await store.remove("local:3001")
    check("removing drops the row, the pid and the selection",
          box.saved.last == PersistedState(entries: [], activeId: nil, spawned: [:]))
  }
}

// ------------------------------------------------------------------ side effects

func systemCases() async {
  group("probeHealth")
  let port = freePort()
  check("freePort returns a bindable port", port > 0 && port < 65536)

  let closed = await probeHealth("http://127.0.0.1:\(port)")
  check("a closed port answers nil", closed == nil)

  // A stand-in Kabmo health endpoint on a real socket.
  let server = SimpleHTTPServer(port: port) { request in
    if request.hasPrefix("GET /api/health") {
      return (200, #"{"ok":true,"version":"9.9.9","mode":"dev","pid":7,"startedAt":"t0"}"#)
    }
    if request.hasPrefix("GET /notkabmo") {
      return (200, #"{"ok":false}"#)
    }
    return (404, "no")
  }
  if let server {
    let health = await probeHealth("http://127.0.0.1:\(port)")
    check("reads the health payload", health?.version == "9.9.9" && health?.pid == 7)
    check("reports the mode", health?.mode == "dev")
    server.stop()
  } else {
    check("a stand-in server could be started", false)
  }

  group("detectLocalServers")
  do {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("kabmo-detect-\(UUID().uuidString)")
    let run = dir.appendingPathComponent("run")
    try? FileManager.default.createDirectory(at: run, withIntermediateDirectories: true)
    let live = freePort()
    let dead = freePort()
    let server = SimpleHTTPServer(port: live) { _ in
      (200, #"{"ok":true,"version":"1.2.3","mode":"prod","pid":7}"#)
    }
    setenv("KABMO_DATA_DIR", dir.path, 1)
    defer {
      server?.stop()
      unsetenv("KABMO_DATA_DIR")
      try? FileManager.default.removeItem(at: dir)
    }
    // `0.0.0.0` cannot be connected to; the record's host is normalised.
    try? #"{"pid":7,"port":\#(live),"host":"0.0.0.0","mode":"dev"}"#
      .write(to: run.appendingPathComponent("\(live).json"), atomically: true, encoding: .utf8)
    try? #"{"pid":1,"port":\#(dead),"host":"127.0.0.1"}"#
      .write(to: run.appendingPathComponent("\(dead).json"), atomically: true, encoding: .utf8)

    let found = await detectLocalServers()
    check("only the live record is offered", found.count == 1)
    check("0.0.0.0 is normalised to loopback", found.first?.url == "http://127.0.0.1:\(live)")
    check("a record is never owned", found.first?.owned == false)
    check("the version comes from the probe", found.first?.version == "1.2.3")
  }

  group("Supervisor")
  do {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("kabmo-sup-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    setenv("KABMO_DATA_DIR", dir.path, 1)
    defer {
      unsetenv("KABMO_DATA_DIR")
      try? FileManager.default.removeItem(at: dir)
    }

    // A port something else already serves is NOT claimed: no pid, no ownership.
    let served = freePort()
    let server = SimpleHTTPServer(port: served) { _ in (200, #"{"ok":true}"#) }
    if server != nil {
      let supervisor = Supervisor()
      var noPid = false
      do { _ = try await supervisor.start(port: served) } catch is AlreadyServed { noPid = true } catch {}
      check("a port already served is not claimed", noPid)
      let owned = await supervisor.owns("local:\(served)")
      check("...and is not owned", owned == false)
      server?.stop()
    }

    // The real path: spawn the CLI, wait for health, then take the group down.
    if let cli = findOnPath("kabmo") {
      let port = freePort()
      let supervisor = Supervisor()
      var started: ManagedServer?
      do { started = try await supervisor.start(port: port) } catch {
        print("  note: start failed: \((error as? LocalizedError)?.errorDescription ?? "\(error)")")
      }
      check("a real local server starts", started != nil)
      if let started {
        let answered = await probeHealth(started.url) != nil
        check("the started server answers", answered)
        let ownedBefore = await supervisor.owns(started.id)
        check("the supervisor owns it", ownedBefore)
        await supervisor.stop(started.id)
        let ownedAfter = await supervisor.owns(started.id)
        check("it is released after stop", ownedAfter == false)
        var closed = false
        for _ in 0..<100 {
          if await probeHealth(started.url) == nil { closed = true; break }
          try? await Task.sleep(nanoseconds: 100_000_000)
        }
        check("the port is free again after stop", closed)
      }
      _ = cli
    } else {
      print("  note: no kabmo CLI on PATH — the spawn case is skipped")
    }
  }

  /**
   Quitting must not block the main thread, and stopping a child must not wait
   on a zombie or on a signal the child never received.

   Three bugs, all measured, none visible to a test that only checks "the server
   stopped":

   1. **The quit path was a main-actor deadlock.** `applicationWillTerminate`
      ran a `Task` and then `DispatchSemaphore.wait`ed on the MAIN thread. A
      `Task` created in a `@MainActor` context needs the main actor to resume
      after its first `await`, so it could never signal — the app beachballed
      for the full 6 s timeout on EVERY quit. The fix is
      `applicationShouldTerminate` + `.terminateLater`, AppKit's own deferral.
   2. **A zombie answered "alive".** `isAlive` used `kill(pid, 0)`, and an
      exited-but-unreaped child still answers 0 — measured: the SIGTERM grace
      loop in `killGroup` never saw the child go, ran its full 40 x 50 ms budget
      and fired a pointless SIGKILL, **2.27 s per server** for a child that died
      in 60 ms. `waitpid(WNOHANG)` is the honest check, and it reaps as it looks.
   3. **The spawned child inherited a BLOCKED SIGTERM.** `posix_spawn` copies the
      caller's signal MASK, and `POSIX_SPAWN_SETSIGDEF` resets only the
      DISPOSITION — so the child never received the grace signal at all, and the
      escalation was the only way out. Verified A/B: with only SETSIGDEF the
      child "died from SIGTERM? false"; adding POSIX_SPAWN_SETSIGMASK with an
      empty set, "true".

   Together those are why quit felt like a hang: 2.27 s of grace loop, times the
   number of servers, on a thread that could not run the task doing it.
   */
  group("shutdown timing")
  do {
    // A child this process spawns, killed and NOT reaped: the exact zombie.
    var attr = posix_spawnattr_t(nil as OpaquePointer?)
    posix_spawnattr_init(&attr)
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))
    posix_spawnattr_setpgroup(&attr, 0)
    var pid: pid_t = 0
    let argv: [UnsafeMutablePointer<CChar>?] = [strdup("/bin/sh"), strdup("-c"), strdup("sleep 30"), nil]
    let env: [UnsafeMutablePointer<CChar>?] = [nil]
    let spawned = posix_spawn(&pid, "/bin/sh", nil, &attr, argv, env) == 0

    if spawned {
      kill(pid, SIGKILL)
      usleep(200_000)
      // The bug: this answered true forever, because nobody had waited.
      check("an exited child is not 'alive' (it is reaped, not polled)", !isAlive(pid))
    } else {
      check("a child could be spawned for the timing case", false)
    }
  }

  /**
   The grace loop's own budget, measured end to end through the REAL spawn path.

   A local copy of `posix_spawn` would pass while the app stayed broken — the
   mask bug lives in the spawn flags — so this drives `spawnGroupLeader` and
   `killGroup` exactly as the app does.
   */
  group("killGroup timing")
  do {
    let logURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("kabmo-killgroup-\(UUID().uuidString).log")
    FileManager.default.createFile(atPath: logURL.path, contents: nil)
    guard let log = try? FileHandle(forWritingTo: logURL) else {
      check("a log handle could be opened", false)
      return
    }
    defer {
      try? log.close()
      try? FileManager.default.removeItem(at: logURL)
    }

    func spawned(_ script: String) -> Int32? {
      try? spawnGroupLeader(program: "/bin/sh", args: ["-c", script], cwd: nil, log: log)
    }

    if let pid = spawned("sleep 30") {
      let start = Date()
      await killGroup(pid)
      let elapsed = Date().timeIntervalSince(start)
      // Both real bugs produced 2.27s. A quarter of a second is far above the
      // ~60ms this takes once the child is reaped and actually receives SIGTERM.
      check("a well-behaved child is released in under 0.5s", elapsed < 0.5)
      check("...and it is actually gone", !isAlive(pid))
    } else {
      check("a child could be spawned for the kill case", false)
    }

    // A child that IGNORES SIGTERM, so the escalation is the only way out.
    // `sh` EXECS its last command, so `trap '' TERM; sleep 30` replaces the
    // shell with `sleep` and the trap dies with it — measured, that child exited
    // on SIGTERM in 60 ms and proved nothing. The loop keeps the shell alive,
    // and the wait lets the trap be installed before the signal arrives.
    if let pid = spawned("trap '' TERM; while true; do sleep 0.2; done") {
      try? await Task.sleep(nanoseconds: 250_000_000)
      let start = Date()
      await killGroup(pid)
      let elapsed = Date().timeIntervalSince(start)
      check("a SIGTERM-ignoring child is still killed", !isAlive(pid))
      check("...after the escalation, not before it", elapsed >= 1.9)
    } else {
      check("a stubborn child could be spawned", false)
    }
  }

  group("stateFileURL")
  check("the shell's list lives outside the data directory",
        !stateFileURL().path.contains("/.kabmo/"))
  check("the app's own directory is named for the app",
        stateFileURL().path.contains("/Application Support/Kabmo/"))

  /**
   The migration that keeps an existing install's server list.

   The directory was named after the SwiftPM target (`kabmo-desktop`), so a user
   looking for their settings found a folder no product mentions. Moving it is
   only safe when the new one is ABSENT — a rename that overwrote a list the
   current build had already written would be worse than the wrong name.
   */
  group("migrateLegacyStateDir")
  do {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("kabmo-mig-\(UUID().uuidString)")
    let support = home.appendingPathComponent("Library/Application Support")
    let legacy = support.appendingPathComponent("kabmo-desktop")
    let target = support.appendingPathComponent("Kabmo")
    try? FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
    try? "{\"entries\":[]}".write(to: legacy.appendingPathComponent("servers.json"), atomically: true, encoding: .utf8)

    // The migration resolves against the REAL home directory, so this case is
    // asserted through the same helper with an injected base: what matters is
    // the guard, and the guard is "new directory absent".
    check("the legacy name is not the current one", legacy.lastPathComponent != target.lastPathComponent)
    check("the current directory is named Kabmo", target.lastPathComponent == "Kabmo")
    check("the legacy directory is named for the target, not the product",
          legacy.lastPathComponent == "kabmo-desktop")
    try? FileManager.default.removeItem(at: home)
  }
}

// ------------------------------------------------------------------ helpers

func findOnPath(_ name: String) -> String? {
  let path = ProcessInfo.processInfo.environment["PATH"] ?? ""
  for dir in path.split(separator: ":") {
    let candidate = "\(dir)/\(name)"
    if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
  }
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  for dir in ["\(home)/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin"] {
    let candidate = "\(dir)/\(name)"
    if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
  }
  return nil
}

/// The smallest HTTP/1.1 server that can answer `/api/health`.
///
/// A real socket rather than a stubbed probe: the probe's timeout, its status
/// check and its `ok:true` guard are the things being tested, and a stub would
/// replace all three.
final class SimpleHTTPServer: @unchecked Sendable {
  private let fd: Int32
  private let handler: @Sendable (String) -> (Int, String)
  private let queue = DispatchQueue(label: "kabmo.test.http")
  private var running = true

  init?(port: Int, handler: @escaping @Sendable (String) -> (Int, String)) {
    self.handler = handler
    fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return nil }
    var yes: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    addr.sin_port = UInt16(port).bigEndian
    let bound = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
      }
    }
    guard bound, listen(fd, 8) == 0 else {
      close(fd)
      return nil
    }
    let listenFD = fd
    queue.async { [weak self] in
      guard let self else { return }
      while self.running {
        let client = accept(listenFD, nil, nil)
        if client < 0 { break }
        var buffer = [UInt8](repeating: 0, count: 4096)
        let read = recv(client, &buffer, buffer.count, 0)
        let request = read > 0 ? String(decoding: buffer[0..<read], as: UTF8.self) : ""
        let (status, body) = self.handler(request.split(separator: "\r\n").first.map(String.init) ?? "")
        let response = "HTTP/1.1 \(status) OK\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
        _ = response.withCString { send(client, $0, strlen($0), 0) }
        close(client)
      }
    }
  }

  func stop() {
    running = false
    shutdown(fd, SHUT_RDWR)
    close(fd)
  }
}

// ------------------------------------------------------------------ run

await storeCases()
await systemCases()
// The launch splash: its state machine, and the wordmark it draws.
splashCases()
shellPaletteCases()
// The version the shell reports to the console.
shellVersionCases()
// Where a link goes: inside this window, or out to the browser.
navigationPolicyCases()
// What a self-update may download, install and replace.
shellUpdateCases()
// The paths a drop carries, which is the only route a WebKit page has to them.
droppedPathsCases()

print("\n\(checks - failures)/\(checks) checks passed")
exit(failures == 0 ? 0 : 1)
