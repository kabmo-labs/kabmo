package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The notification stream's wire, pinned literally.
 *
 * The server writes the payload (`NotificationEvent` in
 * `shared/lib/notifications/events.ts`) and this shell reads it with the small
 * reader in `NotificationWatch`; a field renamed on one side is otherwise a
 * banner with no title, or a cursor that never advances and a backlog announced
 * again on every reconnect. So both halves of the frame are asserted here: the
 * parse, and the URL that asks for the next one.
 */
class NotificationWatchTest {

    @Test
    fun readsOneEvent() {
        val event = NotificationWatch.parse(
            """{"id":42,"kind":"error","sessionId":"s-1","title":"Fix the build","body":"The run ended with error","at":1763000000000}""",
        )
        assertEquals(1_763_000_000_000L, event?.at)
        assertEquals(
            WatchEvent(42, "error", "s-1", "Fix the build", "The run ended with error", 1_763_000_000_000L, null),
            event,
        )
    }

    @Test
    fun decodesEscapesInTheBody() {
        // A failure reason is a provider sentence, so quotes and newlines reach
        // this reader verbatim.
        val event = NotificationWatch.parse(
            """{"id":7,"kind":"finish","sessionId":"s-2","title":"a \"quoted\" name","body":"line one\nline two","at":1}""",
        )
        assertEquals("a \"quoted\" name", event?.title)
        assertEquals("line one\nline two", event?.body)
    }

    @Test
    fun refusesMalformedPayloads() {
        // No id: the cursor could not advance, so this is not an event we can
        // post without risking a second delivery.
        assertNull(NotificationWatch.parse("""{"kind":"finish","sessionId":"s"}"""))
        // No session: a tap would open nothing.
        assertNull(NotificationWatch.parse("""{"id":1,"kind":"finish"}"""))
        // Truncated, nested and empty payloads.
        assertNull(NotificationWatch.parse("""{"id":1,"kind":"finish","sessionId":"s""""))
        assertNull(NotificationWatch.parse("""{"id":1,"kind":{"a":1},"sessionId":"s"}"""))
        assertNull(NotificationWatch.parse(""))
    }

    @Test
    fun readsTheRunDurationWhenTheServerKnewItsStart() {
        val event = NotificationWatch.parse(
            """{"id":8,"kind":"finish","sessionId":"s-3","title":"T","body":"B","at":1763000000000,"durationMs":192000}""",
        )
        assertEquals(192_000L, event?.durationMs)
    }

    @Test
    fun formatsADurationTheWayTheShadeReadsIt() {
        assertNull(NotificationWatch.durationLabel(0))
        assertNull(NotificationWatch.durationLabel(-5))
        assertEquals("48s", NotificationWatch.durationLabel(48_000))
        // Truncated, not rounded: a banner that says 3m when the run is 3m59s is
        // claiming more than the clock showed.
        assertEquals("3m 12s", NotificationWatch.durationLabel(192_000))
        assertEquals("1h 04m", NotificationWatch.durationLabel(3_840_000))
    }

    @Test
    fun readsTheCursorPrime() {
        assertEquals(9L, NotificationWatch.parseCursor("""{"id":9}"""))
        assertNull(NotificationWatch.parseCursor("""{"events":[]}"""))
    }

    @Test
    fun asksForTheNextPageFromTheLastSeenId() {
        assertEquals(
            "http://nas:3000/api/notifications/stream?platform=mobile&after=31",
            NotificationWatch.streamUrl("http://nas:3000", 31),
        )
        // A first run omits the cursor: the server answers with the newest id
        // instead of the outbox, so history is never announced.
        assertEquals(
            "http://nas:3000/api/notifications/stream?platform=mobile",
            NotificationWatch.streamUrl("http://nas:3000", null),
        )
    }
}
