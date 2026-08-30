package com.fancyrsvp.checkin.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.ui.components.EventCoverFrame
import com.fancyrsvp.checkin.ui.components.PinDots
import com.fancyrsvp.checkin.ui.components.PinKeypad
import com.fancyrsvp.checkin.ui.components.ScrollableCenteredColumn
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.components.rememberEventCover
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.safeChrome

/**
 * The lock screen shown after a session times out (spec §20.4).
 *
 * PIN re-entry for the SAME staff member, or one tap to hand over to someone else —
 * §18.5 requires staff switching to be fast because handover happens mid-rush.
 *
 * ── What this overlay does NOT do ──
 *
 * It gates the UI only. The sync engine keeps draining underneath: the Keystore key
 * deliberately does not require user authentication (see SecureStore) precisely so a
 * locked tablet still sends the check-ins it is holding. Locking protects the guest
 * list from a passer-by; it must not strand data.
 */
@Composable
fun SessionLockOverlay(
    onUnlocked: () -> Unit,
    onSwitchStaff: () -> Unit,
    viewModel: SessionLockViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val staffName by viewModel.staffName.collectAsState()
    val coverPath by viewModel.coverImagePath.collectAsState()
    var pin by remember { mutableStateOf("") }
    val dimens = LocalDimens.current

    // LaunchedEffect, not a bare call: composition can run any number of times and
    // must stay free of side effects. Invoking the callback inline fires it again
    // on every recomposition that observes the unlocked state — and `onUnlocked`
    // navigates, so the duplicates are not harmless.
    if (state is SessionLockViewModel.State.Unlocked) {
        LaunchedEffect(Unit) { onUnlocked() }
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // Opaque, not translucent: the point is that the guest list underneath is
            // not readable by whoever picked the tablet up.
            //
            // The background covers the whole window — including behind the system
            // bars, which is what keeps the lock opaque edge to edge — and only the
            // content inside is inset.
            .background(MaterialTheme.colorScheme.background)
            .safeChrome(),
        contentAlignment = Alignment.Center,
    ) {
        /*
         * Two columns, and scrolled — the same shape as the login screen's PIN
         * entry, for the same reason and with more at stake.
         *
         * Stacked, this ran a heading, a body line, the dots, a status line, a
         * four-row keypad and a sign-out button down one column: over 700dp. A
         * phone in landscape has around 340dp here. The bottom of that column is
         * the keypad and the way to hand the tablet over, so an operator who let
         * the screen lock at a venue could not unlock it OR pass it to a
         * supervisor. There is no way out of that except restarting the app.
         */
        ScrollableCenteredColumn(
            modifier = Modifier.padding(
                horizontal = dimens.screenPadding,
                vertical = dimens.screenPadding * 0.5f,
            ),
        ) {
            Row(
                modifier = Modifier.widthIn(max = 900.dp),
                horizontalArrangement = Arrangement.spacedBy(32.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // The couple, as a disc above the prompt (§9.8).
                    //
                    // Hidden on a compact screen: a landscape phone has about
                    // 340dp here and every one of them is already spoken for by
                    // the prompt and the keypad. A picture that pushes a key off
                    // the bottom is worse than no picture.
                    if (!dimens.compact) {
                        val cover = rememberEventCover(path = coverPath, targetWidth = 96.dp)
                        if (cover != null) {
                            EventCoverFrame(
                                image = cover,
                                modifier = Modifier.size(96.dp),
                                cornerRadius = 48.dp,
                            )
                            Spacer(Modifier.height(20.dp))
                        }
                    }

                    Text(
                        stringResource(R.string.session_locked_title),
                        style = MaterialTheme.typography.headlineLarge,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        stringResource(R.string.session_locked_body, staffName ?: ""),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )

                    Spacer(Modifier.height(24.dp))

                    PinDots(entered = pin.length, length = PIN_LENGTH)

                    Spacer(Modifier.height(16.dp))

                    when (val current = state) {
                        SessionLockViewModel.State.Verifying -> {
                            CircularProgressIndicator()
                            Spacer(Modifier.height(8.dp))
                            Text(stringResource(R.string.login_verifying))
                        }
                        is SessionLockViewModel.State.WrongPin -> Text(
                            stringResource(R.string.login_wrong_pin, current.attemptsRemaining),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center,
                        )
                        is SessionLockViewModel.State.LockedOut -> Text(
                            stringResource(R.string.login_locked_out),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center,
                        )
                        else -> Spacer(Modifier.height(28.dp))
                    }

                    Spacer(Modifier.height(24.dp))

                    // One tap to hand the tablet over — §18.5. Signing out is
                    // always available, because a supervisor arriving to relieve
                    // an usher must not need the usher's PIN first.
                    SecondaryAction(
                        text = stringResource(R.string.session_switch_staff),
                        onClick = {
                            viewModel.signOut()
                            onSwitchStaff()
                        },
                    )
                }

                PinKeypad(
                    enabled = state !is SessionLockViewModel.State.Verifying,
                    onDigit = { digit ->
                        if (pin.length < PIN_LENGTH) {
                            pin += digit
                            if (pin.length == PIN_LENGTH) {
                                viewModel.submit(pin)
                                pin = ""
                            }
                        }
                    },
                    onBackspace = { if (pin.isNotEmpty()) pin = pin.dropLast(1) },
                )
            }
        }
    }
}

private const val PIN_LENGTH = 4
