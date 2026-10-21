package dev.kabmo.shell

import android.webkit.WebViewClient

/**
 * What the launch overlay is showing, as a value.
 *
 * Pure on purpose: the rules below are the ones that fail silently in a real
 * WebView (a late frame resurrecting a finished overlay, an error page's own
 * `onPageFinished` hiding the failure), and a JVM test can pin every one of
 * them without an emulator.
 *
 * The bar is INDETERMINATE until the WebView reports real progress. A
 * determinate bar sitting at 0 is indistinguishable from a stuck one, and the
 * first seconds of a cold start are exactly when the user is deciding whether
 * the app is broken.
 */
data class LoadingState(
    val phase: Phase,
    val percent: Int = 0,
    val failure: Failure? = null,
) {

    enum class Phase { CONNECTING, LOADING, DONE, FAILED }

    /** Why a load failed. The overlay maps each to one sentence. */
    enum class Failure { HOST_LOOKUP, CONNECT, TIMEOUT, SSL, OTHER }

    /** `DONE` is the only state that draws nothing. */
    val visible: Boolean get() = phase != Phase.DONE

    /** No progress has been reported yet, so the bar has no meaningful value. */
    val indeterminate: Boolean get() = phase == Phase.CONNECTING

    /**
     * A progress frame from the WebView.
     *
     * Three rules, each a real ordering the platform produces:
     *
     * 1. **A frame after `DONE` or `FAILED` is ignored.** Progress callbacks
     *    arrive from the compositor and can land after the page finished or
     *    after an error was reported; adopting one would re-open an overlay the
     *    user has already moved past.
     * 2. **Progress never moves backwards within a load.** A redirect restarts
     *    the document, and the WebView reports 100 then 10 again; a bar that
     *    snaps back reads as a stall. A genuine new load starts from
     *    [connecting], not from a progress frame.
     * 3. **A zero frame stays indeterminate.** Chromium reports 0 for the first
     *    tick of some loads, and that would draw the stuck-at-zero bar rule 1
     *    exists to avoid.
     */
    fun progressed(value: Int): LoadingState {
        if (phase == Phase.DONE || phase == Phase.FAILED) return this
        val clamped = value.coerceIn(0, 100)
        if (clamped == 0 && phase == Phase.CONNECTING) return this
        return copy(phase = Phase.LOADING, percent = maxOf(percent, clamped))
    }

    /**
     * The page finished loading.
     *
     * A failure is NOT overwritten: a failed main-frame load still fires
     * `onPageFinished` for the error page the WebView renders, and adopting
     * that would hide the explanation behind a blank paper screen — the exact
     * silent state the overlay exists to remove.
     *
     * 100% is not a finish. The WebView reports 100 before `onPageFinished`,
     * and the server's shell is still fetching the client bundle at that point,
     * so only this call closes the overlay.
     */
    fun finished(): LoadingState =
        if (phase == Phase.FAILED) this else copy(phase = Phase.DONE)

    /** A main-frame load failed; the overlay stays up with the reason and actions. */
    fun failedBecause(failure: Failure): LoadingState =
        copy(phase = Phase.FAILED, failure = failure)

    companion object {
        /**
         * Whether a `onPageStarted` means the user asked for the page again.
         *
         * A page's own reload control calls `location.reload()`, which the
         * WebView reports as an ordinary document load — no `isReload` flag
         * reaches `onPageStarted`, and `doUpdateVisitedHistory` reports
         * `isReload=false` for it too (measured on Android 15 against a stub
         * that reloads itself: `shouldOverrideUrlLoading`, then `onPageStarted`
         * with the SAME url, while a `location.href = '/other'` navigation
         * reports a different one).
         *
         * So the URL is the only signal there is: a load that starts at the
         * address already on screen is the same document being fetched again.
         * That is what makes a reload show the overlay while an in-app
         * navigation (the login submit's `location.replace('/')` included) does
         * not — and the comparison is on the FULL url, because a query or hash
         * change is a navigation to a different view, not a re-fetch.
         *
         * Only a document that has FINISHED counts. `startLoad` arms the overlay
         * itself before it calls `loadUrl`, and the first `onPageStarted` of a
         * cold start therefore arrives while the WebView still shows the
         * previous document's address — treating that as a reload would restart
         * the state machine's own arm.
         */
        fun isDocumentReload(startedUrl: String?, shownUrl: String?, phase: Phase): Boolean =
            phase == Phase.DONE && !startedUrl.isNullOrEmpty() && startedUrl == shownUrl

        /** A load is about to start, or has started and reported nothing yet. */
        fun connecting(): LoadingState = LoadingState(Phase.CONNECTING)

        /** Nothing to draw: the overlay starts hidden and returns here. */
        fun done(): LoadingState = LoadingState(Phase.DONE)

        /**
         * `WebViewClient`'s error code, as one of our own reasons.
         *
         * The constants are compile-time ints, so this file stays pure and the
         * test runs on the JVM without an Android runtime.
         */
        fun failureFor(errorCode: Int): Failure = when (errorCode) {
            WebViewClient.ERROR_HOST_LOOKUP -> Failure.HOST_LOOKUP
            WebViewClient.ERROR_CONNECT -> Failure.CONNECT
            WebViewClient.ERROR_TIMEOUT -> Failure.TIMEOUT
            WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> Failure.SSL
            else -> Failure.OTHER
        }
    }
}
