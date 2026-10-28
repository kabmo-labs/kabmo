/**
 * @license
 * SPDX-License-Identifier: MIT
 */

namespace KabmoDesktop;

/// <summary>
/// The Kabmo wordmark, as geometry.
///
/// The launch splash draws the SAME lockup `README.md` embeds — the icon tile, the
/// three K strokes, the outlined word — but a WPF splash is native visuals, so the
/// artwork has to exist twice: once as `public/kabmo-wordmark.svg` for the README
/// and once as these path strings. Two copies of one drawing is exactly the shape
/// that drifts silently (a colour nudged in the SVG, a stroke re-exported), and
/// nothing on screen would say so: the splash still renders, just not the mark.
///
/// **This file is GENERATED** by `scripts/shell-wordmark.mjs` from the SVG, and the
/// rules suite (`tests/Program.cs`) re-derives every number below from that file.
///
/// It is DATA ONLY — no `Geometry`, no `Brush` — because this library targets
/// `net8.0` with no WPF, which is what lets the suite run on a machine that is not
/// Windows. The app builds the visuals from these constants.
///
/// The SVG is authored around a baseline at y = 0, so its viewBox starts ABOVE the
/// origin; `Shift` is what puts the artwork inside a 0-based viewport.
/// </summary>
public static class Wordmark
{
    /// <summary>The SVG's viewBox: x, y, width, height.</summary>
    public const double ViewBoxX = 0;
    public const double ViewBoxY = -128.12;
    public const double ViewBoxWidth = 486.38;
    public const double ViewBoxHeight = 156.25;

    /// <summary>The y shift that puts the artwork inside a 0-based viewport.</summary>
    public const double Shift = -ViewBoxY;

    /// <summary>The icon plate: the SVG's `&lt;rect&gt;`, same tile, same corner radius.</summary>
    public const double PlateSize = 156.25;
    public const double PlateCornerRadius = 34.18;
    public const string PlateColor = "#0b5d3b";

    /// <summary>The three K strokes: weight, and the round cap and join the SVG declares.</summary>
    public const double StrokeWidth = 17.09;

    /// <summary>The gradient run across the `a`/`b` pair, in user space.</summary>
    public const double GradientX1 = 117.76;
    public const double GradientY1 = 0;
    public const double GradientX2 = 279.42;
    public const double GradientY2 = 0;
    public const string GradientStart = "#f59e0b";
    public const string GradientEnd = "#ea580c";

    /// <summary>The `mo` ink — one colour chosen to hold on any background.</summary>
    public const string WordInk = "#7e7a72";

    /// <summary>Path 0 — the K's stem, in the SVG's own coordinates.</summary>
    public const string Stem = "M48.83 -91.5V-8.5";

    /// <summary>Path 1 — the K's upper arm, the orange stroke.</summary>
    public const string UpperArm = "M48.83 -50 102.54 -91.5";

    /// <summary>Path 2 — the K's lower arm.</summary>
    public const string LowerArm = "M48.83 -50 102.54 -8.5";

    /// <summary>Path 3 — the outlined word, gradient-filled.</summary>
    public const string WordA = "M146.49 1.34Q139.31 1.34 133.7 -1.11Q128.1 -3.56 124.95 -8.49Q121.79 -13.42 121.79 -20.81Q121.79" +
        " -27.05 123.97 -31.34Q126.15 -35.64 130.05 -38.32Q133.94 -41.01 138.97 -42.42Q144.01 -43.83 149." +
        "71 -44.3Q156.09 -44.83 159.98 -45.47Q163.87 -46.11 165.68 -47.38Q167.5 -48.66 167.5 -50.94L167.5" +
        " -51.21Q167.5 -53.83 166.29 -55.64Q165.08 -57.45 162.8 -58.39Q160.52 -59.33 157.29 -59.33Q154.07" +
        " -59.33 151.56 -58.39Q149.04 -57.45 147.43 -55.7Q145.82 -53.96 145.15 -51.61L123.94 -54.36Q125.4" +
        "2 -60.81 129.74 -65.67Q134.07 -70.54 141.09 -73.26Q148.1 -75.97 157.5 -75.97Q164.48 -75.97 170.5" +
        "5 -74.33Q176.62 -72.68 181.19 -69.5Q185.75 -66.31 188.3 -61.64Q190.85 -56.98 190.85 -50.94L190.8" +
        "5 0L168.84 0L168.84 -10.54L168.23 -10.54Q166.22 -6.64 163.1 -4.03Q159.98 -1.41 155.85 -0.03Q151." +
        "72 1.34 146.49 1.34ZM153.6 -14.16Q157.56 -14.16 160.75 -15.77Q163.94 -17.38 165.82 -20.2Q167.7 -" +
        "23.02 167.7 -26.71L167.7 -33.89Q166.69 -33.36 165.18 -32.89Q163.67 -32.42 161.86 -32.05Q160.05 -" +
        "31.68 158.23 -31.38Q156.42 -31.07 154.74 -30.81Q151.32 -30.34 148.91 -29.19Q146.49 -28.05 145.21" +
        " -26.24Q143.94 -24.43 143.94 -21.88Q143.94 -19.4 145.21 -17.68Q146.49 -15.97 148.64 -15.07Q150.7" +
        "8 -14.16 153.6 -14.16ZM247.95 1.07Q242.25 1.07 238.05 -0.84Q233.86 -2.75 231.11 -5.77Q228.35 -8." +
        "79 226.88 -12.15L226.07 -12.15L226.07 0L202.92 0L202.92 -100L226.34 -100L226.34 -62.15L226.88 -6" +
        "2.15Q228.29 -65.57 231.01 -68.72Q233.72 -71.88 237.92 -73.93Q242.11 -75.97 248.09 -75.97Q256.01 " +
        "-75.97 262.82 -71.85Q269.63 -67.72 273.82 -59.16Q278.02 -50.6 278.02 -37.45Q278.02 -24.7 273.99 " +
        "-16.14Q269.97 -7.58 263.12 -3.26Q256.27 1.07 247.95 1.07ZM239.97 -17.18Q244.46 -17.18 247.58 -19" +
        ".7Q250.7 -22.21 252.31 -26.81Q253.93 -31.41 253.93 -37.45Q253.93 -43.56 252.31 -48.09Q250.7 -52." +
        "62 247.62 -55.13Q244.53 -57.65 239.97 -57.65Q235.47 -57.65 232.31 -55.2Q229.16 -52.75 227.48 -48" +
        ".22Q225.8 -43.69 225.8 -37.45Q225.8 -31.34 227.48 -26.78Q229.16 -22.21 232.35 -19.7Q235.54 -17.1" +
        "8 239.97 -17.18Z";

    /// <summary>Path 4 — the outlined `o`, in the single `mo` ink.</summary>
    public const string WordO = "M289.88 0L289.88 -75.03L311.43 -75.03L312.77 -55.57L311.16 -55.57Q312.9 -62.89 316.36 -67.38Q319" +
        ".82 -71.88 324.41 -73.96Q329.01 -76.04 334.11 -76.04Q342.16 -76.04 347.1 -70.87Q352.03 -65.7 354" +
        ".71 -53.96L352.1 -53.96Q353.91 -61.81 357.8 -66.71Q361.69 -71.61 366.93 -73.83Q372.16 -76.04 377" +
        ".8 -76.04Q384.85 -76.04 390.25 -72.99Q395.65 -69.93 398.74 -64.26Q401.83 -58.59 401.83 -50.6L401" +
        ".83 0L378.47 0L378.47 -45.3Q378.47 -51.01 375.49 -53.96Q372.5 -56.91 367.87 -56.91Q364.58 -56.91" +
        " 362.13 -55.44Q359.68 -53.96 358.41 -51.31Q357.13 -48.66 357.13 -45.03L357.13 0L334.65 0L334.65 " +
        "-45.64Q334.65 -50.81 331.76 -53.86Q328.88 -56.91 324.18 -56.91Q320.96 -56.91 318.51 -55.44Q316.0" +
        "6 -53.96 314.68 -51.24Q313.31 -48.52 313.31 -44.56L313.31 0ZM448.73 1.41Q436.98 1.41 428.53 -3.4" +
        "6Q420.07 -8.32 415.54 -17.01Q411.01 -25.7 411.01 -37.25Q411.01 -48.86 415.54 -57.55Q420.07 -66.2" +
        "4 428.53 -71.11Q436.98 -75.97 448.73 -75.97Q460.47 -75.97 468.93 -71.11Q477.39 -66.24 481.88 -57" +
        ".55Q486.38 -48.86 486.38 -37.25Q486.38 -25.7 481.88 -17.01Q477.39 -8.32 468.93 -3.46Q460.47 1.41" +
        " 448.73 1.41ZM448.73 -16.51Q453.22 -16.51 456.31 -19.13Q459.4 -21.74 460.98 -26.44Q462.55 -31.14" +
        " 462.55 -37.38Q462.55 -43.62 460.98 -48.29Q459.4 -52.95 456.31 -55.5Q453.22 -58.05 448.73 -58.05" +
        "Q444.23 -58.05 441.14 -55.5Q438.06 -52.95 436.48 -48.29Q434.9 -43.62 434.9 -37.38Q434.9 -31.14 4" +
        "36.48 -26.44Q438.06 -21.74 441.14 -19.13Q444.23 -16.51 448.73 -16.51Z";

    /// <summary>Every path, in document order.</summary>
    public static readonly string[] Paths = { Stem, UpperArm, LowerArm, WordA, WordO };

    /// <summary>The ink each of the three K strokes is drawn in, in the same order.</summary>
    public static readonly string[] StrokeColors = { "#f7f4ea", "#f26522", "#f7f4ea" };
}
