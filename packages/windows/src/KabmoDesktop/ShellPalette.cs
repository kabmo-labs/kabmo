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
 * bundle is what would report a colour — so the shell has to already know it.
 * It learns it from the CONSOLE, on the load that hides the splash
 * (`window.__kabmoPalette()`), and keeps the answer for the next cold start.
 *
 * ## Why the wire is a pipe-separated line
 *
 * The page publishes `variant|canvas|paper|ink|muted|hairline|error`. JSON would
 * work in .NET, but the Android twin reads the same string with a parser that
 * cannot be unit-tested if the wire is JSON, and one wire is worth more than one
 * convenience. Every value is `#rrggbb`, so there is nothing to escape.
 *
 * ## Why the default is the shipped light palette
 *
 * A first launch has never seen a page, so there is nothing to remember. The
 * numbers are `shellPaletteWire(shellPalette(null))` from
 * `src/shared/lib/theme/shell-palette.ts`, and the test runner pins the whole
 * string — a change on either side has to be made on both.
 *
 * No WPF here: the projection and the parser are rules, and the library is the
 * assembly the runner executes on any machine.
 */

namespace KabmoDesktop;

/// <summary>The six colours a native shell paints with, projected from a theme palette.</summary>
public sealed record ShellPalette(
    string Variant,
    string Canvas,
    string Paper,
    string Ink,
    string Muted,
    string Hairline,
    string Error)
{
    /// <summary>Which side of the light/dark split the console is painting.</summary>
    public bool IsDark => Variant == "dark";

    /// <summary>The wire form, for the preference store.</summary>
    public string Wire => string.Join("|", Variant, Canvas, Paper, Ink, Muted, Hairline, Error);

    /// <summary>The shipped light palette — what a first launch paints.</summary>
    public static readonly ShellPalette Shipped = new(
        Variant: "light",
        Canvas: "#f4f1ea",
        Paper: "#faf8f3",
        Ink: "#141310",
        Muted: "#696763",
        Hairline: "#d5d2cb",
        Error: "#c8321e");

    /// <summary>
    /// A stored or published wire, or null when it is not one.
    ///
    /// Null rather than a partial value: a field that could not be read would
    /// paint `#000000` where the console paints paper, and the caller's fallback
    /// (the stored palette, else <see cref="Shipped"/>) is the only answer that
    /// cannot be wrong.
    /// </summary>
    public static ShellPalette? Parse(string? wire)
    {
        if (string.IsNullOrEmpty(wire)) return null;
        var parts = wire.Split('|');
        if (parts.Length != 7) return null;
        if (parts[0] != "light" && parts[0] != "dark") return null;
        for (var index = 1; index < parts.Length; index++)
        {
            if (!IsHex(parts[index])) return null;
        }
        return new ShellPalette(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]);
    }

    /// <summary>`#rrggbb`, in either case.</summary>
    public static bool IsHex(string value) =>
        value.Length == 7 && value[0] == '#' && value.Skip(1).All(Uri.IsHexDigit);
}
