package dev.kabmo.shell

/**
 * A document the OS handed to Kabmo, and how it crosses to the page.
 *
 * The desktop shells hand over a PATH and the server opens it — they are on the
 * same machine. A phone is not: Kabmo there is a client of a console that may be
 * across the room, so a file picked in the Files app exists only on the DEVICE
 * and the server can never read it. `POST /api/fs/grant` would be granting a
 * path on a machine that has never seen the file.
 *
 * So the bytes travel through the page: the shell reads them from the content
 * resolver, base64-encodes them, and pushes them into the tab. The tab renders
 * and is READ-ONLY — the honest model, and what the editor's own banner says.
 *
 * The rules live here rather than in `MainActivity` for the reason `ApkUpdate`
 * does: every one of them fails SILENTLY on a device (a file with no name opens
 * as `null`, a chunk boundary splits a base64 group and corrupts the document,
 * a share of twenty photos opens twenty tabs), and a JVM test can pin them all
 * without an emulator.
 */
object DeviceFiles {

    /** The action a file manager sends for "open this with…". */
    const val ACTION_VIEW = "android.intent.action.VIEW"

    /** The action a share sheet sends ("Share to Kabmo"). */
    const val ACTION_SEND = "android.intent.action.SEND"

    /**
     * How many base64 characters travel per `evaluateJavascript` call.
     *
     * 64 KiB is ~48 KiB of file per round trip: small enough that no single call
     * is a visible pause in the page, large enough that a 20 MiB document is
     * ~430 calls rather than thousands. Measured shape: `evaluateJavascript`
     * marshals the string across the WebView boundary, so the cost is per call
     * plus per byte — this keeps the per-call share low without making the count
     * absurd.
     */
    const val CHUNK_CHARS = 64 * 1024

    /**
     * The display name for a delivered file.
     *
     * Three sources, because a content URI carries no name of its own: the
     * resolver's `OpenableColumns.DISPLAY_NAME` (the real one), the URI's last
     * path segment (a `file://` or a well-behaved provider), and a fallback.
     *
     * A name with no extension is a real case — a provider that reports only
     * `document` — and the extension is what decides which VIEWER opens, so the
     * fallback appends the MIME type's own extension when it knows one. A name
     * that already carries a dot is left alone: `report.final.pdf` is not
     * `report.final`.
     */
    fun displayName(resolved: String?, uriLastSegment: String?, mimeType: String?, fallback: String = "document"): String {
        val candidate = sequenceOf(resolved, uriLastSegment)
            .filterNotNull()
            .map { it.trim() }
            .firstOrNull { it.isNotEmpty() && it != "/" }
            ?: fallback
        if (candidate.contains('.')) return candidate
        val extension = extensionFor(mimeType)
        return if (extension == null) candidate else "$candidate.$extension"
    }

    /**
     * A file extension for a MIME type, or null when there is no obvious one.
     *
     * Deliberately small and explicit: this exists to give an EXTENSIONLESS name
     * a suffix the editor's classifier can read, not to be a MIME database. A
     * type not listed here keeps the name it was given, which is the honest
     * outcome — guessing `bin` would open the file as text.
     */
    fun extensionFor(mimeType: String?): String? = when (mimeType?.trim()?.lowercase()) {
        "application/pdf" -> "pdf"
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" -> "docx"
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" -> "xlsx"
        "application/vnd.ms-excel.sheet.macroenabled.12" -> "xlsm"
        "text/markdown", "text/x-markdown" -> "md"
        "text/csv" -> "csv"
        "text/tab-separated-values" -> "tsv"
        "image/svg+xml" -> "svg"
        "image/png" -> "png"
        "image/jpeg" -> "jpg"
        "image/gif" -> "gif"
        "image/webp" -> "webp"
        "text/plain" -> "txt"
        "application/json" -> "json"
        else -> null
    }

    /**
     * The id one delivery is keyed by.
     *
     * A counter rather than the URI: sharing the SAME file twice in a row must
     * open two tabs, and the page keys its byte registry by this id. Prefixed so
     * a log line says where the bytes came from.
     */
    fun deliveryId(counter: Int): String = "device-$counter"

    /**
     * The JavaScript that announces files, and the one that streams a chunk.
     *
     * Built with `JSONObject.quote` rather than string interpolation: a filename
     * may contain a quote or a backslash, and the quoting is the only thing
     * standing between a file named `a"b.pdf` and a broken script.
     */
    fun announceScript(metas: List<Meta>): String {
        val entries = metas.joinToString(",") { meta ->
            buildString {
                append("{\"id\":").append(JSONObjectQuote.of(meta.id))
                append(",\"name\":").append(JSONObjectQuote.of(meta.name))
                meta.mimeType?.let { append(",\"mimeType\":").append(JSONObjectQuote.of(it)) }
                append(",\"size\":").append(meta.size)
                append('}')
            }
        }
        return "window.__kabmoOpenFiles && window.__kabmoOpenFiles([$entries])"
    }

    /** One chunk of a delivery. `last` closes it, and only then does the page decode. */
    fun chunkScript(id: String, base64: String, last: Boolean): String =
        "window.__kabmoOpenChunk && window.__kabmoOpenChunk(${JSONObjectQuote.of(id)}, ${JSONObjectQuote.of(base64)}, $last)"

    /** What the shell tells the page about one file, before the bytes. */
    data class Meta(val id: String, val name: String, val mimeType: String?, val size: Long)

    /**
     * `base64` split into chunks that each decode on their own.
     *
     * The split is at a multiple of FOUR, and that is the whole point: base64
     * encodes three bytes into four characters, so a cut in the middle of a
     * group decodes to different bytes. The page concatenates the pieces before
     * decoding, so this is not strictly required today — but a boundary that is
     * only correct because the other side happens to join first is a rule
     * waiting to be broken by the next consumer.
     */
    fun chunks(base64: String, size: Int = CHUNK_CHARS): List<String> {
        if (base64.isEmpty()) return listOf("")
        val width = if (size < 4) 4 else size - (size % 4)
        if (base64.length <= width) return listOf(base64)
        val out = ArrayList<String>((base64.length / width) + 1)
        var index = 0
        while (index < base64.length) {
            val end = minOf(index + width, base64.length)
            out.add(base64.substring(index, end))
            index = end
        }
        return out
    }
}

/**
 * `JSONObject.quote` without the Android dependency.
 *
 * The real one lives in `org.json`, which is a STUB in a JVM unit test
 * (`Method … not mocked`), and the quoting is exactly what the tests must pin.
 * Same escaping rules: the two characters JSON requires, plus every control
 * character below 0x20 as `\u00XX`.
 */
internal object JSONObjectQuote {
    fun of(value: String): String {
        val out = StringBuilder(value.length + 2)
        out.append('"')
        for (character in value) {
            when (character) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else ->
                    if (character < ' ') out.append(String.format("\\u%04x", character.code))
                    else out.append(character)
            }
        }
        out.append('"')
        return out.toString()
    }
}
