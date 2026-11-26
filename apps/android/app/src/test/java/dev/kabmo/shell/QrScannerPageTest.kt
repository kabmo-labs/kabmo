package dev.kabmo.shell

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The scanner page and the Activity that hosts it, pinned together.
 *
 * The pair talks through string names only — `addJavascriptInterface` publishes
 * an object under a name the page has to spell, and `evaluateJavascript` calls a
 * function the page has to define — so a rename on either side compiles, ships,
 * and fails on a device by DOING NOTHING. That is the bug this test was written
 * from: the page reported a decoded code to `window.__kabmoQrResult` while the
 * Activity published `KabmoQr`, so a successful scan drew "Code read." and the
 * screen sat on that sentence forever, with the camera already stopped.
 *
 * The page itself lives in `assets/qr-scanner/` and serves Android, Windows and
 * Linux; `qr-scanner.html` is generated from `page.html` by
 * `bun assets/qr-scanner/build.mjs`. Nothing here needs a WebView: the files
 * are read and compared, which is the same shape `WordmarkDrawableTest` uses for
 * the wordmark's two copies.
 */
class QrScannerPageTest {

    private val repo: File = repoRoot()
    private val source = File(repo, "assets/qr-scanner/page.html").readText()
    private val artifact = File(repo, "assets/qr-scanner/qr-scanner.html").readText()
    private val activity =
        File(repo, "apps/android/app/src/main/java/dev/kabmo/shell/QrScannerActivity.kt").readText()

    /** The name the Activity publishes the bridge under. */
    private val bridge =
        Regex("""addJavascriptInterface\(\s*[\w.]+\(\)\s*,\s*"([A-Za-z_$][\w$]*)"\s*\)""")
            .find(activity)
            ?.groupValues
            ?.get(1)
            ?: error("QrScannerActivity no longer injects a named bridge")

    // ------------------------------------------------------------- the bridge

    @Test
    fun thePageReportsAReadCodeThroughTheInjectedBridge() {
        val report = functionBody("function report(type, text) {")
        assertTrue(
            "report() does not call window.$bridge.result( — a scanned code never reaches the Activity",
            report.contains("window.$bridge.result("),
        )
    }

    @Test
    fun thePageReportsAFailureThroughTheInjectedBridge() {
        val report = functionBody("function report(type, text) {")
        assertTrue(
            "report() does not call window.$bridge.error( — a refusal never reaches the Activity",
            report.contains("window.$bridge.error("),
        )
    }

    @Test
    fun theUploadButtonUsesTheInjectedPicker() {
        assertTrue(
            "the upload button does not call window.$bridge.pickImage( — the file picker is unreachable",
            source.contains("window.$bridge.pickImage"),
        )
    }

    @Test
    fun theEntryPointTheActivityCallsIsDefinedByThePage() {
        val called =
            Regex("""window\.(\w+)\s*&&""")
                .find(activity)
                ?.groupValues
                ?.get(1)
                ?: error("QrScannerActivity no longer evaluates an entry point")
        assertTrue(
            "the Activity evaluates window.$called, and the page does not define it",
            source.contains("window.$called = function"),
        )
    }

    // ---------------------------------------------------------- the artifact

    /**
     * `qr-scanner.html` is the file the APK, the Windows build and the Linux
     * build carry. It is generated, and a stale copy is invisible: the source
     * would read correct while the shipped page still had the old bridge.
     */
    @Test
    fun theShippedArtifactIsTheSourcePagePlusTheDecoder() {
        assertEquals(
            "qr-scanner.html is stale — run `bun assets/qr-scanner/build.mjs`",
            withoutDecoder(source),
            withoutDecoder(artifact),
        )
    }

    @Test
    fun theShippedArtifactCarriesTheDecoder() {
        // WebView2 on Windows has no `BarcodeDetector` (Chromium hides it on
        // platforms with no barcode provider), so the page must carry jsQR.
        assertTrue(
            "qr-scanner.html has no inlined jsQR — the Windows shell decodes nothing",
            decoderBlock(artifact).contains("jsQR="),
        )
    }

    // ---------------------------------------------------------------- helpers

    /**
     * The body of `signature`, up to the first closing brace at its own indent.
     * The page is hand-written and two-space indented, so that is exact.
     */
    private fun functionBody(signature: String): String {
        val start = source.indexOf(signature)
        assertTrue("page.html has no $signature", start >= 0)
        val end = source.indexOf("\n  }", start)
        assertTrue("$signature is not closed at two-space indent", end > start)
        return source.substring(start, end)
    }

    /** The page with the `<script id="jsqr">` block removed. */
    private fun withoutDecoder(html: String): String {
        val block = decoderBlock(html)
        val start = html.indexOf(block)
        return html.removeRange(start, start + block.length)
    }

    private fun decoderBlock(html: String): String {
        val open = html.indexOf("<script id=\"jsqr\">")
        assertTrue("the page has no <script id=\"jsqr\"> block", open >= 0)
        val close = html.indexOf("</script>", open)
        assertTrue("the jsQR block is not closed", close > open)
        return html.substring(open, close + "</script>".length)
    }

    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            if (File(dir, "assets/qr-scanner/page.html").isFile) return dir
            dir = dir.parentFile
        }
        throw AssertionError(
            "could not find assets/qr-scanner/page.html above ${System.getProperty("user.dir")}",
        )
    }
}
