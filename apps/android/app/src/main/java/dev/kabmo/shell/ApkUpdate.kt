package dev.kabmo.shell

import android.content.pm.PackageInstaller

/**
 * The decisions an in-app APK update makes, as pure values.
 *
 * Kept out of `ApkInstaller` for the reason `LoadingState` is out of
 * `LoadingOverlay`: every rule below fails SILENTLY in a real install — a wrong
 * URL test downloads the console's own page, a wrong package test replaces the
 * app with whatever the link served, a wrong status test reports a finished
 * install as a failure — and a JVM test can pin all of them without an
 * emulator.
 *
 * `PackageInstaller.STATUS_*` are compile-time constants, so nothing here calls
 * into the Android framework and the test runs on the plain JVM.
 */
object ApkUpdate {

    /**
     * The only package this shell may install.
     *
     * The link the console offers points at Kabmo's own release, but the page is
     * a web page: a compromised console, a stale bookmark to another project's
     * release, or a hand-copied URL could name anything. The downloaded file is
     * inspected with `getPackageArchiveInfo` before a single byte reaches the
     * installer session, and this is what it is compared against.
     */
    const val PACKAGE_NAME = "dev.kabmo.shell"

    /** The MIME type Android assigns to an APK. */
    const val APK_MIME = "application/vnd.android.package-archive"

    /** The cache file an update is downloaded to, relative to the cache dir. */
    const val DEFAULT_FILE_NAME = "kabmo-update.apk"

    /** The action the installer's `PendingIntent` is sent with. */
    const val ACTION_INSTALL_STATUS = "dev.kabmo.shell.INSTALL_STATUS"

    /**
     * Whether a download is an APK the shell should install itself.
     *
     * Three signals, because they arrive from three different places and any one
     * of them can be the only one present: the URL's path (`…v0.4.0.apk`, what
     * the console's own link carries), the response's `Content-Type` (what a
     * server that hides the extension sends), and the `Content-Disposition`
     * filename (what GitHub sends on a release asset).
     *
     * The query string is stripped before the extension test — a signed URL ends
     * `…apk?X-Amz-Signature=…`, and testing the raw string would refuse every
     * such download.
     */
    fun isApkDownload(url: String, contentDisposition: String?, mimeType: String?): Boolean {
        if (mimeType?.trim()?.equals(APK_MIME, ignoreCase = true) == true) return true
        // Only a disposition that actually NAMES a file counts: `fileNameFrom`
        // falls back to a default name, and asking it here would answer "yes"
        // for every download that carries no disposition at all.
        if (namedIn(contentDisposition)?.endsWith(".apk", ignoreCase = true) == true) return true
        return pathOf(url).endsWith(".apk", ignoreCase = true)
    }

    /**
     * The file name a download should be stored under.
     *
     * `Content-Disposition` wins when it names one, because that is the name the
     * server chose; the URL's last path segment is the fallback. The result is
     * never blank: the cache file needs a name, and the session write needs a
     * non-empty one.
     */
    fun fileNameFrom(contentDisposition: String?, url: String? = null): String {
        val named = namedIn(contentDisposition)
        if (named != null) return sanitize(named).ifEmpty { DEFAULT_FILE_NAME }

        val last = pathOf(url.orEmpty()).substringAfterLast('/')
        return sanitize(last).ifEmpty { DEFAULT_FILE_NAME }
    }

    /**
     * Whether `candidate` is an install Android would accept over `installed`.
     *
     * Strictly greater, because that is Android's own rule: an equal code is
     * refused with `INSTALL_FAILED_VERSION_DOWNGRADE` (measured on an emulator),
     * and offering the dialog for it would end in an error after the download.
     * A non-positive candidate is not a version at all — it is what a failed
     * `getPackageArchiveInfo` reports.
     */
    fun isUpgrade(candidate: Int, installed: Int): Boolean = candidate > installed && candidate > 0

    /**
     * The failure a terminal `PackageInstaller` status names, or null when there
     * is nothing to report.
     *
     * `STATUS_SUCCESS` and `STATUS_PENDING_USER_ACTION` are both "carry on": the
     * first is finished, the second is the system's own confirmation dialog,
     * which the receiver launches rather than describing.
     */
    fun describeFailure(status: Int): Failure? = when (status) {
        PackageInstaller.STATUS_SUCCESS,
        PackageInstaller.STATUS_PENDING_USER_ACTION,
        -> null

        PackageInstaller.STATUS_FAILURE_ABORTED -> Failure.ABORTED
        PackageInstaller.STATUS_FAILURE_BLOCKED -> Failure.BLOCKED
        PackageInstaller.STATUS_FAILURE_CONFLICT -> Failure.CONFLICT
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> Failure.INCOMPATIBLE
        PackageInstaller.STATUS_FAILURE_INVALID -> Failure.INVALID
        PackageInstaller.STATUS_FAILURE_STORAGE -> Failure.STORAGE
        else -> Failure.OTHER
    }

    /**
     * Every way an update can fail, in one vocabulary.
     *
     * One enum rather than one per layer: the dialog renders one sentence per
     * case, and two vocabularies would mean two mappings that can disagree about
     * what `INVALID` means depending on which side produced it.
     */
    enum class Failure {
        /** The bytes could not be fetched. */
        DOWNLOAD,

        /** The downloaded file is not a readable APK. */
        NOT_A_PACKAGE,

        /** The APK belongs to a different application. */
        WRONG_PACKAGE,

        /**
         * The APK is not newer than what is installed.
         *
         * Android refuses this itself with `INSTALL_FAILED_VERSION_DOWNGRADE`;
         * catching it here means the user is told before the dialog rather than
         * after it.
         */
        NOT_AN_UPGRADE,

        /** "Install unknown apps" is off for this shell. */
        NOT_PERMITTED,

        /** The installer session could not be created or written. */
        SESSION,

        /** The user dismissed the system dialog, or the session was abandoned. */
        ABORTED,

        /**
         * The install was refused by policy — most often "install unknown apps"
         * is off, which the shell's own settings screen can fix.
         */
        BLOCKED,

        /**
         * A package with the same name exists under a DIFFERENT signing key.
         *
         * This is the failure this whole feature exists to stop producing: it is
         * what an APK signed with a per-build debug key produces on every
         * update, and no amount of retrying fixes it.
         */
        CONFLICT,

        /** The APK is for a different Android version or ABI. */
        INCOMPATIBLE,

        /** The APK is corrupt or unreadable. */
        INVALID,

        /** Not enough space for the new build beside the old one. */
        STORAGE,

        OTHER,
    }

    /** The file name a `Content-Disposition` header names, or null. */
    private fun namedIn(contentDisposition: String?): String? {
        val disposition = contentDisposition.orEmpty()
        if (disposition.isEmpty()) return null
        // Both spellings: `filename*=UTF-8''…` is RFC 5987 and GitHub sends the
        // plain one, but a self-hosted mirror may send either.
        val match = Regex("""filename\*?=(?:UTF-8'')?"?([^";]+)"?""", RegexOption.IGNORE_CASE)
            .find(disposition)
        return match?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
    }

    /** A path segment safe to use as a cache file name. */
    private fun sanitize(name: String): String =
        name.replace(Regex("""[^A-Za-z0-9._-]"""), "_").trim('_', '.')

    /** The URL's path, without scheme, host, query or fragment. */
    private fun pathOf(url: String): String {
        val withoutQuery = url.substringBefore('#').substringBefore('?')
        val afterScheme = if (withoutQuery.contains("://")) withoutQuery.substringAfter("://") else withoutQuery
        val slash = afterScheme.indexOf('/')
        return if (slash >= 0) afterScheme.substring(slash) else ""
    }
}
