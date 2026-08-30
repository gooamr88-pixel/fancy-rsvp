package com.fancyrsvp.checkin.ui.scanner

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.data.repo.CheckInRepository
import com.fancyrsvp.checkin.ui.components.PrimaryAction
import com.fancyrsvp.checkin.ui.components.QuietAction
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.components.SectionLabel
import com.fancyrsvp.checkin.ui.components.pressableSurface
import com.fancyrsvp.checkin.ui.theme.BandAlready
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.Motion
import com.fancyrsvp.checkin.ui.theme.StateAlready
import com.fancyrsvp.checkin.ui.theme.StateAttention
import com.fancyrsvp.checkin.ui.theme.displayFamilyFor
import com.fancyrsvp.checkin.ui.theme.safeChrome
import java.text.DateFormat
import java.util.Date

/**
 * The scan result. This screen is the product.
 *
 * ── What it is designed against ──
 *
 * An usher hired that night, holding the tablet one-handed, in dim decorative
 * light, with a queue forming, looking at it for under two seconds. Everything
 * below follows from that and nothing else.
 *
 * ── The three rules ──
 *
 * 1. **The state is a full-screen colour.** Not a badge, not a tint, not a
 *    stripe down one edge. It must be recognisable from across a room by
 *    someone not looking directly at it, which means the whole screen changes
 *    or the signal does not carry. See ResultVisual for how the four states are
 *    separated by value rather than by hue.
 *
 * 2. **The table number is the largest thing on screen.** Larger than the
 *    guest's name, because the table is what staff say out loud. Sized from the
 *    string, since "12" and "The Rose Garden" cannot share a font size.
 *
 * 3. **One decision, or none.** A single full-width button admits the whole
 *    party. Choosing WHICH members arrived is a real requirement (§9.1) but it
 *    is not a door decision, so it lives behind a quiet link and an overlay.
 *
 * The screen leaves by itself, and on a tap anywhere. Staff must never hunt for
 * a way out while people wait.
 */
@Composable
fun ScanResultScreen(
    outcome: CheckInRepository.ScanOutcome,
    isSupervisor: Boolean,
    noKidsAllowed: Boolean,
    onAdmit: (party: CheckInRepository.PartyView, guestIds: List<String>) -> Unit,
    onOverride: (party: CheckInRepository.PartyView, guestIds: List<String>) -> Unit,
    onSearch: () -> Unit,
    onDismiss: () -> Unit,
) {
    val visual = outcome.visual()
    val party = outcome.partyOrNull()
    val dimens = LocalDimens.current
    var picking by remember(outcome) { mutableStateOf(false) }

    LaunchedEffect(outcome) {
        visual.autoDismissMillis?.let {
            kotlinx.coroutines.delay(it)
            onDismiss()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // A lit surface, not a fill. See ResultGround.
            .resultGround(visual)
            // Tap anywhere returns to the camera. No hit target to find, no back
            // button to hunt for. The primary action sits above this and
            // consumes its own taps.
            .clickable(onClick = onDismiss),
    ) {
        // VIP is the one state that MOVES. A slow sweep of light across the gold
        // — so it is recognised before a single word has been read, which is the
        // whole requirement for the state.
        if (visual == ResultVisual.Vip) {
            VipShimmer()
        }

        // Already-arrived is flooded from the top with its band colour. This is
        // the second signal that separates it from not-found, since both states
        // are light: one is drenched in amber, one has no colour at all.
        if (visual == ResultVisual.Already) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(14.dp)
                    .background(BandAlready),
            )
        }

        /*
         * ── Two panels, split along whichever axis the window is longer on ──
         *
         * WHO first, WHERE second, with a hairline seam between: side by side in
         * landscape, stacked in portrait.
         *
         * This screen has two readers at once and they want different things. The
         * usher needs the table number — it is the thing they say out loud — and
         * the guest, standing in front of the tablet, is looking for their own
         * name. Give them one shared column on the SHORT axis and they compete:
         * the table ends up either shrunk or pushed under the fold.
         *
         * So the split always runs along the long axis, and each reader gets a
         * half of the dimension there is most of. That also keeps the largest
         * element on the screen — the table — nearest the usher's thumb in both
         * shapes, rather than in the middle of the guest's sightline: at the right
         * hand in landscape, at the bottom in portrait.
         */
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                // The ground above stays full-bleed — a result screen that stopped
                // short of the edges would read as a card floating on the camera.
                // Only the content is pushed clear of the system bars.
                .safeChrome()
                .padding(
                    start = dimens.screenPadding,
                    end = dimens.screenPadding,
                    top = dimens.screenPadding * 0.5f,
                    bottom = dimens.screenPadding * 0.45f,
                ),
        ) {
            /*
             * Measured, not assumed. This was an unconditional Row, written when
             * the manifest locked the app to landscape; unlocking rotation turned
             * that assumption into a portrait layout with two half-width columns.
             */
            val sideBySide = maxWidth >= maxHeight

            val identity: @Composable (Modifier) -> Unit = { slot ->
                Column(
                    modifier = slot,
                    verticalArrangement = Arrangement.Center,
                ) {
                    // The content region is weighted and the action is NOT. If a very
                    // long name and a long fact list ever exceed the height, this
                    // region clips — the button never moves off the bottom of the
                    // screen. Losing a descender is survivable; losing the button is
                    // not.
                    Column(
                        modifier = Modifier.weight(1f, fill = false).fillMaxWidth(),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        when (visual) {
                            ResultVisual.Welcome, ResultVisual.Vip ->
                                WelcomeContent(
                                    party = party,
                                    visual = visual,
                                    noKidsAllowed = noKidsAllowed,
                                    wasExpired = outcome is CheckInRepository.ScanOutcome.Expired,
                                )

                            ResultVisual.Already -> AlreadyContent(party = party, visual = visual)

                            ResultVisual.NotFound -> NotFoundContent(visual = visual)

                            ResultVisual.Foreign -> ForeignCodeContent(visual = visual)
                        }
                    }

                    Spacer(Modifier.height(dimens.sectionGap))

                    Reveal(order = 4) {
                        ResultActions(
                            visual = visual,
                            party = party,
                            isSupervisor = isSupervisor,
                            onAdmit = onAdmit,
                            onOverride = onOverride,
                            onSearch = onSearch,
                            onDismiss = onDismiss,
                            onPickMembers = { picking = true },
                        )
                    }
                }
            }

            val destination: @Composable (Modifier) -> Unit = { slot ->
                Column(
                    modifier = slot,
                    verticalArrangement = Arrangement.Center,
                    // Pushed to the outer edge beside the seam in landscape; centred
                    // under it when the seam runs across the screen instead.
                    horizontalAlignment =
                        if (sideBySide) Alignment.End else Alignment.CenterHorizontally,
                ) {
                    Reveal(order = 3) {
                        ResultDestination(visual = visual, party = party)
                    }
                }
            }

            // The engraved seam. A hairline at 28% opacity, inset from both ends —
            // it reads as a fold in card stock rather than as a divider between
            // two panels of a form. It turns with the layout.
            val seam = visual.onGround.copy(alpha = 0.28f)

            if (sideBySide) {
                Row(
                    modifier = Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.spacedBy(dimens.sectionGap),
                ) {
                    // 1.15 against 1: the identity side carries more words, the table
                    // side carries one very large glyph. Equal halves would crowd the
                    // name and strand the number in whitespace.
                    identity(Modifier.weight(1.15f).fillMaxHeight())

                    Box(
                        Modifier
                            .padding(vertical = dimens.sectionGap)
                            .width(1.dp)
                            .fillMaxHeight()
                            .background(seam),
                    )

                    destination(Modifier.weight(1f).fillMaxHeight())
                }
            } else {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(dimens.sectionGap),
                ) {
                    identity(Modifier.weight(1.15f).fillMaxWidth())

                    Box(
                        Modifier
                            .padding(horizontal = dimens.sectionGap)
                            .height(1.dp)
                            .fillMaxWidth()
                            .background(seam),
                    )

                    destination(Modifier.weight(1f).fillMaxWidth())
                }
            }
        }

        if (picking && party != null) {
            MemberPickerOverlay(
                party = party,
                onConfirm = { ids ->
                    picking = false
                    onAdmit(party, ids)
                },
                onCancel = { picking = false },
            )
        }
    }
}

// ── The four states ──────────────────────────────────────────────────────────

@Composable
private fun WelcomeContent(
    party: CheckInRepository.PartyView?,
    visual: ResultVisual,
    noKidsAllowed: Boolean,
    wasExpired: Boolean,
) {
    if (party == null) return
    val on = visual.onGround

    Reveal(order = 0) {
        SectionLabel(
            text = stringResource(
                if (visual == ResultVisual.Vip) R.string.result_welcome_vip else R.string.result_welcome,
            ),
            color = on.copy(alpha = 0.75f),
        )
    }
    Spacer(Modifier.height(12.dp))

    Reveal(order = 1) { GuestName(party.label, visual.onGroundDisplay) }

    // Facts, as rows. The joined-string version this replaces is described at
    // FactRows — it was the detail that made the whole screen read as unfinished.
    val meals = party.members.mapNotNull { it.mealSelection }
        .groupingBy { it }.eachCount()
        .entries.joinToString(" · ") { (meal, count) ->
            if (count > 1) "$count × $meal" else meal
        }

    val facts = buildList {
        add(Fact(stringResource(R.string.result_fact_party), stringResource(R.string.result_party_of, party.members.size)))
        if (meals.isNotBlank()) add(Fact(stringResource(R.string.result_fact_meal), meals))
        party.notes?.takeIf { it.isNotBlank() }?.let {
            add(Fact(stringResource(R.string.result_fact_note), it, emphasised = true))
        }
        // Rules about the event, not about this party. Last, and never
        // emphasised over a guest's own access need above.
        if (noKidsAllowed) add(Fact(stringResource(R.string.result_fact_rule), stringResource(R.string.result_no_kids)))
        if (wasExpired) add(Fact(stringResource(R.string.result_fact_ticket), stringResource(R.string.result_expired_note)))
    }

    Spacer(Modifier.height(26.dp))
    Reveal(order = 2) { FactRows(facts, visual) }
}

@Composable
private fun AlreadyContent(party: CheckInRepository.PartyView?, visual: ResultVisual) {
    if (party == null) return
    val on = visual.onGround

    Reveal(order = 0) {
        SectionLabel(stringResource(R.string.result_already_title), color = on)
    }
    Spacer(Modifier.height(12.dp))

    Reveal(order = 1) { GuestName(party.label, visual.onGroundDisplay) }

    /*
     * WHO admitted them and WHEN — the two facts that settle a dispute at the
     * door without anyone having to look anything up.
     *
     * The first arrival carries the row, because the question is almost always
     * about the person standing there rather than about their whole party. The
     * party's overall progress goes in its own row underneath, which is what
     * tells an usher whether the rest are already inside.
     */
    val first = party.arrived.firstOrNull()
    val time = first?.arrivedAt?.let {
        DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it))
    }

    val facts = buildList {
        if (time != null) add(Fact(stringResource(R.string.result_fact_arrived), time))
        val by = listOfNotNull(first?.arrivedByStaff, first?.arrivedAtDevice)
        if (by.isNotEmpty()) add(Fact(stringResource(R.string.result_fact_by), by.joinToString(" · ")))
        add(
            Fact(
                stringResource(R.string.result_fact_party),
                stringResource(
                    R.string.result_already_progress,
                    party.arrived.size,
                    party.members.size,
                ),
            ),
        )
    }

    Spacer(Modifier.height(26.dp))
    Reveal(order = 2) { FactRows(facts, visual) }
}

@Composable
private fun NotFoundContent(visual: ResultVisual) {
    val on = visual.onGround

    Reveal(order = 0) {
        SectionLabel(stringResource(R.string.result_not_found_title), color = on.copy(alpha = 0.7f))
    }
    Spacer(Modifier.height(12.dp))

    // Calm, and never an error. A guest standing here has done nothing wrong,
    // and neither has the usher — the screen offers the next step instead of a
    // diagnosis. There is deliberately no red anywhere on it.
    Reveal(order = 1) {
        Text(
            stringResource(R.string.result_not_found_body),
            style = MaterialTheme.typography.displayMedium,
            color = on,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }

    Spacer(Modifier.height(26.dp))

    // Naming the LIKELY CAUSE is the part that actually resolves this. The old
    // screen said "search for them by name" and stopped, which tells an usher
    // what to press but nothing about what to type or why the code failed.
    Reveal(order = 2) {
        FactRows(
            listOf(
                Fact(
                    stringResource(R.string.result_fact_code),
                    stringResource(R.string.result_not_found_code),
                ),
                Fact(
                    stringResource(R.string.result_fact_likely),
                    stringResource(R.string.result_not_found_hint),
                ),
            ),
            visual,
        )
    }
}

/**
 * A code that is not one of ours (§8.4).
 *
 * ── What this screen has to accomplish in under two seconds ──
 *
 * The old version of this was the not-found screen: a pale panel reading "Not on
 * the list — search for them by name." That is actively misleading here. There is
 * no "them". The scanner read a loyalty card, or the QR on a poster behind the
 * queue, and telling an usher to search by name for it sends them into a text
 * field with nothing to type.
 *
 * So the screen states the ONE fact that matters — this is not an invitation —
 * and then says what to do about it in plain words. It is the only red ground in
 * the app, which makes it unmistakable against the pale not-found screen at a
 * glance, from an arm's length, in bad light.
 */
@Composable
private fun ForeignCodeContent(visual: ResultVisual) {
    val on = visual.onGround

    Reveal(order = 0) {
        SectionLabel(stringResource(R.string.result_foreign_label), color = on.copy(alpha = 0.75f))
    }
    Spacer(Modifier.height(12.dp))

    Reveal(order = 1) {
        Text(
            stringResource(R.string.result_foreign_title),
            style = MaterialTheme.typography.displayMedium,
            color = on,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }

    Spacer(Modifier.height(26.dp))

    // Says what happened AND what to do, because an usher reading this has a
    // guest in front of them and no idea whether the fault is theirs.
    Reveal(order = 2) {
        FactRows(
            listOf(
                Fact(
                    stringResource(R.string.result_fact_read),
                    stringResource(R.string.result_foreign_read),
                ),
                Fact(
                    stringResource(R.string.result_fact_next),
                    stringResource(R.string.result_foreign_body),
                ),
            ),
            visual,
        )
    }
}

// ── Surface, motion, structure ───────────────────────────────────────────────

/**
 * The state's ground, as a lit surface.
 *
 * Two passes. First a linear gradient from the lit stop to the shaded one along
 * the diagonal; then a radial highlight in the upper left, where the light is
 * coming from. That second pass is what stops the gradient reading as a
 * gradient — a plain two-stop ramp still looks like a CSS default, whereas a
 * ramp with a source on it looks like a surface under a lamp.
 *
 * A modifier rather than a wrapper composable, so it composes onto the existing
 * root Box without adding a layout node.
 */
private fun Modifier.resultGround(visual: ResultVisual): Modifier = this
    .background(
        Brush.linearGradient(
            colors = listOf(visual.ground, visual.groundDeep),
            start = Offset.Zero,
            end = Offset.Infinite,
        ),
    )
    .background(
        Brush.radialGradient(
            colors = listOf(
                // White on a dark ground, warm cream on a light one. Lifting a
                // pale sand ground with pure white flattens it instead.
                (if (visual.isDarkGround) Color.White else Color(0xFFFFFBF2))
                    .copy(alpha = if (visual.isDarkGround) 0.11f else 0.55f),
                Color.Transparent,
            ),
            // Off-canvas to the upper left: a highlight centred in the frame reads
            // as a spotlight aimed at the screen, not as ambient light in a room.
            center = Offset(-120f, -160f),
            radius = 1500f,
        ),
    )

/**
 * The entrance stagger.
 *
 * ── Why staggered and not all at once ──
 *
 * The whole screen used to scale up and fade in as one object, which is
 * indistinguishable from a page load. Bringing the parts in on a 70ms ladder —
 * label, name, table, actions — makes the result read as something ARRIVING in
 * front of the operator, which is what actually happened: a guest presented a
 * code and the answer appeared.
 *
 * Deliberately small and deliberately quick. 420ms on the house easing, 10dp of
 * travel, no scale, no overshoot. The rule in Motion.kt still holds — nothing in
 * this app bounces — and the whole sequence is finished well inside the two
 * seconds an usher looks at the screen for.
 *
 * @param order position on the ladder, 0 first.
 */
@Composable
private fun Reveal(order: Int, content: @Composable () -> Unit) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(order * REVEAL_STEP_MS)
        shown = true
    }

    val progress by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(durationMillis = 420, easing = Motion.Confident),
        label = "reveal",
    )
    val travel = with(LocalDensity.current) { 10.dp.toPx() }

    Box(
        Modifier.graphicsLayer {
            alpha = progress
            translationY = (1f - progress) * travel
        },
    ) {
        content()
    }
}

/**
 * The right-hand pane: where they are going.
 *
 * Every state fills it, because an empty half is worse than a quiet one. The two
 * welcomes and the already-arrived show the table; not-found has no table to show
 * so it carries the arrival count instead, which is the figure an usher is asked
 * for all night; the foreign-code state shows a struck-through code mark, because
 * there is nothing true to put there in words.
 */
@Composable
private fun ResultDestination(visual: ResultVisual, party: CheckInRepository.PartyView?) {
    when (visual) {
        ResultVisual.Welcome, ResultVisual.Vip, ResultVisual.Already ->
            TableBlock(party?.tableName, visual)

        ResultVisual.NotFound, ResultVisual.Foreign ->
            BrokenCodeMark(visual.onGround.copy(alpha = 0.28f))
    }
}

/**
 * A QR frame with a line through it, drawn rather than imported.
 *
 * Same reasoning as every other mark in this app — no icon dependency, no glyph
 * that might be missing on a vendor ROM. It is decoration with a job: it fills
 * the destination pane on the two states that have no destination, and it says
 * "the code" without a word, in a place where words would just repeat the left
 * half of the screen.
 */
@Composable
private fun BrokenCodeMark(color: Color) {
    Canvas(Modifier.size(180.dp)) {
        val s = size.minDimension
        val stroke = s * 0.055f
        val box = s * 0.30f
        val gap = s * 0.10f

        fun finder(x: Float, y: Float) {
            drawRect(
                color = color,
                topLeft = Offset(x, y),
                size = androidx.compose.ui.geometry.Size(box, box),
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = stroke),
            )
        }

        finder(0f, 0f)
        finder(s - box, 0f)
        finder(0f, s - box)

        // A scatter of modules where the fourth finder would be — enough to read
        // as a code without pretending to be a scannable one.
        val m = box * 0.28f
        listOf(0f to 0f, 2f to 0f, 1f to 1f, 0f to 2f, 2f to 2f).forEach { (cx, cy) ->
            drawRect(
                color = color,
                topLeft = Offset(s - box + cx * (m + gap * 0.35f), s - box + cy * (m + gap * 0.35f)),
                size = androidx.compose.ui.geometry.Size(m, m),
            )
        }

        drawLine(
            color = color,
            start = Offset(s * 0.06f, s * 0.94f),
            end = Offset(s * 0.94f, s * 0.06f),
            strokeWidth = stroke * 1.4f,
            cap = StrokeCap.Round,
        )
    }
}

/**
 * The fact rows — the single biggest content change on this screen.
 *
 * ── What they replace ──
 *
 * One string, joined by middle dots: `Party of 4 · Chicken, Vegetarian · No
 * children at this event`. That is a CSV pretending to be a layout, and it fails
 * three ways at a door. A dietary preference and a hard rule about children carry
 * identical weight. It has to be read left to right — nothing is findable. And it
 * truncates with an ellipsis exactly when there are enough facts to matter.
 *
 * As labelled rows each fact is locatable without reading the others, a flagged
 * one can carry weight the rest do not, and four facts stack instead of
 * disappearing.
 */
@Composable
private fun FactRows(rows: List<Fact>, visual: ResultVisual) {
    if (rows.isEmpty()) return
    val on = visual.onGround

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEachIndexed { index, fact ->
            if (index > 0) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(on.copy(alpha = 0.16f)),
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    text = fact.label.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = on.copy(alpha = 0.6f),
                    modifier = Modifier.width(96.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = fact.value,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (fact.emphasised) on else on.copy(alpha = 0.86f),
                    fontWeight = if (fact.emphasised) FontWeight.Bold else null,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * One labelled fact.
 *
 * @param emphasised for the rare row that must outrank the others — an access
 *   need, an adults-only rule. Never more than one per screen, or the emphasis
 *   stops meaning anything.
 */
private data class Fact(
    val label: String,
    val value: String,
    val emphasised: Boolean = false,
)

// ── Shared pieces ────────────────────────────────────────────────────────────

@Composable
private fun GuestName(name: String, color: Color) {
    Text(
        text = name,
        // The face is chosen from the STRING, not the app locale: the display
        // face has no Arabic glyphs, and most guests here have Arabic names.
        // Without this the name silently falls back to the system font while
        // everything around it stays in the brand face.
        style = MaterialTheme.typography.displayLarge.copy(
            fontFamily = displayFamilyFor(name),
        ),
        color = color,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The table. The largest element on the screen, by requirement.
 *
 * A small tracked label above a very large value, rather than the words "Table
 * 12" set together — so the part that gets read across a room is the number
 * alone, at full size, with nothing beside it.
 */
@Composable
private fun TableBlock(tableName: String?, visual: ResultVisual) {
    val compact = LocalDimens.current.compact
    val color = visual.onGround

    Column(horizontalAlignment = Alignment.End) {
        if (tableName.isNullOrBlank()) {
            Text(
                stringResource(R.string.result_no_table),
                style = MaterialTheme.typography.headlineLarge,
                color = color.copy(alpha = 0.75f),
                textAlign = TextAlign.End,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            return@Column
        }

        SectionLabel(stringResource(R.string.result_table_label), color = color.copy(alpha = 0.62f))
        Spacer(Modifier.height(4.dp))
        Text(
            text = tableName,
            style = MaterialTheme.typography.displayLarge.copy(
                fontSize = tableDisplaySize(tableName, compact),
                // Line height must follow the computed size or a 140sp glyph is
                // clipped by the 66sp line box inherited from the style.
                lineHeight = tableDisplaySize(tableName, compact) * 1.02f,
                fontFamily = displayFamilyFor(tableName),
            ),
            // The foil colour on VIP, the plain ink colour everywhere else. This
            // is the largest glyph on the screen, so it is where the gold is
            // worth spending.
            color = visual.onGroundDisplay,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.End,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun QuietLine(text: String, color: Color) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        color = color.copy(alpha = 0.72f),
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The bottom of the screen. Exactly one primary action in every state.
 *
 * No state is a dead end: a welcome admits, an already-arrived either overrides
 * or explains, and a not-found goes straight to manual search.
 */
@Composable
private fun ResultActions(
    visual: ResultVisual,
    party: CheckInRepository.PartyView?,
    isSupervisor: Boolean,
    onAdmit: (CheckInRepository.PartyView, List<String>) -> Unit,
    onOverride: (CheckInRepository.PartyView, List<String>) -> Unit,
    onSearch: () -> Unit,
    onDismiss: () -> Unit,
    onPickMembers: () -> Unit,
) {
    val on = visual.onGround
    val dimens = LocalDimens.current

    when (visual) {
        ResultVisual.Welcome, ResultVisual.Vip -> {
            if (party == null) return
            val unarrived = party.unarrived
            Column {
                PrimaryAction(
                    text = if (unarrived.size > 1) {
                        stringResource(R.string.result_admit_all, unarrived.size)
                    } else {
                        stringResource(R.string.result_admit)
                    },
                    onClick = { onAdmit(party, unarrived.map { it.guestId }) },
                    enabled = unarrived.isNotEmpty(),
                    // On a coloured ground the button inverts: the ground's own
                    // text colour becomes the button, and the ground becomes the
                    // label. Gold on gold would disappear.
                    containerColor = on,
                    contentColor = visual.ground,
                    hero = true,
                )
                // The partial-arrival path (§9.1), kept off the door. Most
                // parties walk in together; the ones that do not are rare
                // enough to afford one extra tap.
                if (party.members.size > 1) {
                    Spacer(Modifier.height(4.dp))
                    QuietAction(
                        text = stringResource(R.string.result_not_everyone),
                        onClick = onPickMembers,
                        contentColor = on.copy(alpha = 0.8f),
                    )
                }
            }
        }

        ResultVisual.Already -> {
            if (party == null) return
            if (isSupervisor) {
                // §9.5: a photographed ticket resolves here, and admitting again
                // requires an override that is recorded in the audit trail.
                PrimaryAction(
                    text = stringResource(R.string.result_override),
                    onClick = { onOverride(party, party.arrived.map { it.guestId }) },
                    containerColor = StateAttention,
                    contentColor = Color.White,
                )
            } else {
                QuietLine(stringResource(R.string.result_override_unavailable), on)
            }
        }

        ResultVisual.NotFound -> PrimaryAction(
            text = stringResource(R.string.scanner_search),
            onClick = onSearch,
            hero = true,
        )

        /*
         * Two ways out, side by side, because there are genuinely two answers.
         *
         * Scanning something that is not a ticket usually means the wrong object
         * was held up — a card, a phone showing the wrong screen, a label on a
         * gift. The usual next move is simply "try again / next guest", so DONE
         * leads and is the wider of the two. But sometimes the guest has no
         * working code at all, and then it IS a name search — so that stays one
         * tap away rather than behind a dismissal.
         *
         * Side by side rather than stacked: on a landscape tablet a stacked pair
         * pushes the second button toward the bottom edge, and the whole point is
         * that neither is the obvious one.
         */
        ResultVisual.Foreign -> Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1.2f)) {
                PrimaryAction(
                    text = stringResource(R.string.result_foreign_done),
                    onClick = onDismiss,
                    // Inverted, like every button on a coloured ground: the
                    // ground's own text colour becomes the button. A gold button
                    // on oxblood is the one combination in this palette that
                    // genuinely looks cheap.
                    containerColor = on,
                    contentColor = visual.ground,
                    hero = true,
                )
            }
            SecondaryAction(
                text = stringResource(R.string.scanner_search),
                onClick = onSearch,
                // Matched to the hero beside it. Two buttons of different heights
                // in one row is the detail that makes a screen look assembled
                // rather than designed.
                modifier = Modifier.weight(1f).heightIn(min = dimens.heroButtonHeight),
                contentColor = on,
                borderColor = on.copy(alpha = 0.55f),
            )
        }
    }
}

/**
 * One slow pass of light across the VIP ground.
 *
 * Drawn on a Canvas rather than as an animated Brush modifier so the sweep is
 * expressed in the canvas's own pixels — there is no correct dp constant for
 * "one screen width", and a gradient anchored to a guessed size behaves
 * differently on every tablet.
 *
 * Deliberately slow (2.6s) and deliberately faint (16% white). A fast or bright
 * shimmer reads as a loading skeleton; this has to read as expensive.
 */
@Composable
private fun VipShimmer() {
    val transition = rememberInfiniteTransition(label = "vip")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(Motion.shimmer(), RepeatMode.Restart),
        label = "sweep",
    )

    Canvas(Modifier.fillMaxSize()) {
        val w = size.width
        // Travels from fully off the start edge to fully off the end edge.
        val head = -w * 0.5f + progress * (w * 2f)
        val halfBand = w * 0.22f
        drawRect(
            brush = Brush.linearGradient(
                colors = listOf(
                    Color.Transparent,
                    Color.White.copy(alpha = 0.16f),
                    Color.Transparent,
                ),
                start = Offset(head - halfBand, 0f),
                end = Offset(head + halfBand, size.height),
            ),
        )
    }
}

/**
 * Choosing which members of a party arrived (§9.1).
 *
 * This used to sit on the result screen itself, where it made every single
 * admission — including the overwhelming majority that are a whole party
 * walking in together — into a reading task with a scrollable list in it.
 *
 * Here it is one tap away and nowhere near the two-second path.
 */
@Composable
private fun MemberPickerOverlay(
    party: CheckInRepository.PartyView,
    onConfirm: (List<String>) -> Unit,
    onCancel: () -> Unit,
) {
    val dimens = LocalDimens.current
    val selected = remember(party.partyId) {
        mutableStateListOf<String>().apply { addAll(party.unarrived.map { it.guestId }) }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            // Swallows taps so the result screen's dismiss-anywhere does not
            // fire through the overlay and throw away the selection.
            //
            // It must be an ENABLED clickable with the indication suppressed. A
            // `clickable(enabled = false)` does not consume the event — it opts
            // out of input entirely, so every tap would pass straight through to
            // the dismiss handler underneath.
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {},
            )
            .padding(dimens.screenPadding),
    ) {
        Column(Modifier.fillMaxSize()) {
            Text(
                stringResource(R.string.result_choose_who),
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(16.dp))

            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(party.members, key = { it.guestId }) { member ->
                    MemberRow(
                        member = member,
                        checked = member.guestId in selected,
                        onToggle = {
                            if (member.guestId in selected) selected.remove(member.guestId)
                            else selected.add(member.guestId)
                        },
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                PrimaryAction(
                    text = stringResource(R.string.result_admit_all, selected.size),
                    onClick = { onConfirm(selected.toList()) },
                    enabled = selected.isNotEmpty(),
                    modifier = Modifier.weight(2f),
                )
                SecondaryAction(
                    text = stringResource(R.string.action_cancel),
                    onClick = onCancel,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun MemberRow(
    member: CheckInRepository.GuestView,
    checked: Boolean,
    onToggle: () -> Unit,
) {
    val dimens = LocalDimens.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = dimens.minTouch)
            // The whole row is the target, not just the checkbox. A 24dp
            // checkbox is not a touch target on a tablet held in one hand.
            //
            // A selected row is rimmed in the accent, so which people are about
            // to be admitted is legible from the rim alone — the checkbox is
            // 24dp of state on a screen read at arm's length.
            .pressableSurface(
                onClick = onToggle,
                shape = RoundedCornerShape(dimens.cardRadius),
                borderColor = if (checked) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)
                },
                borderWidth = if (checked) 2.dp else 1.dp,
                enabled = !member.alreadyArrived,
            )
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked = checked,
            // An already-arrived member cannot be re-selected here; that path is
            // the supervisor override, which is deliberately harder to reach.
            enabled = !member.alreadyArrived,
            onCheckedChange = { onToggle() },
            colors = CheckboxDefaults.colors(checkedColor = MaterialTheme.colorScheme.primary),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                member.fullName,
                style = MaterialTheme.typography.titleMedium.copy(
                    fontFamily = displayFamilyFor(member.fullName),
                ),
                color = if (member.alreadyArrived) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onBackground
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            listOfNotNull(
                member.mealSelection?.let { stringResource(R.string.result_meal, it) },
                member.dietaryNotes?.takeIf { it.isNotBlank() }
                    ?.let { stringResource(R.string.result_dietary, it) },
            ).takeIf { it.isNotEmpty() }?.let {
                Text(
                    it.joinToString("  ·  "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (member.alreadyArrived) {
            Spacer(Modifier.width(12.dp))
            Text(
                stringResource(R.string.search_arrived_badge),
                style = MaterialTheme.typography.labelMedium,
                color = StateAlready,
            )
        }
    }
}

/**
 * Delay between rungs of the entrance ladder — see [Reveal].
 *
 * 70ms reads as one sequence; below about 50 the parts arrive together and the
 * stagger is wasted, above about 100 the operator is waiting for the screen to
 * finish assembling itself. Four rungs at 70 puts the last one on screen 210ms
 * after the first, well inside the two seconds this screen gets looked at for.
 */
private const val REVEAL_STEP_MS = 70L
