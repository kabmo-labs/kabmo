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

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, Receiver};

use crate::store::ShellError;
use crate::system::which;

/// The chimes, baked into the binary.
///
/// The Linux shell ships as a bare executable (a tarball, an AppImage, a `.deb`
/// with one binary in it), so there is no reliable place to install a data file
/// that every packaging form keeps. The files are the SAME ones the other shells
/// read from `packages/notification-sound/`; a few tens of KB of mono is cheaper
/// than a fifth copy of the assets that a packager has to remember.
///
/// Two of them, because the console has two cues: a finished run, and an agent
/// blocked on you. One sound for both would erase the distinction the console
/// deliberately draws.
const SOUND: &[u8] = include_bytes!("../../notification-sound/kabmo_notification.wav");
const ATTENTION_SOUND: &[u8] = include_bytes!("../../notification-sound/kabmo_attention.wav");

/// The file names the daemon is pointed at. Shared with the other shells so the
/// sounds are recognisable in a system's sound settings.
const SOUND_NAME: &str = "kabmo_notification.wav";
const ATTENTION_SOUND_NAME: &str = "kabmo_attention.wav";

/// `notify-send`'s argument vector for one notification.
///
/// `sound` is the freedesktop `sound-file` hint: the daemon plays that file
/// instead of its own event sound. Passing it is what makes the banner carry the
/// Kabmo chime — the console stops playing its Web Audio cue inside a shell.
pub fn args(title: &str, body: &str, sound: Option<&Path>) -> Vec<String> {
    let summary = if title.trim().is_empty() {
        crate::APP_NAME
    } else {
        title.trim()
    };
    let mut arguments = vec![
        // The daemon shows these as the notification's application identity and
        // icon; without them every banner says "notify-send" and draws a generic
        // icon.
        format!("--app-name={}", crate::APP_NAME),
        "--icon=kabmo".to_string(),
    ];
    if let Some(sound) = sound {
        arguments.push(format!("--hint=string:sound-file:{}", sound.display()));
    }
    arguments.extend([
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
    ]);
    arguments
}

/// Where the embedded chime for `kind` is written for the daemon to read, or None.
///
/// Rewritten only when its bytes differ, so a daemon started before an upgrade
/// cannot keep playing the previous version of the file. `XDG_RUNTIME_DIR` is
/// the user's own runtime directory; the temp dir is the fallback for a session
/// that has none.
fn sound_file(kind: &str) -> Option<PathBuf> {
    let (name, bytes) = if kind == "ask" {
        (ATTENTION_SOUND_NAME, ATTENTION_SOUND)
    } else {
        (SOUND_NAME, SOUND)
    };
    let directory = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let path = directory.join(name);
    if std::fs::read(&path).ok().as_deref() == Some(bytes) {
        return Some(path);
    }
    match std::fs::write(&path, bytes) {
        Ok(()) => Some(path),
        Err(error) => {
            // The banner still posts, with the desktop's own sound: a read-only
            // runtime dir must not cost the notification itself.
            eprintln!(
                "[kabmo] notification sound: could not write {}: {error}",
                path.display()
            );
            None
        }
    }
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
pub fn start(
    title: &str,
    body: &str,
    session_id: &str,
    kind: &str,
) -> Result<Receiver<String>, ShellError> {
    if which("notify-send").is_none() {
        return Err(ShellError::new(
            "notify-send is not installed; no desktop notification was sent.",
        ));
    }
    let (sender, receiver) = mpsc::channel();
    let title = title.to_string();
    let body = body.to_string();
    let session = session_id.to_string();
    // Resolved here, not inside the worker: the file has to exist before
    // `notify-send` is handed the hint, and the write is small enough that
    // deferring it buys nothing.
    let sound = sound_file(kind);
    std::thread::spawn(move || {
        let Ok(output) = Command::new("notify-send")
            .args(args(&title, &body, sound.as_deref()))
            .output()
        else {
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
