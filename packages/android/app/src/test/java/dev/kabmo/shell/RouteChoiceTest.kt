package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The route order, pinned.
 *
 * The case that matters is the one a "fastest wins" rule gets wrong: a LAN
 * address answering in 2 ms must still lose to Tailscale at 4 ms, because the
 * LAN origin is not a secure context and dictation, clipboard read and the
 * service worker are all absent there. A test that only compared round trips
 * would pass while the product regressed.
 */
class RouteChoiceTest {

    private fun probed(url: String, rttMs: Long?) =
        RouteChoice.Probed(url, RouteChoice.kindOf(url), rttMs)

    @Test
    fun classifiesTheThreeShapesThatMatter() {
        assertEquals(RouteKind.TAILSCALE, RouteChoice.kindOf("https://laptop.tailnet.ts.net"))
        assertEquals(RouteKind.TAILSCALE, RouteChoice.kindOf("http://100.98.171.79:3000"))
        assertEquals(RouteKind.LAN, RouteChoice.kindOf("http://192.168.18.79:3000"))
        assertEquals(RouteKind.LAN, RouteChoice.kindOf("http://10.0.0.5:3000"))
        assertEquals(RouteKind.LAN, RouteChoice.kindOf("http://172.16.4.2:3000"))
        assertEquals(RouteKind.LAN, RouteChoice.kindOf("http://localhost:3000"))
        assertEquals(RouteKind.CLOUDFLARE, RouteChoice.kindOf("https://kabmo.example.com"))
    }

    @Test
    fun aPublicAddressIsNotMistakenForAPrivateOne() {
        // 172.32 is outside 172.16/12, and 100.128 is outside 100.64/10.
        assertEquals(RouteKind.CLOUDFLARE, RouteChoice.kindOf("http://172.32.0.1:3000"))
        assertEquals(RouteKind.CLOUDFLARE, RouteChoice.kindOf("http://100.128.0.1:3000"))
    }

    @Test
    fun prefersTailscaleOverAFasterLanAddress() {
        val winner = RouteChoice.pick(
            listOf(probed("http://192.168.18.79:3000", 2), probed("https://laptop.tailnet.ts.net", 4)),
        )
        assertEquals("https://laptop.tailnet.ts.net", winner?.url)
    }

    @Test
    fun fallsBackToLanWhenTailscaleDidNotAnswer() {
        val winner = RouteChoice.pick(
            listOf(probed("http://192.168.18.79:3000", 2), probed("https://laptop.tailnet.ts.net", null)),
        )
        assertEquals("http://192.168.18.79:3000", winner?.url)
    }

    @Test
    fun answersNullWhenNothingAnswered() {
        assertNull(RouteChoice.pick(listOf(probed("http://192.168.18.79:3000", null))))
    }

    @Test
    fun switchesToABetterTierEvenWhenItIsSlower() {
        assertTrue(
            RouteChoice.shouldSwitch(
                probed("http://192.168.18.79:3000", 2),
                probed("https://laptop.tailnet.ts.net", 30),
            ),
        )
    }

    @Test
    fun neverSwitchesDownATier() {
        assertFalse(
            RouteChoice.shouldSwitch(
                probed("https://laptop.tailnet.ts.net", 30),
                probed("http://192.168.18.79:3000", 1),
            ),
        )
    }

    @Test
    fun ignoresASameTierWinTooSmallToFeel() {
        // 40 -> 30 ms is a 25% gain but only 10 ms: a page load costs more.
        assertFalse(
            RouteChoice.shouldSwitch(
                probed("https://a.tailnet.ts.net", 40),
                probed("https://b.tailnet.ts.net", 30),
            ),
        )
    }

    @Test
    fun takesASameTierWinThatIsBothLargeAndProportional() {
        assertTrue(
            RouteChoice.shouldSwitch(
                probed("https://a.tailnet.ts.net", 200),
                probed("https://b.tailnet.ts.net", 60),
            ),
        )
    }

    @Test
    fun switchesWhenTheActiveRouteStoppedAnswering() {
        assertTrue(
            RouteChoice.shouldSwitch(
                probed("https://laptop.tailnet.ts.net", null),
                probed("http://192.168.18.79:3000", 5),
            ),
        )
    }
}
