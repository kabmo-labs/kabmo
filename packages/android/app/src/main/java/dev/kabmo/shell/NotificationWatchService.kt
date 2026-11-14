package dev.kabmo.shell

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.webkit.CookieManager
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * The watcher that keeps the console's notifications arriving while the app is
 * not open.
 *
 * ## Why a foreground service
 *
 * The notification decision used to live in the page, and a backgrounded
 * Android WebView is frozen: its socket dies, no frame arrives, and the backlog
 * is announced in one burst when the app is resumed. Nothing in the page can
 * fix that, so the shell holds its own connection to the server's notification
 * stream (`GET /api/notifications/stream`) and posts the banners itself.
 *
 * Android only lets a process keep a network connection alive in the background
 * as a FOREGROUND service, so this one shows an ongoing row while it runs and
 * exists for as long as the console's notification switches are on
 * (`AndroidWatch`). It is started while the console is in the foreground
 * (Android 12+ refuses a foreground-service start from the background) and
 * stopped the moment the switches are turned off.
 *
 * A banner posted here and one posted by the open page share the notification
 * tag and id, so the same event never shows twice — whichever posts first wins
 * and the other replaces it.
 *
 * ## The cursor
 *
 * The last posted event id is persisted, and a reconnect resumes from it. A
 * first run sends no cursor and is answered with the newest id instead of the
 * outbox — a fresh install must not announce history.
 *
 * ## Auth
 *
 * The stream is behind the same session cookie as every other route. The
 * WebView's cookie jar is read for the active server's origin, which is the
 * only credential this process has and the same one the page uses.
 */
class NotificationWatchService : Service() {

    private var worker: Thread? = null

    @Volatile
    private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startWatching()
        // A process the system reclaimed while the app was away is restarted
        // with a null intent; the watcher must come back without one.
        return START_STICKY
    }

    private fun startWatching() {
        if (worker != null) return
        startForegroundNotification()
        worker = thread(name = "kabmo-notification-watch", isDaemon = true) {
            watchLoop()
        }
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        worker = null
        super.onDestroy()
    }

    /** The ongoing row that says the watcher is alive, and opens the console. */
    private fun startForegroundNotification() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    WATCH_CHANNEL_ID,
                    getString(R.string.watch_channel),
                    NotificationManager.IMPORTANCE_MIN,
                ).apply {
                    description = getString(R.string.watch_channel_description)
                    setShowBadge(false)
                },
            )
        }
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, WATCH_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this).setPriority(Notification.PRIORITY_MIN)
        }
        val notification = builder
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(getString(R.string.watch_title))
            .setContentText(getString(R.string.watch_body))
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(WATCH_NOTIFICATION_ID, notification, FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(WATCH_NOTIFICATION_ID, notification)
        }
    }

    private fun watchLoop() {
        var backoffMs = FIRST_RETRY_MS
        while (running) {
            val baseUrl = ServerConfig.read(this)
            if (baseUrl == null) {
                // Nothing to watch: a first run, or the list lost its active row.
                stopSelf()
                return
            }
            try {
                if (streamOnce(baseUrl)) backoffMs = FIRST_RETRY_MS
            } catch (_: InterruptedException) {
                return
            } catch (_: Exception) {
                // A dropped link, a server restart, a sleeping radio: retry.
            }
            if (!running) return
            try {
                Thread.sleep(backoffMs)
            } catch (_: InterruptedException) {
                return
            }
            backoffMs = (backoffMs * 2).coerceAtMost(MAX_RETRY_MS)
        }
    }

    /**
     * One connection's lifetime. Returns true when the server answered at all,
     * which is what resets the backoff.
     */
    private fun streamOnce(baseUrl: String): Boolean {
        val cursor = readCursor(baseUrl)
        val connection = (URL(NotificationWatch.streamUrl(baseUrl, cursor)).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            // An expired session answers 302 /login. Following it would read the
            // login page as an event stream (no frames, immediate EOF) instead of
            // retrying with the cookie the next sign-in refreshes.
            instanceFollowRedirects = false
            connectTimeout = CONNECT_TIMEOUT_MS
            // The stream is idle between events; the server's heartbeat is what
            // proves it is alive, so a read timeout would tear down a healthy
            // connection every time a run is quiet.
            readTimeout = 0
            setRequestProperty("Accept", "text/event-stream")
            setRequestProperty("Cache-Control", "no-cache")
            cookieFor(baseUrl)?.let { setRequestProperty("Cookie", it) }
        }
        var answered = false
        try {
            if (connection.responseCode !in 200..299) return false
            answered = true
            connection.inputStream.bufferedReader().use { reader ->
                var eventName: String? = null
                val data = StringBuilder()
                while (running) {
                    val line = reader.readLine() ?: break
                    when {
                        line.isEmpty() -> {
                            dispatch(eventName, data.toString(), baseUrl)
                            eventName = null
                            data.setLength(0)
                        }
                        line.startsWith("event:") -> eventName = line.removePrefix("event:").trim()
                        line.startsWith("data:") -> data.append(line.removePrefix("data:").trim())
                        // A comment frame is the heartbeat; nothing to do.
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
        return answered
    }

    private fun dispatch(eventName: String?, data: String, baseUrl: String) {
        if (data.isEmpty()) return
        when (eventName) {
            NotificationWatch.EVENT_NOTIFICATION -> {
                val event = NotificationWatch.parse(data) ?: return
                NotificationPoster.show(
                    this,
                    title = event.title,
                    body = event.body,
                    tag = "${event.kind}:${event.sessionId}",
                    sessionId = event.sessionId,
                    whenMs = event.at,
                    durationMs = event.durationMs ?: 0L,
                )
                writeCursor(baseUrl, event.id)
            }
            NotificationWatch.EVENT_CURSOR -> {
                NotificationWatch.parseCursor(data)?.let { writeCursor(baseUrl, it) }
            }
            // `disabled`: this platform's delivery master is off. The stream
            // stays open (heartbeats only) because the setting can be flipped
            // from another device, and a refused stream would reconnect forever.
        }
    }

    /**
     * The session cookie for `baseUrl`, read from the WebView's jar.
     *
     * `CookieManager` is a UI-thread API in practice, and this runs on the
     * watcher's worker, so the read is posted to the main thread and awaited.
     * A missing cookie is not fatal: the server answers 302/401 and the loop
     * retries, which is the same path a signed-out page takes.
     */
    private fun cookieFor(baseUrl: String): String? {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return CookieManager.getInstance().getCookie(baseUrl)
        }
        var cookie: String? = null
        val latch = CountDownLatch(1)
        Handler(Looper.getMainLooper()).post {
            try {
                cookie = CookieManager.getInstance().getCookie(baseUrl)
            } catch (_: Exception) {
                cookie = null
            } finally {
                latch.countDown()
            }
        }
        latch.await(COOKIE_WAIT_MS, TimeUnit.MILLISECONDS)
        return cookie
    }

    private fun readCursor(baseUrl: String): Long? {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        // A cursor belongs to the server that produced it: switching servers
        // must not skip the new one's events.
        if (prefs.getString(KEY_CURSOR_URL, null) != baseUrl) return null
        val stored = prefs.getLong(KEY_CURSOR, -1L)
        return if (stored >= 0) stored else null
    }

    private fun writeCursor(baseUrl: String, id: Long) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_CURSOR_URL, baseUrl)
            .putLong(KEY_CURSOR, id)
            .apply()
    }

    companion object {
        private const val WATCH_CHANNEL_ID = "kabmo-watch"
        private const val WATCH_NOTIFICATION_ID = 0x4b43
        private const val PREFS = "kabmo-shell"
        private const val KEY_CURSOR = "notification_cursor"
        private const val KEY_CURSOR_URL = "notification_cursor_url"
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val COOKIE_WAIT_MS = 2_000L
        private const val FIRST_RETRY_MS = 5_000L
        private const val MAX_RETRY_MS = 60_000L

        /**
         * `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` (API 34), spelled out so the
         * constant is not a second compile target. `dataSync` would be capped at
         * six hours a day on Android 15.
         */
        private const val FOREGROUND_SERVICE_TYPE_SPECIAL_USE = 0x40000000

        /** Start the watcher. Idempotent: a second call keeps the running one. */
        fun start(context: Context) {
            val intent = Intent(context, NotificationWatchService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /** Stop the watcher, if it is running. */
        fun stop(context: Context) {
            context.stopService(Intent(context, NotificationWatchService::class.java))
        }
    }
}
