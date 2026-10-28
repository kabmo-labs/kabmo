/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// `src/wordmark.rs` against `public/kabmo-wordmark.svg`.
//
// The splash draws the SAME lockup README.md embeds — the icon tile, the three K
// strokes, the outlined word — but GTK has no SVG renderer, so the artwork exists
// twice. Two copies of one drawing is exactly the shape that drifts silently (a
// colour nudged in the SVG, a stroke re-exported), and nothing on screen would say
// so: the splash still renders, just not the mark.
//
// The same guard runs in `packages/ios/Tests/WordmarkTests.swift`,
// `packages/macos/Tests/SplashTests.swift` and `packages/windows/tests/Program.cs`.
//
// No regex crate: the file is one this repository owns and every value below is
// reachable with a split and a quote scan, so a pattern engine would be a
// dependency bought to parse four attributes.

use std::path::Path;

use kabmo_desktop::wordmark::{
    self, Command, GRADIENT_END, GRADIENT_START, GRADIENT_X1, GRADIENT_X2, HEIGHT, PLATE_COLOR,
    PLATE_RADIUS, PLATE_SIZE, SHIFT, STROKE_COLORS, STROKE_WIDTH, VIEW_BOX, WIDTH, WORD_INK,
};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    let Some(svg) = read_svg() else {
        r.check("the README's wordmark SVG is readable", false);
        return;
    };

    r.group("wordmark — the SVG's own numbers");
    let view_box: Vec<f64> = attribute(&svg, "viewBox")
        .unwrap_or_default()
        .split_whitespace()
        .filter_map(|part| part.parse().ok())
        .collect();
    r.check("the SVG has a four-number viewBox", view_box.len() == 4);
    if view_box.len() == 4 {
        r.check("the viewport width is the SVG's", (WIDTH - view_box[2]).abs() < 0.01);
        r.check("the viewport height is the SVG's", (HEIGHT - view_box[3]).abs() < 0.01);
        r.check("the SVG starts above the origin", view_box[1] < 0.0);
        r.check("the shift is -viewBox.y", (SHIFT + view_box[1]).abs() < 0.01);
        r.check(
            "VIEW_BOX carries the same numbers",
            VIEW_BOX.2 == WIDTH && VIEW_BOX.3 == HEIGHT,
        );
    }

    r.group("wordmark — every SVG path, verbatim");
    let svg_paths = path_data(&svg);
    r.check("the SVG has five paths", svg_paths.len() == 5);
    for (index, d) in svg_paths.iter().enumerate().take(wordmark::PATHS.len()) {
        // Verbatim: the y shift is applied when the path is painted, so a copy that
        // had already been shifted would be shifted twice and still "look right".
        r.check(&format!("path {index} is the SVG's, verbatim"), wordmark::PATHS[index] == *d);
    }

    let rect = svg.split("<rect").nth(1).unwrap_or_default();
    r.check(
        "the plate is the SVG's tile and radius",
        number(rect, "width").is_some_and(|value| (PLATE_SIZE - value).abs() < 0.01)
            && number(rect, "height").is_some_and(|value| (PLATE_SIZE - value).abs() < 0.01)
            && number(rect, "rx").is_some_and(|value| (PLATE_RADIUS - value).abs() < 0.01),
    );
    r.check("the plate is the SVG's colour", svg.contains(PLATE_COLOR));

    let gradient = svg.split("<linearGradient").nth(1).unwrap_or_default();
    r.check(
        "the gradient runs over the SVG's span",
        number(gradient, "x1").is_some_and(|value| (GRADIENT_X1 - value).abs() < 0.01)
            && number(gradient, "x2").is_some_and(|value| (GRADIENT_X2 - value).abs() < 0.01),
    );
    r.check(
        "the gradient keeps both stops",
        svg.contains(GRADIENT_START) && svg.contains(GRADIENT_END),
    );
    r.check("the mo ink is the SVG's", svg.contains(WORD_INK));
    r.check(
        "the stroke weight is the SVG's",
        svg.contains(&format!("stroke-width=\"{STROKE_WIDTH}\"")),
    );
    r.check("three strokes are drawn in three inks", STROKE_COLORS.len() == 3);

    r.group("wordmark — the parser");
    // The subset is exactly what the artwork uses; anything else must be an ERROR
    // rather than a silently mangled mark, which is what makes a future edit to the
    // SVG a test failure.
    r.check(
        "a moveto then a vertical line",
        wordmark::commands("M48.83 -91.5V-8.5").ok()
            == Some(vec![Command::MoveTo(48.83, -91.5), Command::VerticalTo(-8.5)]),
    );
    r.check(
        "a moveto's following pair is a lineto",
        wordmark::commands("M48.83 -50 102.54 -91.5").ok()
            == Some(vec![
                Command::MoveTo(48.83, -50.0),
                Command::LineTo(102.54, -91.5),
            ]),
    );
    r.check(
        "a quadratic and a close",
        wordmark::commands("M0 0Q1 2 3 4Z").ok()
            == Some(vec![
                Command::MoveTo(0.0, 0.0),
                Command::QuadTo(1.0, 2.0, 3.0, 4.0),
                Command::Close,
            ]),
    );
    r.check(
        "an unsupported command is an error",
        wordmark::commands("M0 0A1 1 0 0 0 1 1").is_err(),
    );
    r.check("trailing arguments are an error", wordmark::commands("M0 0 5").is_err());
    r.check(
        "path data starting with a number is an error",
        wordmark::commands("5 5").is_err(),
    );
    r.check(
        "every artwork path parses",
        wordmark::PATHS.iter().all(|d| wordmark::commands(d).is_ok()),
    );

    r.group("wordmark — colours");
    // The painter takes `#rrggbb` and turns it into cairo's 0..1 components; a
    // parse that silently returned black would draw a black mark on a dark plate
    // and fail nothing else.
    match wordmark::rgb(PLATE_COLOR) {
        Ok((red, green, blue)) => {
            r.check("the plate is green, not black", green > red && green > blue);
            r.check(
                "the plate is the SVG's exact green",
                (green * 255.0 - 0x5d as f64).abs() < 1.0,
            );
        }
        Err(_) => r.check("the plate colour parses", false),
    }
    r.check("a colour without six digits is an error", wordmark::rgb("#12345").is_err());
}

/// `public/kabmo-wordmark.svg`, found by walking up from the working directory.
///
/// A test that cannot find it must FAIL rather than skip: a skipped comparison is
/// a copy nobody is checking.
fn read_svg() -> Option<String> {
    let mut directory = std::env::current_dir().ok()?;
    for _ in 0..8 {
        let candidate = directory.join("public/kabmo-wordmark.svg");
        if Path::new(&candidate).exists() {
            return std::fs::read_to_string(candidate).ok();
        }
        if !directory.pop() {
            break;
        }
    }
    None
}

/// The value of `name="…"` inside one element's text.
fn attribute<'a>(element: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=\"");
    let start = element.find(&needle)? + needle.len();
    let rest = &element[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

/// One numeric attribute of an element.
fn number(element: &str, name: &str) -> Option<f64> {
    attribute(element, name)?.parse().ok()
}

/// Every path's `d`, in document order.
fn path_data(source: &str) -> Vec<&str> {
    source
        .split("<path")
        .skip(1)
        .filter_map(|chunk| attribute(chunk, "d"))
        .collect()
}
