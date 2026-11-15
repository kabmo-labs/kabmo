// @license
// SPDX-License-Identifier: MIT

//! Where a download lands, pinned without a display.
//!
//! WebKitGTK cancels a transfer with no destination, so these rules are the
//! difference between "the button saved the file" and "the button did nothing".
//! Every failure here is silent: a name containing `/` writes outside Downloads,
//! an unconditional overwrite destroys a file the user already had, and both look
//! like a successful download.

use std::path::PathBuf;

use kabmo_desktop::downloads::{is_attachment, safe_name, unique_path};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("downloads — the name");

    r.check(
        "a server name is kept",
        safe_name("kabmo-pairing-qr.png") == "kabmo-pairing-qr.png",
    );
    r.check(
        "a path cannot escape the directory",
        safe_name("../../.ssh/authorized_keys") == "authorized_keys",
    );
    r.check("an empty name falls back", safe_name("") == "download");
    r.check("a control character is dropped", !safe_name("a\u{7}b.png").contains('\u{7}'));

    r.group("downloads — the destination");

    let directory = PathBuf::from("/home/user/Downloads");
    let exists = |taken: Vec<&'static str>| {
        move |path: &std::path::Path| {
            taken
                .iter()
                .any(|name| path.file_name().map(|file| file == *name).unwrap_or(false))
        }
    };

    r.check(
        "an unused name is kept",
        unique_path(&directory, "qr.png", exists(vec![])) == directory.join("qr.png"),
    );
    r.check(
        "a taken name is numbered, never replaced",
        unique_path(&directory, "qr.png", exists(vec!["qr.png"])) == directory.join("qr 2.png"),
    );
    r.check(
        "the numbering keeps counting",
        unique_path(&directory, "qr.png", exists(vec!["qr.png", "qr 2.png"]))
            == directory.join("qr 3.png"),
    );
    r.check(
        "a name without an extension still numbers",
        unique_path(&directory, "qr", exists(vec!["qr"])) == directory.join("qr 2"),
    );

    r.group("downloads — the disposition");

    r.check(
        "an attachment is a download",
        is_attachment(Some("attachment; filename=\"kabmo-pairing-qr.png\"")),
    );
    r.check("an inline file is a page", !is_attachment(Some("inline; filename=\"preview.png\"")));
    r.check("no header is a page", !is_attachment(None));
    // The comparison is on the DISPOSITION TYPE: a filename may contain the word.
    r.check(
        "the word inside a filename is not the disposition",
        !is_attachment(Some("inline; filename=\"attachment-notes.txt\"")),
    );
}
