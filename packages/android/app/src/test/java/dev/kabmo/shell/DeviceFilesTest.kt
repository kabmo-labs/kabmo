package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules for a document the OS handed to Kabmo on a phone.
 *
 * Every case is a silent failure on a device: a file with no extension opens in
 * the code editor instead of its viewer, a name with a quote breaks the script
 * that hands it over, and a chunk cut inside a base64 group corrupts the
 * document with no error anywhere.
 */
class DeviceFilesTest {

    // -- displayName ---------------------------------------------------------

    @Test
    fun prefersTheResolversOwnName() {
        assertEquals(
            "Q3 report.pdf",
            DeviceFiles.displayName("Q3 report.pdf", "1234", "application/pdf"),
        )
    }

    @Test
    fun fallsBackToTheUriSegmentWhenTheResolverHasNoName() {
        assertEquals("notes.md", DeviceFiles.displayName(null, "notes.md", "text/markdown"))
    }

    @Test
    fun namesAnExtensionlessFileFromItsMimeType() {
        // A provider that reports only "document" — without an extension the
        // classifier sees a text file and the PDF opens in the code surface.
        assertEquals("document.pdf", DeviceFiles.displayName("document", null, "application/pdf"))
    }

    @Test
    fun leavesADottedNameAlone() {
        // `report.final.pdf` must not become `report.final.txt`.
        assertEquals("report.final", DeviceFiles.displayName("report.final", null, "text/plain"))
    }

    @Test
    fun keepsANameWhoseTypeItCannotGuess() {
        // Guessing `bin` would open the file as text, which is worse than the
        // name it was given.
        assertEquals("document", DeviceFiles.displayName("document", null, "application/x-weird"))
    }

    @Test
    fun skipsAnEmptyOrRootSegment() {
        // Both candidates are useless, so the FALLBACK is named — and it takes
        // the MIME type's extension, because an extensionless name is what makes
        // a PNG open in the code editor.
        assertEquals("document.png", DeviceFiles.displayName("", "/", "image/png"))
    }

    // -- extensionFor --------------------------------------------------------

    @Test
    fun knowsTheTypesTheEditorCanDraw() {
        assertEquals("pdf", DeviceFiles.extensionFor("application/pdf"))
        assertEquals("docx", DeviceFiles.extensionFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
        assertEquals("xlsx", DeviceFiles.extensionFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        assertEquals("md", DeviceFiles.extensionFor("text/markdown"))
        assertEquals("svg", DeviceFiles.extensionFor("image/svg+xml"))
        assertEquals("json", DeviceFiles.extensionFor("application/json"))
    }

    @Test
    fun isCaseAndWhitespaceInsensitive() {
        assertEquals("pdf", DeviceFiles.extensionFor("  APPLICATION/PDF "))
    }

    @Test
    fun refusesToGuessAnUnknownType() {
        assertNull(DeviceFiles.extensionFor("application/octet-stream"))
        assertNull(DeviceFiles.extensionFor(null))
    }

    // -- chunks --------------------------------------------------------------

    @Test
    fun splitsBase64OnAGroupBoundary() {
        // 12 characters is three whole groups; a chunk size of 5 must not cut
        // inside one.
        val pieces = DeviceFiles.chunks("abcdefghijkl", size = 5)
        assertTrue(pieces.all { it.length % 4 == 0 })
        assertEquals("abcdefghijkl", pieces.joinToString(""))
    }

    @Test
    fun keepsEverythingWhenTheFileIsOneChunk() {
        assertEquals(listOf("abcd"), DeviceFiles.chunks("abcd", size = 64))
    }

    @Test
    fun anEmptyFileIsOneEmptyChunkSoThePageStillCloses() {
        // The page only decodes on `last`, so a file with no bytes still has to
        // send one frame — otherwise an empty document never opens.
        assertEquals(listOf(""), DeviceFiles.chunks(""))
    }

    @Test
    fun aTinyChunkSizeIsRaisedToWholeGroups() {
        val pieces = DeviceFiles.chunks("abcdefgh", size = 1)
        assertTrue(pieces.all { it.length % 4 == 0 })
        assertEquals("abcdefgh", pieces.joinToString(""))
    }

    @Test
    fun theDefaultChunkIsAWholeNumberOfGroups() {
        assertEquals(0, DeviceFiles.CHUNK_CHARS % 4)
    }

    // -- scripts -------------------------------------------------------------

    @Test
    fun theAnnouncementIsAGuardedCall() {
        val script = DeviceFiles.announceScript(
            listOf(DeviceFiles.Meta("device-1", "a.pdf", "application/pdf", 10)),
        )
        // Guarded, because the page may not have booted yet; the shell sends
        // once and does not wait for a reply.
        assertTrue(script.startsWith("window.__kabmoOpenFiles && window.__kabmoOpenFiles(["))
        assertTrue(script.contains("\"id\":\"device-1\""))
        assertTrue(script.contains("\"size\":10"))
    }

    @Test
    fun aQuoteInTheNameIsEscapedRatherThanEndingTheString() {
        val script = DeviceFiles.announceScript(
            listOf(DeviceFiles.Meta("device-2", "a\"b\\c.pdf", null, 1)),
        )
        assertTrue(script.contains("a\\\"b\\\\c.pdf"))
        assertFalse(script.contains("a\"b\\c.pdf"))
    }

    @Test
    fun aMissingMimeTypeIsOmittedRatherThanSentAsNull() {
        val script = DeviceFiles.announceScript(listOf(DeviceFiles.Meta("device-3", "a.txt", null, 3)))
        assertFalse(script.contains("mimeType"))
    }

    @Test
    fun theChunkCallCarriesTheLastFlag() {
        assertTrue(DeviceFiles.chunkScript("device-4", "AAAA", true).endsWith(", true)"))
        assertTrue(DeviceFiles.chunkScript("device-4", "AAAA", false).endsWith(", false)"))
        // The base64 is quoted: a `+` or `/` is safe, but the guard keeps the
        // call valid for any payload a provider produces.
        assertTrue(DeviceFiles.chunkScript("device-4", "AA+/", true).contains("\"AA+/\""))
    }

    @Test
    fun theActionsAreTheOnesAManagerSends() {
        assertEquals("android.intent.action.VIEW", DeviceFiles.ACTION_VIEW)
        assertEquals("android.intent.action.SEND", DeviceFiles.ACTION_SEND)
    }
}
