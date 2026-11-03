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
 *
 * The decision itself is `NavigationPolicy`'s (pure, JVM-tested). The rule that
 * bug it fixes: this callback is documented as also firing for SUBFRAMES, and
 * answering one like a main-frame link sent every page typed into the console's
 * own browser panel (`components/workspace/user-browser-panel/`) to the system
 * browser instead of the panel.
 */
class KabmoWebViewClient(
    private val activity: Activity,
    private val onCertificateProblem: (String) -> Unit,
    /** The main frame finished — including the error page a failed load renders. */
    private val onLoadFinished: () -> Unit = {},
    /** A main-frame resource failed; a broken image must not count. */
    private val onLoadFailed: (LoadingState.Failure) -> Unit = {},
    /**
     * A document load started, with the url it started at and the one on screen.
     *
     * Both are passed because the only signal a reload gives is that the two are
     * equal — see `LoadingState.isDocumentReload`.
     */
    private val onLoadStarted: (startedUrl: String?, shownUrl: String?) -> Unit = { _, _ -> },
) : WebViewClient() {

    /**
     * The address the WebView is showing, latched by `onPageFinished`.
     *
     * `view.url` is the document being LOADED, not the one on screen, so it
     * cannot answer "was this the same page?" — that answer has to be recorded
     * when a load completes, before the next one starts.
     */
    private var shownUrl: String? = null

    override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        super.onPageStarted(view, url, favicon)
        // Reported, not decided: whether this is a reload is the state machine's
        // call (`LoadingState.isDocumentReload`), and it needs the phase.
        onLoadStarted(url, shownUrl)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        val action = NavigationPolicy.decide(
            // Android documents this callback as "may be called for subframes", and
            // it is: the browser panel's own iframe arrives here.
            isForMainFrame = request.isForMainFrame,
            isInternal = KabmoWebView.isInternal(activity, url),
            isApkDownload = ApkUpdate.isApkDownload(url, null, null),
            scheme = request.url.scheme,
        )
        return when (action) {
            // Load it here: the frame keeps its page (ALLOW), and that includes
            // every same-origin route of the console itself.
            NavigationPolicy.Action.ALLOW -> false
            NavigationPolicy.Action.EXTERNAL -> openExternally(url)
            NavigationPolicy.Action.APK_DOWNLOAD -> {
                // The shell installs it rather than sending the user to a
                // Downloads folder to find the file and tap it there.
                UpdateFlow.start(activity, UpdateFlow.Download(url, ApkUpdate.fileNameFrom(null, url)))
                true
            }
        }
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
        // Latched HERE, not read from `view.url` later: by the time the next
        // `onPageStarted` arrives the view already points at the incoming
        // document, so the comparison would match every navigation.
        shownUrl = url
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
