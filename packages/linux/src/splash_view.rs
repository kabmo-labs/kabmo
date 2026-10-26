/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The splash widget: the README's wordmark, a progress bar, one sentence, and a
 * Retry.
 *
 * Split from `splash.rs` (the rules) for the reason `splash.rs` states: the rules
 * are what the suite exercises and this half needs GTK. Same shape as the macOS
 * shell's `SplashState` + `SplashView`.
 */

use std::cell::RefCell;
use std::rc::Rc;

use gtk::glib;
use gtk::prelude::*;

use crate::palette::{splash_css, ShellPalette};
use crate::splash::{sentence_for, Failure, Phase, Progress};
use crate::wordmark;

/// The splash widget: a wordmark, a line of status, a bar and a Retry.
pub struct Splash {
    pub widget: gtk::Box,
    label: gtk::Label,
    bar: gtk::ProgressBar,
    retry: gtk::Button,
    wordmark: gtk::DrawingArea,
    /// The stylesheet provider, held so a palette change can reload it.
    ///
    /// A `CssProvider` is loaded once and applied for the screen; replacing its
    /// contents is what repaints every rule at once, and holding the handle is
    /// what makes that possible without a second provider per launch.
    style: gtk::CssProvider,
    /// The colours in force. Replaced by `apply_palette`.
    ///
    /// A `RefCell` because the splash is held in an `Rc` and every caller has a
    /// shared reference to it — the same reason `pulse` is one.
    palette: RefCell<ShellPalette>,
    /// The sweep timer, while the bar is indeterminate.
    ///
    /// `GtkProgressBar::pulse` advances the block by ONE step per call — a single
    /// call draws a block parked at a fixed position, which is the stuck look the
    /// indeterminate state exists to avoid. The timer is what makes it move, and
    /// holding its `SourceId` is what stops it (a source that outlives the phase
    /// keeps pulsing a bar that now carries a percentage).
    pulse: Rc<RefCell<Option<glib::SourceId>>>,
}

impl Splash {
    pub fn new() -> Self {
        // TWO widgets, and the split is the whole point: `GtkOverlay` allocates
        // its overlay child at the child's OWN requested size and honours that
        // child's alignment, so a single box carrying `halign/valign = Center`
        // was allocated 180x105 inside a 2200x1300 window (measured under Xvfb).
        // A splash that small covers nothing — the page shows around it, and a
        // press outside it reaches a console the user cannot see, which is
        // exactly what `set_overlay_pass_through(false)` is meant to prevent.
        //
        // So the OUTER box FILLS and paints the paper, and the column inside it
        // centres the content.
        let widget = gtk::Box::new(gtk::Orientation::Vertical, 0);
        widget.set_halign(gtk::Align::Fill);
        widget.set_valign(gtk::Align::Fill);
        widget.set_hexpand(true);
        widget.set_vexpand(true);
        widget.style_context().add_class("kabmo-splash");

        let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
        column.set_valign(gtk::Align::Center);
        column.set_halign(gtk::Align::Center);
        column.set_hexpand(true);
        column.set_vexpand(true);

        // The wordmark is the ARTWORK, not the app's name in a label: it is the
        // same lockup README.md embeds (`public/kabmo-wordmark.svg`), painted from
        // the SVG's own path data because GTK has no renderer for one.
        //
        // 180 x 58 is the artwork's own aspect at the size the other shells use,
        // fixed rather than derived so the column's height does not depend on how
        // a toolkit measures the mark.
        let wordmark_area = gtk::DrawingArea::new();
        wordmark_area.set_size_request(180, 58);
        wordmark_area.set_margin_bottom(16);
        wordmark_area.connect_draw(|area, context| {
            let width = f64::from(area.allocated_width());
            let height = f64::from(area.allocated_height());
            if width <= 0.0 || height <= 0.0 {
                return glib::Propagation::Proceed;
            }
            // Scale the artwork to the widget and flip y: the SVG's y grows
            // upward and cairo's grows downward.
            let scale = (width / wordmark::WIDTH).min(height / wordmark::HEIGHT);
            context.save().ok();
            context.translate((width - wordmark::WIDTH * scale) / 2.0, 0.0);
            context.scale(scale, scale);
            context.translate(0.0, wordmark::HEIGHT);
            context.scale(1.0, -1.0);
            let _ = wordmark::paint(context);
            context.restore().ok();
            glib::Propagation::Proceed
        });
        column.pack_start(&wordmark_area, false, false, 0);

        let bar = gtk::ProgressBar::new();
        bar.set_size_request(180, 4);
        bar.set_margin_top(0);
        bar.set_pulse_step(0.08);
        // The stylesheet is `palette::splash_css` — the fill's ground and the
        // bar's two colours, all of which fail silently if wrong, so all are
        // stated where the rules suite can read them. It is loaded from the
        // SHIPPED palette here and replaced by `apply_palette` once the console's
        // own is known.
        let style = gtk::CssProvider::new();
        let palette = ShellPalette::default();
        style.load_from_data(splash_css(&palette).as_bytes()).ok();
        if let Some(screen) = gtk::gdk::Screen::default() {
            gtk::StyleContext::add_provider_for_screen(
                &screen,
                &style,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }
        column.pack_start(&bar, false, false, 0);

        let label = gtk::Label::new(Some(&Progress::connecting().label()));
        label.set_line_wrap(true);
        label.set_justify(gtk::Justification::Center);
        label.set_max_width_chars(60);
        label.set_margin_top(10);
        column.pack_start(&label, false, false, 0);

        let retry = gtk::Button::with_label("Retry");
        retry.set_halign(gtk::Align::Center);
        retry.set_margin_top(18);
        retry.set_no_show_all(true);
        column.pack_start(&retry, false, false, 0);

        widget.pack_start(&column, true, true, 0);
        widget.show_all();
        retry.hide();

        Self {
            widget,
            label,
            bar,
            retry,
            wordmark: wordmark_area,
            style,
            palette: RefCell::new(palette),
            pulse: Rc::new(RefCell::new(None)),
        }
    }

    /// Repaint in `next`, keeping whatever state is on screen.
    ///
    /// The single entry point for COLOUR, and it can run on a live splash: a
    /// theme changed in Settings is exactly the case where the stored palette is
    /// stale and the splash it describes is still on screen. Everything the
    /// splash draws is CSS, so one reloaded provider repaints it all — the
    /// wordmark's own inks are the artwork's and deliberately do not move.
    pub fn apply_palette(&self, next: ShellPalette) {
        if next == *self.palette.borrow() {
            return;
        }
        self.style.load_from_data(splash_css(&next).as_bytes()).ok();
        *self.palette.borrow_mut() = next;
        self.wordmark.queue_draw();
    }

    /// `on_retry` runs when the button is pressed; the window owns the reload.
    pub fn on_retry(&self, on_retry: impl Fn() + 'static) {
        self.retry.connect_clicked(move |_| on_retry());
    }

    pub fn show_progress(&self, progress: Progress) {
        // The single entry point, so no caller can leave the splash half-updated —
        // the bar, the sentence and the actions always describe one `Progress`.
        if !progress.visible() {
            self.stop_pulse();
            self.widget.hide();
            return;
        }
        self.widget.show_all();

        let failed = progress.phase == Phase::Failed;
        self.retry.set_visible(failed);

        // A FAILED load hides the bar: a frozen partial bar says "still working"
        // over a message that says the opposite.
        self.bar.set_visible(!failed);
        self.bar.set_text(None);
        if progress.indeterminate() && !failed {
            self.start_pulse();
        } else {
            self.stop_pulse();
            if let Some(fraction) = progress.fraction {
                self.bar.set_fraction(fraction);
            }
        }

        self.label.set_text(&progress.label());
        if failed {
            self.label.set_markup(&format!(
                "<span foreground='{}'>{}</span>",
                self.palette.borrow().error,
                escape(&progress.label())
            ));
        }
        // The wordmark is repainted on every state because the widget was hidden
        // while the console was up: GTK does not redraw an expose it never got.
        self.wordmark.queue_draw();
    }

    /// Say why, in words, and offer the Retry.
    ///
    /// Our sentence says what the user can DO; `reason` is the engine's own — the
    /// URI and the error — which is the detail that makes a wrong port
    /// diagnosable.
    pub fn show_failure(&self, reason: &str) {
        self.show_progress(Progress::connecting().fail());
        self.label.set_markup(&format!(
            "<span foreground='{}'>{}\n{}</span>",
            self.palette.borrow().error,
            escape(sentence_for(Failure::Other)),
            escape(reason)
        ));
        self.wordmark.queue_draw();
    }

    /// Run the bar's sweep until the phase changes.
    fn start_pulse(&self) {
        if self.pulse.borrow().is_some() {
            return;
        }
        let bar = self.bar.clone();
        // ~60ms is the step rate Android's indeterminate `ProgressBar` animates
        // at; a slower timer reads as a stutter, and a faster one as noise.
        let id = glib::timeout_add_local(std::time::Duration::from_millis(60), move || {
            bar.pulse();
            glib::ControlFlow::Continue
        });
        *self.pulse.borrow_mut() = Some(id);
    }

    fn stop_pulse(&self) {
        if let Some(id) = self.pulse.borrow_mut().take() {
            id.remove();
        }
    }
}

/// Escape the three characters Pango reads as markup.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

impl Default for Splash {
    fn default() -> Self {
        Self::new()
    }
}
