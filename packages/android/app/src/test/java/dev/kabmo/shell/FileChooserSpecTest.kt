package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The picker's filter, pinned.
 *
 * Every case here failed silently on a device: the shell opened an any-file
 * picker with multiple selection for EVERY control, so an image-only icon field
 * offered a PDF (which the page then refused after the choice) and a single-file
 * control came back with several URIs.
 */
class FileChooserSpecTest {

    @Test
    fun `no accept offers any file`() {
        val spec = FileChooserSpec.forElement(null, multiple = false)
        assertEquals("*/*", spec.mimeType)
        assertTrue(spec.extraMimeTypes.isEmpty())
        assertFalse(spec.allowMultiple)
    }

    @Test
    fun `an empty accept list is the same as none`() {
        val spec = FileChooserSpec.forElement(emptyArray(), multiple = true)
        assertEquals("*/*", spec.mimeType)
        assertTrue(spec.allowMultiple)
    }

    @Test
    fun `one MIME type dispatches the picker on it`() {
        val spec = FileChooserSpec.forElement(arrayOf("image/png"), multiple = false)
        assertEquals("image/png", spec.mimeType)
        assertTrue(spec.extraMimeTypes.isEmpty())
    }

    @Test
    fun `several MIME types keep a wildcard type and carry the list`() {
        val spec = FileChooserSpec.forElement(
            arrayOf("image/png", "image/jpeg", "image/svg+xml"),
            multiple = false,
        )
        assertEquals("*/*", spec.mimeType)
        assertEquals(listOf("image/png", "image/jpeg", "image/svg+xml"), spec.extraMimeTypes)
    }

    @Test
    fun `a wildcard is passed through as the picker understands it`() {
        val spec = FileChooserSpec.forElement(arrayOf("image/*"), multiple = false)
        assertEquals("image/*", spec.mimeType)
    }

    @Test
    fun `extensions resolve to MIME types`() {
        val spec = FileChooserSpec.forElement(arrayOf(".png", ".svg"), multiple = false)
        assertEquals("*/*", spec.mimeType)
        assertEquals(listOf("image/png", "image/svg+xml"), spec.extraMimeTypes)
    }

    @Test
    fun `duplicates collapse and order is kept`() {
        val spec = FileChooserSpec.forElement(
            arrayOf("image/png", " image/png ", "IMAGE/JPEG"),
            multiple = false,
        )
        assertEquals(listOf("image/png", "image/jpeg"), spec.extraMimeTypes)
    }

    @Test
    fun `an unknown token is dropped rather than filtering everything out`() {
        val spec = FileChooserSpec.forElement(arrayOf("not-a-type", "image/png"), multiple = false)
        assertEquals("image/png", spec.mimeType)
        assertTrue(spec.extraMimeTypes.isEmpty())
    }

    @Test
    fun `multiple selection follows the element`() {
        assertTrue(FileChooserSpec.forElement(null, multiple = true).allowMultiple)
        assertFalse(FileChooserSpec.forElement(arrayOf("image/png"), multiple = false).allowMultiple)
    }
}