/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell's own test runner.
 *
 * A plain executable, not a `#[test]` harness behind a feature, for the same
 * reason the macOS shell's suites are executables: the rules below must run on a
 * machine with no display and no `omp` install, and `cargo test` would compile the
 * whole GTK stack's test surface to check functions that never touch it.
 *
 * Every case is a way the panel could LIE, because none of them throws in the
 * app: a row that offers Stop for a process the shell did not start looks exactly
 * like a row that offers it for one it did.
 *
 * Split by domain, the way the app is: a case group that needs a window manager
 * is the one thing this suite cannot have, so what it checks is the arithmetic
 * those calls are handed.
 */

mod bridge;
mod splash;
mod store;
mod support;
mod system;
mod url;
mod window;
mod wordmark;

use support::Runner;

fn main() {
    let mut r = Runner::new();
    url::cases(&mut r);
    store::cases(&mut r);
    bridge::cases(&mut r);
    splash::cases(&mut r);
    wordmark::cases(&mut r);
    window::cases(&mut r);
    system::cases(&mut r);

    println!("\n{}/{} checks passed", r.checks - r.failures, r.checks);
    std::process::exit(if r.failures == 0 { 0 } else { 1 });
}

