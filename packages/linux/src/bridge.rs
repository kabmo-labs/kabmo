/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The page ↔ shell bridge, over WebKitGTK's script message channel.
 *
 * The page posts `{ id, method, params }` with
 * `window.webkit.messageHandlers.kabmo.postMessage(...)`, and the shell answers
 * by evaluating `window.__kabmoReply(id, ok, payload)`. That is the SAME
 * contract the macOS shell installs over `WKScriptMessageHandler` and the
 * Windows shell over `chrome.webview`, so `src/client/lib/desktop/bridge.ts` and
 * everything above it cannot tell which shell it is talking to — which is the
 * point of the client being shared.
 *
 * The identity script runs at document start, before the page's own scripts, for
 * two reasons: `__kabmoReply` has to exist when the first command answers, and
 * `__kabmoDesktop` carries the shell's identity so the navbar draws its server
 * control on the FIRST paint rather than flashing it in after a round trip.
 *
 * ## Why the drag region is decided in JavaScript here
 *
 * macOS evaluates a selector synchronously inside `NSWindow.sendEvent`, because
 * AppKit gives the window every event before a subview claims it. GTK does the
 * same (`connect_button_press_event` fires before the webview delivers the
 * press — measured), but `run_javascript` is ASYNCHRONOUS: the answer arrives
 * after the button state has moved on, and a press that never moved would
 * still start a move-drag, swallowing the click and the double-click.
 *
 * So the page decides, from a press it already receives, and posts three
 * intents: `window_drag` once the pointer has actually moved, `window_toggle`
 * for a double-click, and `window_menu` for a right-click. `-webkit-app-region`
 * is not an option on WebKitGTK: it is a Chromium property and this engine
 * ignores it entirely.
 */

use serde::Serialize;

/// What the shell reports about itself, once, before the page asks anything.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    pub platform: String,
    pub shell_version: String,
    pub overlay_titlebar: bool,
    /**
     * True: this window is undecorated and draws no controls of its own, so the
     * page draws minimise / maximise / close (`WindowControls`).
     *
     * macOS keeps its traffic lights over a full-size content view and reports
     * false. GTK could overlay native buttons — a `GtkOverlay` child does receive
     * clicks over a webview, measured — but then every shell would have its own
     * chrome for the same three verbs, and the page's set already exists and is
     * tested.
     */
    pub window_controls: bool,
}

impl Default for DesktopInfo {
    fn default() -> Self {
        Self {
            platform: "linux".into(),
            // From `version.properties` through `build.rs`, never the crate's
            // own version: the crate is never published, and two numbers for one
            // build is the drift the properties file exists to prevent.
            shell_version: env!("KABMO_SHELL_VERSION").into(),
            overlay_titlebar: true,
            window_controls: true,
        }
    }
}

/// The identity as JSON, for the `desktop_info` command.
///
/// The SAME struct the bootstrap script serialises, so the command's fallback
/// answer and the injected identity cannot disagree — a hand-written object here
/// is how a shell ends up reporting `windowControls: false` to a page that had
/// already drawn the buttons.
pub fn desktop_info_value() -> serde_json::Value {
    serde_json::to_value(DesktopInfo::default()).unwrap_or(serde_json::Value::Null)
}

/**
 * The interactive elements a press must NOT move the window for.
 *
 * Stated once, interpolated into the bootstrap script, so the rule cannot drift
 * between the page and anything the shell does. The list mirrors the macOS
 * shell's `dragRegionSelector`: a walk up from the hit element stops at anything
 * the user can press, so a new button in the header is inert by construction
 * rather than by remembering to mark it.
 */
pub const DRAG_BLOCK_SELECTOR: &str = concat!(
    "button,a,input,select,textarea,label,summary,",
    "[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],",
    "[role=radio],[role=switch],[role=option],[contenteditable=true],[data-no-drag]"
);

/// How far the pointer must travel before a press becomes a window drag.
///
/// Below this a press is a click, and a click on the header must still reach the
/// page: the timeline's own controls sit in that strip, and a drag that started
/// on every press would make them unclickable.
pub const DRAG_THRESHOLD_PX: f64 = 4.0;

/// The user script installed before the page's own scripts.
pub fn bootstrap_script(info: &DesktopInfo) -> String {
    let json = serde_json::to_string(info).unwrap_or_else(|_| "{}".into());
    let block = DRAG_BLOCK_SELECTOR;
    let threshold = DRAG_THRESHOLD_PX;

    format!(
        r#"(() => {{
  window.__kabmoDesktop = {json};
  const pending = new Map();
  let next = 1;

  window.__kabmoReply = (id, ok, payload) => {{
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (ok) entry.resolve(payload);
    else entry.reject(new Error(typeof payload === 'string' ? payload : 'The shell refused that command.'));
  }};

  window.__kabmoCall = (method, params) => new Promise((resolve, reject) => {{
    const id = next++;
    // A command that spawns a server waits for its health endpoint (up to 45s),
    // so the budget is generous: a timeout there would report a running server
    // as failed.
    const timer = setTimeout(() => {{
      pending.delete(id);
      reject(new Error(`The shell did not answer ${{method}} within 60s.`));
    }}, 60000);
    pending.set(id, {{ resolve, reject, timer }});
    window.webkit.messageHandlers.kabmo.postMessage({{ id, method, params: params || {{}} }});
  }});

  // ---------------------------------------------------------------- title bar

  const BLOCK = '{block}';
  const post = (method, params) => window.webkit.messageHandlers.kabmo.postMessage({{ id: 0, method, params: params || {{}} }});

  const onBar = (target) => {{
    if (!target || !target.closest) return false;
    const region = target.closest('[data-drag-region]');
    if (!region) return false;
    const blocked = target.closest(BLOCK);
    return !(blocked && region.contains(blocked));
  }};

  let press = null;

  document.addEventListener('mousedown', (event) => {{
    if (event.button !== 0 || !onBar(event.target)) return;
    press = {{ x: event.screenX, y: event.screenY }};
  }}, true);

  document.addEventListener('mousemove', (event) => {{
    if (!press) return;
    if (Math.abs(event.screenX - press.x) + Math.abs(event.screenY - press.y) < {threshold}) return;
    press = null;
    post('window_drag');
  }}, true);

  document.addEventListener('mouseup', () => {{ press = null; }}, true);

  // The first click of a double-click has already been released, so this is the
  // only place the gesture can be recognised — and it must never also start a
  // drag, which is why a drag needs movement.
  document.addEventListener('dblclick', (event) => {{
    if (!onBar(event.target)) return;
    post('window_toggle');
  }}, true);

  document.addEventListener('contextmenu', (event) => {{
    if (!onBar(event.target)) return;
    event.preventDefault();
    post('window_menu');
  }}, true);
}})();"#
    )
}

/// One message from the page, as the shell reads it.
#[derive(Debug, Clone, PartialEq)]
pub struct ShellCall {
    pub id: u64,
    pub method: String,
    pub params: serde_json::Value,
}

/// Parse a posted message. `None` means "not a call" — the chrome intents carry
/// id 0 and are routed by method name instead.
pub fn parse_call(value: &serde_json::Value) -> Option<ShellCall> {
    let method = value.get("method")?.as_str()?.to_string();
    let id = value
        .get("id")
        .and_then(|id| id.as_u64())
        .unwrap_or(0);
    let params = value
        .get("params")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    Some(ShellCall { id, method, params })
}

/// The script that answers one call.
pub fn reply_script(id: u64, ok: bool, payload: &serde_json::Value) -> String {
    format!(
        "window.__kabmoReply({id}, {}, {});",
        if ok { "true" } else { "false" },
        payload
    )
}

/// A string parameter, or `""` — the same coercion the other two shells use, so
/// a missing field reads as an empty value rather than a refusal.
pub fn text_param(params: &serde_json::Value, name: &str) -> String {
    params
        .get(name)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string()
}

pub fn int_param(params: &serde_json::Value, name: &str) -> Option<u16> {
    params
        .get(name)
        .and_then(|value| value.as_u64())
        .and_then(|value| u16::try_from(value).ok())
}
