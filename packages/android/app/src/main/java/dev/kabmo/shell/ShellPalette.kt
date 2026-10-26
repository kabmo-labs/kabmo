package dev.kabmo.shell

/**
 * The colours the launch overlay paints with, as the console reported them.
 *
 * ## Why the shell stores a palette at all
 *
 * The overlay is drawn from the tap until the page paints — and the page's own
 * bundle is what would report a colour — so the shell has to already know it.
 * It learns it from the CONSOLE, on the load that hides the overlay
 * (`window.__kabmoPalette()`), and keeps the answer for the next cold start.
 *
 * ## Why the wire is a pipe-separated line
 *
 * The page publishes the palette as `variant|canvas|paper|ink|muted|hairline|
 * error` rather than JSON, and this file is the reason: `org.json` is a stub in
 * a JVM unit test (`Method ... not mocked`), so a JSON wire would leave the
 * parser that most needs a test as the only one that cannot have one. Every
 * value is `#rrggbb`, so there is nothing to escape.
 *
 * ## Why the default is the shipped light palette
 *
 * A first launch has never seen a page, so there is nothing to remember. The
 * numbers match `src/shared/lib/theme/shell-palette.ts`'s
 * `DEFAULT_SHELL_PALETTE`, and `ShellPaletteTest` re-derives them from the same
 * source, so a shell cannot drift into a third set of values.
 *
 * Nothing here touches the Android framework, which is what makes the whole
 * class testable without a device.
 */
data class ShellPalette(
    val variant: String,
    val canvas: String,
    val paper: String,
    val ink: String,
    val muted: String,
    val hairline: String,
    val error: String,
) {

    /** Whether the console is painting a dark palette. */
    val isDark: Boolean get() = variant == "dark"

    /** The wire form, for the preference store. */
    fun wire(): String = listOf(variant, canvas, paper, ink, muted, hairline, error).joinToString("|")

    companion object {
        /**
         * The shipped light palette — what a first launch paints.
         *
         * Byte-identical to `shellPaletteWire(shellPalette(null))` in
         * `src/shared/lib/theme/shell-palette.ts`, and `ShellPaletteTest` pins
         * the whole string: a change on either side has to be made on both, and
         * the suite is what says so.
         */
        val DEFAULT = ShellPalette(
            variant = "light",
            canvas = "#f4f1ea",
            paper = "#faf8f3",
            ink = "#141310",
            muted = "#696763",
            hairline = "#d5d2cb",
            error = "#c8321e",
        )

        private val COLOR = Regex("^#[0-9a-fA-F]{6}$")

        /**
         * A stored or published wire, or null when it is not one.
         *
         * Null rather than a partial object: a shell that painted a field it
         * could not read would show `#000000` where the console shows paper,
         * and the caller's fallback (the stored palette, else [DEFAULT]) is the
         * only answer that cannot be wrong.
         */
        fun parse(wire: String?): ShellPalette? {
            if (wire == null) return null
            val parts = wire.split("|")
            if (parts.size != 7) return null
            if (parts[0] != "light" && parts[0] != "dark") return null
            if (!parts.drop(1).all { COLOR.matches(it) }) return null
            return ShellPalette(
                variant = parts[0],
                canvas = parts[1],
                paper = parts[2],
                ink = parts[3],
                muted = parts[4],
                hairline = parts[5],
                error = parts[6],
            )
        }

        /**
         * The value `evaluateJavascript` hands back, unquoted and unescaped.
         *
         * WebView answers a JS string as JSON: `"dark|#21252b|…"`. A `null`
         * result (the page has no publisher — an older build, or a load that
         * failed before the script ran) is null here, never the string "null".
         */
        fun fromJavascript(result: String?): ShellPalette? {
            val raw = result?.trim() ?: return null
            if (raw.isEmpty() || raw == "null") return null
            val unquoted = if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) {
                raw.substring(1, raw.length - 1).replace("\\\"", "\"")
            } else {
                raw
            }
            return parse(unquoted)
        }
    }
}
