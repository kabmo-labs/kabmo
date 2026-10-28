/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// The server list: what a row may offer, and what it may stop.

use std::collections::BTreeMap;

use kabmo_desktop::store::{PersistedState, ServerKind, StoredServer};

use crate::support::{entry, store_with, FakeDeps, Runner};

pub fn cases(r: &mut Runner) {
    r.group("ServerStore");

    let persisted = PersistedState {
        entries: vec![
            StoredServer {
                id: "remote:http://nas:8443".into(),
                label: "NAS".into(),
                url: "http://nas:8443".into(),
                kind: ServerKind::Remote,
                port: None,
            },
            StoredServer {
                id: "local:3001".into(),
                label: "Local :3001".into(),
                url: "http://127.0.0.1:3001".into(),
                kind: ServerKind::Managed,
                port: Some(3001),
            },
        ],
        active_id: Some("local:3001".into()),
        ..Default::default()
    };
    let (store, _) = store_with(FakeDeps::new(Some(42)).with_health("http://127.0.0.1:3001"), persisted);
    let state = store.snapshot();
    r.check(
        "a stored server reports whether it answers",
        state.entries.iter().map(|entry| entry.running).collect::<Vec<_>>() == vec![false, true],
    );
    r.check(
        "the selection names its url",
        state.active_url.as_deref() == Some("http://127.0.0.1:3001"),
    );

    // Detected servers are the ones the list does not already carry.
    let (store, _) = store_with(
        FakeDeps::new(Some(42))
            .with_health("http://127.0.0.1:3001")
            .with_detected(vec![
                entry("local:3001", "http://127.0.0.1:3001", Some(3001)),
                entry("local:3000", "http://127.0.0.1:3000", Some(3000)),
            ]),
        PersistedState {
            entries: vec![StoredServer {
                id: "local:3001".into(),
                label: "Mine".into(),
                url: "http://127.0.0.1:3001".into(),
                kind: ServerKind::Managed,
                port: Some(3001),
            }],
            ..Default::default()
        },
    );
    let state = store.snapshot();
    r.check(
        "detected servers exclude the ones already stored",
        state.detected.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>() == vec!["local:3000"],
    );

    // `owned` is the whole safety property of the Stop button.
    let mut spawned = BTreeMap::new();
    spawned.insert("local:3001".to_string(), 111);
    let (store, _) = store_with(
        FakeDeps::new(Some(42))
            .with_health("http://127.0.0.1:3001")
            .with_health("http://127.0.0.1:7920"),
        PersistedState {
            entries: vec![
                StoredServer {
                    id: "local:3001".into(),
                    label: "Spawned".into(),
                    url: "http://127.0.0.1:3001".into(),
                    kind: ServerKind::Managed,
                    port: Some(3001),
                },
                StoredServer {
                    id: "local:7920".into(),
                    label: "Hand-started".into(),
                    url: "http://127.0.0.1:7920".into(),
                    kind: ServerKind::Managed,
                    port: Some(7920),
                },
            ],
            spawned,
            ..Default::default()
        },
    );
    let state = store.snapshot();
    r.check(
        "owned comes from the recorded pid, never from discovery",
        state.entries.iter().map(|entry| entry.owned).collect::<Vec<_>>() == vec![true, false],
    );

    let mut store = {
        let (store, _) = store_with(
            FakeDeps::new(Some(42)),
            PersistedState {
                entries: vec![StoredServer {
                    id: "remote:http://nas:8443".into(),
                    label: "NAS".into(),
                    url: "http://nas:8443".into(),
                    kind: ServerKind::Remote,
                    port: None,
                }],
                ..Default::default()
            },
        );
        store
    };
    r.check(
        "a duplicate url is refused",
        store.add_remote("Again", "nas:8443").is_err(),
    );

    let (mut store, saved) = store_with(
        FakeDeps::new(Some(42))
            .with_health("http://127.0.0.1:3001")
            .with_health("http://127.0.0.1:3002"),
        PersistedState {
            entries: vec![
                StoredServer {
                    id: "local:3001".into(),
                    label: "One".into(),
                    url: "http://127.0.0.1:3001".into(),
                    kind: ServerKind::Managed,
                    port: Some(3001),
                },
                StoredServer {
                    id: "local:3002".into(),
                    label: "Two".into(),
                    url: "http://127.0.0.1:3002".into(),
                    kind: ServerKind::Managed,
                    port: Some(3002),
                },
            ],
            active_id: Some("local:3001".into()),
            ..Default::default()
        },
    );
    let (url, started_pid) = store.activate("local:3002").unwrap_or_default();
    r.check("a successful switch returns the url", url == "http://127.0.0.1:3002");
    r.check(
        "…and says no server was started, so there is nothing to wait for",
        started_pid.is_none(),
    );
    r.check(
        "a successful switch is persisted",
        saved.borrow().last().and_then(|state| state.active_id.clone()).as_deref()
            == Some("local:3002"),
    );

    // Switching to a local server that is DOWN starts it; a remote one is refused.
    let (mut store, _) = store_with(
        FakeDeps::new(Some(42)),
        PersistedState {
            entries: vec![
                StoredServer {
                    id: "local:3001".into(),
                    label: "Local :3001".into(),
                    url: "http://127.0.0.1:3001".into(),
                    kind: ServerKind::Managed,
                    port: Some(3001),
                },
                StoredServer {
                    id: "remote:http://nas:8443".into(),
                    label: "NAS".into(),
                    url: "http://nas:8443".into(),
                    kind: ServerKind::Remote,
                    port: None,
                },
            ],
            ..Default::default()
        },
    );
    let (started_url, started_pid) = store.activate("local:3001").unwrap_or_default();
    r.check(
        "activating a stopped local server starts it",
        started_url == "http://127.0.0.1:3001",
    );
    r.check(
        "…and hands back the pid, which is what the shell waits on off the GUI loop",
        started_pid == Some(42),
    );
    r.check(
        "a stopped remote server is refused",
        store.activate("remote:http://nas:8443").is_err(),
    );

    // A detected server is connectable and is ADOPTED by connecting.
    let (mut store, saved) = store_with(
        FakeDeps::new(Some(42))
            .with_health("http://127.0.0.1:7920")
            .with_detected(vec![entry("local:7920", "http://127.0.0.1:7920", Some(7920))]),
        PersistedState::default(),
    );
    let (url, _) = store.activate("local:7920").unwrap_or_default();
    r.check("a detected server is connectable", url == "http://127.0.0.1:7920");
    r.check(
        "...and is adopted into the list",
        saved.borrow().last().map(|state| state.entries.len()) == Some(1),
    );

    // The pid is the whole claim: a port already served records no pid.
    let (mut store, saved) = store_with(FakeDeps::new(None), PersistedState::default());
    let _ = store.start(3001, None);
    r.check(
        "a port already served records no pid",
        saved.borrow().last().map(|state| state.spawned.is_empty()) == Some(true),
    );

    let (mut store, saved) = store_with(FakeDeps::new(Some(4242)), PersistedState::default());
    let started = store.start(3007, None).ok();
    r.check(
        "starting selects the new server",
        started.as_ref().map(|started| started.id.as_str()) == Some("local:3007"),
    );
    r.check(
        "starting records the pid for a later launch",
        saved
            .borrow()
            .last()
            .and_then(|state| state.spawned.get("local:3007").copied())
            == Some(4242),
    );

    let mut spawned = BTreeMap::new();
    spawned.insert("local:3001".to_string(), 9);
    let (mut store, saved) = store_with(
        FakeDeps::new(Some(9)).with_health("http://127.0.0.1:3001"),
        PersistedState {
            entries: vec![StoredServer {
                id: "local:3001".into(),
                label: "L".into(),
                url: "http://127.0.0.1:3001".into(),
                kind: ServerKind::Managed,
                port: Some(3001),
            }],
            spawned,
            ..Default::default()
        },
    );
    store.stop("local:3001");
    r.check(
        "stopping clears the recorded pid",
        saved.borrow().last().map(|state| state.spawned.is_empty()) == Some(true),
    );

    // Adoption is limited to the pids this shell recorded, and only while they
    // answer.
    let mut spawned = BTreeMap::new();
    spawned.insert("local:3001".to_string(), 111);
    spawned.insert("local:3002".to_string(), 222);
    let (store, _) = store_with(
        FakeDeps::new(Some(42))
            .with_detected(vec![entry("local:3001", "http://127.0.0.1:3001", Some(3001))]),
        PersistedState {
            spawned,
            ..Default::default()
        },
    );
    let orphans = store.orphaned_pids();
    r.check(
        "orphans are only the recorded pids that still answer",
        orphans.len() == 1 && orphans.get("local:3001") == Some(&111),
    );

    let mut spawned = BTreeMap::new();
    spawned.insert("local:3001".to_string(), 9);
    let (mut store, saved) = store_with(
        FakeDeps::new(Some(9)),
        PersistedState {
            entries: vec![StoredServer {
                id: "local:3001".into(),
                label: "L".into(),
                url: "http://127.0.0.1:3001".into(),
                kind: ServerKind::Managed,
                port: Some(3001),
            }],
            active_id: Some("local:3001".into()),
            spawned,
            ..Default::default()
        },
    );
    let _ = store.remove("local:3001");
    r.check(
        "removing drops the row, the pid and the selection",
        saved.borrow().last() == Some(&PersistedState::default()),
    );
}
