package com.fancyrsvp.checkin.ui.seating

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.data.local.VenueTableEntity
import com.fancyrsvp.checkin.ui.components.BackToScannerBar
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.components.SectionLabel
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.displayFamilyFor
import com.fancyrsvp.checkin.ui.theme.safeChrome
import kotlin.math.max

/**
 * The room, full screen, pannable and zoomable.
 *
 * ── What this is for ──
 *
 * The card on the result screen answers "which part of the room". This answers
 * "walk me there": it is opened when an usher is about to point a guest across a
 * venue, and it is the only surface in this app where somebody is expected to
 * LOOK at something for more than two seconds.
 *
 * So it is the opposite of the result screen in one specific way — it does not
 * time out, and it does not dismiss on a stray tap. There is one way out, and it
 * is a full-width bar, because the operator's other hand is holding the tablet.
 *
 * ── The transform, and why it is a graphicsLayer ──
 *
 * The plan is drawn once at its fitted size and then SCALED as a layer, rather
 * than re-laid-out at each zoom level. Re-fitting would re-run every zone's
 * label placement on every frame of a pinch — a rectangle test per table per
 * zone — and, worse, zone names would appear and vanish as the scale crossed
 * their thresholds, which reads as flicker rather than as zoom.
 *
 * The cost is that the ruled floor and the hairlines scale with everything else,
 * so at 4x a table's outline is four pixels wide. That is what a paper plan
 * under a magnifier does, and it is the right trade here.
 */
@Composable
fun SeatingPlanOverlay(
    elements: List<VenueTableEntity>,
    myTableId: String?,
    tableName: String?,
    guestName: String?,
    onClose: () -> Unit,
) {
    val dimens = LocalDimens.current
    val density = LocalDensity.current
    val legend = remember(elements) { planLegend(elements) }
    val keyWidth = planKeyWidth()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            // Swallows taps so nothing underneath — in particular the result
            // screen's dismiss-anywhere — fires through this overlay and throws
            // an operator back to the camera mid-sentence.
            .pointerInput(Unit) { detectTapGestures { } }
            .safeChrome(),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = dimens.screenPadding)
                .padding(top = dimens.screenPadding * 0.5f),
        ) {
            PlanHeader(tableName = tableName, guestName = guestName, hasMine = myTableId != null)

            Spacer(Modifier.height(dimens.sectionGap * 0.6f))

            BoxWithConstraints(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                val layout = rememberPlanLayout(
                    elements = elements,
                    myTableId = myTableId,
                    boxWidth = maxWidth,
                    boxHeight = maxHeight,
                )

                if (layout == null) {
                    Text(
                        text = stringResource(R.string.plan_none),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    return@BoxWithConstraints
                }

                /*
                 * ── Held as state OBJECTS, not read into the composition ──
                 *
                 * These were `var zoom by remember { … }`, which reads the value
                 * in the composable's own scope. Every frame of a pinch then
                 * invalidated this scope, which recomposes SeatingPlanPaper and
                 * with it the Canvas — re-recording the whole forty-element room,
                 * text measurement and all, sixty times a second on the low-end
                 * tablet this app is for.
                 *
                 * Reading them only inside `graphicsLayer` (a draw-time lambda)
                 * and inside `derivedStateOf` means a pinch moves a layer that is
                 * already recorded and recomposes nothing at all.
                 */
                val zoomState = remember(layout) { mutableFloatStateOf(1f) }
                val panState = remember(layout) { mutableStateOf(Offset.Zero) }

                val viewportW = with(density) { maxWidth.toPx() }
                val viewportH = with(density) { maxHeight.toPx() }

                /*
                 * Pan is clamped so the sheet can never be flung off the screen.
                 * At 1x there is nothing to pan — the plan already fits — so the
                 * bound is zero and the gesture simply does nothing, which is
                 * far better than letting the room drift away and leaving an
                 * operator holding a blank rectangle with a queue at the door.
                 */
                // The paper is wider than the drawing by its own padding, and the
                // clamp has to know that or the last few dp of the sheet can
                // never be brought into view.
                val paperW = layout.widthPx + with(density) { PAPER_PADDING.toPx() } * 2f
                val paperH = layout.heightPx + with(density) { PAPER_PADDING.toPx() } * 2f

                fun clampPan(next: Offset, atZoom: Float): Offset {
                    val slackX = max(0f, paperW * atZoom - viewportW) / 2f
                    val slackY = max(0f, paperH * atZoom - viewportH) / 2f
                    return Offset(
                        x = next.x.coerceIn(-slackX, slackX),
                        y = next.y.coerceIn(-slackY, slackY),
                    )
                }

                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        // Without this the plan draws over the header and the
                        // way out the moment it is zoomed past the viewport.
                        .clipToBounds()
                        .pointerInput(layout) {
                            detectTransformGestures { _, panChange, zoomChange, _ ->
                                val next = (zoomState.floatValue * zoomChange)
                                    .coerceIn(MIN_ZOOM, MAX_ZOOM)
                                zoomState.floatValue = next
                                panState.value = clampPan(panState.value + panChange, next)
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    SeatingPlanPaper(
                        layout = layout,
                        modifier = Modifier.graphicsLayer {
                            scaleX = zoomState.floatValue
                            scaleY = zoomState.floatValue
                            translationX = panState.value.x
                            translationY = panState.value.y
                        },
                    )
                }

                /*
                 * Offered only when it would do something. A reset control on a
                 * plan already at rest is a button that does nothing, which
                 * teaches an operator to distrust the ones that do.
                 *
                 * `derivedStateOf` so this scope wakes when the ANSWER flips,
                 * not on every pinch frame — that is the whole point of holding
                 * the two as state objects above.
                 */
                val moved by remember(layout) {
                    derivedStateOf {
                        zoomState.floatValue != 1f || panState.value != Offset.Zero
                    }
                }
                if (moved) {
                    SecondaryAction(
                        text = stringResource(R.string.plan_reset),
                        onClick = {
                            zoomState.floatValue = 1f
                            panState.value = Offset.Zero
                        },
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(bottom = 8.dp),
                    )
                }
            }

            if (legend.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                // Every zone named. This is the one surface where somebody
                // actually reads the key, so nothing here is abridged.
                PlanLegendStrip(
                    items = legend,
                    compact = dimens.compact,
                    rows = 3,
                    availableWidth = keyWidth,
                )
                Spacer(Modifier.height(4.dp))
            }
        }

        BackToScannerBar(
            onClick = onClose,
            label = stringResource(R.string.plan_back),
        )
    }
}

@Composable
private fun PlanHeader(tableName: String?, guestName: String?, hasMine: Boolean) {
    Column {
        SectionLabel(
            text = stringResource(R.string.plan_title),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(6.dp))

        val heading = listOfNotNull(
            tableName?.takeIf { it.isNotBlank() },
            guestName?.takeIf { it.isNotBlank() },
        ).joinToString("  ·  ")

        if (heading.isNotEmpty()) {
            Text(
                text = heading,
                style = MaterialTheme.typography.displayMedium.copy(
                    // The face is chosen from the STRING: the display face has
                    // no Arabic glyphs, and most guests here have Arabic names.
                    fontFamily = displayFamilyFor(heading),
                ),
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (hasMine) {
            Spacer(Modifier.height(4.dp))
            Text(
                // "Marked in gold" rather than naming the star: the star is only
                // drawn above a size threshold (see markerFits), and the gold
                // fill is true at every size this plan is ever drawn at.
                text = stringResource(R.string.plan_marked_in_gold),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * How much paper surrounds the drawing on the expanded plan.
 *
 * Named, because the pan clamp has to add it back: the sheet is this much wider
 * than the room drawn on it, and a clamp measured from the drawing alone would
 * refuse to bring the sheet's own margin into view.
 */
private val PAPER_PADDING = 12.dp

/** The paper, with no key on it — the overlay prints the full key underneath. */
@Composable
private fun SeatingPlanPaper(layout: PlanLayout, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(20.dp)
    Box(
        modifier = modifier
            .shadow(18.dp, shape, clip = false)
            .background(PlanPaper, shape)
            .padding(PAPER_PADDING),
    ) {
        SeatingPlanSurface(layout)
    }
}

/**
 * The width the key may lay itself out across.
 *
 * The key sits OUTSIDE the `BoxWithConstraints` that measures the plan, and it
 * needs a budget rather than a measurement, so it takes the window's width less
 * the screen padding instead of wrapping a strip of chips in a second
 * constraints scope purely to ask how wide it is.
 */
@Composable
private fun planKeyWidth(): Dp {
    val configuration = LocalConfiguration.current
    val dimens = LocalDimens.current
    return (configuration.screenWidthDp.dp - dimens.screenPadding * 2).coerceAtLeast(120.dp)
}

/**
 * Zoom bounds.
 *
 * 1x is the whole room, which is where this opens: an usher who has to pinch
 * before they can see anything has been handed a worse tool than the card they
 * came from. 4x is enough to read a numeral on the densest plan this product
 * produces, and past it the hairlines coarsen into something that stops looking
 * like paper.
 */
private const val MIN_ZOOM = 1f
private const val MAX_ZOOM = 4f
