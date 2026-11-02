package dev.kabmo.shell

/**
 * What the system file picker is opened with, for a page's `<input type="file">`.
 *
 * The WebView reports two facts — the control's `accept` list and whether it
 * takes several files (`FileChooserParams.mode`) — and the shell used to ignore
 * BOTH: every picker opened as "any file" with multi-select, so a field that
 * only accepts images offered a PDF, and a single-file control returned several
 * URIs the page then had to discard.
 *
 * The rules live here, not in `MainActivity`, for the reason `DeviceFiles` does:
 * each is a silent misbehaviour on a device, and a JVM test can pin them without
 * an emulator.
 *
 * A MIME type is what `Intent.EXTRA_MIME_TYPES` takes, so an `accept` token is
 * translated into one:
 * - `image/png` is already a MIME type;
 * - an `image/<star>` wildcard is one the picker understands, kept as-is;
 * - `.png` is an extension, resolved through the same small table the editor's
 *   classifier uses (`DeviceFiles.extensionFor`) in reverse;
 * - anything else is dropped rather than turned into a filter nothing matches.
 */
object FileChooserSpec {

    /** What one picker open needs. */
    data class Spec(
        /** `Intent.type` — the one type the picker dispatches on. */
        val mimeType: String,
        /** `Intent.EXTRA_MIME_TYPES`, when more than one type is allowed. */
        val extraMimeTypes: List<String>,
        /** `Intent.EXTRA_ALLOW_MULTIPLE`. */
        val allowMultiple: Boolean,
    )

    /** Every extension `DeviceFiles.extensionFor` knows, inverted once. */
    private val extensionMimeTypes: Map<String, String> = mapOf(
        "pdf" to "application/pdf",
        "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsm" to "application/vnd.ms-excel.sheet.macroenabled.12",
        "md" to "text/markdown",
        "csv" to "text/csv",
        "tsv" to "text/tab-separated-values",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "gif" to "image/gif",
        "webp" to "image/webp",
        "txt" to "text/plain",
        "json" to "application/json",
    )

    /**
     The MIME types an `accept` list names, de-duplicated and in order.

     An unreadable token is dropped: the picker is then left unfiltered, which
     is what every control did before this existed and is still better than a
     filter that matches nothing.
     */
    fun mimeTypes(acceptTypes: Array<String>?): List<String> {
        if (acceptTypes == null) return emptyList()
        val out = LinkedHashSet<String>()
        for (raw in acceptTypes) {
            val token = raw.trim().lowercase()
            if (token.isEmpty()) continue
            when {
                token.startsWith(".") -> extensionMimeTypes[token.drop(1)]?.let { out.add(it) }
                token.endsWith("/*") -> out.add(token)
                token.contains("/") -> out.add(token)
                else -> extensionMimeTypes[token]?.let { out.add(it) }
            }
        }
        return out.toList()
    }

    /**
     The intent fields for one control.

     `multiple` comes from `FileChooserParams.mode`, whose two values are passed
     as a boolean by the caller so this file stays free of the Android runtime —
     a JVM unit test can then assert both shapes.
     */
    fun forElement(acceptTypes: Array<String>?, multiple: Boolean): Spec {
        val types = mimeTypes(acceptTypes)
        return when (types.size) {
            // No `accept`: any file. The KIT's attach button is this case.
            0 -> Spec(mimeType = "*/*", extraMimeTypes = emptyList(), allowMultiple = multiple)
            // One type: the picker dispatches on it directly.
            1 -> Spec(mimeType = types[0], extraMimeTypes = emptyList(), allowMultiple = multiple)
            // Several: `type` must stay a wildcard, with the real list beside it
            // — an intent with a single concrete type and extras opens the wrong
            // app for the others.
            else -> Spec(mimeType = "*/*", extraMimeTypes = types, allowMultiple = multiple)
        }
    }
}