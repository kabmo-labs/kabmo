package dev.kabmo.shell

/**
 * The server list the Android shell remembers, and every rule about it.
 *
 * ## Why a list at all
 *
 * The shell stored exactly ONE address (`ServerConfig.KEY_URL`), which was the
 * whole app: a phone that talks to a laptop at home and a desktop at the office
 * had to retype an address every time it moved. The console's header now offers
 * the ones it knows (the same control the desktop shells draw), and this is the
 * data behind it.
 *
 * ## Why the wire is line-based and not JSON
 *
 * `org.json` is a STUB in the JVM unit test (`Method ... not mocked`), so a JSON
 * wire would leave the parser that most needs a test as the only one that cannot
 * have one — the same reason `ShellPalette` uses a pipe-separated line. One
 * server per line, `label<TAB>url<TAB>active`, with `\`, tab and newline
 * escaped in the label; URLs cannot contain any of the three, because
 * `UrlNormalizer` refuses anything but an origin. The trailing flag is what
 * survives a process restart: without it the window reopened on the FIRST
 * stored server instead of the one the user was on.
 *
 * Nothing here touches the Android framework, which is what makes the whole
 * class testable without a device.
 */
data class StoredServer(val label: String, val url: String)

/** A list of known servers, plus which one this shell is showing. */
data class ServerList(
    val entries: List<StoredServer> = emptyList(),
    val activeUrl: String? = null,
) {

    /** The entry the window is on, or null when the list is empty. */
    fun active(): StoredServer? =
        entries.firstOrNull { it.url == activeUrl } ?: entries.firstOrNull()

    /** The label to draw for `url` — the stored one, else the address itself. */
    fun labelFor(url: String): String = entries.firstOrNull { it.url == url }?.label ?: labelOf(url)

    /**
     * Remember `url` and make it the active one.
     *
     * Adding an address that is already in the list is not an error: the user is
     * telling the shell which server to open, and a second row for the same
     * origin would be two rows that can never disagree about anything.
     */
    fun withRemembered(url: String, label: String? = null): ServerList {
        val clean = label?.trim()?.takeIf { it.isNotEmpty() }
        val existing = entries.firstOrNull { it.url == url }
        val next = when {
            existing != null -> entries.map {
                if (it.url == url) it.copy(label = clean ?: it.label) else it
            }
            else -> entries + StoredServer(clean ?: labelOf(url), url)
        }
        return copy(entries = next, activeUrl = url)
    }

    /** Drop `url`. Removing the active row leaves the list on its first entry. */
    fun without(url: String): ServerList {
        val next = entries.filterNot { it.url == url }
        return copy(entries = next, activeUrl = if (activeUrl == url) next.firstOrNull()?.url else activeUrl)
    }

    /** Point the window at `url`, keeping the list order unchanged. */
    fun withActive(url: String): ServerList =
        if (entries.any { it.url == url }) copy(activeUrl = url) else this

    /** The stored form. */
    fun wire(): String = entries.joinToString("\n") { entry ->
        val active = if (entry.url == activeUrl) "\t1" else ""
        "${escapeField(entry.label)}\t${entry.url}$active"
    }

    companion object {
        /** A list holding the address an older build saved, or an empty list. */
        fun migrated(legacyUrl: String?): ServerList {
            val url = legacyUrl?.trim()?.takeIf { it.isNotEmpty() } ?: return ServerList()
            return ServerList(listOf(StoredServer(labelOf(url), url)), activeUrl = url)
        }

        /**
         * Read the stored form.
         *
         * A line without a tab is a URL someone stored by hand (or an older wire);
         * it is kept rather than dropped, because losing an address is the one
         * failure this class must not have.
         */
        fun parse(wire: String?): ServerList {
            if (wire.isNullOrEmpty()) return ServerList()
            var active: String? = null
            val entries = wire.split("\n").mapNotNull { line ->
                if (line.isBlank()) return@mapNotNull null
                val fields = line.split("\t")
                val entry = if (fields.size < 2) {
                    StoredServer(labelOf(line), line)
                } else {
                    StoredServer(unescapeField(fields[0]), fields[1])
                }
                if (active === null && fields.getOrNull(2) == "1") active = entry.url
                entry
            }
            return ServerList(entries, active ?: entries.firstOrNull()?.url)
        }

        /** `http://192.168.1.10:3000` → `192.168.1.10:3000`. */
        fun labelOf(url: String): String =
            url.removePrefix("https://").removePrefix("http://").trimEnd('/')

        private fun escapeField(value: String): String = buildString {
            for (char in value) {
                when (char) {
                    '\\' -> append("\\\\")
                    '\t' -> append("\\t")
                    '\n' -> append("\\n")
                    else -> append(char)
                }
            }
        }

        private fun unescapeField(value: String): String = buildString {
            var index = 0
            while (index < value.length) {
                val char = value[index]
                if (char != '\\' || index == value.length - 1) {
                    append(char)
                    index += 1
                    continue
                }
                when (val next = value[index + 1]) {
                    't' -> append('\t')
                    'n' -> append('\n')
                    '\\' -> append('\\')
                    else -> append(next)
                }
                index += 2
            }
        }
    }
}
