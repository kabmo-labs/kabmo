/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The page ↔ shell bridge, over one `WKScriptMessageHandler`.
 *
 * The page posts `{ id, method, params }` to `window.webkit.messageHandlers.kabmo`,
 * and the shell answers by evaluating `window.__kabmoReply(id, ok, payload)`. That
 * is the same shape every desktop shell ends up with, and it is here rather than
 * a framework's because the alternative — a preload that rewrites stylesheets to
 * find drag regions — is what made the previous shell's window unmovable.
 *
 * The handler is installed as a `WKUserContentController` script message handler,
 * which reaches EVERY page the webview loads, whatever server served it. There is
 * no per-origin capability file: the shell owns the webview, so the page cannot
 * be anything but one this window chose to load.
 */

import AppKit
import WebKit

/// What the shell reports about itself, once, before the page asks anything.
struct DesktopInfo: Codable {
  let platform: String
  let shellVersion: String
  /**
   The machine's architecture, in the console's vocabulary (`arm64` / `x64`).

   Every desktop artifact is per-architecture, so without this the console can
   only offer the release page. `arch` is a COMPILE-TIME fact in Swift — there is
   no runtime API for "the slice this binary was built for" — which is also what
   makes it correct for a Rosetta launch: the binary that runs is the one whose
   slice it reported.
   */
  let arch: String
  let overlayTitlebar: Bool
  let trafficLightInset: String
}

/// The bridge's transport, so the app can route a command without a switch in
/// the window controller.
protocol ShellCommandHost: AnyObject {
  func handle(method: String, params: [String: Any]) async throws -> Any?
  func navigate(to url: String)
}

final class BridgeHandler: NSObject, WKScriptMessageHandler {
  private weak var host: ShellCommandHost?

  init(host: ShellCommandHost) {
    self.host = host
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any],
          let id = body["id"] as? Int,
          let method = body["method"] as? String
    else { return }
    let params = (body["params"] as? [String: Any]) ?? [:]
    guard let host else { return }

    Task { @MainActor in
      do {
        let payload = try await host.handle(method: method, params: params)
        Self.reply(in: message.webView, id: id, ok: true, payload: payload)
      } catch {
        let text = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        Self.reply(in: message.webView, id: id, ok: false, payload: text)
      }
    }
  }

  /// One function for both outcomes, so a success and a failure cannot drift.
  ///
  /// The payload is encoded to JSON and interpolated ONCE — never built by string
  /// concatenation from raw values, which is how a server label containing a quote
  /// breaks the call.
  static func reply(in webView: WKWebView?, id: Int, ok: Bool, payload: Any?) {
    let json: String
    if let payload, JSONSerialization.isValidJSONObject(payload),
       let data = try? JSONSerialization.data(withJSONObject: payload),
       let text = String(data: data, encoding: .utf8) {
      json = text
    } else if let text = payload as? String {
      json = encodeString(text)
    } else {
      json = "null"
    }
    let script = "window.__kabmoReply(\(id), \(ok ? "true" : "false"), \(json));"
    DispatchQueue.main.async {
      webView?.evaluateJavaScript(script, completionHandler: nil)
    }
  }

  private static func encodeString(_ value: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [value]),
          let text = String(data: data, encoding: .utf8)
    else { return "\"\"" }
    // `["x"]` → `"x"`.
    return String(text.dropFirst().dropLast())
  }
}

/**
 The user script installed before the page's own scripts.

 Two jobs, both of which must happen before the app's first render:

 - `__kabmoReply` has to exist when the first command answers, or the reply is
   evaluated against `undefined` and the page waits forever.
 - `__kabmoDesktop` carries the shell's identity, so the navbar draws its server
   control on the FIRST paint rather than flashing it in after a round trip.
 */
func bootstrapScript(info: DesktopInfo) -> WKUserScript {
  let json = (try? JSONEncoder().encode(info)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
  let source = """
  (() => {
    window.__kabmoDesktop = \(json);
    const pending = new Map();
    let next = 1;
    window.__kabmoReply = (id, ok, payload) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearTimeout(entry.timer);
      if (ok) entry.resolve(payload);
      else entry.reject(new Error(typeof payload === 'string' ? payload : 'The shell refused that command.'));
    };
    window.__kabmoCall = (method, params) => new Promise((resolve, reject) => {
      const id = next++;
      // A command that spawns a server waits for its health endpoint (up to 45s),
      // so the budget is generous: a timeout there would report a running server
      // as failed.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The shell did not answer ${method} within 60s.`));
      }, 60000);
      pending.set(id, { resolve, reject, timer });
      window.webkit.messageHandlers.kabmo.postMessage({ id, method, params: params || {} });
    });
  })();
  """
  return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
}
