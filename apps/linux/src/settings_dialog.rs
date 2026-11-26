/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The splash's "Server settings" dialog: an address field, the servers this shell
 * already knows, and Connect.
 *
 * A modal `GtkDialog` over the window rather than a second window, because the
 * failure splash is MODAL in intent — the console has not loaded, so there is
 * nothing behind it to interact with. GTK gives the dialog its own Enter/Escape
 * handling (`set_activates_default` + a Cancel response); nothing here
 * reimplements that.
 *
 * The RULES are `ServerSettingsForm`'s (prefill, rows, validation) and this file
 * only draws them. **Connect returns the RAW field text**: the refusal a wrong
 * address earns comes from the store's own `normalise_url` and probe, and
 * validating here as well would be a second copy — the caller then re-presents
 * this dialog with the sentence instead.
 */

use gtk::prelude::*;

use crate::server_settings::ServerSettingsForm;

/// What Connect was pressed with.
///
/// Two values rather than one because the pairing link is not an address: the
/// caller remembers the link's ORIGIN and then loads the LINK, which is the only
/// thing that can redeem the code and set the cookie.
pub struct ServerSettingsChoice {
    pub address: String,
    /// Set when the pairing field had text; it takes precedence over `address`.
    pub pairing_link: Option<String>,
}

/// Show the dialog; `Some(choice)` means Connect was pressed.
pub fn show(
    parent: &gtk::Window,
    form: &ServerSettingsForm,
    error: Option<&str>,
) -> Option<ServerSettingsChoice> {
    let dialog = gtk::Dialog::with_buttons(
        Some("Server settings"),
        Some(parent),
        gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
        &[
            ("Cancel", gtk::ResponseType::Cancel),
            ("Connect", gtk::ResponseType::Ok),
        ],
    );
    dialog.set_default_response(gtk::ResponseType::Ok);
    dialog.set_border_width(20);

    let area = dialog.content_area();
    area.set_spacing(8);

    let hint = gtk::Label::new(Some(error.unwrap_or(
        "Enter the address of the Kabmo server this window loads. \
         Use the root address, with no path.",
    )));
    hint.set_line_wrap(true);
    hint.set_max_width_chars(52);
    hint.set_xalign(0.0);
    area.pack_start(&hint, false, false, 0);

    // The field on TOP: it is the value Connect submits, and it is what a user
    // who knows the address needs first. The picker is the shortcut underneath.
    let entry = gtk::Entry::new();
    entry.set_text(&form.address);
    entry.set_placeholder_text(Some("http://192.168.1.20:3000"));
    entry.set_activates_default(true);
    area.pack_start(&entry, false, false, 0);

    let picker = gtk::ComboBoxText::new();
    picker.append(Some("0"), "Remembered servers");
    for (index, row) in form.rows.iter().enumerate() {
        picker.append(Some(&(index + 1).to_string()), &form.title_of(row));
    }
    picker.set_active_id(Some("0"));

    // A picked row fills the field — the field stays the one submitted value.
    let urls: Vec<String> = form.rows.iter().map(|row| row.url.clone()).collect();
    let entry_for_pick = entry.clone();
    picker.connect_changed(move |combo| {
        let Some(id) = combo.active_id() else { return };
        let Ok(index) = id.parse::<usize>() else { return };
        if index == 0 {
            return;
        }
        if let Some(url) = urls.get(index - 1) {
            entry_for_pick.set_text(url);
        }
    });
    area.pack_start(&picker, false, false, 0);

    // Pairing sits BELOW the address, because it is the alternative to typing
    // one. The link is loaded in THIS app's web view, so the device cookie the
    // server's `/pair` page receives lands in this app's cookie store — pairing
    // in a browser would leave the shell still asking for a password.
    let pairing_label = gtk::Label::new(Some("Pairing link (optional)"));
    pairing_label.set_xalign(0.0);
    area.pack_start(&pairing_label, false, false, 0);

    let pairing = gtk::Entry::new();
    pairing.set_placeholder_text(Some("https://…/pair#…"));

    // The scanner fills the field, so there is ONE submit path — the same
    // `pairing_link` the paste uses.
    let scan = gtk::Button::with_label("Scan…");
    let pairing_for_scan = pairing.clone();
    let dialog_for_scan = dialog.clone();
    scan.connect_clicked(move |_| {
        if let Some(code) = crate::qr_scanner::show(&dialog_for_scan) {
            pairing_for_scan.set_text(&code);
        }
    });

    let pairing_row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    pairing_row.pack_start(&pairing, true, true, 0);
    pairing_row.pack_start(&scan, false, false, 0);
    area.pack_start(&pairing_row, false, false, 0);

    dialog.show_all();
    let response = dialog.run();
    let typed = entry.text().to_string();
    let link = pairing.text().to_string();
    dialog.close();

    if response != gtk::ResponseType::Ok {
        return None;
    }
    let link = link.trim().to_string();
    Some(ServerSettingsChoice {
        address: typed.trim().to_string(),
        pairing_link: if link.is_empty() { None } else { Some(link) },
    })
}
