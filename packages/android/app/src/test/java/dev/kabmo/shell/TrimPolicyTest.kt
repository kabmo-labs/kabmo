package dev.kabmo.shell

import android.content.ComponentCallbacks2
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The trim mapping, pinned at every level the platform documents.
 *
 * The failure this prevents is silent in both directions: a level mapped to
 * `NONE` that should have released memory leaves the shell to be killed, and a
 * level mapped to `CRITICAL` too eagerly throws away a cache the user pays for on
 * the next load.
 */
class TrimPolicyTest {

    @Test
    fun `running low asks the renderer to release`() {
        assertEquals(TrimPolicy.Action.RELEASE, TrimPolicy.forLevel(ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW))
        assertEquals(TrimPolicy.Action.RELEASE, TrimPolicy.forLevel(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE))
    }

    @Test
    fun `a background app releases before it is killed`() {
        assertEquals(TrimPolicy.Action.RELEASE, TrimPolicy.forLevel(ComponentCallbacks2.TRIM_MEMORY_BACKGROUND))
        assertEquals(TrimPolicy.Action.RELEASE, TrimPolicy.forLevel(ComponentCallbacks2.TRIM_MEMORY_MODERATE))
    }

    @Test
    fun `hiding the UI releases`() {
        assertEquals(TrimPolicy.Action.RELEASE, TrimPolicy.forLevel(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN))
    }

    @Test
    fun `critical is the only level that drops the cache and pauses timers`() {
        assertEquals(TrimPolicy.Action.CRITICAL, TrimPolicy.forLevel(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL))
        @Suppress("DEPRECATION")
        assertEquals(TrimPolicy.Action.CRITICAL, TrimPolicy.forLevel(ComponentCallbacks2.TRIM_MEMORY_COMPLETE))
    }

    @Test
    fun `an unknown level is not a reason to throw anything away`() {
        assertEquals(TrimPolicy.Action.NONE, TrimPolicy.forLevel(999))
        assertEquals(TrimPolicy.Action.NONE, TrimPolicy.forLevel(0))
    }
}
