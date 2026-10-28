/**
 * @license
 * SPDX-License-Identifier: MIT
 */
// The splash's palette: what the console reports, and what the shell may paint.
//
// Every case here is a colour a user sees for the seconds before the console
// paints, and each failure is silent: a parser that accepts six fields paints
// `#000000` where the console paints paper, one that accepts a shorthand paints
// a colour GTK rejects, and a default that drifts from the shared module leaves a
// first launch painting a palette no theme chose.
use kabmo_desktop::palette::{is_hex, splash_css, ShellPalette};

use crate::support::Runner;

/// `shellPaletteWire(shellPalette(null))` from
/// `src/shared/lib/theme/shell-palette.ts`.
const DEFAULT_WIRE: &str = "light|#f4f1ea|#faf8f3|#141310|#696763|#d5d2cb|#c8321e";

/// `shellPaletteWire(shellPalette('one-dark-pro-soft'))`.
const DARK_WIRE: &str = "dark|#21252b|#282c34|#abb2bf|#777c87|#343940|#e06c75";

pub fn cases(r: &mut Runner) {
    r.group("ShellPalette");

    let shipped = ShellPalette::default();
    // A hand-typed copy is what this pins: the five shells' first-launch colours
    // have to be the shared projection's, or a fresh install paints a palette
    // that exists in no theme.
    r.check(
        "the shipped palette is the shared default",
        shipped.wire() == DEFAULT_WIRE,
    );
    r.check("the shipped palette is light", !shipped.is_dark());

    let dark = ShellPalette::parse(DARK_WIRE).expect("the dark wire parses");
    r.check("a wire round-trips", dark.wire() == DARK_WIRE);
    r.check("the ground is the page's canvas", dark.canvas == "#21252b");
    r.check("the failure colour survives", dark.error == "#e06c75");
    r.check("a dark wire is dark", dark.is_dark());

    // A partial palette would paint some fields and leave the rest at zero, which
    // reads as a different theme rather than as no answer.
    let rejected = [
        String::new(),
        "light".to_string(),
        "light|#f4f1ea|#faf8f3|#141310|#696763|#d5d2cb".to_string(),
        format!("{DEFAULT_WIRE}|extra"),
        DEFAULT_WIRE.replace("light", "sepia"),
        DEFAULT_WIRE.replace("#f4f1ea", "#f4f1e"),
        DEFAULT_WIRE.replace("#f4f1ea", "rgb(244,241,234)"),
    ];
    for bad in &rejected {
        r.check(
            &format!("rejects {bad:?}"),
            ShellPalette::parse(bad).is_none(),
        );
    }

    r.check("a seven-digit hex is accepted", is_hex("#21252b"));
    r.check("a three-digit hex is not", !is_hex("#fff"));
    r.check("a missing hash is not", !is_hex("21252b"));

    // A colour GTK cannot parse must not reach `gdk::RGBA`: the fallback is the
    // shipped canvas, because an unpainted widget is worse than the wrong shade.
    let (red, green, blue) = shipped.channels(&shipped.canvas);
    r.check(
        "the canvas channels are the palette's own",
        (red * 255.0).round() as i64 == 0xf4
            && (green * 255.0).round() as i64 == 0xf1
            && (blue * 255.0).round() as i64 == 0xea,
    );
    let fallback = shipped.channels("not-a-colour");
    r.check(
        "an unparseable colour falls back to the shipped canvas",
        (fallback.0 * 255.0).round() as i64 == 0xf4,
    );

    // The stylesheet is a FUNCTION of the palette, which is the whole fix: the
    // constant it replaced hardcoded the light theme's paper on every install.
    let dark_css = splash_css(&dark);
    r.check(
        "a dark palette paints a dark fill",
        dark_css.contains("background-color: #21252b;"),
    );
    r.check(
        "no light surface survives a dark palette",
        !dark_css.contains("#f4f1ea") && !dark_css.contains("#faf8f3"),
    );
}
