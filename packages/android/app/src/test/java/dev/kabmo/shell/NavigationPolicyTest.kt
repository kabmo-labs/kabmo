package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The navigation table, pinned without a device.
 *
 * Every case here fails SILENTLY in the app: a page simply appears somewhere
 * else, with nothing logged and nothing thrown. The one a user reported was the
 * first group — the console's own browser panel is an `<iframe>`, and answering
 * a subframe load like a main-frame link sent every typed URL to the system
 * browser instead of the panel.
 *
 * The table is the same one `packages/macos` and `packages/linux` carry, and the
 * cases here are its Android half.
 */
class NavigationPolicyTest {

    private fun decide(
        isForMainFrame: Boolean,
        isInternal: Boolean = false,
        isApkDownload: Boolean = false,
        scheme: String? = "https",
    ) = NavigationPolicy.decide(isForMainFrame, isInternal, isApkDownload, scheme)

    @Test
    fun `a frame never leaves, whatever it is loading`() {
        assertEquals(NavigationPolicy.Action.ALLOW, decide(isForMainFrame = false))
        assertEquals(
            NavigationPolicy.Action.ALLOW,
            decide(isForMainFrame = false, scheme = "mailto"),
        )
        assertEquals(
            NavigationPolicy.Action.ALLOW,
            decide(isForMainFrame = false, isApkDownload = true, scheme = "http"),
        )
    }

    @Test
    fun `a same-origin main-frame navigation is the console's own routing`() {
        assertEquals(
            NavigationPolicy.Action.ALLOW,
            decide(isForMainFrame = true, isInternal = true),
        )
    }

    @Test
    fun `another origin leaves for the system browser`() {
        assertEquals(
            NavigationPolicy.Action.EXTERNAL,
            decide(isForMainFrame = true, isInternal = false),
        )
    }

    @Test
    fun `a scheme with no page behind it is the OS's`() {
        assertEquals(NavigationPolicy.Action.EXTERNAL, decide(true, scheme = "mailto"))
        assertEquals(NavigationPolicy.Action.EXTERNAL, decide(true, scheme = "tel"))
        assertEquals(NavigationPolicy.Action.EXTERNAL, decide(true, scheme = null))
    }

    @Test
    fun `the console's update offer is finished by the shell`() {
        // An APK is not a page, so it must NOT leave: the user would be sent to
        // Downloads to find the file and tap it three steps later.
        assertEquals(
            NavigationPolicy.Action.APK_DOWNLOAD,
            decide(isForMainFrame = true, isApkDownload = true, scheme = "https"),
        )
    }

    @Test
    fun `the scheme test is case-insensitive`() {
        assertEquals(NavigationPolicy.Action.ALLOW, decide(true, isInternal = true, scheme = "HTTPS"))
        assertEquals(NavigationPolicy.Action.EXTERNAL, decide(true, scheme = "MAILTO"))
    }
}
