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

/// Show the dialog; `Some(address)` means Connect was pressed.
pub fn show(parent: &gtk::Window, form: &ServerSettingsForm, error: Option<&str>) -> Option<String> {
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

    dialog.show_all();
    let response = dialog.run();
    let typed = entry.text().to_string();
    dialog.close();

    if response == gtk::ResponseType::Ok {
        Some(typed.trim().to_string())
    } else {
        None
    }
}
