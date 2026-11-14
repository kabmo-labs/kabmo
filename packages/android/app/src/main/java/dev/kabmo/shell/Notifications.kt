package dev.kabmo.shell

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build

/**
 * System notifications for the console: a run finished, an agent is blocked on
 * an answer, or a run failed.
 *
 * The console owns WHEN one is sent (three preferences, all off by default); this
 * shell owns HOW the platform draws it. Two commands, the same two the desktop
 * shells answer: `notification_request` and `notification_show`.
 *
 * ## Why the permission is requested from here
 *
 * On API 33+ `POST_NOTIFICATIONS` is a runtime permission, and a WebView cannot
 * ask for it. The page asks the shell, and the shell asks the user — the first
 * time a notification preference is switched on, never at launch. That is what
 * keeps the shipped-false defaults meaningful: a fresh install is not prompted
 * for banners it has not chosen.
 */
interface ShellNotifier {
    fun isGranted(): Boolean
    fun requestPermission()
    /**
     * Post one banner. `whenMs` is the event's own moment (0 = now) and
     * `durationMs` how long the run took (0 = not known, e.g. an `ask`).
     */
    fun show(
        title: String,
        body: String,
        kind: String,
        tag: String,
        sessionId: String,
        whenMs: Long,
        durationMs: Long,
    ): Boolean
}

/**
 * The two notification commands, as a PURE function of the notifier.
 *
 * Split from `ServerHost` so the wire — the exact JSON the page settles its
 * promise with — can be tested on a plain JVM, where `android.app.Notification`
 * cannot exist. `null` means "not a notification command"; the host falls
 * through to its own switch.
 */
object NotificationCommands {

    fun answer(method: String, fields: Map<String, String>, notifier: ShellNotifier): String? {
        return when (method) {
            "notification_show" -> {
                val shown = notifier.show(
                    title = fields["title"].orEmpty(),
                    body = fields["body"].orEmpty(),
                    kind = fields["kind"].orEmpty(),
                    tag = fields["tag"].orEmpty(),
                    sessionId = fields["sessionId"].orEmpty(),
                    whenMs = fields["when"]?.toLongOrNull() ?: 0L,
                    durationMs = fields["durationMs"]?.toLongOrNull() ?: 0L,
                )
                if (shown) "{\"shown\":true}" else "{\"shown\":false}"
            }

            "notification_request" -> {
                notifier.requestPermission()
                if (notifier.isGranted()) "{\"granted\":true}" else "{\"granted\":false}"
            }

            else -> null
        }
    }
}

/**
 * The platform half of posting, usable from an Activity OR a Service.
 *
 * Split out of `AndroidNotifier` because the background watcher
 * (`NotificationWatchService`) has no Activity: it runs while the console is
 * closed, which is the whole point of the stream it reads. One implementation
 * of the channel, the intent and the tag means a banner posted by the watcher
 * and one posted by the page are the same notification, not two.
 */
object NotificationPoster {

    /** A notification, not media: the phone's notification volume and DND apply. */
    private val NOTIFICATION_AUDIO: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    fun isGranted(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun show(
        context: Context,
        title: String,
        body: String,
        kind: String,
        tag: String,
        sessionId: String,
        whenMs: Long = 0L,
        durationMs: Long = 0L,
    ): Boolean {
        // Nothing to say, or nothing the user allowed: no notification either way.
        if (title.isBlank() && body.isBlank()) return false
        if (!isGranted(context)) return false
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return false
        ensureChannel(context, manager, kind)
        // A tag lets a second notification for the same session REPLACE the first
        // (`finish` and `error` cannot both fire for one run, but a refreshed
        // reason should not stack). An empty tag falls back to one stable tag.
        manager.notify(
            tag.ifEmpty { AndroidNotifier.TAG },
            AndroidNotifier.NOTIFICATION_ID,
            build(
                context = context,
                title = title,
                body = body,
                kind = kind,
                sessionId = sessionId,
                whenMs = whenMs,
                durationMs = durationMs,
                requestCode = tag.ifEmpty { AndroidNotifier.TAG }.hashCode(),
            ),
        )
        return true
    }

    private fun ensureChannel(context: Context, manager: NotificationManager, kind: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            NotificationSound.channelFor(kind),
            context.getString(NotificationSound.channelLabel(kind)),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(NotificationSound.channelDescription(kind))
            // The console's chime, not the platform default. The page stops
            // playing its Web Audio cue inside a shell precisely because the
            // banner plays this one; using the default tone here would mean the
            // shell had no Kabmo sound at all.
            setSound(
                Uri.parse(
                    NotificationSound.resourceUri(
                        context.packageName,
                        NotificationSound.soundResource(kind),
                    ),
                ),
                NOTIFICATION_AUDIO,
            )
        }
        manager.createNotificationChannel(channel)
        // A channel's sound is fixed when it is created, so the ids above are
        // NEW ones. Without this, an upgraded install keeps the old channel and
        // its default tone, and the notification settings show both.
        manager.deleteNotificationChannel(AndroidNotifier.LEGACY_CHANNEL_ID)
    }

    private fun build(
        context: Context,
        title: String,
        body: String,
        kind: String,
        sessionId: String,
        whenMs: Long,
        durationMs: Long,
        requestCode: Int,
    ): Notification {
        // Tapping the notification opens the console ON THAT SESSION. The intent
        // carries the id and `MainActivity` forwards it to
        // `window.__kabmoOpenSession`; without it, a tap opened whichever chat
        // happened to be on screen.
        //
        // The request code is the notification's tag: two notifications are two
        // PendingIntents, so tapping an older one cannot deliver the newer
        // session. `FLAG_UPDATE_CURRENT` still replaces a repeat for the same tag.
        val open = PendingIntent.getActivity(
            context,
            requestCode,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                if (sessionId.isNotBlank()) putExtra(AndroidNotifier.EXTRA_SESSION, sessionId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, NotificationSound.channelFor(kind))
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(context).setPriority(Notification.PRIORITY_DEFAULT)
        }
        return builder
            // A system glyph, not the launcher icon: a small icon is drawn as a
            // mask and an adaptive launcher icon does not survive that.
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title.ifBlank { context.getString(R.string.app_name) })
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            // The EVENT's moment, not the posting time: a banner delivered when
            // the app is next opened must not claim it just happened.
            .setWhen(if (whenMs > 0) whenMs else System.currentTimeMillis())
            .setShowWhen(true)
            // The shade has no duration slot; the subtext line is the one place
            // it can sit beside the timestamp without stealing body text.
            .apply { NotificationWatch.durationLabel(durationMs)?.let { setSubText(it) } }
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
    }
}

/** The notifier the page's bridge commands use: an Activity, for the prompt. */
class AndroidNotifier(private val activity: Activity) : ShellNotifier {

    override fun isGranted(): Boolean = NotificationPoster.isGranted(activity)

    override fun requestPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (isGranted()) return
        // The permission dialog is an Activity/UI-thread API, and this arrives on
        // the WebView's JS thread.
        activity.runOnUiThread {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE)
        }
    }

    override fun show(
        title: String,
        body: String,
        kind: String,
        tag: String,
        sessionId: String,
        whenMs: Long,
        durationMs: Long,
    ): Boolean = NotificationPoster.show(activity, title, body, kind, tag, sessionId, whenMs, durationMs)

    companion object {
        /**
         * The channel carrying the Kabmo chime.
         *
         * `-v2` and not the bare id: Android freezes a channel's sound at
         * creation, so an install that already had `kabmo-agent` would keep the
         * platform's default tone for its whole lifetime. The old id is deleted
         * when this one is created.
         */
        const val CHANNEL_ID = "kabmo-agent-v2"
        /** The ask channel: its own sound, so "waiting for you" is unmistakable. */
        const val ATTENTION_CHANNEL_ID = "kabmo-attention-v2"
        /** The pre-chime channels, removed on first post after an upgrade. */
        const val LEGACY_CHANNEL_ID = "kabmo-agent"
        /** The session a notification tap opens, read by `MainActivity`. */
        const val EXTRA_SESSION = "dev.kabmo.shell.OPEN_SESSION"
        const val TAG = "kabmo"
        const val NOTIFICATION_ID = 0x4b41
        const val REQUEST_CODE = 0x4b42
    }
}
