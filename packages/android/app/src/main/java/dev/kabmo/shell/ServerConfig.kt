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
    private const val KEY_PALETTE = "shell_palette"

    /**
     * Page zoom bounds, in percent.
     *
     * 100 is the page's own size. Below 50 the phone layout's tap targets stop
     * being tappable; above 200 a two-column phone view becomes a single word per
     * line.
     *
     * The step is 1, so every whole percent in the range is a position the slider
     * can land on (151 of them). A 10% grid was the first shape and it was too
     * coarse to aim: the size a reader wants is usually one notch from where the
     * grid happens to sit, and `setInitialScale` has no sub-percent resolution to
     * split the difference with. The SeekBar's own resolution is what makes this
     * usable — 150 intervals across the track is ~2px per step on a phone, well
     * inside a finger's tolerance, and the percent is printed beside the label so
     * the exact value is readable rather than inferred.
     *
     * These are percentages of the PAGE, and `initialScaleFor` is what turns one
     * into the number `WebView.setInitialScale` wants. Handing that call the bare
     * percent is the bug this range documents: see `initialScaleFor`.
     */
    const val ZOOM_MIN = 50
    const val ZOOM_MAX = 200
    const val ZOOM_STEP = 1
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

    /**
     * The palette the console last reported, or the shipped default.
     *
     * Stored rather than derived: the launch overlay is drawn BEFORE any page
     * exists, so this is the only colour the shell has on a cold start. Written
     * on every successful load (see `MainActivity`), which is what makes a theme
     * picked in Settings the palette the NEXT launch paints.
     */
    fun palette(context: Context): ShellPalette {
        val wire = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_PALETTE, null)
        return ShellPalette.parse(wire) ?: ShellPalette.DEFAULT
    }

    /**
     * Remember the console's palette.
     *
     * A wire that does not parse is NOT written: keeping the previous palette is
     * the only answer that cannot repaint the shell with a colour no theme ever
     * chose.
     */
    fun writePalette(context: Context, palette: ShellPalette) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PALETTE, palette.wire())
            .apply()
    }

    /** Snap a percent onto the slider's grid, inside the allowed range. */
    fun clampZoom(percent: Int): Int {
        val bounded = percent.coerceIn(ZOOM_MIN, ZOOM_MAX)
        val snapped = ZOOM_MIN + ((bounded - ZOOM_MIN) / ZOOM_STEP) * ZOOM_STEP
        return snapped.coerceIn(ZOOM_MIN, ZOOM_MAX)
    }

    /**
     * The `WebView.setInitialScale` argument for a saved percent.
     *
     * `setInitialScale` takes a percentage of the DEVICE's default scale, not of
     * the page, and the two differ by the display density. `setInitialScale(100)`
     * therefore means "100% of the default" — on a 420 dpi phone (density 2.625)
     * the page came out at 0.38x, which is the reported "zoom setting does
     * nothing": every value on the slider's low half clamped to the same 0.38x
     * and 200% only reached 0.76x, so the console rendered as a desktop layout
     * on a phone and no setting appeared to change anything.
     *
     * Measured on Android 15 (WebView 124, 1080x2340) across three densities,
     * with the multiply in place: 50/100/200% land on page scale 0.5/1.0/2.0 at
     * density 1.0, 1.5 and 2.0, and 0.5/1.0/2.0 at 2.625. Without it, the same
     * three values read 0.19/0.38/0.76 at 2.625 and never reach 1.0.
     *
     * `resources.displayMetrics.density` is the WebView's own DIP scale (what
     * AwSettings divides the argument by on its way to Blink), so this is the
     * inverse of the platform's conversion rather than a second convention.
     */
    fun initialScaleFor(percent: Int, density: Float): Int = (percent * density).toInt()
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

    /**
     * Whether `candidate` names the SAME server as `saved`.
     *
     * Both sides are `normalize` output, so a path, query or fragment cannot
     * reach either one, and scheme and host are case-insensitive in an origin —
     * which makes a case-insensitive compare of the whole string exact.
     *
     * This is the decision the settings screen uses to decide whether a Connect
     * must sign the user out. The screen used to clear the cookie unconditionally,
     * so a user who only dragged the zoom slider and then tapped Connect was
     * signed out of a server whose address had not changed at all.
     */
    fun sameOrigin(saved: String?, candidate: String): Boolean {
        if (saved.isNullOrBlank()) return false
        return saved.trimEnd('/').equals(candidate.trimEnd('/'), ignoreCase = true)
    }

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
