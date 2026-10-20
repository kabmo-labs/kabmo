package dev.kabmo.shell

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.URLUtil

/**
 * Downloads from the editor's "Download" button.
 *
 * Kabmo serves the file from its own origin, and that origin is authenticated by
 * a `HttpOnly` session cookie — so the request has to be handed to
 * `DownloadManager` with the cookie attached. Without the `Cookie` header the
 * download arrives as the login page, which looks like a corrupt file rather
 * than an authorization failure.
 */
object KabmoDownloads {

    fun start(activity: Activity, url: String, contentDisposition: String?, mimeType: String?) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            // A blob is owned by the page's JavaScript context; DownloadManager
            // cannot fetch it. Kabmo's own download path uses http URLs, so this
            // is a guard rather than a case to handle.
            return
        }

        val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle(fileName)
            setDescription("Kabmo")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            setMimeType(mimeType ?: guessMime(fileName))

            // The session cookie lives in the WebView's cookie jar, not in the
            // DownloadManager's. `addRequestHeader`, not `setRequestHeader`:
            // DownloadManager has no setter, and an unknown name would not
            // compile.
            CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
        }

        val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        manager.enqueue(request)
    }

    private fun guessMime(fileName: String): String? =
        MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(fileName.substringAfterLast('.', "").lowercase())
}
