/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The launch overlay: when a progress number may move, and what finishes a load.

use kabmo_desktop::splash::{sentence_for, Failure, Phase, Progress};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("splash progress");
    let mut progress = Progress::connecting();
    r.check(
        "the bar starts indeterminate",
        progress.fraction.is_none() && progress.indeterminate(),
    );
    r.check(
        "the sentence says it is connecting",
        progress.label() == "Connecting to the server…",
    );
    progress = progress.advance(0.0);
    r.check("a 0% tick says nothing", progress.fraction.is_none());
    progress = progress.advance(0.4);
    r.check("real progress is shown", progress.label().contains("40%"));
    r.check("a real tick makes the bar determinate", !progress.indeterminate());
    // A redirect reports 100 then 10; a bar that snapped back reads as a stall.
    progress = progress.advance(1.0).advance(0.1);
    r.check(
        "progress never moves backwards within a load",
        progress.fraction == Some(1.0),
    );
    r.check("100% is not a finish", progress.phase == Phase::Loading);
    // A non-finite report is not progress; `f64::NAN` would poison every later
    // comparison and leave the bar frozen at whatever it last drew.
    r.check(
        "a non-finite report is ignored",
        progress.advance(f64::NAN).fraction == Some(1.0),
    );

    progress = progress.finish();
    r.check(
        "only the load's own end finishes the splash",
        progress.phase == Phase::Finished,
    );
    r.check("a finished splash draws nothing", !progress.visible());
    r.check(
        "a tick after the end is ignored",
        progress.advance(0.5).phase == Phase::Finished,
    );

    // A failed main-frame load still reports `Finished` for the error page the
    // engine renders; adopting that would hide the explanation behind a blank
    // window.
    let failed = Progress::connecting().advance(0.5).failed_because(Failure::Connect);
    r.check(
        "a failure keeps the reason on screen",
        failed.phase == Phase::Failed && failed.visible(),
    );
    r.check(
        "the failure names what to check",
        failed.label() == sentence_for(Failure::Connect),
    );
    r.check(
        "finishing does not overwrite a failure",
        failed.finish().phase == Phase::Failed,
    );
    r.check(
        "a tick after a failure is ignored",
        failed.advance(0.9).phase == Phase::Failed,
    );
    r.check(
        "each reason has its own sentence",
        [
            sentence_for(Failure::HostLookup),
            sentence_for(Failure::Connect),
            sentence_for(Failure::Timeout),
            sentence_for(Failure::Ssl),
            sentence_for(Failure::Other),
        ]
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len()
            == 5,
    );

    r.group("splash reload detection");
    r.check(
        "a reload is the same address on a finished page",
        Progress::is_document_reload(
            Some("http://127.0.0.1:3000/"),
            Some("http://127.0.0.1:3000/"),
            Phase::Finished,
        ),
    );
    r.check(
        "a navigation to another address is not a reload",
        !Progress::is_document_reload(
            Some("http://127.0.0.1:3000/settings"),
            Some("http://127.0.0.1:3000/"),
            Phase::Finished,
        ),
    );
    // The cold start's own `Started` arrives while the view still shows the
    // previous document; treating it as a reload would restart the arm just made.
    r.check(
        "a load that has not finished is never a reload",
        !Progress::is_document_reload(
            Some("http://127.0.0.1:3000/"),
            Some("http://127.0.0.1:3000/"),
            Phase::Connecting,
        ),
    );
    r.check(
        "a missing address is not a reload",
        !Progress::is_document_reload(None, None, Phase::Finished),
    );
}
