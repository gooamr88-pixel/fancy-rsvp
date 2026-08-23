package com.fancyrsvp.checkin.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.ui.theme.LocalDimens

/**
 * Every screen that is not the scanner.
 *
 * ── Why this exists as a component rather than a convention ──
 *
 * The rule is that no screen may be a dead end, and that the way home is always
 * large, always in the same place, and always says where it goes. A convention
 * gets forgotten the next time a screen is added; a scaffold that will not
 * compile without `onBackToScanner` does not.
 *
 * The bar sits at the BOTTOM, not the top. The tablet is held in one hand with
 * a queue in front of the operator — the bottom edge is where the thumb already
 * is, and a top-left system arrow is the single hardest control to hit
 * one-handed on a 10-inch device.
 */
@Composable
fun ScreenScaffold(
    title: String,
    onBackToScanner: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    /** Actions that belong beside the title. Kept rare — usually none. */
    trailing: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val dimens = LocalDimens.current

    Surface(modifier = modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = dimens.screenPadding,
                        end = dimens.screenPadding,
                        top = dimens.screenPadding * 0.6f,
                        bottom = 8.dp,
                    ),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    // The title answers "where am I" in one word or two. It is
                    // never a sentence, and never repeats what the content says.
                    Text(
                        title,
                        style = MaterialTheme.typography.headlineLarge,
                        color = MaterialTheme.colorScheme.onBackground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    subtitle?.let {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            it,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                trailing?.let {
                    Spacer(Modifier.width(16.dp))
                    it()
                }
            }

            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = dimens.screenPadding),
                content = content,
            )

            BackToScannerBar(onClick = onBackToScanner)
        }
    }
}

/**
 * The persistent way home.
 *
 * Deliberately not subtle: full width, 88dp tall, its own ground colour, a
 * drawn chevron AND the literal words "Back to scanner". The brief's rule is
 * that a small system arrow alone is never enough, and this is the answer to
 * it — an operator who has forgotten how they got somewhere can still leave.
 *
 * It returns to the SCANNER, not to the previous screen, even from two levels
 * down. That is why it can promise where it goes: one tap from anywhere lands
 * on the camera. The system back gesture still pops one level for anyone who
 * knows it.
 */
@Composable
fun BackToScannerBar(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    /**
     * What the bar says it goes to.
     *
     * Defaulted, so every existing caller keeps the promise the doc above makes.
     * It is overridable for exactly one case: the setup guide, reached before a
     * tablet is paired. There is no scanner to go back to at that point, and a
     * bar promising one would be the first thing the app said to a new operator
     * that was not true.
     */
    label: String = stringResource(R.string.nav_back_to_scanner),
) {
    val dimens = LocalDimens.current
    val interactionSource = remember { MutableInteractionSource() }
    val scale = pressLift(interactionSource, pressedScale = 0.985f)

    Column(modifier.fillMaxWidth()) {
        // A 3dp rule in the accent, not a 1dp hairline in the outline colour. This
        // is the seam between the page and the one control that is on every screen
        // in the app; a divider-weight line made the bar look like the bottom of
        // the content rather than like a separate thing to press.
        Box(
            Modifier
                .fillMaxWidth()
                .height(3.dp)
                .background(MaterialTheme.colorScheme.primary),
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = dimens.backBarHeight)
                // Barely-there scale. The bar is full-bleed, so a 0.965 press would
                // pull visible gaps in from both screen edges; the shift only has to
                // be enough to confirm the tap landed.
                .scale(scale)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                    onClick = onClick,
                )
                .padding(horizontal = dimens.screenPadding),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Start,
        ) {
            Chevron(color = MaterialTheme.colorScheme.primary, pointsBack = true)
            Spacer(Modifier.width(16.dp))
            Text(
                label,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * Centred when it fits, scrollable when it does not.
 *
 * ── The problem this exists to end ──
 *
 * Every fixed-content screen in this app was a `Column` with
 * `verticalArrangement = Center` inside a `fillMaxSize` box. That silently CLIPS
 * whatever does not fit, and because the arrangement is centred it clips from
 * BOTH ends — so what disappears first is the heading at the top and the button
 * at the bottom, leaving explanatory prose and no way to act on it.
 *
 * The app is locked to landscape, where height is always the scarce axis, and
 * nothing here ever scrolled. The PIN pad, the close-event confirmation and the
 * prepare card are all taller than a phone's landscape content area.
 *
 * ── Why `heightIn(min = maxHeight)` and not just `verticalScroll` ──
 *
 * A `Column` inside `verticalScroll` is measured against an INFINITE maximum
 * height, so its own `Arrangement.Center` has nothing to centre within and
 * silently becomes a no-op — short content would jump to the top of the screen
 * on every device that previously centred it correctly. Forcing a minimum height
 * of the viewport gives the arrangement something to work against while still
 * letting the column grow past it.
 *
 * NOT for content that contains a `LazyColumn` or any other lazy list: a lazy
 * list measured with an unbounded height throws. Those screens are already
 * scrollable by their own list and must not be wrapped in this.
 */
@Composable
fun ScrollableCenteredColumn(
    modifier: Modifier = Modifier,
    horizontalAlignment: Alignment.Horizontal = Alignment.CenterHorizontally,
    content: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight),
            horizontalAlignment = horizontalAlignment,
            verticalArrangement = Arrangement.Center,
            content = content,
        )
    }
}

/**
 * What a screen shows when it has nothing to show.
 *
 * An empty state is a dead end unless it says what to do next, so [actionLabel]
 * and [onAction] are not optional. One short sentence, then a way out.
 */
@Composable
fun EmptyState(
    message: String,
    actionLabel: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val dimens = LocalDimens.current
    Column(
        modifier = modifier.fillMaxWidth().padding(vertical = dimens.sectionGap),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(dimens.sectionGap),
    ) {
        Text(
            message,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SecondaryAction(text = actionLabel, onClick = onAction)
    }
}
