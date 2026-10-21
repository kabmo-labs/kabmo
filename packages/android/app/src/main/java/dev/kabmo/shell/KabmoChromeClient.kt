package dev.kabmo.shell

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Message
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * `window.open` and the file chooser — the two WebView capabilities Kabmo uses
 * that a bare `WebChromeClient` silently drops.
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
    private val onFileChooser: (ValueCallback<Array<Uri>>) -> Unit,
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
                openExternally(request.url.toString())
                // The URL is handed to the browser, so the transport is finished:
                // keeping it alive would leak a WebView per popup.
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
        onFileChooser(filePathCallback)
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
}
