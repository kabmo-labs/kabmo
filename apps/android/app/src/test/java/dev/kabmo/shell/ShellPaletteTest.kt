package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The overlay's palette, pinned on the JVM.
 *
 * Every case is a colour a user sees for the seconds before the console paints,
 * and each failure is silent: a parser that accepts six fields paints
 * `#000000` where the console paints paper, one that rejects the WebView's own
 * quoting never updates at all, and a default that drifts from the shared
 * module leaves a first launch painting a palette no theme chose.
 *
 * The wire is deliberately NOT JSON: `org.json` is a stub in a JVM unit test,
 * so a JSON parser could only be tested on a device — the one thing this suite
 * exists to avoid.
 */
class ShellPaletteTest {

    /** `shellPaletteWire(shellPalette(null))` from `src/shared/lib/theme/shell-palette.ts`. */
    private val defaultWire = "light|#f4f1ea|#faf8f3|#141310|#696763|#d5d2cb|#c8321e"

    /** `shellPaletteWire(shellPalette('one-dark-pro-soft'))`. */
    private val darkWire = "dark|#21252b|#282c34|#abb2bf|#777c87|#343940|#e06c75"

    @Test
    fun theDefaultMatchesTheSharedModule() {
        // A hand-typed copy is what this pins: the five shells' first-launch
        // colours have to be the shared projection's, or a fresh install paints
        // a palette that exists in no theme.
        assertEquals(defaultWire, ShellPalette.DEFAULT.wire())
        assertFalse(ShellPalette.DEFAULT.isDark)
    }

    @Test
    fun aWireRoundTrips() {
        val parsed = ShellPalette.parse(darkWire)
        assertEquals(darkWire, parsed?.wire())
        assertEquals("#21252b", parsed?.canvas)
        assertEquals("#e06c75", parsed?.error)
        assertTrue(parsed?.isDark == true)
    }

    @Test
    fun anUnreadableWireIsNullRatherThanHalfAPalette() {
        // A partial palette would paint some fields and leave the rest at zero,
        // which reads as a different theme rather than as no answer.
        for (bad in listOf(
            null,
            "",
            "light",
            "light|#f4f1ea|#faf8f3|#141310|#696763|#d5d2cb",
            "$defaultWire|extra",
            defaultWire.replace("light", "sepia"),
            defaultWire.replace("#f4f1ea", "#f4f1e"),
            defaultWire.replace("#f4f1ea", "rgb(244,241,234)"),
        )) {
            assertNull("accepted $bad", ShellPalette.parse(bad))
        }
    }

    @Test
    fun theWebViewQuotingIsUnwrapped() {
        // `evaluateJavascript` answers a JS string as JSON, so the value arrives
        // quoted. Reading it raw rejected every answer and the overlay kept the
        // palette it was constructed with — for ever.
        assertEquals(darkWire, ShellPalette.fromJavascript("\"$darkWire\"")?.wire())
    }

    @Test
    fun anAbsentPublisherLeavesTheStoredPaletteAlone() {
        // An older console build, or a load that failed before the script ran.
        // The string "null" is the literal result, and it must not parse.
        for (absent in listOf(null, "", "  ", "null", "undefined")) {
            assertNull("accepted $absent", ShellPalette.fromJavascript(absent))
        }
    }

    @Test
    fun anUnquotedAnswerStillParses() {
        // Some WebView versions hand back the raw string; the unwrap is
        // conditional so this stays readable either way.
        assertEquals(darkWire, ShellPalette.fromJavascript(darkWire)?.wire())
    }
}
