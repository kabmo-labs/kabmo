package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The launch overlay's state machine.
 *
 * Every rule here is an ordering the platform actually produces, and each one
 * fails as a stuck or missing overlay rather than as an exception — which is
 * why they are pinned without an emulator. The WebView's callbacks are:
 * `onPageStarted`, a stream of `onProgressChanged`, then `onPageFinished`, and
 * a failed main-frame load adds `onReceivedError` and STILL fires
 * `onPageFinished` for the error page it renders.
 */
class LoadingStateTest {

    @Test
    fun startsHiddenSoAConsoleThatIsAlreadyUpDrawsNothing() {
        assertFalse(LoadingState.done().visible)
    }

    @Test
    fun connectingIsVisibleAndIndeterminate() {
        val state = LoadingState.connecting()
        assertTrue(state.visible)
        assertTrue(state.indeterminate)
    }

    @Test
    fun firstRealProgressBecomesDeterminate() {
        val state = LoadingState.connecting().progressed(35)
        assertEquals(LoadingState.Phase.LOADING, state.phase)
        assertEquals(35, state.percent)
        assertFalse(state.indeterminate)
    }

    @Test
    fun zeroProgressStaysIndeterminate() {
        // Chromium reports 0 on the first tick of some loads. Adopting it would
        // draw a determinate bar at 0 — the "stuck" look the overlay removes.
        val state = LoadingState.connecting().progressed(0)
        assertTrue(state.indeterminate)
        assertEquals(0, state.percent)
    }

    @Test
    fun progressNeverMovesBackwardsWithinALoad() {
        // A redirect restarts the document, and the WebView reports 100 then 10
        // again. A bar that snaps back reads as a stall.
        val state = LoadingState.connecting().progressed(100).progressed(10)
        assertEquals(100, state.percent)
    }

    @Test
    fun progressIsClampedToTheBar() {
        assertEquals(100, LoadingState.connecting().progressed(140).percent)
        assertEquals(0, LoadingState.connecting().progressed(-5).percent)
    }

    @Test
    fun finishedHidesTheOverlay() {
        val state = LoadingState.connecting().progressed(80).finished()
        assertFalse(state.visible)
        assertEquals(LoadingState.Phase.DONE, state.phase)
    }

    @Test
    fun progressAfterFinishedIsIgnored() {
        // A compositor frame can land after the page finished; adopting it
        // would re-open an overlay the user has already moved past.
        val done = LoadingState.connecting().finished()
        assertSame(done, done.progressed(40))
    }

    @Test
    fun aFailureSurvivesTheErrorPagesOwnPageFinished() {
        // The WebView renders an error page and then calls `onPageFinished`.
        // Hiding the overlay there leaves a blank paper screen with no reason.
        val failed = LoadingState.connecting().failedBecause(LoadingState.Failure.CONNECT)
        val afterFinished = failed.finished()
        assertEquals(LoadingState.Phase.FAILED, afterFinished.phase)
        assertEquals(LoadingState.Failure.CONNECT, afterFinished.failure)
        assertTrue(afterFinished.visible)
    }

    @Test
    fun progressAfterFailureIsIgnored() {
        val failed = LoadingState.connecting().failedBecause(LoadingState.Failure.TIMEOUT)
        assertSame(failed, failed.progressed(60))
    }

    @Test
    fun aNewLoadStartsFromZeroNotFromThePreviousPercent() {
        // `onPageStarted` begins every document. Re-using the previous state
        // left a reload's bar pinned at the finished load's 100%.
        val previous = LoadingState.connecting().progressed(100).finished()
        val next = LoadingState.connecting()
        assertTrue(next.indeterminate)
        assertEquals(0, next.percent)
        assertTrue(previous.visible.not())
    }

    @Test
    fun errorCodesMapToTheReasonsTheOverlayWords() {
        assertEquals(
            LoadingState.Failure.HOST_LOOKUP,
            LoadingState.failureFor(android.webkit.WebViewClient.ERROR_HOST_LOOKUP),
        )
        assertEquals(
            LoadingState.Failure.CONNECT,
            LoadingState.failureFor(android.webkit.WebViewClient.ERROR_CONNECT),
        )
        assertEquals(
            LoadingState.Failure.TIMEOUT,
            LoadingState.failureFor(android.webkit.WebViewClient.ERROR_TIMEOUT),
        )
        assertEquals(
            LoadingState.Failure.SSL,
            LoadingState.failureFor(android.webkit.WebViewClient.ERROR_FAILED_SSL_HANDSHAKE),
        )
        assertEquals(
            LoadingState.Failure.OTHER,
            LoadingState.failureFor(android.webkit.WebViewClient.ERROR_UNKNOWN),
        )
    }
}
