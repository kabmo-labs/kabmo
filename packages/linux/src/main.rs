/**
 * @license
 * SPDX-License-Identifier: MIT
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

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;

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
use kabmo_desktop::open_paths::{launch_paths, open_paths_script, OpenPathQueue};
use kabmo_desktop::APP_NAME;
use kabmo_desktop::palette::ShellPalette;
use kabmo_desktop::persisted::{read_state, write_state};
use kabmo_desktop::splash::Progress;
use kabmo_desktop::splash_view::Splash;
use kabmo_desktop::store::ServerStore;
use kabmo_desktop::system::{Supervisor, SystemDeps};
use kabmo_desktop::update;
use kabmo_desktop::update_run;
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

    // `HANDLES_OPEN` is what makes this app a DOCUMENT handler: without it a
    // file manager's "Open With" starts a second process that ignores the file,
    // and `GApplication` logs "This application can not open files". With it, a
    // launch that carried files emits `open` INSTEAD of `activate`, so both
    // signals have to build the shell — see `ensure_shell`.
    let app = gtk::Application::new(
        Some("dev.kabmo.desktop"),
        gtk::gio::ApplicationFlags::HANDLES_OPEN,
    );

    // argv, captured BEFORE any GTK object exists: `Kabmo report.pdf` is what a
    // desktop entry's `%F` produces, and `std::env::args` is only trustworthy
    // this early.
    let launch = launch_paths(&std::env::args().collect::<Vec<_>>());

    // One shell for the process, built by whichever signal arrives first. A
    // `RefCell` rather than a `OnceCell` because the open handler also needs to
    // reach it, and `Rc` because GTK callbacks are single-threaded.
    //
    // The application handle is CLONED into a shared cell rather than taken from
    // a signal's own parameter: `connect_open` hands the closure `&Self`, and
    // depending on that type would make this file compile only for one spelling
    // of the trait. A clone is the same object and needs no inference.
    let shell: Rc<RefCell<Option<Rc<Shell>>>> = Rc::new(RefCell::new(None));
    let application = Rc::new(app.clone());

    {
        let shell = shell.clone();
        let application = application.clone();
        let launch = launch.clone();
        app.connect_activate(move |_app| {
            ensure_shell(&application, &shell, &launch);
        });
    }
    {
        let shell = shell.clone();
        let application = application.clone();
        app.connect_open(move |_app, files, _hint| {
            let paths: Vec<String> = files
                .iter()
                .filter_map(|file| file.path().map(|path| path.to_string_lossy().to_string()))
                .collect();
            // The argv batch is queued by `ensure_shell`, which runs once — so a
            // later activation from the dock cannot re-queue the file the app was
            // LAUNCHED with. What arrives here is always new.
            ensure_shell(&application, &shell, &[]);
            if let Some(built) = shell.borrow().as_ref() {
                built.queue_launch_paths(&paths);
            }
        });
    }

    app.run();
}

/// The shell for this process, building it on first use.
///
/// A launch that carried files arrives as `open` and never as `activate`, so a
/// shell built only from `activate` would be missing exactly when the user
/// double-clicked a document. `launch` is queued only when the shell is actually
/// built, which is what keeps a later activation from reopening the file the app
/// started with.
fn ensure_shell(
    app: &gtk::Application,
    slot: &Rc<RefCell<Option<Rc<Shell>>>>,
    launch: &[String],
) -> Rc<Shell> {
    if let Some(shell) = slot.borrow().as_ref() {
        return shell.clone();
    }
    let shell = Rc::new(Shell::new(app));
    *slot.borrow_mut() = Some(shell.clone());
    shell.start();
    if !launch.is_empty() {
        shell.queue_launch_paths(launch);
    }
    shell
}

struct Shell {
    window: gtk::Window,
    view: WebView,
    splash: Rc<Splash>,
    supervisor: Arc<Supervisor>,
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
    /// True once a page has finished a load, so a flush is worth attempting.
    ///
    /// A shared `Cell` because the navigation callback owns the only place it
    /// changes, and the `open` signal reads it from outside.
    page_ready: Rc<Cell<bool>>,
    /// The files the OS handed over that the page has not taken yet.
    ///
    /// On the shell (and shared with `main`) rather than owned by `main`: a
    /// flush needs the queue and the view together, and `Shell` owns the view.
    opened: Rc<RefCell<OpenPathQueue>>,
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

        let supervisor = Arc::new(Supervisor::new());
        let store = Rc::new(RefCell::new(ServerStore::new(
            SystemDeps {
                supervisor: supervisor.clone(),
            },
            read_state,
            |state| write_state(state),
        )));

        // The palette the console reported on a PREVIOUS launch, so the splash is
        // already the right colour before anything loads. Read from the same
        // state file the store loads, so the two cannot disagree about what was
        // written.
        splash.apply_palette(store.borrow().palette());

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
            page_ready: Rc::new(Cell::new(false)),
            opened: Rc::new(RefCell::new(OpenPathQueue::new())),
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

    /// Queue files the OS handed over and hand them to the page if it can take
    /// them yet.
    ///
    /// Called from `activate` and `open` — whichever the launch produced — and
    /// the queue is drained on a finished load, because that is the first moment
    /// a page can answer. Before that the paths simply wait, which is what makes
    /// a cold start work: the file exists before the console does.
    fn queue_launch_paths(&self, paths: &[String]) {
        self.opened.borrow_mut().add(paths);
        flush_queued_paths(&self.view, &self.opened, &self.page_ready);
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
        let shown_uri = self.shown_uri.clone();
        let progress = self.progress.clone();
        let splash = self.splash.clone();
        let last_press = self.last_press.clone();
        // One update at a time, for as long as a download is in flight. The
        // window stays usable while it runs — that is the point of threading it —
        // so a second press is reachable, and two downloads would race the same
        // staged file while two relaunches fought over the managed server's port.
        let update_busy: Rc<Cell<bool>> = Rc::new(Cell::new(false));

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

            // An update downloads for as long as the release asset takes — its
            // own read timeout is 120 s — and this callback runs on the GTK main
            // loop. Handled inline it froze the window for the whole download,
            // and a busy loop cannot run `delete_event` either: the shell was
            // uncloseable for as long as an update ran. See `start_update`.
            if call.method == "update_apply" {
                start_update(call.id, &call.params, &view, &window, &update_busy);
                return;
            }

            let answer = handle_command(&call.method, &call.params, &window, &store);
            let script = match answer {
                Ok(payload) => {
                    // A command that STARTED a server is not answered — and the
                    // window does not move — until that server answers
                    // `/api/health`: the wait is up to `START_TIMEOUT` and this
                    // callback is the GTK loop. The reply is held here and handed
                    // over from the loop when the worker lands (`start_server`).
                    if payload.get("__await").is_some() {
                        let awaiting = payload.get("__await").cloned().unwrap_or(Value::Null);
                        start_server(
                            call.id,
                            &awaiting,
                            without_markers(payload),
                            &view,
                            &store,
                            &current_url,
                            &shown_uri,
                            &progress,
                            &splash,
                        );
                        return;
                    }
                    // A command that moved the window to another server also
                    // reloads it: the page that asked is about to be replaced,
                    // so its own state would be the previous server's.
                    if let Some(url) = payload.get("__navigate").and_then(|value| value.as_str()) {
                        begin_load(&view, &current_url, &shown_uri, &progress, &splash, url);
                    }
                    reply_script(call.id, true, &without_markers(payload))
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
        // Handed to the `Finished` branch: the palette read needs the store (to
        // persist) and the splash (to repaint), and both outlive the callback.
        let store_for_palette = self.store.clone();
        let splash_for_palette = self.splash.clone();
        // The queue and the view, cloned for the callback: a flush needs both and
        // the closure outlives this borrow.
        let page_ready_for_open = self.page_ready.clone();
        let opened_for_flush = self.opened.clone();
        let view_for_flush = self.view.clone();
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
                    // The console has painted, so `window.__kabmoPalette()`
                    // answers the ACTIVE theme. Stored for the next cold start —
                    // the only launch where the splash has no page to ask — and
                    // applied to the live splash too, because a theme changed in
                    // Settings is exactly the case where the stored palette is
                    // stale and the splash it describes is on screen.
                    read_palette(view, &store_for_palette, &splash_for_palette);
                    // A page can take the files the OS handed over only once it
                    // exists. The launch batch was queued before the window was
                    // built, and a warm open can land before the current
                    // navigation settles — both are drained here.
                    page_ready_for_open.set(true);
                    flush_queued_paths(&view_for_flush, &opened_for_flush, &page_ready_for_open);
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
            //
            // The stop runs on its OWN thread, and the quit is posted back to
            // the loop. `stop_all` waits for each child to die (SIGTERM, then
            // a bounded SIGKILL escalation), and doing that on the GTK main
            // loop froze the window for the whole wait — the reported "not
            // responding" on quit. The work needs nothing from GTK (the
            // supervisor's state is behind a `Mutex`), and only the final
            // `main_quit` has to be on the loop.
            //
            // `Propagation::Stop` keeps the window up until that quit runs, so
            // the servers are gone before the app is.
            save_geometry(&window_for_save);
            // A CLONE per press: this is an `Fn` closure, so moving the captured
            // `Arc` into the thread would move it out of the handler itself.
            let supervisor = supervisor.clone();
            std::thread::spawn(move || {
                supervisor.stop_all();
                // `MainContext::invoke` is the cross-thread way onto the GTK
                // loop — `idle_add_local` must be CALLED from the main thread,
                // and this is not it. The closure needs nothing from GTK
                // beyond the quit itself, so it stays `Send`.
                gtk::glib::MainContext::default().invoke(gtk::main_quit);
            });
            gtk::glib::Propagation::Stop
        });
    }

    // ---------------------------------------------------------------- palette

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
        begin_load(
            &self.view,
            &self.current_url,
            &self.shown_uri,
            &self.progress,
            &self.splash,
            url,
        );
    }
}

/// Begin a load on the objects that outlive the window's owner.
///
/// A free function because the deferred paths — a server that just started, a
/// navigation the bridge asked for — run from a run-loop callback that owns the
/// Rcs rather than the `Shell`. One body means the retry address
/// (`current_url`), the reload latch (`shown_uri`) and the splash cannot be
/// updated in one path and forgotten in another.
fn begin_load(
    view: &WebView,
    current_url: &Rc<RefCell<String>>,
    shown_uri: &Rc<RefCell<Option<String>>>,
    progress: &Rc<RefCell<Progress>>,
    splash: &Rc<Splash>,
    url: &str,
) {
    *current_url.borrow_mut() = url.to_string();
    *shown_uri.borrow_mut() = None;
    *progress.borrow_mut() = Progress::connecting();
    splash.show_progress(*progress.borrow());
    view.load_uri(url);
}

/// Hand the queued files to the page, when there is a page.
///
/// `run_javascript` and not the bridge: the page's handler is a plain function
/// (`window.__kabmoOpenPaths`), and the answer carries nothing this side needs —
/// the console reports its own refusals, which is the only place a sentence
/// about a file can be read.
fn flush_queued_paths(
    view: &WebView,
    opened: &Rc<RefCell<OpenPathQueue>>,
    page_ready: &Rc<Cell<bool>>,
) {
    if !page_ready.get() {
        return;
    }
    let paths = opened.borrow_mut().take();
    if paths.is_empty() {
        return;
    }
    view.run_javascript(&open_paths_script(&paths), None::<&gtk::gio::Cancellable>, |_| {});
}

/// Strip the shell's own markers from a payload before it reaches the page.
fn without_markers(mut value: Value) -> Value {
    if let Value::Object(map) = &mut value {
        map.remove("__navigate");
        map.remove("__await");
    }
    value
}

/**
 Answer a `servers_start`/`servers_activate` once the server really answers.

 The wait is `wait_until_ready`, which probes `/api/health` for up to
 `START_TIMEOUT` (45 s). It used to run inside the bridge callback — the GTK main
 loop — so pressing Start froze the window for as long as the server took to boot,
 and a server that never booted held it for the whole budget with no close, no
 quit, and no repaint. It is a worker thread now, and the reply, the navigation
 and the splash are applied from the loop when it lands.

 A server that never answered is STOPPED before the page is told: it is still a
 child of this process, and leaving it would make the next Start answer "already
 starting on that port" for a server nothing can see.
 */
fn start_server(
    id: u64,
    awaiting: &Value,
    reply: Value,
    view: &WebView,
    store: &Rc<RefCell<ServerStore<SystemDeps>>>,
    current_url: &Rc<RefCell<String>>,
    shown_uri: &Rc<RefCell<Option<String>>>,
    progress: &Rc<RefCell<Progress>>,
    splash: &Rc<Splash>,
) {
    let url = awaiting["url"].as_str().unwrap_or_default().to_string();
    let record = awaiting["id"].as_str().unwrap_or_default().to_string();
    let pid = awaiting["pid"].as_i64().unwrap_or(0) as i32;
    let port = awaiting["port"].as_u64().unwrap_or(0) as u16;

    let (sender, receiver) = std::sync::mpsc::channel();
    let wait_url = url.clone();
    std::thread::spawn(move || {
        let _ = sender.send(kabmo_desktop::system::wait_until_ready(&wait_url, pid, port));
    });

    let view = view.clone();
    let store = store.clone();
    let current_url = current_url.clone();
    let shown_uri = shown_uri.clone();
    let progress = progress.clone();
    let splash = splash.clone();
    gtk::glib::timeout_add_local(std::time::Duration::from_millis(100), move || {
        let outcome = match receiver.try_recv() {
            Ok(outcome) => outcome,
            Err(std::sync::mpsc::TryRecvError::Empty) => return gtk::glib::ControlFlow::Continue,
            // The worker vanished without answering (a panic). The page still
            // gets an answer, or it keeps a spinner for the life of the tab.
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                Err("The local server stopped without an answer.".to_string())
            }
        };
        match outcome {
            Ok(()) => {
                begin_load(
                    &view,
                    &current_url,
                    &shown_uri,
                    &progress,
                    &splash,
                    &url,
                );
                reply_now(&view, id, true, &reply);
            }
            Err(reason) => {
                store.borrow_mut().stop(&record);
                reply_now(&view, id, false, &Value::String(reason));
            }
        }
        gtk::glib::ControlFlow::Break
    });
}

/// Ask the page which palette it is painting, and keep the answer.
///
/// The property is installed by `src/client/lib/native/palette.ts` before the
/// first render, so it exists by the time a load finishes. An older build answers
/// `undefined`, the parse returns `None`, and the stored palette is left exactly
/// as it was rather than replaced with a colour no theme chose.
///
/// `run_javascript` is asynchronous and its answer arrives as a `JSCValue` — a
/// JSON string for a JS string — so it is unwrapped here rather than in the
/// parser.
fn read_palette(
    view: &WebView,
    store: &Rc<RefCell<ServerStore<SystemDeps>>>,
    splash: &Rc<Splash>,
) {
    let store = store.clone();
    let splash = splash.clone();
    view.run_javascript(
        "window.__kabmoPalette ? window.__kabmoPalette() : null",
        None::<&gtk::gio::Cancellable>,
        move |result| {
            // `run_javascript` answers ONE argument — `Result<JavascriptResult,
            // glib::Error>` — not `(view, result)`. Measured against
            // `webkit2gtk 2.0.2`: the two-argument form is a compile error
            // (`E0593: closure is expected to take 1 argument`), which only the
            // RELEASE workflow sees because the Linux shell is compiled nowhere
            // else.
            let Ok(result) = result else { return };
            let Some(value) = result.js_value() else { return };
            // `is_string` first: `to_str` answers `undefined` for a null, and a
            // page with no publisher must leave the stored palette alone rather
            // than parse the word "undefined".
            if !value.is_string() {
                return;
            }
            let wire = value.to_str().to_string();
            let Some(next) = ShellPalette::parse(&wire) else {
                return;
            };
            store.borrow_mut().set_palette(&wire);
            splash.apply_palette(next);
        },
    );
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

/// Restart into an image that was just installed.
///
/// Deferred by a second so the reply reaches the page first — a window that
/// closed in the same tick would leave the console showing a spinner over an
/// update that worked. The spawn itself waits for this pid to exit (see
/// `update::relaunch_script`), because the managed server holds its port until
/// this process is gone.
fn schedule_relaunch(image: String, window: gtk::Window) {
    let _ = gtk::glib::timeout_add_seconds_local(1, move || {
        let path = std::path::PathBuf::from(&image);
        update_run::relaunch(&path);
        window.close();
        gtk::glib::ControlFlow::Break
    });
}

/// Answer the page from a callback that is already on the GTK loop.
fn reply_now(view: &WebView, id: u64, ok: bool, payload: &Value) {
    view.run_javascript(
        &reply_script(id, ok, payload),
        None::<&gtk::gio::Cancellable>,
        |_| {},
    );
}

/**
 Answer an update without freezing the window.

 `connect_script_message_received` runs on the GTK main loop, so a command that
 waits on the network holds the whole shell: the download's own read timeout is
 120 s (`update_run`), the window stops responding for that long, and a busy loop
 never runs `delete_event` either — the app could not be closed at all while an
 update was in flight, which is the same "must be killed from a process monitor"
 shape macOS had for a different reason.

 Everything cheap is decided HERE — the AppImage check and the one-job guard are
 answered in the same tick, so a refusal never leaves the page waiting — and only
 the blocking half goes to a thread. The answer comes back over a channel and is
 delivered by `timeout_add_local`, because the reply script and the window are GTK
 objects and belong to the loop.

 A worker that dies without answering (a panic) still answers the page: a tab
 waiting on a reply keeps a spinner for its whole life.
 */
fn start_update(
    id: u64,
    params: &Value,
    view: &WebView,
    window: &gtk::Window,
    busy: &Rc<Cell<bool>>,
) {
    let plan = match update::plan(params, std::env::var("APPIMAGE").ok().as_deref()) {
        Ok(plan) => plan,
        Err(reason) => {
            reply_now(view, id, false, &Value::String(reason));
            return;
        }
    };
    if busy.replace(true) {
        reply_now(
            view,
            id,
            false,
            &Value::String("An update is already downloading.".to_string()),
        );
        return;
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let installed = env!("KABMO_SHELL_VERSION");
        let answer = update_run::apply(&plan.url, &plan.version, installed, &plan.image)
            .map_err(|error| error.0);
        // The plan travels back with the answer: it carries the image the restart
        // needs, and re-reading `APPIMAGE` on the loop would resolve the same path
        // a second time.
        let _ = sender.send((answer, plan));
    });

    let view = view.clone();
    let window = window.clone();
    let busy = busy.clone();
    gtk::glib::timeout_add_local(std::time::Duration::from_millis(100), move || {
        let (answer, plan) = match receiver.try_recv() {
            Ok(answer) => answer,
            Err(std::sync::mpsc::TryRecvError::Empty) => return gtk::glib::ControlFlow::Continue,
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                busy.set(false);
                reply_now(
                    &view,
                    id,
                    false,
                    &Value::String("The update stopped without an answer.".to_string()),
                );
                return gtk::glib::ControlFlow::Break;
            }
        };
        busy.set(false);
        let outcome = update::outcome(answer, &plan);
        if let Some(image) = outcome.relaunch {
            schedule_relaunch(image.to_string_lossy().into_owned(), window.clone());
        }
        reply_now(&view, id, outcome.ok, &outcome.payload);
        gtk::glib::ControlFlow::Break
    });
}
