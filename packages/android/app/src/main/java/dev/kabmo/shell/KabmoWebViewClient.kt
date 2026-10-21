package dev.kabmo.shell

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Navigation policy: stay inside the server, hand everything else to the OS.
 *
 * Two behaviours here are not optional for Kabmo, and both fail silently if the
 * default client is used:
 *
 * - **`window.open` / `target="_blank"`.** The provider login dialog opens its
 *   OAuth page that way (`window.open(frame.launchUrl, '_blank')`), and the
 *   release-notes and social links in Settings do too. A WebView without an
 *   `onCreateWindow` implementation drops them: the button does nothing.
 * - **External links.** A wiki page or a chat citation pointing at another site
 *   must leave the shell, not replace Kabmo inside it — replacing it would put
 *   the user in a page with no way back except the system back button.
 */
class KabmoWebViewClient(
    private val activity: Activity,
    private val onCertificateProblem: (String) -> Unit,
    /** The main frame finished — including the error page a failed load renders. */
    private val onLoadFinished: () -> Unit = {},
    /** A main-frame resource failed; a broken image must not count. */
    private val onLoadFailed: (LoadingState.Failure) -> Unit = {},
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        val scheme = request.url.scheme?.lowercase()

        // Non-http(s) schemes are the OS's: `mailto:`, `tel:`, an app link.
        if (scheme != "http" && scheme != "https") {
            return openExternally(url)
        }

        if (KabmoWebView.isInternal(activity, url)) return false

        // An oauth callback may come back on a different origin; that still
        // belongs to the user's provider flow, so it opens in the browser too.
        return openExternally(url)
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // Cancel is the default on purpose: `--tls` is self-signed, so trusting
        // an unknown issuer silently would defeat the only encryption the user
        // asked for. The dialog names the certificate and the alternative.
        handler.cancel()
        val description = when (error.primaryError) {
            SslError.SSL_EXPIRED -> "The certificate has expired."
            SslError.SSL_IDMISMATCH -> "The certificate is for a different host name."
            SslError.SSL_UNTRUSTED -> "The certificate was not issued by a trusted authority (Kabmo's --tls mode is self-signed)."
            SslError.SSL_NOTYETVALID -> "The certificate is not valid yet."
            SslError.SSL_DATE_INVALID -> "The certificate's date is invalid."
            SslError.SSL_INVALID -> "The certificate could not be verified."
            else -> "The certificate could not be verified."
        }
        onCertificateProblem("${error.url.orEmpty()}\n$description")
    }

    override fun onPageFinished(view: WebView, url: String?) {
        super.onPageFinished(view, url)
        onLoadFinished()
    }

    /**
     * A failed load keeps the overlay up with a reason, and the main-frame test
     * is what makes it usable: a page that loads but cannot reach one of its
     * assets (a favicon, a CDN font) reports an error here too, and treating
     * that as a failed page would cover a console that is already working.
     */
    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        super.onReceivedError(view, request, error)
        if (!request.isForMainFrame) return
        onLoadFailed(LoadingState.failureFor(error.errorCode))
    }

    private fun openExternally(url: String): Boolean = try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        // Nothing can handle it. Returning true swallows the navigation, which is
        // better than replacing Kabmo with a dead link.
        true
    }
}
