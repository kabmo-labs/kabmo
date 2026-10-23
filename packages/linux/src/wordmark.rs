// @license
// SPDX-License-Identifier: Apache-2.0

//! The wordmark's parser and painter.
//!
//! The DATA lives in `wordmark_data.rs`, which `scripts/shell-wordmark.mjs`
//! generates from `public/kabmo-wordmark.svg` — the same file `README.md` embeds
//! and the same numbers the iOS, macOS and Windows shells carry. This module is
//! the half a generator cannot write: an SVG path parser (the artwork's `d`
//! strings, with the y shift the 0-based viewport needs) and a cairo painter.
//!
//! Split for the reason `rules/` exists at all: the numbers are checked against
//! the SVG, and the parser is checked against the subset of SVG that file uses. A
//! parser that quietly mis-read one command draws a wrong mark rather than
//! failing, which is exactly the shape a test has to catch.

use std::f64::consts::PI;

pub use crate::wordmark_data::*;

/// One command of an SVG `d` attribute, with absolute arguments.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Command {
    MoveTo(f64, f64),
    LineTo(f64, f64),
    HorizontalTo(f64),
    VerticalTo(f64),
    /// Control point, then the end point.
    QuadTo(f64, f64, f64, f64),
    /// First control point, second control point, end point.
    CurveTo(f64, f64, f64, f64, f64, f64),
    Close,
}

/// Parse an SVG `d` attribute into absolute commands.
///
/// The subset is exactly what the artwork uses — `M`, `L`, `H`, `V`, `Q`, `C`,
/// `Z` — with SVG's implicit repeats made explicit (a coordinate pair after an
/// `M` is a line to). Anything else is an error rather than a silently mangled
/// logo, which is what makes a future edit to the SVG a test failure.
pub fn commands(d: &str) -> Result<Vec<Command>, String> {
    let mut out = Vec::new();
    let mut pending: Option<char> = None;
    let mut numbers: Vec<f64> = Vec::new();
    let mut current = (0.0, 0.0);

    for token in tokens(d) {
        let value = match token {
            Token::Op(op) => {
                // `Z` takes no arguments, so it is emitted on the LETTER rather
                // than on a following number — nothing follows it, and waiting
                // would drop every close and leave a fill running to the origin.
                if op == 'Z' {
                    out.push(Command::Close);
                } else if arity(op) == 0 {
                    return Err(format!("unsupported path command {op}"));
                }
                pending = Some(op);
                continue;
            }
            Token::Number(value) => value,
        };
        numbers.push(value);

        let Some(op) = pending else {
            return Err(format!("path data starts with a number: {d}"));
        };
        let arity = arity(op);
        if arity == 0 {
            // Only `Z` reaches here, and it was emitted above.
            continue;
        }
        while numbers.len() >= arity {
            let args: Vec<f64> = numbers.drain(..arity).collect();
            let command = match op {
                'M' => {
                    current = (args[0], args[1]);
                    Command::MoveTo(args[0], args[1])
                }
                'L' => {
                    current = (args[0], args[1]);
                    Command::LineTo(args[0], args[1])
                }
                'H' => {
                    current = (args[0], current.1);
                    Command::HorizontalTo(args[0])
                }
                'V' => {
                    current = (current.0, args[0]);
                    Command::VerticalTo(args[0])
                }
                'Q' => {
                    current = (args[2], args[3]);
                    Command::QuadTo(args[0], args[1], args[2], args[3])
                }
                'C' => {
                    current = (args[4], args[5]);
                    Command::CurveTo(args[0], args[1], args[2], args[3], args[4], args[5])
                }
                other => return Err(format!("unsupported path command {other}")),
            };
            out.push(command);
            // A moveto's following pairs are linetos; every other command
            // repeats itself with the same op.
            pending = Some(if op == 'M' { 'L' } else { op });
        }
    }

    if !numbers.is_empty() {
        return Err(format!("path {d} has {} trailing argument(s)", numbers.len()));
    }
    Ok(out)
}

enum Token {
    Op(char),
    Number(f64),
}

fn tokens(d: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut buffer = String::new();
    let mut seen_dot = false;

    fn flush(buffer: &mut String, seen_dot: &mut bool, out: &mut Vec<Token>) {
        if !buffer.is_empty() {
            if let Ok(value) = buffer.parse::<f64>() {
                out.push(Token::Number(value));
            }
        }
        buffer.clear();
        *seen_dot = false;
    }

    for character in d.chars() {
        if character.is_ascii_alphabetic() {
            flush(&mut buffer, &mut seen_dot, &mut out);
            out.push(Token::Op(character.to_ascii_uppercase()));
            continue;
        }
        if character == '.' {
            // A second dot starts a new number: `1.5.5` is `1.5` then `0.5` per
            // the SVG grammar.
            if seen_dot {
                flush(&mut buffer, &mut seen_dot, &mut out);
            }
            seen_dot = true;
            buffer.push(character);
            continue;
        }
        if character.is_ascii_digit() || character == '-' || character == '+' {
            // A sign after digits is a new number (`10-20` is `10`, `-20`).
            if (character == '-' || character == '+') && !buffer.is_empty() {
                flush(&mut buffer, &mut seen_dot, &mut out);
            }
            buffer.push(character);
            continue;
        }
        flush(&mut buffer, &mut seen_dot, &mut out);
    }
    flush(&mut buffer, &mut seen_dot, &mut out);
    out
}

fn arity(op: char) -> usize {
    match op {
        'M' | 'L' | 'T' => 2,
        'H' | 'V' => 1,
        'Q' | 'S' => 4,
        'C' => 6,
        'A' => 7,
        _ => 0,
    }
}

// ------------------------------------------------------------------ the painter

/// Draw the whole lockup into a context already scaled to the artwork's units.
///
/// The caller applies the y flip and the [`SHIFT`]; this function states the
/// drawing itself — plate, three strokes, gradient `ab`, single-ink `mo` — so the
/// splash and any future surface share one implementation.
pub fn paint(context: &gtk::cairo::Context) -> Result<(), String> {
    // The plate. Drawn first: the word's fill overlaps its right edge, exactly as
    // the SVG's document order makes it.
    let (r, g, b) = rgb(PLATE_COLOR)?;
    context.set_source_rgb(r, g, b);
    rounded_rect(context, 0.0, 0.0, PLATE_SIZE, PLATE_SIZE, PLATE_RADIUS);
    context.fill().map_err(|error| error.to_string())?;

    let paths = PATHS
        .iter()
        .map(|d| commands(d))
        .collect::<Result<Vec<_>, _>>()?;

    // The three K strokes: stroked, never filled. A cairo path has no "unfilled"
    // state, so a caller that filled them would paint the K's triangle solid — the
    // same trap the VectorDrawable port documents.
    context.set_line_width(STROKE_WIDTH);
    context.set_line_cap(gtk::cairo::LineCap::Round);
    context.set_line_join(gtk::cairo::LineJoin::Round);
    for index in 0..3 {
        let (r, g, b) = rgb(STROKE_COLORS[index])?;
        context.set_source_rgb(r, g, b);
        emit(context, &paths[index]);
        context.stroke().map_err(|error| error.to_string())?;
    }

    // The `Kabm` glyphs, gradient-filled across the user-space span the SVG
    // declares.
    let gradient = gtk::cairo::LinearGradient::new(
        GRADIENT_X1,
        GRADIENT_Y1 + SHIFT,
        GRADIENT_X2,
        GRADIENT_Y2 + SHIFT,
    );
    let (r, g, b) = rgb(GRADIENT_START)?;
    gradient.add_color_stop_rgb(0.0, r, g, b);
    let (r, g, b) = rgb(GRADIENT_END)?;
    gradient.add_color_stop_rgb(1.0, r, g, b);
    context.set_source(&gradient).map_err(|error| error.to_string())?;
    emit(context, &paths[3]);
    context.fill().map_err(|error| error.to_string())?;

    // The `o`, in the single `mo` ink.
    let (r, g, b) = rgb(WORD_INK)?;
    context.set_source_rgb(r, g, b);
    emit(context, &paths[4]);
    context.fill().map_err(|error| error.to_string())?;

    Ok(())
}

/// Replay one path's commands, shifted into the 0-based viewport.
fn emit(context: &gtk::cairo::Context, commands: &[Command]) {
    for command in commands {
        match *command {
            Command::MoveTo(x, y) => context.move_to(x, y + SHIFT),
            Command::LineTo(x, y) => context.line_to(x, y + SHIFT),
            Command::HorizontalTo(x) => {
                let y = context.current_point().map(|(_, y)| y).unwrap_or(0.0);
                context.line_to(x, y);
            }
            Command::VerticalTo(y) => {
                let x = context.current_point().map(|(x, _)| x).unwrap_or(0.0);
                context.line_to(x, y + SHIFT);
            }
            Command::QuadTo(cx, cy, x, y) => {
                // cairo has no quadratic primitive; the exact equivalent raises it
                // to a cubic, which is what every SVG renderer does too.
                let (sx, sy) = context.current_point().unwrap_or((0.0, 0.0));
                let (cx, cy) = (cx, cy + SHIFT);
                let (x, y) = (x, y + SHIFT);
                let c1 = (sx + 2.0 / 3.0 * (cx - sx), sy + 2.0 / 3.0 * (cy - sy));
                let c2 = (x + 2.0 / 3.0 * (cx - x), y + 2.0 / 3.0 * (cy - y));
                context.curve_to(c1.0, c1.1, c2.0, c2.1, x, y);
            }
            Command::CurveTo(c1x, c1y, c2x, c2y, x, y) => {
                context.curve_to(c1x, c1y + SHIFT, c2x, c2y + SHIFT, x, y + SHIFT)
            }
            Command::Close => context.close_path(),
        }
    }
}

fn rounded_rect(
    context: &gtk::cairo::Context,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
) {
    let (x0, y0) = (x + radius, y + radius);
    let (x1, y1) = (x + width - radius, y + height - radius);
    context.new_sub_path();
    context.arc(x1, y0, radius, -PI / 2.0, 0.0);
    context.arc(x1, y1, radius, 0.0, PI / 2.0);
    context.arc(x0, y1, radius, PI / 2.0, PI);
    context.arc(x0, y0, radius, PI, 1.5 * PI);
    context.close_path();
}

/// `#rrggbb` as three 0..1 components.
pub fn rgb(hex: &str) -> Result<(f64, f64, f64), String> {
    let cleaned = hex.strip_prefix('#').unwrap_or(hex);
    if cleaned.len() != 6 {
        return Err(format!("{hex} is not a #rrggbb colour"));
    }
    let value = u32::from_str_radix(cleaned, 16).map_err(|error| error.to_string())?;
    Ok((
        ((value >> 16) & 0xFF) as f64 / 255.0,
        ((value >> 8) & 0xFF) as f64 / 255.0,
        (value & 0xFF) as f64 / 255.0,
    ))
}
