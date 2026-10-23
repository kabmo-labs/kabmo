/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generate the shells' copies of the README wordmark.
 *
 * `public/kabmo-wordmark.svg` is the ONE source of the lockup — the artwork
 * README.md embeds. Three shells draw it natively (a launch splash is platform
 * views, so there is no SVG renderer to hand it to), which means the drawing has
 * to exist once per language. Hand-copying 3.4 KB of path data three times is the
 * shape that drifts silently: the splash still renders, just not the mark.
 *
 * So the copies are GENERATED from the SVG, and each shell's rules suite re-derives
 * them from the SVG again (the same guard `packages/android`'s
 * `WordmarkDrawableTest` and `packages/ios`'s `WordmarkTests` apply to their own
 * copies). Run this after editing the artwork:
 *
 *   bun run scripts/shell-wordmark.mjs           # write
 *   bun run scripts/shell-wordmark.mjs --check   # exit 1 when stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SVG = join(ROOT, 'public/kabmo-wordmark.svg');

const svg = readFileSync(SVG, 'utf8');

function attr(source, name) {
  const match = source.match(new RegExp(`${name}="([^"]+)"`));
  if (!match) throw new Error(`the wordmark SVG has no ${name}`);
  return match[1];
}

/** The artwork's numbers, read from the file rather than restated here. */
function readArtwork(source) {
  const viewBox = attr(source, 'viewBox').split(/\s+/).map(Number);
  if (viewBox.length !== 4) throw new Error('viewBox must have four numbers');
  const rect = source.match(/<rect width="([\d.]+)" height="([\d.]+)" y="([-\d.]+)" rx="([\d.]+)" fill="(#[0-9a-f]{6})"/i);
  if (!rect) throw new Error('the plate <rect> is not in the expected shape');
  const gradient = source.match(/<linearGradient[^>]*x1="([\d.]+)" y1="([-\d.]+)" x2="([\d.]+)" y2="([-\d.]+)"/);
  if (!gradient) throw new Error('the gradient is not in the expected shape');
  const stops = [...source.matchAll(/<stop offset="\d" stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  if (stops.length !== 2) throw new Error(`expected two gradient stops, found ${stops.length}`);

  const group = source.match(/<g fill="none" stroke-width="([\d.]+)"[^>]*>/);
  if (!group) throw new Error('the stroke group is not in the expected shape');

  // Every `<path>`, in document order, with the attributes that matter.
  const paths = [...source.matchAll(/<path\b([^>]*)\/>/g)].map((match) => {
    const body = match[1];
    return {
      d: attr(body, 'd'),
      stroke: body.match(/\bstroke="(#[0-9a-f]{6})"/i)?.[1] ?? null,
      fill: body.match(/\bfill="(#[0-9a-f]{6})"/i)?.[1] ?? null,
      gradient: body.includes('fill="url(#kabmo-ab)"'),
      ink: /class="kabmo-mo"/.test(body),
    };
  });
  if (paths.length !== 5) throw new Error(`expected five paths, found ${paths.length}`);

  const ink = source.match(/\.kabmo-mo \{ fill: (#[0-9a-f]{6}); \}/);
  if (!ink) throw new Error('the mo ink rule is not in the expected shape');

  return {
    viewBox,
    plate: {
      width: Number(rect[1]),
      height: Number(rect[2]),
      y: Number(rect[3]),
      radius: Number(rect[4]),
      fill: rect[5],
    },
    gradient: {
      x1: Number(gradient[1]),
      y1: Number(gradient[2]),
      x2: Number(gradient[3]),
      y2: Number(gradient[4]),
      start: stops[0],
      end: stops[1],
    },
    strokeWidth: Number(group[1]),
    paths,
    wordInk: ink[1],
  };
}

const art = readArtwork(svg);
const width = art.viewBox[2];
const height = art.viewBox[3];

/** Split a long string into source-friendly chunks of at most `size` characters. */
function chunks(value, size) {
  const out = [];
  for (let index = 0; index < value.length; index += size) out.push(value.slice(index, index + size));
  return out;
}

function swiftString(value, indent) {
  const parts = chunks(value, 96).map((part) => JSON.stringify(part));
  if (parts.length === 1) return parts[0];
  return parts.join(` +\n${indent}`);
}

function csString(value, indent) {
  const parts = chunks(value, 96).map((part) => JSON.stringify(part));
  if (parts.length === 1) return parts[0];
  return parts.join(` +\n${indent}`);
}

/** A number as Rust wants it: always a float literal. */
function rustNumber(value) {
  const text = String(value);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
}

function rustString(value, indent) {
  const parts = chunks(value, 96).map((part) => JSON.stringify(part));
  if (parts.length === 1) return parts[0];
  return `concat!(\n${indent}    ${parts.join(`,\n${indent}    `)}\n${indent})`;
}

const HEADER = `/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
`;

// --------------------------------------------------------------------- Swift

const swift = `${HEADER}
import CoreGraphics
import Foundation

/// The Kabmo wordmark, as geometry.
///
/// The launch splash draws the SAME lockup \`README.md\` embeds — the icon tile, the
/// three K strokes, the outlined word — but there is no SVG renderer in AppKit, so
/// the artwork has to exist twice: once as \`public/kabmo-wordmark.svg\` for the
/// README and once as these path strings. Two copies of one drawing is exactly the
/// shape that drifts silently (a colour nudged in the SVG, a stroke re-exported),
/// and nothing on screen would say so: the splash still renders, just not the mark.
///
/// **This file is GENERATED** by \`scripts/shell-wordmark.mjs\` from the SVG, and
/// \`SplashTests\` re-derives every number below from that file — the same guard
/// \`packages/ios\`'s \`WordmarkTests\` applies to its own copy.
///
/// The SVG is authored around a baseline at y = 0, so its viewBox starts ABOVE the
/// origin (\`0 ${art.viewBox[1]} ${width} ${height}\`). A \`CGPath\` has no negative origin
/// to fight, but every path is shifted by \`shift\` so a renderer never has to draw
/// above 0.
public enum Wordmark {

  /// The SVG's viewBox, verbatim.
  public static let viewBox = CGRect(x: ${art.viewBox[0]}, y: ${art.viewBox[1]}, width: ${width}, height: ${height})

  /// The y shift that puts the artwork inside a 0-based viewport.
  public static let shift = -viewBox.minY

  /// The artwork's size once shifted.
  public static let size = CGSize(width: viewBox.width, height: viewBox.height)

  /// The icon plate: the SVG's \`<rect>\`, same tile, same corner radius.
  public enum Plate {
    public static let size = CGSize(width: ${art.plate.width}, height: ${art.plate.height})
    public static let cornerRadius: CGFloat = ${art.plate.radius}
    public static let color = "${art.plate.fill}"
  }

  /// The three K strokes, in document order: stem, upper arm, lower arm.
  public enum Stroke {
    public static let width: CGFloat = ${art.strokeWidth}
    public static let cap = CGLineCap.round
    public static let join = CGLineJoin.round
  }

  /// The gradient run across the \`a\`/\`b\` pair, in user space.
  public enum Gradient {
    public static let start = CGPoint(x: ${art.gradient.x1}, y: ${art.gradient.y1})
    public static let end = CGPoint(x: ${art.gradient.x2}, y: ${art.gradient.y2})
    public static let startColor = "${art.gradient.start}"
    public static let endColor = "${art.gradient.end}"
  }

  /// The \`mo\` ink — one colour chosen to hold on any background.
  public static let wordInk = "${art.wordInk}"

  /// Path 0 — the K's stem.
  public static let stem = ${swiftString(art.paths[0].d, '      ')}

  /// Path 1 — the K's upper arm, the orange stroke.
  public static let upperArm = ${swiftString(art.paths[1].d, '      ')}

  /// Path 2 — the K's lower arm.
  public static let lowerArm = ${swiftString(art.paths[2].d, '      ')}

  /// Path 3 — the outlined word, gradient-filled.
  public static let wordA = ${swiftString(art.paths[3].d, '      ')}

  /// Path 4 — the outlined \`o\`, in the single \`mo\` ink.
  public static let wordO = ${swiftString(art.paths[4].d, '      ')}

  /// Every path, in document order, as \`CGPath\`s in a 0-based viewport.
  ///
  /// The order is the SVG's: the plate is drawn first (it is not a path), then
  /// these, and the word's fill covers the plate's right edge exactly as the SVG
  /// does.
  public static func paths() throws -> [CGPath] {
    try [stem, upperArm, lowerArm, wordA, wordO].map { d in
      // The SVG's y values are negative above the baseline; the shift puts the
      // artwork inside a 0-based box.
      try SVGPath.path(d) { CGPoint(x: $0.x, y: $0.y + shift) }
    }
  }

  /// The plate, as a path in the same 0-based space.
  public static func platePath() -> CGPath {
    let path = CGMutablePath()
    let rect = CGRect(x: 0, y: 0, width: Plate.size.width, height: Plate.size.height)
    path.addRoundedRect(in: rect, cornerWidth: Plate.cornerRadius, cornerHeight: Plate.cornerRadius)
    return path
  }
}
`;

// ------------------------------------------------------------------------ C#

const cs = `${HEADER}
namespace KabmoDesktop;

/// <summary>
/// The Kabmo wordmark, as geometry.
///
/// The launch splash draws the SAME lockup \`README.md\` embeds — the icon tile, the
/// three K strokes, the outlined word — but a WPF splash is native visuals, so the
/// artwork has to exist twice: once as \`public/kabmo-wordmark.svg\` for the README
/// and once as these path strings. Two copies of one drawing is exactly the shape
/// that drifts silently (a colour nudged in the SVG, a stroke re-exported), and
/// nothing on screen would say so: the splash still renders, just not the mark.
///
/// **This file is GENERATED** by \`scripts/shell-wordmark.mjs\` from the SVG, and the
/// rules suite (\`tests/Program.cs\`) re-derives every number below from that file.
///
/// It is DATA ONLY — no \`Geometry\`, no \`Brush\` — because this library targets
/// \`net8.0\` with no WPF, which is what lets the suite run on a machine that is not
/// Windows. The app builds the visuals from these constants.
///
/// The SVG is authored around a baseline at y = 0, so its viewBox starts ABOVE the
/// origin; \`Shift\` is what puts the artwork inside a 0-based viewport.
/// </summary>
public static class Wordmark
{
    /// <summary>The SVG's viewBox: x, y, width, height.</summary>
    public const double ViewBoxX = ${art.viewBox[0]};
    public const double ViewBoxY = ${art.viewBox[1]};
    public const double ViewBoxWidth = ${width};
    public const double ViewBoxHeight = ${height};

    /// <summary>The y shift that puts the artwork inside a 0-based viewport.</summary>
    public const double Shift = -ViewBoxY;

    /// <summary>The icon plate: the SVG's \`&lt;rect&gt;\`, same tile, same corner radius.</summary>
    public const double PlateSize = ${art.plate.width};
    public const double PlateCornerRadius = ${art.plate.radius};
    public const string PlateColor = "${art.plate.fill}";

    /// <summary>The three K strokes: weight, and the round cap and join the SVG declares.</summary>
    public const double StrokeWidth = ${art.strokeWidth};

    /// <summary>The gradient run across the \`a\`/\`b\` pair, in user space.</summary>
    public const double GradientX1 = ${art.gradient.x1};
    public const double GradientY1 = ${art.gradient.y1};
    public const double GradientX2 = ${art.gradient.x2};
    public const double GradientY2 = ${art.gradient.y2};
    public const string GradientStart = "${art.gradient.start}";
    public const string GradientEnd = "${art.gradient.end}";

    /// <summary>The \`mo\` ink — one colour chosen to hold on any background.</summary>
    public const string WordInk = "${art.wordInk}";

    /// <summary>Path 0 — the K's stem, in the SVG's own coordinates.</summary>
    public const string Stem = ${csString(art.paths[0].d, '        ')};

    /// <summary>Path 1 — the K's upper arm, the orange stroke.</summary>
    public const string UpperArm = ${csString(art.paths[1].d, '        ')};

    /// <summary>Path 2 — the K's lower arm.</summary>
    public const string LowerArm = ${csString(art.paths[2].d, '        ')};

    /// <summary>Path 3 — the outlined word, gradient-filled.</summary>
    public const string WordA = ${csString(art.paths[3].d, '        ')};

    /// <summary>Path 4 — the outlined \`o\`, in the single \`mo\` ink.</summary>
    public const string WordO = ${csString(art.paths[4].d, '        ')};

    /// <summary>Every path, in document order.</summary>
    public static readonly string[] Paths = { Stem, UpperArm, LowerArm, WordA, WordO };

    /// <summary>The ink each of the three K strokes is drawn in, in the same order.</summary>
    public static readonly string[] StrokeColors = { "${art.paths[0].stroke}", "${art.paths[1].stroke}", "${art.paths[2].stroke}" };
}
`;

// ---------------------------------------------------------------------- Rust

// Rust is the one target whose header cannot be a block comment: `/** … */` is an
// OUTER doc comment for the next item, and an inner `//!` after it is a compile
// error ("expected outer doc comment"). The licence line is therefore plain `//`.
const rust = `// @license
// SPDX-License-Identifier: Apache-2.0
//
// GENERATED by scripts/shell-wordmark.mjs — do not edit by hand.
//
//! The Kabmo wordmark, as geometry.
//!
//! The launch splash draws the SAME lockup \`README.md\` embeds — the icon tile, the
//! three K strokes, the outlined word — but GTK has no SVG renderer, so the
//! artwork has to exist twice: once as \`public/kabmo-wordmark.svg\` for the README
//! and once as these path strings. Two copies of one drawing is exactly the shape
//! that drifts silently (a colour nudged in the SVG, a stroke re-exported), and
//! nothing on screen would say so: the splash still renders, just not the mark.
//!
//! **This file is GENERATED** by \`scripts/shell-wordmark.mjs\` from the SVG, and the
//! rules suite (\`rules/wordmark.rs\`) re-derives every number below from that file.
//!
//! It holds DATA ONLY. The parser and the cairo painter live beside it in
//! \`wordmark.rs\`, which re-exports these constants — so the generator never has
//! to carry a thousand lines of logic, and a hand edit to the drawing is still a
//! test failure.
//!
//! The SVG is authored around a baseline at y = 0, so its viewBox starts ABOVE the
//! origin; [\`SHIFT\`] is what puts the artwork inside a 0-based viewport, which is
//! the only reason these strings are not handed straight to the painter.

/// The SVG's viewBox: x, y, width, height.
pub const VIEW_BOX: (f64, f64, f64, f64) = (${rustNumber(art.viewBox[0])}, ${rustNumber(art.viewBox[1])}, ${rustNumber(width)}, ${rustNumber(height)});

/// The y shift that puts the artwork inside a 0-based viewport.
pub const SHIFT: f64 = -VIEW_BOX.1;

/// The artwork's size once shifted.
pub const WIDTH: f64 = VIEW_BOX.2;
pub const HEIGHT: f64 = VIEW_BOX.3;

/// The icon plate: the SVG's \`<rect>\`, same tile, same corner radius.
pub const PLATE_SIZE: f64 = ${rustNumber(art.plate.width)};
pub const PLATE_RADIUS: f64 = ${rustNumber(art.plate.radius)};
pub const PLATE_COLOR: &str = "${art.plate.fill}";

/// The three K strokes: weight, and the round cap and join the SVG declares.
pub const STROKE_WIDTH: f64 = ${rustNumber(art.strokeWidth)};

/// The gradient run across the \`a\`/\`b\` pair, in user space.
pub const GRADIENT_X1: f64 = ${rustNumber(art.gradient.x1)};
pub const GRADIENT_Y1: f64 = ${rustNumber(art.gradient.y1)};
pub const GRADIENT_X2: f64 = ${rustNumber(art.gradient.x2)};
pub const GRADIENT_Y2: f64 = ${rustNumber(art.gradient.y2)};
pub const GRADIENT_START: &str = "${art.gradient.start}";
pub const GRADIENT_END: &str = "${art.gradient.end}";

/// The \`mo\` ink — one colour chosen to hold on any background.
pub const WORD_INK: &str = "${art.wordInk}";

/// Path 0 — the K's stem, in the SVG's own coordinates.
pub const STEM: &str = ${rustString(art.paths[0].d, '')};

/// Path 1 — the K's upper arm, the orange stroke.
pub const UPPER_ARM: &str = ${rustString(art.paths[1].d, '')};

/// Path 2 — the K's lower arm.
pub const LOWER_ARM: &str = ${rustString(art.paths[2].d, '')};

/// Path 3 — the outlined word, gradient-filled.
pub const WORD_A: &str = ${rustString(art.paths[3].d, '')};

/// Path 4 — the outlined \`o\`, in the single \`mo\` ink.
pub const WORD_O: &str = ${rustString(art.paths[4].d, '')};

/// Every path, in document order.
pub const PATHS: [&str; 5] = [STEM, UPPER_ARM, LOWER_ARM, WORD_A, WORD_O];

/// The ink each of the three K strokes is drawn in, in the same order.
pub const STROKE_COLORS: [&str; 3] = ["${art.paths[0].stroke}", "${art.paths[1].stroke}", "${art.paths[2].stroke}"];

`;

const targets = [
  { path: join(ROOT, 'packages/macos/Sources/KabmoDesktop/Wordmark.swift'), body: swift },
  { path: join(ROOT, 'packages/windows/src/KabmoDesktop/Wordmark.cs'), body: cs },
  { path: join(ROOT, 'packages/linux/src/wordmark_data.rs'), body: rust },
];

const check = process.argv.includes('--check');
let stale = 0;
for (const target of targets) {
  let current = null;
  try {
    current = readFileSync(target.path, 'utf8');
  } catch {
    current = null;
  }
  if (current === target.body) {
    console.log(`ok   ${target.path.slice(ROOT.length + 1)}`);
    continue;
  }
  if (check) {
    stale += 1;
    console.error(`stale ${target.path.slice(ROOT.length + 1)} — run: bun run scripts/shell-wordmark.mjs`);
    continue;
  }
  writeFileSync(target.path, target.body);
  console.log(`wrote ${target.path.slice(ROOT.length + 1)}`);
}

if (stale > 0) process.exit(1);
