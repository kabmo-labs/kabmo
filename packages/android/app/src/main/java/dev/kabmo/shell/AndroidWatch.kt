package dev.kabmo.shell

import android.content.Context

/**
 * The persisted watch state, and the one place the watcher is switched.
 *
 * Two facts decide it together, and they belong to different owners:
 *
 * - **`armed`** is the console's: whether any notification event is switched on
 *   for mobile. The console pushes it (on boot, and whenever a switch changes)
 *   because the shell has no page to ask once the app is backgrounded.
 * - **`background`** is this shell's: whether the app may keep a foreground
 *   service (and therefore an ongoing "Agent notifications are on" row) alive
 *   while it is closed. Default OFF. Android does not let an app hide that row,
 *   so running the watcher by default pushed a permanent notification onto every
 *   install; the row is now the price of a switch the user turns on in Kabmo's
 *   Server settings, not something the console's switches imply.
 *
 * The watcher is started HERE, while the console is visible: Android 12+ refuses
 * a foreground-service start from the background, so `onStop` is already too
 * late — and a service that only starts when the app is away would have missed
 * the events that arrived in the meantime.
 *
 * Two more things are required (`WatchPolicy.shouldRun`): the address to watch,
 * and the OS permission to post. The permission is checked here and re-checked
 * on every pass of the watcher — a switch that is on while `POST_NOTIFICATIONS`
 * is denied would otherwise keep a foreground service holding a socket for
 * banners the system drops.
 */
class AndroidWatch(private val context: Context) : ShellWatch {

    override fun setArmed(armed: Boolean) {
        prefs(context).edit().putBoolean(KEY_ARMED, armed).apply()
        apply(context)
    }

    override fun isArmed(): Boolean = prefs(context).getBoolean(KEY_ARMED, false)

    companion object {
        private const val PREFS = "kabmo-shell"
        private const val KEY_ARMED = "notification_watch_armed"
        private const val KEY_BACKGROUND = "background_notifications"

        private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** Read without an instance, for `MainActivity`'s lifecycle. */
        fun armed(context: Context): Boolean = prefs(context).getBoolean(KEY_ARMED, false)

        /** Whether this shell may watch while closed, from its own Settings screen. */
        fun backgroundWanted(context: Context): Boolean = prefs(context).getBoolean(KEY_BACKGROUND, false)

        /**
         * Turn background delivery on or off, from the Settings screen, and
         * start or stop the watcher on the spot: the row is the visible half of
         * the switch, so it must appear and disappear with it.
         */
        fun setBackgroundWanted(context: Context, wanted: Boolean) {
            prefs(context).edit().putBoolean(KEY_BACKGROUND, wanted).apply()
            apply(context)
        }

        /**
         * Start or stop the watcher to match the stored state.
         *
         * Called on every resume, because a `POST_NOTIFICATIONS` grant that
         * arrives AFTER the switches were turned on — the system dialog the page
         * raised, or the toggle in Settings — is the one moment the service
         * becomes useful, and nothing else retries the arming. Idempotent: a
         * running service answers a second start with its existing worker.
         */
        fun rearm(context: Context) {
            apply(context)
        }

        private fun apply(context: Context) {
            val canPost = NotificationPoster.isGranted(context)
            val hasServer = ServerConfig.read(context) != null
            if (!WatchPolicy.shouldRun(
                    armed = armed(context),
                    background = backgroundWanted(context),
                    canPost = canPost,
                    hasServer = hasServer,
                )
            ) {
                // Also the disarm path: the ongoing row is a promise that something
                // is listening, and a shell that cannot deliver must not keep it.
                NotificationWatchService.stop(context)
                return
            }
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
