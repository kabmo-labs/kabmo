package dev.kabmo.shell

import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Which of the stored addresses answers fastest, and which one to use.
 *
 * The probe is `GET /api/health` — the one route that is public, touches no
 * database and never throws, so it answers while the server is still starting
 * and cannot be mistaken for a login redirect. The measurement is the round trip
 * to the first byte, which is what a page load actually pays.
 *
 * Probes run in PARALLEL with a short timeout. Sequentially, three dead
 * addresses would cost three timeouts before the working one is even tried, and
 * the whole point is to recover from a dead address quickly.
 *
 * The choice itself is `RouteChoice`'s, which is pure and tested; this class only
 * measures.
 */
object ServerProbe {

    /** How long one address gets. A LAN RTT is 1–5 ms; a dead one must fail fast. */
    const val TIMEOUT_MS = 1_500

    /** The round trip to `/api/health`, or null when the address did not answer. */
    fun rttMs(url: String, timeoutMs: Int = TIMEOUT_MS): Long? {
        val target = try {
            URL("${url.trimEnd('/')}/api/health")
        } catch (_: Exception) {
            return null
        }
        val started = System.nanoTime()
        var connection: HttpURLConnection? = null
        return try {
            connection = (target.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                useCaches = false
                setRequestProperty("accept", "application/json")
                setRequestProperty("accept-encoding", "identity")
            }
            if (connection.responseCode !in 200..299) return null
            // The body is read so the measurement covers the whole exchange, not
            // just the headers — a server that answers headers and then stalls
            // would otherwise look healthy.
            connection.inputStream.use { it.readBytes() }
            TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
        } catch (_: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * The best reachable address among `candidates`, or null when none answered.
     *
     * `candidates` is the shell's own server list, so the same address may appear
     * once; duplicates are collapsed because two rows for one origin can never
     * disagree and would only double the probe.
     */
    fun best(candidates: List<String>, timeoutMs: Int = TIMEOUT_MS): String? {
        val unique = candidates.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (unique.isEmpty()) return null
        if (unique.size == 1) return if (rttMs(unique[0], timeoutMs) != null) unique[0] else null

        val pool = Executors.newFixedThreadPool(unique.size)
        return try {
            val probed = pool.invokeAll(
                unique.map { url ->
                    Callable { RouteChoice.Probed(url, RouteChoice.kindOf(url), rttMs(url, timeoutMs)) }
                },
                // The pool's own deadline is a backstop: each call already has a
                // read timeout, and a hung DNS lookup is the one case that can
                // outlive it.
                (timeoutMs + 500).toLong(),
                TimeUnit.MILLISECONDS,
            ).mapNotNull { future -> if (future.isCancelled) null else future.get() }
            RouteChoice.pick(probed)?.url
        } catch (_: Exception) {
            null
        } finally {
            pool.shutdownNow()
        }
    }
}
