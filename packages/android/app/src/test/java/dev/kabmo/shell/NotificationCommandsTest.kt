package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The notification commands' wire, pinned literally.
 *
 * The page settles its `__kabmoCall` promise with exactly these strings, and the
 * client's own typing means a typo (`granted` vs `allowed`) is not a crash — it
 * is a permission prompt that never comes, or a toggle that says "on" while the
 * system refuses every banner. So the text is the test.
 */
class NotificationCommandsTest {

    private class FakeNotifier(
        var granted: Boolean = true,
        var shown: Boolean = true,
    ) : ShellNotifier {
        var requests = 0
        var last: Triple<String, String, String>? = null
        var lastSession: String? = null
        var lastWhen: Long = 0
        var lastDuration: Long = 0

        override fun isGranted(): Boolean = granted

        override fun requestPermission() {
            requests += 1
        }

        override fun show(
            title: String,
            body: String,
            tag: String,
            sessionId: String,
            whenMs: Long,
            durationMs: Long,
        ): Boolean {
            last = Triple(title, body, tag)
            lastSession = sessionId
            lastWhen = whenMs
            lastDuration = durationMs
            return shown
        }
    }

    @Test
    fun showAnswersWhatTheSystemDid() {
        val notifier = FakeNotifier(shown = true)
        assertEquals(
            "{\"shown\":true}",
            NotificationCommands.answer(
                "notification_show",
                mapOf(
                    "title" to "Build",
                    "body" to "The run finished.",
                    "tag" to "finish:s1",
                    "sessionId" to "s1",
                ),
                notifier,
            ),
        )
        assertEquals(Triple("Build", "The run finished.", "finish:s1"), notifier.last)
        assertEquals("s1", notifier.lastSession)
        // No timestamp or duration in the params: the shade falls back to the
        // posting moment and shows no subtext.
        assertEquals(0L, notifier.lastWhen)
        assertEquals(0L, notifier.lastDuration)
    }

    @Test
    fun theEventMomentAndDurationCrossTheBridge() {
        val notifier = FakeNotifier()
        NotificationCommands.answer(
            "notification_show",
            mapOf(
                "title" to "Build",
                "body" to "The run finished.",
                "tag" to "finish:s1",
                "sessionId" to "s1",
                "when" to "1763000000000",
                "durationMs" to "192000",
            ),
            notifier,
        )
        // A banner delivered later must keep the EVENT's moment, and say how
        // long the run took.
        assertEquals(1_763_000_000_000L, notifier.lastWhen)
        assertEquals(192_000L, notifier.lastDuration)
    }

    @Test
    fun aRefusedShowIsFalseAndNotAnError() {
        val notifier = FakeNotifier(granted = false, shown = false)
        assertEquals(
            "{\"shown\":false}",
            NotificationCommands.answer(
                "notification_show",
                mapOf("title" to "Build", "body" to "Waiting for you."),
                notifier,
            ),
        )
        // Missing fields decode as empty strings, never as a crash.
        assertEquals(Triple("Build", "Waiting for you.", ""), notifier.last)
    }

    @Test
    fun theRequestAsksTheActivityAndReportsTheCurrentGrant() {
        val notifier = FakeNotifier(granted = false)
        assertEquals(
            "{\"granted\":false}",
            NotificationCommands.answer("notification_request", emptyMap(), notifier),
        )
        assertEquals(1, notifier.requests)
    }

    @Test
    fun anotherCommandIsNotAnsweredHere() {
        assertNull(NotificationCommands.answer("servers_state", emptyMap(), FakeNotifier()))
    }
}
