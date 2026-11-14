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
 */
class AndroidWatch(private val context: Context) : ShellWatch {

    override fun setArmed(armed: Boolean) {
        prefs(context).edit().putBoolean(KEY_ARMED, armed).apply()
        if (!armed) {
            // The ongoing row is a promise that something is listening; a
            // disarmed shell must not keep showing it.
            NotificationWatchService.stop(context)
            return
        }
        // Started from HERE, while the console is visible: Android 12+ refuses a
        // foreground-service start from the background, and `onStop` is already
        // the background. This is also the only moment the shell knows the user
        // armed it at all.
        if (ServerConfig.read(context) == null) return
        try {
            NotificationWatchService.start(context)
        } catch (error: Exception) {
            android.util.Log.w("KabmoWatch", "could not start the notification watcher", error)
        }
    }

    override fun isArmed(): Boolean = prefs(context).getBoolean(KEY_ARMED, false)

    companion object {
        private const val PREFS = "kabmo-shell"
        private const val KEY_ARMED = "notification_watch_armed"

        private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** Read without an instance, for `MainActivity`'s lifecycle. */
        fun armed(context: Context): Boolean = prefs(context).getBoolean(KEY_ARMED, false)
    }
}
