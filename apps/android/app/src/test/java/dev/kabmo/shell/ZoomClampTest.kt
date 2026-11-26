package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `clampZoom` is what keeps a stored percent inside the range the slider can
 * draw. A value the slider cannot represent renders as a thumb at one end while
 * the page scales by something else — the exact mismatch this pins.
 *
 * No Android framework: `ServerConfig.zoom` reads `SharedPreferences`, but the
 * arithmetic is pure and that is where the bugs are.
 */
class ZoomClampTest {

    @Test
    fun keepsAValueOnTheGrid() {
        assertEquals(100, ServerConfig.clampZoom(100))
        assertEquals(170, ServerConfig.clampZoom(170))
        assertEquals(50, ServerConfig.clampZoom(50))
        assertEquals(200, ServerConfig.clampZoom(200))
    }

    @Test
    fun keepsEveryWholePercent() {
        // The grid is 1%, so a stored value is already a slider position. The
        // earlier 10% grid snapped 104 down to 100, which is the coarseness this
        // test now pins the absence of.
        assertEquals(104, ServerConfig.clampZoom(104))
        assertEquals(151, ServerConfig.clampZoom(151))
        assertEquals(199, ServerConfig.clampZoom(199))
    }

    @Test
    fun clampsOutsideTheRange() {
        assertEquals(50, ServerConfig.clampZoom(0))
        assertEquals(50, ServerConfig.clampZoom(-40))
        assertEquals(200, ServerConfig.clampZoom(999))
        assertEquals(200, ServerConfig.clampZoom(210))
    }

    @Test
    fun alwaysLandsOnAReachableStep() {
        // Every integer the app might store must map to a slider position, so a
        // hand-written preference (adb, an older build) cannot desync the thumb.
        for (percent in -100..400) {
            val clamped = ServerConfig.clampZoom(percent)
            assertEquals(
                "clampZoom($percent) = $clamped is not on the grid",
                0,
                (clamped - ServerConfig.ZOOM_MIN) % ServerConfig.ZOOM_STEP,
            )
            assert(clamped in ServerConfig.ZOOM_MIN..ServerConfig.ZOOM_MAX) {
                "clampZoom($percent) = $clamped is outside the range"
            }
        }
    }
}
