package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `initialScaleFor` is the conversion between the saved percent and the argument
 * `WebView.setInitialScale` takes, and getting it wrong made the whole zoom
 * setting look dead.
 *
 * `setInitialScale` counts percent of the DEVICE's default scale; the slider
 * counts percent of the PAGE. Handing it the bare percent is a bug that hides
 * well on an emulator: at density 1.0 the two happen to agree, so 100% looks
 * right — while on a real 420 dpi phone (density 2.625) every position from 50%
 * to 100% rendered at 0.38x and the console drew its desktop layout on a phone.
 * Measured through the real WebView at densities 1.0, 1.5, 2.0 and 2.625: the
 * product below is what made 50/100/200% land on page scale 0.5/1.0/2.0.
 *
 * No Android framework: the arithmetic is pure, so it runs on the JVM.
 */
class ZoomScaleTest {

    @Test
    fun multipliesByTheDisplayDensity() {
        assertEquals(100, ServerConfig.initialScaleFor(100, 1.0f))
        assertEquals(150, ServerConfig.initialScaleFor(100, 1.5f))
        assertEquals(200, ServerConfig.initialScaleFor(100, 2.0f))
        assertEquals(262, ServerConfig.initialScaleFor(100, 2.625f))
    }

    @Test
    fun yieldsTheSliderPercentAsAPageScale() {
        // The property the user sees: Blink divides the argument by the display
        // density and by 100 (`AwSettings::UpdateInitialPageScaleLocked`), so
        // what comes back must be the slider's own percent as a page scale.
        // This is the assertion that fails when the percent is passed straight
        // through — at density 2.625 a 100% setting then renders at 0.38x.
        for (density in listOf(1.0f, 1.5f, 2.0f, 2.625f, 3.5f)) {
            for (percent in ServerConfig.ZOOM_MIN..ServerConfig.ZOOM_MAX step ServerConfig.ZOOM_STEP) {
                val pageScale = ServerConfig.initialScaleFor(percent, density) / density / 100f
                assertEquals(
                    "$percent% at density $density should render at ${percent / 100f}x",
                    percent / 100f,
                    pageScale,
                    0.01f,
                )
            }
        }
    }

    @Test
    fun neverScalesToZero() {
        // `setInitialScale(0)` means "use the default", not "0%" — so a rounding
        // truncation must not reach it. 50% is the slider's floor and density
        // 1.0 is the lowest density Android ships.
        for (density in listOf(1.0f, 1.5f, 2.0f, 2.625f)) {
            val scale = ServerConfig.initialScaleFor(ServerConfig.ZOOM_MIN, density)
            assert(scale > 0) { "50% at density $density produced $scale" }
        }
    }

    @Test
    fun everySliderPositionIsDistinctAtTheHighestDensity() {
        // Adjacent percents must not collapse onto one scale, or a drag would
        // step through positions that render identically. This is what makes a
        // 1% grid honest: at density 1.0 the product is the percent itself, so
        // only the truncation in `initialScaleFor` could merge two neighbours.
        val scales = (ServerConfig.ZOOM_MIN..ServerConfig.ZOOM_MAX step ServerConfig.ZOOM_STEP)
            .map { ServerConfig.initialScaleFor(it, 2.625f) }
        assertEquals(scales.size, scales.toSet().size)
    }
}
