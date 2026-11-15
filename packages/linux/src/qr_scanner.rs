/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell's own QR scanner: a camera preview in a WebKit view, decoded by the
 * same page Android and Windows host.
 *
 * **Why a web view here and native on Apple.** Linux has no QR decoder in the
 * toolkit: the options are a crate (`rqrr`) plus a camera crate (`nokhwa`), or the
 * page that already exists. The page's decoder is already tested, and WebKitGTK is
 * already a dependency of this shell — so the cheapest correct answer is to host
 * it. Apple platforms get `AVCaptureMetadataOutput` because it is built in there.
 *
 * **The base URI is `https://kabmo.local/`, and that is load-bearing.**
 * `getUserMedia` needs a secure context, and a document loaded with no base URI
 * has an opaque origin that is not one — the page would report "this device does
 * not offer a camera" on a machine with a perfectly good webcam. `load_html` with
 * an https base gives the document that origin without a server behind it.
 *
 * The page carries its own decoder (`jsQR`, inlined into the asset): WebKitGTK has
 * no `BarcodeDetector`, and the page's fallback is `window.jsQR`.
 *
 * The result is the decoded TEXT, not a parsed payload: the caller already has
 * `pairing_link::origin_of`, and a second parser here would be a second place for
 * the link format to drift.
 */

use gtk::prelude::*;
use javascriptcore::ValueExt;
use serde_json::Value;
use webkit2gtk::{SettingsExt, UserContentManagerExt, WebView, WebViewExt};

/// The page, embedded so an installed build carries it. ONE page serves Android,
/// Windows and Linux; `packages/qr-scanner/qr-scanner.html` is generated from
/// `page.html` by `bun packages/qr-scanner/build.mjs`, and it carries jsQR
/// inlined because WebKitGTK has no `BarcodeDetector`.
const SCANNER_PAGE: &str = include_str!("../../qr-scanner/qr-scanner.html");

/// The base URI that makes the page a secure context. See the module comment.
const SECURE_BASE: &str = "https://kabmo.local/";

/// Show the scanner; `Some(text)` means a code was read.
pub fn show(parent: &gtk::Dialog) -> Option<String> {
    let dialog = gtk::Dialog::with_buttons(
        Some("Scan pairing code"),
        Some(parent),
        gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
        &[("Cancel", gtk::ResponseType::Cancel)],
    );
    dialog.set_default_size(460, 420);

    let view = WebView::new();
    if let Some(settings) = WebViewExt::settings(&view) {
        settings.set_enable_javascript(true);
        settings.set_enable_media_stream(true);
    }

    // The page reports through `window.webkit.messageHandlers.kabmoQr`, which is
    // the one bridge WebKitGTK offers without injecting an object. The handler
    // shape is the one `main.rs` already uses for the console bridge.
    let result: std::rc::Rc<std::cell::RefCell<Option<String>>> =
        std::rc::Rc::new(std::cell::RefCell::new(None));
    if let Some(manager) = view.user_content_manager() {
        manager.register_script_message_handler("kabmoQr");
        let result_for_handler = result.clone();
        let dialog_for_handler = dialog.clone();
        let view_for_pick = view.clone();
        manager.connect_script_message_received(Some("kabmoQr"), move |_manager, message| {
            let Some(value) = message.js_value() else { return };
            let Some(json) = value.to_json(0) else { return };
            let Ok(parsed) = serde_json::from_str::<Value>(&json) else {
                return;
            };
            // The page asks the HOST for a picker: a WebView file chooser is a
            // second permission path for something the shell already has, and the
            // page never needs to see a file path.
            if parsed.get("type").and_then(Value::as_str) == Some("pick") {
                if let Some(data_url) = pick_image(&dialog_for_handler) {
                    let script = format!(
                        "window.__kabmoQrImage && window.__kabmoQrImage({})",
                        serde_json::to_string(&data_url).unwrap_or_else(|_| "''".to_string())
                    );
                    view_for_pick.run_javascript(&script, None::<&gtk::gio::Cancellable>, |_| {});
                }
                return;
            }
            if parsed.get("type").and_then(Value::as_str) != Some("code") {
                return;
            }
            let Some(text) = parsed.get("text").and_then(Value::as_str) else {
                return;
            };
            if text.trim().is_empty() {
                return;
            }
            *result_for_handler.borrow_mut() = Some(text.to_string());
            dialog_for_handler.response(gtk::ResponseType::Ok);
        });
    }

    view.load_html(SCANNER_PAGE, Some(SECURE_BASE));

    if let Some(area) = dialog.content_area().downcast::<gtk::Box>().ok() {
        area.pack_start(&view, true, true, 0);
    }
    dialog.show_all();
    let response = dialog.run();
    dialog.close();

    if response == gtk::ResponseType::Ok {
        result.borrow().clone()
    } else {
        None
    }
}

/// Pick an image and return it as a `data:` URL, or `None` when cancelled.
///
/// The bytes never leave the app: the page decodes them in place, which is the
/// same decoder the camera uses.
fn pick_image(parent: &gtk::Dialog) -> Option<String> {
    let chooser = gtk::FileChooserDialog::with_buttons(
        Some("Choose a pairing code image"),
        Some(parent),
        gtk::FileChooserAction::Open,
        &[
            ("Cancel", gtk::ResponseType::Cancel),
            ("Open", gtk::ResponseType::Accept),
        ],
    );
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("Images"));
    for pattern in ["*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp", "*.gif"] {
        filter.add_pattern(pattern);
    }
    chooser.add_filter(filter);

    let response = chooser.run();
    let path = chooser.filename();
    chooser.close();
    if response != gtk::ResponseType::Accept {
        return None;
    }
    let path = path?;
    let bytes = std::fs::read(&path).ok()?;
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        _ => "image/jpeg",
    };
    Some(format!("data:{mime};base64,{}", crate::base64::encode(&bytes)))
}


