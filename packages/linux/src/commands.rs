/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commands the page may issue, and their answers.
 *
 * A command that changes which server the window is on returns its state WITH
 * `__navigate`, and the caller strips it before answering: the page that asked
 * is about to be replaced, so a plain state reply would describe a server the
 * window is leaving.
 */

use std::cell::RefCell;
use std::rc::Rc;

use gtk::prelude::*;
use serde_json::Value;

use kabmo_desktop::bridge::{desktop_info_value, int_param, text_param};
use kabmo_desktop::store::{port_of, ServerStore, ShellError, StartResult};
use kabmo_desktop::system::{free_port, SystemDeps};

/// The commands the page may issue, and their answers.
///
/// A command that changes which server the window is on returns its state WITH
/// `__navigate`, and the caller strips it before answering: the page that asked
/// is about to be replaced, so a plain state reply would describe a server the
/// window is leaving.
pub fn handle_command(
    method: &str,
    params: &Value,
    window: &gtk::Window,
    store: &Rc<RefCell<ServerStore<SystemDeps>>>,
) -> Result<Value, ShellError> {
    let state = |store: &Rc<RefCell<ServerStore<SystemDeps>>>| {
        serde_json::to_value(store.borrow().snapshot()).unwrap_or(Value::Null)
    };
    let with_navigate = |mut value: Value, url: &str| {
        if let Value::Object(map) = &mut value {
            map.insert("__navigate".into(), Value::String(url.to_string()));
        }
        value
    };
    // A start that must be WAITED for before the page is answered.
    //
    // The wait is `system::wait_until_ready` — up to `START_TIMEOUT` — and this
    // handler runs on the GTK main loop, so the shell runs it on a worker thread
    // (`main.rs`, `start_server`) and answers when it lands. The marker therefore
    // carries what that worker needs (address, pid, port for the log line, and the
    // record to stop if it never answers), and `__navigate` travels WITH it: the
    // window moves only once the server actually answers, so a failed start never
    // shows an error page for a port nothing is listening on.
    let with_await = |mut value: Value, started: &StartResult, port: u16| {
        if let Value::Object(map) = &mut value {
            map.insert(
                "__await".into(),
                serde_json::json!({
                    "id": started.id,
                    "url": started.url,
                    "pid": started.pid,
                    "port": port,
                }),
            );
            map.insert("__navigate".into(), Value::String(started.url.clone()));
        }
        value
    };

    match method {
        // The page draws minimise / maximise / close (`windowControls: true`):
        // this window is undecorated and GTK draws no caption buttons, so these
        // three verbs are the only ones a browser would get from its own chrome.
        "window_minimize" => {
            window.iconify();
            Ok(Value::Null)
        }

        "window_maximize" => {
            if window.is_maximized() {
                window.unmaximize();
            } else {
                window.maximize();
            }
            Ok(Value::Null)
        }

        "window_close" => {
            window.close();
            Ok(Value::Null)
        }

        // The fallback for a page that never saw the injected identity. It is the
        // SAME struct the bootstrap serialises, never a second literal: two
        // spellings of one identity is how the command answers `windowControls:
        // false` for a shell whose first paint already drew the page's buttons.
        "desktop_info" => Ok(desktop_info_value()),

        "servers_state" => Ok(state(store)),

        "servers_add" => {
            store
                .borrow_mut()
                .add_remote(&text_param(params, "label"), &text_param(params, "url"))?;
            Ok(state(store))
        }

        "servers_remove" => {
            let id = text_param(params, "id");
            {
                // The guard is scoped: `state()` borrows the same RefCell, and a
                // read while a write is live panics at run time.
                let mut guard = store.borrow_mut();
                guard.stop(&id);
                guard.remove(&id)?;
            }
            Ok(state(store))
        }

        "servers_activate" => {
            let id = text_param(params, "id");
            let (url, started) = store.borrow_mut().activate(&id)?;
            Ok(match started {
                // Switching to a server that ANSWERED needs no wait.
                None => with_navigate(state(store), &url),
                // It was down and this call started it, so the window must not
                // move until it answers.
                Some(pid) => with_await(
                    state(store),
                    &StartResult {
                        id: id.clone(),
                        url,
                        pid: Some(pid),
                    },
                    port_of(&id).unwrap_or(0),
                ),
            })
        }

        "servers_start" => {
            let port = int_param(params, "port").unwrap_or_else(free_port);
            let label = params
                .get("label")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let started = store.borrow_mut().start(port, label.as_deref())?;
            Ok(with_await(state(store), &started, port))
        }

        "servers_stop" => {
            let id = text_param(params, "id");
            store.borrow_mut().stop(&id);
            Ok(state(store))
        }

        // `update_apply` is NOT here: it downloads, and this handler runs on the
        // GTK main loop. It is answered by `main.rs`'s `start_update`, which puts
        // the blocking half on a thread and delivers the reply through the loop —
        // see the comment there for the window that could not be closed while an
        // update ran.

        other => Err(ShellError::new(format!("Unknown shell command: {other}"))),
    }
}
