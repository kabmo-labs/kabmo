package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pasted pairing link.
 *
 * The refusals are the point: a link to some other page on the same server would
 * load a page that never sets a cookie, and the user would be left on a console
 * that still asks for a password. The deep link is refused on purpose — its
 * origin lives inside the encoded payload, which this deliberately does not
 * decode.
 */
class PairingLinkTest {

    @Test
    fun readsTheOriginOfAnHttpsPairingLink() {
        assertEquals(
            "https://laptop.tailnet.ts.net",
            PairingLink.originOf("https://laptop.tailnet.ts.net/pair#eyJ2IjoxfQ"),
        )
    }

    @Test
    fun keepsANonDefaultPort() {
        assertEquals(
            "http://192.168.18.79:3000",
            PairingLink.originOf("http://192.168.18.79:3000/pair#abc"),
        )
    }

    @Test
    fun toleratesATrailingSlashOnThePath() {
        assertEquals(
            "https://kabmo.example.com",
            PairingLink.originOf("https://kabmo.example.com/pair/#abc"),
        )
    }

    @Test
    fun refusesAPageThatIsNotThePairingPage() {
        assertNull(PairingLink.originOf("https://kabmo.example.com/settings#abc"))
        assertNull(PairingLink.originOf("https://kabmo.example.com/"))
    }

    @Test
    fun refusesTheDeepLinkBecauseItsOriginIsInsideThePayload() {
        assertNull(PairingLink.originOf("kabmo://connect?v=1&p=eyJ2IjoxfQ"))
    }

    @Test
    fun refusesSomethingThatIsNotAUrl() {
        assertNull(PairingLink.originOf(""))
        assertNull(PairingLink.originOf("   "))
        assertNull(PairingLink.originOf("not a link"))
        assertNull(PairingLink.originOf("ftp://host/pair#x"))
    }

    @Test
    fun theHintAgreesWithTheParser() {
        assertTrue(PairingLink.looksLikePairingLink("https://host/pair#x"))
        assertFalse(PairingLink.looksLikePairingLink("https://host/other#x"))
    }
}
