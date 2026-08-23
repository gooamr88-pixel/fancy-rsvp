package com.fancyrsvp.checkin.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.ScriptFont
import com.fancyrsvp.checkin.ui.theme.StateWelcome

/**
 * The three screens between an unboxed tablet and a working door.
 *
 * Named rather than numbered at the call site so a screen cannot claim to be
 * step 2 while sitting third in the graph — the order lives here, once.
 */
enum class SetupStep { Pair, Prepare, SignIn }

/**
 * The wordmark.
 *
 * ── Why this moved out of the login screen ──
 *
 * It used to be declared inline on StaffLoginScreen and nowhere else, which
 * meant the app's identity first appeared on the THIRD screen anyone saw. The
 * first — pairing — carried no logo, no name, and no indication of which app
 * had been handed to you. Setup now opens with the mark and carries it through.
 *
 * @param large the welcome screen, where the mark IS the content rather than a
 *   header on top of it.
 */
@Composable
fun Wordmark(
    modifier: Modifier = Modifier,
    large: Boolean = false,
) {
    val dimens = LocalDimens.current
    val style = when {
        large && !dimens.compact -> MaterialTheme.typography.displayLarge
        large -> MaterialTheme.typography.displayMedium
        dimens.compact -> MaterialTheme.typography.headlineLarge
        else -> MaterialTheme.typography.displayMedium
    }
    Text(
        text = stringResource(R.string.brand_name),
        style = style.copy(fontFamily = ScriptFont),
        color = MaterialTheme.colorScheme.primary,
        modifier = modifier,
    )
}

/**
 * Where you are in setup, and how much is left.
 *
 * ── Why a rail and not a counter ──
 *
 * Setup is three screens and nothing said so. An operator who paired a tablet
 * in the office and put it down had no way to tell whether they had finished,
 * and the screens do not look like a sequence — each one is a different shape.
 * Three named stops make the whole errand visible from any one of them.
 *
 * On a compact tablet the three labels do not fit beside the wordmark at the
 * theme's 16sp floor, and shrinking them below it is not on the table (see
 * Dimens). The dots stay, and the labels collapse to a count — which carries
 * the same "how much is left" and none of the width.
 */
@Composable
fun SetupRail(
    /**
     * The step being shown, or null for "not started".
     *
     * Nullable because of the welcome screen. Passing [SetupStep.Pair] there —
     * which is what it did — rendered a rail identical to the pairing screen's,
     * so the one indicator whose job is to say where you are could not tell two
     * consecutive screens apart. Null lights nothing and shows the total, which
     * is the true answer before anything has been started.
     */
    current: SetupStep?,
    modifier: Modifier = Modifier,
) {
    val dimens = LocalDimens.current
    val steps = SetupStep.entries
    // -1 when nothing has started, which makes every dot "upcoming" by the same
    // comparison the other states use.
    val index = current?.let { steps.indexOf(it) } ?: -1

    // Resolved outside the semantics lambda: that block is not a composable
    // scope, so stringResource cannot be called from inside it.
    val spoken = if (current == null) {
        stringResource(R.string.setup_steps_total, steps.size)
    } else {
        stringResource(R.string.setup_step_of, index + 1, steps.size)
    }

    Row(
        modifier = modifier.clearAndSetSemantics {
            // One announcement for the whole rail. Read dot by dot it is a
            // stream of unlabelled shapes.
            contentDescription = spoken
        },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (dimens.compact) 8.dp else 12.dp),
    ) {
        steps.forEachIndexed { i, step ->
            if (i > 0) {
                Box(
                    Modifier
                        .width(if (dimens.compact) 12.dp else 20.dp)
                        .height(2.dp)
                        .background(MaterialTheme.colorScheme.outline),
                )
            }
            Box(
                Modifier
                    .size(10.dp)
                    .clip(RoundedCornerShape(50))
                    .background(
                        when {
                            i < index -> StateWelcome
                            i == index -> MaterialTheme.colorScheme.primary
                            else -> MaterialTheme.colorScheme.outline
                        },
                    ),
            )
            if (!dimens.compact) {
                Text(
                    text = stringResource(step.label()),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (i == index) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
        if (dimens.compact) {
            Spacer(Modifier.width(4.dp))
            Text(
                text = spoken,
                style = MaterialTheme.typography.labelMedium,
                color = if (current == null) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.primary
                },
            )
        }
    }
}

/**
 * Wordmark on one side, progress on the other. Every setup screen opens with it,
 * in the same place, at the same height.
 */
@Composable
fun SetupHeader(
    current: SetupStep,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Wordmark()
        SetupRail(current = current)
    }
}

private fun SetupStep.label(): Int = when (this) {
    SetupStep.Pair -> R.string.setup_step_pair
    SetupStep.Prepare -> R.string.setup_step_prepare
    SetupStep.SignIn -> R.string.setup_step_signin
}
