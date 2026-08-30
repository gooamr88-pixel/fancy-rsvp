package com.fancyrsvp.checkin.ui.seating

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import com.fancyrsvp.checkin.data.local.VenueTableEntity
import com.fancyrsvp.checkin.ui.theme.UiFont
import com.fancyrsvp.checkin.ui.theme.displayFamilyFor
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The room, drawn.
 *
 * ── Why this is one Canvas and not thirty composables ──
 *
 * The web maps place every element as an absolutely-positioned `<div>`, which is
 * the only thing a browser offers. Compose would let this be thirty `Box`es with
 * offset modifiers, and it should not be: a forty-element venue would be forty
 * layout nodes plus their chairs — several hundred — measured and laid out on
 * every frame of a pinch, on the low-end tablet this app targets. The plan is
 * geometry that has already been resolved to absolute coordinates, so it is
 * drawn, once, into one node.
 *
 * The consequence is that text goes through a [TextMeasurer] rather than a
 * `Text` composable, which is exactly what `drawText` exists for.
 */

// ── Layout ──────────────────────────────────────────────────────────────────

/** One element, placed in the plan's own screen space. */
data class PlacedElement(
    val element: VenueTableEntity,
    val rect: PlanRect,
    val isMine: Boolean,
)

/**
 * Everything about a drawn plan that does not change frame to frame: where each
 * element lands, how big the whole drawing is, and at what scale.
 *
 * Computed ONCE, before anything is painted. The web version worked this out
 * inside its render loop, which meant an element knew where it was and nothing
 * else knew where anything was — and a zone cannot decide where to put its name
 * without knowing which tables are drawn over it. Positions first, then
 * obstacles, then paint.
 */
data class PlanLayout(
    val placed: List<PlacedElement>,
    val obstacles: List<PlanRect>,
    val widthPx: Float,
    val heightPx: Float,
    val scale: Float,
    val hasMine: Boolean,
)

/**
 * Fits a whole room into [boxWidthPx] x [boxHeightPx].
 *
 * ── THE WHOLE ROOM, ALWAYS ──
 *
 * An earlier version reframed to a window around the guest's own table whenever
 * the full-room fit pushed a table below a legibility floor. It was wrong at
 * every size it was tried at: elements sliced by the card's edge read as a
 * rendering fault rather than as a detail view, and on a phone the window closed
 * down to four tables, which is not a room at all.
 *
 * A plan that does not show the whole room answers no question an usher has.
 * Losing the chairs and the pin at small sizes is the correct trade — the gold
 * fill and the locator ring are the marker on their own, and the expanded plan
 * is where detail lives.
 */
fun computePlanLayout(
    elements: List<VenueTableEntity>,
    myTableId: String?,
    boxWidthPx: Float,
    boxHeightPx: Float,
): PlanLayout? {
    if (elements.isEmpty() || boxWidthPx <= 0f || boxHeightPx <= 0f) return null

    val bounds = elements.worldBounds()
    val scale = min(boxWidthPx / bounds.w, boxHeightPx / bounds.h).toFloat()
    if (!scale.isFinite() || scale <= 0f) return null

    val placed = elements.map { el ->
        val box = el.boxOf()
        PlacedElement(
            element = el,
            rect = PlanRect(
                x = ((box.x - bounds.x) * scale).toFloat(),
                y = ((box.y - bounds.y) * scale).toFloat(),
                w = (box.w * scale).toFloat(),
                h = (box.h * scale).toFloat(),
            ),
            // A ZONE is never "mine", whatever the id says. A seating assignment
            // always points at a seatable table, but a stale or colliding id
            // would otherwise light up the dance floor as the guest's table.
            isMine = myTableId != null && el.id == myTableId && !el.isZone(),
        )
    }

    return PlanLayout(
        placed = placed,
        obstacles = labelObstacles(placed.map { it.element to it.rect }),
        widthPx = (bounds.w * scale).toFloat(),
        heightPx = (bounds.h * scale).toFloat(),
        scale = scale,
        hasMine = placed.any { it.isMine },
    )
}

@Composable
fun rememberPlanLayout(
    elements: List<VenueTableEntity>,
    myTableId: String?,
    boxWidth: Dp,
    boxHeight: Dp,
): PlanLayout? {
    val density = LocalDensity.current
    return remember(elements, myTableId, boxWidth, boxHeight, density) {
        with(density) {
            computePlanLayout(elements, myTableId, boxWidth.toPx(), boxHeight.toPx())
        }
    }
}

// ── Painting ────────────────────────────────────────────────────────────────

/**
 * The plan itself, at exactly the size [layout] worked out.
 *
 * Draws the ruled floor, then the zones, then the tables — and that order is not
 * negotiable. A zone painted over a table would hide the very thing an usher is
 * hunting for, which is why [zoneLabelFor] has to move a zone's NAME out from
 * under the tables rather than simply raising the zone.
 *
 * [content] is a slot over the finished plan, for anything that is chrome rather
 * than room — the expand mark on the card.
 */
@Composable
fun SeatingPlanSurface(
    layout: PlanLayout,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit = {},
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val planWidth = with(density) { layout.widthPx.toDp() }
    val planHeight = with(density) { layout.heightPx.toDp() }

    Box(modifier.size(width = planWidth, height = planHeight)) {
        Canvas(Modifier.fillMaxSize()) {
            drawRuledFloor(layout.scale)
            drawEdgeShade()

            // Zones behind, tables in front. Both passes iterate the same list
            // rather than two pre-split ones, so an element can never appear in
            // neither pass if `isZone()` ever changes its mind mid-frame.
            layout.placed.forEach { if (it.element.isZone()) drawZone(it, layout, measurer) }
            layout.placed.forEach { if (!it.element.isZone()) drawTable(it, layout, measurer) }
        }
        content()
    }
}

/**
 * The ruled floor. A property of the ROOM, so it grows with the tables when the
 * plan is zoomed, exactly as a printed plan would.
 *
 * Drawn as lines rather than as a tiled brush so a rule is always exactly one
 * pixel wide. A fractional line inside a scaled layer gets partial coverage on
 * some columns and not others, which is what made the web grid look banded and
 * blotchy before it was fixed there.
 */
private fun DrawScope.drawRuledFloor(scale: Float) {
    val module = floorModulePx(scale)
    if (module < 4f) return

    var x = 0f
    while (x <= size.width) {
        drawLine(PlanFloorRule, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
        x += module
    }
    var y = 0f
    while (y <= size.height) {
        drawLine(PlanFloorRule, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
        y += module
    }
}

/**
 * The paper's edge, and only its edge.
 *
 * The web version of this was a radial that put a wash across the whole sheet
 * and a bloom through its middle, which is why the plan looked like it had been
 * left in the sun. What a sheet of paper actually needs is the faintest
 * darkening where it meets its own edge, and nothing in the middle at all.
 */
private fun DrawScope.drawEdgeShade() {
    drawRect(
        brush = Brush.radialGradient(
            0.62f to Color.Transparent,
            1f to PlanEdgeShade,
            center = center,
            radius = max(size.width, size.height) * 0.72f,
        ),
    )
}

// ── Zones ───────────────────────────────────────────────────────────────────

private fun DrawScope.drawZone(
    placed: PlacedElement,
    layout: PlanLayout,
    measurer: TextMeasurer,
) {
    val el = placed.element
    val r = placed.rect
    val color = zoneColor(el)
    val dim = if (layout.hasMine) PLAN_DIM_OTHERS else 1f
    val radius = max(3f, 12f * layout.scale)
    val glyph = shapeMeta(el.shape).glyph
    val glyphSize = zoneGlyphSize(r.w, r.h)
    val label = zoneLabelFor(el, r, layout.obstacles)

    /*
     * ONE flat tint of the zone's own hue, and no shadow. A gradient plus an
     * inner highlight plus a drop shadow made every zone look like a button; a
     * floor plan's zones are AREAS of the room, and an area is a wash, not an
     * object.
     */
    rotate(el.rotationDegrees(), pivot = Offset(r.centerX(), r.centerY())) {
        drawRoundRect(
            color = zoneFill(color),
            topLeft = Offset(r.x, r.y),
            size = Size(r.w, r.h),
            cornerRadius = CornerRadius(radius, radius),
            alpha = dim,
        )
        drawRoundRect(
            color = zoneEdge(color),
            topLeft = Offset(r.x, r.y),
            size = Size(r.w, r.h),
            cornerRadius = CornerRadius(radius, radius),
            alpha = dim,
            style = Stroke(width = 1f),
        )
    }

    /*
     * The glyph and the name are drawn UNROTATED, in whichever band the
     * placement chose. A zone is drawn at the organizer's rotation; its name is
     * still read straight, exactly as the table numerals are — a plan with
     * angled zones that makes an usher tilt their head is precisely the
     * cheapness this design removes.
     */
    val gap = if (label != null) max(1f, label.sizePx * 0.28f) else 0f
    val stackHeight = if (label != null) glyphSize + gap + label.sizePx * 1.1f else glyphSize
    val unrotatedTop = when {
        label == null -> r.y + (r.h - stackHeight) / 2f
        label.justify == JUSTIFY_FOOT -> r.y + r.h - label.insetPx - stackHeight
        label.justify == JUSTIFY_HEAD -> r.y + label.insetPx
        else -> r.y + (r.h - stackHeight) / 2f
    }

    /*
     * ── The stack's POSITION turns with the zone; its ORIENTATION does not ──
     *
     * The mark is drawn outside the `rotate` block so the name is read straight,
     * which is right. But the first version also PLACED it in unrotated
     * coordinates, and that is only harmless for the centre band: a rotation
     * about the zone's own centre leaves the centre fixed, so a centred stack
     * lands correctly by accident.
     *
     * The foot and head bands are offset from that centre, and an offset has to
     * turn with the shape. The displacement is 2·sin(θ/2) times the offset — on
     * a 35-degree stage that measured 22px, which is visibly off its band but
     * still on the shape; on a small zone, or a heavily rotated one, it walks off
     * the shape entirely and the name floats on bare paper.
     *
     * So the stack's centre point is rotated about the zone's centre, and the
     * glyph and the name are then drawn upright around that point. That is also
     * exactly where the web puts it — there the mark is a flex CHILD of the
     * rotated element, so its offset is expressed locally and carried by the
     * parent's transform. Verified against that model for all three bands.
     */
    val rotationRad = Math.toRadians(el.rotationDegrees().toDouble())
    val cosR = cos(rotationRad).toFloat()
    val sinR = sin(rotationRad).toFloat()
    val offsetY = (unrotatedTop + stackHeight / 2f) - r.centerY()
    val stackCenterX = r.centerX() - offsetY * sinR
    val stackCenterY = r.centerY() + offsetY * cosR
    val stackTop = stackCenterY - stackHeight / 2f

    // A glyph bigger than the zone containing it is not a mark, it is a
    // collision — a 150x70 entrance is exactly the case.
    if (glyph != null && r.w > glyphSize && r.h > glyphSize) {
        drawZoneGlyph(
            glyph = glyph,
            left = stackCenterX - glyphSize / 2f,
            top = stackTop,
            size = glyphSize,
            color = color,
            alpha = ZONE_GLYPH_OPACITY * dim,
        )
    }

    if (label == null) return

    /*
     * INK, not the zone's own hue. Ten-pixel tracked capitals in a 7%-tint
     * colour on near-white paper is the definition of mud, and with five zones
     * it was five different muds. The GLYPH keeps the hue — that is what
     * colour-codes the zone, at a size where colour actually reads — and the
     * name is set in the same ink as every table numeral, so the plan speaks
     * with one voice.
     */
    val measured = measurer.measure(
        text = label.text.uppercase(),
        style = TextStyle(
            fontFamily = UiFont,
            fontSize = label.sizePx.toSp(),
            fontWeight = FontWeight.Bold,
            letterSpacing = (label.sizePx * 0.08f).toSp(),
            color = PlanInk.copy(alpha = 0.66f * dim),
        ),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        constraints = Constraints(maxWidth = max(1, (r.w * 0.92f).toInt())),
    )
    drawText(
        textLayoutResult = measured,
        topLeft = Offset(
            x = stackCenterX - measured.size.width / 2f,
            y = stackTop + glyphSize + gap,
        ),
    )
}

// ── Tables ──────────────────────────────────────────────────────────────────

private fun DrawScope.drawTable(
    placed: PlacedElement,
    layout: PlanLayout,
    measurer: TextMeasurer,
) {
    val el = placed.element
    val r = placed.rect
    val meta = shapeMeta(el.shape)
    val mine = placed.isMine
    val dim = if (layout.hasMine && !mine) PLAN_DIM_OTHERS else 1f
    val pivot = Offset(r.centerX(), r.centerY())

    /*
     * The soft ground under the guest's table — drawn BEFORE the table and never
     * as its child. A child would be clipped by a round table's own outline and
     * would inherit its rotation, and a glow that rotates with a table reads as
     * a smear.
     *
     * 2.2x the table at 14% gold. At the 3.4x and 30% it started at, it was a
     * dinner-plate of colour reaching the tables either side of the guest's —
     * and with the table itself solid gold it was competing with the very thing
     * it exists to point at.
     */
    if (mine) {
        val gw = r.w * 2.2f
        val gh = r.h * 2.2f
        drawOval(
            brush = Brush.radialGradient(
                0f to PlanGoldMid.copy(alpha = 0.14f),
                0.45f to PlanGoldMid.copy(alpha = 0.06f),
                0.7f to Color.Transparent,
                center = pivot,
                radius = max(gw, gh) / 2f,
            ),
            topLeft = Offset(pivot.x - gw / 2f, pivot.y - gh / 2f),
            size = Size(gw, gh),
        )
    }

    rotate(el.rotationDegrees(), pivot = pivot) {
        if (mine) {
            /*
             * THE ONE LOUD THING. Solid gold, and a white keyline to lift it off
             * the paper. The numeral on it goes white, which is what actually
             * makes it findable at a glance; the pale-gold gradient it replaced
             * carried a brown numeral and needed a 90px glow to be seen at all.
             */
            drawTableFill(
                round = meta.round,
                r = r,
                scale = layout.scale,
                brush = Brush.linearGradient(
                    0f to PlanGoldLight,
                    0.55f to PlanGoldMid,
                    1f to PlanGoldDeep,
                    start = Offset(r.x, r.y),
                    end = Offset(r.right(), r.bottom()),
                ),
            )
            drawTableOutline(meta.round, r, layout.scale, Color.White, max(1.5f, 7f * layout.scale))
        } else {
            /*
             * An ordinary table: white, one hairline, NO SHADOW.
             *
             * The shadow is the single biggest thing that made the web plan look
             * cheap. At 45px of blur under every one of forty tables the paper
             * carried forty overlapping brown clouds — and because they were on
             * EVERY table, they distinguished nothing while dirtying everything.
             * A drawn plan uses an outline; depth is for the one table that
             * matters.
             */
            drawTableFill(meta.round, r, layout.scale, color = PlanTableFill, alpha = dim)
            drawTableOutline(
                round = meta.round,
                r = r,
                scale = layout.scale,
                color = PlanTableEdge.copy(alpha = PlanTableEdge.alpha * dim),
                width = max(1f, 1.6f * layout.scale),
            )
        }

        if (seatsFit(r.h)) {
            /*
             * The chairs. The single detail that makes this read as a venue
             * rather than a diagram: a bare circle is a shape, a circle with ten
             * chairs around it is a table for ten.
             *
             * ── Drawn AFTER the table, and the guest's are GOLD ──
             *
             * Both of those are corrections, and the second is a real defect
             * carried over from the web plan that this port inherited.
             *
             * `seatPositions` puts a chair SEAT_GAP units OUTSIDE the table's
             * edge — that is the whole point, a chair is not on the table. So the
             * guest's chairs do not sit on the gold fill at all; they sit on the
             * near-white paper. Drawing them white-on-white made the one table
             * that must be findable the only table on the plan with no visible
             * chairs. Rendered side by side it reads as a mistake, because it is
             * one.
             *
             * Deep gold instead: they belong to the gold table, they are legible
             * on paper, and the ring of ten still says "a table for ten" — which
             * is what chairs are on this plan for.
             *
             * Drawing them after the fill rather than before also matches the web,
             * where they are children of the element. It only shows at the
             * threshold where a chair's inner edge meets the 7-unit white keyline
             * on the guest's own table.
             */
            val d = seatDiameter(layout.scale)
            val seatColor = if (mine) PlanGoldDeep.copy(alpha = 0.85f) else PlanInk.copy(alpha = 0.28f)
            seatPositions(el).forEach { pos ->
                drawCircle(
                    color = seatColor,
                    radius = d / 2f,
                    center = Offset(r.x + pos.x * layout.scale, r.y + pos.y * layout.scale),
                    alpha = dim,
                )
            }
        }
    }

    // Outside the rotate block, deliberately. The web draws the numeral as a
    // child of the table and counter-rotates it; not rotating it in the first
    // place is the same rule said once instead of twice.
    drawTableNumeral(placed, layout, measurer, dim)
    if (mine) drawMineMarker(placed, layout)
}

private fun DrawScope.drawTableNumeral(
    placed: PlacedElement,
    layout: PlanLayout,
    measurer: TextMeasurer,
    dim: Float,
) {
    val r = placed.rect
    if (!numeralFits(r.h)) return
    val numeral = planNumeral(placed.element.name) ?: return

    val sizePx = numeralSizePx(r.h)
    val measured = measurer.measure(
        text = numeral,
        style = TextStyle(
            // Serif, because a numeral in a text face is what an engraved plan
            // or a place card looks like — a geometric sans numeral in a circle
            // reads as a data label.
            //
            // Sized from PIXELS via toSp(), which divides by the font scale that
            // rendering will multiply back. That is not an oversight: this
            // numeral has to fit INSIDE a drawn table, so it must not grow when
            // the operator has raised the system font size. Every other piece of
            // type in this app does grow.
            fontFamily = displayFamilyFor(numeral),
            fontSize = sizePx.toSp(),
            fontWeight = if (placed.isMine) FontWeight.Bold else FontWeight.Medium,
            letterSpacing = (sizePx * 0.01f).toSp(),
            // WHITE on the guest's own table, near-solid ink on every other.
            color = if (placed.isMine) Color.White else PlanInk.copy(alpha = 0.9f * dim),
        ),
        maxLines = 1,
        overflow = TextOverflow.Clip,
    )
    drawText(
        textLayoutResult = measured,
        topLeft = Offset(
            x = r.centerX() - measured.size.width / 2f,
            y = r.centerY() - measured.size.height / 2f,
        ),
    )
}

/**
 * The mark on the guest's own table: a pin above it when there is room for one,
 * and the locator ring when there is not.
 *
 * Mutually exclusive on purpose. Both at once is two devices saying the same
 * thing, and the pin already sits proud of the table — a ring around a table
 * that also carries a pin reads as a shooting target, not as a marker.
 */
private fun DrawScope.drawMineMarker(placed: PlacedElement, layout: PlanLayout) {
    val r = placed.rect
    val meta = shapeMeta(placed.element.shape)

    if (!markerFits(r.h)) {
        // Constant screen inset, following the element's own outline. A circle
        // at a multiple of the table's size covered the stage above it when the
        // table was a 250-unit head table.
        val g = locatorRingInset()
        val ring = PlanRect(r.x - g, r.y - g, r.w + g * 2f, r.h + g * 2f)
        rotate(placed.element.rotationDegrees(), pivot = Offset(r.centerX(), r.centerY())) {
            drawTableOutline(meta.round, ring, layout.scale, locatorRingColor(), 1.5f)
        }
        return
    }

    /*
     * A mark, not a word. This replaced a "★ You're here" pill that set at 8px
     * on a card — illegible — and was wider than the 96-unit table it pointed
     * at, so on a dense plan it covered the two neighbouring tables.
     *
     * WHITE disc, GOLD star. The table underneath is solid gold, and a gold disc
     * on a gold table is a smudge on a smudge; a white pin reads as pinned to
     * it, which is what it is.
     */
    val s = max(11f, min(r.w * 0.4f, 26f))
    val center = Offset(r.centerX(), r.y - s * 0.16f)

    drawCircle(
        color = PlanInk.copy(alpha = 0.18f),
        radius = s / 2f,
        center = Offset(center.x, center.y + s * 0.1f),
    )
    drawCircle(color = Color.White, radius = s / 2f, center = center)
    drawZoneGlyph(
        glyph = ZoneGlyph.Star,
        left = center.x - s * 0.3f,
        top = center.y - s * 0.3f,
        size = s * 0.6f,
        color = PlanGoldMid,
        alpha = 1f,
    )
}

// ── Shape primitives ────────────────────────────────────────────────────────

private fun PlanRect.right(): Float = x + w
private fun PlanRect.bottom(): Float = y + h
private fun PlanRect.centerX(): Float = x + w / 2f
private fun PlanRect.centerY(): Float = y + h / 2f

/** A table's silhouette: an ellipse for the round shapes, a soft rect otherwise. */
private fun DrawScope.drawTableFill(
    round: Boolean,
    r: PlanRect,
    scale: Float,
    brush: Brush? = null,
    color: Color = Color.Unspecified,
    alpha: Float = 1f,
) {
    if (round) {
        if (brush != null) {
            drawOval(brush = brush, topLeft = Offset(r.x, r.y), size = Size(r.w, r.h), alpha = alpha)
        } else {
            drawOval(color = color, topLeft = Offset(r.x, r.y), size = Size(r.w, r.h), alpha = alpha)
        }
        return
    }
    val radius = max(3f, 9f * scale)
    val corner = CornerRadius(radius, radius)
    if (brush != null) {
        drawRoundRect(brush = brush, topLeft = Offset(r.x, r.y), size = Size(r.w, r.h), cornerRadius = corner, alpha = alpha)
    } else {
        drawRoundRect(color = color, topLeft = Offset(r.x, r.y), size = Size(r.w, r.h), cornerRadius = corner, alpha = alpha)
    }
}

private fun DrawScope.drawTableOutline(
    round: Boolean,
    r: PlanRect,
    scale: Float,
    color: Color,
    width: Float,
) {
    val stroke = Stroke(width = width)
    if (round) {
        drawOval(color = color, topLeft = Offset(r.x, r.y), size = Size(r.w, r.h), style = stroke)
        return
    }
    val radius = max(3f, 9f * scale)
    drawRoundRect(
        color = color,
        topLeft = Offset(r.x, r.y),
        size = Size(r.w, r.h),
        cornerRadius = CornerRadius(radius, radius),
        style = stroke,
    )
}
