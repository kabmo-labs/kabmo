/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The files the desktop environment handed to this app.
//
// A double-click in Nautilus/Files, "Open With → Kabmo" on a `.docx`, a
// multi-selection, a drop of three PDFs on the launcher: every one of them
// arrives as a PATH, and the page never sees it on its own. There is no browser
// API for a launch (Chromium's `launchQueue` does not exist in WebKitGTK), so the
// shell collects the paths and hands them to the page.
//
// Two channels, because the two moments differ:
//
// - a COLD start puts them on argv, before the window exists;
// - a WARM app is a second activation (`GApplication`'s `open` signal), which is
//   what a file manager sends to an already-running instance.
//
// Nothing here opens a tab: the page owns the tabs and the workspace scope. See
// `src/client/lib/native/open-paths.ts` for the other half.

use std::path::Path;

/// Paths the OS handed over that the page has not taken yet.
///
/// A plain struct rather than a global: the shell owns one, the GTK callbacks
/// borrow it, and the rules below are pure so the suite can drive them with no
/// display.
#[derive(Default)]
pub struct OpenPathQueue {
    pending: Vec<String>,
}

impl OpenPathQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add paths, dropping duplicates and anything blank.
    ///
    /// A duplicate is real: a second activation for a file already queued is a
    /// file the user opened once, and two tabs for one document is the bug this
    /// prevents.
    pub fn add(&mut self, paths: &[String]) {
        for path in paths {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                continue;
            }
            if self.pending.iter().any(|entry| entry == trimmed) {
                continue;
            }
            self.pending.push(trimmed.to_string());
        }
    }

    /// Everything waiting, and empty the queue.
    ///
    /// Taking is what makes a delivery once-only: the page asks on every load
    /// finish, and a value left behind would be reopened on the next navigation —
    /// a reload would reopen the file the user closed.
    pub fn take(&mut self) -> Vec<String> {
        std::mem::take(&mut self.pending)
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    pub fn len(&self) -> usize {
        self.pending.len()
    }
}

/// The file paths in a launch's argv.
///
/// Three rules, each of which is how a launch is lost:
///
/// - the executable itself is argument 0;
/// - a `-flag` / `--flag` is not a path (a launcher may pass either);
/// - a `file://` URL is accepted, because a file manager can hand one over, and a
///   relative argument is refused — the process's cwd is not where the file is.
///
/// A path that does not exist is dropped: the page would answer "that file no
/// longer exists" for a document deleted between the click and the launch, and a
/// silent drop is the honest outcome.
pub fn launch_paths(arguments: &[String]) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for argument in arguments.iter().skip(1) {
        if argument.starts_with('-') {
            continue;
        }
        let candidate = if let Some(rest) = argument.strip_prefix("file://") {
            // `file:///home/u/a.pdf` → `/home/u/a.pdf`; a percent-encoded path is
            // left as-is rather than mis-decoded, since a wrong decode names a
            // different file and a literal one at least fails to open.
            match rest.strip_prefix("localhost") {
                Some(tail) => tail.to_string(),
                None => rest.to_string(),
            }
        } else if argument.starts_with('/') {
            argument.clone()
        } else {
            continue;
        };
        if !Path::new(&candidate).exists() {
            continue;
        }
        if paths.iter().any(|entry| entry == &candidate) {
            continue;
        }
        paths.push(candidate);
    }
    paths
}

/// The JavaScript that hands `paths` to the page.
///
/// Built by the JSON encoder rather than by string concatenation: a path may
/// contain a quote, a backslash or a newline, and `serde_json` is what makes the
/// argument a value instead of source.
pub fn open_paths_script(paths: &[String]) -> String {
    let json = serde_json::to_string(paths).unwrap_or_else(|_| "[]".to_string());
    format!("window.__kabmoOpenPaths ? window.__kabmoOpenPaths({json}) : null")
}
