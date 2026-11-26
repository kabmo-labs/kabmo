package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app-update rules, pinned on the JVM.
 *
 * Every case here is a silent failure on a real device: a comparison that treats
 * `0.6.0` as older than `0.5.9` hides an update forever, a failed probe read as
 * "current" is the silence this whole feature exists to end, and an offered build
 * Android then refuses fails after a full download.
 */
class AppReleaseTest {

    // -- isNewer -------------------------------------------------------------

    @Test
    fun aHigherPatchIsNewer() {
        // The reported case: an installed 0.5.0 against a published 0.6.0.
        assertTrue(AppRelease.isNewer("0.6.0", "0.5.0"))
        assertTrue(AppRelease.isNewer("0.5.10", "0.5.9"))
    }

    @Test
    fun theSameVersionIsNotNewer() {
        assertFalse(AppRelease.isNewer("0.6.0", "0.6.0"))
        assertFalse(AppRelease.isNewer("0.6", "0.6.0"))
        assertFalse(AppRelease.isNewer("v0.6.0", "0.6.0"))
    }

    @Test
    fun anOlderBuildIsNotAnUpdate() {
        // A sideloaded build ahead of the published one: offering it would be a
        // downgrade, which Android refuses with INSTALL_FAILED_VERSION_DOWNGRADE.
        assertFalse(AppRelease.isNewer("0.5.0", "0.6.0"))
    }

    @Test
    fun aMissingSegmentCountsAsZero() {
        assertTrue(AppRelease.isNewer("0.6.1", "0.6"))
        assertFalse(AppRelease.isNewer("0.6", "0.6.1"))
    }

    @Test
    fun aPrereleaseComparesOnItsNumericCore() {
        // The same rule the console's semver uses (`toSegments` drops everything
        // after `-`), so the two cannot disagree about whether an update exists.
        // It means a published `0.6.0` and an installed `0.6.0-beta.1` are the
        // SAME build to this comparison — deliberately: the console would offer
        // nothing either, and offering a build Android then refuses is worse.
        assertEquals(AppRelease.segments("0.6.0-beta.1"), AppRelease.segments("0.6.0"))
        assertFalse(AppRelease.isNewer("0.6.0-beta.1", "0.6.0"))
        assertTrue(AppRelease.isNewer("0.6.1-beta.1", "0.6.0"))
    }

    @Test
    fun aNonNumericSegmentCountsAsZeroRatherThanThrowing() {
        assertEquals(listOf(1, 2, 0), AppRelease.segments("1.2.x"))
        assertTrue(AppRelease.isNewer("1.2.1", "1.2.x"))
    }

    // -- decide --------------------------------------------------------------

    @Test
    fun aNewerReleaseIsOffered() {
        val release = AppRelease.Release("https://x/Kabmo-0.6.0-android.apk", "0.6.0", "https://x/r")
        assertEquals(AppRelease.Result.Available(release, "0.5.0"), AppRelease.decide(release, "0.5.0"))
    }

    @Test
    fun theInstalledBuildIsReportedAsCurrent() {
        val release = AppRelease.Release("https://x/a.apk", "0.6.0", null)
        assertEquals(AppRelease.Result.Current("0.6.0", "0.6.0"), AppRelease.decide(release, "0.6.0"))
    }

    @Test
    fun aFailedProbeIsAFailureAndNeverCurrent() {
        // The console answers `{url: null, latest: null}` when it could not reach
        // GitHub. Reading that as "up to date" is exactly the silence that made
        // the reported APK look updated while it was two versions behind.
        assertEquals(AppRelease.Result.Failed(null), AppRelease.decide(null, "0.5.0"))
    }

    // -- urlFor --------------------------------------------------------------

    @Test
    fun buildsTheConsoleUrlFromTheSavedOrigin() {
        assertEquals("http://192.168.1.20:3000/api/updates/android", AppRelease.urlFor("http://192.168.1.20:3000"))
        assertEquals("https://kabmo.test/api/updates/android", AppRelease.urlFor("https://kabmo.test/"))
        assertEquals("https://kabmo.test/api/updates/android", AppRelease.urlFor("  https://kabmo.test  "))
    }

    @Test
    fun thePathIsTheAndroidRoute() {
        assertEquals("/api/updates/android", AppRelease.PATH)
    }
}
