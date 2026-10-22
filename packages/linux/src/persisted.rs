/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where the shell's own list lives, and how it is read and written.
 *
 * Beside the app's config, NEVER inside the data directory: `~/.kabmo` is shared
 * with the CLI and holds the database, the auth hash and the run records, and a
 * shell that wrote its own bookkeeping there would make `kabmo status` and this
 * app disagree about which files belong to whom.
 *
 * `$XDG_CONFIG_HOME/Kabmo/servers.json`, else `~/.config/Kabmo/` — the same
 * two-step the rest of the Linux desktop follows, and the same directory NAME the
 * macOS shell settled on. It was `kabmo-desktop` there, the SwiftPM target's name,
 * which meant a user looking for their settings found a folder no product ever
 * mentioned; a shell that is new here should not repeat that. `$HOME` is read from
 * the password database rather than the environment, because a process started
 * without a shell (a `.desktop` launcher, a systemd unit) has no `HOME` and an
 * empty value would silently move the list to a cwd-relative path.
 */

use std::path::PathBuf;

use crate::store::PersistedState;

const APP_DIR: &str = "Kabmo";
const STATE_FILE: &str = "servers.json";

/// `$HOME`, resolved the way `os.homedir()` does — never from the environment.
pub fn home_directory() -> PathBuf {
    // SAFETY: `getpwuid_r` writes into the buffer we own and returns the same
    // pointer; nothing is retained past this function.
    unsafe {
        let mut buffer = vec![0_i8; 4096];
        let mut passwd: libc::passwd = std::mem::zeroed();
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        let uid = libc::getuid();
        if libc::getpwuid_r(
            uid,
            &mut passwd,
            buffer.as_mut_ptr() as *mut libc::c_char,
            buffer.len(),
            &mut result,
        ) == 0
            && !result.is_null()
            && !passwd.pw_dir.is_null()
        {
            let dir = std::ffi::CStr::from_ptr(passwd.pw_dir);
            if let Ok(text) = dir.to_str() {
                if !text.is_empty() {
                    return PathBuf::from(text);
                }
            }
        }
    }
    // A container can answer nothing at all; `/` is still better than a
    // cwd-relative path, which would put the list inside whatever directory the
    // launcher happened to use.
    PathBuf::from("/")
}

/// `$XDG_CONFIG_HOME`, else `~/.config`.
pub fn config_home() -> PathBuf {
    match std::env::var("XDG_CONFIG_HOME") {
        Ok(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => home_directory().join(".config"),
    }
}

pub fn state_file_path() -> PathBuf {
    config_home().join(APP_DIR).join(STATE_FILE)
}

pub fn read_state() -> Option<PersistedState> {
    let path = state_file_path();
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write the list, best-effort: a read-only config directory must not take the
/// window down, it just forgets the last selection.
pub fn write_state(state: &PersistedState) {
    let path = state_file_path();
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(text) = serde_json::to_string_pretty(state) else {
        return;
    };
    // A sibling temp file plus a rename, so a crash mid-write cannot leave a
    // truncated list that reads as "no servers".
    let temp = parent.join(format!("{STATE_FILE}.{}.tmp", std::process::id()));
    if std::fs::write(&temp, text).is_err() {
        return;
    }
    if std::fs::rename(&temp, &path).is_err() {
        let _ = std::fs::remove_file(&temp);
    }
}
