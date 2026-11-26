package dev.kabmo.shell

/**
 * The notification stream's wire, as a PURE function of the text.
 *
 * The server records a notification event when a run settles or an agent parks
 * a question, and `GET /api/notifications/stream` hands it to this shell as
 * Server-Sent Events. That is what makes a banner arrive while the console is
 * closed: the page cannot decide anything while Android has its renderer
 * frozen, and the backlog it used to announce on resume is exactly the "all the
 * notifications at once" report.
 *
 * ## Why a private JSON reader
 *
 * The server writes each event's payload as JSON, and `org.json` is a stub in
 * the JVM unit test suite — so the one parser that most needs a test would be
 * the only one that could not have one. A flat object of scalars is the whole
 * shape here (see `NotificationEvent` in `shared/lib/notifications/events`), so
 * `object()` reads exactly that and nothing else: no nesting, no escapes
 * beyond the string rules it must honour, and a malformed payload returns null
 * instead of a half-filled event.
 *
 * ## The cursor
 *
 * `id` is monotonic. The service persists the last id it posted and reconnects
 * with `after=<id>`, so a dropped connection resumes instead of replaying. A
 * first run sends no cursor and is answered with a `cursor` frame — the newest
 * id — rather than the backlog, which is what keeps a fresh install from
 * announcing history.
 */
data class WatchEvent(
    val id: Long,
    val kind: String,
    val sessionId: String,
    val title: String,
    val body: String,
    /** When the event happened, epoch ms — the shade's own timestamp. */
    val at: Long,
    /** How long the run took, when the server knew its start. */
    val durationMs: Long?,
)

object NotificationWatch {

    /** The SSE event name the server uses for one notification. */
    const val EVENT_NOTIFICATION = "notification"

    /** The SSE event name that primes a consumer with no cursor. */
    const val EVENT_CURSOR = "cursor"

    /** The SSE event name that says this platform's delivery master is off. */
    const val EVENT_DISABLED = "disabled"

    /** One `data:` payload of a `notification` frame, or null when malformed. */
    fun parse(data: String): WatchEvent? {
        val fields = parseObject(data) ?: return null
        val id = fields["id"]?.toLongOrNull() ?: return null
        val sessionId = fields["sessionId"].orEmpty()
        if (sessionId.isEmpty()) return null
        return WatchEvent(
            id = id,
            kind = fields["kind"].orEmpty(),
            sessionId = sessionId,
            title = fields["title"].orEmpty(),
            body = fields["body"].orEmpty(),
            // A payload without `at` is still postable: the shade then names the
            // moment it was shown, which is the platform default.
            at = fields["at"]?.toLongOrNull() ?: 0L,
            durationMs = fields["durationMs"]?.toLongOrNull()?.takeIf { it > 0 },
        )
    }

    /** The id a `cursor` frame carries, or null when it carries none. */
    fun parseCursor(data: String): Long? = parseObject(data)?.get("id")?.toLongOrNull()

    /** `3m 12s`, `48s`, `1h 04m` — a banner's duration, never a raw millisecond count. */
    fun durationLabel(durationMs: Long): String? {
        if (durationMs <= 0) return null
        val totalSeconds = durationMs / 1000
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        val seconds = totalSeconds % 60
        return when {
            hours > 0 -> "${hours}h ${minutes.toString().padStart(2, '0')}m"
            minutes > 0 -> "${minutes}m ${seconds.toString().padStart(2, '0')}s"
            else -> "${seconds}s"
        }
    }

    /**
     * The stream URL for one attempt.
     *
     * `after` is omitted on a first run on purpose: the server answers that with
     * the current cursor, not the outbox.
     */
    fun streamUrl(baseUrl: String, after: Long?): String {
        val cursor = after?.let { "&after=$it" }.orEmpty()
        return "$baseUrl/api/notifications/stream?platform=mobile$cursor"
    }

    /**
     * A flat JSON object of scalar values, or null.
     *
     * Deliberately strict: a value must be a quoted string, a number, `true`,
     * `false` or `null`. Anything else — a nested object, a truncated payload,
     * trailing junk — answers null, because a partially read event would post a
     * banner naming the wrong session.
     */
    fun parseObject(json: String): Map<String, String>? {
        val text = json.trim()
        if (text.length < 2 || text.first() != '{' || text.last() != '}') return null
        val fields = LinkedHashMap<String, String>()
        var index = 1
        while (index < text.length - 1) {
            index = skipWhitespace(text, index)
            if (index >= text.length - 1) break
            if (text[index] == ',') {
                index += 1
                continue
            }
            val key = string(text, index) ?: return null
            index = skipWhitespace(text, key.next)
            if (index >= text.length || text[index] != ':') return null
            index = skipWhitespace(text, index + 1)
            if (index < text.length && text[index] == '"') {
                val value = string(text, index) ?: return null
                fields[key.value] = value.value
                index = value.next
                continue
            }
            // A nested object or array is not a scalar this reader understands,
            // and reading one as text would answer a half-parsed event.
            if (index < text.length && (text[index] == '{' || text[index] == '[')) return null
            // A scalar without quotes: a number, a boolean or null.
            var end = index
            while (end < text.length - 1 && text[end] != ',' && !text[end].isWhitespace()) end += 1
            val raw = text.substring(index, end)
            fields[key.value] = if (raw == "null") "" else raw
            index = end
        }
        return fields
    }

    private class Parsed(val value: String, val next: Int)

    private fun skipWhitespace(text: String, from: Int): Int {
        var index = from
        while (index < text.length && text[index].isWhitespace()) index += 1
        return index
    }

    /** Read one quoted string starting at `from`, decoding the JSON escapes. */
    private fun string(text: String, from: Int): Parsed? {
        if (from >= text.length || text[from] != '"') return null
        val builder = StringBuilder()
        var index = from + 1
        while (index < text.length) {
            when (val char = text[index]) {
                '"' -> return Parsed(builder.toString(), index + 1)
                '\\' -> {
                    index += 1
                    if (index >= text.length) return null
                    when (val escape = text[index]) {
                        'n' -> builder.append('\n')
                        't' -> builder.append('\t')
                        'r' -> builder.append('\r')
                        'b' -> builder.append('\b')
                        'f' -> builder.append('\u000C')
                        'u' -> {
                            if (index + 4 >= text.length) return null
                            val hex = text.substring(index + 1, index + 5).toIntOrNull(16) ?: return null
                            builder.append(hex.toChar())
                            index += 4
                        }
                        else -> builder.append(escape)
                    }
                    index += 1
                }
                else -> {
                    builder.append(char)
                    index += 1
                }
            }
        }
        return null
    }
}

/**
 * Whether the shell should watch while the console is away.
 *
 * The event switches live in the server's settings (the console's Notifications
 * page), so the page reports the answer here — on boot and whenever a switch
 * changes. It is a cached fact, not a second preference: the next boot rewrites
 * it. Persisted because `MainActivity.onStop` needs it without a page to ask.
 */
interface ShellWatch {
    fun setArmed(armed: Boolean)
    fun isArmed(): Boolean
}

/**
 * The two answers the page's `notification_watch` command can get, as a PURE
 * function of the watch state — testable on a plain JVM, like
 * `NotificationCommands`.
 */
object NotificationWatchCommands {

    fun answer(method: String, fields: Map<String, String>, watch: ShellWatch): String? {
        if (method != "notification_watch") return null
        watch.setArmed(fields["enabled"] == "true")
        return if (watch.isArmed()) "{\"armed\":true}" else "{\"armed\":false}"
    }
}
