/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Side effects: the health probe, a spawned child's ownership, and where the
// shell keeps its own files.

use kabmo_desktop::system::{probe_health, Supervisor};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("probeHealth");
    let port = kabmo_desktop::system::free_port();
    r.check("freePort returns a bindable port", port > 0);
    r.check(
        "a closed port answers nil",
        probe_health(&format!("http://127.0.0.1:{port}")).is_none(),
    );

    r.group("Supervisor");
    let supervisor = Supervisor::new();
    r.check("a fresh supervisor owns nothing", !supervisor.owns("local:3001"));
    supervisor.adopt("local:3001", 999_999);
    r.check("an adopted pid is owned", supervisor.owns("local:3001"));
    // A pid that does not exist must not be signalled into a panic, and Stop must
    // still forget it.
    supervisor.stop("local:3001");
    r.check("stopping an adopted pid releases it", !supervisor.owns("local:3001"));

    // The real path, only when a CLI is installed: a machine without one must
    // still run every other case.
    r.group("Supervisor (real spawn)");
    match kabmo_desktop::system::which("kabmo") {
        Some(cli) => {
            let port = kabmo_desktop::system::free_port();
            let supervisor = Supervisor::new();
            let started = supervisor.spawn(port);
            match started {
                Ok(managed) => {
                    r.check("a real local server spawns", managed.pid > 0);
                    // The wait is a separate step now — it is what the shell runs
                    // on a worker thread while the window stays responsive.
                    r.check(
                        "the wait reports the spawned server ready, and it answers",
                        kabmo_desktop::system::wait_until_ready(&managed.url, managed.pid, port)
                            .is_ok()
                            && probe_health(&managed.url).is_some(),
                    );
                    r.check("the supervisor owns it", supervisor.owns(&managed.id));
                    supervisor.stop(&managed.id);
                    r.check(
                        "it is released after stop",
                        !supervisor.owns(&managed.id),
                    );
                    let mut closed = false;
                    for _ in 0..100 {
                        if probe_health(&managed.url).is_none() {
                            closed = true;
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    r.check("the port is free again after stop", closed);
                }
                Err(failure) => {
                    println!("  note: start failed: {}", failure.message());
                    r.check("a real local server spawns", false);
                }
            }
            let _ = cli;
        }
        None => println!("  note: no kabmo CLI on PATH — the spawn case is skipped"),
    }

    r.group("state file");
    let path = kabmo_desktop::persisted::state_file_path();
    r.check(
        "the shell's list lives outside the data directory",
        !path.to_string_lossy().contains("/.kabmo/"),
    );
    r.check(
        "the list is a JSON file under the config home, named for the app",
        path.to_string_lossy().ends_with("Kabmo/servers.json"),
    );
}
