/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two things the shell does to the machine: probe a URL, and own a local
 * server process.
 *
 * Separate from `Store.swift`, which holds the RULES. These are the side effects,
 * and they are what a test replaces: a probe is a socket, a start is a child
 * process, and neither belongs inside a test that is checking what the panel
 * decides.
 */

import Foundation

/// How long a freshly spawned local server may take to answer `/api/health`.
private let startTimeout: TimeInterval = 45
/// The probe's own budget. One closed port must not stall a refresh.
private let probeTimeout: TimeInterval = 1.5

/**
 `~/.kabmo`, or the override, resolved the way `lib/lifecycle/paths.ts` does.

 `FileManager.homeDirectoryForCurrentUser`, never `HOME`: a process started
 without a shell (launchd, a GUI launcher) has no `HOME`, and an empty value would
 silently move the data directory to a cwd-relative path — which is how the app and
 the CLI would end up with two databases.
 */
public func dataDirectory() -> URL {
  let env = ProcessInfo.processInfo.environment
  let override = (env["KABMO_DATA_DIR"] ?? env["OMPCHAMBER_DATA_DIR"] ?? "")
    .trimmingCharacters(in: .whitespacesAndNewlines)
  if !override.isEmpty {
    if override.hasPrefix("~/") {
      return FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(String(override.dropFirst(2)))
    }
    return URL(fileURLWithPath: override)
  }
  return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".kabmo")
}

/// `GET /api/health`, or nil when nothing answers on that URL.
public func probeHealth(_ urlString: String) async -> Health? {
  guard let url = URL(string: urlString + "/api/health") else { return nil }
  var request = URLRequest(url: url)
  request.timeoutInterval = probeTimeout
  request.setValue("application/json", forHTTPHeaderField: "Accept")
  // No cache: the panel re-probes on every read, and a cached "running" would
  // outlive the process it describes.
  request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

  do {
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
    guard let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    // A 200 that is not Kabmo is not a Kabmo: without this, any web server on the
    // port would be offered as a console.
    guard body["ok"] as? Bool == true else { return nil }
    return Health(
      version: body["version"] as? String,
      mode: body["mode"] as? String,
      pid: (body["pid"] as? NSNumber).map { $0.int32Value },
      startedAt: body["startedAt"] as? String
    )
  } catch {
    return nil
  }
}

/**
 Every live local instance, read from the records the SERVERS write.

 `<data>/run/<port>.json` is written by the process that owns the port
 (`lib/lifecycle/instance.ts`), so `kabmo serve` in a terminal, `bun run dev` and a
 login entry all appear. A record whose process is gone is skipped, and the health
 probe is the final word — a record can outlive a crash.
 */
public func detectLocalServers() async -> [ServerEntry] {
  let runDir = dataDirectory().appendingPathComponent("run")
  guard let names = try? FileManager.default.contentsOfDirectory(atPath: runDir.path) else { return [] }

  var found: [ServerEntry] = []
  for name in names where name.hasSuffix(".json") {
    guard let data = try? Data(contentsOf: runDir.appendingPathComponent(name)),
          let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { continue }

    let port = (record["port"] as? NSNumber)?.intValue
      ?? Int(name.replacingOccurrences(of: ".json", with: "")) ?? 0
    guard port > 0, port < 65536 else { continue }

    // `0.0.0.0`/`::` are bind-any addresses and cannot be connected to; loopback
    // reaches the same listener.
    let rawHost = (record["host"] as? String) ?? "127.0.0.1"
    let host = ["0.0.0.0", "::", "[::]", ""].contains(rawHost) ? "127.0.0.1" : rawHost
    let url = "http://\(host):\(port)"
    guard let health = await probeHealth(url) else { continue }

    found.append(ServerEntry(
      id: "local:\(port)", label: "Local :\(port)", url: url, kind: .managed, port: port,
      running: true,
      // A record is never owned: whoever started it still holds it.
      owned: false,
      version: health.version,
      mode: health.mode ?? (record["mode"] as? String),
      pid: health.pid ?? (record["pid"] as? NSNumber).map { $0.int32Value },
      startedAt: health.startedAt ?? (record["startedAt"] as? String),
      source: "record"
    ))
  }
  return found.sorted { ($0.port ?? 0) < ($1.port ?? 0) }
}

/// A free TCP port on loopback, chosen by binding one and letting it go.
public func freePort() -> Int {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  guard fd >= 0 else { return 0 }
  defer { close(fd) }
  var addr = sockaddr_in()
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_addr.s_addr = inet_addr("127.0.0.1")
  addr.sin_port = 0
  var length = socklen_t(MemoryLayout<sockaddr_in>.size)
  let bound = withUnsafeMutablePointer(to: &addr) { pointer -> Bool in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      bind(fd, $0, length) == 0
    }
  }
  guard bound else { return 0 }
  guard getsockname(fd, withUnsafeMutablePointer(to: &addr) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { $0 }
  }, &length) == 0 else { return 0 }
  return Int(UInt16(bigEndian: addr.sin_port))
}

/// A local server this shell owns.
public struct ManagedServer: Sendable {
  public let id: String
  public let url: String
  public let pid: Int32
}

/**
 The local servers this shell started, plus the pids it adopted after a restart.

 A managed server runs in its OWN process group (`posix_spawn` with
 `POSIX_SPAWN_SETPGROUP`), so Stop signals the group — which takes the PTY shells
 and plugin children with it instead of orphaning them.
 */
public actor Supervisor {
  private var children: [String: ManagedServer] = [:]
  private var adopted: [String: Int32] = [:]

  public init() {}

  public func owns(_ id: String) -> Bool {
    children[id] != nil || adopted[id] != nil
  }

  public func adopt(id: String, pid: Int32) {
    if children[id] == nil { adopted[id] = pid }
  }

  public func start(port: Int) async throws -> ManagedServer {
    let id = "local:\(port)"
    let url = "http://127.0.0.1:\(port)"
    if await probeHealth(url) != nil {
      // Something already serves this port. It is NOT ours to claim: a server the
      // user started in a terminal answers here too, and handing back a pid would
      // make the panel offer Stop for a process this shell never spawned.
      throw AlreadyServed(id: id, url: url)
    }
    if children[id] != nil {
      throw ServerError("A local server is already starting on port \(port).")
    }

    let launch = try resolveLaunch()
    let data = dataDirectory()
    try? FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
    let logURL = data.appendingPathComponent("desktop-\(port).log")
    if !FileManager.default.fileExists(atPath: logURL.path) {
      FileManager.default.createFile(atPath: logURL.path, contents: nil)
    }
    let logHandle = try FileHandle(forWritingTo: logURL)
    logHandle.seekToEndOfFile()

    var argv = launch.args + ["--port", "\(port)", "--host", "127.0.0.1"]
    // `--foreground` keeps the server a CHILD of this process rather than
    // detaching into a daemon the shell could never stop.
    if launch.isCLI { argv.append("--foreground") }

    let pid = try spawnGroupLeader(program: launch.program, args: argv, cwd: launch.cwd, log: logHandle)
    let managed = ManagedServer(id: id, url: url, pid: pid)
    children[id] = managed

    let deadline = Date().addingTimeInterval(startTimeout)
    while Date() < deadline {
      if await probeHealth(url) != nil { return managed }
      if !isAlive(pid) {
        children[id] = nil
        throw ServerError("The local server exited during startup. See \(logURL.path).")
      }
      try? await Task.sleep(nanoseconds: 150_000_000)
    }
    await stop(id)
    throw ServerError("The local server did not answer on port \(port) within \(Int(startTimeout))s.")
  }

  /// Stop one managed server, and everything in its process group.
  public func stop(_ id: String) async {
    if let pid = adopted.removeValue(forKey: id) {
      await killGroup(pid)
      return
    }
    guard let managed = children.removeValue(forKey: id) else { return }
    await killGroup(managed.pid)
  }

  public func stopAll() async {
    let ids = Array(children.keys) + Array(adopted.keys)
    for id in ids { await stop(id) }
  }
}

/// The port was already served by something this shell does not own.
public struct AlreadyServed: Error, Sendable {
  public let id: String
  public let url: String
}

func isAlive(_ pid: Int32) -> Bool {
  // `kill(pid, 0)` answers ESRCH once the process is gone, which is the only
  // portable-enough liveness check that does not need a waitpid handle.
  kill(pid, 0) == 0
}

/**
 Signal the process GROUP, not just the pid.

 The pid a record names is not necessarily a group leader, so `kill(-pid)` can
 answer ESRCH while the server keeps running (measured with the TypeScript shell:
 the group was the CLI's, and signalling the bare pid left the server alive). The
 group is read with `getpgid`, which is the group the spawn created.
 */
func killGroup(_ pid: Int32) async {
  let group = getpgid(pid)
  let target = group > 0 ? -group : -pid
  kill(target, SIGTERM)
  for _ in 0..<40 {
    if !isAlive(pid) { return }
    try? await Task.sleep(nanoseconds: 50_000_000)
  }
  kill(target, SIGKILL)
}

struct Launch {
  let program: String
  let args: [String]
  let cwd: String?
  /// True when `program` is the `kabmo` CLI rather than the server entry.
  let isCLI: Bool
}

/**
 How to start a local server on this machine.

 Three shapes, in the order that keeps the app self-contained first:

 1. the **bundled** server inside the app (`Contents/Resources/server/kabmo`);
 2. `kabmo` on `PATH`, which is the CLI a user already has;
 3. `bun` plus a source checkout's CLI, for development.
 */
func resolveLaunch() throws -> Launch {
  let env = ProcessInfo.processInfo.environment
  if let resources = Bundle.main.resourceURL {
    let bundled = resources.appendingPathComponent("server/kabmo").path
    if FileManager.default.isExecutableFile(atPath: bundled) {
      return Launch(program: bundled, args: [], cwd: resources.path, isCLI: false)
    }
  }
  if let cli = which("kabmo") {
    return Launch(program: cli, args: ["serve"], cwd: nil, isCLI: true)
  }
  if let bun = which("bun") {
    let local = FileManager.default.currentDirectoryPath + "/src/cli/kabmo.js"
    if FileManager.default.fileExists(atPath: local) {
      return Launch(program: bun, args: [local, "serve"], cwd: FileManager.default.currentDirectoryPath, isCLI: true)
    }
  }
  _ = env
  throw ServerError(
    "No Kabmo server to start. Install the CLI (`bun add -g @kabmo-labs/kabmo`) or connect to a remote server."
  )
}

func which(_ name: String) -> String? {
  let path = ProcessInfo.processInfo.environment["PATH"] ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
  for dir in path.split(separator: ":") {
    let candidate = "\(dir)/\(name)"
    if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
  }
  // A GUI-launched app inherits a minimal PATH; the usual install locations are
  // probed explicitly for the same reason the server's own omp lookup does.
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  for dir in ["\(home)/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
    let candidate = "\(dir)/\(name)"
    if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
  }
  return nil
}

/**
 Spawn a child as its own process-group leader, with stdout/stderr going to
 `log`.

 `posix_spawn` rather than `Process`: `Process` gives no way to set the child's
 process group, and without that Stop cannot signal the group — the PTY shells and
 plugin children the server starts would be orphaned on every quit.
 */
func spawnGroupLeader(program: String, args: [String], cwd: String?, log: FileHandle) throws -> Int32 {
  // Darwin declares these as pointers, so the Swift spelling is an Optional
  // initialized to nil and passed by reference — `T()` does not exist for them.
  var fileActions: posix_spawn_file_actions_t?
  posix_spawn_file_actions_init(&fileActions)
  defer { posix_spawn_file_actions_destroy(&fileActions) }

  // The child's stdin is /dev/null: a server that inherited the terminal would
  // block on a read nobody can answer.
  posix_spawn_file_actions_addopen(&fileActions, 0, "/dev/null", O_RDONLY, 0)
  posix_spawn_file_actions_adddup2(&fileActions, log.fileDescriptor, 1)
  posix_spawn_file_actions_adddup2(&fileActions, log.fileDescriptor, 2)
  if let cwd {
    posix_spawn_file_actions_addchdir_np(&fileActions, cwd)
  }

  var attributes: posix_spawnattr_t?
  posix_spawnattr_init(&attributes)
  defer { posix_spawnattr_destroy(&attributes) }
  // Own process group (0 = the child's pid), and a clean signal mask so Ctrl-C in
  // a terminal does not take the server down with the shell that started it.
  posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_SETSIGDEF))
  posix_spawnattr_setpgroup(&attributes, 0)

  let argv: [UnsafeMutablePointer<CChar>?] = ([program] + args).map { strdup($0) } + [nil]
  defer { for pointer in argv where pointer != nil { free(pointer) } }

  var pid: pid_t = 0
  let result = posix_spawn(&pid, program, &fileActions, &attributes, argv, environ)
  guard result == 0 else {
    throw ServerError("Could not start the local server (errno \(result)).")
  }
  return pid
}
