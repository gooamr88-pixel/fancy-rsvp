package com.fancyrsvp.checkin.ui.seating

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.data.local.VenueTableEntity
import com.fancyrsvp.checkin.ui.theme.UiFont

/**
 * The plan as an object you can put on a screen: a sheet of paper with the room
 * drawn on it and its key printed at the foot.
 *
 * ── The sheet is cut to the room ──
 *
 * The card takes its size from the PLAN, not from the space it was offered.
 * Sizing it to the available box and letting the plan fit inside left a band of
 * blank paper wherever the room's proportions and the pane's disagreed — which
 * is always, since the pane's height on the result screen is whatever the table
 * numeral did not take. A floor plan with two inches of margin down one side
 * reads as a mis-sized image, not as a card.
 *
 * That is also why the width is set EXPLICITLY below rather than left to wrap.
 * The key inside is a `fillMaxWidth` row, and `fillMaxWidth` in a wrap-width
 * Column resolves against the incoming max constraint, not against its
 * siblings — so the card would silently stretch to the whole pane and the paper
 * would extend past the drawing on it.
 *
 * ── And the key is printed ON it ──
 *
 * The key sat on the result screen's own coloured ground first, where a zone's
 * pale swatch had to hold up against deep green and turned to mud — and it put
 * the plan's vocabulary outside the plan. On the sheet, under a hairline, it is
 * the key of a printed floor plan, and every swatch is back on the near-white it
 * was designed against.
 */

/** How much paper surrounds the drawing on each side. */
private val CARD_INSET = 12.dp
private val CARD_INSET_COMPACT = 8.dp

/**
 * Below this the card is not worth drawing, and the caller offers the expanded
 * plan instead. A 90dp sheet of paper is not a floor plan — it is a smudge that
 * looks like a rendering fault.
 */
val PLAN_CARD_MIN_WIDTH = 190.dp
val PLAN_CARD_MIN_HEIGHT = 150.dp

/** And below this there is no room for a key under the drawing. */
private val LEGEND_MIN_CARD_HEIGHT = 230.dp

/**
 * Where a second row of key becomes affordable.
 *
 * One row names three of a wedding's twelve zones and says "+9", which is a key
 * that mostly declines to answer. Two rows name seven, and on a pane this tall
 * they cost nothing — the plan is limited by the pane's WIDTH at these
 * proportions, so the height they take was going to be blank paper.
 */
private val LEGEND_TWO_ROW_MIN_HEIGHT = 300.dp

/**
 * One row of key, fixed. Used for BOTH the height the card sets aside and the
 * height the row is drawn at, so the two can never disagree.
 *
 * 24dp against a 22dp swatch: a row exactly as tall as the thing inside it
 * clips that thing's own border on some densities.
 */
private val LEGEND_ROW_HEIGHT = 24.dp
private val LEGEND_ROW_GAP = 5.dp

/** The rule between the drawing and its key. Counted, because it is drawn. */
private val LEGEND_HAIRLINE = 1.dp

@Composable
fun SeatingPlanCard(
    elements: List<VenueTableEntity>,
    myTableId: String?,
    maxWidth: Dp,
    maxHeight: Dp,
    compact: Boolean,
    onExpand: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val inset = if (compact) CARD_INSET_COMPACT else CARD_INSET
    val legend = remember(elements) { planLegend(elements) }
    val showLegend = legend.isNotEmpty() && maxHeight >= LEGEND_MIN_CARD_HEIGHT
    val legendRows = if (!compact && maxHeight >= LEGEND_TWO_ROW_MIN_HEIGHT) 2 else 1
    // Reserved BEFORE the plan is fitted, so the key can never push the drawing
    // past the bottom of the card it is printed on.
    val legendVerticalPadding = if (compact) 14.dp else 22.dp
    val legendHeight = if (showLegend) {
        LEGEND_HAIRLINE +
            LEGEND_ROW_HEIGHT * legendRows +
            LEGEND_ROW_GAP * (legendRows - 1) +
            legendVerticalPadding
    } else {
        0.dp
    }

    val layout = rememberPlanLayout(
        elements = elements,
        myTableId = myTableId,
        boxWidth = maxWidth - inset * 2,
        boxHeight = maxHeight - inset * 2 - legendHeight,
    ) ?: return

    val planWidth = with(density) { layout.widthPx.toDp() }
    val cardWidth = planWidth + inset * 2
    val radius = if (compact) 14.dp else 18.dp
    val description = stringResource(
        if (myTableId != null) R.string.plan_card_description else R.string.plan_card_description_no_table,
    )

    Column(
        modifier = modifier
            .width(cardWidth)
            // A hairline and ONE soft cast, so the sheet reads as paper lying on
            // the ground beneath it rather than as a panel painted onto it.
            .shadow(if (compact) 8.dp else 14.dp, RoundedCornerShape(radius), clip = false)
            .clip(RoundedCornerShape(radius))
            .background(PlanPaper)
            .border(1.dp, PlanInk.copy(alpha = 0.10f), RoundedCornerShape(radius))
            .semantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.padding(inset)) {
            SeatingPlanSurface(layout) {
                if (onExpand != null) {
                    ExpandMark(
                        compact = compact,
                        onClick = onExpand,
                        modifier = Modifier.align(Alignment.TopEnd),
                    )
                }
            }
        }
        if (showLegend) {
            PlanLegendStrip(
                items = legend,
                compact = compact,
                rows = legendRows,
                availableWidth = cardWidth,
            )
        }
    }
}

/**
 * The mark that says the card opens.
 *
 * It carries its own click, but it is NOT the only way in: `ScanResultScreen`
 * makes the whole card tappable, because an usher pointing a guest through a
 * room is not going to hunt a 30dp target. This exists to say the card is
 * tappable at all — without it the sheet reads as a picture.
 */
@Composable
private fun ExpandMark(
    compact: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val boxSize = if (compact) 26.dp else 30.dp
    Box(
        modifier = modifier
            .padding(if (compact) 8.dp else 12.dp)
            .size(boxSize)
            .clip(RoundedCornerShape(8.dp))
            .background(Color.White.copy(alpha = 0.94f))
            .border(1.dp, PlanInk.copy(alpha = 0.10f), RoundedCornerShape(8.dp))
            // Indication suppressed: a Material ripple on a sheet of paper is
            // the one place in this app where the platform's own feedback would
            // look wrong. It must still be an ENABLED clickable — a disabled one
            // does not CONSUME the tap, it opts out of input, so every press
            // would fall through to the result screen's dismiss-anywhere.
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(boxSize * 0.48f)) {
            val s = size.minDimension
            val w = s * 0.16f
            fun stroke(x1: Float, y1: Float, x2: Float, y2: Float) {
                drawLine(PlanGoldMid, Offset(x1, y1), Offset(x2, y2), strokeWidth = w, cap = StrokeCap.Round)
            }
            // Two arrows out of opposite corners — the universal "expand", drawn
            // rather than imported for the same reason as every other mark here.
            stroke(s * 0.06f, s * 0.38f, s * 0.06f, s * 0.06f)
            stroke(s * 0.06f, s * 0.06f, s * 0.38f, s * 0.06f)
            stroke(s * 0.10f, s * 0.10f, s * 0.44f, s * 0.44f)
            stroke(s * 0.94f, s * 0.62f, s * 0.94f, s * 0.94f)
            stroke(s * 0.94f, s * 0.94f, s * 0.62f, s * 0.94f)
            stroke(s * 0.90f, s * 0.90f, s * 0.56f, s * 0.56f)
        }
    }
}

/**
 * THE KEY — what the shapes on the plan are called.
 *
 * The plan is drawn clean: a table carries its number, a zone carries a glyph,
 * and a zone only carries its NAME when it is drawn large enough to set one.
 * That is what keeps fourteen captions from competing with the one table the
 * screen exists to point at. It only works if the names are said SOMEWHERE.
 *
 * [rows] is how many the surface can spare — one on the card, several on the
 * expanded plan. What does not fit is COUNTED rather than dropped silently, so a
 * reader can see the key is abridged rather than believing it is complete.
 */
@Composable
fun PlanLegendStrip(
    items: List<LegendItem>,
    compact: Boolean,
    rows: Int,
    availableWidth: Dp,
    modifier: Modifier = Modifier,
) {
    if (items.isEmpty()) return

    val density = LocalDensity.current
    val swatch = if (compact) 18.dp else 22.dp
    val glyph = if (compact) 11.dp else 14.dp
    val font = if (compact) 11.sp else 13.sp
    val hPad = if (compact) 10.dp else 16.dp
    val gap = if (compact) 12.dp else 18.dp

    val fit = remember(items, availableWidth, rows, compact, density) {
        with(density) {
            legendFitting(
                items = items,
                availableWidthPx = (availableWidth - hPad * 2).toPx(),
                fontSizePx = font.toPx(),
                swatchPx = swatch.toPx(),
                gapPx = gap.toPx(),
                rows = rows,
            )
        }
    }

    Column(modifier.fillMaxWidth()) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(LEGEND_HAIRLINE)
                .background(PlanInk.copy(alpha = 0.10f)),
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = hPad, vertical = if (compact) 7.dp else 11.dp),
            verticalArrangement = Arrangement.spacedBy(LEGEND_ROW_GAP),
        ) {
            fit.rows.forEachIndexed { index, row ->
                Row(
                    /*
                     * A FIXED height, not a wrapped one.
                     *
                     * The card reserves exactly LEGEND_ROW_HEIGHT per row before
                     * the plan is fitted. A row that wrapped would exceed that
                     * the moment an operator raised the system font size — 13sp
                     * at a 1.3 scale is taller than the 22dp swatch beside it —
                     * and the card would grow past the pane it was measured for
                     * and get clipped at the bottom. Pinning it means the key
                     * gets exactly the room that was set aside for it, and the
                     * type inside ellipsises rather than the sheet overflowing.
                     */
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(LEGEND_ROW_HEIGHT),
                    horizontalArrangement = Arrangement.spacedBy(gap, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    row.forEach { item -> LegendChip(item, swatch, glyph, font) }
                    // The count of what did not fit rides on the LAST row, where
                    // a reader has just run out of names — not on its own line,
                    // which would look like a thirteenth zone called "+5".
                    if (index == fit.rows.lastIndex && fit.hidden > 0) {
                        Text(
                            text = "+${fit.hidden}",
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = UiFont,
                                fontSize = font,
                                fontWeight = FontWeight.Medium,
                            ),
                            color = PlanInk.copy(alpha = 0.45f),
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LegendChip(
    item: LegendItem,
    swatch: Dp,
    glyphSize: Dp,
    fontSize: TextUnit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(swatch)
                .clip(RoundedCornerShape(5.dp))
                .background(item.color.copy(alpha = 0.18f))
                .border(1.dp, item.color.copy(alpha = 0.37f), RoundedCornerShape(5.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (item.glyph != null) {
                Canvas(Modifier.size(glyphSize)) {
                    drawZoneGlyph(
                        glyph = item.glyph,
                        left = 0f,
                        top = 0f,
                        size = size.minDimension,
                        color = item.color,
                        alpha = 1f,
                    )
                }
            }
        }
        Spacer(Modifier.width(6.dp))
        Text(
            // The host's own name for the zone — see planLegend. A key that says
            // "Bar" for a zone the invitation calls the Champagne Bar is the
            // plan quietly disagreeing with everything the guest was told.
            text = if (item.count > 1) "${item.label}  ×${item.count}" else item.label,
            style = MaterialTheme.typography.bodySmall.copy(
                fontFamily = UiFont,
                fontSize = fontSize,
                fontWeight = FontWeight.Medium,
            ),
            color = PlanInk.copy(alpha = 0.62f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
