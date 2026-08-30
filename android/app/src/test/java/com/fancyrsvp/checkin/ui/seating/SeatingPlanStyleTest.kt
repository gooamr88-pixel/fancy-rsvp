package com.fancyrsvp.checkin.ui.seating

import androidx.compose.ui.graphics.Color
import com.fancyrsvp.checkin.data.local.VenueTableEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure parts of the seating plan: the numeral, the thresholds, the zone
 * label placement, the key.
 *
 * ── Where the expected values come from ──
 *
 * The numeral cases are not my reading of `seatingPlanStyle.js` — every one of
 * them was produced by EXECUTING the real web implementation and the ported
 * pattern side by side over the same inputs. That matters most for the Arabic
 * ones: "Table 1000" resolving to "T1" rather than to "1000" looks like a bug
 * until you see that a four-digit tail cannot match `{1,3}` and the function
 * falls through to initials. It is the web's behaviour, so it is this one's.
 *
 * ── No literal non-ASCII in this file ──
 *
 * Arabic and Arabic-Indic digits are written as `\u` escapes, the same rule the
 * rest of this module follows. One altered byte in a test's expected value is
 * invisible in review and would silently green-light a broken contract.
 */
class SeatingPlanStyleTest {

    // ── planNumeral ─────────────────────────────────────────────────────────

    @Test
    fun `a bare number is the numeral`() {
        assertEquals("5", planNumeral("5"))
        assertEquals("12", planNumeral("12"))
    }

    @Test
    fun `the word Table is dropped and the number kept`() {
        assertEquals("12", planNumeral("Table 12"))
        assertEquals("5", planNumeral("Table 5"))
        assertEquals("7", planNumeral("Table-7"))
        // The middle dot, escaped rather than typed: it is one of the separators
        // the pattern admits, so it is contract data, and a literal here could be
        // silently swapped for U+2027 or U+2219 in an editor without anyone
        // seeing it in review.
        assertEquals("9", planNumeral("Table \u00B7 9"))
    }

    /**
     * The bug the leading word-boundary group exists to prevent. Without it the
     * letter group starts mid-word and takes the TAIL of "Table", so this comes
     * out "LE12".
     */
    @Test
    fun `a section letter is only kept when it stands on its own`() {
        assertEquals("A3", planNumeral("Table A3"))
        assertEquals("12", planNumeral("Table 12"))
    }

    @Test
    fun `a short name is set as it is, with its spaces closed up`() {
        assertEquals("VIP", planNumeral("VIP"))
        assertEquals("A", planNumeral("A"))
        assertEquals("AB", planNumeral("ab"))
        // "T 3" is one mark on a plan; the gap would be set at the numeral's own
        // size, taking a third of the table.
        assertEquals("T3", planNumeral("T 3"))
    }

    @Test
    fun `a named table falls back to initials`() {
        assertEquals("RG", planNumeral("Rose Garden"))
        assertEquals("TR", planNumeral("The Rose Garden"))
        assertEquals("HT", planNumeral("Head Table"))
    }

    /**
     * Four digits do not match the `{1,3}` tail, so this falls through to
     * initials. Verified against the web implementation — it is not a defect
     * here, it is the shared behaviour, and a plan with thousand-numbered tables
     * is outside what this product produces.
     */
    @Test
    fun `a number too long for a numeral becomes initials`() {
        assertEquals("100", planNumeral("Banquet 100"))
        assertEquals("T1", planNumeral("Table 1000"))
    }

    /**
     * Most guests at these events have Arabic names, and organizers name tables
     * in Arabic to match. Every character here is an escape, never a literal —
     * see the class comment.
     */
    @Test
    fun `arabic-indic digits count as digits`() {
        // U+0637.. spells "table"; U+0667 is Arabic-Indic seven.
        assertEquals("\u0667", planNumeral("\u0637\u0627\u0648\u0644\u0629 \u0667"))
        // U+0642.. spells "hall"; U+06F3 is the EXTENDED (Persian/Urdu) three,
        // a different code point from the Arabic-Indic U+0663 below.
        assertEquals("\u06F3", planNumeral("\u0642\u0627\u0639\u0629 \u06F3"))
        // An Arabic section letter standing in front of an Arabic-Indic digit,
        // the way "A3" does in Latin.
        assertEquals(
            "\u0627\u0663",
            planNumeral("\u0637\u0627\u0648\u0644\u0629 \u0627\u0663"),
        )
    }

    @Test
    fun `nothing to draw returns null rather than an empty mark`() {
        assertNull(planNumeral(""))
        assertNull(planNumeral("   "))
        assertNull(planNumeral(null))
    }

    // ── The thresholds ──────────────────────────────────────────────────────

    /**
     * THE FLOOR AND THE THRESHOLD HAVE TO AGREE.
     *
     * The numeral's size is floored at 7px. If the threshold admitted a numeral
     * whose NATURAL size was below that floor, the floor would inflate it — and
     * a 7px digit inside a 13px circle is wider than half the circle it sits in,
     * which is what made every table on the web thumbnail carry a number
     * bursting out of it. So at the threshold the natural size must already
     * clear the floor with nothing to inflate.
     */
    @Test
    fun `the numeral threshold never asks the floor to inflate anything`() {
        val smallest = NUMERAL_MIN_PX / 0.42f
        assertTrue("a table at the threshold must carry a numeral", numeralFits(smallest + 0.1f))
        assertFalse("and one below it must not", numeralFits(smallest - 0.1f))
        // At the threshold the natural size IS the floor, so no inflation occurs.
        assertEquals(NUMERAL_MIN_PX, numeralSizePx(smallest), 0.05f)
    }

    @Test
    fun `chairs and the pin have their own floors, above the numeral's`() {
        assertFalse("ten pips around a 20px table are texture, not chairs", seatsFit(20f))
        assertTrue(seatsFit(30f))
        assertFalse("an 11px pin on a 20px table merges with it", markerFits(20f))
        assertTrue(markerFits(26f))
        // The pin is the FIRST thing to go as a plan shrinks and the numeral the
        // last: an usher can read a number off a table they cannot see a pin on.
        assertTrue(markerFits(26f) && seatsFit(30f) && numeralFits(17f))
    }

    @Test
    fun `the floor module doubles until a square is big enough to read as a floor`() {
        // At full size one module is 100 world units and needs no help.
        assertEquals(100f, floorModulePx(1f), 0.01f)
        // Squeezed to a card, it doubles rather than becoming a 12px mesh over
        // the one thing anybody is looking for.
        assertTrue("a squeezed grid must not fall below the legibility floor", floorModulePx(0.12f) >= 22f)
        assertTrue(floorModulePx(0.02f) >= 22f)
    }

    // ── Colours ─────────────────────────────────────────────────────────────

    @Test
    fun `an organizer colour is honoured and a broken one falls back`() {
        assertEquals(Color(0xFF4A7C59), parseHexColor("#4A7C59"))
        assertEquals(Color(0xFF4A7C59), parseHexColor("4A7C59"))
        assertEquals(Color(0xFFFFFFFF), parseHexColor("#fff"))
        // Free text from a colour picker. Null so the caller takes the
        // catalogue's colour, rather than throwing or painting a wedding zone in
        // an alarm colour.
        assertNull(parseHexColor("teal"))
        assertNull(parseHexColor("#12345"))
        assertNull(parseHexColor(null))
        assertNull(parseHexColor(""))
    }

    // ── Zone label placement ────────────────────────────────────────────────

    private fun zone(
        id: String = "z1",
        name: String = "Dance Floor",
        shape: String = "dance_floor",
        w: Double = 280.0,
        h: Double = 280.0,
    ) = VenueTableEntity(
        id = id, eventId = "e", name = name, capacity = null,
        elementType = CATEGORY_ZONE, shape = shape,
        positionX = 0.0, positionY = 0.0, width = w, height = h, rotation = 0.0, color = null,
    )

    @Test
    fun `a zone big enough to be read carries its own name`() {
        val label = zoneLabelFor(zone(), PlanRect(0f, 0f, 280f, 280f), emptyList())
        assertNotNull("a 280px dance floor has room for its name three times over", label)
        assertEquals("Dance Floor", label!!.text)
    }

    @Test
    fun `a zone too small to be read leaves its name to the key`() {
        // A DJ booth on a card. "DANCE FLOOR" here either shrinks below reading
        // size or spills over the table next to it, which is why the names came
        // off small zones in the first place.
        assertNull(zoneLabelFor(zone(), PlanRect(0f, 0f, 26f, 22f), emptyList()))
    }

    /**
     * A zone is painted BEHIND the tables and that order is not negotiable — an
     * usher hunting table 13 must see table 13, not a dance floor drawn over it.
     * The consequence is that a table sitting inside a zone hides the middle of
     * its name, so the name moves rather than being covered.
     */
    @Test
    fun `a name moves out from under a table sitting on its zone`() {
        val box = PlanRect(0f, 0f, 280f, 280f)
        // A table parked squarely over the middle band.
        val obstacle = PlanRect(60f, 110f, 96f, 96f)

        val clear = zoneLabelFor(zone(), box, emptyList())
        val blocked = zoneLabelFor(zone(), box, listOf(obstacle))

        assertNotNull(clear)
        assertNotNull("the name should move, not disappear", blocked)
        assertEquals(JUSTIFY_CENTER, clear!!.justify)
        assertTrue(
            "it must leave the centre band it was blocked out of",
            blocked!!.justify != JUSTIFY_CENTER,
        )
    }

    @Test
    fun `a name covered in every band is dropped, because half a name is worse than none`() {
        val box = PlanRect(0f, 0f, 280f, 280f)
        val everywhere = listOf(PlanRect(-10f, -10f, 300f, 300f))
        assertNull(zoneLabelFor(zone(), box, everywhere))
    }

    @Test
    fun `a table is never given a zone label`() {
        val table = VenueTableEntity(
            id = "t1", eventId = "e", name = "Table 12", capacity = 10,
            elementType = CATEGORY_TABLE, shape = "round",
            positionX = 0.0, positionY = 0.0, rotation = 0.0,
        )
        assertNull(zoneLabelFor(table, PlanRect(0f, 0f, 300f, 300f), emptyList()))
    }

    // ── The key ─────────────────────────────────────────────────────────────

    @Test
    fun `the key uses the host's own name, and folds duplicates`() {
        val items = planLegend(
            listOf(
                zone(id = "a", name = "Champagne Bar", shape = "bar", w = 240.0, h = 92.0),
                zone(id = "b", name = "Champagne Bar", shape = "bar", w = 240.0, h = 92.0),
                zone(id = "c", name = "Bar", shape = "bar", w = 240.0, h = 92.0),
            ),
        )
        // Same shape, same name folds and counts. Same shape, DIFFERENT name
        // stays a separate row — collapsing those made one of them vanish from
        // the key entirely.
        assertEquals(2, items.size)
        assertEquals("Champagne Bar", items[0].label)
        assertEquals(2, items[0].count)
        assertEquals("Bar", items[1].label)
        assertEquals(1, items[1].count)
    }

    @Test
    fun `an unnamed zone falls back to the catalogue's label`() {
        val items = planLegend(listOf(zone(name = "", shape = "stage", w = 360.0, h = 150.0)))
        assertEquals("Stage", items.single().label)
    }

    @Test
    fun `tables are not in the key`() {
        val table = VenueTableEntity(
            id = "t1", eventId = "e", name = "Table 12", capacity = 10,
            elementType = CATEGORY_TABLE, shape = "round",
            positionX = 0.0, positionY = 0.0,
        )
        assertTrue(planLegend(listOf(table)).isEmpty())
    }

    // ── How much of the key fits ────────────────────────────────────────────

    private fun legendItems(n: Int) = (1..n).map {
        LegendItem(key = "k$it", label = "Zone $it", glyph = ZoneGlyph.Star, color = Color.Red, count = 1)
    }

    @Test
    fun `what does not fit is counted, not silently dropped`() {
        val fit = legendFitting(
            items = legendItems(12),
            availableWidthPx = 400f,
            fontSizePx = 13f,
            swatchPx = 22f,
            gapPx = 18f,
            rows = 1,
        )
        assertTrue("some of the key must fit", fit.shown.isNotEmpty())
        assertTrue("and the rest must be counted", fit.hidden > 0)
        assertEquals(12, fit.shown.size + fit.hidden)
    }

    @Test
    fun `a key that fits entirely reports nothing hidden`() {
        val fit = legendFitting(
            items = legendItems(2),
            availableWidthPx = 4000f,
            fontSizePx = 13f,
            swatchPx = 22f,
            gapPx = 18f,
            rows = 3,
        )
        assertEquals(2, fit.shown.size)
        assertEquals(0, fit.hidden)
    }

    /**
     * A key with nothing in it and a "+12" beside it tells a reader less than
     * nothing — it looks like a rendering fault rather than an abridgement.
     */
    @Test
    fun `the first chip always goes in, even when it alone overruns`() {
        val fit = legendFitting(
            items = legendItems(5),
            availableWidthPx = 10f,
            fontSizePx = 13f,
            swatchPx = 22f,
            gapPx = 18f,
            rows = 1,
        )
        assertEquals(1, fit.shown.size)
        assertEquals(4, fit.hidden)
    }

    @Test
    fun `more rows fit more of the key`() {
        val one = legendFitting(legendItems(12), 400f, 13f, 22f, 18f, rows = 1)
        val three = legendFitting(legendItems(12), 400f, 13f, 22f, 18f, rows = 3)
        assertTrue(three.shown.size > one.shown.size)
    }

    /**
     * The rows are the OUTPUT, not a flat list the composable re-wraps. The
     * card reserves its height from this count before the plan is fitted, so a
     * row more than was asked for would push the drawing off the bottom of the
     * sheet it is printed on.
     */
    @Test
    fun `the key never lays out more rows than it was given`() {
        for (rows in 1..3) {
            val fit = legendFitting(legendItems(12), 400f, 13f, 22f, 18f, rows = rows)
            assertTrue("asked for $rows rows, got ${fit.rows.size}", fit.rows.size <= rows)
            assertTrue("no row may be empty", fit.rows.none { it.isEmpty() })
            assertEquals(12, fit.shown.size + fit.hidden)
        }
    }

    @Test
    fun `an empty key lays out nothing at all`() {
        val fit = legendFitting(emptyList(), 400f, 13f, 22f, 18f, rows = 2)
        assertTrue(fit.rows.isEmpty())
        assertEquals(0, fit.hidden)
    }

    // ── Is this a layout at all? ────────────────────────────────────────────

    private fun table(id: String, x: Double?, y: Double?) = VenueTableEntity(
        id = id, eventId = "e", name = id, capacity = 10,
        elementType = CATEGORY_TABLE, shape = "round",
        positionX = x, positionY = y,
    )

    /**
     * A tablet prepared before the geometry shipped holds names and no
     * coordinates. Drawing those stacks the whole venue on the canvas origin, so
     * the plan is not offered at all and the screen shows the numeral alone —
     * exactly what that tablet did before it upgraded.
     */
    @Test
    fun `rows with no coordinates are not a plan`() {
        assertFalse(listOf(table("a", null, null), table("b", null, null)).isDrawablePlan())
        assertFalse(emptyList<VenueTableEntity>().isDrawablePlan())
    }

    @Test
    fun `one positioned element is not a room`() {
        assertFalse(listOf(table("a", 10.0, 10.0), table("b", null, null)).isDrawablePlan())
    }

    /**
     * `position_x` defaults to 0 server-side, and the organizer's Add panel gives
     * every item in a BATCH the same viewport-derived point — it is computed once,
     * outside the loop. So twenty tables added together and never dragged apart
     * are twenty elements at ONE position. That is a pile, not a room, and a pile
     * drawn as a floor plan is worse than no floor plan.
     */
    @Test
    fun `many elements piled on one position are not a room`() {
        val pile = (1..20).map { table("t$it", 0.0, 0.0) }
        assertFalse(pile.isDrawablePlan())
    }

    @Test
    fun `two elements at distinct positions are a room`() {
        assertTrue(listOf(table("a", 0.0, 0.0), table("b", 40.0, 25.0)).isDrawablePlan())
        // A pile PLUS one element that was moved is a real, if untidy, layout —
        // it is the organizer's own data and the tablet draws what it is given.
        val pileAndOne = (1..5).map { table("t$it", 0.0, 0.0) } + table("moved", 60.0, 60.0)
        assertTrue(pileAndOne.isDrawablePlan())
    }
}
