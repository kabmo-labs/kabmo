package dev.kabmo.shell

import java.net.URI

/**
 * The origin a pasted pairing link points at.
 *
 * The shell does NOT parse the pairing payload. It loads the link in its own
 * WebView and lets the server's `/pair` page redeem it — that page already
 * decodes the payload, posts the claim, and the cookie it receives lands in THIS
 * app's cookie jar, which is the whole point. A second parser here would be a
 * second place for the payload format to drift.
 *
 * So the only thing this needs to answer is "which server is this link for",
 * because that is what the shell stores and what it must load.
 *
 * Two forms are accepted:
 *
 * - `https://host[:port]/pair#<payload>` — what the QR encodes and what the
 *   console's "Copy link" copies. The origin is everything before `/pair`.
 * - `kabmo://connect?v=1&p=<payload>` — the deep link. Its origin is inside the
 *   encoded payload, which this deliberately does not decode, so it is refused
 *   with a sentence telling the user to use the https link instead.
 */
object PairingLink {

    /** The origin of a pasted pairing link, or null when it is not one. */
    fun originOf(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val uri = try {
            URI(trimmed)
        } catch (_: Exception) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host ?: return null
        if (host.isEmpty()) return null
        // The path must be the pairing page. A link to some other page on the
        // same server is not a pairing link, and loading it would leave the user
        // on a page that never sets a cookie.
        val path = uri.path ?: return null
        if (path.trimEnd('/') != "/pair") return null
        val port = uri.port
        return if (port > 0) "$scheme://$host:$port" else "$scheme://$host"
    }

    /** Whether `raw` looks like a pairing link at all, for the field's own hint. */
    fun looksLikePairingLink(raw: String): Boolean = originOf(raw) != null
}
