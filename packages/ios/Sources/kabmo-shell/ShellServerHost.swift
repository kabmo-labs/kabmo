#if canImport(UIKit)
import Foundation
import WebKit
import KabmoShell

/// The transport between the console's page and this shell.
///
/// Four commands — `servers_state`, `servers_add`, `servers_remove`,
/// `servers_activate` — the same four the desktop shells answer, minus the ones a
/// phone cannot: there is no child process to start, so `servers_start` and
/// `servers_stop` do not exist here and the console learns that from
/// `startable: false` in the state rather than from a user agent.
///
/// ## Why a message handler and not an injected `__kabmoCall`
///
/// The macOS shell injects its own transport at document start and this shell
/// does not, so the page adapts `window.webkit.messageHandlers.kabmo` into the
/// `__kabmoCall` shape it already speaks
/// (`src/client/lib/shell/bridge.ts`). Params therefore cross as a
/// form-encoded string, which the page builds and this file decodes; the answer
/// is JSON TEXT, and `window.__kabmoReply(id, ok, payload)` settles the page's
/// promise.
///
/// ## Threads
///
/// WebKit calls the handler on the main thread. `servers_state` PROBES every
/// stored server (`GET /api/health`, 6 s each), so the work runs in a Task and
/// the reply is evaluated back on the main actor. `evaluateJavaScript` must run
/// there.
final class ShellServerHost: NSObject, WKScriptMessageHandler {

  static let handlerName = "kabmo"

  private let settings: ShellSettings
  private weak var webView: WKWebView?

  /// Load a server the user just picked. The controller owns the cookie jar and
  /// the loading overlay, so the navigation is its decision.
  var onActivate: ((String) -> Void)?

  init(settings: ShellSettings) {
    self.settings = settings
  }

  /// Bind the view a reply is evaluated in. Called once, right after creation.
  func attach(_ webView: WKWebView) {
    self.webView = webView
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    // Main frame only, and only this handler: an iframe in a plugin's preview is
    // the page's own content, not a shell command channel.
    guard
      message.name == Self.handlerName,
      message.frameInfo.isMainFrame,
      let body = message.body as? [String: Any],
      let id = body["id"] as? Int,
      let method = body["method"] as? String
    else { return }

    let params = Self.decode(body["params"] as? String ?? "")
    Task { [weak self] in
      await self?.handle(id: id, method: method, params: params)
    }
  }

  private func handle(id: Int, method: String, params: [String: String]) async {
    switch method {
    case "servers_state":
      await answerState(id)
    case "servers_add":
      await add(id, params: params)
    case "servers_remove":
      await remove(id, params: params)
    case "servers_activate":
      await activate(id, params: params)
    default:
      // A page asking for a command this shell does not have is NOT a crash: it
      // is a refusal the console shows, which is how a newer console degrades on
      // an older build.
      reply(id, ok: false, payload: ServerWire.jsString("This shell does not support \(method)."))
    }
  }

  private func answerState(_ id: Int) async {
    let list = settings.servers
    reply(id, ok: true, payload: await ServerWire.state(list))
  }

  private func add(_ id: Int, params: [String: String]) async {
    switch URLNormalizer.normalize(params["url"] ?? "") {
    case let .error(problem):
      reply(id, ok: false, payload: ServerWire.jsString(SettingsCopy.message(for: problem)))
    case let .ok(url):
      settings.write(servers: settings.servers.withRemembered(url: url, label: params["label"]))
      await answerState(id)
    }
  }

  private func remove(_ id: Int, params: [String: String]) async {
    let url = params["id"] ?? ""
    settings.write(servers: settings.servers.without(url: url))
    await answerState(id)
  }

  private func activate(_ id: Int, params: [String: String]) async {
    let url = params["id"] ?? ""
    let next = settings.servers.withActive(url: url)
    guard next.activeURL == url else {
      reply(id, ok: false, payload: ServerWire.jsString("That server is not in the list."))
      return
    }
    settings.write(servers: next)
    // The page goes away on navigation, so the state is answered FIRST —
    // otherwise the console's promise never settles and the panel spins.
    await answerState(id)
    await MainActor.run { self.onActivate?(url) }
  }

  /// Evaluate one reply in the page.
  private func reply(_ id: Int, ok: Bool, payload: String) {
    let script = ServerWire.replyScript(id: id, ok: ok, payload: payload)
    Task { @MainActor [weak self] in
      self?.webView?.evaluateJavaScript(script, completionHandler: nil)
    }
  }

  /// `label=NAS&url=http%3A%2F%2Fa%3A3000` → the map.
  static func decode(_ form: String) -> [String: String] {
    guard !form.isEmpty else { return [:] }
    var fields: [String: String] = [:]
    for pair in form.split(separator: "&") {
      let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      let key = String(parts.first ?? "").removingPercentEncoding ?? String(parts.first ?? "")
      let value = parts.count > 1
        ? (String(parts[1]).removingPercentEncoding ?? String(parts[1]))
        : ""
      fields[key] = value
    }
    return fields
  }
}

private extension ServerWire {
  /// The state, with every stored server probed.
  ///
  /// `running: false` is the shell's own answer to a probe that did not come back
  /// as Kabmo — never a guess — which is what stops a click from landing on a
  /// blank window.
  static func state(_ list: ServerList) async -> String {
    var entries: [ServerWire.Entry] = []
    for stored in list.entries {
      let health = await HealthProbe.check(baseURL: stored.url)
      entries.append(
        ServerWire.Entry(
          label: stored.label,
          url: stored.url,
          running: health.ok,
          version: health.version,
          mode: health.mode,
          pid: health.pid,
          startedAt: health.startedAt
        )
      )
    }
    return ServerWire.state(entries: entries, activeURL: list.activeURL)
  }
}
#endif
