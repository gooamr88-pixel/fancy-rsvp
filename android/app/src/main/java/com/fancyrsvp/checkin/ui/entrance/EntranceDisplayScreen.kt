package com.fancyrsvp.checkin.ui.entrance

import androidx.compose.animation.core.EaseInOutSine
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.ui.components.CoverScrim
import com.fancyrsvp.checkin.ui.components.EventCoverBackdrop
import com.fancyrsvp.checkin.ui.components.pressableSurface
import com.fancyrsvp.checkin.ui.components.rememberEventCover
import com.fancyrsvp.checkin.ui.theme.EventBranding
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.safeChromeTop

/**
 * Entrance display mode (spec §8.8).
 *
 * "A separate full-screen presentation mode intended for a large screen at the venue
 * entrance: live arrival counter with elegant typography and subtle motion, in the
 * event's branding. No operational controls visible. This is a showcase feature —
 * visual quality is the entire point of it."
 *
 * Three consequences of "no operational controls":
 *
 *  • No guest NAMES appear. A wall-mounted display listing who has arrived at a
 *    private event is a disclosure to everyone in the lobby — the counter is the
 *    showcase, the guest list is not.
 *  • No connection state, no pending count, no staff name. Those are operator
 *    concerns, and §17.7's language rules exist because staff read them; a guest
 *    reading "Offline — 3 pending" learns only that something is wrong.
 *  • Exactly ONE control, and it takes two deliberate taps.
 *
 * ── The exit ──
 *
 * This screen previously had no way out at all: the system back gesture was the
 * only exit, which is an invisible affordance, and an operator who did not know
 * the gesture had to restart the app to get their scanner back.
 *
 * The fix is not "add a button" — §8.8 is right that guests walk past this and
 * will touch it. It is a small, low-contrast corner control that opens a large,
 * unmissable confirmation. A passer-by brushing the corner sees a dialog and
 * does nothing; an operator looking for the way out finds it and takes two taps.
 *
 * Per decision D-10 this is intended for separate hardware or a second paired
 * tablet: one device cannot both scan and present.
 */
@Composable
fun EntranceDisplayScreen(
    eventId: String,
    onExit: () -> Unit,
    viewModel: EntranceDisplayViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    var confirmingExit by remember { mutableStateOf(false) }

    LaunchedEffect(eventId) { viewModel.start(eventId) }

    /*
     * The couple's photograph, full-bleed behind everything (§9.8, §8.8).
     *
     * This is the screen the picture exists for. It faces the lobby for the whole
     * night, guests look at it while they wait, and §8.8 says outright that
     * "visual quality is the entire point of it". A counter on a plain wash is a
     * status board; the same counter over the couple's own photograph is part of
     * the event.
     *
     * BoxWithConstraints so the decode is downsampled to the real display width —
     * this may be a 4K lobby screen or a 7-inch spare, and decoding a 4000px
     * original for either is how a long-running display runs out of memory.
     */
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val cover = rememberEventCover(
            path = state?.coverImagePath,
            targetWidth = maxWidth,
        )
        val hasCover = cover != null

        /*
         * Contrast is recomputed against what the type ACTUALLY sits on.
         *
         * With a photograph the ground is a dark scrim, without one it is the
         * app's pale parchment — and a brand colour legible on one is frequently
         * illegible on the other. Passing the real background to `accentFor` is
         * what keeps an organizer's deep navy readable in both cases instead of
         * vanishing into whichever one it happens to match.
         */
        val groundForContrast =
            if (hasCover) Color.Black else MaterialTheme.colorScheme.background
        val accent = EventBranding.accentFor(state?.brandingColorHex, groundForContrast)
        val supportColor = if (hasCover) {
            Color.White.copy(alpha = 0.82f)
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        }

        EventCoverBackdrop(
            image = cover,
            modifier = Modifier.fillMaxSize(),
            // No photograph: the original soft wash. A flat fill reads as a broken
            // display on a large screen.
            fallback = MaterialTheme.colorScheme.background,
            // Text at BOTH ends — the event name above, the counter and bar below —
            // so the middle of the frame, where the couple are, stays clear.
            scrim = CoverScrim.Balanced,
            drift = true,
        ) {
            if (!hasCover) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(
                                    MaterialTheme.colorScheme.background,
                                    accent.copy(alpha = 0.10f),
                                ),
                            ),
                        ),
                )
            }

            /*
             * The waiting state is a BRANCH, not an early return.
             *
             * It used to `return` out of the layout when the event row could not
             * be read — which skipped the exit control along with the counter. So
             * the one failure that leaves this screen showing nothing useful was
             * also the one that removed the only way off it, on a device that is
             * usually wall-mounted with no operator watching. Recovering meant
             * force-stopping the app.
             *
             * The way out must not depend on the content rendering, so it is
             * drawn after this `when` regardless of which branch ran.
             */
            val current = state
            if (current == null) {
                Text(
                    stringResource(R.string.entrance_waiting),
                    style = MaterialTheme.typography.headlineMedium,
                    color = supportColor,
                    modifier = Modifier.align(Alignment.Center),
                )
            } else {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(64.dp),
                ) {
                    Text(
                        text = current.eventName,
                        style = MaterialTheme.typography.headlineLarge,
                        color = accent,
                        textAlign = TextAlign.Center,
                    )

                    Spacer(Modifier.height(48.dp))

                    // The counter. Animated so an arrival is VISIBLE from across a
                    // lobby — a number that silently changes is indistinguishable
                    // from a static sign.
                    ArrivalCounter(count = current.arrived, accent = accent)

                    Spacer(Modifier.height(16.dp))

                    Text(
                        text = stringResource(R.string.entrance_guests_arrived),
                        style = MaterialTheme.typography.titleLarge,
                        color = supportColor,
                        textAlign = TextAlign.Center,
                    )

                    if (current.totalInvited > 0) {
                        Spacer(Modifier.height(40.dp))
                        ProgressBar(
                            fraction = current.arrived.toFloat() / current.totalInvited,
                            accent = accent,
                        )
                    }
                }

                // A slow breathing accent line at the base. Subtle motion, per §8.8
                // — enough to read as "live" without competing with the counter.
                // Only with content: a pulse under an empty screen reads as a fault.
                BreathingRule(
                    accent = accent,
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }

            // The only control on the screen.
            //
            // This one is deliberately quieter than every other control in the
            // app, and that is a considered exception rather than an oversight:
            // this screen faces the LOBBY. Guests are looking at it. A gold
            // hero button in the corner of an arrival display announces that
            // the venue is running a piece of software, which is the opposite of
            // what the display is for.
            //
            // But it was a 35%-opacity word with no edge and no shape, which is
            // not a quiet control — it is an invisible one, and staff could not
            // find it. It is now unmistakably a button at close range and still
            // recedes from across a lobby: a rimmed pill on a scrim, readable
            // text, and it moves when pressed.
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    // The photograph behind this stays full-bleed — it is the point
                    // of the screen — but the one control on it must not sit under
                    // the status bar or a cutout, or staff cannot find the way out.
                    .safeChromeTop()
                    .padding(16.dp)
                    .heightIn(min = 72.dp)
                    .pressableSurface(
                        onClick = { confirmingExit = true },
                        shape = RoundedCornerShape(LocalDimens.current.cardRadius),
                        container = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                        borderColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        elevation = 2.dp,
                    )
                    .padding(horizontal = 22.dp, vertical = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(R.string.entrance_exit),
                    // Was labelSmall at 35% alpha. Both are now at the app's
                    // floors: no text below 16sp, and legible contrast.
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    if (confirmingExit) {
        AlertDialog(
            onDismissRequest = { confirmingExit = false },
            title = {
                Text(
                    stringResource(R.string.entrance_exit_confirm),
                    style = MaterialTheme.typography.headlineMedium,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmingExit = false
                        onExit()
                    },
                ) {
                    Text(
                        stringResource(R.string.nav_back_to_scanner),
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingExit = false }) {
                    Text(
                        stringResource(R.string.action_cancel),
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            },
        )
    }
}

/**
 * The arrival number, at display scale.
 *
 * The scale bump on change is deliberately small and slow: a large screen in a lobby
 * is peripheral vision for most people, and an aggressive animation reads as an
 * error state rather than a welcome.
 */
@Composable
private fun ArrivalCounter(count: Int, accent: androidx.compose.ui.graphics.Color) {
    // A brief swell on each change, then back. Driven by a target that actually
    // moves when `count` does — animating toward a constant would compile, run, and
    // do nothing, which is worse than no animation because it looks intentional.
    var target by remember { mutableStateOf(1f) }
    LaunchedEffect(count) {
        // Skipped on first composition: the display should come up settled, not
        // pulse once for a number that did not just change.
        if (count > 0) {
            target = 1.06f
            delay(180)
            target = 1f
        }
    }

    val scale by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(durationMillis = 420, easing = EaseInOutSine),
        label = "counter-scale",
    )

    Text(
        text = "$count",
        fontSize = (180 * scale).sp,
        lineHeight = (190 * scale).sp,
        fontWeight = FontWeight.Bold,
        color = accent,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun ProgressBar(
    fraction: Float,
    accent: androidx.compose.ui.graphics.Color,
) {
    val animated by animateFloatAsState(
        targetValue = fraction.coerceIn(0f, 1f),
        animationSpec = tween(durationMillis = 900, easing = EaseInOutSine),
        label = "entrance-progress",
    )

    Box(
        modifier = Modifier
            .fillMaxWidth(0.6f)
            .height(10.dp)
            .clip(RoundedCornerShape(5.dp))
            .background(MaterialTheme.colorScheme.onBackground.copy(alpha = 0.12f)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(animated)
                .height(10.dp)
                .clip(RoundedCornerShape(5.dp))
                .background(accent),
        )
    }
}

@Composable
private fun BreathingRule(
    accent: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "breath")
    val alpha by transition.animateFloat(
        initialValue = 0.25f,
        targetValue = 0.7f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 4_000, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "breath-alpha",
    )

    Row(
        modifier = modifier.fillMaxWidth().padding(bottom = 48.dp),
        horizontalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .width(160.dp)
                .height(3.dp)
                .alpha(alpha)
                .clip(RoundedCornerShape(2.dp))
                .background(accent),
        )
    }
}
