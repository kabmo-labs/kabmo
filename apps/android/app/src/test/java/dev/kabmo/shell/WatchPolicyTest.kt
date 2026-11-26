package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The watcher rules, pinned where they cannot be observed on a phone.
 *
 * A denied notification permission, a watch nobody switched on and a retry that
 * never backs off all look like "the app is fine" from the outside: the first is
 * a service running for a banner the system drops, the second is the permanent
 * ongoing notification every install used to get, and the third is a radio that
 * never idles. The JVM suite is the only place any of them can be asserted.
 */
class WatchPolicyTest {

    @Test
    fun `all four reasons are required`() {
        assertTrue(WatchPolicy.shouldRun(armed = true, background = true, canPost = true, hasServer = true))

        // The console's switches are off: nothing was asked for.
        assertFalse(WatchPolicy.shouldRun(armed = false, background = true, canPost = true, hasServer = true))
        // The shell's own opt-in is off: the ongoing row must not exist.
        assertFalse(WatchPolicy.shouldRun(armed = true, background = false, canPost = true, hasServer = true))
        // Nothing can be posted: every banner would be dropped by the system.
        assertFalse(WatchPolicy.shouldRun(armed = true, background = true, canPost = false, hasServer = true))
        // Nowhere to read from: the loop would stop itself on the first pass.
        assertFalse(WatchPolicy.shouldRun(armed = true, background = true, canPost = true, hasServer = false))
    }

    @Test
    fun `the default state runs nothing`() {
        // A fresh install: switches may be on, but the shell's opt-in is not.
        assertFalse(WatchPolicy.shouldRun(armed = true, background = false, canPost = true, hasServer = true))
    }

    @Test
    fun `the retry doubles`() {
        assertEquals(10_000L, WatchPolicy.nextRetry(5_000L))
        assertEquals(20_000L, WatchPolicy.nextRetry(10_000L))
        assertEquals(40_000L, WatchPolicy.nextRetry(20_000L))
    }

    @Test
    fun `the retry is capped, not unbounded`() {
        assertEquals(WatchPolicy.MAX_RETRY_MS, WatchPolicy.nextRetry(40_000L))
        assertEquals(WatchPolicy.MAX_RETRY_MS, WatchPolicy.nextRetry(WatchPolicy.MAX_RETRY_MS))
        // Capped from a value already past it: a stored or hand-edited number
        // must not overflow into a negative sleep.
        assertEquals(WatchPolicy.MAX_RETRY_MS, WatchPolicy.nextRetry(Long.MAX_VALUE / 2))
    }

    @Test
    fun `the first wait is below the ceiling`() {
        assertTrue(WatchPolicy.FIRST_RETRY_MS > 0)
        assertTrue(WatchPolicy.FIRST_RETRY_MS < WatchPolicy.MAX_RETRY_MS)
    }
}
