package com.fancyrsvp.checkin.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.ui.components.Chevron
import com.fancyrsvp.checkin.ui.components.EventCoverFrame
import com.fancyrsvp.checkin.ui.components.PinDots
import com.fancyrsvp.checkin.ui.components.PinKeypad
import com.fancyrsvp.checkin.ui.components.ScrollableCenteredColumn
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.components.Wordmark
import com.fancyrsvp.checkin.ui.components.pressableSurface
import com.fancyrsvp.checkin.ui.components.rememberEventCover
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.StateAttention
import java.text.DateFormat
import java.util.Date

/**
 * Staff login (spec §8.1, §18.5).
 *
 * Pick a name, type four digits. No email, no password — door staff may be
 * temporary hires who cannot be expected to hold platform credentials, and the
 * venue may have no connectivity at all.
 *
 * Staff switching is one tap back to the picker, because handover happens
 * mid-rush (§18.5).
 */
@Composable
fun StaffLoginScreen(
    eventId: String,
    onLoggedIn: (staffId: String, displayName: String, role: String) -> Unit,
    viewModel: StaffLoginViewModel = hiltViewModel(),
) {
    val roster by viewModel.roster.collectAsState()
    val state by viewModel.state.collectAsState()
    val coverPath by viewModel.coverImagePath.collectAsState()
    var selected by remember { mutableStateOf<StaffLoginViewModel.StaffOption?>(null) }
    var pin by remember { mutableStateOf("") }

    LaunchedEffect(eventId) { viewModel.loadRoster(eventId) }

    LaunchedEffect(state) {
        val current = state
        if (current is StaffLoginViewModel.State.Success) {
            onLoggedIn(current.staffId, current.displayName, current.role)
        }
        // Clear the entry on any failure so the next attempt starts from empty
        // rather than appending to a wrong PIN.
        if (current is StaffLoginViewModel.State.WrongPin ||
            current is StaffLoginViewModel.State.LockedOut
        ) {
            pin = ""
        }
    }

    val dimens = LocalDimens.current

    Surface(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                // Vertical padding is halved against the horizontal. On a phone in
                // landscape the full 24dp top and bottom is 12% of the whole
                // window, and there is nothing beside the content competing for
                // the horizontal space it gives back.
                .padding(
                    horizontal = dimens.screenPadding,
                    vertical = dimens.screenPadding * 0.5f,
                ),
        ) {
            val current = selected
            if (current == null) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    /*
                     * The wordmark, in the script face — the one brand moment in
                     * the whole app. It appears here and nowhere else: staff see
                     * this screen at the start of a shift and at every handover,
                     * which is exactly when it is worth saying whose product this
                     * is.
                     *
                     * On a phone it drops to the smaller display size and the
                     * strapline goes: 44sp of script plus a tracked-caps line is
                     * a fifth of a landscape phone's height, spent on branding,
                     * on the screen where a supervisor is trying to find their
                     * own name in a list.
                     *
                     * The couple's photograph sits BESIDE it, as a portrait, so
                     * it costs no height at all on a screen where height is the
                     * scarce axis — the wordmark row already exists. An usher
                     * signing on sees whose night this is in the same glance as
                     * whose app it is.
                     */
                    val portrait = if (dimens.compact) 56.dp else 88.dp
                    val cover = rememberEventCover(path = coverPath, targetWidth = portrait)

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (cover != null) {
                            EventCoverFrame(
                                image = cover,
                                modifier = Modifier.size(portrait),
                                // A disc, not a rounded square. At this size beside
                                // a script wordmark a rectangle reads as a UI
                                // element; a disc reads as a portrait.
                                cornerRadius = portrait / 2,
                            )
                            Spacer(Modifier.width(20.dp))
                        }

                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            // The shared mark. It used to be declared inline
                            // here, which is how the app's identity came to
                            // first appear on its third screen; setup now opens
                            // with it and this is the same component.
                            Wordmark()
                        }
                    }

                    Spacer(Modifier.height(if (dimens.compact) 10.dp else 18.dp))

                    /*
                     * "Who is on the door?" — at every size.
                     *
                     * This was previously hidden whenever `dimens.compact` was
                     * true, to buy back the height a tracked-caps line costs
                     * under the wordmark. It is the ONLY instruction on the
                     * screen, and dropping it left a small tablet showing a
                     * wordmark above an unlabelled column of names — on the
                     * device where there is least room to guess.
                     *
                     * The height is bought back from the wordmark's own
                     * strapline slot instead, and by using the heading style
                     * rather than a label: it reads as the question it is, and
                     * it is one line either way.
                     */
                    Text(
                        stringResource(R.string.login_title),
                        style = if (dimens.compact) {
                            MaterialTheme.typography.titleLarge
                        } else {
                            MaterialTheme.typography.headlineLarge
                        },
                        color = MaterialTheme.colorScheme.onBackground,
                        textAlign = TextAlign.Center,
                    )

                    Spacer(Modifier.height(if (dimens.compact) 10.dp else 18.dp))

                    if (state is StaffLoginViewModel.State.RosterEmpty && roster.isEmpty()) {
                        Text(
                            stringResource(R.string.login_roster_empty),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }

                    // weight(1f), not wrap: without it the list is measured against
                    // the whole remaining height and the last staff row can sit
                    // below the bottom edge with no way to scroll to it, because
                    // the column around it does not scroll either.
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier
                            .fillMaxWidth(if (dimens.compact) 0.9f else 0.7f)
                            .weight(1f),
                    ) {
                        items(roster, key = { it.staffId }) { option ->
                            StaffRow(
                                option = option,
                                onClick = {
                                    selected = option
                                    pin = ""
                                    viewModel.clearError()
                                },
                            )
                        }
                    }
                }
            } else {
                // Scrolled, so a long name or a wrapped lockout message can never
                // push a keypad row off the bottom of a short window.
                ScrollableCenteredColumn {
                    PinEntry(
                        staff = current,
                        pin = pin,
                        state = state,
                        onDigit = { digit ->
                            if (pin.length < PIN_LENGTH) {
                                pin += digit
                                if (pin.length == PIN_LENGTH) {
                                    viewModel.submitPin(current.staffId, pin)
                                }
                            }
                        },
                        onBackspace = { if (pin.isNotEmpty()) pin = pin.dropLast(1) },
                        onBack = {
                            selected = null
                            pin = ""
                            viewModel.clearError()
                        },
                    )
                }
            }
        }
    }
}

/**
 * One person, as a card that is entirely the touch target.
 *
 * Previously the card was inert and only a small "OK" button at its end
 * navigated — so the obvious thing to tap (the person's name) did nothing, and
 * the working control was an unlabelled affirmative. The name IS the button now.
 */
@Composable
private fun StaffRow(
    option: StaffLoginViewModel.StaffOption,
    onClick: () -> Unit,
) {
    val dimens = LocalDimens.current
    val locked = option.isLocked()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 88.dp)
            // A locked entry is still tappable: the PIN screen is where a
            // supervisor performs the offline reset (§21.8), so blocking entry
            // here would remove the only recovery path at a venue.
            .pressableSurface(
                onClick = onClick,
                shape = RoundedCornerShape(dimens.cardRadius),
            )
            .padding(horizontal = 28.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                option.displayName,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            RoleChip(isSupervisor = option.role == "supervisor")
            if (locked && option.lockedUntil != null) {
                Text(
                    text = DateFormat.getTimeInstance(DateFormat.SHORT)
                        .format(Date(option.lockedUntil)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = StateAttention,
                    maxLines = 1,
                )
            }
        }
        Chevron(color = MaterialTheme.colorScheme.primary, pointsBack = false)
    }
}

/**
 * Usher or supervisor, told apart at a glance.
 *
 * The role was already on the row — as a muted subtitle, in the same colour and
 * weight for both, which meant the two were distinguishable only by reading.
 * The difference is not cosmetic: only a supervisor can override an admission or
 * close an event, so at a handover mid-rush the question "which of us can do
 * that" is asked of this list, and a colour answers it faster than a word.
 *
 * Usher stays deliberately quiet. It is the common case, and making both roles
 * loud would restore exactly the sameness this fixes.
 */
@Composable
private fun RoleChip(isSupervisor: Boolean) {
    val container = if (isSupervisor) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
    } else {
        MaterialTheme.colorScheme.surfaceVariant
    }
    val content = if (isSupervisor) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Text(
        text = stringResource(
            if (isSupervisor) R.string.login_role_supervisor else R.string.login_role_usher,
        ),
        style = MaterialTheme.typography.bodyMedium,
        color = content,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(container)
            .padding(horizontal = 12.dp, vertical = 3.dp),
    )
}

@Composable
private fun PinEntry(
    staff: StaffLoginViewModel.StaffOption,
    pin: String,
    state: StaffLoginViewModel.State,
    onDigit: (Char) -> Unit,
    onBackspace: () -> Unit,
    onBack: () -> Unit,
) {
    /*
     * Two columns, side by side, because this screen is always landscape.
     *
     * Stacked vertically — which is what this was — the heading, the dots, the
     * status line, a four-row keypad and the way out add up to roughly 670dp.
     * A phone's landscape content area is about 280dp and a 10-inch tablet's is
     * about 490dp, so the column overflowed on EVERY device and the bottom row
     * of keys, which includes zero, was simply not on the screen. Nothing
     * scrolled, so there was no way to reach it.
     *
     * Side by side the tall part — the keypad — gets the full height to itself
     * and everything that only needs to be read goes beside it. That is also the
     * better shape for the hardware: on a landscape screen the eye is already
     * scanning horizontally, and the keypad ends up under the hand holding the
     * tablet rather than across the middle of it.
     *
     * The whole thing still sits inside a scroller (see the caller), so an
     * unusually long staff name or a three-line lockout message cannot push a
     * key off the bottom.
     */
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(32.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                stringResource(R.string.login_enter_pin, staff.displayName),
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(20.dp))

            // Masked, but showing how many digits have been entered — a door PIN
            // is typed while people are watching, and a blank field gives no
            // feedback at all on a tablet with no haptics.
            PinDots(entered = pin.length, length = PIN_LENGTH)

            Spacer(Modifier.height(16.dp))

            when (state) {
                is StaffLoginViewModel.State.Verifying -> {
                    // The 600k-iteration derivation is deliberately slow (§18.5)
                    // and can exceed a second on a low-end tablet. Without this,
                    // staff would assume the tap did not register and try again.
                    CircularProgressIndicator()
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.login_verifying),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                is StaffLoginViewModel.State.WrongPin -> Text(
                    stringResource(R.string.login_wrong_pin, state.attemptsRemaining),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                )
                is StaffLoginViewModel.State.LockedOut -> Text(
                    stringResource(R.string.login_locked_out),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                )
                else -> Spacer(Modifier.height(28.dp))
            }

            Spacer(Modifier.height(24.dp))

            // Says where it goes. "Cancel" on a PIN pad is ambiguous — cancel the
            // digits, or cancel being this person?
            SecondaryAction(
                text = stringResource(R.string.login_someone_else),
                onClick = onBack,
            )
        }

        // No weight, deliberately: the pad is a fixed grid of fixed keys and must
        // never be stretched or squeezed by the column beside it. It takes
        // exactly what it needs and the text column takes the rest — a key that
        // changes size between screens is a key that gets mistyped in the dark.
        PinKeypad(
            enabled = state !is StaffLoginViewModel.State.Verifying,
            onDigit = onDigit,
            onBackspace = onBackspace,
        )
    }
}

private const val PIN_LENGTH = 4
