package dev.kabmo.shell

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * `GET /api/health`, the same readiness probe the CLI uses.
 *
 * The route is deliberately dependency-free on the server (it never touches the
 * database and never throws), so it is the one endpoint that can answer while
 * Kabmo is still starting. The check is not "something responded" but "a Kabmo
 * responded": `service` must be `kabmo`, which is what stops the app from
 * saving a URL that points at some other web server and then showing an
 * unrelated page inside the shell.
 */
data class HealthResult(
    val ok: Boolean,
    val message: String,
    val version: String? = null,
    val port: Int = 0,
    val authEnabled: Boolean = false,
    val mock: Boolean = false,
)

object HealthProbe {
    private const val TIMEOUT_MS = 6_000

    fun check(baseUrl: String, onResult: (HealthResult) -> Unit) {
        thread(name = "kabmo-health", isDaemon = true) {
            onResult(request(baseUrl))
        }
    }

    private fun request(baseUrl: String): HealthResult {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$baseUrl/api/health").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Accept", "application/json")
                instanceFollowRedirects = false
            }

            val status = connection.responseCode
            if (status !in 200..299) {
                // A gated instance answers 401 here only when the health route is
                // behind auth; it is public by design, so a non-2xx is a refusal
                // from something else listening on that port.
                return HealthResult(false, "status")
            }

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            if (json.optString("service") != "kabmo") return HealthResult(false, "not-kabmo")

            HealthResult(
                ok = true,
                message = "ok",
                version = json.optString("version").takeIf { it.isNotEmpty() },
                port = json.optInt("port", 0),
                authEnabled = json.optBoolean("authEnabled", false),
                mock = json.optBoolean("mock", false),
            )
        } catch (_: Exception) {
            HealthResult(false, "unreachable")
        } finally {
            connection?.disconnect()
        }
    }
}
