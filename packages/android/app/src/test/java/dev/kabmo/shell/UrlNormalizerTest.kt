package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `UrlNormalizer` is the one piece of the shell with real logic, and it is the
 * one that decides whether the app can work at all — a URL it accepts wrongly
 * produces a blank WebView with no error anywhere.
 */
class UrlNormalizerTest {

    private fun ok(raw: String): String {
        val result = UrlNormalizer.normalize(raw)
        assertTrue("expected $raw to normalize, got $result", result is NormalizedUrl.Ok)
        return (result as NormalizedUrl.Ok).url
    }

    private fun error(raw: String): String {
        val result = UrlNormalizer.normalize(raw)
        assertTrue("expected $raw to be refused, got $result", result is NormalizedUrl.Error)
        return (result as NormalizedUrl.Error).message
    }

    @Test
    fun keepsSchemeHostAndPort() {
        assertEquals("http://192.168.1.20:3000", ok("http://192.168.1.20:3000"))
        assertEquals("https://kabmo.example.com:8443", ok("https://kabmo.example.com:8443"))
    }

    @Test
    fun assumesHttpForABareAuthority() {
        // The common LAN case: nobody types a scheme on a phone keyboard.
        assertEquals("http://192.168.1.20:3000", ok("192.168.1.20:3000"))
        assertEquals("http://localhost:3000", ok("localhost:3000"))
    }

    @Test
    fun trimsWhitespaceAndARootSlash() {
        assertEquals("http://localhost:3000", ok("  http://localhost:3000/  "))
    }

    @Test
    fun keepsAnIpv6LiteralBracketed() {
        assertEquals("http://[::1]:3000", ok("http://[::1]:3000"))
    }

    @Test
    fun refusesABasePath() {
        // Every client call is root-relative, so a base path silently 404s.
        assertEquals("path", error("http://host:3000/kabmo"))
        assertEquals("path", error("http://host:3000/kabmo/"))
    }

    @Test
    fun refusesNonHttpSchemes() {
        assertEquals("scheme", error("ftp://host:21"))
        assertEquals("scheme", error("file:///etc/passwd"))
        assertEquals("scheme", error("javascript://host"))
    }

    @Test
    fun refusesEmptyAndMalformed() {
        assertEquals("empty", error("   "))
        assertEquals("shape", error("http://"))
        assertEquals("shape", error("http://user:pass@host:3000"))
        assertEquals("shape", error("http://host:3000?x=1"))
        assertEquals("shape", error("http://host:3000#frag"))
    }

    @Test
    fun refusesAnOutOfRangePort() {
        assertEquals("shape", error("http://host:70000"))
    }
}
