import Foundation

/// One server the shell remembers.
public struct StoredServer: Codable, Equatable, Sendable {
  public var label: String
  public var url: String

  public init(label: String, url: String) {
    self.label = label
    self.url = url
  }
}

/// The servers this shell knows, and which one it is on.
///
/// The shell stored exactly ONE address (`ShellSettings.urlKey`) until the
/// console grew a server control, which is the same control the desktop shells
/// draw over the same four commands. A phone that talks to a laptop at home and
/// a desktop at the office had to retype an address every time it moved; this is
/// the list behind that control.
///
/// The rules live here rather than in the view controller for the same reason
/// every other rule does: they are testable without a window server, and each
/// one is a way the panel could LIE. A second row for the same origin can never
/// disagree with the first, and an address lost on upgrade is the one failure
/// this type must not have.
public struct ServerList: Codable, Equatable, Sendable {
  public var entries: [StoredServer]
  public var activeURL: String?

  public init(entries: [StoredServer] = [], activeURL: String? = nil) {
    self.entries = entries
    self.activeURL = activeURL
  }

  /// The entry the window is on, or the first one when the active address is gone.
  public func active() -> StoredServer? {
    entries.first { $0.url == activeURL } ?? entries.first
  }

  /// The label to draw for `url` — the stored one, else the address itself.
  public func label(for url: String) -> String {
    entries.first { $0.url == url }?.label ?? ServerList.label(of: url)
  }

  /// Remember `url` and make it the active server.
  ///
  /// Remembering an address that is already in the list is not an error: the user
  /// is saying which server to open, and a second row for the same origin would
  /// be two rows that can never disagree about anything.
  public func withRemembered(url: String, label: String? = nil) -> ServerList {
    let clean = label?.trimmingCharacters(in: .whitespacesAndNewlines)
    let name = (clean?.isEmpty == false) ? clean : nil
    var next = self
    if let index = next.entries.firstIndex(where: { $0.url == url }) {
      if let name { next.entries[index].label = name }
    } else {
      next.entries.append(StoredServer(label: name ?? ServerList.label(of: url), url: url))
    }
    next.activeURL = url
    return next
  }

  /// Drop `url`. Removing the active row falls back to the first one left.
  public func without(url: String) -> ServerList {
    var next = self
    next.entries.removeAll { $0.url == url }
    if next.activeURL == url {
      next.activeURL = next.entries.first?.url
    }
    return next
  }

  /// Point the window at `url`, keeping the list order unchanged.
  public func withActive(url: String) -> ServerList {
    guard entries.contains(where: { $0.url == url }) else { return self }
    var next = self
    next.activeURL = url
    return next
  }

  // MARK: - Storage

  /// The stored form.
  ///
  /// JSON, unlike the Android twin's line wire: `JSONEncoder` is Foundation and
  /// runs in this package's test target, so there is nothing a library would make
  /// untestable here. `ServerWire` (the reply to the page) is JSON for the same
  /// reason and for the page's own parser.
  public var wire: String {
    guard let data = try? ServerWire.encode(self) else { return "" }
    return String(data: data, encoding: .utf8) ?? ""
  }

  /// Read the stored form; an unreadable wire is an empty list, never a crash.
  public static func parse(_ wire: String?) -> ServerList {
    guard let wire, let data = wire.data(using: .utf8) else { return ServerList() }
    return (try? JSONDecoder().decode(ServerList.self, from: data)) ?? ServerList()
  }

  /// A list holding the address an older build saved, or an empty list.
  public static func migrated(legacyURL: String?) -> ServerList {
    guard let url = legacyURL?.trimmingCharacters(in: .whitespacesAndNewlines), !url.isEmpty else {
      return ServerList()
    }
    return ServerList(entries: [StoredServer(label: label(of: url), url: url)], activeURL: url)
  }

  /// `http://192.168.1.20:3000` → `192.168.1.20:3000`.
  public static func label(of url: String) -> String {
    var text = url
    if text.hasPrefix("https://") { text.removeFirst("https://".count) }
    else if text.hasPrefix("http://") { text.removeFirst("http://".count) }
    while text.hasSuffix("/") { text.removeLast() }
    return text
  }
}

/// The `servers_state` answer, and the words a refusal travels in.
///
/// A phone answers what it can and omits what it cannot: `detected` is always
/// empty (those are servers found from per-port records on the desktop's own
/// machine) and `startable` is always `false` (no child process to own). Both are
/// facts the console acts on, never guesses it makes from a user agent.
public enum ServerWire {

  /// One probed row.
  public struct Entry: Sendable {
    public var label: String
    public var url: String
    public var running: Bool
    public var version: String?
    public var mode: String?
    public var pid: Int?
    public var startedAt: String?

    public init(
      label: String,
      url: String,
      running: Bool,
      version: String? = nil,
      mode: String? = nil,
      pid: Int? = nil,
      startedAt: String? = nil
    ) {
      self.label = label
      self.url = url
      self.running = running
      self.version = version
      self.mode = mode
      self.pid = pid
      self.startedAt = startedAt
    }
  }

  private struct WireServer: Encodable {
    var id: String
    var label: String
    var url: String
    var kind: String
    var running: Bool
    var owned: Bool
    var source: String
    var version: String?
    var mode: String?
    var pid: Int?
    var startedAt: String?
  }

  private struct WireState: Encodable {
    var entries: [WireServer]
    var detected: [WireServer]
    var activeId: String?
    var activeUrl: String?
    var startable: Bool
  }

  /// The whole state.
  ///
  /// `activeId` is the active URL as well: a phone's rows are identified by their
  /// origin, and a second id would be a second thing that can disagree with the
  /// stored address.
  public static func state(entries: [Entry], activeURL: String?) -> String {
    let active = activeURL ?? entries.first?.url
    let state = WireState(
      entries: entries.map {
        // `remote` is the only kind a phone can have: nothing here is spawned by
        // this shell, so nothing is `owned` and nothing may be stopped.
        WireServer(
          id: $0.url, label: $0.label, url: $0.url, kind: "remote",
          running: $0.running, owned: false, source: "stored",
          version: $0.version, mode: $0.mode, pid: $0.pid, startedAt: $0.startedAt
        )
      },
      detected: [],
      activeId: active,
      activeUrl: active,
      startable: false
    )
    guard let data = try? encode(state) else { return "{}" }
    return String(data: data, encoding: .utf8) ?? "{}"
  }

  /// One encoder, one shape.
  ///
  /// `.withoutEscapingSlashes` is not cosmetic: Foundation escapes every `/` as
  /// `\/` by default, so every URL in the state would travel escaped and the
  /// Android twin's plain text would be a second spelling of the same wire.
  static func encode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    return try encoder.encode(value)
  }

  /// A JS string literal for `value`, so a reply can be evaluated as a script.
  public static func jsString(_ value: String) -> String {
    guard let data = try? encode(value) else { return "\"\"" }
    return String(data: data, encoding: .utf8) ?? "\"\""
  }

  /// The script that settles one command. `payload` is already JSON.
  public static func replyScript(id: Int, ok: Bool, payload: String) -> String {
    "window.__kabmoReply && window.__kabmoReply(\(id), \(ok), \(payload));"
  }
}
