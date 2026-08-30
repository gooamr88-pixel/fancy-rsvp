package com.fancyrsvp.checkin.ui.seating

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser

/**
 * The fourteen venue-zone marks.
 *
 * ── Why they are drawn and not imported ──
 *
 * Same reasoning as every other mark in this app: no icon dependency, and no
 * font glyph that might be missing on a vendor ROM at a venue with no network.
 * A zone whose icon failed to resolve would render as an empty coloured box, and
 * the guest's own table is the only thing on this plan allowed to be ambiguous —
 * which is to say, nothing is.
 *
 * ── The source of truth ──
 *
 * Each path is transcribed verbatim from `frontend/src/app/components/icons/
 * Icon.js`, which draws the same zones on the guest's own seating map and on the
 * printed chart. They are 24x24 stroke drawings — no fills, rounded caps and
 * joins, one weight — so a zone reads identically on a tablet at a door and on
 * the plan the guest was emailed.
 *
 * `PathParser` handles the `d` strings; the `<rect>` and `<circle>` primitives
 * the SVG uses have no path data, so they are expressed as SVG path commands
 * here rather than as a second drawing mechanism. A rounded rect becomes an
 * arc-cornered path and a circle becomes two half-arcs — both exact, and both
 * checked against the original box.
 */
enum class ZoneGlyph {
    Mic,
    DiscoBall,
    Cocktail,
    Headphones,
    Door,
    Restroom,
    CoatHanger,
    Gift,
    Cake,
    Camera,
    Clipboard,
    Restaurant,
    Sofa,
    Star,
}

/** The box every path below is drawn in, matching the SVG's `viewBox`. */
private const val GLYPH_BOX = 24f

/**
 * `<rect x y width height rx>` as path data.
 *
 * Written out rather than drawn with `drawRoundRect` so a glyph is always ONE
 * path object: the parts of a mark have to share a stroke width and scale, and
 * two drawing mechanisms in one glyph is how the disco ball ends up with a
 * heavier outline than its facets.
 */
private fun rect(x: Float, y: Float, w: Float, h: Float, r: Float = 0f): String {
    if (r <= 0f) return "M$x $y h$w v$h h${-w} Z"
    return buildString {
        append("M${x + r} $y")
        append(" h${w - 2 * r}")
        append(" a$r $r 0 0 1 $r $r")
        append(" v${h - 2 * r}")
        append(" a$r $r 0 0 1 ${-r} $r")
        append(" h${-(w - 2 * r)}")
        append(" a$r $r 0 0 1 ${-r} ${-r}")
        append(" v${-(h - 2 * r)}")
        append(" a$r $r 0 0 1 $r ${-r}")
        append(" Z")
    }
}

/** `<circle cx cy r>` as two half-arcs — the form SVG path data expresses a circle in. */
private fun circle(cx: Float, cy: Float, r: Float): String =
    "M${cx - r} $cy a$r $r 0 1 0 ${r * 2} 0 a$r $r 0 1 0 ${-r * 2} 0 Z"

/**
 * The path data for each mark, concatenated exactly as the SVG stacks its
 * children. Transcribed from Icon.js — if one of those drawings changes, this is
 * the file that has to change with it.
 */
private fun pathData(glyph: ZoneGlyph): String = when (glyph) {
    ZoneGlyph.Mic ->
        rect(9.5f, 3f, 5f, 10f, 2.5f) +
            " M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6"

    ZoneGlyph.DiscoBall ->
        circle(12f, 11f, 6.2f) +
            " M12 4.8v12.4 M5.8 11h12.4 M7.4 6.4l9.2 9.2 M16.6 6.4 7.4 15.6" +
            " M12 2.5v2.3 M12 19.2v2.3"

    ZoneGlyph.Cocktail ->
        "M5 4h14l-7 8.2L5 4Z M12 12.2V20 M8 20h8 M7.2 6h9.6"

    ZoneGlyph.Headphones ->
        "M4 15v-3a8 8 0 0 1 16 0v3 " +
            rect(3f, 14f, 4.2f, 6f, 1.6f) + " " +
            rect(16.8f, 14f, 4.2f, 6f, 1.6f)

    ZoneGlyph.Door ->
        rect(5.5f, 3f, 13f, 18f, 1.2f) + " " + circle(14.6f, 12f, 0.9f)

    ZoneGlyph.Restroom ->
        rect(4f, 3f, 16f, 18f, 2.5f) + " " + circle(12f, 9.3f, 2.3f) +
            " M8.3 17.5c.5-3 1.8-4.3 3.7-4.3s3.2 1.3 3.7 4.3"

    ZoneGlyph.CoatHanger ->
        circle(12f, 4.3f, 1.3f) +
            " M12 5.6v1.6 M12 7.2 3.5 15c-1 .8-.5 2.2.8 2.2h15.4c1.3 0 1.8-1.4.8-2.2L12 7.2Z" +
            " M6 15.5h12"

    ZoneGlyph.Gift ->
        rect(4f, 9.5f, 16f, 11f, 1.2f) +
            " M4 13.2h16 M12 9.5V20.5" +
            " M12 9.5c-1.3-4.2-6.5-4.4-6.5-1.2 0 1.6 2 1.9 6.5 1.2Z" +
            " M12 9.5c1.3-4.2 6.5-4.4 6.5-1.2 0 1.6-2 1.9-6.5 1.2Z"

    ZoneGlyph.Cake ->
        "M5 20.5V13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7.5 M3.5 20.5h17" +
            " M9 11V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3 M12 7V4.3" +
            " M12 4.3c-.9-.7-.9-1.5 0-2.3.9.8.9 1.6 0 2.3Z M5 16.5h14"

    ZoneGlyph.Camera ->
        "M4 8.5h3l1.4-2h7.2l1.4 2h3v11H4v-11Z " + circle(12f, 14f, 3.6f)

    ZoneGlyph.Clipboard ->
        rect(5f, 4.5f, 14f, 17f, 2f) + " " + rect(8.5f, 3f, 7f, 3f, 1f) +
            " M8.5 11h7 M8.5 15h7 M8.5 19h4"

    ZoneGlyph.Restaurant ->
        "M6 3v8a2 2 0 0 0 4 0V3 M8 3v18 M8 11V3" +
            " M17 3c-1.6 0-2.5 2-2.5 4.5S15.4 12 17 12v9"

    ZoneGlyph.Sofa ->
        "M5 12.5V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3.5" +
            " M3.5 12.5h17v5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 17.5v-5Z" +
            " M5 17v2.5 M19 17v2.5" +
            " M3.5 13.5a1.5 1.5 0 0 0 0 3 M20.5 13.5a1.5 1.5 0 0 0 0 3"

    ZoneGlyph.Star ->
        "M12 3.5 14.6 9.2 20.8 9.9 16.2 14.1 17.5 20.3 12 17.1 6.5 20.3 7.8 14.1 3.2 9.9 9.4 9.2 12 3.5Z"
}

/**
 * Parsed paths, held for the life of the process.
 *
 * The plan redraws on every frame of a pan or a zoom, and re-parsing fourteen
 * path strings per frame is work with a visible cost on the low-end tablet this
 * app targets. The map is populated lazily, so a venue with two zones never
 * parses the other twelve.
 */
private val parsed = HashMap<ZoneGlyph, Path>(ZoneGlyph.entries.size)

private fun pathFor(glyph: ZoneGlyph): Path = parsed.getOrPut(glyph) {
    PathParser().parsePathString(pathData(glyph)).toPath().apply {
        // The marks are open strokes with self-crossing sub-paths (the disco
        // ball's facets, the cake's tiers). NonZero would let a renderer treat
        // an enclosed region as filled if a fill is ever applied; EvenOdd keeps
        // the drawing behaving like the outline it is.
        fillType = PathFillType.EvenOdd
    }
}

/**
 * Draws one zone mark, centred in a [size]-square box at [left], [top].
 *
 * The stroke is scaled with the glyph so the mark keeps the weight it has in the
 * original 24-unit drawing — a fixed 1.6dp stroke on a 10dp glyph is a blob and
 * on a 46dp glyph is a hairline. Below about 9dp the mark is texture rather than
 * information and the caller should not be drawing one at all; see
 * `zoneGlyphSize`.
 */
fun DrawScope.drawZoneGlyph(
    glyph: ZoneGlyph,
    left: Float,
    top: Float,
    size: Float,
    color: Color,
    alpha: Float = ZONE_GLYPH_OPACITY,
) {
    if (size <= 0f) return
    val scale = size / GLYPH_BOX

    translate(left = left, top = top) {
        // Pivot at the origin of the space `translate` just established, so the
        // glyph grows out of its own top-left corner rather than out of the
        // centre of the whole plan.
        scale(scale, pivot = Offset.Zero) {
            drawPath(
                path = pathFor(glyph),
                color = color,
                alpha = alpha,
                style = Stroke(
                    width = 1.6f,
                    cap = StrokeCap.Round,
                    join = StrokeJoin.Round,
                ),
            )
        }
    }
}
