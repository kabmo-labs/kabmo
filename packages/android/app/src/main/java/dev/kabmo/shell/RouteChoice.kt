package dev.kabmo.shell

import java.net.URI

/**
 * Which route a stored address is, and which one to use.
 *
 * The order is a TIER, not a speed ranking, and the reason is measured: on a LAN,
 * `http://192.168.x.x` is not a secure context, so `getUserMedia` (dictation),
 * `navigator.clipboard.readText` and `serviceWorker` are all absent and the
 * password crosses the Wi-Fi in cleartext. Tailscale on the SAME network is a
 * direct WireGuard peer connection, so it costs a fraction of a millisecond over
 * the LAN address and restores all of them. Cloudflare is last because its edge
 * terminates TLS and can read every request.
 *
 * This is the Kotlin port of `src/shared/lib/connect/tier.ts`; the numbers and
 * the ordering must stay identical, and both are pinned by tests.
 */
enum class RouteKind { TAILSCALE, LAN, CLOUDFLARE }

object RouteChoice {

    /** Lower is better. Mirrors `ROUTE_TIER` in the shared TypeScript module. */
    fun tier(kind: RouteKind): Int = when (kind) {
        RouteKind.TAILSCALE -> 0
        RouteKind.LAN -> 1
        RouteKind.CLOUDFLARE -> 2
    }

    /**
     * The route an address belongs to, from its host alone.
     *
     * A heuristic, and the only one available: the shell stores addresses, not
     * the pairing payload that produced them. It is exact for the three shapes
     * that matter — a MagicDNS name, a CGNAT address, a private address — and
     * anything else is treated as public, which is the conservative answer
     * because it ranks last.
     */
    fun kindOf(url: String): RouteKind {
        val host = hostOf(url) ?: return RouteKind.CLOUDFLARE
        if (host.endsWith(".ts.net")) return RouteKind.TAILSCALE
        val octets = ipv4(host)
        if (octets != null) {
            // 100.64.0.0/10 — Tailscale's CGNAT range.
            if (octets[0] == 100 && octets[1] in 64..127) return RouteKind.TAILSCALE
            if (octets[0] == 10) return RouteKind.LAN
            if (octets[0] == 192 && octets[1] == 168) return RouteKind.LAN
            if (octets[0] == 172 && octets[1] in 16..31) return RouteKind.LAN
            if (octets[0] == 127) return RouteKind.LAN
        }
        if (host == "localhost") return RouteKind.LAN
        return RouteKind.CLOUDFLARE
    }

    /** One address with the round trip the shell measured, or null when it did not answer. */
    data class Probed(val url: String, val kind: RouteKind, val rttMs: Long?)

    /**
     * The best reachable address, or null when none answered.
     *
     * A candidate with no measurement is treated as unreachable rather than as
     * infinitely fast: a probe that never ran must not win.
     */
    fun pick(probed: List<Probed>): Probed? {
        var best: Probed? = null
        for (candidate in probed) {
            val rtt = candidate.rttMs ?: continue
            val current = best
            if (current == null) {
                best = candidate
                continue
            }
            val candidateTier = tier(candidate.kind)
            val currentTier = tier(current.kind)
            if (candidateTier < currentTier) {
                best = candidate
                continue
            }
            if (candidateTier == currentTier && rtt < (current.rttMs ?: Long.MAX_VALUE)) {
                best = candidate
            }
        }
        return best
    }

    /**
     * Whether a newly measured winner is worth switching to.
     *
     * Without hysteresis two addresses with near-equal round trips take turns
     * being "best", and every switch is a page load. A lower TIER always wins —
     * that is a capability change, not a speed one — while a same-tier win needs
     * to be both large and proportional.
     */
    fun shouldSwitch(
        active: Probed?,
        candidate: Probed?,
        minGainMs: Long = 30,
        minGainRatio: Double = 0.2,
    ): Boolean {
        if (candidate == null) return false
        if (active == null) return true
        val activeRtt = active.rttMs ?: return true

        val candidateTier = tier(candidate.kind)
        val activeTier = tier(active.kind)
        if (candidateTier < activeTier) return true
        if (candidateTier > activeTier) return false

        val candidateRtt = candidate.rttMs ?: return false
        val gain = activeRtt - candidateRtt
        return gain > minGainMs && gain.toDouble() / activeRtt > minGainRatio
    }

    /** The host of an http(s) URL, or null. */
    private fun hostOf(url: String): String? = try {
        val uri = URI(url.trim())
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") null else uri.host?.lowercase()
    } catch (_: Exception) {
        null
    }

    /** Four octets, or null when `host` is not a dotted IPv4 literal. */
    private fun ipv4(host: String): IntArray? {
        val parts = host.split('.')
        if (parts.size != 4) return null
        val octets = IntArray(4)
        for (index in parts.indices) {
            val value = parts[index].toIntOrNull() ?: return null
            if (value !in 0..255) return null
            octets[index] = value
        }
        return octets
    }
}
