/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The rules: the server list, its selection, and the actions the panel performs.
 *
 * No GTK, no sockets, no child processes — every side effect arrives through
 * `Deps`, so the decisions are testable on their own. That split is not
 * tidiness: each rule below is a way the panel could LIE, and none of them
 * throws in the app. A row that offers Stop for a process the shell did not
 * start looks exactly like a row that offers it for one it did.
 *
 * Ported from `packages/desktop/Sources/KabmoDesktop/Store.swift` and
 * `packages/windows/src/KabmoDesktop/Store.cs`. The wording of each rule is the
 * same because the behaviour is; only the persistence path and the process
 * group differ, and both of those live in `system.rs`.
 */

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerKind {
    Remote,
    Managed,
}

/// One server the shell remembers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredServer {
    pub id: String,
    pub label: String,
    pub url: String,
    pub kind: ServerKind,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub port: Option<u16>,
}

/// A server as the panel draws it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub id: String,
    pub label: String,
    pub url: String,
    pub kind: ServerKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub running: bool,
    /// This shell started it, as opposed to a server found on the machine.
    pub owned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// `stored` for the list, `record` for a local instance found on disk.
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServersState {
    pub entries: Vec<ServerEntry>,
    /// Local instances this shell did NOT start — a `kabmo serve`, a dev server.
    pub detected: Vec<ServerEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_url: Option<String>,
}

/// What is persisted between launches.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    #[serde(default)]
    pub entries: Vec<StoredServer>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub active_id: Option<String>,
    /**
     * `local:<port>` → the pid THIS shell spawned.
     *
     * The record of an adoption. A shell that is force-quit leaves its children
     * running, and the next launch must be able to stop them — but it must NOT
     * take over a server the user started in a terminal. Only a pid written here
     * is ours, so this map is the whole difference between "an orphan of mine"
     * and "not mine".
     */
    #[serde(default)]
    pub spawned: std::collections::BTreeMap<String, i32>,
    /**
     * The palette the console last reported, as a wire.
     *
     * Stored beside the server list because it belongs to this shell's own state,
     * and read on the FIRST frame: the splash is drawn before any page exists, so
     * this is the only colour available at launch. Optional and defaulted, so a
     * `servers.json` written by an older build still decodes.
     */
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub palette: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Health {
    pub version: Option<String>,
    pub mode: Option<String>,
    pub pid: Option<i32>,
    pub started_at: Option<String>,
}

/// The side effects, injected.
pub trait Deps {
    fn probe(&self, url: &str) -> Option<Health>;
    fn detect(&self) -> Vec<ServerEntry>;
    /// Start a local server; `pid` is `None` when the port was already served.
    ///
    /// It SPAWNS and returns: the health wait is `system::wait_until_ready`, run
    /// by the shell on a worker thread, because this call is made from the GTK
    /// loop and a 45 s wait there froze the window (`main.rs`).
    fn start(&self, port: u16) -> Result<StartResult, String>;
    fn stop(&self, id: &str);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartResult {
    pub id: String,
    pub url: String,
    pub pid: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellError(pub String);

impl std::fmt::Display for ShellError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ShellError {}

impl ShellError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

/**
 * `http(s)://host[:port]` — no path, no credentials, no query.
 *
 * A base path is REFUSED rather than dropped: the client is same-origin
 * relative, so a page served from `https://host/kabmo/` would ask `/api/...` at
 * the domain root and fail every request after loading successfully. The macOS
 * and Android shells refuse it for the same reason.
 */
pub fn normalise_url(raw: &str) -> Result<String, ShellError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ShellError::new("Enter a server address."));
    }

    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };

    let scheme = if with_scheme.starts_with("https://") {
        "https"
    } else if with_scheme.starts_with("http://") {
        "http"
    } else {
        return Err(ShellError::new(
            "Only http:// and https:// addresses are supported.",
        ));
    };

    let rest = &with_scheme[scheme.len() + 3..];
    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };

    if authority.is_empty() {
        return Err(ShellError::new("That address is not a host and port."));
    }
    if authority.contains('@') || authority.contains('?') || authority.contains('#') {
        return Err(ShellError::new("That address is not a host and port."));
    }
    if !path.is_empty() && path != "/" {
        return Err(ShellError::new(
            "Use the server's root address — a base path is not supported.",
        ));
    }
    Ok(format!("{scheme}://{authority}"))
}

pub fn server_id_value(kind: ServerKind, value: &str) -> String {
    match kind {
        ServerKind::Remote => format!("remote:{value}"),
        ServerKind::Managed => format!("local:{value}"),
    }
}

pub fn server_id_port(kind: ServerKind, port: u16) -> String {
    match kind {
        ServerKind::Remote => format!("remote:{port}"),
        ServerKind::Managed => format!("local:{port}"),
    }
}

/// The port an id names, for a `local:` row.
pub fn port_of(id: &str) -> Option<u16> {
    id.strip_prefix("local:")?.parse().ok()
}

/// The server list, its selection, and the actions the panel performs.
pub struct ServerStore<D: Deps> {
    deps: D,
    save: Box<dyn Fn(&PersistedState)>,
    state: PersistedState,
}

impl<D: Deps> ServerStore<D> {
    pub fn new(
        deps: D,
        load: impl Fn() -> Option<PersistedState>,
        save: impl Fn(&PersistedState) + 'static,
    ) -> Self {
        Self {
            deps,
            save: Box::new(save),
            state: load().unwrap_or_default(),
        }
    }

    fn persist(&self) {
        (self.save)(&self.state);
    }

    /// The ids this shell spawned, for the boot-time adoption pass.
    pub fn spawned_pids(&self) -> std::collections::BTreeMap<String, i32> {
        self.state.spawned.clone()
    }

    /// The palette the console last reported, or the shipped one.
    ///
    /// Read at launch, before any page exists — which is why it is persisted
    /// rather than asked for. A wire this build cannot parse is the shipped
    /// palette, never a partial one.
    pub fn palette(&self) -> crate::palette::ShellPalette {
        self.state
            .palette
            .as_deref()
            .and_then(crate::palette::ShellPalette::parse)
            .unwrap_or_default()
    }

    /// Remember the console's palette for the next launch.
    ///
    /// An unreadable wire is not written: keeping the previous palette is the
    /// only answer that cannot repaint the shell with a colour no theme chose.
    pub fn set_palette(&mut self, wire: &str) {
        let Some(next) = crate::palette::ShellPalette::parse(wire) else {
            return;
        };
        if self.state.palette.as_deref() == Some(next.wire().as_str()) {
            return;
        }
        self.state.palette = Some(next.wire());
        self.persist();
    }

    /// Every answering server, the detected ones, and the selection.
    pub fn snapshot(&self) -> ServersState {
        let mut entries = Vec::with_capacity(self.state.entries.len());
        for stored in &self.state.entries {
            let health = self.deps.probe(&stored.url);
            entries.push(ServerEntry {
                id: stored.id.clone(),
                label: stored.label.clone(),
                url: stored.url.clone(),
                kind: stored.kind,
                port: stored.port,
                running: health.is_some(),
                owned: self.state.spawned.contains_key(&stored.id),
                version: health.as_ref().and_then(|h| h.version.clone()),
                mode: health.as_ref().and_then(|h| h.mode.clone()),
                pid: health.as_ref().and_then(|h| h.pid),
                started_at: health.as_ref().and_then(|h| h.started_at.clone()),
                source: "stored".into(),
            });
        }
        let detected: Vec<ServerEntry> = self
            .deps
            .detect()
            .into_iter()
            .filter(|found| !self.state.entries.iter().any(|stored| stored.id == found.id))
            .collect();
        let active = self
            .state
            .entries
            .iter()
            .find(|entry| Some(&entry.id) == self.state.active_id.as_ref());
        ServersState {
            entries,
            detected,
            active_id: self.state.active_id.clone(),
            active_url: active.map(|entry| entry.url.clone()),
        }
    }

    pub fn add_remote(&mut self, label: &str, url: &str) -> Result<(), ShellError> {
        let normalised = normalise_url(url)?;
        if self.state.entries.iter().any(|entry| entry.url == normalised) {
            return Err(ShellError::new(format!("{normalised} is already in the list.")));
        }
        let trimmed = label.trim();
        let label = if trimmed.is_empty() {
            normalised
                .replacen("https://", "", 1)
                .replacen("http://", "", 1)
        } else {
            trimmed.to_string()
        };
        self.state.entries.push(StoredServer {
            id: server_id_value(ServerKind::Remote, &normalised),
            label,
            url: normalised,
            kind: ServerKind::Remote,
            port: None,
        });
        self.persist();
        Ok(())
    }

    pub fn remove(&mut self, id: &str) -> Result<(), ShellError> {
        let before = self.state.entries.len();
        self.state.entries.retain(|entry| entry.id != id);
        if self.state.entries.len() == before {
            return Err(ShellError::new("That server is not in the list."));
        }
        self.state.spawned.remove(id);
        if self.state.active_id.as_deref() == Some(id) {
            self.state.active_id = None;
        }
        self.persist();
        Ok(())
    }

    /**
     * The URL to load for `id`, refusing one that cannot answer.
     *
     * An id that is not in the stored list is looked up among the instances
     * found on this machine and ADOPTED into the list: it was never the shell's
     * to remember, but connecting to it is an explicit choice worth keeping.
     */
    pub fn activate(&mut self, id: &str) -> Result<(String, Option<i32>), ShellError> {
        if !self.state.entries.iter().any(|entry| entry.id == id) {
            let found = self
                .deps
                .detect()
                .into_iter()
                .find(|found| found.id == id)
                .ok_or_else(|| ShellError::new("That server is not in the list."))?;
            self.state.entries.push(StoredServer {
                id: found.id,
                label: found.label,
                url: found.url,
                kind: found.kind,
                port: found.port,
            });
        }
        let entry = self
            .state
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| ShellError::new("That server is not in the list."))?;
        let (url, kind, port, label) = (
            entry.url.clone(),
            entry.kind,
            entry.port,
            entry.label.clone(),
        );

        if self.deps.probe(&url).is_some() {
            self.state.active_id = Some(id.to_string());
            self.persist();
            return Ok((url, None));
        }
        // "Switch to my local server" when it is down means start it. A REMOTE
        // server that is down is refused: there is nothing this shell could
        // start.
        if kind == ServerKind::Managed {
            if let Some(port) = port {
                // The pid travels with the address so the caller can WAIT for it
                // off the GUI loop; a server that was already answering has none
                // to wait for.
                let started = self.start(port, Some(&label))?;
                return Ok((started.url, started.pid));
            }
        }
        Err(ShellError::new(format!("{label} is not answering. Start it first.")))
    }

    /// Start a local server as this shell's child and select it.
    ///
    /// Answers the `StartResult` — the id, the address and the pid — because the
    /// caller is what WAITS for the server: `system::wait_until_ready` runs on a
    /// thread, off the GTK loop, and needs both the address and the pid to tell a
    /// slow boot from a child that died.
    pub fn start(
        &mut self,
        port: u16,
        label: Option<&str>,
    ) -> Result<StartResult, ShellError> {
        let started = self.deps.start(port).map_err(ShellError::new)?;
        if let Some(index) = self
            .state
            .entries
            .iter()
            .position(|entry| entry.id == started.id)
        {
            let entry = &mut self.state.entries[index];
            entry.url = started.url.clone();
            entry.port = Some(port);
            if let Some(label) = label {
                entry.label = label.to_string();
            }
        } else {
            self.state.entries.push(StoredServer {
                id: started.id.clone(),
                label: label.map(|value| value.to_string()).unwrap_or_else(|| format!("Local :{port}")),
                url: started.url.clone(),
                kind: ServerKind::Managed,
                port: Some(port),
            });
        }
        // Only a pid this shell spawned is recorded, so a later launch adopts
        // exactly its own orphans and never a server the user started by hand.
        if let Some(pid) = started.pid {
            self.state.spawned.insert(started.id.clone(), pid);
        }
        self.state.active_id = Some(started.id.clone());
        self.persist();
        Ok(started)
    }

    pub fn stop(&mut self, id: &str) {
        self.deps.stop(id);
        self.state.spawned.remove(id);
        self.persist();
    }

    /**
     * Adopt the servers a PREVIOUS run of this shell spawned and left running.
     *
     * The force-quit case: the window died without stopping its children, so
     * they still answer. The pids come from this shell's own persisted list,
     * never from discovery — a hand-started server answers on a port and appears
     * in the same records, and taking it over would offer a Stop for a process
     * somebody else is watching.
     */
    pub fn orphaned_pids(&self) -> std::collections::BTreeMap<String, i32> {
        let detected = self.deps.detect();
        self.state
            .spawned
            .iter()
            .filter(|(id, _)| detected.iter().any(|found| &found.id == *id))
            .map(|(id, pid)| (id.clone(), *pid))
            .collect()
    }

    /// The URL the window opens on: the selection, else a live one, else 3000.
    pub fn boot_url(&self, state: &ServersState) -> String {
        state
            .active_url
            .clone()
            .or_else(|| state.detected.first().map(|entry| entry.url.clone()))
            .or_else(|| {
                state
                    .entries
                    .iter()
                    .find(|entry| entry.running)
                    .map(|entry| entry.url.clone())
            })
            .unwrap_or_else(|| "http://127.0.0.1:3000".to_string())
    }
}
