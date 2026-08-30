package com.fancyrsvp.checkin.ui.seating

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import com.fancyrsvp.checkin.data.local.VenueTableEntity
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Seating plan — THE look, on the tablet.
 *
 * [SeatingGeometry] answers *where* an element sits. This answers what it looks
 * like once it gets there. It is a port of
 * `frontend/src/app/utils/seatingPlanStyle.js`, so the room an usher sees at the
 * door is the same drawing the guest was emailed.
 *
 * ── THE RULE THIS MODULE ENFORCES ──
 *
 * NOTHING ON THE PLAN IS NAMED. Tables carry a NUMBER; zones carry a glyph.
 *
 * "Table 12" is a name — eight characters that render at about seven pixels on a
 * card this size, unreadable, while still pulling the eye evenly across thirty
 * tables, which is the exact opposite of what this plan is for. "12" is a
 * number: one or two characters, so it can be set three times larger in the same
 * space and actually be read, the way a numeral is set on a printed floor plan.
 *
 * The word "Table" is dropped, not the identity. It is stated once, in full, at
 * full size, immediately above the plan — that is what the whole destination
 * pane of the result screen is — and the plan itself carries only the numeral.
 *
 * ── THE ROOM IS QUIET AND ONE THING IS LOUD ──
 *
 * Near-white paper, a neutral hairline ruling, tables as plain white discs with
 * a hairline edge and NO SHADOW, zones as one restrained tint of their own hue.
 * The single loud object is the guest's table, and it is loud because it is the
 * only saturated, the only shadowed and the only white-on-dark thing on the
 * sheet — not because six effects are stacked on it.
 *
 * ── THE ONE DELIBERATE DIVERGENCE ──
 *
 * [locatorRingInset]. The guest studies their map; an usher glances at this one
 * for under two seconds with a queue forming. Everything else here is the web
 * drawing, unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The ink everything on the plan is drawn in. Warm near-black, not pure. */
val PlanInk = Color(0xFF1F1A12)

/** The paper. */
val PlanPaper = Color(0xFFFCFBF8)

/**
 * The plan's gold — the guest's own table.
 *
 * NOT the app's [com.fancyrsvp.checkin.ui.theme.Gold] (#8A6D34). That one is
 * tuned to clear 4.5:1 as TEXT on the app's parchment ground; this is a FILL on
 * near-white paper carrying a white numeral, and it is the same three stops the
 * web plan uses, so the two surfaces show a guest the same coloured table.
 */
val PlanGoldLight = Color(0xFFD9BB77)
val PlanGoldMid = Color(0xFFB8944F)
val PlanGoldDeep = Color(0xFF9A7A3C)

/** How far a chair sits from the edge of its table, in world units. */
private const val SEAT_GAP = 9.0

/** A chair's diameter in world units, and the floor it never renders below. */
private const val SEAT_SIZE = 10.0
private const val SEAT_MIN_PX = 1.8f

/** One floor module — the ruled grid on the paper, in world units. */
private const val FLOOR_MODULE = 100.0

/** The opacity a zone's glyph is drawn at. */
const val ZONE_GLYPH_OPACITY = 0.82f

// ── Chairs ──────────────────────────────────────────────────────────────────

/**
 * Chair positions for one element, in world units relative to its own top-left.
 *
 * The single detail that makes this read as a venue rather than a diagram: a
 * bare circle is a shape, a circle with ten chairs around it is a table for ten.
 * It also makes size mean something — a head table for twelve and a round table
 * for ten stop being "a long one and a small one".
 *
 * Capped at 14 because past that the pips merge into a solid ring at any scale
 * this plan is drawn at, and a solid ring reads as a border, not as seats.
 */
fun seatPositions(el: VenueTableEntity): List<Offset> {
    val meta = shapeMeta(el.shape)
    val capacity = min(el.capacity ?: meta.defaultCapacity ?: 10, 14)
    if (capacity <= 0) return emptyList()

    val w = el.worldWidth()
    val h = el.worldHeight()
    val out = ArrayList<Offset>(capacity)

    if (meta.round) {
        // Elliptical, not circular: an oval table is 132x86, and a circular ring
        // around it would float off the ends and cut through the sides.
        val rx = w / 2 + SEAT_GAP
        val ry = h / 2 + SEAT_GAP
        for (i in 0 until capacity) {
            val a = (i.toDouble() / capacity) * PI * 2 - PI / 2
            out.add(Offset((w / 2 + cos(a) * rx).toFloat(), (h / 2 + sin(a) * ry).toFloat()))
        }
        return out
    }

    // Rectangles seat along the two long edges, which is how the room is
    // actually laid out — nobody seats a guest at the end of a banquet table.
    val perSide = ceil(capacity / 2.0).toInt()
    for (i in 0 until perSide) {
        val x = ((i + 0.5) / perSide) * w
        out.add(Offset(x.toFloat(), (-SEAT_GAP).toFloat()))
        if (i * 2 + 1 < capacity) out.add(Offset(x.toFloat(), (h + SEAT_GAP).toFloat()))
    }
    return out
}

/** Chair diameter at a given scale, with a floor so it survives a small card. */
fun seatDiameter(scale: Float): Float = max(SEAT_MIN_PX, (SEAT_SIZE * scale).toFloat())

// ── The ruled floor ─────────────────────────────────────────────────────────

/**
 * The size of one square of the ruled floor, in SCREEN pixels.
 *
 * The module stays a property of the ROOM: zoom in and the ruling grows with the
 * tables, exactly as a printed plan would. But a hundred world units is a good
 * square at reading size and a 12px mesh on a card under a table numeral, where
 * it stops being a floor and becomes noise. It doubles until the square is at
 * least 22px on screen — powers of two, so every line of the coarser grid sits
 * on a line of the finer one and the ruling never appears to shift as it zooms.
 */
fun floorModulePx(scale: Float): Float {
    var module = (FLOOR_MODULE * scale).toFloat()
    var i = 0
    while (i < 8 && module < 22f) {
        module *= 2f
        i += 1
    }
    return max(module, 1f)
}

/**
 * The ruling's colour. Neutral, not gold-brown.
 *
 * A tinted grid over a tinted ground is what made the web plan look dirty before
 * the calming pass; a grey ruling at 5% reads as a drawing surface and
 * disappears the moment you look at a table.
 */
val PlanFloorRule = PlanInk.copy(alpha = 0.05f)

/** The paper's edge, and only its edge. Nothing in the middle at all. */
val PlanEdgeShade = PlanInk.copy(alpha = 0.05f)

// ── What a table is painted in ──────────────────────────────────────────────

/**
 * An ordinary table: white, one hairline, NO SHADOW.
 *
 * The shadow is the single biggest thing that made the web plan look cheap. At
 * 45px of blur under every one of forty tables the paper carried forty
 * overlapping brown clouds — and because they were on every table, they
 * distinguished nothing while dirtying everything. A drawn plan uses an outline;
 * depth is for the one table that matters.
 */
val PlanTableFill = Color(0xFFFFFFFF)
val PlanTableEdge = PlanInk.copy(alpha = 0.38f)

/**
 * The dim applied to everything that is not the guest's table.
 *
 * 0.82 and NO desaturation, and only when the guest actually HAS a table. An
 * earlier web pass dropped the room to 0.58 and desaturated it, which did make
 * the gold table jump out — off a plan so washed the guest could no longer tell
 * the bar from the buffet. With no assignment the room renders at full strength,
 * because a plan where everything is dimmed just looks broken.
 */
const val PLAN_DIM_OTHERS = 0.82f

/** A zone: one flat tint of its own hue and a hairline of the same. No shadow. */
fun zoneFill(color: Color): Color = color.copy(alpha = 0.11f)
fun zoneEdge(color: Color): Color = color.copy(alpha = 0.35f)

/** The colour a zone is drawn in — the organizer's own, or the catalogue's. */
fun zoneColor(el: VenueTableEntity): Color {
    val fromRow = parseHexColor(el.color)
    if (fromRow != null) return fromRow
    val meta = shapeMeta(el.shape)
    return meta.colorHex?.let { Color(it) } ?: PlanGoldMid
}

/**
 * `#RGB`, `#RRGGBB` or `#AARRGGBB`, or null.
 *
 * Null rather than a thrown exception or a magenta default: `color` is free text
 * from an organizer's colour picker, and a row that somehow holds "teal" must
 * fall back to the catalogue's colour for its shape rather than take the plan
 * down or paint a zone in an alarm colour at a wedding.
 */
fun parseHexColor(value: String?): Color? {
    val raw = value?.trim()?.removePrefix("#") ?: return null
    val hex = when (raw.length) {
        3 -> raw.map { "$it$it" }.joinToString("")
        6, 8 -> raw
        else -> return null
    }
    val parsed = hex.toLongOrNull(16) ?: return null
    return if (hex.length == 6) Color(parsed or 0xFF000000L) else Color(parsed)
}

// ── The thresholds. Each one has a floor it must agree with ─────────────────

/**
 * ── THE FLOOR AND THE THRESHOLD HAVE TO AGREE ──
 *
 * They did not on the web, and it is why the thumbnail looked like a smudge.
 *
 * The numeral's size is floored at 7px so it is never hairline. The old test
 * admitted one from a table 13px across — and the floor then INFLATED it back to
 * 7px. A seven-pixel digit inside a thirteen-pixel circle is wider than half the
 * circle it is centred in, so every table carried a number bursting out of it.
 * Two guards, each doing its job in a direction the other did not know about.
 *
 * The threshold is the point at which the NATURAL size reaches the floor, so the
 * floor never has to inflate anything: below a 17px table there is no numeral at
 * all, and the table is named in full above the plan anyway.
 *
 * [heightPx] is always in SCREEN pixels. Every caller lays the plan out at final
 * size before asking.
 */
const val NUMERAL_MIN_PX = 7f
fun numeralFits(heightPx: Float): Boolean = heightPx * 0.42f >= NUMERAL_MIN_PX

/**
 * Chairs, same question.
 *
 * A chair is floored at 1.8px so it survives a small card — and around a 13px
 * table that produced ten 1.8px dots at a 1.3px gap, which is not ten chairs, it
 * is a fuzzy halo that makes the table look out of focus. A ring of pips only
 * says "a table for ten" when the pips can be told apart. 30px is where they
 * separate.
 */
fun seatsFit(heightPx: Float): Boolean = heightPx >= 30f

/**
 * And the pin.
 *
 * The star's disc is floored at 11px so it is never a speck — which on a small
 * card put an 11px pin on a 13px table, overlapping its top third. The two
 * merged into one gold-and-white blob, and the one element on the plan that
 * exists to be found was the hardest thing on it to read.
 *
 * Below this the pin is not drawn and [locatorRingInset] takes over.
 */
fun markerFits(heightPx: Float): Boolean = heightPx >= 26f

/**
 * ── THE LOCATOR RING — the one thing here the guest's map does not have ──
 *
 * Below [markerFits] the web plan relies on the gold fill alone, and for a guest
 * studying their own chart that is enough. An usher has under two seconds, in
 * dim decorative light, with a queue forming, and a 20px gold disc among thirty
 * white ones is findable but not INSTANT.
 *
 * So below the pin's threshold the table gets a gold hairline that follows its
 * own outline, inflated by a CONSTANT number of screen pixels. Constant is the
 * whole idea: as the room shrinks the locator does not, which is how a map pin
 * behaves and how a scaled highlight does not.
 *
 * Following the outline rather than drawing a circle at a multiple of the
 * table's size is not cosmetic either. The first version used `w * 1.9`, and
 * around a 250-unit head table that ring covered the stage above it.
 */
const val LOCATOR_RING_ALPHA = 0.6f
fun locatorRingInset(): Float = 9f
fun locatorRingColor(): Color = PlanGoldMid.copy(alpha = LOCATOR_RING_ALPHA)

/** Numeral size at a given drawn height, floored and capped. */
fun numeralSizePx(heightPx: Float): Float = min(max(NUMERAL_MIN_PX, heightPx * 0.42f), 30f)

/** Glyph size for a zone, from its drawn size. */
fun zoneGlyphSize(wPx: Float, hPx: Float): Float = max(9f, min(min(wPx, hPx) * 0.42f, 46f))

// ── The numeral ─────────────────────────────────────────────────────────────

/**
 * Digits, in the three scripts this product actually sees.
 *
 * Written as code points, never as literal characters. `Checkin-Next-Phases.md`
 * makes that a rule for the whole module: one altered byte in a character class
 * changes a contract for the entire fleet and is invisible in review.
 *
 * ٠-٩ are Arabic-Indic digits, ۰-۹ the Extended
 * (Persian/Urdu) forms — both count as digits on a plan.
 */
private const val DIGITS = "0-9\\u0660-\\u0669\\u06F0-\\u06F9"

/** Arabic letters (U+0621–U+064A), so a section letter works in either script. */
private const val LETTERS = "A-Za-z\\u0621-\\u064A"

/** Space, full stop, middle dot (U+00B7) or hyphen — the separators a name uses. */
private const val SEPARATOR = "[\\s.\\u00B7-]"

/**
 * A trailing number, optionally prefixed by a short section letter.
 *
 * The leading `(?:^|SEPARATOR)` is load-bearing. Without it the optional letter
 * group is free to start mid-word and match the TAIL of the preceding one, so
 * "Table 12" comes out as "LE12". Anchoring the group to a word boundary means a
 * letter is only kept when it is genuinely a section marker of its own.
 *
 * ── Two things written the awkward way on purpose ──
 *
 * Every non-ASCII character is a `\\uXXXX` escape and never a literal. That is a
 * rule for this whole module (`Checkin-Next-Phases.md`): one altered byte in a
 * character class changes a contract for the entire fleet and is invisible in
 * review.
 *
 * The end anchor is `\\z`, not `$`. Partly because `$` immediately before a
 * closing quote in a Kotlin template string is ambiguous to read, and partly
 * because it is the FAITHFUL port: JavaScript's `$` without the `m` flag matches
 * only at the very end of the input, whereas Java's `$` also matches before a
 * final line terminator. `\\z` is the one that means the same thing on both
 * sides.
 */
private val TRAILING_NUMBER = Regex(
    "(?:^|" + SEPARATOR + ")([" + LETTERS + "]{0,2})" + SEPARATOR + "*([" + DIGITS + "]{1,3})\\s*\\z",
)

private val WHITESPACE = Regex("\\s+")
private val SEPARATORS = Regex("[\\s-]+")

/**
 * The numeral a table is marked with on the plan.
 *
 * Organizer table names in this product are overwhelmingly a bare number. On a
 * floor plan a bare numeral inside a drawn circle is unambiguous, and it is the
 * only form short enough to be set large enough to read.
 *
 * The cases, in order:
 *   "5"            -> "5"     already a numeral
 *   "Table 12"     -> "12"    the word is dropped, the number kept
 *   "Table A3"     -> "A3"    a section letter is part of the number
 *   "VIP"          -> "VIP"   short enough to set as-is
 *   "Rose Garden"  -> "RG"    initials, so a named table is still marked
 *   ""             -> null    nothing to draw
 *
 * Never longer than three characters, because four is the point at which the
 * type has to shrink below the table's own legibility floor.
 */
fun planNumeral(tableName: String?): String? {
    val name = tableName?.trim().orEmpty()
    if (name.isEmpty()) return null

    // Whitespace stripped, not preserved: "T 3" is one mark on a plan, and the
    // gap would be set at the numeral's own size — a third of the table taken by
    // a space.
    if (name.length <= 3) return name.replace(WHITESPACE, "").uppercase()

    TRAILING_NUMBER.find(name)?.let { m ->
        return (m.groupValues[1] + m.groupValues[2]).uppercase()
    }

    val initials = name.split(SEPARATORS)
        .filter { it.isNotEmpty() }
        .take(2)
        .map { it.first() }
        .joinToString("")
    return initials.uppercase().ifEmpty { null }
}

// ── Zone names, and where they are allowed to go ────────────────────────────

private const val ZONE_LABEL_MIN_PX = 8f
private const val ZONE_LABEL_MAX_PX = 15f

/**
 * Which band of its zone a name ended up in.
 *
 * Named rather than 0/1/2 because the caller has to reproduce the placement to
 * draw it, and a bare integer that has to agree across two files is the kind of
 * thing that silently inverts.
 */
const val JUSTIFY_CENTER = 0
const val JUSTIFY_FOOT = 1
const val JUSTIFY_HEAD = 2

/** A zone's name, its size, and which band of the zone it may sit in. */
data class ZoneLabel(
    val text: String,
    val sizePx: Float,
    /** One of [JUSTIFY_CENTER], [JUSTIFY_FOOT], [JUSTIFY_HEAD]. */
    val justify: Int,
    val insetPx: Float,
)

/** A rectangle in the plan's own screen space, for the collision test. */
data class PlanRect(val x: Float, val y: Float, val w: Float, val h: Float)

private fun overlaps(a: PlanRect, b: PlanRect): Boolean =
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * ── A ZONE MAY CARRY ITS OWN NAME, WHEN THERE IS ROOM FOR IT ──
 *
 * The glyph-and-legend rule is a rule about SMALL zones, and it had been applied
 * to all of them. "DANCE FLOOR" set inside a 130px DJ booth either shrinks below
 * reading size or spills over the table next to it — that is real, and it is why
 * the names came off. But a 420x150 stage has room for its name three times
 * over, and making an usher hunt a key at the foot of the plan to learn that the
 * microphone is the stage is friction that zone never had to cost them.
 *
 * So the question is asked per zone, in the RENDERED PIXELS the element actually
 * measures — the same stage is a comfortable label on the expanded plan and an
 * illegible smear on the card under the numeral, and this returns a label for
 * the first and null for the second without either caller knowing why.
 *
 * ── AND IT GOES WHERE NOTHING IS COVERING IT ──
 *
 * A zone is painted BEHIND the tables, and that order is not negotiable: an
 * usher hunting table 13 must see table 13, not a dance floor drawn over it. The
 * consequence is that a host who puts a table inside a zone — which is exactly
 * what a dance floor with a cocktail table on it looks like — gets "DANCE
 * FL(o)OR", the middle of the name hidden under a circle.
 *
 * So the name is PLACED rather than positioned: the glyph and the name move
 * together to the first band of the zone that nothing is sitting on. Centred if
 * it is clear, then the foot, then the head. If a table covers all three the
 * name is dropped and the legend carries it, because half a name is worse than
 * no name — it reads as a different room.
 *
 * @param box the zone's rectangle in the plan's screen space.
 * @param obstacles every TABLE's rectangle, in that same space.
 */
fun zoneLabelFor(
    el: VenueTableEntity,
    box: PlanRect,
    obstacles: List<PlanRect>,
): ZoneLabel? {
    if (!el.isZone()) return null
    val meta = shapeMeta(el.shape)
    val text = (el.name.takeIf { it.isNotBlank() } ?: meta.label).trim()
    if (text.isEmpty() || box.w <= 0f || box.h <= 0f) return null

    val glyph = zoneGlyphSize(box.w, box.h)

    /*
     * 0.72em per character: ~0.64 for uppercase sans plus the 0.08 of tracking
     * the label is set with. Measured on the web, not guessed — 0.62 sized
     * "Dance Floor" at 285px into a 276px slot and clipped the last letter.
     * Erring wide sends a name that would only just have fitted to the legend
     * instead, which is the harmless direction to be wrong in.
     */
    val byWidth = (box.w * 0.84f) / max(1f, text.length * 0.72f)
    // And it has to sit UNDER the glyph without either of them touching an edge.
    val byHeight = (box.h - glyph) * 0.42f
    val size = min(min(byWidth, byHeight), ZONE_LABEL_MAX_PX)
    if (size < ZONE_LABEL_MIN_PX) return null

    val gap = max(1f, size * 0.28f)
    val stackH = glyph + gap + size * 1.1f
    val stackW = max(glyph, text.length * size * 0.72f)
    val inset = size * 0.35f
    val cx = box.x + box.w / 2

    // Centred if it is clear, then the foot, then the head. If a table covers
    // all three the name is dropped and the key carries it.
    val bands = listOf(
        JUSTIFY_CENTER to box.y + (box.h - stackH) / 2,
        JUSTIFY_FOOT to box.y + box.h - inset - stackH,
        JUSTIFY_HEAD to box.y + inset,
    )

    for ((justify, y) in bands) {
        val rect = PlanRect(cx - stackW / 2, y, stackW, stackH)
        if (obstacles.none { overlaps(rect, it) }) {
            return ZoneLabel(text = text, sizePx = size, justify = justify, insetPx = inset)
        }
    }
    return null
}

/**
 * The things a zone's name has to keep out from under: every element drawn on
 * top of it, which is every table.
 */
fun labelObstacles(placed: List<Pair<VenueTableEntity, PlanRect>>): List<PlanRect> =
    placed.filterNot { it.first.isZone() }.map { it.second }

// ── The key ─────────────────────────────────────────────────────────────────

/** One row of the plan's key. */
data class LegendItem(
    val key: String,
    val label: String,
    val glyph: ZoneGlyph?,
    val color: Color,
    val count: Int,
)

/**
 * The zones present on a plan, for the key.
 *
 * The key is what makes a glyph cost the reader nothing: the plan stays clean,
 * and "what is that purple square" is answered once underneath it. Ordered by
 * first appearance rather than by position, so the same venue always produces
 * the same key.
 *
 * ── IT USES THE HOST'S OWN NAME, NOT THE CATALOGUE'S ──
 *
 * Keying on `shape` alone and printing the catalogue's label meant a host who
 * named their zone "Champagne Bar" got a key that said "Bar" — the plan and the
 * key quietly disagreeing with the invitation, the signage and everything the
 * guest had been told. Two zones of the same shape with different names also
 * collapsed into one row, so one of them vanished from the key entirely.
 *
 * Keyed on shape AND name: same shape, same name folds together and counts;
 * same shape, different names stay as separate rows.
 */
fun planLegend(elements: List<VenueTableEntity>): List<LegendItem> {
    val seen = LinkedHashMap<String, LegendItem>()
    for (el in elements) {
        if (!el.isZone()) continue
        val meta = shapeMeta(el.shape)
        val shape = if (el.shape == "rectangular") "rectangle" else (el.shape ?: meta.key)
        val label = el.name.trim().ifEmpty { meta.label }
        val key = "$shape::${label.lowercase()}"
        val existing = seen[key]
        if (existing != null) {
            seen[key] = existing.copy(count = existing.count + 1)
        } else {
            seen[key] = LegendItem(
                key = key,
                label = label,
                glyph = meta.glyph,
                color = zoneColor(el),
                count = 1,
            )
        }
    }
    return seen.values.toList()
}

/**
 * What of the key actually fits, laid out into rows, and how much did not.
 *
 * The ROWS are the output rather than a flat list, because the caller has to
 * draw them and re-deciding the wrap in the composable would be a second copy of
 * this arithmetic that could disagree with the height already reserved for it.
 */
data class LegendFit(val rows: List<List<LegendItem>>, val hidden: Int) {
    val shown: List<LegendItem> get() = rows.flatten()
}

/**
 * How much of the key fits in [availableWidthPx] across [rows] rows.
 *
 * ── Why this is arithmetic and not a layout ──
 *
 * `FlowRow` can cap its own rows, but the overflow API for it is experimental
 * and would decide this at layout time — by which point the card has already
 * been sized, and a key that grew a second row would push the plan off the
 * bottom of a pane whose height was computed from a one-row key. The card's
 * height has to be known before it is drawn, so what fits is worked out here.
 *
 * Chip width is estimated, not measured: swatch + gap + the label at roughly
 * 0.56em per character for this face at these sizes. Erring WIDE is the harmless
 * direction — it sends a name that would only just have fitted to the "+N"
 * instead of letting the row wrap and overflow the card.
 */
fun legendFitting(
    items: List<LegendItem>,
    availableWidthPx: Float,
    fontSizePx: Float,
    swatchPx: Float,
    gapPx: Float,
    rows: Int,
): LegendFit {
    if (items.isEmpty() || rows <= 0 || availableWidthPx <= 0f) {
        return LegendFit(emptyList(), items.size)
    }

    fun chipWidth(item: LegendItem): Float {
        val text = if (item.count > 1) "${item.label}  x${item.count}" else item.label
        return swatchPx + gapPx * 0.5f + text.length * fontSizePx * 0.56f
    }

    val laid = ArrayList<MutableList<LegendItem>>()
    var current = ArrayList<LegendItem>()
    var used = 0f
    var placed = 0

    for (item in items) {
        val w = chipWidth(item)
        val withGap = if (current.isEmpty()) w else w + gapPx
        if (used + withGap > availableWidthPx && current.isNotEmpty()) {
            // This row is full. Start another, unless that was the last one.
            if (laid.size + 1 >= rows) {
                laid.add(current)
                current = ArrayList()
                break
            }
            laid.add(current)
            current = ArrayList()
            used = 0f
        }
        // The first chip of a row always goes in, even when it alone overruns: a
        // key holding nothing but a "+12" tells a reader less than nothing.
        current.add(item)
        used += if (current.size == 1) w else w + gapPx
        placed += 1
    }
    if (current.isNotEmpty()) laid.add(current)

    // Room for the "+N" itself is taken OUT of the last chip rather than added
    // beside it — otherwise the indicator is the thing that overflows the row.
    if (placed < items.size) {
        val last = laid.lastOrNull()
        if (last != null && last.size > 1) {
            last.removeAt(last.size - 1)
            placed -= 1
        }
    }

    return LegendFit(laid.filter { it.isNotEmpty() }, items.size - placed)
}
