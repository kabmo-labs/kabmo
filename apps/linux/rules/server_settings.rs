/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// The splash's "Server settings": the values the dialog draws, and the action
// Connect performs.
//
// Two failures these cover, neither of which throws in the app: the dialog
// prefilled with an address nobody typed (submitting the wrong server), and
// Connect refusing an address the user is trying to CORRECT — the failing one is
// in the list, so "already remembered" must not be an error.

use kabmo_desktop::server_settings::ServerSettingsForm;
use kabmo_desktop::store::{PersistedState, ServerKind, ServerEntry, ServersState, StoredServer};

use crate::support::{entry, store_with, FakeDeps, Runner};

pub fn cases(r: &mut Runner) {
    r.group("ServerSettingsForm");

    let state = ServersState {
        entries: vec![
            ServerEntry {
                running: false,
                ..entry("remote:http://nas:8443", "http://nas:8443", None)
            },
            ServerEntry {
                running: true,
                ..entry("local:3001", "http://127.0.0.1:3001", Some(3001))
            },
        ],
        detected: vec![entry("local:7920", "http://127.0.0.1:7920", Some(7920))],
        active_id: Some("local:3001".into()),
        active_url: Some("http://127.0.0.1:3001".into()),
    };

    let form = ServerSettingsForm::new(&state, None);
    r.check(
        "the field starts on the window's own server",
        form.address == "http://127.0.0.1:3001",
    );
    r.check(
        "the picker offers the stored list, then the detected ones",
        form.rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>()
            == vec!["remote:http://nas:8443", "local:3001", "local:7920"],
    );
    r.check(
        "a row's title says whether that server answers",
        form.title_of(&form.rows[0]).ends_with("· stopped"),
    );
    r.check(
        "picking a row puts its address in the field",
        form.selecting(&form.rows[0]).address == "http://nas:8443",
    );

    // The typed address wins over everything: the dialog is re-presented after a
    // refusal with what the user typed, and a prefill from the list would erase it.
    r.check(
        "a typed address survives a prefill",
        ServerSettingsForm::new(&state, Some("https://other:9000")).address == "https://other:9000",
    );
    r.check(
        "with no server at all the field is empty, never a made-up default",
        ServerSettingsForm::new(&ServersState {
            entries: Vec::new(),
            detected: Vec::new(),
            active_id: None,
            active_url: None,
        }, None)
        .address
        .is_empty(),
    );
    r.check(
        "a host and port is normalised to the address that will be stored",
        form.selecting(&form.rows[0]).validated().as_deref() == Ok("http://nas:8443"),
    );
    r.check(
        "a base path is refused before Connect reaches the store",
        ServerSettingsForm::new(&state, Some("https://host/kabmo/"))
            .validated()
            .is_err(),
    );

    // ------------------------------------------------------- connect_remote

    r.group("ServerStore::connect_remote");

    // The address the user retyped because it was wrong: it is already in the
    // list, and connecting must select it rather than refuse it as a duplicate.
    let (mut store, saved) = store_with(
        FakeDeps::new(None).with_health("http://nas:8443"),
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
    let url = store.connect_remote("nas:8443").map(|(url, _)| url);
    r.check(
        "an already-remembered address connects without a duplicate row",
        url.as_deref() == Ok("http://nas:8443")
            && saved.borrow().last().map(|state| state.entries.len()) == Some(1),
    );
    r.check(
        "...and becomes the selection",
        saved.borrow().last().and_then(|state| state.active_id.clone())
            == Some("remote:http://nas:8443".into()),
    );

    let (mut store, saved) = store_with(
        FakeDeps::new(None).with_health("http://10.0.0.5:3000"),
        PersistedState::default(),
    );
    let url = store.connect_remote("10.0.0.5:3000").map(|(url, _)| url);
    r.check(
        "a new address is remembered and connected",
        url.as_deref() == Ok("http://10.0.0.5:3000"),
    );
    r.check(
        "...as a remote row with the normalised address",
        saved.borrow().last().and_then(|state| state.entries.first().cloned())
            == Some(StoredServer {
                id: "remote:http://10.0.0.5:3000".into(),
                label: "10.0.0.5:3000".into(),
                url: "http://10.0.0.5:3000".into(),
                kind: ServerKind::Remote,
                port: None,
            }),
    );

    let (mut store, _) = store_with(FakeDeps::new(None), PersistedState::default());
    let refusal = store.connect_remote("https://nas:8443");
    r.check(
        "a server that does not answer is refused with a sentence, not a blank load",
        refusal
            .map(|(url, _)| url)
            .is_err_and(|error| error.to_string().contains("not answering")),
    );
}
