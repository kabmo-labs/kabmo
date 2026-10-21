package dev.kabmo.shell

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView

/**
 * The shell: one full-screen WebView, and the back button.
 *
 * Two decisions are load-bearing and each was the alternative's failure:
 *
 * 1. **The URL is loaded directly, never proxied.** Every WebSocket upgrade is
 *    origin-checked server-side by comparing `Origin` to `Host`, so a custom
 *    scheme or a rewriting proxy is rejected with 403 on the realtime, terminal
 *    and dictation sockets.
 * 2. **The settings screen is a separate Activity.** A dialog over the WebView
 *    would be dismissed by any navigation, and the first run has no page to
 *    draw one over.
 *
 * There is deliberately NO in-app control for the server address. The WebView
 * fills the display, and every edge of it belongs to Kabmo's own chrome — a
 * floating button sits on a control it is not, and an edge tab covers the
 * transcript's scroll gutter. The one entry point is the **launcher shortcut**
 * (long-press the icon → Server settings), which is also the only one that
 * still works when the saved address no longer answers.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var overlay: LoadingOverlay
    private var loading = LoadingState.done()
    private var loadedUrl: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        overlay = LoadingOverlay(this).apply {
            onRetry = { retryLoad() }
            onOpenSettings = { openSettings() }
        }

        // The overlay is a SIBLING of the WebView, never a view inside the page:
        // the page cannot report its own readiness (its bundle is what renders
        // the app), and a page-drawn overlay would vanish exactly when the page
        // fails to load.
        val root = android.widget.FrameLayout(this)
        root.addView(
            webView,
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        root.addView(
            overlay,
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(root)

        configureWebView()

        if (ServerConfig.read(this) == null) {
            // First run: there is nothing to load. The setup screen saves a URL
            // and finishes; `onResume` then loads it.
            openSettings()
        } else if (intent?.action == ACTION_OPEN_SETTINGS) {
            // The launcher shortcut. It cannot target SettingsActivity directly
            // (that activity is not exported), so it arrives here instead.
            openSettings()
        }
    }

    /**
     * `singleTask` delivers a second shortcut launch here rather than creating a
     * new instance, so the action has to be handled twice: on create and on a
     * re-launch while the console is already in front.
     */
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent?.action == ACTION_OPEN_SETTINGS) openSettings()
    }

    override fun onResume() {
        super.onResume()

        // Zoom is applied on EVERY resume, not only when it changes: the settings
        // screen writes it while this Activity is paused, and the value is cheap
        // to set (a float assignment; the WebView relayouts once).
        applyZoom()

        val url = ServerConfig.read(this)
        if (url == null) return
        if (url == loadedUrl) return

        // A saved URL change is a different origin, so the previous session is
        // dropped. Without this, moving from one Kabmo instance to another on
        // the same host:port leaves a cookie for a user that does not exist
        // there, and the login screen is skipped into a 401 loop.
        if (loadedUrl != null) {
            CookieManager.getInstance().removeAllCookies(null)
            flushCookies()
        }
        loadedUrl = url
        startLoad(url)
    }

    /**
     * Force the cookie store to disk.
     *
     * Chromium persists cookies on a timer and on a CLEAN shutdown; an app
     * swiped away from recents or force-stopped gets neither, so a session
     * created seconds earlier was simply lost and the next launch asked for the
     * password again — the reported "harus login terus menerus pas buka tutup".
     * Measured on Android 15: a fresh login left `app_webview/Default/Cookies`
     * with zero rows at t+5s and t+15s, and the row appeared at t+30s.
     *
     * Called at every point a session can have just been created (a page
     * finished loading, which is what a successful login navigates into) and
     * whenever the shell leaves the foreground, because that is the last moment
     * the process is guaranteed to be alive.
     */
    private fun flushCookies() {
        CookieManager.getInstance().flush()
    }

    override fun onPause() {
        flushCookies()
        super.onPause()
    }

    /**
     * Begin a load with the overlay up.
     *
     * The state is armed BEFORE `loadUrl`, because a cached document can call
     * `onPageStarted` on the same tick: arming afterwards would let the first
     * progress frame of a real load be ignored as "already finished".
     */
    private fun startLoad(url: String) {
        loading = LoadingState.connecting()
        overlay.render(loading)
        webView.loadUrl(url)
    }

    /**
     * Retry from the overlay's own button.
     *
     * A failed load leaves the WebView on Chromium's error page, which is not a
     * document the console can recover from; reloading the saved address is the
     * only retry that means anything. `loadedUrl` is deliberately NOT cleared —
     * it is what keeps a resume from clearing the cookie jar.
     */
    private fun retryLoad() {
        val url = ServerConfig.read(this) ?: return
        startLoad(url)
    }

    private fun applyLoading(next: LoadingState) {
        loading = next
        overlay.render(next)
    }

    /**
     * Apply the saved page zoom — the page's STARTING scale.
     *
     * `WebSettings.textZoom` is not usable here: it scales text only and leaves
     * layout at 100%, which reflows a two-column phone view into something that
     * no longer matches its boxes. `setInitialScale` scales the page itself.
     *
     * The argument is NOT the saved percent: `setInitialScale` counts percent of
     * the device's default scale, so the display density has to be multiplied in
     * (`ServerConfig.initialScaleFor`). Passing the percent straight through is
     * what made the setting look dead — at density 2.625 a 100% page rendered at
     * 0.38x and the whole slider stayed below 1.0x.
     *
     * It does NOT block a pinch. Measured on Android 15 with a real two-finger
     * gesture: with this call in force and `setSupportZoom(true)`, a pinch took
     * the viewport from scale 1 to 2.88 — so the two are independent, and the
     * slider sets where a load starts while a pinch overrides it for the
     * session. The gesture is gated by `setSupportZoom` alone (see
     * `KabmoWebView`).
     *
     * Applying it on resume takes effect on the live page with no reload
     * (verified: 100% -> 150% in the settings screen -> Back moved
     * `visualViewport.scale` 0.998 -> 1.499 on the same document).
     */
    private fun applyZoom() {
        val percent = ServerConfig.zoom(this)
        val density = resources.displayMetrics.density
        webView.setInitialScale(ServerConfig.initialScaleFor(percent, density))
    }

    /** Opens the native settings screen. Reached from the launcher shortcut. */
    fun openSettingsScreen() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    /**
     * The back button, delegated to the page first.
     *
     * `onBackPressed` is deprecated in favour of AndroidX's
     * `OnBackPressedDispatcher`, which this app does not depend on — and the
     * platform still calls it, because predictive back is opt-in through
     * `android:enableOnBackInvokedCallback` and the manifest does not set it.
     * Adding AndroidX for one callback would be a library per button.
     */
    @Deprecated("Deprecated in the platform; see the method's own comment")
    override fun onBackPressed() {
        // The page gets the first refusal. Kabmo's phone layout keeps its
        // drawers in React state, not in the URL, so `canGoBack()` alone would
        // walk history and leave an open drawer behind; the client installs
        // `window.__kabmoBack` to close what it owns.
        webView.evaluateJavascript("window.__kabmoBack ? String(window.__kabmoBack()) : 'false'") { result ->
            val consumed = result?.trim()?.trim('"') == "true"
            when {
                consumed -> Unit
                webView.canGoBack() -> webView.goBack()
                else -> finish()
            }
        }
    }

    private fun configureWebView() {
        KabmoWebView.configure(webView)
        webView.webViewClient = KabmoWebViewClient(
            activity = this,
            onCertificateProblem = { description -> showCertificateDialog(description) },
            // Only `startLoad` re-opens the overlay. A later in-app navigation
            // (the login submit is one) must NOT flash it: the state machine
            // ignores progress once it has finished, so a navigation after the
            // console is up costs nothing — while a FAILED main-frame load still
            // surfaces its reason, which is the blank-screen case worth covering.
            onLoadFinished = {
                applyLoading(loading.finished())
                // A successful login is a NAVIGATION, so this is the first
                // moment the new session cookie exists. Chromium would write it
                // out on its own schedule (~30 s measured), which a user who
                // closes the app right after signing in never reaches.
                flushCookies()
            },
            onLoadFailed = { failure -> applyLoading(loading.failedBecause(failure)) },
        )
        webView.webChromeClient = KabmoChromeClient(
            activity = this,
            onFileChooser = { callback -> showFileChooser(callback) },
            onProgress = { percent -> applyLoading(loading.progressed(percent)) },
        )
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            KabmoDownloads.start(this, url, contentDisposition, mimeType)
        }
    }

    private fun openSettings() = openSettingsScreen()

    private fun showFileChooser(callback: android.webkit.ValueCallback<Array<Uri>>) {
        // The WebView's chooser is delegated to the system picker. `*/*` rather
        // than the accept types the page asked for: Kabmo's attach button
        // accepts images AND arbitrary files, and Android's picker needs one
        // MIME to decide which app to open.
        try {
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            // Assigned BEFORE the launch: a picker that returns immediately (a
            // remembered choice, or an instant cancellation) would otherwise
            // find no callback and silently drop the selection.
            pendingFileCallback = callback
            startActivityForResult(Intent.createChooser(intent, getString(R.string.url_label)), REQUEST_FILE)
        } catch (_: ActivityNotFoundException) {
            pendingFileCallback = null
            callback.onReceiveValue(null)
        }
    }

    private var pendingFileCallback: android.webkit.ValueCallback<Array<Uri>>? = null

    @Deprecated("Deprecated in the platform, still the only callback path below API 33")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_FILE) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val callback = pendingFileCallback
        pendingFileCallback = null
        if (callback == null) return
        if (resultCode != RESULT_OK || data == null) {
            callback.onReceiveValue(null)
            return
        }
        val clip = data.clipData
        val uris: Array<Uri> = when {
            clip != null -> Array(clip.itemCount) { index -> clip.getItemAt(index).uri }
            data.data != null -> arrayOf(data.data!!)
            else -> emptyArray()
        }
        callback.onReceiveValue(uris.ifEmpty { null })
    }

    /**
     * A certificate the platform does not trust is a REFUSAL with an explanation.
     *
     * `--tls` generates a self-signed certificate, so this is the expected state
     * on a first connection. Cancelling by default is what keeps the shell from
     * silently trusting an unknown issuer; the dialog names the workaround
     * instead of leaving a blank page.
     */
    private fun showCertificateDialog(description: String) {
        if (isFinishing) return
        AlertDialog.Builder(this)
            .setTitle(R.string.ssl_title)
            .setMessage(getString(R.string.ssl_body, description))
            .setPositiveButton(R.string.webview_error_settings) { _, _ -> openSettings() }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private companion object {
        const val REQUEST_FILE = 4101

        /** The launcher shortcut's action; see `res/xml/shortcuts.xml`. */
        const val ACTION_OPEN_SETTINGS = "dev.kabmo.shell.OPEN_SETTINGS"
    }
}
