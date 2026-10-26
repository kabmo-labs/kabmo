/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The launch surface's RULES: the phases, the progress arithmetic, the reload
 * test, and the sentences.
 *
 * The widget that draws them is `splash_view.rs` — split because the rules are
 * what the suite exercises and the widget is what needs GTK, and because the two
 * halves together were over this repository's file ceiling. The split is the same
 * one the macOS shell makes between `SplashState` and `SplashView`.
 *
 * A page cannot report its own readiness — its bundle is what renders the app —
 * and a splash drawn BY the page would vanish exactly when the page fails to
 * load. So the splash is a sibling of the webview, owned by the shell, and every
 * state decision is [`Progress`]'s: the orderings that fail (a late estimate
 * resurrecting a finished splash, an error page's own `Finished`) are not visible
 * in a widget.
 */

/// The load phases the splash tracks.
///
/// `Connecting` is its own phase rather than "loading with no number" because the
/// bar must SWEEP until a real estimate arrives: a determinate bar at 0 is
/// indistinguishable from a stuck one, and the first seconds of a cold start are
/// exactly when the user decides whether the app is broken.
///
/// 100% is NOT a finish — the shell still has the client bundle to fetch at that
/// point — so `Finished` is the only end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Connecting,
    Loading,
    Finished,
    Failed,
}

/// Why a load failed. Each maps to one sentence, because a server that is off, a
/// wrong address and an untrusted certificate all look identical behind a blank
/// window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    HostLookup,
    Connect,
    Timeout,
    Ssl,
    Other,
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
    pub failure: Option<Failure>,
}

impl Default for Progress {
    fn default() -> Self {
        Self::connecting()
    }
}

impl Progress {
    pub fn connecting() -> Self {
        Self {
            fraction: None,
            phase: Phase::Connecting,
            failure: None,
        }
    }

    /// `Finished` is the only phase that draws nothing.
    pub fn visible(&self) -> bool {
        self.phase != Phase::Finished
    }

    /// No estimate has arrived yet, so the bar has no meaningful value.
    pub fn indeterminate(&self) -> bool {
        self.phase == Phase::Connecting
    }

    /// Fold one `estimated_load_progress` report into the state.
    ///
    /// Three rules, each a real ordering:
    ///
    /// 1. **A report after `Finished` or `Failed` is ignored.** Estimates arrive
    ///    from the web process and can land after the page finished or after an
    ///    error was reported; adopting one would re-open a splash the user moved
    ///    past.
    /// 2. **Progress never moves backwards within a load.** A redirect restarts
    ///    the document and the estimate runs back to a small value; a bar that
    ///    snaps back reads as a stall.
    /// 3. **A zero report stays indeterminate.** The first tick of a cold start is
    ///    the engine's 0%, which says nothing.
    pub fn advance(self, fraction: f64) -> Self {
        if self.phase != Phase::Connecting && self.phase != Phase::Loading {
            return self;
        }
        if !fraction.is_finite() {
            return self;
        }
        let reported = fraction.clamp(0.0, 1.0);
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
            failure: self.failure,
        }
    }

    /// The page finished loading. A failure is NOT overwritten: a failed
    /// main-frame load still reports `Finished` for the error page the engine
    /// renders, and adopting that would hide the explanation behind a blank
    /// window.
    pub fn finish(self) -> Self {
        if self.phase == Phase::Failed {
            return self;
        }
        Self {
            fraction: Some(1.0),
            phase: Phase::Finished,
            failure: None,
        }
    }

    pub fn fail(self) -> Self {
        self.failed_because(Failure::Other)
    }

    pub fn failed_because(self, failure: Failure) -> Self {
        Self {
            fraction: self.fraction,
            phase: Phase::Failed,
            failure: Some(failure),
        }
    }

    /// Whether a load that just started is the user asking for the page again.
    ///
    /// The console's own Reload control calls `location.reload()`, which
    /// WebKitGTK reports as an ordinary `LoadEvent::Started` — there is no reload
    /// flag in `load_changed`. What it DOES report is the same URI the view is
    /// already showing, while a `location.href = '/other'` navigation reports a
    /// different one, so the URI is the only signal there is.
    ///
    /// Only a document that has FINISHED counts. `load` arms the splash itself
    /// before it calls `load_uri`, and the first `Started` of a cold start
    /// therefore arrives while the view still shows the previous document's
    /// address — treating that as a reload would restart the arm just made.
    pub fn is_document_reload(started: Option<&str>, shown: Option<&str>, phase: Phase) -> bool {
        if phase != Phase::Finished {
            return false;
        }
        match (started, shown) {
            (Some(started), Some(shown)) => !started.is_empty() && started == shown,
            _ => false,
        }
    }

    /// What the splash prints.
    pub fn label(&self) -> String {
        match self.phase {
            Phase::Connecting => "Connecting to the server…".into(),
            Phase::Loading => match self.fraction {
                Some(fraction) => {
                    format!("Loading the console… {}%", (fraction * 100.0).round() as i64)
                }
                None => "Loading the console…".into(),
            },
            Phase::Failed => sentence_for(self.failure.unwrap_or(Failure::Other)).into(),
            Phase::Finished => String::new(),
        }
    }
}

/// One sentence per reason, stated here so the wording is testable and cannot
/// drift between the phases.
pub fn sentence_for(failure: Failure) -> &'static str {
    match failure {
        Failure::HostLookup => {
            "The server address could not be found. Check the host and that this machine is on the same network."
        }
        Failure::Connect => "Could not connect. Check that Kabmo is running and the port is right.",
        Failure::Timeout => "The server did not answer in time. It may still be starting.",
        Failure::Ssl => "The certificate is not trusted. Check the server address and its certificate.",
        Failure::Other => "The console could not be loaded. Retry, or check the server address.",
    }
}
