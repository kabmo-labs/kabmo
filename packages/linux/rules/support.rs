/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// The runner and the fakes every case group shares.
// 
// A `Runner` rather than `#[test]` for the reason the crate's rules suite is an
// executable at all: these must run with no display and no `omp` install, and
// `cargo test` would compile the GTK test surface to check functions that never
// touch it.

use std::cell::RefCell;
use std::collections::BTreeMap;

use kabmo_desktop::store::{
    port_of, Deps, Health, PersistedState, ServerEntry, ServerKind, ServerStore, StartResult,
};

/// A case group's tally, and the printer that makes a failure legible.
///
/// One group per rule family, because a bare list of 78 assertions says nothing
/// about WHICH part of the shell broke when one of them fails.
pub struct Runner {
    pub failures: usize,
    pub checks: usize,
}

impl Runner {
    pub fn new() -> Self {
        Self {
            failures: 0,
            checks: 0,
        }
    }

    pub fn group(&self, name: &str) {
        println!("\n{name}");
    }

    /// A case that is about a REFUSAL: the closure returns whether the call
    /// failed, so a rule written as "this must not be accepted" reads as one.
    pub fn throws<F: FnOnce() -> bool>(&mut self, name: &str, failed: F) {
        self.check(name, failed());
    }

    pub fn check(&mut self, name: &str, ok: bool) {
        self.checks += 1;
        if ok {
            println!("  ok   {name}");
        } else {
            self.failures += 1;
            println!("  FAIL {name}");
        }
    }
}

pub fn entry(id: &str, url: &str, port: Option<u16>) -> ServerEntry {
    ServerEntry {
        id: id.into(),
        label: id.into(),
        url: url.into(),
        kind: ServerKind::Managed,
        port,
        running: true,
        owned: false,
        version: None,
        mode: None,
        pid: None,
        started_at: None,
        source: "record".into(),
    }
}

/// Everything the store needs, without a socket or a child process.
#[derive(Default)]
pub struct FakeDeps {
    health: RefCell<BTreeMap<String, Health>>,
    detected: RefCell<Vec<ServerEntry>>,
    started: RefCell<Vec<(u16, Option<i32>)>>,
    stopped: RefCell<Vec<String>>,
    start_pid: Option<i32>,
}

impl FakeDeps {
    pub fn new(start_pid: Option<i32>) -> Self {
        Self {
            start_pid,
            ..Default::default()
        }
    }

    pub fn with_health(self, url: &str) -> Self {
        self.health
            .borrow_mut()
            .insert(url.into(), Health::default());
        self
    }

    pub fn with_detected(self, entries: Vec<ServerEntry>) -> Self {
        *self.detected.borrow_mut() = entries;
        self
    }
}

impl Deps for FakeDeps {
    fn probe(&self, url: &str) -> Option<Health> {
        self.health.borrow().get(url).cloned()
    }

    fn detect(&self) -> Vec<ServerEntry> {
        self.detected.borrow().clone()
    }

    fn start(&self, port: u16) -> Result<StartResult, String> {
        self.started.borrow_mut().push((port, self.start_pid));
        let url = format!("http://127.0.0.1:{port}");
        self.health.borrow_mut().insert(
            url.clone(),
            Health {
                version: Some("0.5.3".into()),
                mode: Some("prod".into()),
                pid: Some(9),
                started_at: Some("now".into()),
            },
        );
        Ok(StartResult {
            id: format!("local:{port}"),
            url,
            pid: self.start_pid,
        })
    }

    fn stop(&self, id: &str) {
        self.stopped.borrow_mut().push(id.into());
        if let Some(port) = port_of(id) {
            self.health
                .borrow_mut()
                .remove(&format!("http://127.0.0.1:{port}"));
        }
    }
}

pub fn store_with(
    deps: FakeDeps,
    persisted: PersistedState,
) -> (ServerStore<FakeDeps>, std::rc::Rc<RefCell<Vec<PersistedState>>>) {
    let saved = std::rc::Rc::new(RefCell::new(Vec::new()));
    let sink = saved.clone();
    let store = ServerStore::new(
        deps,
        move || Some(persisted.clone()),
        move |state| sink.borrow_mut().push(state.clone()),
    );
    (store, saved)
}
