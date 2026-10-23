/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The window's own behaviour, outside the app's wiring.
 *
 * The shortcut table, the geometry file, the webview's construction, the two
 * intents the page reports for the bar, and where an external link goes. Split
 * from `main.rs` for the reason the macOS shell splits `ShellWindow.swift` from
 * `main.swift`: each of these is a rule with a measured reason, and none of them
 * needs the app's state.
 */

use std::cell::RefCell;
use std::rc::Rc;

use gtk::gdk;
use gtk::prelude::*;
use webkit2gtk::{UserContentManager, WebContext, WebView, WebViewExt};

use kabmo_desktop::system::data_directory;
use kabmo_desktop::window::{
    bar_menu, configure_view, is_fullscreen, open_settings, pointer_position, reset_zoom,
    toggle_inspector, zoom_by, DoubleClickAction, Geometry, ZOOM_STEP,
};

/// `<config>/Kabmo/window.txt` — beside the server list, under the same name.
///
/// Derived from `state_file_path()` rather than rebuilt from `config_home()`, so
/// the two files cannot end up in different directories when the app directory is
/// renamed.
pub fn geometry_path() -> std::path::PathBuf {
    kabmo_desktop::persisted::state_file_path().with_file_name("window.txt")
}

/// Put the window back where it was left.
///
/// A file that cannot be read, or holds nothing usable, leaves the window at its
/// default geometry — `Geometry::parse` answers the defaults rather than failing,
/// because a corrupt file must not stop the console from opening.
pub fn restore_geometry(window: &gtk::Window) {
    let Ok(text) = std::fs::read_to_string(geometry_path()) else {
        return;
    };
    let geometry = Geometry::parse(&text);
    window.resize(geometry.width, geometry.height);
    if geometry.has_position() {
        window.move_(geometry.x, geometry.y);
    }
}

/// Write where the window ended up, best-effort.
///
/// A maximised or full-screen window reports the screen's geometry, not the
/// windowed one the user chose — storing that would make the next launch open
/// maximised with no way back except dragging an edge. So those states keep the
/// last WINDOWED geometry on disk.
pub fn save_geometry(window: &gtk::Window) {
    if window.is_maximized() || is_fullscreen(window) {
        return;
    }
    let (x, y) = window.position();
    let (width, height) = window.size();
    let geometry = Geometry {
        x,
        y,
        width,
        height,
    }
    .clamp();
    let path = geometry_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, geometry.serialise());
}

/// The webview, with its own data directories.
///
/// A dedicated `WebsiteDataManager` rather than the default: the console keeps a
/// login cookie per port (`sessionCookieName`), and a shared store would let two
/// shells on the same machine overwrite each other's session — while an
/// EPHEMERAL store would drop the login on every relaunch.
pub fn build_view() -> WebView {
    let base = data_directory().join("desktop-webview");
    let _ = std::fs::create_dir_all(&base);
    let manager = webkit2gtk::WebsiteDataManager::builder()
        .base_data_directory(base.join("data").to_string_lossy().as_ref())
        .base_cache_directory(base.join("cache").to_string_lossy().as_ref())
        .build();
    let context = WebContext::with_website_data_manager(&manager);
    let content = UserContentManager::new();
    let view = WebView::builder()
        .web_context(&context)
        .user_content_manager(&content)
        .build();
    configure_view(&view);
    view
}

/// The three intents the page posts for the bar, and the only ones that answer
/// nothing.
///
/// `window_drag` arrives only after the pointer has moved (`DRAG_THRESHOLD_PX`),
/// so `begin_move_drag` here is never a press that should have been a click.
pub fn handle_chrome(
    window: &gtk::Window,
    view: &WebView,
    method: &str,
    last_press: &Rc<RefCell<Option<gdk::Event>>>,
) {
    match method {
        "window_drag" => {
            let (x, y) = pointer_position();
            window.begin_move_drag(1, x, y, gdk::ffi::GDK_CURRENT_TIME as u32);
        }
        "window_toggle" => {
            DoubleClickAction::current().apply(window);
        }
        "window_menu" => {
            let trigger = last_press.borrow().clone();
            bar_menu(window, view, trigger.as_ref());
        }
        _ => {}
    }
}

/// Whether a navigation leaves the console.
///
/// The rule lives in the library (`navigation::decide`) so the rules suite can
/// reach it; this is the binary's one call site.
pub fn same_origin(here: &str, there: &str) -> bool {
    kabmo_desktop::navigation::same_origin(here, there)
}

pub fn open_external(url: &str) {
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
        return;
    }
    let _ = std::process::Command::new("xdg-open")
        .arg(url)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

/// One shortcut table, so the window's and the webview's handlers cannot drift.
///
/// Wired on BOTH widgets, because a key event goes to the focused one first and
/// the webview consumes most of them — measured: `F11` reached the window while
/// `Ctrl+Shift+I` did not, since WebKit handles it internally.
pub fn handle_key(
    window: &gtk::Window,
    view: &WebView,
    event: &gdk::EventKey,
) -> gtk::glib::Propagation {
    let ctrl = event.state().contains(gdk::ModifierType::CONTROL_MASK);
    let shift = event.state().contains(gdk::ModifierType::SHIFT_MASK);
    match (ctrl, shift, event.keyval()) {
        (true, _, key) if key == gdk::keys::constants::q => {
            window.close();
            gtk::glib::Propagation::Stop
        }
        // The window's own verbs, so a keyboard-only user is not stuck with a
        // page-drawn control. `Ctrl+W` is the Linux convention for closing a
        // window and `Ctrl+M` for minimising it.
        (true, false, key) if key == gdk::keys::constants::w => {
            window.close();
            gtk::glib::Propagation::Stop
        }
        (true, false, key) if key == gdk::keys::constants::m => {
            window.iconify();
            gtk::glib::Propagation::Stop
        }
        (true, false, key) if key == gdk::keys::constants::r => {
            view.reload();
            gtk::glib::Propagation::Stop
        }
        // Page zoom, the same three keys the macOS shell binds. `Ctrl+0` is
        // "actual size" rather than a fourth step, and the two steps clamp at
        // the shared bounds so a keyboard user cannot reach a zoom the menu
        // would refuse.
        (true, _, key) if key == gdk::keys::constants::_0 => {
            reset_zoom(view);
            gtk::glib::Propagation::Stop
        }
        // Shift is not part of the test: `Ctrl++` arrives as `Ctrl+Shift+equal` on
        // a US layout and as `Ctrl+plus` on a keypad, and both mean the same step.
        (true, _, key)
            if key == gdk::keys::constants::plus
                || key == gdk::keys::constants::equal
                || key == gdk::keys::constants::KP_Add =>
        {
            zoom_by(view, ZOOM_STEP);
            gtk::glib::Propagation::Stop
        }
        (true, _, key)
            if key == gdk::keys::constants::minus || key == gdk::keys::constants::KP_Subtract =>
        {
            zoom_by(view, 1.0 / ZOOM_STEP);
            gtk::glib::Propagation::Stop
        }
        (true, true, key) if key == gdk::keys::constants::I => {
            toggle_inspector(view);
            gtk::glib::Propagation::Stop
        }
        (true, false, key) if key == gdk::keys::constants::comma => {
            open_settings(view);
            gtk::glib::Propagation::Stop
        }
        // The bar's own menu, reachable without a pointer.
        (false, false, key) if key == gdk::keys::constants::F10 => {
            bar_menu(window, view, None);
            gtk::glib::Propagation::Stop
        }
        (false, _, key) if key == gdk::keys::constants::F11 => {
            if is_fullscreen(window) {
                window.unfullscreen();
            } else {
                window.fullscreen();
            }
            gtk::glib::Propagation::Stop
        }
        _ => gtk::glib::Propagation::Proceed,
    }
}
