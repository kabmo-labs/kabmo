package dev.kabmo.shell

/**
 * The notification channels' sounds, as PURE strings.
 *
 * The channels play the chimes the console synthesizes, shipped as
 * `res/raw/kabmo_notification.wav` and `res/raw/kabmo_attention.wav` (copied from
 * `assets/notification-sound/` by the Gradle build).
 *
 * ## Why an ask gets its own channel
 *
 * On API 26+ a notification's sound comes from its CHANNEL, and
 * `Notification.Builder.setSound` is ignored. The console has two cues — a
 * climbing chime for "finished" and a falling one for "the agent is blocked on
 * you" — and the second is the one that must not be mistaken for the first. One
 * channel could only carry one of them, so each sound has its own, named for
 * what it means. The user can mute "Waiting for you" without silencing finishes,
 * which is the behaviour the two cues imply.
 *
 * A channel's sound is fixed at creation; that is why these ids carry `-v2` and
 * the pre-chime channel is deleted rather than reused.
 *
 * A malformed resource URI is not a crash either: Android accepts the channel
 * and plays **nothing**, which looks exactly like a muted phone. So the shape is
 * pinned in a JVM test, the one place it can be.
 */
object NotificationSound {

    /** `android.resource://<package>/<id>` — what `NotificationChannel.setSound` takes. */
    fun resourceUri(packageName: String, resourceId: Int): String =
        "android.resource://$packageName/$resourceId"

    /** True for the event that means "the agent cannot continue without you". */
    fun isAttention(kind: String): Boolean = kind == "ask"

    /** The channel a kind posts to — and therefore the sound it plays. */
    fun channelFor(kind: String): String =
        if (isAttention(kind)) AndroidNotifier.ATTENTION_CHANNEL_ID else AndroidNotifier.CHANNEL_ID

    /** The channel's label, so the two sounds are distinguishable in Settings. */
    fun channelLabel(kind: String): Int =
        if (isAttention(kind)) R.string.attention_channel else R.string.notification_channel

    /** The channel's description: what will arrive on it. */
    fun channelDescription(kind: String): Int =
        if (isAttention(kind)) R.string.attention_channel_description else R.string.notification_channel_description

    /** The chime resource the channel is created with. */
    fun soundResource(kind: String): Int =
        if (isAttention(kind)) R.raw.kabmo_attention else R.raw.kabmo_notification
}
