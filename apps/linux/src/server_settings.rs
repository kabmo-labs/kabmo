/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The values behind the splash's "Server settings" dialog, and every rule about
 * them.
 *
 * The dialog exists because the console's own server control is a PAGE, and the
 * one moment a user needs to change the address is the one moment the page cannot
 * load: a failure splash with only Retry leaves a wrong port unfixable without
 * editing `servers.json` by hand. Android's `SettingsActivity` is that same way
 * back, and this is the desktop's.
 *
 * No GTK here, for the reason `store.rs` states: what the field is prefilled
 * with, which rows the picker offers, what a pick does and what an address is
 * refused with are rules, and the rules suite runs on a machine with no display.
 * `settings_dialog.rs` draws exactly this.
 */

use crate::store::{normalise_url, ServerEntry, ServersState, ShellError};

/// One remembered-or-detected server the picker offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerSettingsRow {
    pub id: String,
    pub label: String,
    pub url: String,
    pub running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerSettingsForm {
    /// The stored list first, then the instances found on this machine.
    pub rows: Vec<ServerSettingsRow>,
    /// What the field holds. Editing the field and picking a row both change
    /// THIS, so the two controls cannot disagree about the submitted address.
    pub address: String,
}

impl ServerSettingsForm {
    /// `address` wins when it has anything in it — the dialog is re-presented
    /// after a refusal with what the user typed, and replacing that with the
    /// stored address would erase the correction they are making. Otherwise the
    /// window's own active URL, then the first row, then empty: never a made-up
    /// default, because `http://127.0.0.1:3000` prefilled with nothing behind it
    /// is an address the user will submit without reading.
    pub fn new(state: &ServersState, address: Option<&str>) -> Self {
        let rows = Self::rows_for(state);
        let trimmed = address.map(str::trim).unwrap_or_default();
        let address = if !trimmed.is_empty() {
            trimmed.to_string()
        } else if let Some(active) = state.active_url.as_deref().filter(|url| !url.is_empty()) {
            active.to_string()
        } else {
            rows.first().map(|row| row.url.clone()).unwrap_or_default()
        };
        Self { rows, address }
    }

    /// The picker's rows: everything stored, then everything detected.
    pub fn rows_for(state: &ServersState) -> Vec<ServerSettingsRow> {
        fn row(entry: &ServerEntry) -> ServerSettingsRow {
            ServerSettingsRow {
                id: entry.id.clone(),
                label: entry.label.clone(),
                url: entry.url.clone(),
                running: entry.running,
            }
        }
        state.entries.iter().map(row).chain(state.detected.iter().map(row)).collect()
    }

    /// What the picker prints for a row: the label and whether it answers, which
    /// is the difference between "choose my NAS" and "choose the NAS that is
    /// down".
    pub fn title_of(&self, row: &ServerSettingsRow) -> String {
        format!(
            "{} · {}",
            row.label,
            if row.running { "running" } else { "stopped" }
        )
    }

    /// Choose a remembered server: the field carries its address, and Connect
    /// submits that — not the row's id. A row is a shortcut, never a second value.
    pub fn selecting(&self, row: &ServerSettingsRow) -> Self {
        self.with_address(row.url.as_str())
    }

    pub fn with_address(&self, address: impl Into<String>) -> Self {
        Self {
            rows: self.rows.clone(),
            address: address.into(),
        }
    }

    /// The address to connect to, or the sentence that refuses it.
    ///
    /// The same `normalise_url` the store uses, so the dialog cannot accept an
    /// address the store would then reject — and the refusal is a sentence a
    /// reader can act on, never "invalid input".
    pub fn validated(&self) -> Result<String, ShellError> {
        normalise_url(&self.address)
    }
}
