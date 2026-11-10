/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// Desktop notifications, through the freedesktop notification service.
//
// GTK itself has no portal for a one-shot banner that works without a
// `GNotification` app id, and the shell has no such id installed. `notify-send`
// is the standard client for `org.freedesktop.Notifications` and ships with
// every desktop that has a notification daemon, so it is the transport: one
// process, no new dependency, and the same banner every other app posts.
//
// The argument list is a PURE function because it is the part a bug hides in:
// a title passed as a flag would be swallowed or rejected, and an empty summary
// makes `notify-send` refuse the notification outright — both look like "the
// feature does nothing".

use std::process::Command;
use std::sync::mpsc::{self, Receiver};

use crate::store::ShellError;
use crate::system::which;

/// `notify-send`'s argument vector for one notification.
pub fn args(title: &str, body: &str) -> Vec<String> {
    let summary = if title.trim().is_empty() {
        crate::APP_NAME
    } else {
        title.trim()
    };
    vec![
        // The daemon shows these as the notification's application identity and
        // icon; without them every banner says "notify-send" and draws a generic
        // icon.
        format!("--app-name={}", crate::APP_NAME),
        "--icon=kabmo".to_string(),
        // Stay alive until the user clicks or dismisses: without `--wait` the
        // process exits after posting, so there is nobody left to read the
        // `default` action and the click cannot open its session. `--action`
        // gives the banner its own "Open" button, which is what the click runs.
        "--wait".to_string(),
        "--action=default=Open".to_string(),
        // End of options: a session title that begins with `-` must be a SUMMARY,
        // not a flag (`notify-send --help` would print help instead of posting).
        "--".to_string(),
        summary.to_string(),
        body.to_string(),
    ]
}

/// The script a click runs in the page.
///
/// A session id is opaque, and interpolating it raw would let a quote turn into
/// source. `serde_json` already owns the escaping the bridge uses.
pub fn open_session_script(session_id: &str) -> String {
    let quoted = serde_json::to_string(session_id).unwrap_or_else(|_| "\"\"".into());
    format!("window.__kabmoOpenSession && window.__kabmoOpenSession({quoted})")
}

/// Post one notification and start the wait for a click.
///
/// The returned receiver yields the session id once, when the user chooses the
/// banner's "Open" action. The GTK main loop owns the receiver: a worker thread
/// cannot touch the webview, and the caller polls it from the loop.
///
/// A missing helper is a sentence rather than a crash: the bridge turns it into
/// a logged warning, and the in-app badge is still the record.
pub fn start(title: &str, body: &str, session_id: &str) -> Result<Receiver<String>, ShellError> {
    if which("notify-send").is_none() {
        return Err(ShellError::new(
            "notify-send is not installed; no desktop notification was sent.",
        ));
    }
    let (sender, receiver) = mpsc::channel();
    let title = title.to_string();
    let body = body.to_string();
    let session = session_id.to_string();
    std::thread::spawn(move || {
        let Ok(output) = Command::new("notify-send").args(args(&title, &body)).output() else {
            return;
        };
        // `--wait` prints the chosen action's id on stdout, one line. Anything
        // else (a dismissal) prints nothing, and the banner is then just gone.
        let clicked = String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .any(|word| word == "default");
        if clicked {
            let _ = sender.send(session);
        }
    });
    Ok(receiver)
}
