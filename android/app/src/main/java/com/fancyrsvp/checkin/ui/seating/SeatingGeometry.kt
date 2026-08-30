package com.fancyrsvp.checkin.ui.seating

import com.fancyrsvp.checkin.data.local.VenueTableEntity

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Seating plan — THE shape catalogue and world geometry, on the tablet.
 *
 * This is a PORT, not a design. It reproduces
 * `frontend/src/app/utils/seatingGeometry.js` field for field, because the
 * organizer draws the room in that model and this has to redraw the same room.
 * `SeatingShapeCatalogTest` fails the build if the two drift.
 *
 * ── The two ways a copy of this can be wrong, both of which have shipped ──
 *
 * The web side kept three hand-maintained copies of this and both failure modes
 * became real bugs on the same day. They are recorded here because a fourth copy
 * — this one — is exactly the thing that made them possible:
 *
 *  1. THE CATALOGUE DRIFTS. The editor's palette grew to 14 venue zones while
 *     the two guest maps stayed at 6. A missing entry does not throw; it falls
 *     through to [SHAPES] `round`, so a guest opening their chart saw the buffet
 *     drawn as a 96-unit round TABLE. That fallback is deliberate and is kept
 *     here — an unknown shape must still draw — which is precisely why the
 *     catalogue needs a test rather than a runtime error to protect it.
 *
 *  2. THE COORDINATE CONVENTION DRIFTS. `positionX`/`positionY` are the
 *     element's TOP-LEFT corner as a percentage of the world. One consumer read
 *     them as the CENTRE, shifting every element by half its OWN size — and
 *     because sizes differ per shape, the layout did not move, it SCRAMBLED,
 *     with elements landing on top of each other. Never re-derive a centre;
 *     always go through [centerX] / [centerY] / [boxOf].
 *
 * Adding a shape means editing this file AND the four places named in the
 * JavaScript header. Anything else and one surface stops drawing it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The canvas is a large fixed logical world; positions are stored as
 * percentages (0–100) of it, so existing data keeps working at any zoom and on
 * any screen. Zones additionally store an explicit width/height in world units
 * so they can be resized; tables always take their size from the catalogue.
 */
const val WORLD_W = 2600.0
const val WORLD_H = 1700.0

/** What a shape is: how big, how it is drawn, and whether anyone sits at it. */
data class ShapeMeta(
    val key: String,
    val label: String,
    /** `table` (seatable) or `zone` (venue furniture, no seats). */
    val category: String,
    val w: Double,
    val h: Double,
    val round: Boolean = false,
    val defaultCapacity: Int? = null,
    /** Which glyph a zone carries. Null for tables — they carry a numeral. */
    val glyph: ZoneGlyph? = null,
    /** The catalogue's colour for a zone, overridden by the organizer's own. */
    val colorHex: Long? = null,
) {
    val isZone: Boolean get() = category == CATEGORY_ZONE
}

const val CATEGORY_TABLE = "table"
const val CATEGORY_ZONE = "zone"

/**
 * The catalogue. Ordered as the JavaScript orders it, tables then zones, so the
 * two can be read side by side when one of them changes.
 *
 * `banquet` and `head` are no longer OFFERED in the organizer's Add panel but
 * are still DRAWN — that distinction is load-bearing. Removing either key here
 * would make every existing banquet or head table on every live event fall
 * through to a round table, silently, at a venue.
 */
val SHAPES: Map<String, ShapeMeta> = listOf(
    // ── seatable tables ──
    ShapeMeta("round", "Round Table", CATEGORY_TABLE, 96.0, 96.0, round = true, defaultCapacity = 10),
    ShapeMeta("oval", "Oval Table", CATEGORY_TABLE, 132.0, 86.0, round = true, defaultCapacity = 10),
    ShapeMeta("square", "Square Table", CATEGORY_TABLE, 96.0, 96.0, defaultCapacity = 10),
    ShapeMeta("rectangle", "Rectangle Table", CATEGORY_TABLE, 168.0, 84.0, defaultCapacity = 10),
    ShapeMeta("banquet", "Banquet Table", CATEGORY_TABLE, 230.0, 80.0, defaultCapacity = 10),
    ShapeMeta("head", "Head Table", CATEGORY_TABLE, 250.0, 76.0, defaultCapacity = 10),
    // ── non-seating venue zones ──
    ShapeMeta("stage", "Stage", CATEGORY_ZONE, 360.0, 150.0, glyph = ZoneGlyph.Mic, colorHex = 0xFF3B3A55),
    ShapeMeta("dance_floor", "Dance Floor", CATEGORY_ZONE, 280.0, 280.0, glyph = ZoneGlyph.DiscoBall, colorHex = 0xFF6B5FA8),
    ShapeMeta("bar", "Bar", CATEGORY_ZONE, 240.0, 92.0, glyph = ZoneGlyph.Cocktail, colorHex = 0xFF9C5A3C),
    ShapeMeta("dj_booth", "DJ Booth", CATEGORY_ZONE, 132.0, 112.0, glyph = ZoneGlyph.Headphones, colorHex = 0xFF2F5E8C),
    ShapeMeta("entrance", "Entrance", CATEGORY_ZONE, 150.0, 70.0, glyph = ZoneGlyph.Door, colorHex = 0xFF4A7C59),
    ShapeMeta("restroom", "WC", CATEGORY_ZONE, 120.0, 100.0, glyph = ZoneGlyph.Restroom, colorHex = 0xFF3C7A89),
    ShapeMeta("coat_check", "Coat Check", CATEGORY_ZONE, 150.0, 90.0, glyph = ZoneGlyph.CoatHanger, colorHex = 0xFF6E5A46),
    ShapeMeta("gift_table", "Gift Table", CATEGORY_ZONE, 150.0, 90.0, glyph = ZoneGlyph.Gift, colorHex = 0xFFB85C7A),
    ShapeMeta("cake_table", "Cake Table", CATEGORY_ZONE, 130.0, 100.0, glyph = ZoneGlyph.Cake, colorHex = 0xFFC97A9C),
    ShapeMeta("photo_booth", "Photo Booth", CATEGORY_ZONE, 170.0, 130.0, glyph = ZoneGlyph.Camera, colorHex = 0xFF4A6FA5),
    ShapeMeta("welcome_desk", "Welcome Desk", CATEGORY_ZONE, 170.0, 85.0, glyph = ZoneGlyph.Clipboard, colorHex = 0xFF5A7A5E),
    ShapeMeta("buffet", "Buffet", CATEGORY_ZONE, 220.0, 90.0, glyph = ZoneGlyph.Restaurant, colorHex = 0xFFA2662E),
    ShapeMeta("lounge", "Lounge Area", CATEGORY_ZONE, 220.0, 160.0, glyph = ZoneGlyph.Sofa, colorHex = 0xFF7D6A9A),
    ShapeMeta("custom", "Custom Area", CATEGORY_ZONE, 190.0, 130.0, glyph = ZoneGlyph.Star, colorHex = 0xFFB8944F),
).associateBy { it.key }

/**
 * Catalogue entry for a stored shape value.
 *
 * Maps the legacy `rectangular` alias from the original two-shape model onto
 * `rectangle`, and falls back to a round table for anything unrecognised so a
 * row written by a newer organizer build degrades to a drawable element instead
 * of vanishing from the plan. Never index [SHAPES] directly.
 */
fun shapeMeta(shape: String?): ShapeMeta {
    val key = if (shape == "rectangular") "rectangle" else shape
    return SHAPES[key] ?: SHAPES.getValue("round")
}

/**
 * Zones are non-seating venue furniture.
 *
 * `elementType` is authoritative when present — it is what the API stores — and
 * the shape's own category covers rows written before that column existed, or
 * by a server too old to send it.
 */
fun VenueTableEntity.isZone(): Boolean =
    elementType == CATEGORY_ZONE || (elementType == null && shapeMeta(shape).isZone)

/** Rendered size in world units. Zones honour their stored size; tables never do. */
fun VenueTableEntity.worldWidth(): Double {
    val meta = shapeMeta(shape)
    return if (isZone()) width?.takeIf { it > 0 } ?: meta.w else meta.w
}

fun VenueTableEntity.worldHeight(): Double {
    val meta = shapeMeta(shape)
    return if (isZone()) height?.takeIf { it > 0 } ?: meta.h else meta.h
}

/** Percentage of the world → world units. */
fun pctToWorld(pct: Double?, total: Double): Double = (pct ?: 0.0) / 100.0 * total

/**
 * The element's axis-aligned box in world units — the one primitive every fit,
 * hit-test and label placement uses. Rotation is ignored, the same
 * simplification the web maps make.
 *
 * [x] / [y] are the TOP-LEFT corner. Read the file header before assuming
 * otherwise: treating them as a centre scrambles the layout rather than
 * shifting it.
 */
data class WorldBox(val x: Double, val y: Double, val w: Double, val h: Double) {
    val right: Double get() = x + w
    val bottom: Double get() = y + h
    val centerX: Double get() = x + w / 2
    val centerY: Double get() = y + h / 2
}

fun VenueTableEntity.boxOf(): WorldBox = WorldBox(
    x = pctToWorld(positionX, WORLD_W),
    y = pctToWorld(positionY, WORLD_H),
    w = worldWidth(),
    h = worldHeight(),
)

fun VenueTableEntity.centerX(): Double = boxOf().centerX
fun VenueTableEntity.centerY(): Double = boxOf().centerY

/** Degrees, defaulted rather than nullable — every drawing site needs a number. */
fun VenueTableEntity.rotationDegrees(): Float = (rotation ?: 0.0).toFloat()

/**
 * Whether this list is a LAYOUT at all, as opposed to a list of table names.
 *
 * Two ways it can fail to be one, and both are reachable:
 *
 *  1. NO COORDINATES. A tablet prepared before the geometry shipped holds rows
 *     with a name and nothing else — every coordinate null. Drawing those would
 *     stack the entire venue on the canvas origin.
 *  2. ONE COORDINATE, MANY ELEMENTS. `position_x` defaults to 0 server-side, and
 *     the organizer's Add panel gives every item in a BATCH the same
 *     viewport-derived point (`page.js` computes it once, outside the loop). An
 *     organizer who added twenty tables and never dragged them apart has twenty
 *     elements at one position — a pile, not a room. It is visible and fixable in
 *     their own editor, but the tablet must not present a pile as a floor plan.
 *
 * So: at least two elements that carry a position, at DISTINCT positions. Below
 * that every surface falls back to the table numeral alone, which is the
 * behaviour the tablet already had and is never wrong.
 */
fun List<VenueTableEntity>.isDrawablePlan(): Boolean {
    val positioned = filter { it.positionX != null && it.positionY != null }
    if (positioned.size < 2) return false
    return positioned.distinctBy { it.positionX to it.positionY }.size >= 2
}

/**
 * The bounding box of an entire layout, padded, in world units.
 *
 * Padded because an element flush against the edge of its own bounding box
 * reads as clipped — and the guest's table carries a locator ring drawn OUTSIDE
 * its outline, which would be the first thing cut off.
 */
fun List<VenueTableEntity>.worldBounds(padding: Double = 40.0): WorldBox {
    if (isEmpty()) return WorldBox(0.0, 0.0, WORLD_W, WORLD_H)

    var minX = Double.MAX_VALUE
    var minY = Double.MAX_VALUE
    var maxX = -Double.MAX_VALUE
    var maxY = -Double.MAX_VALUE

    forEach { el ->
        val box = el.boxOf()
        if (box.x < minX) minX = box.x
        if (box.y < minY) minY = box.y
        if (box.right > maxX) maxX = box.right
        if (box.bottom > maxY) maxY = box.bottom
    }

    return WorldBox(
        x = minX - padding,
        y = minY - padding,
        w = (maxX - minX + padding * 2).coerceAtLeast(1.0),
        h = (maxY - minY + padding * 2).coerceAtLeast(1.0),
    )
}
