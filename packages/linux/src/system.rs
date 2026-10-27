/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two things the shell does to the machine: probe a URL, and own a local
 * server process.
 *
 * Separate from `store.rs`, which holds the RULES. These are the side effects,
 * and they are what a test replaces: a probe is a socket, a start is a child
 * process, and neither belongs inside a test that is checking what the panel
 * decides.
 *
 * The Linux half of the macOS shell's `System.swift`. One thing does not port:
 * macOS signals the group with `kill(-pgid)`, and so does this — the difference
 * is that the spawn must ask for a NEW group explicitly, which is
 * `process_group(0)` here.
 */

use std::collections::BTreeMap;
use std::io::Write;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::persisted::home_directory;
use crate::store::{Deps, Health, ServerEntry, ServerKind, StartResult};

/// How long a freshly spawned local server may take to answer `/api/health`.
pub const START_TIMEOUT: Duration = Duration::from_secs(45);
/// The probe's own budget. One closed port must not stall a refresh.
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/**
 * `~/.kabmo`, or the override, resolved the way `lib/lifecycle/paths.ts` does.
 *
 * The home directory comes from the password database, never `$HOME`: a process
 * started without a shell (a `.desktop` launcher, a systemd unit) has none, and
 * an empty value would silently move the data directory to a cwd-relative path —
 * which is how the app and the CLI would end up with two databases.
 */
pub fn data_directory() -> PathBuf {
    let override_value = ["KABMO_DATA_DIR", "OMPCHAMBER_DATA_DIR"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty());

    match override_value {
        Some(value) if value.starts_with("~/") => home_directory().join(&value[2..]),
        Some(value) => PathBuf::from(value),
        None => home_directory().join(".kabmo"),
    }
}

/**
 * `GET /api/health`, or `None` when nothing answers on that URL.
 *
 * The body's `ok: true` is required, not just a 200: without it any web server
 * on the port would be offered as a console.
 */
pub fn probe_health(url: &str) -> Option<Health> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(PROBE_TIMEOUT)
        .timeout_read(PROBE_TIMEOUT)
        .timeout_write(PROBE_TIMEOUT)
        .build();
    let response = agent
        .get(&format!("{}/api/health", url.trim_end_matches('/')))
        .set("Accept", "application/json")
        .call()
        .ok()?;
    if response.status() != 200 {
        return None;
    }
    // `into_string` + a parse rather than ureq's `json` feature: the shell already
    // depends on serde_json for its own state file, and a second JSON feature
    // would be the same parser compiled twice.
    let text = response.into_string().ok()?;
    let body: serde_json::Value = serde_json::from_str(&text).ok()?;
    if body.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return None;
    }
    Some(Health {
        version: body
            .get("version")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        mode: body
            .get("mode")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        pid: body
            .get("pid")
            .and_then(|value| value.as_i64())
            .map(|value| value as i32),
        started_at: body
            .get("startedAt")
            .and_then(|value| value.as_str())
            .map(str::to_string),
    })
}

/**
 * Every live local instance, read from the records the SERVERS write.
 *
 * `<data>/run/<port>.json` is written by the process that owns the port
 * (`lib/lifecycle/instance.ts`), so `kabmo serve` in a terminal, `bun run dev`
 * and a login entry all appear. A record whose process is gone is skipped, and
 * the health probe is the final word — a record can outlive a crash.
 */
pub fn detect_local_servers() -> Vec<ServerEntry> {
    let run_dir = data_directory().join("run");
    let Ok(entries) = std::fs::read_dir(&run_dir) else {
        return Vec::new();
    };

    let mut found = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(stem) = name.strip_suffix(".json") else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };

        let port = record
            .get("port")
            .and_then(|value| value.as_u64())
            .or_else(|| stem.parse::<u64>().ok())
            .unwrap_or(0);
        if port == 0 || port > u16::MAX as u64 {
            continue;
        }
        let port = port as u16;

        // `0.0.0.0`/`::` are bind-any addresses and cannot be connected to;
        // loopback reaches the same listener.
        let raw_host = record
            .get("host")
            .and_then(|value| value.as_str())
            .unwrap_or("127.0.0.1");
        let host = if ["0.0.0.0", "::", "[::]", ""].contains(&raw_host) {
            "127.0.0.1"
        } else {
            raw_host
        };
        let url = format!("http://{host}:{port}");
        let Some(health) = probe_health(&url) else {
            continue;
        };

        found.push(ServerEntry {
            id: format!("local:{port}"),
            label: format!("Local :{port}"),
            url,
            kind: ServerKind::Managed,
            port: Some(port),
            running: true,
            // A record is never owned: whoever started it still holds it.
            owned: false,
            version: health.version,
            mode: health
                .mode
                .or_else(|| record.get("mode").and_then(|value| value.as_str()).map(str::to_string)),
            pid: health.pid.or_else(|| {
                record
                    .get("pid")
                    .and_then(|value| value.as_i64())
                    .map(|value| value as i32)
            }),
            started_at: health.started_at.or_else(|| {
                record
                    .get("startedAt")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            }),
            source: "record".into(),
        });
    }
    found.sort_by_key(|entry| entry.port.unwrap_or(0));
    found
}

/// A free TCP port on loopback, chosen by binding one and letting it go.
pub fn free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0");
    match listener {
        Ok(listener) => listener.local_addr().map(|addr| addr.port()).unwrap_or(3000),
        Err(_) => 3000,
    }
}

/// A local server this shell owns.
#[derive(Debug, Clone)]
pub struct ManagedServer {
    pub id: String,
    pub url: String,
    pub pid: i32,
}

/// The port was already served by something this shell does not own.
#[derive(Debug, Clone)]
pub struct AlreadyServed {
    pub id: String,
    pub url: String,
}

/**
 * The local servers this shell started, plus the pids it adopted after a restart.
 *
 * A managed server runs in its OWN process group (`process_group(0)`), so Stop
 * signals the group — which takes the PTY shells and plugin children with it
 * instead of orphaning them. That is the same rule the server's own shell spawn
 * follows (`lib/terminal/spawn.ts`), and it is why `Command` is used with the
 * pre-exec hook rather than a plain `spawn`.
 */
pub struct Supervisor {
    inner: Mutex<SupervisorState>,
}

#[derive(Default)]
struct SupervisorState {
    children: BTreeMap<String, (ManagedServer, Child)>,
    adopted: BTreeMap<String, i32>,
}

impl Default for Supervisor {
    fn default() -> Self {
        Self {
            inner: Mutex::new(SupervisorState::default()),
        }
    }
}

impl Supervisor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn owns(&self, id: &str) -> bool {
        let state = self.inner.lock().unwrap();
        state.children.contains_key(id) || state.adopted.contains_key(id)
    }

    pub fn adopt(&self, id: &str, pid: i32) {
        let mut state = self.inner.lock().unwrap();
        if !state.children.contains_key(id) {
            state.adopted.insert(id.to_string(), pid);
        }
    }

    /// Start a local server in its own process group, WITHOUT waiting for it.
    ///
    /// The wait is `wait_until_ready`, and it belongs to the CALLER: the shell
    /// runs this from the GTK main loop, so the health budget below has to happen
    /// on a worker thread or the window freezes for the whole of it — measured on
    /// Start, before the split, where the 45 s budget was charged to the UI.
    pub fn spawn(&self, port: u16) -> Result<ManagedServer, StartFailure> {
        let id = format!("local:{port}");
        let url = format!("http://127.0.0.1:{port}");
        if probe_health(&url).is_some() {
            // Something already serves this port. It is NOT ours to claim: a
            // server the user started in a terminal answers here too, and
            // handing back a pid would make the panel offer Stop for a process
            // this shell never spawned.
            return Err(StartFailure::AlreadyServed(AlreadyServed { id, url }));
        }
        if self.inner.lock().unwrap().children.contains_key(&id) {
            return Err(StartFailure::Refused(format!(
                "A local server is already starting on port {port}."
            )));
        }

        let launch = resolve_launch().map_err(StartFailure::Refused)?;
        let data = data_directory();
        let _ = std::fs::create_dir_all(&data);
        let log_path = data.join(format!("desktop-{port}.log"));
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| StartFailure::Refused(format!("Could not open {}: {error}", log_path.display())))?;
        let log_err = log
            .try_clone()
            .map_err(|error| StartFailure::Refused(format!("Could not open {}: {error}", log_path.display())))?;

        let mut command = Command::new(&launch.program);
        command.args(&launch.args);
        command
            .arg("--port")
            .arg(port.to_string())
            .arg("--host")
            .arg("127.0.0.1");
        // `--foreground` keeps the server a CHILD of this process rather than
        // detaching into a daemon the shell could never stop.
        if launch.is_cli {
            command.arg("--foreground");
        }
        if let Some(cwd) = &launch.cwd {
            command.current_dir(cwd);
        }
        // Own process group (0 = the child's pid), so Stop can signal the tree.
        command.process_group(0);
        command.stdin(Stdio::null());
        command.stdout(Stdio::from(log));
        command.stderr(Stdio::from(log_err));

        let child = command.spawn().map_err(|error| {
            StartFailure::Refused(format!(
                "Could not start the local server ({error}). See {}.",
                log_path.display()
            ))
        })?;
        let pid = child.id() as i32;
        let managed = ManagedServer {
            id: id.clone(),
            url: url.clone(),
            pid,
        };
        self.inner
            .lock()
            .unwrap()
            .children
            .insert(id.clone(), (managed.clone(), child));

        Ok(managed)
    }

    /// Stop one managed server, and everything in its process group.
    pub fn stop(&self, id: &str) {
        let mut state = self.inner.lock().unwrap();
        if let Some(pid) = state.adopted.remove(id) {
            kill_group(pid);
            return;
        }
        if let Some((managed, mut child)) = state.children.remove(id) {
            kill_group(managed.pid);
            // Reap it, so a stopped server does not stay a zombie for the life
            // of the window.
            let _ = child.wait();
        }
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = {
            let state = self.inner.lock().unwrap();
            state
                .children
                .keys()
                .chain(state.adopted.keys())
                .cloned()
                .collect()
        };
        for id in ids {
            self.stop(&id);
        }
    }
}

#[derive(Debug)]
pub enum StartFailure {
    AlreadyServed(AlreadyServed),
    Refused(String),
}

impl StartFailure {
    pub fn message(&self) -> String {
        match self {
            StartFailure::AlreadyServed(served) => {
                format!("Something else is already serving {}.", served.url)
            }
            StartFailure::Refused(message) => message.clone(),
        }
    }
}

/// True when the child is still running — and it REAPS it when it is not.
///
/// `kill(pid, 0)` alone is wrong for a child this process spawned, and the
/// difference is seconds. A process that has exited but not been waited for is
/// a ZOMBIE, and a zombie still answers 0 to `kill(pid, 0)` — measured on
/// macOS with the identical code: the "wait until it is gone" loop in
/// `kill_group` never saw it go, ran its full 40 × 50 ms budget and fired a
/// pointless SIGKILL at an already-empty group, **2.27 s per server** for a
/// child that died in 60 ms.
///
/// `waitpid(pid, &status, WNOHANG)` is the honest check for a child of ours: 0
/// means still running, the pid means it was reaped and is now gone, and -1
/// means it is not our child at all (an adopted pid from a previous launch,
/// whose real parent is init) — there a zombie is impossible, so the signal
/// probe is the only answer available.
pub fn is_alive(pid: i32) -> bool {
    let mut status: libc::c_int = 0;
    let reaped = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
    if reaped == pid {
        return false;
    }
    if reaped == 0 {
        return true;
    }
    // -1: not our child (ECHILD) or already reaped. `kill(pid, 0)` is what an
    // adopted process needs.
    unsafe { libc::kill(pid, 0) == 0 }
}

/**
 * Signal the process GROUP, not just the pid.
 *
 * The pid a record names is not necessarily a group leader, so `kill(-pid)` can
 * answer ESRCH while the server keeps running. The group is read with `getpgid`,
 * which is the group the spawn created.
 */
pub fn kill_group(pid: i32) {
    let group = unsafe { libc::getpgid(pid) };
    let target = if group > 0 { -group } else { -pid };
    unsafe { libc::kill(target, libc::SIGTERM) };
    for _ in 0..40 {
        if !is_alive(pid) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    unsafe { libc::kill(target, libc::SIGKILL) };
}

/**
 Wait for a server `Supervisor::spawn` started to answer `/api/health`.

 Blocking and bounded by `START_TIMEOUT`, and safe on a WORKER thread: it touches
 nothing but the address and the pid, which is what lets the shell keep its GTK
 loop free while a slow server boots — and while a dead one is reported.

 The two refusals are the ones the panel prints, and each names what the reader
 would otherwise have to guess: the log file for a child that died, the port and
 the budget for one that never answered.
 */
pub fn wait_until_ready(url: &str, pid: i32, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if probe_health(url).is_some() {
            return Ok(());
        }
        if !is_alive(pid) {
            return Err(format!(
                "The local server exited during startup. See {}.",
                data_directory()
                    .join(format!("desktop-{port}.log"))
                    .display()
            ));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err(format!(
        "The local server did not answer on port {port} within {}s.",
        START_TIMEOUT.as_secs()
    ))
}

pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    /// True when `program` is the `kabmo` CLI rather than the server entry.
    pub is_cli: bool,
}
/**
 * How to start a local server on this machine.
 *
 * Three shapes, in the order that keeps the app self-contained first:
 *
 * 1. the **bundled** server beside the binary (`<app>/server/kabmo`);
 * 2. `kabmo` on `PATH`, which is the CLI a user already has;
 * 3. `bun` plus a source checkout's CLI, for development.
 */
pub fn resolve_launch() -> Result<Launch, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join("server/kabmo"), dir.join("../server/kabmo")] {
                if is_executable(&candidate) {
                    return Ok(Launch {
                        program: candidate.to_string_lossy().into_owned(),
                        args: Vec::new(),
                        cwd: candidate.parent().map(|path| path.to_string_lossy().into_owned()),
                        is_cli: false,
                    });
                }
            }
        }
    }
    if let Some(cli) = which("kabmo") {
        return Ok(Launch {
            program: cli,
            args: vec!["serve".into()],
            cwd: None,
            is_cli: true,
        });
    }
    if let Some(bun) = which("bun") {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let local = cwd.join("src/cli/kabmo.js");
        if local.is_file() {
            return Ok(Launch {
                program: bun,
                args: vec![
                    local.to_string_lossy().into_owned(),
                    "serve".into(),
                ],
                cwd: Some(cwd.to_string_lossy().into_owned()),
                is_cli: true,
            });
        }
    }
    Err(
        "No Kabmo server to start. Install the CLI (`bun add -g @kabmo-labs/kabmo`) or connect to a remote server."
            .into(),
    )
}

pub fn which(name: &str) -> Option<String> {
    let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into());
    let mut dirs: Vec<PathBuf> = path.split(':').map(PathBuf::from).collect();
    // A GUI-launched app inherits a minimal PATH; the usual install locations
    // are probed explicitly for the same reason the server's own omp lookup is.
    let home = home_directory();
    dirs.push(home.join(".bun/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/usr/bin"));

    for dir in dirs {
        let candidate = dir.join(name);
        if is_executable(&candidate) {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(metadata) => metadata.is_file() && metadata.permissions().mode() & 0o111 != 0,
        Err(_) => false,
    }
}

/// The injected side effects: the real probe, the real records, the real spawn.
///
/// Holds an `Rc` because the window's callbacks share one supervisor: a command
/// handler, the quit path and the boot-time adoption pass all act on the same
/// children, and two supervisors would mean two sets of pids with no way to stop
/// the other's.
pub struct SystemDeps {
    pub supervisor: std::sync::Arc<Supervisor>,
}

impl Deps for SystemDeps {
    fn probe(&self, url: &str) -> Option<Health> {
        probe_health(url)
    }

    fn detect(&self) -> Vec<ServerEntry> {
        detect_local_servers()
    }

    fn start(&self, port: u16) -> Result<StartResult, String> {
        match self.supervisor.spawn(port) {
            Ok(managed) => Ok(StartResult {
                id: managed.id,
                url: managed.url,
                pid: Some(managed.pid),
            }),
            // Something else serves the port. Reported with NO pid, which is
            // what keeps the panel from offering Stop for a process this shell
            // did not spawn.
            Err(StartFailure::AlreadyServed(served)) => Ok(StartResult {
                id: served.id,
                url: served.url,
                pid: None,
            }),
            Err(StartFailure::Refused(message)) => Err(message),
        }
    }

    fn stop(&self, id: &str) {
        self.supervisor.stop(id);
    }
}

/// Keep `Write` in scope for the log handle's `try_clone` chain in tests.
#[allow(dead_code)]
fn _assert_log_traits(mut handle: std::fs::File) {
    let _ = handle.flush();
}
