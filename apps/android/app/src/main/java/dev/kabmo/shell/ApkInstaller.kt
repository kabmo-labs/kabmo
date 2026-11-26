package dev.kabmo.shell

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.os.Build
import android.webkit.CookieManager
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Download an APK and hand it to the system installer as one session.
 *
 * Why this exists rather than the browser flow: `DownloadManager` writes the
 * file to Downloads and stops, leaving the user to open a file manager, find it,
 * tap it, and get through a second confirmation. That is four steps for
 * something the console already asked for by name.
 *
 * What it can NOT do, and no side-loaded app can: install silently. The system
 * owns the confirmation dialog, and this code's only lever is that it starts the
 * whole thing from one tap. Only a device-owner app or a Play-managed one
 * replaces itself without that consent.
 *
 * The verification before the session is the part that matters for safety: the
 * bytes are inspected as a package FIRST, so a file that is not this shell, or
 * is not a higher version, never reaches the installer.
 */
object ApkInstaller {

    /** The outcome, once there is one worth showing. */
    sealed interface Result {
        /** The download or the verification failed; nothing was installed. */
        data class Failed(val failure: ApkUpdate.Failure, val detail: String? = null) : Result

        /** The system dialog is up. The shell waits for the broadcast. */
        data object AwaitingConfirmation : Result

        /** The install completed; the process is about to be replaced. */
        data object Installed : Result
    }

    /** The update in flight, if any. */
    @Volatile
    private var callback: ((Result) -> Unit)? = null

    /** Whether this build may ask the system to install a package. */
    fun canInstall(activity: Activity): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.packageManager.canRequestPackageInstalls()
        } else {
            true
        }

    /**
     * Fetch `url`, verify it, and start the install session.
     *
     * The network read runs on a worker thread and reports back on the main
     * thread: every caller is an Activity callback, and a dialog touched from a
     * background thread crashes the process.
     */
    fun start(
        activity: Activity,
        url: String,
        fileName: String,
        onProgress: (Int) -> Unit,
        onResult: (Result) -> Unit,
    ) {
        callback = onResult

        if (!canInstall(activity)) {
            callback = null
            onResult(Result.Failed(ApkUpdate.Failure.NOT_PERMITTED))
            return
        }

        val directory = File(activity.cacheDir, "updates").apply { mkdirs() }
        // One update at a time, and the previous one is spent: its session was
        // committed (or abandoned) before this call, so the bytes are either
        // staged inside the installer or garbage. Leaving them would accumulate
        // a ~90 KB APK per attempt in the cache dir.
        directory.listFiles()?.forEach { it.delete() }
        val target = File(directory, fileName)
        val thread = Thread({ run(activity, url, target, onProgress) }, "kabmo-apk").apply {
            isDaemon = true
        }
        thread.start()
    }

    /**
     * Deliver a terminal status from the installer to whoever is waiting.
     *
     * Called by `InstallResultReceiver`. The receiver outlives the Activity (an
     * install can outlive the process), so a missing callback is normal and is
     * never an error.
     */
    fun deliver(status: Int, message: String?) {
        val pending = callback ?: return
        val failure = ApkUpdate.describeFailure(status)
        when {
            failure != null -> {
                callback = null
                pending(Result.Failed(failure, message))
            }

            status == PackageInstaller.STATUS_SUCCESS -> {
                callback = null
                pending(Result.Installed)
            }

            // PENDING_USER_ACTION was already handled by the receiver, which
            // launched the system dialog. Nothing to report yet.
        }
    }

    /** Clear the in-flight callback when the user walks away from the dialog. */
    fun abandon() {
        callback = null
    }

    private fun run(activity: Activity, url: String, target: File, onProgress: (Int) -> Unit) {
        val posted = { result: Result -> activity.runOnUiThread { callback?.invoke(result) } }

        try {
            fetch(activity, url, target) { percent ->
                activity.runOnUiThread { onProgress(percent) }
            }
        } catch (error: Exception) {
            posted(Result.Failed(ApkUpdate.Failure.DOWNLOAD, error.message))
            return
        }

        val archive = activity.packageManager.getPackageArchiveInfo(target.absolutePath, 0)
        if (archive == null) {
            posted(Result.Failed(ApkUpdate.Failure.NOT_A_PACKAGE))
            return
        }
        if (archive.packageName != ApkUpdate.PACKAGE_NAME) {
            posted(Result.Failed(ApkUpdate.Failure.WRONG_PACKAGE, archive.packageName))
            return
        }

        val candidate = versionCodeOf(archive)
        val installed = versionCodeOf(activity.packageManager.getPackageInfo(activity.packageName, 0))
        if (!ApkUpdate.isUpgrade(candidate, installed)) {
            posted(Result.Failed(ApkUpdate.Failure.NOT_AN_UPGRADE, "$candidate <= $installed"))
            return
        }

        try {
            commit(activity, target)
        } catch (error: Exception) {
            posted(Result.Failed(ApkUpdate.Failure.SESSION, error.message))
            return
        } finally {
            // The session copied the bytes into its own staging area during
            // `openWrite`/`commit`, so the download is spent either way. Keeping
            // it would leave a ~90 KB APK per attempt in the cache dir until the
            // next update pruned it.
            target.delete()
        }
        posted(Result.AwaitingConfirmation)
    }

    private fun fetch(activity: Activity, url: String, target: File, onProgress: (Int) -> Unit) {
        var connection: HttpURLConnection? = null
        try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                instanceFollowRedirects = true
                // GitHub serves the asset through a redirect chain and rejects a
                // request with no User-Agent.
                setRequestProperty("User-Agent", "KabmoShell/${BuildConfig.VERSION_NAME}")
                // A Kabmo-served APK sits behind the session cookie; a GitHub
                // asset ignores it. Attaching it costs nothing and is the only
                // way a self-hosted build can be fetched.
                CookieManager.getInstance().getCookie(url)?.let { setRequestProperty("Cookie", it) }
            }

            val status = connection.responseCode
            if (status !in 200..299) throw IllegalStateException("HTTP $status")

            val total = connection.contentLengthLong
            target.outputStream().use { output ->
                connection.inputStream.use { input ->
                    val buffer = ByteArray(BUFFER_BYTES)
                    var copied = 0L
                    var reported = -1
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        copied += read
                        if (total > 0) {
                            val percent = ((copied * 100) / total).toInt()
                            if (percent != reported) {
                                reported = percent
                                onProgress(percent)
                            }
                        }
                    }
                }
            }

            // A truncated body fails at the installer with a status that says
            // "invalid", which reads as a corrupt build rather than a bad
            // connection. The size is the only check available before parsing.
            if (total > 0 && target.length() != total) {
                throw IllegalStateException("expected $total bytes, got ${target.length()}")
            }
        } finally {
            connection?.disconnect()
        }
    }

    private fun commit(activity: Activity, apk: File) {
        val installer = activity.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ApkUpdate.PACKAGE_NAME)
            setSize(apk.length())
        }

        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("kabmo.apk", 0, apk.length()).use { output ->
                apk.inputStream().use { input -> input.copyTo(output) }
                session.fsync(output)
            }
            // MUTABLE is required, not a preference: the installer writes the
            // confirmation Intent into EXTRA_INTENT of the intent this
            // PendingIntent wraps, and an immutable one cannot be written to.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            val intent = Intent(activity, InstallResultReceiver::class.java)
                .setAction(ApkUpdate.ACTION_INSTALL_STATUS)
            session.commit(PendingIntent.getBroadcast(activity, sessionId, intent, flags).intentSender)
        }
    }

    private fun versionCodeOf(info: PackageInfo): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode.toInt()
        } else {
            @Suppress("DEPRECATION")
            info.versionCode
        }

    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val BUFFER_BYTES = 64 * 1024
}
