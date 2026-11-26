/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// The bridge's wire shapes, and the identity the page reads before it asks.

use kabmo_desktop::bridge::{
    bootstrap_script, desktop_info_value, int_param, parse_call, reply_script, text_param,
    DesktopInfo, DRAG_BLOCK_SELECTOR,
};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("bridge");
    let info = DesktopInfo::default();
    let script = bootstrap_script(&info);
    r.check("the identity is injected before the page runs", script.contains("__kabmoDesktop"));
    // The reported version comes from `version.properties` through `build.rs`, not
    // from the crate's own version: a shell whose number the pipeline bumps and a
    // binary that reports something else is two answers for one build.
    r.check(
        "the reported version is the packaged one",
        info.shell_version == env!("KABMO_SHELL_VERSION") && !info.shell_version.trim().is_empty(),
    );
    r.check(
        "the identity says the page draws the window controls",
        script.contains("\"windowControls\":true"),
    );
    // The `desktop_info` fallback is the SAME struct, so every field it answers
    // must be one the injected identity already carries.
    let answered = desktop_info_value();
    let keys = answered
        .as_object()
        .map(|map| map.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    r.check(
        "the desktop_info answer is the injected identity, field for field",
        !keys.is_empty() && keys.iter().all(|key| script.contains(key)),
    );
    r.check(
        "the desktop_info answer names this platform",
        answered.get("platform").and_then(|value| value.as_str()) == Some("linux"),
    );
    r.check(
        "the transport is installed before the page runs",
        script.contains("__kabmoCall") && script.contains("__kabmoReply"),
    );
    r.check(
        "the interactive-element list is interpolated from one constant",
        script.contains(DRAG_BLOCK_SELECTOR),
    );
    // The drag must need MOVEMENT: a press that never moves is a click, and a
    // click on the header has to reach the page's own controls.
    r.check(
        "a drag needs movement before it is reported",
        script.contains("window_drag") && script.contains("< 4"),
    );
    r.check(
        "a double-click reports the toggle, never a drag",
        script.contains("window_toggle"),
    );

    let call = parse_call(&serde_json::json!({
        "id": 7, "method": "servers_state", "params": {"label": "NAS"}
    }))
    .expect("a call parses");
    r.check("a call carries its id and method", call.id == 7 && call.method == "servers_state");
    r.check(
        "a string parameter reads back",
        text_param(&call.params, "label") == "NAS",
    );
    r.check(
        "a missing parameter reads as empty, not as a refusal",
        text_param(&call.params, "url").is_empty(),
    );
    r.check(
        "a port parameter reads back",
        int_param(&serde_json::json!({"port": 3007}), "port") == Some(3007),
    );
    r.check(
        "a port outside the range is ignored",
        int_param(&serde_json::json!({"port": 70000}), "port").is_none(),
    );

    let reply = reply_script(7, true, &serde_json::json!({"entries": []}));
    r.check(
        "a reply is one evaluated call, with the payload interpolated once",
        reply.starts_with("window.__kabmoReply(7, true, ")
            && reply.contains("\"entries\"")
            && reply.ends_with(");"),
    );
    let refused = reply_script(3, false, &serde_json::json!("That server is not in the list."));
    r.check("a refusal keeps the shell's own sentence", refused.contains("not in the list"));
}
