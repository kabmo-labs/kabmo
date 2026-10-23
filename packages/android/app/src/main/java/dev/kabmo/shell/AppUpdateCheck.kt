package dev.kabmo.shell

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * The one HTTP call behind "Check for update", and its decoding.
 *
 * Kept apart from `AppRelease` for the reason that object exists: the RULES must
 * be testable on a plain JVM, and `org.json` is an Android framework class. This
 * file is the only part that needs the platform, and it is deliberately thin —
 * request, decode, hand back a `Release` or null.
 *
 * The request goes to the CONSOLE the shell is pointed at (see `AppRelease`), so
 * the answer is already cached server-side and already has the public-pages
 * fallback for a spent GitHub quota.
 */
object AppUpdateCheck {

  /** One worker: a check is a single request, and a pool would be a thread per tap. */
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "kabmo-update-check").apply { isDaemon = true }
  }

  private const val TIMEOUT_MS = 8_000

  /**
   * Ask the console, then decide.
   *
   * `installed` is this build's own `versionName`, read from `BuildConfig` at the
   * call site — never hardcoded here, because two numbers for one build is the
   * drift `packages/android/version.properties` exists to prevent.
   *
   * The callback runs on a BACKGROUND thread: the caller is an Activity, and a
   * dialog touched off the main thread crashes the process. Every call site hops
   * back with `runOnUiThread`.
   */
  fun check(baseUrl: String, installed: String, onResult: (AppRelease.Result) -> Unit) {
    executor.execute {
      onResult(AppRelease.decide(fetch(baseUrl), installed))
    }
  }

  /** The console's answer, or null when it could not be read. */
  private fun fetch(baseUrl: String): AppRelease.Release? {
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(AppRelease.urlFor(baseUrl)).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = TIMEOUT_MS
        readTimeout = TIMEOUT_MS
        setRequestProperty("Accept", "application/json")
        instanceFollowRedirects = false
      }
      if (connection.responseCode !in 200..299) return null

      val body = connection.inputStream.bufferedReader().use { it.readText() }
      parse(body)
    } catch (_: Exception) {
      null
    } finally {
      connection?.disconnect()
    }
  }

  /**
   * Read `{url, latest, releaseUrl}`.
   *
   * The console answers `{url: null, latest: null}` for a probe it could not
   * complete, so a missing either field is a FAILED read rather than a release
   * with no link — the distinction `AppRelease.decide` rests on.
   */
  fun parse(body: String): AppRelease.Release? {
    val json = try {
      JSONObject(body)
    } catch (_: Exception) {
      return null
    }

    val url = json.optString("url").takeIf { it.isNotBlank() } ?: return null
    val latest = json.optString("latest").takeIf { it.isNotBlank() } ?: return null
    val releaseUrl = json.optString("releaseUrl").takeIf { it.isNotBlank() }
    return AppRelease.Release(url = url, latest = latest, releaseUrl = releaseUrl)
  }
}
