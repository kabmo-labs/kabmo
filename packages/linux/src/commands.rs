/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
use kabmo_desktop::store::{ServerStore, ShellError};
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
    current_url: &Rc<RefCell<String>>,
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
            let url = store.borrow_mut().activate(&id)?;
            *current_url.borrow_mut() = url.clone();
            Ok(with_navigate(state(store), &url))
        }

        "servers_start" => {
            let port = int_param(params, "port").unwrap_or_else(free_port);
            let label = params
                .get("label")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            let (_, url) = store.borrow_mut().start(port, label.as_deref())?;
            *current_url.borrow_mut() = url.clone();
            Ok(with_navigate(state(store), &url))
        }

        "servers_stop" => {
            let id = text_param(params, "id");
            store.borrow_mut().stop(&id);
            Ok(state(store))
        }

        other => Err(ShellError::new(format!("Unknown shell command: {other}"))),
    }
}
