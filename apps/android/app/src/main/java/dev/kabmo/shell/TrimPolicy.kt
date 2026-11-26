package dev.kabmo.shell

import android.content.ComponentCallbacks2

/**
 * What the shell gives back for each `onTrimMemory` level.
 *
 * The console is one WebView holding a long transcript, a code editor and up to
 * eight xterm buffers, so its renderer is the largest allocation on the device —
 * and Android reclaims a background app by killing the process, which is what
 * "Kabmo restarts when I come back to it" looks like from the outside. Acting on
 * the level the platform sends is the only lever the shell has.
 *
 * The mapping is a pure function so it can be tested without a device, the same
 * shape as `ZoomClamp` and `LoadingState`.
 *
 * **Nothing here reloads or clears the document.** The console's state is the
 * server's, and a reload would cost the user their scroll position to save memory
 * the WebView is about to be asked for anyway. `freeMemory()` asks the renderer to
 * drop what it can rebuild; the HTTP cache and the timers are the extra steps
 * only a critical level justifies.
 */
object TrimPolicy {

    enum class Action {
        /** Nothing worth doing at this level. */
        NONE,

        /** Ask the renderer to release rebuildable resources. */
        RELEASE,

        /** Also drop the HTTP cache and pause the WebView's timers. */
        CRITICAL,
    }

    /**
     * The action for a `ComponentCallbacks2` level.
     *
     * The levels are not a monotonic scale — `TRIM_MEMORY_UI_HIDDEN` (20) is
     * higher than `TRIM_MEMORY_RUNNING_LOW` (10) but is not more urgent — so the
     * mapping names every value the platform documents rather than comparing
     * thresholds. Anything unknown is `NONE`: a level a future Android adds is not
     * evidence that this app should throw its caches away.
     */
    fun forLevel(level: Int): Action = when (level) {
        ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE,
        ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW,
        ComponentCallbacks2.TRIM_MEMORY_BACKGROUND,
        ComponentCallbacks2.TRIM_MEMORY_MODERATE,
        ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN,
        -> Action.RELEASE

        // `COMPLETE` is the deprecated spelling of the same "about to be killed"
        // case `RUNNING_CRITICAL` reports while the app is still visible.
        ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL,
        @Suppress("DEPRECATION")
        ComponentCallbacks2.TRIM_MEMORY_COMPLETE,
        -> Action.CRITICAL

        else -> Action.NONE
    }
}
