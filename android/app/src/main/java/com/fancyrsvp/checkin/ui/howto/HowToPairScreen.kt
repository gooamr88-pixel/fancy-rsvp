package com.fancyrsvp.checkin.ui.howto

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.ui.components.BackToScannerBar
import com.fancyrsvp.checkin.ui.components.PrimaryAction
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.StateAttention
import com.fancyrsvp.checkin.ui.theme.enterDeeper
import com.fancyrsvp.checkin.ui.theme.enterShallower
import com.fancyrsvp.checkin.ui.theme.exitDeeper
import com.fancyrsvp.checkin.ui.theme.exitShallower

/**
 * How to connect this tablet to Fancy.
 *
 * ── Why a guide screen exists at all ──
 *
 * Pairing asks for an eight-character code and says it comes from "your Fancy
 * dashboard". For anyone who has generated one before, that is enough. For
 * anyone who has not, it is a dead end on the second screen of the app — and
 * the person setting up a tablet is very often not the person who owns the
 * dashboard.
 *
 * ── Why it is four steps and not three ──
 *
 * Step two is the one that is easy to leave out and impossible to skip. Devices
 * are tied to GATES, and gates come from the seating map, so an organizer with
 * no entrance on their map reaches the Tablets panel and finds no code button
 * at all — only an offer to open the seating map. Every version of these
 * instructions that has been written down so far omitted it, including the copy
 * this screen replaces.
 *
 * ── Where the words come from ──
 *
 * Every dashboard label quoted here was read out of the dashboard's own source
 * rather than remembered:
 *
 *   • `frontend/src/app/dashboard/checkin-setup/page.js` — the page, its tab
 *     groups ("Before the event") and the "Tablets" tab.
 *   • `frontend/src/app/dashboard/components/DeviceManagement.js` — the
 *     "Check-in devices" panel, the Gate select, and the "Create pairing code"
 *     button.
 *   • `backend/services/checkinDeviceService.js` — eight characters, a 31-symbol
 *     alphabet with no O/0/I/1/L, single use, and the ten-minute expiry.
 *
 * If the dashboard changes, this screen is wrong and the tablet will say so
 * confidently. That is the maintenance cost of instructions, and it is worth
 * paying here.
 */
@Composable
fun HowToPairScreen(
    onDone: () -> Unit,
) {
    val dimens = LocalDimens.current
    var index by remember { mutableIntStateOf(0) }
    val step = STEPS[index]
    val isLast = index == STEPS.lastIndex

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = dimens.screenPadding,
                        end = dimens.screenPadding,
                        top = dimens.screenPadding * 0.5f,
                        bottom = 4.dp,
                    ),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.howto_title),
                        style = MaterialTheme.typography.headlineLarge,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        stringResource(R.string.howto_step_of, index + 1, STEPS.size),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                StepDots(current = index, total = STEPS.size)
            }

            /*
             * The step body.
             *
             * AnimatedContent keyed on the index, sliding the way the operator
             * moved — the same grammar the navigation graph uses, so "forward"
             * looks the same everywhere in the app. targetState carries the
             * index rather than the step so the transition can tell direction.
             */
            AnimatedContent(
                targetState = index,
                transitionSpec = {
                    if (targetState > initialState) {
                        enterDeeper() togetherWith exitDeeper()
                    } else {
                        enterShallower() togetherWith exitShallower()
                    }
                },
                label = "howto-step",
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) { shown ->
                StepBody(
                    step = STEPS[shown],
                    number = shown + 1,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = dimens.screenPadding),
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        horizontal = dimens.screenPadding,
                        vertical = 12.dp,
                    ),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Present from the first step but inert there, rather than
                // appearing on step two. A control that materialises under a
                // thumb already travelling toward Next is a mis-tap.
                //
                // weight() goes on the actions themselves, not on boxes around
                // them: PrimaryAction fills its width and SecondaryAction does
                // not, so a weighted wrapper stretched one and left the other at
                // text width in the corner of an oversized slot.
                SecondaryAction(
                    text = stringResource(R.string.howto_back),
                    onClick = { if (index > 0) index-- },
                    enabled = index > 0,
                    modifier = Modifier.weight(1f),
                )
                PrimaryAction(
                    text = stringResource(
                        if (isLast) R.string.howto_finish else R.string.howto_next,
                    ),
                    onClick = { if (isLast) onDone() else index++ },
                    hero = true,
                    modifier = Modifier.weight(1.6f),
                )
            }

            // Says "Back to pairing", not "Back to scanner": this screen is
            // reached before a tablet is paired, and there is no scanner behind
            // it to go back to.
            BackToScannerBar(
                onClick = onDone,
                label = stringResource(R.string.howto_leave),
            )
        }
    }
}

/**
 * Picture on one side, words on the other.
 *
 * The app is locked to landscape, so this is a row on every device it runs on —
 * there is no portrait case to branch for. Height is the scarce axis, and a
 * stacked layout would put the illustration above the fold on a compact tablet
 * and the instruction below it.
 */
@Composable
private fun StepBody(
    step: PairStep,
    number: Int,
    modifier: Modifier = Modifier,
) {
    val dimens = LocalDimens.current

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(dimens.sectionGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ArtworkFrame(modifier = Modifier.weight(1.15f)) { step.artwork() }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.primary),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "$number",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                }
                Spacer(Modifier.width(14.dp))
                Text(
                    stringResource(step.title),
                    style = MaterialTheme.typography.headlineLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                )
            }

            Text(
                stringResource(step.body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.widthIn(max = 520.dp),
            )

            // The thing that goes wrong on this step, when there is one. Framed
            // as what to expect rather than as a warning: it is not an error,
            // it is the screen refusing to show a button until a gate exists.
            step.note?.let { note ->
                Row(
                    modifier = Modifier
                        .widthIn(max = 520.dp)
                        .clip(RoundedCornerShape(dimens.cardRadius * 0.6f))
                        .background(StateAttention.copy(alpha = 0.09f))
                        .padding(14.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Text(
                        "!",
                        style = MaterialTheme.typography.titleLarge,
                        color = StateAttention,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        stringResource(note),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                }
            }
        }
    }
}

/** Where you are, at a glance, without reading the counter. */
@Composable
private fun StepDots(current: Int, total: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(total) { i ->
            Box(
                Modifier
                    .size(width = if (i == current) 26.dp else 10.dp, height = 10.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (i <= current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline),
            )
        }
    }
}

/**
 * One step.
 *
 * The artwork travels with the copy rather than being selected by a `when` at
 * the render site, so adding a step is one entry in [STEPS] and cannot leave a
 * picture pointing at the wrong instruction.
 */
private class PairStep(
    val title: Int,
    val body: Int,
    val note: Int? = null,
    val artwork: @Composable () -> Unit,
)

private val STEPS = listOf(
    PairStep(
        title = R.string.howto_1_title,
        body = R.string.howto_1_body,
        artwork = { ArtDashboard() },
    ),
    PairStep(
        title = R.string.howto_2_title,
        body = R.string.howto_2_body,
        note = R.string.howto_2_note,
        artwork = { ArtSeatingGate() },
    ),
    PairStep(
        title = R.string.howto_3_title,
        body = R.string.howto_3_body,
        artwork = { ArtCreateCode() },
    ),
    PairStep(
        title = R.string.howto_4_title,
        body = R.string.howto_4_body,
        note = R.string.howto_4_note,
        artwork = { ArtEnterCode() },
    ),
)
