/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The launch surface, from the tap until the console paints.
 *
 * A page cannot report its own readiness — its bundle is what renders the app —
 * and a splash drawn BY the page would vanish exactly when the page fails to
 * load. So this is a sibling of the webview, owned by the shell.
 *
 * A failed load keeps the splash with the reason and a Retry, instead of leaving
 * a blank window with nothing on screen to explain it. That is the same rule the
 * Android and iOS shells follow, and the reason is the same: the most common
 * failure here is a server that is not running, which is a fact the page cannot
 * report because it never loaded.
 */

use gtk::prelude::*;

/// The load phases the splash tracks. 100% is NOT a finish — the shell still has
/// the client bundle to fetch at that point — so `Finished` is the only end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Loading,
    Finished,
    Failed,
}

/// The progress the splash may draw.
///
/// Two rules, both learned from the Android shell's `LoadingState`:
///
/// - the bar is INDETERMINATE until real progress arrives, because a determinate
///   bar at 0 is indistinguishable from a stuck one;
/// - progress never moves backwards within a load, because a redirect reports
///   100 then 10 and a bar that snaps back reads as a stall.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Progress {
    pub fraction: Option<f64>,
    pub phase: Phase,
}

impl Default for Progress {
    fn default() -> Self {
        Self {
            fraction: None,
            phase: Phase::Loading,
        }
    }
}

impl Progress {
    /// Fold one `estimated_load_progress` report into the state.
    pub fn advance(self, fraction: f64) -> Self {
        if self.phase != Phase::Loading {
            return self;
        }
        let reported = fraction.clamp(0.0, 1.0);
        // The first tick of a cold start is Chromium's 0%, which says nothing.
        if reported <= 0.0 {
            return self;
        }
        let fraction = match self.fraction {
            Some(previous) if previous >= reported => previous,
            _ => reported,
        };
        Self {
            fraction: Some(fraction),
            phase: Phase::Loading,
        }
    }

    pub fn finish(self) -> Self {
        Self {
            fraction: Some(1.0),
            phase: Phase::Finished,
        }
    }

    pub fn fail(self) -> Self {
        Self {
            fraction: self.fraction,
            phase: Phase::Failed,
        }
    }

    /// What the splash prints.
    pub fn label(&self) -> String {
        match (self.phase, self.fraction) {
            (Phase::Failed, _) => "Could not load the console.".into(),
            (Phase::Loading, Some(fraction)) => {
                format!("Loading the console… {}%", (fraction * 100.0).round() as i64)
            }
            (Phase::Loading, None) => "Loading the console…".into(),
            (Phase::Finished, _) => String::new(),
        }
    }
}

/// The splash widget: a wordmark, a line of status, a bar and a Retry.
pub struct Splash {
    pub widget: gtk::Box,
    label: gtk::Label,
    bar: gtk::ProgressBar,
    retry: gtk::Button,
}

impl Splash {
    pub fn new() -> Self {
        let widget = gtk::Box::new(gtk::Orientation::Vertical, 0);
        widget.set_valign(gtk::Align::Center);
        widget.set_halign(gtk::Align::Center);
        widget.set_hexpand(true);
        widget.set_vexpand(true);
        widget.style_context().add_class("kabmo-splash");

        let wordmark = gtk::Label::new(None);
        wordmark.set_markup(&format!(
            "<span size='xx-large' weight='bold'>{}</span>",
            crate::APP_NAME
        ));
        wordmark.set_margin_bottom(12);
        widget.pack_start(&wordmark, false, false, 0);

        let label = gtk::Label::new(Some("Starting…"));
        label.set_line_wrap(true);
        label.set_justify(gtk::Justification::Center);
        label.set_max_width_chars(60);
        widget.pack_start(&label, false, false, 0);

        let bar = gtk::ProgressBar::new();
        bar.set_size_request(280, -1);
        bar.set_margin_top(14);
        bar.set_pulse_step(0.08);
        widget.pack_start(&bar, false, false, 0);

        let retry = gtk::Button::with_label("Retry");
        retry.set_halign(gtk::Align::Center);
        retry.set_margin_top(18);
        retry.set_no_show_all(true);
        widget.pack_start(&retry, false, false, 0);

        widget.show_all();
        retry.hide();

        Self {
            widget,
            label,
            bar,
            retry,
        }
    }

    /// `on_retry` runs when the button is pressed; the window owns the reload.
    pub fn on_retry(&self, on_retry: impl Fn() + 'static) {
        self.retry.connect_clicked(move |_| on_retry());
    }

    pub fn show_progress(&self, progress: Progress) {
        match progress.phase {
            Phase::Loading => {
                self.label.set_text(&progress.label());
                match progress.fraction {
                    Some(fraction) => {
                        self.bar.set_fraction(fraction);
                        self.bar.set_text(Some(&format!("{}%", (fraction * 100.0).round() as i64)));
                    }
                    None => {
                        self.bar.pulse();
                        self.bar.set_text(None);
                    }
                }
                self.retry.hide();
            }
            Phase::Finished => {}
            Phase::Failed => {
                self.label.set_text(&progress.label());
                self.bar.set_fraction(0.0);
                self.bar.set_text(None);
                self.retry.show();
            }
        }
    }

    /// Say why, in words, and offer the Retry.
    pub fn show_failure(&self, reason: &str) {
        self.show_progress(Progress::default().fail());
        self.label.set_text(&format!("Could not load the console.\n{reason}"));
    }
}

impl Default for Splash {
    fn default() -> Self {
        Self::new()
    }
}
