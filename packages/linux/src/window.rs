/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The window: a borderless GTK window whose page IS the title bar.
 *
 * Three things are decided here, and each has a measured reason.
 *
 * 1. **The window is undecorated.** GTK draws its own header bar otherwise, and
 *    a page that draws a 40px bar under a 37px native one is two title bars. The
 *    page's header carries `data-drag-region` and the shell moves the window
 *    from the page's own report (see `bridge.rs`).
 *
 * 2. **The edges still resize.** An undecorated window has no resize border, so
 *    the webview's own press handler starts a `begin_resize_drag` when the press
 *    lands within `RESIZE_BORDER_PX` of an edge or corner — the same shape Tauri
 *    and tao use on Linux, because the platform offers nothing else. Measured
 *    under Xvfb + openbox: a press on the west edge and a drag to the left
 *    widened the window.
 *
 * 3. **The webview fills the window, and the page draws the controls.** A
 *    `GtkOverlay` child DOES receive clicks over a webview (measured), so native
 *    buttons would work — but the page already draws minimise / maximise / close
 *    for the Windows shell, and a second set would be a second thing to keep in
 *    step. `windowControls: true` is what tells the page to draw them.
 *
 * Everything a native title bar does for free then has to be done here, and the
 * rest of this file is the list: double-click (from the page's `dblclick`), the
 * bar's own menu (right-click), the standard shortcuts, and full screen.
 */

use gtk::prelude::*;
use gtk::gdk;
use webkit2gtk::{SettingsExt, WebInspectorExt, WebView, WebViewExt};

use crate::APP_NAME;

/// How close to an edge a press must land to start a resize, in device pixels.
///
/// 5 is what GTK's own client-side decorations use, and what tao hard-codes for
/// an undecorated Linux window; a thinner band is unhittable with a mouse.
pub const RESIZE_BORDER_PX: f64 = 5.0;

/// Which edge a press at `(x, y)` in a `width`×`height` window resizes from.
///
/// Pure, and stated once, because the corner cases are the ones that get a
/// window stuck: a press in the top-left 5px must resize diagonally, not pick
/// one axis and ignore the other. `None` means the press is not on an edge and
/// belongs to the page.
pub fn edge_at(x: f64, y: f64, width: f64, height: f64) -> Option<gdk::WindowEdge> {
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    let left = x < RESIZE_BORDER_PX;
    let right = x > width - RESIZE_BORDER_PX;
    let top = y < RESIZE_BORDER_PX;
    let bottom = y > height - RESIZE_BORDER_PX;

    match (left, right, top, bottom) {
        (true, _, true, _) => Some(gdk::WindowEdge::NorthWest),
        (_, true, true, _) => Some(gdk::WindowEdge::NorthEast),
        (true, _, _, true) => Some(gdk::WindowEdge::SouthWest),
        (_, true, _, true) => Some(gdk::WindowEdge::SouthEast),
        (true, _, _, _) => Some(gdk::WindowEdge::West),
        (_, true, _, _) => Some(gdk::WindowEdge::East),
        (_, _, true, _) => Some(gdk::WindowEdge::North),
        (_, _, _, true) => Some(gdk::WindowEdge::South),
        _ => None,
    }
}

/// The cursor a press at `(x, y)` should show, so the edge is discoverable
/// before it is grabbed.
pub fn cursor_for(x: f64, y: f64, width: f64, height: f64) -> &'static str {
    match edge_at(x, y, width, height) {
        Some(gdk::WindowEdge::NorthWest) => "nw-resize",
        Some(gdk::WindowEdge::NorthEast) => "ne-resize",
        Some(gdk::WindowEdge::SouthWest) => "sw-resize",
        Some(gdk::WindowEdge::SouthEast) => "se-resize",
        Some(gdk::WindowEdge::West) => "w-resize",
        Some(gdk::WindowEdge::East) => "e-resize",
        Some(gdk::WindowEdge::North) => "n-resize",
        Some(gdk::WindowEdge::South) => "s-resize",
        _ => "default",
    }
}

/// True when the window is in full screen.
///
/// GTK has no `is_fullscreen()`; the state is a flag on the window's own
/// `window_state`, which is also what the window manager writes back.
pub fn is_fullscreen(window: &gtk::Window) -> bool {
    window
        .window()
        .map(|gdk_window| gdk_window.state().contains(gdk::WindowState::FULLSCREEN))
        .unwrap_or(false)
}

/// Build the window chrome: undecorated, resizable, page-sized.
pub fn make_window() -> gtk::Window {
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title(APP_NAME);
    window.set_decorated(false);
    window.set_resizable(true);
    window.set_default_size(1280, 860);
    window.set_size_request(720, 480);
    window.set_position(gtk::WindowPosition::Center);
    window
}

/**
 * Wire the two gestures GTK cannot get from the page: the edge resize, and the
 * cursor that advertises it.
 *
 * The webview is the widget that receives the press (measured: a press inside a
 * `WebView` reaches the webview's own handler and the window's, and the
 * webview's handler can stop it), so the edge test runs there and a press on an
 * edge never reaches the page.
 */
pub fn wire_edge_resize(window: &gtk::Window, view: &WebView) {
    view.add_events(gdk::EventMask::BUTTON_PRESS_MASK | gdk::EventMask::POINTER_MOTION_MASK);

    let win = window.clone();
    view.connect_button_press_event(move |_view, event| {
        if event.button() != 1 {
            return gtk::glib::Propagation::Proceed;
        }
        let (x, y) = event.position();
        let width = win.allocated_width() as f64;
        let height = win.allocated_height() as f64;
        // A maximised or full-screen window has no edges to drag: resizing it
        // would leave it in a state the window manager did not ask for.
        if win.is_maximized() || is_fullscreen(&win) {
            return gtk::glib::Propagation::Proceed;
        }
        match edge_at(x, y, width, height) {
            Some(edge) => {
                let (root_x, root_y) = event.root();
                win.begin_resize_drag(
                    edge,
                    1,
                    root_x as i32,
                    root_y as i32,
                    event.time(),
                );
                gtk::glib::Propagation::Stop
            }
            None => gtk::glib::Propagation::Proceed,
        }
    });

    let win = window.clone();
    view.connect_motion_notify_event(move |view, event| {
        let (x, y) = event.position();
        let name = cursor_for(
            x,
            y,
            win.allocated_width() as f64,
            win.allocated_height() as f64,
        );
        if let (Some(gdk_window), Some(display)) = (event.window(), gdk::Display::default()) {
            if let Some(cursor) = gdk::Cursor::from_name(&display, name) {
                gdk_window.set_cursor(Some(&cursor));
            }
        }
        let _ = view;
        gtk::glib::Propagation::Proceed
    });
}

/// What a double-click on the bar should do.
///
/// Linux exposes the preference as `gtk-titlebar-double-click` with three
/// values — `toggle-maximize` (the GTK default), `maximize`, and `minimize` —
/// and a native title bar obeys it. A page-drawn bar has to read it itself, or a
/// user who set "minimise" gets a window that zooms instead. Matched
/// case-insensitively because the value is user-editable through `gsettings`
/// and `~/.config/gtk-3.0/settings.ini`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DoubleClickAction {
    ToggleMaximize,
    Maximize,
    Minimize,
}

impl DoubleClickAction {
    pub fn from_preference(raw: Option<&str>) -> Self {
        match raw.map(|value| value.trim().to_lowercase()).as_deref() {
            Some("minimize") => Self::Minimize,
            Some("maximize") => Self::Maximize,
            // Unset, or a value this build does not know: GTK's own default.
            _ => Self::ToggleMaximize,
        }
    }

    /// The preference as this process sees it.
    pub fn current() -> Self {
        let raw = gtk::Settings::default()
            .and_then(|settings| settings.gtk_titlebar_double_click())
            .map(|value| value.to_string());
        Self::from_preference(raw.as_deref())
    }

    /// Apply it to `window`, returning what was done (for the log).
    pub fn apply(self, window: &gtk::Window) -> &'static str {
        match self {
            Self::Minimize => {
                window.iconify();
                "minimize"
            }
            Self::Maximize => {
                window.maximize();
                "maximize"
            }
            Self::ToggleMaximize => {
                if window.is_maximized() {
                    window.unmaximize();
                    "restore"
                } else {
                    window.maximize();
                    "maximize"
                }
            }
        }
    }
}

/// The bar's own menu: the items a native title bar offers on right-click.
///
/// `GtkWindow` has no automatic menu for a page-drawn bar, and the window
/// manager's own is reachable only through its decorations — which this window
/// does not have. Every item acts on the window or the page, so nothing here is
/// a stub, and the set is the macOS shell's View menu: the actions a browser
/// window would offer are the ones a console needs, since the console IS a web
/// page and its own chrome has no menu bar.
pub fn bar_menu(window: &gtk::Window, view: &WebView, trigger: Option<&gdk::Event>) -> gtk::Menu {
    let menu = gtk::Menu::new();

    // Move Window first, as a native bar's own menu does. It runs the same path
    // the header's drag does — the pointer's ROOT position plus
    // `begin_move_drag` — because a menu activation consumes its click and
    // leaves no press for a drag to follow.
    let move_item = gtk::MenuItem::with_label("Move Window");
    let window_for_move = window.clone();
    move_item.connect_activate(move |_| {
        let (x, y) = pointer_position();
        window_for_move.begin_move_drag(1, x, y, gdk::ffi::GDK_CURRENT_TIME as u32);
    });
    menu.append(&move_item);

    menu.append(&gtk::SeparatorMenuItem::new());

    let reload = gtk::MenuItem::with_label("Reload");
    let view_for_reload = view.clone();
    reload.connect_activate(move |_| view_for_reload.reload());
    menu.append(&reload);

    let devtools = gtk::MenuItem::with_label("Toggle Developer Tools");
    let view_for_devtools = view.clone();
    devtools.connect_activate(move |_| toggle_inspector(&view_for_devtools));
    menu.append(&devtools);

    // The console's own settings, opened through the event the client listens
    // for (`omp:open-settings`). The macOS shell sends the same event from its
    // App menu; both shells ask the PAGE, because every settings screen is a
    // client-rendered modal and neither shell has a native panel to show.
    let settings = gtk::MenuItem::with_label("Settings…");
    let view_for_settings = view.clone();
    settings.connect_activate(move |_| open_settings(&view_for_settings));
    menu.append(&settings);

    // The About panel lives in this menu because a Linux app has no application
    // menu to hold it: the macOS shell's "About Kabmo" is the AppKit menu, and GTK
    // offers nothing equivalent for a window that draws its own bar.
    let about = gtk::MenuItem::with_label("About Kabmo");
    let window_for_about = window.clone();
    about.connect_activate(move |_| show_about(&window_for_about));
    menu.append(&about);

    menu.append(&gtk::SeparatorMenuItem::new());

    let actual = gtk::MenuItem::with_label("Actual Size");
    let view_for_actual = view.clone();
    actual.connect_activate(move |_| reset_zoom(&view_for_actual));
    menu.append(&actual);

    let zoom_in = gtk::MenuItem::with_label("Zoom In");
    let view_for_in = view.clone();
    zoom_in.connect_activate(move |_| zoom_by(&view_for_in, ZOOM_STEP));
    menu.append(&zoom_in);

    let zoom_out = gtk::MenuItem::with_label("Zoom Out");
    let view_for_out = view.clone();
    zoom_out.connect_activate(move |_| zoom_by(&view_for_out, 1.0 / ZOOM_STEP));
    menu.append(&zoom_out);

    menu.append(&gtk::SeparatorMenuItem::new());

    let minimise = gtk::MenuItem::with_label("Minimize");
    let window_for_minimise = window.clone();
    minimise.connect_activate(move |_| window_for_minimise.iconify());
    menu.append(&minimise);

    let zoom = gtk::MenuItem::with_label(if window.is_maximized() { "Restore" } else { "Zoom" });
    let window_for_zoom = window.clone();
    zoom.connect_activate(move |_| {
        if window_for_zoom.is_maximized() {
            window_for_zoom.unmaximize();
        } else {
            window_for_zoom.maximize();
        }
    });
    menu.append(&zoom);

    let full = gtk::MenuItem::with_label(if is_fullscreen(window) {
        "Exit Full Screen"
    } else {
        "Enter Full Screen"
    });
    let window_for_full = window.clone();
    full.connect_activate(move |_| {
        if is_fullscreen(&window_for_full) {
            window_for_full.unfullscreen();
        } else {
            window_for_full.fullscreen();
        }
    });
    menu.append(&full);

    menu.append(&gtk::SeparatorMenuItem::new());

    let close = gtk::MenuItem::with_label("Close");
    let window_for_close = window.clone();
    close.connect_activate(move |_| window_for_close.close());
    menu.append(&close);

    menu.show_all();
    popup_menu(&menu, view, trigger);
    menu
}

/// Show `menu` where the press happened.
///
/// The TRIGGER EVENT is what GTK positions a menu from, and a menu raised from a
/// script message has none of its own — the press arrived in the webview and the
/// page reported the intent afterwards. So the caller hands over the press it
/// already saw, which makes the menu appear exactly where the user clicked.
/// Without it GTK warns `no trigger event for menu popup` and falls back to the
/// pointer; that fallback is kept for a keyboard-opened menu, where there is no
/// press to hand over.
fn popup_menu(menu: &gtk::Menu, view: &WebView, trigger: Option<&gdk::Event>) {
    if let Some(event) = trigger {
        menu.popup_at_pointer(Some(event));
        return;
    }
    // `WidgetExt::window()` is the gdk window GTK draws the widget into; the
    // `gdk_window()` spelling exists only on the gdk types themselves.
    let Some(gdk_window) = view.window() else {
        return;
    };
    let display = gdk::Display::default();
    let (root_x, root_y) = display
        .and_then(|display| display.default_seat())
        .and_then(|seat| seat.pointer())
        .map(|pointer| {
            let (_, x, y) = pointer.position();
            (x, y)
        })
        .unwrap_or((0, 0));
    let (window_x, window_y) = gdk_window.position();
    let rect = gdk::Rectangle::new(root_x - window_x, root_y - window_y, 1, 1);
    menu.popup_at_rect(
        &gdk_window,
        &rect,
        gdk::Gravity::SouthWest,
        gdk::Gravity::NorthWest,
        None,
    );
}

/// The last press the webview saw, for the bar's menu.
///
/// Recorded here rather than in the app so the two shells' rule stays in one
/// place: a menu raised from a page-reported intent still needs the EVENT that
/// produced it, and only the widget that received the press has it.
pub fn remember_press(slot: &std::rc::Rc<std::cell::RefCell<Option<gdk::Event>>>, event: &gdk::Event) {
    *slot.borrow_mut() = Some(event.clone());
}

/// Ask the page to open its own settings.
///
/// The console dispatches `omp:open-settings` from its sidebar and its keymap, and
/// listens for it in both layouts — so a shell menu that wants that panel sends
/// the same event rather than inventing a URL.
pub fn open_settings(view: &WebView) {
    view.run_javascript(
        "window.dispatchEvent(new CustomEvent('omp:open-settings', { detail: {} }));",
        None::<&gtk::gio::Cancellable>,
        |_| {},
    );
}

/// Where the hardware pointer is, in ROOT coordinates.
///
/// `begin_move_drag` wants a position and a timestamp, and the position must be
/// the root one: a widget-local coordinate is read as an offset from the window's
/// own origin, which only matches the pointer when the window sits at 0,0.
/// Measured under Xvfb + openbox: local coordinates started the drag and the
/// window did not follow; root coordinates moved it.
pub fn pointer_position() -> (i32, i32) {
    gdk::Display::default()
        .and_then(|display| display.default_seat())
        .and_then(|seat| seat.pointer())
        .map(|pointer| {
            let (_, x, y) = pointer.position();
            (x, y)
        })
        .unwrap_or((0, 0))
}

/// The zoom bounds, and the step that walks between them.
///
/// Stated once, and the same pair the macOS shell uses: below `MIN_ZOOM` a
/// console's own text is unreadable, and above `MAX_ZOOM` a panel layout has
/// nowhere to put its columns. `zoom_by` is the ONE walk, because the bar's menu
/// and the keyboard shortcuts are two ways into the same three steps — a second
/// copy is how `Ctrl++` and "Zoom In" end up stopping at different levels.
pub const MIN_ZOOM: f64 = 0.5;
pub const MAX_ZOOM: f64 = 3.0;
pub const ZOOM_STEP: f64 = 1.1;

/// Where one zoom step lands, clamped to the shared bounds.
///
/// Pure, so the rules suite can walk the whole ladder without a window: the
/// clamping is what stops `Ctrl+-` from reaching a zoom the menu would refuse,
/// and a bound tested only through a WebView is a bound nobody checks.
pub fn zoom_target(current: f64, factor: f64) -> f64 {
    (current * factor).clamp(MIN_ZOOM, MAX_ZOOM)
}

/// Multiply the page zoom, clamped to the shared bounds.
pub fn zoom_by(view: &WebView, factor: f64) {
    view.set_zoom_level(zoom_target(view.zoom_level(), factor));
}

/// Back to 100%.
pub fn reset_zoom(view: &WebView) {
    view.set_zoom_level(1.0);
}

/// Open or close the page inspector.
///
/// `is_attached()` is the only state the inspector exposes, so it is what the
/// toggle reads: asking WebKit to show an attached inspector is a no-op, and a
/// menu item that appears to do nothing is worse than one that closes it.
pub fn toggle_inspector(view: &WebView) {
    if let Some(inspector) = view.inspector() {
        if inspector.is_attached() {
            inspector.close();
        } else {
            inspector.show();
        }
    }
}

/// The webview's own settings.
///
/// Developer extras are on unconditionally: the shell is a developer console,
/// and `Ctrl+Shift+I` opens the inspector on the page the user is debugging.
/// Without this the inspector does not exist at all (`view.inspector()` is
/// `None`, measured).
pub fn configure_view(view: &WebView) {
    if let Some(settings) = WebViewExt::settings(view) {
        settings.set_enable_developer_extras(true);
        settings.set_enable_webaudio(true);
        settings.set_enable_webgl(true);
        // A console page is not an article: it needs the clipboard, and a
        // webview that refuses `navigator.clipboard` silently breaks Copy.
        settings.set_enable_write_console_messages_to_stdout(false);
        settings.set_javascript_can_access_clipboard(true);
    }
    // The page draws its own background; a white flash between the splash and
    // the first paint is what this avoids.
    view.set_background_color(&gdk::RGBA::new(0.98, 0.97, 0.95, 1.0));
}

// ------------------------------------------------------------------ geometry

/// The window's remembered position and size, as a small `key=value` document.
///
/// The macOS shell gets this from `setFrameAutosaveName` and Windows from the
/// window's own placement. GTK has neither: an undecorated window that is not
/// given a position lands wherever the window manager decides, so every launch
/// put the console somewhere new. One file, read at startup and written when the
/// window settles, is the smallest thing that behaves like the other two shells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// The size a fresh install opens at, and the floor every restore is clamped to.
pub const DEFAULT_WIDTH: i32 = 1280;
pub const DEFAULT_HEIGHT: i32 = 860;
pub const MIN_WIDTH: i32 = 720;
pub const MIN_HEIGHT: i32 = 480;

impl Default for Geometry {
    fn default() -> Self {
        Self {
            x: -1,
            y: -1,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
        }
    }
}

impl Geometry {
    /// Parse `x=…\ny=…\nwidth=…\nheight=…`.
    ///
    /// A missing or nonsensical value falls back to the default for THAT field
    /// rather than discarding the whole file: a size-only entry (the first launch
    /// wrote no position) must not throw away the size.
    pub fn parse(text: &str) -> Self {
        let mut geometry = Self::default();
        for line in text.lines() {
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let Ok(number) = value.trim().parse::<i32>() else {
                continue;
            };
            match key.trim() {
                "x" => geometry.x = number,
                "y" => geometry.y = number,
                "width" => geometry.width = number,
                "height" => geometry.height = number,
                _ => {}
            }
        }
        geometry.clamp()
    }

    /// Keep a restored size usable.
    ///
    /// A window smaller than the floor cannot be resized by a keyboard, and one
    /// larger than the screen opens with its edges off it — both are states a
    /// user can only escape by editing the file.
    pub fn clamp(self) -> Self {
        Self {
            x: self.x,
            y: self.y,
            width: self.width.max(MIN_WIDTH),
            height: self.height.max(MIN_HEIGHT),
        }
    }

    pub fn serialise(&self) -> String {
        format!(
            "x={}\ny={}\nwidth={}\nheight={}\n",
            self.x, self.y, self.width, self.height
        )
    }

    /// True when a position was recorded, so a restore does not move the window
    /// to (-1,-1) — which is off every screen.
    pub fn has_position(&self) -> bool {
        self.x >= 0 && self.y >= 0
    }
}

/// Open the About panel, with the version the binary reports.
///
/// The macOS shell gets `orderFrontStandardAboutPanel` from the system; GTK has
/// `GtkAboutDialog`, which draws the same thing from the same facts. The version
/// comes from `build.rs`, never a literal — a panel naming a build the pipeline
/// did not publish is the failure this shares with the bridge's `shellVersion`.
pub fn show_about(parent: &gtk::Window) {
    let dialog = gtk::AboutDialog::new();
    dialog.set_program_name(APP_NAME);
    dialog.set_version(Some(env!("KABMO_SHELL_VERSION")));
    dialog.set_comments(Some(
        "Web console and diagnostic workbench for AI coding agents.",
    ));
    dialog.set_website(Some("https://github.com/kabmo-labs/kabmo"));
    dialog.set_website_label(Some("github.com/kabmo-labs/kabmo"));
    dialog.set_license_type(gtk::License::MitX11);
    dialog.set_transient_for(Some(parent));
    dialog.set_modal(true);
    dialog.connect_response(|dialog, _| dialog.close());
    dialog.show_all();
}
