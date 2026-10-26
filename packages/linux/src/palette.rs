/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The colours the launch splash paints with, as the console reported them.
 *
 * ## Why the shell stores a palette at all
 *
 * The splash is drawn from launch until the page paints — and the page's own
 * bundle is what would report a colour — so the shell has to already know it. It
 * learns it from the CONSOLE, on the load that hides the splash
 * (`window.__kabmoPalette()`), and keeps the answer for the next cold start.
 *
 * ## Why the wire is a pipe-separated line
 *
 * The page publishes `variant|canvas|paper|ink|muted|hairline|error`. JSON would
 * work here, but the Android twin reads the same string with a parser that cannot
 * be unit-tested if the wire is JSON, and one wire is worth more than one
 * convenience. Every value is `#rrggbb`, so there is nothing to escape.
 *
 * ## Why the default is the shipped light palette
 *
 * A first launch has never seen a page, so there is nothing to remember. The
 * numbers are `shellPaletteWire(shellPalette(null))` from
 * `src/shared/lib/theme/shell-palette.ts`, and the rules suite pins the whole
 * string — a change on either side has to be made on both.
 *
 * No GTK in this file: the projection and the parser are rules, and the rules
 * suite runs on a machine with no display.
 */
use serde::{Deserialize, Serialize};

/// The six colours a native shell paints with, projected from a theme palette.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShellPalette {
    /// `light` or `dark` — which side of the split the console is painting.
    pub variant: String,
    /// The page's own ground — what the splash and the web view paint.
    pub canvas: String,
    /// A raised surface.
    pub paper: String,
    /// Foreground text, and the progress bar's fill.
    pub ink: String,
    /// Secondary text — the splash's status line.
    pub muted: String,
    /// The bar's trough and a button's border.
    pub hairline: String,
    /// The failure sentence's colour.
    pub error: String,
}

impl Default for ShellPalette {
    /// The shipped light palette — what a first launch paints.
    ///
    /// `shellPaletteWire(shellPalette(null))`, byte for byte.
    fn default() -> Self {
        Self {
            variant: "light".into(),
            canvas: "#f4f1ea".into(),
            paper: "#faf8f3".into(),
            ink: "#141310".into(),
            muted: "#696763".into(),
            hairline: "#d5d2cb".into(),
            error: "#c8321e".into(),
        }
    }
}

impl ShellPalette {
    /// Whether the console is painting a dark palette.
    pub fn is_dark(&self) -> bool {
        self.variant == "dark"
    }

    /// The wire form, for the state file.
    pub fn wire(&self) -> String {
        [
            self.variant.as_str(),
            self.canvas.as_str(),
            self.paper.as_str(),
            self.ink.as_str(),
            self.muted.as_str(),
            self.hairline.as_str(),
            self.error.as_str(),
        ]
        .join("|")
    }

    /// A stored or published wire, or `None` when it is not one.
    ///
    /// `None` rather than a partial value: a field that could not be read would
    /// paint `#000000` where the console paints paper, and the caller's fallback
    /// (the stored palette, else the default) is the only answer that cannot be
    /// wrong.
    pub fn parse(wire: &str) -> Option<ShellPalette> {
        let parts: Vec<&str> = wire.split('|').collect();
        if parts.len() != 7 {
            return None;
        }
        if parts[0] != "light" && parts[0] != "dark" {
            return None;
        }
        if !parts[1..].iter().all(|value| is_hex(value)) {
            return None;
        }
        Some(ShellPalette {
            variant: parts[0].into(),
            canvas: parts[1].into(),
            paper: parts[2].into(),
            ink: parts[3].into(),
            muted: parts[4].into(),
            hairline: parts[5].into(),
            error: parts[6].into(),
        })
    }

    /// The `#rrggbb` value as 0..1 channels, for GTK's `gdk::RGBA`.
    ///
    /// A value that will not parse is the shipped canvas, because an unpainted
    /// widget is worse than the wrong shade.
    pub fn channels(&self, hex: &str) -> (f64, f64, f64) {
        let fallback = &Self::default().canvas;
        let source = if is_hex(hex) { hex } else { fallback };
        let value = u32::from_str_radix(&source[1..], 16).unwrap_or(0);
        (
            f64::from((value >> 16) & 0xFF) / 255.0,
            f64::from((value >> 8) & 0xFF) / 255.0,
            f64::from(value & 0xFF) / 255.0,
        )
    }
}

/// `#rrggbb`, in either case.
pub fn is_hex(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// The splash's stylesheet, for one palette.
///
/// A function rather than a constant because every rule here is a colour: the
/// shipped version hardcoded `#FAF8F3`/`#141310`, which is the default LIGHT
/// palette — so a dark console opened on a paper-white rectangle and jumped to a
/// near-black page.
///
/// Here rather than inline in `splash_view.rs` because two of its rules are the
/// kind that fail silently, and a rule that cannot be read from a test is a rule
/// nothing checks:
///
/// - **The fill's background.** The splash is an overlay child, so a widget with
///   no background lets the page show through it. Measured: the widget was
///   allocated the whole window and still painted nothing, because a `GtkBox`
///   draws no background of its own.
/// - **The bar's two colours.** GTK paints a progress bar in the theme's ACCENT
///   colour, which on most desktops is blue — a second chroma in a monochrome
///   product. `set_fraction` carries no colour, so the stylesheet is the only way
///   to say otherwise.
pub fn splash_css(palette: &ShellPalette) -> String {
    format!(
        ".kabmo-splash {{ background-color: {canvas}; }}\
.kabmo-splash progressbar trough {{ min-height: 4px; border-radius: 2px; background-color: {hairline}; border: none; }}\
.kabmo-splash progressbar trough progress {{ min-height: 4px; border-radius: 2px; background-color: {ink}; border: none; }}\
.kabmo-splash progressbar text {{ color: transparent; }}\
.kabmo-splash label {{ color: {muted}; }}",
        canvas = palette.canvas,
        hairline = palette.hairline,
        ink = palette.ink,
        muted = palette.muted,
    )
}
