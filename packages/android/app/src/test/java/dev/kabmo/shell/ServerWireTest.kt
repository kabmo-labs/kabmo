package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The `servers_state` wire, pinned literally.
 *
 * This string is the whole contract with the console: a renamed field or a
 * dropped `startable` is a panel that silently offers "Start a local server" on
 * a phone, or one whose rows never mark the active server. JSON is written by
 * hand here because `org.json` cannot run in this suite, so the exact text is
 * the test.
 */
class ServerWireTest {

    @Test
    fun aPhoneSaysItCannotStartServersAndFoundNothingLocal() {
        val wire = ServerWire.state(emptyList(), null)
        assertEquals(
            "{\"entries\":[],\"detected\":[],\"activeId\":null,\"activeUrl\":null,\"startable\":false}",
            wire,
        )
    }

    @Test
    fun oneStoredServerCarriesEverythingARowDraws() {
        val wire = ServerWire.state(
            listOf(
                ServerWire.Entry(
                    label = "Home NAS",
                    url = "http://192.168.1.10:3000",
                    running = true,
                    version = "0.5.3",
                    mode = "prod",
                    pid = 4211,
                    startedAt = "2026-01-01T00:00:00.000Z",
                ),
            ),
            activeUrl = "http://192.168.1.10:3000",
        )
        assertEquals(
            "{\"entries\":[{\"id\":\"http://192.168.1.10:3000\",\"label\":\"Home NAS\"," +
                "\"url\":\"http://192.168.1.10:3000\",\"kind\":\"remote\",\"running\":true," +
                "\"owned\":false,\"source\":\"stored\",\"version\":\"0.5.3\",\"mode\":\"prod\"," +
                "\"pid\":4211,\"startedAt\":\"2026-01-01T00:00:00.000Z\"}]," +
                "\"detected\":[],\"activeId\":\"http://192.168.1.10:3000\"," +
                "\"activeUrl\":\"http://192.168.1.10:3000\",\"startable\":false}",
            wire,
        )
    }

    @Test
    fun anUnreachableServerIsStoppedAndNotInvented() {
        val wire = ServerWire.state(
            listOf(ServerWire.Entry(label = "Office", url = "https://office:3000", running = false)),
            activeUrl = "https://office:3000",
        )
        // No `version`, `mode`, `pid` or `startedAt` keys at all: a row must not
        // read "vnull" because a probe failed.
        assertEquals(
            "{\"entries\":[{\"id\":\"https://office:3000\",\"label\":\"Office\"," +
                "\"url\":\"https://office:3000\",\"kind\":\"remote\",\"running\":false," +
                "\"owned\":false,\"source\":\"stored\"}],\"detected\":[]," +
                "\"activeId\":\"https://office:3000\",\"activeUrl\":\"https://office:3000\"," +
                "\"startable\":false}",
            wire,
        )
    }

    @Test
    fun theActiveFallsBackToTheFirstEntry() {
        val wire = ServerWire.state(
            listOf(ServerWire.Entry(label = "A", url = "http://a:3000", running = true)),
            activeUrl = null,
        )
        assertEquals(true, wire.contains("\"activeUrl\":\"http://a:3000\""))
    }

    @Test
    fun aLabelWithQuotesCannotBreakTheWire() {
        val wire = ServerWire.state(
            listOf(ServerWire.Entry(label = "He said \"hi\"\n", url = "http://a:3000", running = true)),
            activeUrl = "http://a:3000",
        )
        assertEquals(true, wire.contains("\"label\":\"He said \\\"hi\\\"\\n\""))
    }

    @Test
    fun theRefusalScriptQuotesTheShellsOwnSentence() {
        assertEquals(
            "window.__kabmoReply && window.__kabmoReply(7, false, \"Use the server's root address.\");",
            "window.__kabmoReply && window.__kabmoReply(7, false, " +
                ServerWire.quote("Use the server's root address.") + ");",
        )
    }

    @Test
    fun formDecodingKeepsValuesThatContainSeparators() {
        val fields = ServerHost.decode("label=Home%20NAS&url=http%3A%2F%2Fa%3A3000%2F%3Fx%3D1%26y%3D2")
        assertEquals("Home NAS", fields["label"])
        assertEquals("http://a:3000/?x=1&y=2", fields["url"])
    }
}