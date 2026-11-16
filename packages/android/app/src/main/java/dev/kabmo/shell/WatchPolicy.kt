package dev.kabmo.shell

/**
 * When the background watcher may run, and how long it waits between attempts.
 *
 * Pure, so the two rules that fail SILENTLY on a device are pinned on a JVM:
 *
 * - **A watcher that cannot post is pure cost.** On API 33+ a denied
 *   `POST_NOTIFICATIONS` makes every `NotificationPoster.show` a no-op, so the
 *   service would hold a socket, a foreground row and a heartbeat for a banner
 *   the system drops. `shouldRun` refuses that combination, and the shell
 *   re-arms on the next resume once the grant exists.
 * - **A retry that never backs off is a radio that never sleeps.** A server
 *   that is down, or a phone that moved off its network, would otherwise be
 *   dialled every five seconds for as long as the app is away.
 *
 * The numbers live here and `NotificationWatchService` reads them: a second copy
 * in the loop would drift the moment one of the two was tuned.
 */
object WatchPolicy {

    /** The first wait after a failed attempt. */
    const val FIRST_RETRY_MS = 5_000L

    /** The ceiling: a server that has been down for an hour is still retried once a minute. */
    const val MAX_RETRY_MS = 60_000L

    /**
     * Whether the watcher has any reason to exist right now.
     *
     * All three are required, and each has its own failure: `armed` is the
     * console's switches, `canPost` is the OS permission, and `hasServer` is the
     * address the stream is read from. A service started without any of them
     * either posts nothing or connects nowhere.
     */
    fun shouldRun(armed: Boolean, canPost: Boolean, hasServer: Boolean): Boolean =
        armed && canPost && hasServer

    /** The next backoff, doubled and capped. */
    fun nextRetry(currentMs: Long): Long = (currentMs * 2).coerceAtMost(MAX_RETRY_MS)
}
