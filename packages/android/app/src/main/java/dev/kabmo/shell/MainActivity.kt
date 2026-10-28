package dev.kabmo.shell

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.WebView
import java.util.concurrent.Executors

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
            // The palette the console reported on a PREVIOUS launch, so the
            // overlay is already the right colour before anything loads.
            applyPalette(ServerConfig.palette(this@MainActivity))
            onRetry = { retryLoad() }
            onOpenSettings = { openSettings() }
        }
        // The frame BEHIND the page, for the instant between the overlay
        // disappearing and the console's first paint.
        webView.setBackgroundColor(Color.parseColor(ServerConfig.palette(this).canvas))

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

        // A document the user opened FROM another app ("Open with → Kabmo", or
        // Share). Read here rather than in `onResume`, because the read is a
        // one-shot grant on the intent: the URI permission belongs to THIS
        // intent, and re-reading it later can fail.
        deliverDocument(intent)
    }

    /**
     * `singleTask` delivers a second shortcut launch here rather than creating a
     * new instance, so the action has to be handled twice: on create and on a
     * re-launch while the console is already in front.
     */
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent?.action == ACTION_OPEN_SETTINGS) {
            openSettings()
            return
        }
        // A document opened while the console is already in front. `singleTask`
        // delivers it here rather than creating a second Activity, so without
        // this the tap would do nothing at all.
        deliverDocument(intent)
    }

    override fun onResume() {
        super.onResume()

        // Zoom is applied on EVERY resume, not only when it changes: the settings
        // screen writes it while this Activity is paused, and the value is cheap
        // to set (a float assignment; the WebView relayouts once).
        applyZoom()

        // Tell the page the app is back, so the realtime channel repairs itself
        // now rather than at its next watchdog tick.
        //
        // A backgrounded WebView does NOT reliably deliver what the channel
        // listens for: the document is never reported hidden, so returning to the
        // app fires no `visibilitychange`, and a socket the server's 30s
        // heartbeat reaped while the page was frozen produces no `close` either —
        // `readyState` still says OPEN. The channel therefore sat on a dead
        // socket with no frames, the stream froze mid-answer, and only a page
        // reload repaired it. `window.__kabmoResume()` is the shell's own signal
        // (`src/client/lib/native/resume.ts`); the watchdog in
        // `shared/lib/realtime/resume.ts` covers the case where even this never
        // runs.
        webView.evaluateJavascript("window.__kabmoResume && window.__kabmoResume()", null)

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
     * The shell is one Activity, recreated by a process restart and by the
     * install that replaces this APK. The update flow's static dialog and the
     * installer's callback both hold an Activity, so both are released here
     * rather than left to leak into the next instance.
     */
    override fun onDestroy() {
        UpdateFlow.dismissAll()
        // The reader thread holds a content resolver and a reference to this
        // Activity; leaving it alive past the instance is a leak, and its
        // `webView.post` would land on a destroyed view.
        io.shutdownNow()
        super.onDestroy()
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
     * Ask the page which palette it is painting, and keep the answer.
     *
     * The property is installed by `src/client/lib/native/palette.ts` before the
     * first render, so it exists by the time a load finishes. An older build
     * answers `undefined` — the callback then hands back `null`, the parse
     * returns null, and the stored palette is left exactly as it was rather than
     * being replaced with a colour no theme chose.
     *
     * `evaluateJavascript`, not `evaluateJavascript(…, null)` with a side effect
     * inside a string: the answer is a value we need back, and it is returned as
     * JSON — a quoted string — which is what `fromJavascript` unwraps.
     */
    private fun readPalette() {
        webView.evaluateJavascript("window.__kabmoPalette ? window.__kabmoPalette() : null") { result ->
            val next = ShellPalette.fromJavascript(result) ?: return@evaluateJavascript
            ServerConfig.writePalette(this, next)
            overlay.applyPalette(next)
            // The frame between the overlay going away and the console's own
            // paint is this colour, so it has to move with the theme too.
            webView.setBackgroundColor(Color.parseColor(next.canvas))
        }
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
            // Only `startLoad` and a RELOAD re-open the overlay. A later in-app
            // navigation (the login submit is one) must NOT flash it: the state
            // machine ignores progress once it has finished, so a navigation
            // after the console is up costs nothing — while a FAILED main-frame
            // load still surfaces its reason, which is the blank-screen case
            // worth covering.
            //
            // The page's own Reload control is the exception, and it is what
            // this callback exists for: `location.reload()` fetches the SAME
            // address again, which from the shell's side is a cold start in
            // miniature — the console is replaced by a blank document while the
            // bundle is re-fetched, and leaving the overlay hidden there made
            // the header's button look like it did nothing.
            onLoadStarted = { startedUrl, shownUrl ->
                if (LoadingState.isDocumentReload(startedUrl, shownUrl, loading.phase)) {
                    applyLoading(LoadingState.connecting())
                }
            },
            onLoadFinished = {
                applyLoading(loading.finished())
                // A document that arrived before the console did — a cold start
                // by "Open with" — has been waiting since `onCreate`, and this
                // is the first moment a page can take it.
                pageReady = true
                flushPendingScripts()
                // The console has painted, so `window.__kabmoPalette()` answers
                // the ACTIVE theme. Stored for the next cold start — which is
                // the only launch where the overlay has no page to ask — and
                // applied to the live overlay too, because a theme changed in
                // Settings is exactly the case where the stored palette is
                // stale and the overlay it describes is still on screen.
                readPalette()
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
            // An APK is the ONE download the shell finishes itself: the console
            // offered it by name (the sidebar's "Update APK"), and handing the
            // file to Downloads would make the user find it, tap it, and get
            // through the same system dialog anyway — three steps later.
            if (ApkUpdate.isApkDownload(url, contentDisposition, mimeType)) {
                UpdateFlow.start(
                    this,
                    UpdateFlow.Download(url, ApkUpdate.fileNameFrom(contentDisposition, url)),
                )
            } else {
                KabmoDownloads.start(this, url, contentDisposition, mimeType)
            }
        }
    }

    private fun openSettings() = openSettingsScreen()

    // ------------------------------------------------------- opened documents

    /**
     * A document another app handed over, read and pushed into the page.
     *
     * The bytes travel through the page because the console may be on ANOTHER
     * machine: a phone's file exists only on the phone, so the server could
     * never read it and `POST /api/fs/grant` would be granting a path nothing
     * there has seen. The tab renders and is read-only, which is the honest
     * model and what the editor's own banner says.
     *
     * The read runs off the UI thread — a 20 MiB document over a slow provider
     * is not something to do on the main thread — and every chunk is posted back
     * through `webView.post`, because `evaluateJavascript` must be called there.
     */
    private fun deliverDocument(intent: Intent?) {
        // A shared TEXT ("Share → Kabmo" on a paragraph) carries no URI and no
        // file, but the manifest lists `text/plain` for SEND — so a chooser entry
        // that did nothing would be a promise the app cannot keep. It opens as a
        // `shared.txt` tab instead, which is what the user was looking at.
        val sharedText = sharedText(intent)
        if (sharedText != null) {
            deliverBytes(
                DeviceFiles.displayName(null, null, "text/plain", fallback = "shared"),
                "text/plain",
                sharedText.toByteArray(Charsets.UTF_8),
            )
            return
        }

        val uri = documentUri(intent) ?: return
        val counter = nextDelivery++
        val id = DeviceFiles.deliveryId(counter)

        io.execute {
            val resolver = contentResolver
            var name: String? = null
            var size = 0L
            val bytes: ByteArray? = try {
                // `DISPLAY_NAME` is the only place the real filename exists: a
                // content URI carries an opaque id, and the segment at its end
                // is often `document/1234`.
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex)
                        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
                    }
                }
                resolver.openInputStream(uri)?.use { it.readBytes() }
            } catch (error: Exception) {
                // A revoked grant, a provider that went away, a file another app
                // is rewriting: all of them are "could not read it", and the
                // shell says so where the user is looking.
                null
            }

            val mimeType = resolver.getType(uri)
            val resolved = DeviceFiles.displayName(name, uri.lastPathSegment, mimeType)
            if (bytes == null) {
                // Announcing a file whose bytes could not be read would open an
                // EMPTY tab named after it, which reads as "the file is empty"
                // rather than "it could not be read".
                runOnUiThread { showOpenFailure(resolved) }
                return@execute
            }
            val announced = DeviceFiles.Meta(id, resolved, mimeType, if (size > 0) size else bytes.size.toLong())
            runOnUiThread { sendBytes(id, announced, bytes) }
        }
    }

    /** A shared paragraph or link, when the intent carries text and no file. */
    private fun sharedText(intent: Intent?): String? {
        if (intent?.action != DeviceFiles.ACTION_SEND) return null
        @Suppress("DEPRECATION")
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
        return text?.takeIf { it.isNotEmpty() }
    }

    /**
     * A document that came as BYTES rather than a URI — a shared text.
     *
     * It skips the resolver entirely, so it lands on the UI thread already and
     * only has to be announced and streamed.
     */
    private fun deliverBytes(name: String, mimeType: String, bytes: ByteArray) {
        val id = DeviceFiles.deliveryId(nextDelivery++)
        val meta = DeviceFiles.Meta(id, name, mimeType, bytes.size.toLong())
        sendBytes(id, meta, bytes)
    }

    /** Announce one file and stream its base64, chunked, to the page. */
    private fun sendBytes(id: String, meta: DeviceFiles.Meta, bytes: ByteArray) {
        val scripts = ArrayList<String>(2)
        scripts.add(DeviceFiles.announceScript(listOf(meta)))
        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        val pieces = DeviceFiles.chunks(base64)
        pieces.forEachIndexed { index, piece ->
            scripts.add(DeviceFiles.chunkScript(id, piece, index == pieces.lastIndex))
        }
        sendToPage(scripts)
    }

    private fun showOpenFailure(name: String) {
        if (isFinishing || isDestroyed) return
        android.widget.Toast.makeText(this, getString(R.string.open_failed, name), android.widget.Toast.LENGTH_LONG).show()
    }

    /**
     * The file one intent names, if it names one.
     *
     * Two actions, because a file reaches an app two ways: `VIEW` is "open this
     * with…" from a file manager, and `SEND` is the share sheet. `SEND` puts its
     * payload in `EXTRA_STREAM` (a content URI) — its `EXTRA_TEXT` form is
     * handled separately, because it names no file at all.
     */
    private fun documentUri(intent: Intent?): Uri? {
        if (intent == null) return null
        return when (intent.action) {
            DeviceFiles.ACTION_VIEW -> intent.data
            DeviceFiles.ACTION_SEND -> @Suppress("DEPRECATION") (intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)
            else -> null
        }
    }

    /**
     * Hand scripts to the page, or hold them until it exists.
     *
     * A COLD START by document is the case that matters: the app was launched
     * because of the file, so the console has not loaded yet and
     * `evaluateJavascript` would drop every script into a blank document. The
     * queue is drained on the first finished load — the same rule the desktop
     * shells apply to a launch.
     */
    private fun sendToPage(scripts: List<String>) {
        if (isFinishing || isDestroyed) return
        if (!pageReady) {
            pendingScripts.addAll(scripts)
            return
        }
        for (script in scripts) webView.evaluateJavascript(script, null)
    }

    private fun flushPendingScripts() {
        if (pendingScripts.isEmpty()) return
        val scripts = ArrayList(pendingScripts)
        pendingScripts.clear()
        for (script in scripts) {
            if (isFinishing || isDestroyed) return
            webView.evaluateJavascript(script, null)
        }
    }

    /** True once a page has finished a load, so a script has somewhere to land. */
    private var pageReady = false

    /** Scripts a document produced before the console existed. */
    private val pendingScripts = ArrayList<String>()

    /** One delivery per open, so sharing the same file twice opens two tabs. */
    private var nextDelivery = 0

    /** Reads a document off the main thread; the chunk post goes back to it. */
    private val io = Executors.newSingleThreadExecutor()

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
