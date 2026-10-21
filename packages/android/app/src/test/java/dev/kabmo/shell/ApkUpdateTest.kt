package dev.kabmo.shell

import android.content.pm.PackageInstaller
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The update rules, pinned on the JVM.
 *
 * Every one of these is a silent failure in a real install: a wrong download
 * test either refuses the console's own APK link or hands a random file to the
 * installer, a wrong version test shows the system dialog only for it to refuse
 * the install, and a wrong status test reports a finished install as a failure.
 */
class ApkUpdateTest {

    // -- isApkDownload -------------------------------------------------------

    @Test
    fun recognisesTheConsolesOwnLink() {
        // The shape the sidebar's "Update APK" anchor carries.
        assertTrue(
            ApkUpdate.isApkDownload(
                "https://github.com/kabmo-labs/kabmo/releases/download/v0.4.0/kabmo-android-v0.4.0.apk",
                null,
                null,
            ),
        )
    }

    @Test
    fun ignoresTheQueryString() {
        // A signed asset URL ends `…apk?X-Amz-Signature=…`; testing the raw
        // string would refuse every one of them.
        assertTrue(
            ApkUpdate.isApkDownload(
                "https://example.test/kabmo-android-v0.4.0.apk?X-Amz-Signature=abc123",
                null,
                null,
            ),
        )
    }

    @Test
    fun acceptsAMimeTypeWithNoExtension() {
        // A server that serves the bytes from an opaque route.
        assertTrue(ApkUpdate.isApkDownload("https://example.test/download/7", null, ApkUpdate.APK_MIME))
        assertTrue(
            ApkUpdate.isApkDownload("https://example.test/download/7", null, " Application/Vnd.Android.Package-Archive "),
        )
    }

    @Test
    fun acceptsADispositionFilename() {
        assertTrue(
            ApkUpdate.isApkDownload(
                "https://example.test/download/7",
                "attachment; filename=kabmo-android-v0.4.0.apk",
                "application/octet-stream",
            ),
        )
    }

    @Test
    fun leavesOrdinaryDownloadsAlone() {
        // The editor's Download button. Treating one of these as an APK would
        // hand a source file to the installer.
        assertFalse(ApkUpdate.isApkDownload("https://example.test/api/fs/raw?path=src/a.ts", null, "text/plain"))
        assertFalse(
            ApkUpdate.isApkDownload(
                "https://example.test/api/fs/raw?path=src/a.ts",
                "attachment; filename=\"a.ts\"",
                null,
            ),
        )
        // An APK-named URL with no extension is still a path, not a package.
        assertFalse(ApkUpdate.isApkDownload("https://example.test/apk", null, null))
    }

    @Test
    fun doesNotTreatAnEmptyDispositionAsAName() {
        // `fileNameFrom` falls back to a default name, so asking it here would
        // answer "yes" for every download that carries no disposition at all.
        assertFalse(ApkUpdate.isApkDownload("https://example.test/file.bin", "", null))
        assertFalse(ApkUpdate.isApkDownload("https://example.test/file.bin", "attachment", null))
    }

    // -- fileNameFrom --------------------------------------------------------

    @Test
    fun prefersTheDispositionName() {
        assertEquals(
            "kabmo-android-v0.4.0.apk",
            ApkUpdate.fileNameFrom(
                "attachment; filename=kabmo-android-v0.4.0.apk",
                "https://example.test/download/7",
            ),
        )
        assertEquals(
            "kabmo-android-v0.4.0.apk",
            ApkUpdate.fileNameFrom("attachment; filename=\"kabmo-android-v0.4.0.apk\""),
        )
        // RFC 5987 spelling, which a self-hosted mirror may send.
        assertEquals(
            "kabmo-android-v0.4.0.apk",
            ApkUpdate.fileNameFrom("attachment; filename*=UTF-8''kabmo-android-v0.4.0.apk"),
        )
    }

    @Test
    fun fallsBackToTheUrlSegment() {
        assertEquals(
            "kabmo-android-v0.4.0.apk",
            ApkUpdate.fileNameFrom(null, "https://example.test/releases/v0.4.0/kabmo-android-v0.4.0.apk?x=1"),
        )
    }

    @Test
    fun neverReturnsABlankName() {
        // The cache file and the installer session both need a non-empty name.
        assertEquals(ApkUpdate.DEFAULT_FILE_NAME, ApkUpdate.fileNameFrom(null, null))
        assertEquals(ApkUpdate.DEFAULT_FILE_NAME, ApkUpdate.fileNameFrom("", "https://example.test/"))
        assertEquals(ApkUpdate.DEFAULT_FILE_NAME, ApkUpdate.fileNameFrom(null, "https://example.test"))
        assertEquals(ApkUpdate.DEFAULT_FILE_NAME, ApkUpdate.fileNameFrom("attachment; filename=\"...\""))
    }

    @Test
    fun sanitisesTheNameIntoOnePathSegment() {
        // A name is used as a file name under the cache dir; a separator or a
        // traversal would write outside it. The leading separators are trimmed
        // rather than replaced, so the result has no path of its own at all.
        assertEquals("etc_passwd.apk", ApkUpdate.fileNameFrom("attachment; filename=../../etc/passwd.apk"))
        assertEquals("kabmo_update.apk", ApkUpdate.fileNameFrom("attachment; filename=kabmo update.apk"))
    }

    // -- isUpgrade -----------------------------------------------------------

    @Test
    fun requiresAStrictlyHigherVersionCode() {
        assertTrue(ApkUpdate.isUpgrade(17, 16))
        // Android refuses an equal code with INSTALL_FAILED_VERSION_DOWNGRADE
        // (measured on an emulator), so the dialog must not be offered for it.
        assertFalse(ApkUpdate.isUpgrade(16, 16))
        assertFalse(ApkUpdate.isUpgrade(15, 16))
    }

    @Test
    fun rejectsAnUnreadableVersion() {
        // What a failed `getPackageArchiveInfo` reports.
        assertFalse(ApkUpdate.isUpgrade(0, 0))
        assertFalse(ApkUpdate.isUpgrade(-1, 0))
    }

    // -- describeFailure -----------------------------------------------------

    @Test
    fun saysNothingForTheTwoCarryOnStatuses() {
        // SUCCESS is finished and PENDING_USER_ACTION is the system dialog; both
        // are handled by the receiver, not reported as an outcome.
        assertNull(ApkUpdate.describeFailure(PackageInstaller.STATUS_SUCCESS))
        assertNull(ApkUpdate.describeFailure(PackageInstaller.STATUS_PENDING_USER_ACTION))
    }

    @Test
    fun namesTheConflictThatThisFeatureExistsToStop() {
        // A package under a different signing key. This is the failure a
        // per-build debug key produced on EVERY update.
        assertEquals(
            ApkUpdate.Failure.CONFLICT,
            ApkUpdate.describeFailure(PackageInstaller.STATUS_FAILURE_CONFLICT),
        )
    }

    @Test
    fun mapsEveryTerminalStatus() {
        assertEquals(
            ApkUpdate.Failure.ABORTED,
            ApkUpdate.describeFailure(PackageInstaller.STATUS_FAILURE_ABORTED),
        )
        assertEquals(
            ApkUpdate.Failure.BLOCKED,
            ApkUpdate.describeFailure(PackageInstaller.STATUS_FAILURE_BLOCKED),
        )
        assertEquals(
            ApkUpdate.Failure.INCOMPATIBLE,
            ApkUpdate.describeFailure(PackageInstaller.STATUS_FAILURE_INCOMPATIBLE),
        )
        assertEquals(
            ApkUpdate.Failure.INVALID,
            ApkUpdate.describeFailure(PackageInstaller.STATUS_FAILURE_INVALID),
        )
        assertEquals(
            ApkUpdate.Failure.STORAGE,
            ApkUpdate.describeFailure(PackageInstaller.STATUS_FAILURE_STORAGE),
        )
        // An unknown code must still be reportable rather than silently dropped.
        assertEquals(ApkUpdate.Failure.OTHER, ApkUpdate.describeFailure(Int.MIN_VALUE))
    }

    @Test
    fun everyFailureHasASentence() {
        // The dialog renders one string per case; a new enum row with no string
        // would crash at the moment it is needed most.
        val ids = ApkUpdate.Failure.entries.map { UpdateFlow.messageFor(it) }
        assertEquals(ApkUpdate.Failure.entries.size, ids.size)
        assertTrue(ids.all { it != 0 })
        assertEquals("every failure must name its own sentence", ids.size, ids.toSet().size)
    }
}
