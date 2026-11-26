/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// The web process's memory-pressure policy.
//
// Every case is a way the shell could believe it had configured the engine when
// it had not: WebKit refuses an inverted or non-positive threshold inside the
// engine — a `g_warning` and no change — so a policy that is merely "passed
// along" leaves the defaults in place and the shell reports nothing.

use kabmo_desktop::memory::PressurePolicy;

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("memory pressure");

    r.check("the conservative profile is ordered", PressurePolicy::CONSERVATIVE.is_ordered());
    r.check(
        "an ordered policy hands the engine its numbers",
        PressurePolicy::CONSERVATIVE.engine_values() == Some((0.5, 0.75, 5.0, 60.0)),
    );
    r.check(
        "an inverted pair is refused",
        !PressurePolicy {
            conservative_threshold: 0.9,
            strict_threshold: 0.5,
            ..PressurePolicy::CONSERVATIVE
        }
        .is_ordered(),
    );
    // WebKit requires conservative < strict; equal values leave no band in which
    // to release anything.
    r.check(
        "equal thresholds are refused",
        !PressurePolicy {
            strict_threshold: 0.5,
            ..PressurePolicy::CONSERVATIVE
        }
        .is_ordered(),
    );
    r.check(
        "a zero threshold is refused",
        !PressurePolicy {
            conservative_threshold: 0.0,
            ..PressurePolicy::CONSERVATIVE
        }
        .is_ordered(),
    );
    r.check(
        "a threshold above one is refused",
        !PressurePolicy {
            strict_threshold: 1.5,
            ..PressurePolicy::CONSERVATIVE
        }
        .is_ordered(),
    );
    r.check(
        "a non-positive poll interval is refused",
        !PressurePolicy {
            poll_interval: 0.0,
            ..PressurePolicy::CONSERVATIVE
        }
        .is_ordered(),
    );
    r.check(
        "an unusable policy hands the engine nothing",
        PressurePolicy {
            conservative_threshold: 0.9,
            ..PressurePolicy::CONSERVATIVE
        }
        .engine_values()
        .is_none(),
    );
}
