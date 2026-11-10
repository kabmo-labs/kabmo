/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// The argument vector a notification is posted with, and the script its click
// runs.
//
// `notify-send` treats an argument beginning with `-` as an option, refuses a
// notification with an empty summary, and without `--wait` exits before anyone
// can click the action. Every one of those is silent in the app — the banner
// simply never appears, or the click does nothing — so the shapes are pinned.

use kabmo_desktop::notification::{args, open_session_script};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("notification");
    let ordinary = args("Build", "The run finished.");
    r.check(
        "the application identity is stated",
        ordinary.iter().any(|arg| arg == "--app-name=Kabmo"),
    );
    r.check(
        "the icon is stated too, so the banner is not generic",
        ordinary.iter().any(|arg| arg == "--icon=kabmo"),
    );
    r.check(
        "the process waits so a click can be read",
        ordinary.iter().any(|arg| arg == "--wait"),
    );
    r.check(
        "the banner offers an Open action",
        ordinary.iter().any(|arg| arg == "--action=default=Open"),
    );
    r.check(
        "options are terminated before the text",
        ordinary.iter().any(|arg| arg == "--"),
    );
    r.check(
        "the summary and body travel as the last two arguments",
        ordinary.get(ordinary.len() - 2).map(String::as_str) == Some("Build")
            && ordinary.last().map(String::as_str) == Some("The run finished."),
    );

    let untitled = args("   ", "body");
    r.check(
        "an empty title still has a summary",
        untitled.get(untitled.len() - 2).map(String::as_str) == Some("Kabmo"),
    );

    let flagged = args("  --help  ", "body");
    r.check(
        "a title is trimmed and cannot be mistaken for a flag",
        flagged.get(flagged.len() - 2).map(String::as_str) == Some("--help")
            && flagged
                .iter()
                .position(|arg| arg == "--")
                .map(|at| at + 1 < flagged.len() - 1)
                .unwrap_or(false),
    );

    r.check(
        "the click script calls the page's opener",
        open_session_script("abc-123")
            == "window.__kabmoOpenSession && window.__kabmoOpenSession(\"abc-123\")",
    );
    r.check(
        "a quote in the session id is escaped, not interpolated",
        open_session_script("a\"b\nc").contains("a\\\"b\\nc"),
    );
}
