package dev.kabmo.shell

import android.content.Context
import java.net.URI

/**
 * Where the shell points, and the only place it is stored.
 *
 * The URL is kept in `SharedPreferences` rather than in a file of our own: it is
 * one string, it must survive process death, and the platform already gives
 * atomic writes plus a backup-free location (`allowBackup="false"` in the
 * manifest keeps it off cloud backups).
 */
object ServerConfig {
    private const val PREFS = "kabmo-shell"
    private const val KEY_URL = "server_url"
    private const val KEY_ZOOM = "zoom_percent"

    /**
     * Page zoom bounds, in percent.
     *
     * 100 is the page's own size. Below 50 the phone layout's tap targets stop
     * being tappable; above 200 a two-column phone view becomes a single word per
     * line. The step is 10 so the slider has 16 positions — enough to land on the
     * size you want, few enough that a thumb can.
     */
    const val ZOOM_MIN = 50
    const val ZOOM_MAX = 200
    const val ZOOM_STEP = 10
    const val ZOOM_DEFAULT = 100

    fun read(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_URL, null)
            ?.takeIf { it.isNotBlank() }

    fun write(context: Context, url: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_URL, url)
            .apply()
    }

    /**
     * The saved page zoom, clamped and rounded to the slider's grid.
     *
     * Rounding on READ as well as on write is what keeps a value written by an
     * older build (or by hand, through `adb`) inside the range the UI can
     * represent — a percent the slider cannot express would render as a thumb at
     * one end while the page scaled by something else.
     */
    fun zoom(context: Context): Int {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_ZOOM, ZOOM_DEFAULT)
        return clampZoom(raw)
    }

    fun writeZoom(context: Context, percent: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_ZOOM, clampZoom(percent))
            .apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    /** Snap a percent onto the slider's grid, inside the allowed range. */
    fun clampZoom(percent: Int): Int {
        val bounded = percent.coerceIn(ZOOM_MIN, ZOOM_MAX)
        val snapped = ZOOM_MIN + ((bounded - ZOOM_MIN) / ZOOM_STEP) * ZOOM_STEP
        return snapped.coerceIn(ZOOM_MIN, ZOOM_MAX)
    }
}

/** A normalized server address, or the reason it cannot be one. */
sealed interface NormalizedUrl {
    data class Ok(val url: String) : NormalizedUrl
    data class Error(val message: String) : NormalizedUrl
}

/**
 * Normalize what the user typed into an origin.
 *
 * The client is root-relative everywhere — every API call is `fetch('/api/…')`
 * and both sockets derive their URL from `window.location` — so a base path
 * cannot work: `http://host:3000/kabmo` would send `/api/health` to
 * `http://host:3000/api/health` and 404. Rather than accept a URL that silently
 * breaks, the path is refused with an explanation.
 *
 * A missing scheme becomes `http`, because a self-hosted LAN server is the
 * common case and typing `192.168.1.20:3000` should not fail.
 *
 * `java.net.URI`, not `android.net.Uri`: this is pure parsing, so the JVM test
 * suite exercises it without an emulator (`app/src/test`). `Uri` also accepts
 * malformed hosts that `URI` rejects, which is the opposite of what a settings
 * field wants.
 */
object UrlNormalizer {

    fun normalize(raw: String): NormalizedUrl {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return NormalizedUrl.Error("empty")

        val withScheme = if (trimmed.contains("://")) trimmed else "http://$trimmed"
        val uri = try {
            URI(withScheme)
        } catch (_: Exception) {
            return NormalizedUrl.Error("shape")
        }

        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return NormalizedUrl.Error("scheme")

        val host = uri.host
        if (host.isNullOrBlank()) return NormalizedUrl.Error("shape")
        if (!uri.userInfo.isNullOrEmpty()) return NormalizedUrl.Error("shape")
        if (!uri.query.isNullOrEmpty() || !uri.fragment.isNullOrEmpty()) return NormalizedUrl.Error("shape")
        if (uri.port != -1 && uri.port !in 1..65535) return NormalizedUrl.Error("shape")

        // A trailing slash is the root and is harmless; anything else is a base
        // path the client cannot honour.
        val path = uri.path.orEmpty()
        if (path.isNotEmpty() && path != "/") return NormalizedUrl.Error("path")

        // `URI.host` drops the brackets around an IPv6 literal; they are
        // required again in the URL the shell loads.
        val formatted = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        val portPart = if (uri.port > 0) ":${uri.port}" else ""

        return NormalizedUrl.Ok("$scheme://$formatted$portPart")
    }
}
