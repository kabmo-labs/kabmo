package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The channel's sound URI and the channel-per-kind rule, pinned literally.
 *
 * Android accepts a wrong URI without complaining and simply plays no sound, and
 * a channel is the only place a notification's sound can come from on API 26+.
 * Both failures are silent: "the notification makes the wrong noise" has no
 * error to read, so the strings are the contract.
 */
class NotificationSoundTest {

    @Test
    fun theUriNamesThePackageAndTheResource() {
        assertEquals(
            "android.resource://dev.kabmo.shell/2131623936",
            NotificationSound.resourceUri("dev.kabmo.shell", 2131623936),
        )
    }

    @Test
    fun anAskGetsItsOwnChannelAndChime() {
        // Two cues, two channels: Android takes a notification's sound from the
        // channel, so "waiting for you" cannot share one with "finished".
        assertEquals(AndroidNotifier.ATTENTION_CHANNEL_ID, NotificationSound.channelFor("ask"))
        assertEquals(AndroidNotifier.CHANNEL_ID, NotificationSound.channelFor("finish"))
        assertEquals(AndroidNotifier.CHANNEL_ID, NotificationSound.channelFor("error"))
        // An older console may send no kind at all; the completion chime is the
        // sane default, never the attention cue.
        assertEquals(AndroidNotifier.CHANNEL_ID, NotificationSound.channelFor(""))
    }

    @Test
    fun theTwoChannelsAreDistinct() {
        assertNotEquals(
            "the ask channel is not the agent channel",
            NotificationSound.channelFor("ask"),
            NotificationSound.channelFor("finish"),
        )
        assertTrue(NotificationSound.isAttention("ask"))
        assertFalse(NotificationSound.isAttention("error"))
    }

    @Test
    fun theSchemeIsTheOneTheFrameworkAccepts() {
        // Three slashes: `android.resource://<authority>/<id>` — the id is a PATH
        // segment, not an opaque string, which is the shape `Uri.parse` and
        // `NotificationChannel.setSound` accept.
        assertEquals(
            "android.resource://dev.kabmo.shell/1",
            NotificationSound.resourceUri("dev.kabmo.shell", 1),
        )
    }
}
