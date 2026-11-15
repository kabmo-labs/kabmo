// @license
// SPDX-License-Identifier: MIT

//! Where a downloaded file goes, and the name it is saved under.
//!
//! The Linux shell handled no downloads: WebKitGTK asks `WebKitDownload` for a
//! destination through `decide_destination`, and with no handler the transfer is
//! CANCELLED. A link that saved a file in a browser therefore did nothing here,
//! which is the same symptom the pairing dialog's Download control had in every
//! shell before this existed.
//!
//! The rules live here, with no `WebKitDownload` in sight, so the suite can pin
//! them without a display: every one of them is a way a file is lost, overwritten
//! or written outside the user's Downloads directory.

use std::path::{Path, PathBuf};

/// The Downloads directory, per the XDG user directories (`~/.config/user-dirs.dirs`).
///
/// `glib::user_special_dir` is the same lookup a file chooser uses, so the shell
/// and the rest of the desktop agree about where a saved file went. Falling back
/// to `$HOME` rather than inventing a path under `/tmp`: a download the user
/// cannot find is indistinguishable from a download that failed.
pub fn directory() -> Option<PathBuf> {
    gtk::glib::user_special_dir(gtk::glib::UserDirectory::Downloads)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Downloads")))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

/// A name safe to use as ONE path component.
///
/// The suggestion comes from the server's `Content-Disposition`, so a name with
/// `/` or `..` in it would escape the directory it is joined to.
pub fn safe_name(suggested: &str) -> String {
    let last = suggested.rsplit('/').next().unwrap_or("");
    let cleaned: String = last
        .replace("..", "")
        .chars()
        .filter(|c| !c.is_control())
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

/// `name.png` → `name 2.png` when `name.png` is taken.
///
/// A duplicate is never overwritten: the existing file may be the user's own,
/// and replacing it silently is data loss that looks like a successful download.
pub fn unique_path(directory: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let candidate = directory.join(name);
    if !exists(&candidate) {
        return candidate;
    }

    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string());
    let extension = path.extension().map(|value| value.to_string_lossy().into_owned());

    let mut index = 2;
    loop {
        let numbered = match &extension {
            Some(extension) => format!("{stem} {index}.{extension}"),
            None => format!("{stem} {index}"),
        };
        let next = directory.join(numbered);
        if !exists(&next) {
            return next;
        }
        index += 1;
    }
}

/// Whether a `Content-Disposition` marks the response as a file to save.
///
/// The DISPOSITION TYPE is compared, not the header text: a filename may contain
/// the word (`inline; filename="attachment-notes.txt"`), and treating that as an
/// attachment would save a page the user asked to open.
pub fn is_attachment(content_disposition: Option<&str>) -> bool {
    let Some(header) = content_disposition else {
        return false;
    };
    let kind = header.split(';').next().unwrap_or("").trim();
    kind.eq_ignore_ascii_case("attachment")
}
