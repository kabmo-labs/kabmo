package dev.kabmo.shell

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebSettings
import android.webkit.WebView

/**
 * WebView client configuration, in one place.
 *
 * The settings are grouped by why they exist, because several of them look like
 * hardening but are actually correctness requirements for this particular app.
 */
object KabmoWebView {

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(webView: WebView) {
        val settings = webView.settings

        // The app is a single-page Preact bundle; without JS there is nothing.
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true

        // Kabmo keeps its drafts in `sessionStorage` (ask-panel drafts) and its
        // plugin runtime probes storage availability; `domStorageEnabled` above
        // covers both. `databaseEnabled` (WebSQL) is deliberately NOT set: the
        // API is deprecated in Chromium and Kabmo uses no database storage, so
        // enabling it would be a warning without a consumer.

        // Layout: the page ships its own viewport meta, so the WebView must not
        // apply a wide viewport of its own. `useWideViewPort` makes the page's
        // `<meta name="viewport">` authoritative, which is what lets the phone
        // layout render at device width.
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = false

        // PINCH ZOOM, on — the same gesture Chrome and Brave give a page.
        //
        // The shell shipped with all three of these OFF, which is why a
        // two-finger spread did nothing while a browser zoomed: the user was
        // comparing the app against a browser and the app had the capability
        // switched off. `setSupportZoom` is the documented gate for every zoom
        // gesture, `builtInZoomControls` enables the pinch handling itself, and
        // `displayZoomControls = false` then hides the on-screen +/- buttons —
        // so the gesture works and no chrome appears, exactly like Chrome.
        //
        // Measured on Android 15 (WebView 124): with these on, a real two-finger
        // gesture takes the viewport from scale 1 to 2.88. Note that the emulator
        // still zoomed with `setSupportZoom(false)`, so the setting is not the
        // only path into the gesture there — but it is the documented one and
        // the one every other WebView honours, so it stays on.
        //
        // This is the VIEWPORT zoom (what the fingers do), deliberately separate
        // from the Settings → Page zoom slider, which is the page's own initial
        // scale: the slider sets where a fresh load starts, and a pinch
        // overrides it for that session. Both were measured in effect at once.
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false

        // A file:// page must never be able to read the app's own assets, and
        // Kabmo never navigates to file:// — the editor reads through HTTP.
        settings.allowFileAccess = false
        settings.allowContentAccess = false

        // No mixed content: an https server is expected to be all-https, and
        // permitting a downgrade would silently weaken exactly the connection
        // the user chose.
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        // The UA is deliberately NOT replaced: it carries "Android" + "Mobile",
        // which is what the server's SSR hint (`MOBILE_UA`) and the client's own
        // detector read to pick the phone layout.
        //
        // It IS suffixed with this shell's own version, and that token is the
        // only channel the console has for "which APK am I running in". A JS
        // bridge would be a second, larger surface for one string, and the UA
        // already crosses every request — including the one that renders the
        // shell, so the server can answer without a round trip.
        settings.userAgentString = "${settings.userAgentString} ${BuildConfig.SHELL_UA_TOKEN}"

        // Cookies: the session cookie is HttpOnly + SameSite=Lax and named per
        // port, so the shell must accept third-party-free first-party cookies
        // and persist them across restarts.
        android.webkit.CookieManager.getInstance().apply {
            setAcceptCookie(true)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                setAcceptThirdPartyCookies(webView, false)
            }
        }

        // Text selection drives the app's own copy buttons.
        webView.isLongClickable = true

        // A WebView left with the default background flashes white between the
        // launch frame and the first paint; the theme's paper colour is what the
        // page paints anyway.
        webView.setBackgroundColor(android.graphics.Color.parseColor("#FAF8F3"))
    }

    /** Origin of a URL, or null when it cannot be parsed. */
    fun originOf(url: String): String? = try {
        val parsed = android.net.Uri.parse(url)
        val scheme = parsed.scheme ?: return null
        val host = parsed.host ?: return null
        if (parsed.port > 0) "$scheme://$host:${parsed.port}" else "$scheme://$host"
    } catch (_: Exception) {
        null
    }

    /** Whether a URL stays inside the shell's server. */
    fun isInternal(context: Context, url: String): Boolean {
        val server = ServerConfig.read(context) ?: return false
        val serverOrigin = originOf(server) ?: return false
        return originOf(url) == serverOrigin
    }
}
