package dev.kabmo.shell

/**
 * The `servers_state` answer, as the page reads it.
 *
 * ## Why the JSON is written by hand
 *
 * `org.json` is a stub in the JVM unit test suite (`Method ... not mocked`), and
 * this string is the whole contract between the shell and the console — the one
 * thing that must not drift. A builder that a plain `assertEquals` can pin is
 * worth more than a library that cannot run in the suite: the field names and
 * their order are asserted literally in `ServerWireTest`.
 *
 * JSON is the wire here even though the STORE is line-based (`ServerList`),
 * because the page parses it with a real parser and the shape is nested: two
 * arrays of objects, not a table of rows.
 *
 * ## What a phone answers, and what it does not
 *
 * `detected` is always empty: those are servers found from per-port records on
 * THIS machine, and a phone has no such records. `startable` is `false`: the
 * shell cannot spawn a server, so the console must not offer to start one.
 * Both are facts the page uses to hide controls, never guesses it makes from a
 * user agent.
 */
object ServerWire {

    /** A probed entry, ready to draw. */
    data class Entry(
        val label: String,
        val url: String,
        val running: Boolean,
        val version: String? = null,
        val mode: String? = null,
        val pid: Int? = null,
        val startedAt: String? = null,
    )

    /**
     * The whole state.
     *
     * `activeId` is the active URL as well: a phone's rows are identified by
     * their origin, and inventing a second id would be a second thing that can
     * disagree with the stored address.
     */
    fun state(entries: List<Entry>, activeUrl: String?): String {
        val active = activeUrl ?: entries.firstOrNull()?.url
        return buildString {
            append("{\"entries\":[")
            entries.forEachIndexed { index, entry ->
                if (index > 0) append(',')
                append(server(entry))
            }
            append("],\"detected\":[],\"activeId\":")
            append(quote(active))
            append(",\"activeUrl\":")
            append(quote(active))
            append(",\"startable\":false}")
        }
    }

    private fun server(entry: Entry): String = buildString {
        append("{\"id\":")
        append(quote(entry.url))
        append(",\"label\":")
        append(quote(entry.label))
        append(",\"url\":")
        append(quote(entry.url))
        // `remote` is the only kind a phone can have: nothing here is spawned by
        // this shell, so nothing is `owned` and nothing may be stopped.
        append(",\"kind\":\"remote\",\"running\":")
        append(entry.running)
        append(",\"owned\":false,\"source\":\"stored\"")
        entry.version?.let { append(",\"version\":").append(quote(it)) }
        entry.mode?.let { append(",\"mode\":").append(quote(it)) }
        entry.pid?.let { append(",\"pid\":").append(it) }
        entry.startedAt?.let { append(",\"startedAt\":").append(quote(it)) }
        append('}')
    }

    /** A JSON string literal, or `null`. Shared with `ServerHost`'s refusals. */
    fun quote(value: String?): String {
        if (value == null) return "null"
        return buildString {
            append('"')
            for (char in value) {
                when (char) {
                    '"' -> append("\\\"")
                    '\\' -> append("\\\\")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> if (char < ' ') append("\\u%04x".format(char.code)) else append(char)
                }
            }
            append('"')
        }
    }
}