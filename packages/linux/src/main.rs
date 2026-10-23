/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell's application: one window, one bridge, two facts it owns.
 *
 * What it deliberately does NOT do, and each is a rule the other shells state
 * for the same reason:
 *
 * - **It never sets `KABMO_DATA_DIR`.** The managed server inherits the
 *   environment, so its database stays where `kabmo serve` puts it (`~/.kabmo`)
 *   and `kabmo status` keeps seeing the instance the window is on.
 * - **It does not pass `--tray`.** The server would raise a second icon.
 * - **It never proxies.** Every WebSocket upgrade is origin-checked against the
 *   `Host` header (`lib/http/same-origin.ts`), so a custom scheme in front of
 *   the server answers 403 on the realtime, terminal and dictation sockets. The
 *   webview loads the real `http://host:port` URL.
 */

use std::cell::RefCell;
use std::rc::Rc;

use gtk::gdk;
use gtk::prelude::*;
use javascriptcore::ValueExt;
use serde_json::Value;
use webkit2gtk::{
    NavigationPolicyDecisionExt, PolicyDecisionExt, PolicyDecisionType, URIRequestExt,
    UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime, WebView,
    WebViewExt,
};

use kabmo_desktop::bridge::{bootstrap_script, parse_call, reply_script, DesktopInfo};
use kabmo_desktop::APP_NAME;
use kabmo_desktop::persisted::{read_state, write_state};
use kabmo_desktop::splash::Progress;
use kabmo_desktop::splash_view::Splash;
use kabmo_desktop::store::ServerStore;
use kabmo_desktop::system::{Supervisor, SystemDeps};
use kabmo_desktop::window::{make_window, remember_press, wire_edge_resize};

mod chrome;
mod commands;

use chrome::{
    build_view, handle_chrome, handle_key, open_external, restore_geometry, same_origin,
    save_geometry,
};
use commands::handle_command;

/// The commands that are window chrome rather than bridge calls: the page posts
/// them with id 0, and there is nothing to answer.
const CHROME_COMMANDS: [&str; 3] = ["window_drag", "window_toggle", "window_menu"];

fn main() {
    // `--version` before GTK: a packaged build has to be identifiable without a
    // display, and the number is the one `version.properties` declares (through
    // `build.rs`), never the crate's.
    if std::env::args().any(|arg| arg == "--version" || arg == "-V") {
        println!("{} {}", APP_NAME, env!("KABMO_SHELL_VERSION"));
        return;
    }

    // Stated before any GTK object exists, because both are read when the first
    // window is realised and neither follows the window's own title: `prgname` is
    // what the window manager puts in `WM_CLASS` and in the taskbar, and the
    // application name is what a desktop's app menu groups by. Deriving them from
    // the executable name is what put `kabmo-desktop` in the window list on a shell
    // whose window says Kabmo — measured with `xprop WM_CLASS` before this existed.
    gtk::glib::set_prgname(Some(APP_NAME));
    gtk::glib::set_application_name(APP_NAME);

    let app = gtk::Application::new(
        Some("dev.kabmo.desktop"),
        gtk::gio::ApplicationFlags::FLAGS_NONE,
    );
    app.connect_activate(|app| Shell::new(app).start());
    app.run();
}

struct Shell {
    window: gtk::Window,
    view: WebView,
    splash: Rc<Splash>,
    supervisor: Rc<Supervisor>,
    store: Rc<RefCell<ServerStore<SystemDeps>>>,
    progress: Rc<RefCell<Progress>>,
    /// The URL the window is on, so a Retry reloads the same one.
    current_url: Rc<RefCell<String>>,
    /// The URI the view has FINISHED on.
    ///
    /// `view.uri()` is the document being loaded, not the one on screen, so it
    /// cannot answer "was this the same page?" — that answer has to be recorded
    /// when a load finishes, before the next one starts.
    shown_uri: Rc<RefCell<Option<String>>>,
    /// The last press the webview saw, so the bar's menu opens where the user
    /// clicked rather than at the pointer's current position.
    last_press: Rc<RefCell<Option<gdk::Event>>>,
    info: DesktopInfo,
}

impl Shell {
    fn new(app: &gtk::Application) -> Self {
        let window = make_window();
        window.set_application(Some(app));
        // Where the window was left, the way `setFrameAutosaveName` gives the macOS
        // shell. GTK has no equivalent for an undecorated window.
        restore_geometry(&window);

        let view = build_view();
        let overlay = gtk::Overlay::new();
        overlay.add(&view);

        let splash = Rc::new(Splash::new());
        overlay.add_overlay(&splash.widget);
        // The splash must swallow clicks while it is up: a press that reached the
        // page behind it would act on a console the user cannot see.
        overlay.set_overlay_pass_through(&splash.widget, false);

        window.add(&overlay);

        let supervisor = Rc::new(Supervisor::new());
        let store = Rc::new(RefCell::new(ServerStore::new(
            SystemDeps {
                supervisor: supervisor.clone(),
            },
            read_state,
            |state| write_state(state),
        )));

        let shell = Self {
            window,
            view,
            splash,
            supervisor,
            store,
            progress: Rc::new(RefCell::new(Progress::connecting())),
            current_url: Rc::new(RefCell::new(String::new())),
            shown_uri: Rc::new(RefCell::new(None)),
            last_press: Rc::new(RefCell::new(None)),
            info: DesktopInfo::default(),
        };
        shell.wire();
        shell
    }

    fn start(&self) {
        self.window.show_all();
        // The splash covers the window until the first probe answers; this is
        // what moves it to the server the user was last on.
        self.boot();
    }

    // ---------------------------------------------------------------- wiring

    fn wire(&self) {
        self.wire_bridge();
        self.wire_navigation();
        wire_edge_resize(&self.window, &self.view);
        {
            let slot = self.last_press.clone();
            self.view.connect_button_press_event(move |_view, event| {
                remember_press(&slot, &event);
                gtk::glib::Propagation::Proceed
            });
        }
        self.wire_keys();
        self.wire_shutdown();
    }

    /// The page ↔ shell transport, and the drag/toggle/menu intents the page
    /// reports from the presses it already receives.
    ///
    /// ONE handler for both kinds of message. A second `connect_script_message_received`
    /// would receive every call as well, and the first one to answer wins — which
    /// is how a command gets answered twice.
    fn wire_bridge(&self) {
        let Some(manager) = self.view.user_content_manager() else {
            return;
        };
        manager.register_script_message_handler("kabmo");
        manager.add_script(&UserScript::new(
            &bootstrap_script(&self.info),
            UserContentInjectedFrames::TopFrame,
            UserScriptInjectionTime::Start,
            &[],
            &[],
        ));

        let window = self.window.clone();
        let view = self.view.clone();
        let store = self.store.clone();
        let current_url = self.current_url.clone();
        let progress = self.progress.clone();
        let splash = self.splash.clone();
        let last_press = self.last_press.clone();

        manager.connect_script_message_received(Some("kabmo"), move |_manager, result| {
            let Some(value) = result.js_value() else { return };
            let Some(json) = value.to_json(0) else { return };
            let Ok(parsed) = serde_json::from_str::<Value>(&json) else {
                return;
            };
            let Some(call) = parse_call(&parsed) else { return };

            // Chrome intents carry id 0 and are answered by doing something.
            if call.id == 0 && CHROME_COMMANDS.contains(&call.method.as_str()) {
                handle_chrome(&window, &view, &call.method, &last_press);
                return;
            }

            let answer = handle_command(
                &call.method,
                &call.params,
                &window,
                &store,
                &current_url,
            );
            let script = match answer {
                Ok(payload) => {
                    // A command that moved the window to another server also
                    // reloads it: the page that asked is about to be replaced,
                    // so its own state would be the previous server's.
                    if let Some(url) = payload.get("__navigate").and_then(|value| value.as_str()) {
                        *progress.borrow_mut() = Progress::connecting();
                        splash.show_progress(*progress.borrow());
                        view.load_uri(url);
                    }
                    let clean = match payload {
                        Value::Object(mut map) => {
                            map.remove("__navigate");
                            Value::Object(map)
                        }
                        other => other,
                    };
                    reply_script(call.id, true, &clean)
                }
                Err(error) => reply_script(call.id, false, &Value::String(error.0)),
            };
            view.run_javascript(&script, None::<&gtk::gio::Cancellable>, |_| {});
        });
    }

    fn wire_navigation(&self) {
        let progress = self.progress.clone();
        let splash = self.splash.clone();
        let shown_uri = self.shown_uri.clone();
        self.view.connect_load_changed(move |view, event| {
            match event {
                webkit2gtk::LoadEvent::Started => {
                    // Only `load` and a RELOAD re-open the splash. A later in-app
                    // navigation (the login submit is one) must not flash it over a
                    // console that is already up — while a FAILED main-frame load
                    // still surfaces its reason, which is the blank-window case
                    // worth covering.
                    //
                    // The page's own Reload control is the exception, and it is
                    // what this check exists for: `location.reload()` fetches the
                    // SAME address again, which from the shell's side is a cold
                    // start in miniature — the console is replaced by a blank
                    // document while the bundle is re-fetched, and leaving the
                    // splash hidden there made the header's button look like it did
                    // nothing.
                    let started = view.uri().map(|uri| uri.to_string());
                    let shown = shown_uri.borrow().clone();
                    if Progress::is_document_reload(
                        started.as_deref(),
                        shown.as_deref(),
                        progress.borrow().phase,
                    ) {
                        *progress.borrow_mut() = Progress::connecting();
                        splash.show_progress(*progress.borrow());
                    }
                }
                webkit2gtk::LoadEvent::Committed => {
                    let next = progress.borrow().advance(view.estimated_load_progress());
                    *progress.borrow_mut() = next;
                    splash.show_progress(next);
                }
                webkit2gtk::LoadEvent::Finished => {
                    // Latched HERE, not read from `view.uri()` later: by the time
                    // the next `Started` arrives the view already points at the
                    // incoming document, so the comparison would match every
                    // navigation.
                    *shown_uri.borrow_mut() = view.uri().map(|uri| uri.to_string());
                    // Read and write in two statements: `*x.borrow_mut() = x.borrow().f()`
                    // holds both borrows at once and panics at run time.
                    let finished = progress.borrow().finish();
                    *progress.borrow_mut() = finished;
                    splash.show_progress(finished);
                }
                _ => {}
            }
        });

        // A failed load keeps the splash, with the reason. `true` means "handled":
        // without it WebKit draws its own error page over the shell's message.
        let splash_for_failure = self.splash.clone();
        let progress_for_failure = self.progress.clone();
        self.view
            .connect_load_failed(move |_view, _event, uri, error| {
                let failure = failure_for(error);
                let failed = progress_for_failure.borrow().failed_because(failure);
                *progress_for_failure.borrow_mut() = failed;
                splash_for_failure.show_failure(&format!("{uri}\n{error}"));
                true
            });

        let view_for_retry = self.view.clone();
        let url_for_retry = self.current_url.clone();
        let progress_for_retry = self.progress.clone();
        let splash_for_retry = self.splash.clone();
        self.splash.on_retry(move || {
            *progress_for_retry.borrow_mut() = Progress::connecting();
            splash_for_retry.show_progress(*progress_for_retry.borrow());
            let url = url_for_retry.borrow().clone();
            if url.is_empty() {
                view_for_retry.reload();
            } else {
                view_for_retry.load_uri(&url);
            }
        });

        // A link with `target="_blank"` (every external link in the console)
        // opens in the user's browser, never in a second webview: a console page
        // that spawned a chromeless window would have no address bar and no way
        // back.
        self.view.connect_create(|_view, action| {
            if let Some(uri) = action.request().and_then(|request| request.uri()) {
                open_external(&uri);
            }
            None
        });

        // A navigation the page did not ask for — a link to another origin, an
        // OAuth launch — leaves the console. The same-origin check is what keeps
        // a login flow from replacing the app with a provider's page.
        self.view.connect_decide_policy(|view, decision, kind| {
            if kind != PolicyDecisionType::NavigationAction {
                return false;
            }
            let Some(navigation) = decision
                .downcast_ref::<webkit2gtk::NavigationPolicyDecision>()
                .and_then(|nav| nav.navigation_action())
                .and_then(|action| action.request())
                .and_then(|request| request.uri())
            else {
                return false;
            };
            let here = view.uri().map(|uri| uri.to_string()).unwrap_or_default();
            if same_origin(&here, &navigation) {
                return false;
            }
            decision.ignore();
            open_external(&navigation);
            true
        });
    }

    /// The shortcuts, on BOTH the window and the webview.
    ///
    /// A key event is delivered to the focused widget first, and the webview
    /// consumes most of them — measured: `F11` reached the window, `Ctrl+Shift+I`
    /// did not, because WebKit handles it internally. Handling the same set on
    /// the view (and stopping propagation there) is what makes the console's
    /// shortcuts work wherever the focus is.
    fn wire_keys(&self) {
        let view = self.view.clone();
        let window = self.window.clone();
        let keys = move |window: &gtk::Window, view: &WebView, event: &gdk::EventKey| {
            handle_key(window, view, event)
        };
        let (w1, v1) = (window.clone(), view.clone());
        self.window.connect_key_press_event(move |_window, event| keys(&w1, &v1, event));
        let (w2, v2) = (window, view);
        self.view.connect_key_press_event(move |_view, event| keys(&w2, &v2, event));
    }

    fn wire_shutdown(&self) {
        let supervisor = self.supervisor.clone();
        let window_for_save = self.window.clone();
        self.window.connect_delete_event(move |_window, _event| {
            // A child server must not outlive the window that started it. A
            // force-quit cannot be caught, which is why the store records the
            // pids it spawned — the next launch adopts exactly those.
            supervisor.stop_all();
            save_geometry(&window_for_save);
            gtk::main_quit();
            gtk::glib::Propagation::Proceed
        });
    }

    // ---------------------------------------------------------------- boot

    fn boot(&self) {
        // Adopt what a previous run of THIS shell left behind before anything
        // reads the list, so the panel's Stop can reach it.
        {
            let store = self.store.borrow();
            for (id, pid) in store.orphaned_pids() {
                self.supervisor.adopt(&id, pid);
            }
        }
        let url = {
            let store = self.store.borrow();
            let state = store.snapshot();
            store.boot_url(&state)
        };
        self.load(&url);
    }

    /// Begin a load with the splash up.
    ///
    /// The state is armed BEFORE `load_uri`, because a cached document can report
    /// `Started` on the same tick: arming afterwards would let the first estimate
    /// of a real load be ignored as "already finished".
    fn load(&self, url: &str) {
        *self.current_url.borrow_mut() = url.to_string();
        *self.shown_uri.borrow_mut() = None;
        *self.progress.borrow_mut() = Progress::connecting();
        self.splash.show_progress(*self.progress.borrow());
        self.view.load_uri(url);
    }
}

/// Why a load failed, in the shell's own vocabulary.
///
/// WebKitGTK's `NetworkError` is COARSER than the other shells' error enums: it has
/// `Failed`, `Transport`, `UnknownProtocol`, `Cancelled` and `FileDoesNotExist`,
/// and nothing that separates a DNS failure from a refused connection. So the split
/// here is the one the enum can actually support, and the engine's own sentence is
/// printed under it (`show_failure`) — which is what names the address and the
/// detail in the cases this cannot tell apart.
fn failure_for(error: &gtk::glib::Error) -> kabmo_desktop::splash::Failure {
    use kabmo_desktop::splash::Failure;
    use webkit2gtk::NetworkError;

    match error.kind::<NetworkError>() {
        Some(NetworkError::Cancelled) => Failure::Other,
        Some(NetworkError::Transport) => Failure::Connect,
        Some(NetworkError::UnknownProtocol) => Failure::HostLookup,
        Some(NetworkError::FileDoesNotExist) => Failure::Other,
        _ => Failure::Other,
    }
}
