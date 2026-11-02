package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The server list's rules, pinned without a device.
 *
 * The failures that matter here are all silent: an address lost on upgrade, a
 * duplicate row that can never disagree with itself, an active row that
 * disappears with the row the user just removed. None of them throws, and all of
 * them make the console open the wrong window.
 */
class ServerListTest {

    @Test
    fun migratesTheSingleAddressAnOlderBuildSaved() {
        val list = ServerList.migrated("http://192.168.1.10:3000")
        assertEquals(1, list.entries.size)
        assertEquals("http://192.168.1.10:3000", list.activeUrl)
        // The label is derived, because there was never one to store.
        assertEquals("192.168.1.10:3000", list.entries[0].label)
    }

    @Test
    fun aFirstRunHasNothing() {
        assertTrueEmpty(ServerList.migrated(null))
        assertTrueEmpty(ServerList.parse(null))
        assertTrueEmpty(ServerList.parse(""))
    }

    private fun assertTrueEmpty(list: ServerList) {
        assertEquals(0, list.entries.size)
        assertNull(list.activeUrl)
        assertNull(list.active())
    }

    @Test
    fun remembersASecondServerAndMakesItActive() {
        val list = ServerList.migrated("http://192.168.1.10:3000")
            .withRemembered("https://office.example:8443", "Office")
        assertEquals(listOf("192.168.1.10:3000", "Office"), list.entries.map { it.label })
        assertEquals("https://office.example:8443", list.activeUrl)
    }

    @Test
    fun rememberingTheSameOriginTwiceKeepsOneRow() {
        val list = ServerList()
            .withRemembered("http://a:3000")
            .withRemembered("http://a:3000", "Living room")
        assertEquals(1, list.entries.size)
        assertEquals("Living room", list.entries[0].label)
    }

    @Test
    fun removingTheActiveRowFallsBackToTheFirstLeft() {
        val list = ServerList()
            .withRemembered("http://a:3000")
            .withRemembered("http://b:3000")
            .without("http://b:3000")
        assertEquals(listOf("http://a:3000"), list.entries.map { it.url })
        assertEquals("http://a:3000", list.activeUrl)
    }

    @Test
    fun activatingAnUnknownAddressChangesNothing() {
        val list = ServerList().withRemembered("http://a:3000")
        assertEquals(list, list.withActive("http://elsewhere:3000"))
    }

    @Test
    fun theWireRoundTripsLabelsWithTabsAndNewlines() {
        val list = ServerList(
            listOf(
                StoredServer("Home\tNAS", "http://a:3000"),
                StoredServer("line\nbreak", "http://b:3000"),
                StoredServer("back\\slash", "http://c:3000"),
            ),
            "http://b:3000",
        )
        val parsed = ServerList.parse(list.wire())
        assertEquals(list.entries, parsed.entries)
        // Which server the window is on survives a restart.
        assertEquals("http://b:3000", parsed.activeUrl)
    }

    @Test
    fun aHandWrittenLineWithoutALabelIsKept() {
        val parsed = ServerList.parse("http://only-a-url:3000")
        assertEquals(listOf(StoredServer("only-a-url:3000", "http://only-a-url:3000")), parsed.entries)
    }
}