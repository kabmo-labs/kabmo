/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// The files the desktop environment hands the shell, and the two rules that keep
// a launch from being lost or opened twice.
//
// None of these throws in the app when it is wrong: the file simply never
// appears, or appears twice, and the user has no way to tell which happened.

use std::fs;

use kabmo_desktop::open_paths::{launch_paths, open_paths_script, OpenPathQueue};

use crate::support::Runner;

/// A real file, so `launch_paths` can accept it.
fn fixture(name: &str) -> String {
    let dir = std::env::temp_dir().join(format!(
        "kabmo-openpaths-{}-{}",
        std::process::id(),
        name
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    let file = dir.join(name);
    fs::write(&file, b"x").expect("fixture file");
    file.to_string_lossy().to_string()
}

pub fn cases(r: &mut Runner) {
    r.group("launch_paths");

    let pdf = fixture("report.pdf");
    let docx = fixture("notes.docx");
    let exe = "/usr/bin/Kabmo".to_string();

    r.check(
        "argv's own executable is not a path",
        launch_paths(&[exe.clone()]).is_empty(),
    );
    r.check(
        "a document argument is a path",
        launch_paths(&[exe.clone(), pdf.clone()]) == vec![pdf.clone()],
    );
    r.check(
        "two documents both survive",
        launch_paths(&[exe.clone(), pdf.clone(), docx.clone()]) == vec![pdf.clone(), docx.clone()],
    );
    // `%F` in a desktop entry expands to the files; a launcher may also pass its
    // own flags, and neither is a path.
    r.check(
        "a flag is skipped",
        launch_paths(&[exe.clone(), "--new-window".into(), pdf.clone()]) == vec![pdf.clone()],
    );
    r.check(
        "a relative argument is not a path",
        launch_paths(&[exe.clone(), "report.pdf".into()]).is_empty(),
    );
    r.check(
        "a missing file is dropped",
        launch_paths(&[exe.clone(), "/tmp/kabmo-missing-does-not-exist.pdf".into()]).is_empty(),
    );
    r.check(
        "a file:// URL is accepted",
        launch_paths(&[exe.clone(), format!("file://{pdf}")]) == vec![pdf.clone()],
    );
    r.check(
        "a duplicate argument opens once",
        launch_paths(&[exe, pdf.clone(), pdf.clone()]) == vec![pdf.clone()],
    );

    r.group("OpenPathQueue");

    let mut queue = OpenPathQueue::new();
    r.check("a fresh queue is empty", queue.is_empty() && queue.len() == 0);
    queue.add(&["/a.pdf".to_string(), "/b.pdf".to_string()]);
    r.check("add keeps the order", queue.len() == 2);
    queue.add(&["/a.pdf".to_string()]);
    r.check("add de-duplicates", queue.len() == 2);
    r.check(
        "take answers everything in order",
        queue.take() == vec!["/a.pdf".to_string(), "/b.pdf".to_string()],
    );
    // The rule that makes a reload safe: a taken batch is gone, so a second
    // finished load cannot reopen what the user closed.
    r.check("take empties the queue", queue.is_empty() && queue.take().is_empty());
    queue.add(&["   ".to_string(), String::new()]);
    r.check("blank paths are dropped", queue.is_empty());

    r.group("open_paths_script");

    let script = open_paths_script(&["/a.pdf".to_string()]);
    r.check("a plain path is a JSON array", script.contains("[\"/a.pdf\"]"));
    r.check("the call is guarded", script.contains("window.__kabmoOpenPaths ?"));
    // A quote in a filename is ordinary, and hand-built concatenation is how one
    // of them breaks the call into two statements.
    let tricky = "/tmp/quote\"and\\backslash.pdf".to_string();
    let escaped = open_paths_script(&[tricky]);
    r.check(
        "a quote is escaped, not interpolated",
        escaped.contains("quote\\\"and\\\\backslash"),
    );
}
