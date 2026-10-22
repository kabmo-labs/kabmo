/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The launch overlay: when a progress number may move, and what finishes a load.

use kabmo_desktop::splash::{Phase, Progress};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("splash progress");
    let mut progress = Progress::default();
    r.check(
        "the bar starts indeterminate",
        progress.fraction.is_none() && progress.label().contains("Loading the console"),
    );
    progress = progress.advance(0.0);
    r.check("a 0% tick says nothing", progress.fraction.is_none());
    progress = progress.advance(0.4);
    r.check("real progress is shown", progress.label().contains("40%"));
    // A redirect reports 100 then 10; a bar that snapped back reads as a stall.
    progress = progress.advance(1.0).advance(0.1);
    r.check(
        "progress never moves backwards within a load",
        progress.fraction == Some(1.0),
    );
    r.check("100% is not a finish", progress.phase == Phase::Loading);
    progress = progress.finish();
    r.check(
        "only the load's own end finishes the splash",
        progress.phase == Phase::Finished,
    );
    let failed = Progress::default().advance(0.5).fail();
    r.check(
        "a failure keeps the reason on screen",
        failed.phase == Phase::Failed && failed.label().contains("Could not load"),
    );
}
