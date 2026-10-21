package dev.kabmo.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * `res/drawable/kabmo_wordmark.xml` against `public/kabmo-wordmark.svg`.
 *
 * The overlay draws the SAME lockup README.md embeds — the icon tile, the three
 * K strokes, the outlined word — but a launch overlay is native views, so the
 * artwork has to exist twice: once as an SVG for the README and once as a
 * VectorDrawable for the shell. Two copies of one drawing is exactly the shape
 * that drifts silently (a colour nudged in the SVG, a stroke re-exported), and
 * nothing on screen would say so: the overlay still renders, just not the mark.
 *
 * So this test re-derives the drawable from the SVG rather than trusting the
 * copy. It asserts the whole translation, not a sample of it:
 *
 * - the viewport IS the SVG's viewBox, and the y shift IS `-viewBox.y` (a
 *   VectorDrawable has no negative origin, which is the only reason the paths
 *   are not byte-identical);
 * - every path in the SVG appears in the drawable with every y coordinate moved
 *   by that shift and every x untouched;
 * - the plate is the SVG's `<rect>` (same size, same corner radius, same fill),
 *   drawn as a path because a VectorDrawable has no rect element;
 * - the gradient is the SVG's, run over the same user-space span with the same
 *   two stops;
 * - the stroke weight, caps and per-stroke colours are the SVG's.
 *
 * Plain JVM: the files are parsed directly, so this runs in the same suite as
 * the rest of the shell's tests, with no emulator and no Android framework.
 */
class WordmarkDrawableTest {

    private val repo = repoRoot()
    private val svgText = File(repo, "public/kabmo-wordmark.svg").readText()
    private val drawableFile =
        File(repo, "packages/android/app/src/main/res/drawable/kabmo_wordmark.xml")
    private val drawable = parse(drawableFile)
    private val paths = drawable.getElementsByTagName("path")

    // ---------------------------------------------------------------- viewport

    @Test
    fun viewportIsTheSvgViewBoxWithNoNegativeOrigin() {
        val box = svgViewBox()
        assertEquals(box[2], drawable.double("viewportWidth"), 0.01)
        assertEquals(box[3], drawable.double("viewportHeight"), 0.01)
        // The SVG is authored around a baseline at y=0, so its viewBox starts
        // above the origin. A VectorDrawable cannot, and the shift is the whole
        // translation — asserted rather than assumed.
        assertTrue("the SVG must start above the origin for this port to apply", box[1] < 0)
        assertEquals(-box[1], shift(), 0.01)
    }

    @Test
    fun intrinsicSizeKeepsTheArtworksAspect() {
        // The overlay fixes the ImageView's box, so a drawable whose intrinsic
        // aspect disagreed with its viewport would be stretched inside it.
        val box = svgViewBox()
        val art = box[2] / box[3]
        // `width`/`height` carry a unit (`180dp`), which the numeric helper
        // would reject; only the ratio matters here.
        val intrinsic = drawable.attr("width").removeSuffix("dp").toDouble() /
            drawable.attr("height").removeSuffix("dp").toDouble()
        assertEquals(art, intrinsic, 0.01)
    }

    // ------------------------------------------------------------------- paths

    @Test
    fun everySvgPathAppearsWithOnlyYShifted() {
        val svgPaths = svgPathData()
        assertEquals("the SVG's five paths, plus the plate", svgPaths.size + 1, paths.length)

        svgPaths.forEachIndexed { index, d ->
            val drawn = pathAt(index + 1).attr("pathData")
            val expected = parsePath(d)
            val actual = parsePath(drawn)
            assertEquals("path $index: command sequence", ops(expected), ops(actual))
            expected.forEachIndexed { group, command ->
                val got = actual[group]
                assertEquals("path $index group $group: argument count", command.args.size, got.args.size)
                command.args.forEachIndexed { arg, value ->
                    val want = if (isY(command.op, arg)) value + shift() else value
                    assertEquals(
                        "path $index ${command.op}[$arg]",
                        want,
                        got.args[arg],
                        0.01,
                    )
                }
            }
        }
    }

    // ------------------------------------------------------------------- plate

    @Test
    fun plateIsTheSvgRect() {
        val rect = Regex("<rect width=\"([\\d.]+)\" height=\"([\\d.]+)\" y=\"([-\\d.]+)\" rx=\"([\\d.]+)\" fill=\"(#[0-9a-fA-F]{6})\"")
            .find(svgText)
        assertTrue("the SVG must declare its plate as a rect", rect != null)
        val (width, height, y, radius, fill) = rect!!.destructured

        val plate = pathAt(0)
        assertEquals(sameHex(fill), sameHex(plate.attr("fillColor")))
        // Same tile, same corners — drawn as a path, so the numbers are what is
        // comparable: the four straight edges and four arcs the rect becomes.
        val numbers = parsePath(plate.attr("pathData"))
            .flatMap { it.args }
        listOf(width.toDouble(), height.toDouble(), radius.toDouble()).forEach { value ->
            assertTrue(
                "the plate path must carry $value from the SVG rect",
                numbers.any { Math.abs(it - value) < 0.01 },
            )
        }
        // The rect's own y is the viewBox's top, and the plate begins there.
        assertEquals(y.toDouble() + shift(), 0.0, 0.01)
    }

    // ---------------------------------------------------------------- gradient

    @Test
    fun gradientIsTheSvgRunOverTheSameSpan() {
        val gradient = Regex("<linearGradient[^>]*x1=\"([\\d.]+)\"[^>]*y1=\"([\\d.]+)\"[^>]*x2=\"([\\d.]+)\"[^>]*y2=\"([\\d.]+)\"")
            .find(svgText)
        assertTrue("the SVG must declare its gradient span", gradient != null)
        val (x1, y1, x2, y2) = gradient!!.destructured

        val drawn = drawable.getElementsByTagName("gradient").item(0) as Element
        assertEquals(x1.toDouble(), drawn.double("startX"), 0.01)
        assertEquals(y1.toDouble() + shift(), drawn.double("startY"), 0.01)
        assertEquals(x2.toDouble(), drawn.double("endX"), 0.01)
        assertEquals(y2.toDouble() + shift(), drawn.double("endY"), 0.01)

        val stops = Regex("<stop offset=\"\\d\" stop-color=\"(#[0-9a-fA-F]{6})\"")
            .findAll(svgText).map { it.groupValues[1] }.toList()
        assertEquals("the SVG's two stops", 2, stops.size)
        assertEquals(sameHex(stops[0]), sameHex(drawn.attr("startColor")))
        assertEquals(sameHex(stops[1]), sameHex(drawn.attr("endColor")))
        // The gradient is inline rather than a resource, which is what keeps
        // this one file self-contained the way the SVG is.
        assertEquals("linear", drawn.attr("type"))
    }

    // ----------------------------------------------------------------- strokes

    @Test
    fun theKKeepsItsWeightCapsAndColours() {
        val group = Regex("<g fill=\"none\" stroke-width=\"([\\d.]+)\" stroke-linecap=\"(\\w+)\" stroke-linejoin=\"(\\w+)\"")
            .find(svgText)
        assertTrue("the SVG must declare the K's stroke style", group != null)
        val (weight, cap, join) = group!!.destructured

        val svgStrokes = Regex("<path d=\"[^\"]+\" stroke=\"(#[0-9a-fA-F]{6})\"")
            .findAll(svgText).map { it.groupValues[1] }.toList()
        assertEquals("three strokes: stem, upper arm, lower arm", 3, svgStrokes.size)

        svgStrokes.forEachIndexed { index, colour ->
            val stroke = pathAt(index + 1)
            assertEquals("stroke $index colour", sameHex(colour), sameHex(stroke.attr("strokeColor")))
            assertEquals(weight.toDouble(), stroke.double("strokeWidth"), 0.01)
            assertEquals(cap, stroke.attr("strokeLineCap"))
            assertEquals(join, stroke.attr("strokeLineJoin"))
            // A stroked path in a VectorDrawable is still filled by default,
            // which would paint the K's triangle solid.
            assertEquals("@android:color/transparent", stroke.attr("fillColor"))
        }
    }

    @Test
    fun theWordUsesTheSvgInkNotAThemeColour() {
        // `mo` is one ink chosen to hold on any background — the SVG documents
        // why it is not a media query. A theme attribute here would make the
        // overlay's wordmark follow the device's palette while the README's
        // does not.
        val ink = Regex("\\.kabmo-mo \\{ fill: (#[0-9a-fA-F]{6}); \\}").find(svgText)
        assertTrue("the SVG must declare the mo ink", ink != null)
        assertEquals(sameHex(ink!!.groupValues[1]), sameHex(pathAt(5).attr("fillColor")))
        assertTrue(pathAt(5).attr("pathData").isNotEmpty())
    }

    // ------------------------------------------------------------------ helpers

    /** Every path's `d` in document order. */
    private fun svgPathData(): List<String> =
        Regex("<path[^>]*\\sd=\"([^\"]+)\"").findAll(svgText).map { it.groupValues[1] }.toList()

    private fun svgViewBox(): List<Double> {
        val match = Regex("viewBox=\"([-\\d.]+) ([-\\d.]+) ([\\d.]+) ([\\d.]+)\"").find(svgText)
        assertTrue("the SVG must declare a viewBox", match != null)
        return match!!.groupValues.drop(1).map { it.toDouble() }
    }

    private fun shift(): Double = -svgViewBox()[1]

    private fun parse(file: File): Element {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = false
        return factory.newDocumentBuilder().parse(file).documentElement
    }

    /** The nth drawable path, as an Element (a NodeList hands back Nodes). */
    private fun pathAt(index: Int): Element = paths.item(index) as Element

    private fun Element.attr(name: String): String {
        val value = getAttribute("android:$name")
        assertTrue("<$tagName> must carry android:$name", value.isNotEmpty())
        return value
    }

    private fun Element.double(name: String): Double = attr(name).toDouble()

    private fun sameHex(value: String): String = value.uppercase()

    private data class Command(val op: Char, val args: List<Double>)

    private fun ops(commands: List<Command>): List<Char> = commands.map { it.op }

    /**
     * A path's command groups, with SVG's implicit repeats made explicit.
     *
     * `M48.83 -50 102.54 -91.5` is a moveto followed by an implicit lineto —
     * the same path the drawable spells `M 48.83,78.12 L 102.54,36.62`. Without
     * this expansion the two would compare as different paths.
     */
    private fun parsePath(d: String): List<Command> {
        val tokens = Regex("[A-Za-z]|-?(?:\\d+\\.?\\d*|\\.\\d+)")
            .findAll(d).map { it.value }.toList()
        val out = mutableListOf<Command>()
        var i = 0
        var pending: Char? = null
        while (i < tokens.size) {
            val token = tokens[i]
            if (token.length == 1 && token[0].isLetter()) {
                pending = token[0].uppercaseChar()
                i += 1
                continue
            }
            val op = pending ?: throw AssertionError("path data starts with a number: $d")
            val arity = arity(op)
            val args = tokens.subList(i, minOf(i + arity, tokens.size)).map { it.toDouble() }
            assertEquals("path '$d' is missing arguments for $op", arity, args.size)
            out += Command(op, args)
            i += arity
            pending = if (op == 'M') 'L' else op
        }
        return out
    }

    private fun arity(op: Char): Int = when (op) {
        'M', 'L', 'T' -> 2
        'H', 'V' -> 1
        'Q', 'S' -> 4
        'C' -> 6
        'A' -> 7
        'Z' -> 0
        else -> throw AssertionError("unsupported path command $op")
    }

    private fun isY(op: Char, index: Int): Boolean = when (op) {
        'M', 'L', 'T' -> index == 1
        'V' -> index == 0
        'Q', 'S' -> index == 1 || index == 3
        'C' -> index % 2 == 1
        else -> false
    }

    private fun repoRoot(): File {
        val cwd = System.getProperty("user.dir") ?: "."
        var dir: File? = File(cwd).absoluteFile
        while (dir != null) {
            if (File(dir, "public/kabmo-wordmark.svg").isFile) return dir
            dir = dir.parentFile
        }
        throw AssertionError(
            "could not find public/kabmo-wordmark.svg above $cwd",
        )
    }
}
