package dev.kabmo.shell

import android.content.Context

/**
 * The persisted arming flag, and the one place the watcher is switched.
 *
 * The console pushes it (on boot, and whenever a notification switch changes)
 * because the shell has no page to ask once the app is backgrounded. The
 * watcher is started HERE, while the console is visible: Android 12+ refuses a
 * foreground-service start from the background, so `onStop` is already too late
 * — and a service that only starts when the app is away would have missed the
 * events that arrived in the meantime.
 *
 * Three things decide together (`WatchPolicy.shouldRun`): the console's
 * switches, the address to watch, and the OS permission to post. The last one is
 * checked here and re-checked on every pass of the watcher — a switch that is on
 * while `POST_NOTIFICATIONS` is denied would otherwise keep a foreground service
 * holding a socket for banners the system drops.
 */
class AndroidWatch(private val context: Context) : ShellWatch {

    override fun setArmed(armed: Boolean) {
        prefs(context).edit().putBoolean(KEY_ARMED, armed).apply()
        val canPost = NotificationPoster.isGranted(context)
        val hasServer = ServerConfig.read(context) != null
        if (!WatchPolicy.shouldRun(armed = armed, canPost = canPost, hasServer = hasServer)) {
            // Also the disarm path: the ongoing row is a promise that something
            // is listening, and a shell that cannot deliver must not keep it.
            NotificationWatchService.stop(context)
            return
        }
        startQuietly(context)
    }

    override fun isArmed(): Boolean = prefs(context).getBoolean(KEY_ARMED, false)

    companion object {
        private const val PREFS = "kabmo-shell"
        private const val KEY_ARMED = "notification_watch_armed"

        private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** Read without an instance, for `MainActivity`'s lifecycle. */
        fun armed(context: Context): Boolean = prefs(context).getBoolean(KEY_ARMED, false)

        /**
         * Start the watcher if it is armed and can post.
         *
         * Called on every resume, because a `POST_NOTIFICATIONS` grant that
         * arrives AFTER the switches were turned on — the system dialog the page
         * raised, or the toggle in Settings — is the one moment the service
         * becomes useful, and nothing else retries the arming. Idempotent: a
         * running service answers a second start with its existing worker.
         */
        fun rearm(context: Context) {
            val canPost = NotificationPoster.isGranted(context)
            val hasServer = ServerConfig.read(context) != null
            if (!WatchPolicy.shouldRun(armed(context), canPost, hasServer)) return
            startQuietly(context)
        }

        /**
         * A start that fails is logged, not thrown: `MainActivity.onResume`
         * calls this, and a platform refusal there would end the app.
         */
        private fun startQuietly(context: Context) {
            try {
                NotificationWatchService.start(context)
            } catch (error: Exception) {
                android.util.Log.w("KabmoWatch", "could not start the notification watcher", error)
            }
        }
    }
}
