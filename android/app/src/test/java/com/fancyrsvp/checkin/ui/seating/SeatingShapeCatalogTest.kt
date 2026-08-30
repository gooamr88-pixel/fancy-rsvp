package com.fancyrsvp.checkin.ui.seating

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * The fifth copy of the shape catalogue.
 *
 * ── Why this test exists ──
 *
 * `shape` is validated and drawn in four unlinked places on the web side plus a
 * database CHECK constraint, and `SeatingGeometry.kt` is now a fifth. The web's
 * own header records what happened the last time two of those copies drifted:
 * the organizer's palette grew to fourteen venue zones while the guest maps
 * stayed at six, and a guest opening their seating chart saw the buffet drawn as
 * a 96-unit round TABLE.
 *
 * Nothing throws when that happens. `shapeMeta` falls through to `round` by
 * design, because an unknown shape must still DRAW — a tablet running an APK
 * from before a shape was added has to render the room it is given rather than
 * lose an element from it. That deliberate leniency is exactly why the drift
 * cannot be caught at runtime, and has to be caught here.
 *
 * ── What a failure means ──
 *
 * NOT that the web is broken. It means a shape was added, resized or renamed on
 * the web side and this tablet will now draw that venue wrongly — silently, at a
 * door. Update `SHAPES` in `SeatingGeometry.kt` to match, and if the new shape
 * is a zone, give it a glyph in `ZoneGlyphs.kt` too.
 *
 * ── Why it skips instead of failing when the frontend is absent ──
 *
 * The Android module is sometimes checked out or built on its own, and a test
 * that cannot see `frontend/` has learned nothing. Failing there would train
 * people to ignore this file, which defeats it. Same reasoning, and the same
 * mechanism, as `PairingGuideCopyTest`.
 */
class SeatingShapeCatalogTest {

    private fun repoRoot(): File? {
        var dir: File? = File("").absoluteFile
        var depth = 0
        while (depth < MAX_WALK_UP) {
            val here = dir ?: return null
            if (File(here, "frontend/src/app/utils").isDirectory) return here
            dir = here.parentFile
            depth++
        }
        return null
    }

    private fun geometrySource(): String? = repoRoot()
        ?.let { File(it, "frontend/src/app/utils/seatingGeometry.js") }
        ?.takeIf { it.isFile }
        ?.readText()

    /**
     * One catalogue line, e.g.
     * `round: { label: 'Round Table', cat: 'table', w: 96, h: 96, ... }`
     *
     * Deliberately loose about ORDER and about the keys it does not care for —
     * `icon`, `color` and `pickable` are web concerns. It pins the four things
     * that decide where an element lands and how big it is drawn, because those
     * are what make two maps of the same room disagree.
     */
    private val entry = Regex(
        """(\w+):\s*\{\s*label:\s*'([^']*)',\s*cat:\s*'(\w+)',\s*w:\s*([\d.]+),\s*h:\s*([\d.]+)""",
    )

    private data class WebShape(
        val key: String,
        val label: String,
        val cat: String,
        val w: Double,
        val h: Double,
        val round: Boolean,
    )

    private fun webCatalogue(source: String): List<WebShape> {
        val body = source.substringAfter("export const SHAPES = {").substringBefore("\n};")
        return body.lines().mapNotNull { line ->
            val m = entry.find(line) ?: return@mapNotNull null
            WebShape(
                key = m.groupValues[1],
                label = m.groupValues[2],
                cat = m.groupValues[3],
                w = m.groupValues[4].toDouble(),
                h = m.groupValues[5].toDouble(),
                round = line.contains("round: true"),
            )
        }
    }

    @Test
    fun `every shape the web draws exists here, with the same geometry`() {
        val source = geometrySource()
        assumeTrue("frontend/ not present — nothing to check against", source != null)

        val web = webCatalogue(source!!)
        // A regex that silently matched nothing would make this test pass
        // forever while checking nothing at all — the worst possible outcome for
        // a drift guard.
        assertTrue(
            "parsed no shapes out of seatingGeometry.js — the catalogue's shape " +
                "changed and this test is no longer reading it",
            web.size >= 15,
        )

        for (shape in web) {
            val mine = SHAPES[shape.key]
            assertNotNull(
                "shape '${shape.key}' (${shape.label}) exists on the web and not in " +
                    "SHAPES — this tablet will draw it as a round table",
                mine,
            )
            val meta = mine!!
            assertEquals("width of '${shape.key}'", shape.w, meta.w, 0.001)
            assertEquals("height of '${shape.key}'", shape.h, meta.h, 0.001)
            assertEquals("category of '${shape.key}'", shape.cat, meta.category)
            assertEquals("roundness of '${shape.key}'", shape.round, meta.round)
        }
    }

    @Test
    fun `this catalogue holds nothing the web does not`() {
        val source = geometrySource()
        assumeTrue("frontend/ not present — nothing to check against", source != null)

        val webKeys = webCatalogue(source!!).map { it.key }.toSet()
        val extra = SHAPES.keys - webKeys
        assertTrue(
            "SHAPES holds ${extra.sorted()}, which the web catalogue does not. An " +
                "organizer can never produce these, so they are dead weight — or " +
                "worse, a key that was RENAMED on the web and left behind here.",
            extra.isEmpty(),
        )
    }

    /**
     * A zone with no glyph is a coloured box with nothing in it, and the key
     * beneath the plan would have an empty swatch beside its name.
     */
    @Test
    fun `every zone has a glyph and a colour`() {
        SHAPES.values.filter { it.isZone }.forEach { meta ->
            assertNotNull("zone '${meta.key}' has no glyph", meta.glyph)
            assertNotNull("zone '${meta.key}' has no colour", meta.colorHex)
        }
    }

    /**
     * And a table has neither, because a table carries a NUMERAL. A table that
     * somehow acquired a glyph would draw the mark on top of its own number.
     */
    @Test
    fun `every table has a default capacity and no glyph`() {
        SHAPES.values.filterNot { it.isZone }.forEach { meta ->
            assertNotNull("table '${meta.key}' has no default capacity", meta.defaultCapacity)
            assertEquals("table '${meta.key}' must not carry a glyph", null, meta.glyph)
        }
    }

    /**
     * The legacy alias from the original two-shape model.
     *
     * Every event created before the catalogue widened stores `rectangular`, and
     * losing this mapping would silently redraw every one of those tables as a
     * 96-unit circle.
     */
    @Test
    fun `the rectangular alias still resolves to rectangle`() {
        assertEquals("rectangle", shapeMeta("rectangular").key)
    }

    /**
     * The fallback that makes the whole scheme safe: an APK in the field must
     * draw a venue laid out with a shape added after it shipped, rather than
     * dropping the element or refusing the plan.
     */
    @Test
    fun `an unknown shape falls back to a round table rather than throwing`() {
        assertEquals("round", shapeMeta("chocolate_fountain").key)
        assertEquals("round", shapeMeta(null).key)
        assertEquals("round", shapeMeta("").key)
    }

    /**
     * The world these percentages resolve against. If it ever moved on one side
     * only, every element would land in the wrong place by a fixed ratio — a
     * layout that looks plausible and is wrong, which is the hardest kind to
     * notice.
     */
    @Test
    fun `the logical world is the same size on both sides`() {
        val source = geometrySource()
        assumeTrue("frontend/ not present — nothing to check against", source != null)

        assertTrue(
            "WORLD_W disagrees with seatingGeometry.js",
            source!!.contains("export const WORLD_W = ${WORLD_W.toInt()};"),
        )
        assertTrue(
            "WORLD_H disagrees with seatingGeometry.js",
            source.contains("export const WORLD_H = ${WORLD_H.toInt()};"),
        )
    }

    private companion object {
        /** android/app → android → repo root is two; six is slack, not a guess. */
        const val MAX_WALK_UP = 6
    }
}
