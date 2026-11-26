/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * When WebKitGTK should treat the process as under memory pressure.
 *
 * The console is one WebView holding a long transcript, a code editor and up to
 * eight xterm buffers, so its web process is the largest thing the shell owns.
 * Measured on the WebKit builds of this same console (the macOS shell, same
 * engine family): 817 MB of physical footprint for one long session, of which the
 * JS heap was 12.6 MB — the rest is the render tree and graphics layers, which no
 * page-level collection can return.
 *
 * `webkit_web_context_set_memory_pressure_settings` is what makes the web process
 * itself trim: it turns "the system is short of memory" into a policy the engine
 * acts on, instead of a single request the app has to time correctly.
 *
 * The numbers are WebKit's own defaults, restated rather than left implicit: the
 * engine documents a conservative and a strict profile, and this picks the
 * conservative one — a console that trims too eagerly throws away exactly the
 * layout the reader is about to look at.
 */

/// The kernel's memory-pressure policy for the web process.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PressurePolicy {
    /// Fraction of total memory at which the engine starts releasing caches.
    pub conservative_threshold: f64,
    /// Fraction at which it kills the process rather than let the machine thrash.
    pub strict_threshold: f64,
    /// Seconds between samples.
    pub poll_interval: f64,
    /// Seconds a web process may sit unused before it is reclaimed.
    pub kill_delay: f64,
}

impl PressurePolicy {
    /// The conservative profile: act at 50% of RAM, kill at 75%, sampled every
    /// five seconds, and give an idle web process a minute before reclaiming it.
    ///
    /// 50% rather than "as late as possible": this shell runs on a laptop that is
    /// also running the editor, the browser and the agent, so the console is
    /// rarely the only claimant on memory — and a web process that has already
    /// released its caches is cheap to keep, while one that has to be killed costs
    /// the reader their scroll position.
    pub const CONSERVATIVE: PressurePolicy = PressurePolicy {
        conservative_threshold: 0.5,
        strict_threshold: 0.75,
        poll_interval: 5.0,
        kill_delay: 60.0,
    };

    /// Whether the two thresholds describe a usable policy: WebKit refuses the
    /// settings outright when the conservative one is not below the strict one,
    /// and a refusal there is silent — the shell would keep the engine's defaults
    /// and believe it had configured something.
    pub fn is_ordered(&self) -> bool {
        self.conservative_threshold > 0.0
            && self.conservative_threshold < self.strict_threshold
            && self.strict_threshold <= 1.0
            && self.poll_interval > 0.0
    }

    /// The four numbers, in the order WebKit's setters take them, or `None` when
    /// the policy is unusable.
    ///
    /// Deliberately NOT a `MemoryPressureSettings`: this module is the part that
    /// can be reasoned about and tested without a display or a GTK link, and the
    /// engine object is built from these numbers at the one call site
    /// (`chrome.rs`). `None` rather than a settings object WebKit would refuse —
    /// the refusal happens inside the engine (a `g_warning` and no change), so a
    /// shell that passed an unusable policy would believe it had configured
    /// something and keep the defaults.
    pub fn engine_values(&self) -> Option<(f64, f64, f64, f64)> {
        if !self.is_ordered() {
            return None;
        }
        Some((
            self.conservative_threshold,
            self.strict_threshold,
            self.poll_interval,
            self.kill_delay,
        ))
    }
}
