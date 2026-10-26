/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The server list's rules: what the panel offers, and what it may stop.
 *
 * No AppKit, no Foundation networking, no process spawning — every side effect
 * arrives through `ServerDeps`, so the decisions are testable on their own. That
 * split is not tidiness: each rule below is a way the panel could LIE, and none
 * of them throws in the app. A row that offers Stop for a process the shell did
 * not start looks exactly like a row that offers it for one it did.
 */

import Foundation

public enum ServerKind: String, Codable, Sendable {
  case remote
  case managed
}

/// One server the shell remembers.
public struct StoredServer: Codable, Sendable, Equatable {
  public var id: String
  public var label: String
  public var url: String
  public var kind: ServerKind
  public var port: Int?

  public init(id: String, label: String, url: String, kind: ServerKind, port: Int? = nil) {
    self.id = id
    self.label = label
    self.url = url
    self.kind = kind
    self.port = port
  }
}

/// A server as the panel draws it.
public struct ServerEntry: Codable, Sendable, Equatable {
  public var id: String
  public var label: String
  public var url: String
  public var kind: ServerKind
  public var port: Int?
  public var running: Bool
  /// This shell started it, as opposed to a server found on the machine.
  public var owned: Bool
  public var version: String?
  public var mode: String?
  public var pid: Int32?
  public var startedAt: String?
  /// `stored` for the list, `record` for a local instance found on disk.
  public var source: String

  public init(
    id: String, label: String, url: String, kind: ServerKind, port: Int? = nil,
    running: Bool, owned: Bool, version: String? = nil, mode: String? = nil,
    pid: Int32? = nil, startedAt: String? = nil, source: String
  ) {
    self.id = id
    self.label = label
    self.url = url
    self.kind = kind
    self.port = port
    self.running = running
    self.owned = owned
    self.version = version
    self.mode = mode
    self.pid = pid
    self.startedAt = startedAt
    self.source = source
  }
}

public struct ServersState: Codable, Sendable, Equatable {
  public var entries: [ServerEntry]
  /// Local instances this shell did NOT start — a `kabmo serve`, a dev server.
  public var detected: [ServerEntry]
  public var activeId: String?
  public var activeUrl: String?

  public init(entries: [ServerEntry], detected: [ServerEntry], activeId: String? = nil, activeUrl: String? = nil) {
    self.entries = entries
    self.detected = detected
    self.activeId = activeId
    self.activeUrl = activeUrl
  }
}

/// What is persisted between launches.
public struct PersistedState: Codable, Sendable, Equatable {
  public var entries: [StoredServer]
  public var activeId: String?
  /**
   * `local:<port>` → the pid THIS shell spawned.

   The record of an adoption. A shell that is force-quit leaves its children
   running, and the next launch must be able to stop them — but it must NOT take
   over a server the user started in a terminal. Only a pid written here is ours,
   so this map is the whole difference between "an orphan of mine" and "not mine".
   */
  public var spawned: [String: Int32]

  /**
   The palette the console last reported, as a wire.

   Stored beside the server list because it belongs to this shell's own state, and
   read on the FIRST frame: the splash is drawn before any page exists, so this is
   the only colour available at launch. Optional and defaulted, so a
   `servers.json` written by an older build still decodes.
   */
  public var palette: String?

  public init(
    entries: [StoredServer] = [],
    activeId: String? = nil,
    spawned: [String: Int32] = [:],
    palette: String? = nil
  ) {
    self.entries = entries
    self.activeId = activeId
    self.spawned = spawned
    self.palette = palette
  }
}

public struct Health: Sendable, Equatable {
  public var version: String?
  public var mode: String?
  public var pid: Int32?
  public var startedAt: String?

  public init(version: String? = nil, mode: String? = nil, pid: Int32? = nil, startedAt: String? = nil) {
    self.version = version
    self.mode = mode
    self.pid = pid
    self.startedAt = startedAt
  }
}

/// The side effects, injected.
public protocol ServerDeps: Sendable {
  func probe(_ url: String) async -> Health?
  func detect() async -> [ServerEntry]
  /// Start a local server; `pid` is nil when the port was already served.
  func start(port: Int) async throws -> (id: String, url: String, pid: Int32?)
  func stop(_ id: String) async
}

public struct ServerError: Error, LocalizedError, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/**
 * `http(s)://host[:port]` — no path, no credentials, no query.

 A base path is REFUSED rather than dropped: the client is same-origin relative,
 so a page served from `https://host/kabmo/` would ask `/api/...` at the domain
 root and fail every request after loading successfully. The Android shell
 refuses it for the same reason.
 */
public func normaliseUrl(_ raw: String) throws -> String {
  let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else { throw ServerError("Enter a server address.") }

  let withScheme = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
  let scheme: String
  if withScheme.hasPrefix("https://") { scheme = "https" }
  else if withScheme.hasPrefix("http://") { scheme = "http" }
  else { throw ServerError("Only http:// and https:// addresses are supported.") }

  let rest = String(withScheme.dropFirst(scheme.count + 3))
  let slash = rest.firstIndex(of: "/")
  let authority = slash.map { String(rest[rest.startIndex..<$0]) } ?? rest
  let path = slash.map { String(rest[$0...]) } ?? ""

  guard !authority.isEmpty else { throw ServerError("That address is not a host and port.") }
  guard !authority.contains("@"), !authority.contains("?"), !authority.contains("#") else {
    throw ServerError("That address is not a host and port.")
  }
  if !path.isEmpty && path != "/" {
    throw ServerError("Use the server's root address — a base path is not supported.")
  }
  return "\(scheme)://\(authority)"
}

public func serverId(kind: ServerKind, value: String) -> String {
  kind == .remote ? "remote:\(value)" : "local:\(value)"
}

public func serverId(kind: ServerKind, port: Int) -> String {
  kind == .remote ? "remote:\(port)" : "local:\(port)"
}

/// The server list, its selection, and the actions the panel performs.
public actor ServerStore {
  private let deps: ServerDeps
  private let load: @Sendable () -> PersistedState?
  private let save: @Sendable (PersistedState) -> Void
  private var state: PersistedState

  public init(
    deps: ServerDeps,
    load: @escaping @Sendable () -> PersistedState?,
    save: @escaping @Sendable (PersistedState) -> Void
  ) {
    self.deps = deps
    self.load = load
    self.save = save
    self.state = load() ?? PersistedState()
  }

  private func persist() {
    save(state)
  }

  /// The ids this shell spawned, for the boot-time adoption pass.
  public func spawnedPids() -> [String: Int32] { state.spawned }

  /// The palette the console last reported, or the shipped one.
  ///
  /// Read at launch, before any page exists — which is why it is persisted rather
  /// than asked for. A wire this build cannot parse is the shipped palette, never
  /// a partial one.
  public func palette() -> ShellPalette {
    ShellPalette.parse(state.palette) ?? .shipped
  }

  /// Remember the console's palette for the next launch.
  ///
  /// An unreadable wire is not written: keeping the previous palette is the only
  /// answer that cannot repaint the shell with a colour no theme chose.
  public func setPalette(_ wire: String?) {
    guard let next = ShellPalette.parse(wire), next.wire != state.palette else { return }
    state.palette = next.wire
    persist()
  }

  /// Every answering server, the detected ones, and the selection.
  public func snapshot() async -> ServersState {
    var entries: [ServerEntry] = []
    for stored in state.entries {
      let health = await deps.probe(stored.url)
      entries.append(ServerEntry(
        id: stored.id, label: stored.label, url: stored.url, kind: stored.kind,
        port: stored.port, running: health != nil, owned: state.spawned[stored.id] != nil,
        version: health?.version, mode: health?.mode, pid: health?.pid,
        startedAt: health?.startedAt, source: "stored"
      ))
    }
    let detected = await deps.detect().filter { found in
      !state.entries.contains { $0.id == found.id }
    }
    let active = state.entries.first { $0.id == state.activeId }
    return ServersState(entries: entries, detected: detected, activeId: state.activeId, activeUrl: active?.url)
  }

  public func addRemote(label: String, url: String) throws {
    let normalised = try normaliseUrl(url)
    guard !state.entries.contains(where: { $0.url == normalised }) else {
      throw ServerError("\(normalised) is already in the list.")
    }
    let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
    state.entries.append(StoredServer(
      id: serverId(kind: .remote, value: normalised),
      label: trimmed.isEmpty ? normalised.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "") : trimmed,
      url: normalised, kind: .remote
    ))
    persist()
  }

  public func remove(_ id: String) throws {
    let before = state.entries.count
    state.entries.removeAll { $0.id == id }
    guard state.entries.count != before else { throw ServerError("That server is not in the list.") }
    state.spawned[id] = nil
    if state.activeId == id { state.activeId = nil }
    persist()
  }

  /**
   The URL to load for `id`, refusing one that cannot answer.

   An id that is not in the stored list is looked up among the instances found on
   this machine and ADOPTED into the list: it was never the shell's to remember,
   but connecting to it is an explicit choice worth keeping.
   */
  public func activate(_ id: String) async throws -> String {
    if !state.entries.contains(where: { $0.id == id }) {
      guard let found = await deps.detect().first(where: { $0.id == id }) else {
        throw ServerError("That server is not in the list.")
      }
      state.entries.append(StoredServer(
        id: found.id, label: found.label, url: found.url, kind: .managed, port: found.port
      ))
    }
    guard let entry = state.entries.first(where: { $0.id == id }) else {
      throw ServerError("That server is not in the list.")
    }

    if await deps.probe(entry.url) != nil {
      state.activeId = id
      persist()
      return entry.url
    }
    // "Switch to my local server" when it is down means start it. A REMOTE
    // server that is down is refused: there is nothing this shell could start.
    if entry.kind == .managed, let port = entry.port {
      let started = try await start(port: port, label: entry.label)
      return started.url
    }
    throw ServerError("\(entry.label) is not answering. Start it first.")
  }

  /// Start a local server as this shell's child and select it.
  public func start(port: Int, label: String? = nil) async throws -> (id: String, url: String) {
    let started = try await deps.start(port: port)
    if let index = state.entries.firstIndex(where: { $0.id == started.id }) {
      state.entries[index].url = started.url
      state.entries[index].port = port
      if let label { state.entries[index].label = label }
    } else {
      state.entries.append(StoredServer(
        id: started.id, label: label ?? "Local :\(port)", url: started.url, kind: .managed, port: port
      ))
    }
    // Only a pid this shell spawned is recorded, so a later launch adopts exactly
    // its own orphans and never a server the user started by hand.
    state.spawned[started.id] = started.pid
    state.activeId = started.id
    persist()
    return (started.id, started.url)
  }

  public func stop(_ id: String) async {
    await deps.stop(id)
    state.spawned[id] = nil
    persist()
  }

  /**
   Adopt the servers a PREVIOUS run of this shell spawned and left running.

   The force-quit case: the window died without stopping its children, so they
   still answer. The pids come from this shell's own persisted list, never from
   discovery — a hand-started server answers on a port and appears in the same
   records, and taking it over would offer a Stop for a process somebody else is
   watching.
   */
  public func orphanedPids() async -> [String: Int32] {
    let detected = await deps.detect()
    var found: [String: Int32] = [:]
    for (id, pid) in state.spawned where detected.contains(where: { $0.id == id }) {
      found[id] = pid
    }
    return found
  }
}
