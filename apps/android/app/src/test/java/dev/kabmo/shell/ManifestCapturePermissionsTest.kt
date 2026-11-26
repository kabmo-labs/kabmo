package dev.kabmo.shell

import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The manifest permissions the WebView's capture path needs, pinned.
 *
 * Both failures this guards are silent in a different way, and neither is
 * visible from the app:
 *
 * - A capture resource the chrome client grants but the manifest does not
 *   declare is refused by the platform, so `getUserMedia` rejects with
 *   `NotAllowedError` and the composer says "Microphone permission denied."
 *   while the system settings screen shows the permission as granted.
 * - `MODIFY_AUDIO_SETTINGS` is referenced by NO Kotlin file — Chromium's own
 *   audio path needs it to select a communication device — so nothing in this
 *   source tree would notice it going missing. Without it the WebView logs
 *   `Unable to select communication device!` and `getUserMedia({audio: true})`
 *   rejects with `NotReadableError: Could not start audio source`, which the
 *   composer reported as "Could not open the microphone." on Android while the
 *   same page recorded fine in Chrome on the same device.
 *
 * Plain JVM: the manifest and the chrome client are read as files, so this runs
 * in the same suite as the rest of the shell's tests, with no emulator.
 */
class ManifestCapturePermissionsTest {

    private val manifest = parse(File(repoRoot(), "apps/android/app/src/main/AndroidManifest.xml"))
    private val declared = manifest.getElementsByTagName("uses-permission")
        .let { nodes -> (0 until nodes.length).map { (nodes.item(it) as Element).getAttribute("android:name") } }

    @Test
    fun everyCaptureResourceTheChromeClientGrantsIsDeclared() {
        val chromeClient = File(
            repoRoot(),
            "apps/android/app/src/main/java/dev/kabmo/shell/KabmoChromeClient.kt",
        ).readText()
        val granted = Regex("Manifest\\.permission\\.([A-Z_]+)")
            .findAll(chromeClient)
            .map { "android.permission.${it.groupValues[1]}" }
            .toSet()

        // The regex is the test's own input: an empty set would make the loop
        // below pass while the chrome client granted nothing at all.
        assertTrue("KabmoChromeClient must grant at least one capture resource", granted.isNotEmpty())
        granted.forEach { permission ->
            assertTrue("$permission is granted by the chrome client but not declared", permission in declared)
        }
    }

    @Test
    fun theAudioPathDeclaresThePermissionChromiumNeeds() {
        // Not a runtime permission and not referenced from Kotlin: the only
        // place it can be asserted is here.
        assertTrue(
            "android.permission.MODIFY_AUDIO_SETTINGS is what keeps getUserMedia from failing with NotReadableError",
            "android.permission.MODIFY_AUDIO_SETTINGS" in declared,
        )
        assertTrue("android.permission.RECORD_AUDIO" in declared)
    }

    private fun parse(file: File): Element {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = false
        return factory.newDocumentBuilder().parse(file).documentElement
    }

    private fun repoRoot(): File {
        val cwd = System.getProperty("user.dir") ?: "."
        var dir: File? = File(cwd).absoluteFile
        while (dir != null) {
            if (File(dir, "apps/android/app/src/main/AndroidManifest.xml").isFile) return dir
            dir = dir.parentFile
        }
        throw AssertionError("could not find apps/android/app/src/main/AndroidManifest.xml above $cwd")
    }
}
