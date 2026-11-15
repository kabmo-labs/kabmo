package dev.kabmo.shell

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * The shell's own QR scanner: a camera preview in a web view, decoded by the same
 * `jsQR` the console uses.
 *
 * **Why a web view and not Camera2 + ZXing.** The app is a web-view shell, and the
 * decoder that already exists and is already tested is `jsQR`. A native scanner
 * would be a second decoder — a dependency (ZXing core, ~500 KB before R8) and a
 * second opinion about what a valid code is. The camera PERMISSION is still
 * native: this Activity grants `RESOURCE_VIDEO_CAPTURE` and the page only asks.
 *
 * **The base URL is `https://kabmo.local/`, and that is load-bearing.**
 * `getUserMedia` needs a secure context, and a document loaded from `file://` or
 * `about:blank` has an opaque origin that is not one — the page would report
 * "this device does not offer a camera" on a phone with a perfectly good camera.
 * `loadDataWithBaseURL` with an https base gives the document that origin without
 * a server behind it.
 *
 * The result is the decoded TEXT, not a parsed payload: the caller already has
 * `PairingLink.originOf`, and a second parser here would be a second place for the
 * link format to drift.
 */
class QrScannerActivity : Activity() {

    private lateinit var webView: WebView
    private var pending: PermissionRequest? = null
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.setBackgroundColor(android.graphics.Color.parseColor("#141310"))
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsVideo = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                if (!wantsVideo) {
                    request.deny()
                    return
                }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    return
                }
                pending?.deny()
                pending = request
                requestPermissions(arrayOf(Manifest.permission.CAMERA), REQUEST_CAMERA)
            }
        }
        webView.addJavascriptInterface(Bridge(), "KabmoQr")

        setContentView(webView)

        val html = assets.open("qr-scanner.html").bufferedReader().use { it.readText() }
        // See the class comment: the https base is what makes the page a secure
        // context, and therefore what makes `getUserMedia` exist at all.
        webView.loadDataWithBaseURL("https://kabmo.local/", html, "text/html", "utf-8", null)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_CAMERA) return
        val request = pending ?: return
        pending = null
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
    }

    @Deprecated("Deprecated in the platform, still the only callback path below API 33")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_IMAGE) return
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return
        val bytes = try {
            contentResolver.openInputStream(uri)?.use { it.readBytes() }
        } catch (_: Exception) {
            null
        }
        if (bytes == null) {
            webView.evaluateJavascript(
                "window.__kabmoQrImage && window.__kabmoQrImage('')",
                null,
            )
            return
        }
        val encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        val mime = contentResolver.getType(uri) ?: "image/png"
        // The data URL is built here rather than in the page: the page never sees
        // a file path, and the bytes never leave the app.
        webView.evaluateJavascript(
            "window.__kabmoQrImage && window.__kabmoQrImage('data:$mime;base64,$encoded')",
            null,
        )
    }

    override fun onPause() {
        // A backgrounded web view keeps the camera light on: the page's own
        // `pagehide` does not fire for a paused Activity.
        webView.evaluateJavascript("window.dispatchEvent(new Event('pagehide'))", null)
        super.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /**
     * The page's callbacks, on the JS bridge thread.
     *
     * `pickImage` exists because the page must not open a file chooser itself: a
     * WebView file chooser is a second permission path (`onShowFileChooser` plus
     * an Activity result) for something the shell already has. The host picks the
     * file and hands the page a data URL, which the page decodes with the same
     * decoder the camera uses.
     */
    private inner class Bridge {
        @JavascriptInterface
        fun pickImage() {
            runOnUiThread {
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*" }
                try {
                    startActivityForResult(intent, REQUEST_IMAGE)
                } catch (_: Exception) {
                    // No picker on this device: the page's own sentence covers it.
                }
            }
        }

        @JavascriptInterface
        fun result(text: String) {
            if (finished) return
            finished = true
            runOnUiThread {
                setResult(RESULT_OK, Intent().putExtra(EXTRA_LINK, text))
                finish()
            }
        }

        @JavascriptInterface
        fun error(message: String) {
            // The page has already drawn the sentence; the shell only needs to
            // know the scan did not produce a code, so the caller can stay put.
            if (finished) return
            finished = true
            runOnUiThread {
                setResult(RESULT_CANCELED, Intent().putExtra(EXTRA_ERROR, message))
                finish()
            }
        }
    }

    companion object {
        const val EXTRA_LINK = "dev.kabmo.shell.QR_LINK"
        const val EXTRA_ERROR = "dev.kabmo.shell.QR_ERROR"
        private const val REQUEST_CAMERA = 0x4b44
        private const val REQUEST_IMAGE = 0x4b46
    }
}
