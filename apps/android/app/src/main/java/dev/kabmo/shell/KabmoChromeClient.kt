package dev.kabmo.shell

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.Manifest
import android.net.Uri
import android.os.Message
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * `getUserMedia`, `window.open` and the file chooser — the three WebView
 * capabilities Kabmo uses that a bare `WebChromeClient` silently drops.
 *
 * **`onPermissionRequest`** is how the microphone opens at all: the default
 * implementation DENIES, which is why composer dictation did nothing on Android
 * even after the origin became a secure context, and why the pairing camera
 * could not open. It is only half of it — the app also has to declare
 * `RECORD_AUDIO` (plus `MODIFY_AUDIO_SETTINGS`, which Chromium's audio path
 * needs and nothing in this source tree references; see
 * `AndroidManifest.xml`). `ManifestCapturePermissionsTest` pins the pair.
 *
 * **`onCreateWindow`** is what makes `window.open(url, '_blank')` work. Kabmo's
 * provider login does exactly that (`LoginModal`), so without it the OAuth page
 * never appears and the login button looks broken. The URL opens in the system
 * browser rather than a second WebView: an OAuth flow ends on the provider's
 * site, and the flow's own redirect is what brings the user back.
 *
 * **`onShowFileChooser`** is the attach button in the composer. The Activity
 * owns the picker and the result plumbing, because only it can receive
 * `onActivityResult`.
 */
class KabmoChromeClient(
    private val activity: Activity,
    private val onFileChooser: (ValueCallback<Array<Uri>>, FileChooserParams) -> Unit,
    /** The main document's own progress, 0–100. */
    private val onProgress: (Int) -> Unit = {},
) : WebChromeClient() {

    /**
     * Popup transports are held here, not only referenced by the message.
     *
     * The WebView handed to the opener is created in this call and referenced
     * nowhere else until the opener loads it; a local would be collected before
     * that happens and the popup would silently never open (measured pattern in
     * every `onCreateWindow` example that omits the list).
     */
    private val popups = mutableListOf<WebView>()

    /**
     * The capture request waiting on the platform prompt.
     *
     * `onPermissionRequest` must answer synchronously, but the runtime grant is
     * asynchronous — so the request is held here and answered from
     * `onCapturePermissionResult`, which the Activity calls when the dialog
     * closes. A second request while one is pending denies the older one: two
     * live `PermissionRequest` objects for one camera is a leak, and the page
     * only ever has one capture in flight.
     */
    private var pending: PermissionRequest? = null

    /**
     * `getUserMedia` from the page.
     *
     * The default implementation DENIES, which is why dictation did nothing on
     * Android even after the origin became a secure context, and why the pairing
     * camera could not open. Both are granted now, and only those two: a page
     * asking for anything else is refused rather than handed a capability this
     * app has no feature for.
     *
     * The page still needs a SECURE ORIGIN for `getUserMedia` to exist at all —
     * over `http://192.168.x.x` the API is undefined and this callback is never
     * reached. That is the platform's rule, not this shell's.
     */
    override fun onPermissionRequest(request: PermissionRequest) {
        val wanted = request.resources.filter { permissionFor(it) != null }
        if (wanted.isEmpty()) {
            request.deny()
            return
        }

        val missing = wanted
            .mapNotNull { permissionFor(it) }
            .filter { activity.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            .distinct()
        if (missing.isEmpty()) {
            request.grant(wanted.toTypedArray())
            return
        }

        pending?.deny()
        pending = request
        activity.requestPermissions(missing.toTypedArray(), REQUEST_CAPTURE)
    }

    /** Answer the held request once the platform prompt has been answered. */
    fun onCapturePermissionResult(granted: Set<String>) {
        val request = pending ?: return
        pending = null
        val allowed = request.resources.filter { resource ->
            val permission = permissionFor(resource)
            permission == null || permission in granted
        }
        if (allowed.isEmpty()) request.deny() else request.grant(allowed.toTypedArray())
    }

    /** The platform permission a WebView capture resource needs, or null. */
    private fun permissionFor(resource: String): String? = when (resource) {
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
        else -> null
    }

    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        val transport = WebView(view.context)
        transport.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                popup: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val url = request.url.toString()
                // An APK link is the ONE popup the shell finishes itself, and
                // this is the path it actually takes: the sidebar's update
                // control is an `<a target="_blank">`, so the click arrives HERE
                // rather than at the download listener — and handing it to the
                // browser (the previous behaviour) sent the user to Downloads to
                // find the file, tap it, and get through the same system dialog
                // three steps later.
                if (ApkUpdate.isApkDownload(url, null, null)) {
                    UpdateFlow.start(
                        activity,
                        UpdateFlow.Download(url, ApkUpdate.fileNameFrom(null, url)),
                    )
                } else {
                    openExternally(url)
                }
                // The URL is handed on, so the transport is finished: keeping it
                // alive would leak a WebView per popup.
                popup.destroy()
                popups.remove(popup)
                return true
            }
        }
        transport.webChromeClient = object : WebChromeClient() {
            override fun onCloseWindow(window: WebView) {
                window.destroy()
                popups.remove(window)
            }
        }
        popups.add(transport)

        val webViewTransport = resultMsg.obj as? WebView.WebViewTransport
            ?: return false
        webViewTransport.webView = transport
        resultMsg.sendToTarget()
        return true
    }

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        super.onProgressChanged(view, newProgress)
        onProgress(newProgress)
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean {
        // The PARAMS travel: they carry the control's `accept` list and whether
        // it takes several files, which is what the picker must be opened with.
        // Dropping them opened every picker as `*/*` with multi-select.
        onFileChooser(filePathCallback, fileChooserParams)
        return true
    }

    private fun openExternally(url: String) {
        try {
            activity.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: Exception) {
            // No browser installed: nothing to do, and returning false here
            // would make the WebView try to render the URL itself.
        }
    }

    companion object {
        /** The capture prompt's request code, answered by `MainActivity`. */
        const val REQUEST_CAPTURE = 0x4b43
    }
}
