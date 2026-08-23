package com.fancyrsvp.checkin.ui.pair

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.ui.components.CodeCells
import com.fancyrsvp.checkin.ui.components.PrimaryAction
import com.fancyrsvp.checkin.ui.components.QuietAction
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.components.SetupHeader
import com.fancyrsvp.checkin.ui.components.SetupStep
import com.fancyrsvp.checkin.ui.theme.LocalDimens

/**
 * Device pairing (spec §18.3).
 *
 * Step one of three, reached from the welcome screen. It used to be the first
 * thing an unpaired tablet showed, and its own comment justified the sparseness
 * with "an operator does this once, in an office, with the code on another
 * screen in front of them" — an assumption that turned out to be doing most of
 * the work. The code arrives in a message, on somebody else's phone, and the
 * person holding the tablet is often not the person who generated it.
 *
 * The crash report used to take this screen over. It moved to WelcomeScreen
 * with the title of "first screen an unpaired tablet shows"; a paired tablet
 * still reaches the same report through Menu → Last crash.
 */
@Composable
fun PairScreen(
    onPaired: (eventId: String) -> Unit,
    onOpenGuide: () -> Unit,
    viewModel: PairViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val code by viewModel.code.collectAsState()

    LaunchedEffect(state) {
        val current = state
        if (current is PairViewModel.State.Paired) onPaired(current.eventId)
    }

    val dimens = LocalDimens.current
    val clipboard = LocalClipboardManager.current

    val busy = state is PairViewModel.State.Pairing
    // Distinct from a server error: the clipboard held nothing usable, which is
    // this screen's own finding and clears the moment anything is typed.
    var pasteFailed by remember { mutableStateOf(false) }

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    horizontal = dimens.screenPadding,
                    vertical = dimens.screenPadding * 0.5f,
                )
                /*
                 * imePadding BEFORE verticalScroll, and the order is the whole
                 * point.
                 *
                 * Outer-to-inner, so this shrinks the scroll VIEWPORT to the
                 * space above the keyboard. Written the other way round — which
                 * it was — the padding lands inside the scroller: the viewport
                 * still spans the full window, and `bringIntoView` (which the
                 * code field calls when it takes focus) happily scrolls the
                 * boxes to a position the keyboard is covering. Everything
                 * stayed reachable by dragging, which is exactly the kind of bug
                 * that survives a demo and fails at a desk.
                 *
                 * targetSdk 35 makes this load-bearing on Android 15, where
                 * edge-to-edge is enforced and the window is no longer resized
                 * for the IME. On older releases the window still resizes and
                 * this measures zero.
                 */
                .imePadding()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SetupHeader(
                current = SetupStep.Pair,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(dimens.sectionGap))

            Text(
                text = stringResource(R.string.pair_title),
                style = MaterialTheme.typography.headlineLarge,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = stringResource(R.string.pair_instructions),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(dimens.sectionGap))

            CodeCells(
                value = code,
                onValueChange = {
                    pasteFailed = false
                    viewModel.onCodeChanged(it)
                },
                onDone = viewModel::submit,
                enabled = !busy,
                isError = state is PairViewModel.State.Error,
            )

            /*
             * A slot that is always there, whether or not it holds anything.
             *
             * The error used to be inserted between the field and the button, so
             * the button DROPPED by a line at the exact moment an operator was
             * reaching for it — after a failed attempt, which is when they are
             * least patient and most likely to be looking at their hand rather
             * than the screen. Reserving the space costs one line of empty
             * screen and removes a mis-tap that only ever happens on the retry.
             */
            Box(
                modifier = Modifier
                    .heightIn(min = 56.dp)
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    busy -> CircularProgressIndicator()
                    pasteFailed -> Text(
                        text = stringResource(R.string.pair_paste_nothing),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                    )
                    else -> (state as? PairViewModel.State.Error)?.let { current ->
                        Text(
                            text = pairErrorText(current),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.widthIn(max = 620.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // weight() applied DIRECTLY to each action, not to a Box around
                // it. PrimaryAction ends its chain with fillMaxWidth and
                // SecondaryAction does not, so wrapping both in weighted boxes
                // stretched one and left the other sitting at text width in the
                // corner of an oversized slot — the 1 : 1.4 ratio was invisible
                // and the row read as two buttons that failed to line up.
                // weight(fill = true) hands down an exact width, so both obey.
                // BottomControls on the scanner already does it this way.
                SecondaryAction(
                    text = stringResource(R.string.pair_paste),
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                    /*
                     * Read on TAP and never on composition.
                     *
                     * Android 12 and later shows the operator a system toast
                     * every time an app reads the clipboard. Checking on each
                     * recomposition to decide whether to enable this button
                     * would fire that toast repeatedly, on a screen the app has
                     * just opened by itself, which looks exactly like the app
                     * snooping. So the button is always live and says what it
                     * found.
                     */
                    onClick = {
                        val pasted = clipboard.getText()?.text.orEmpty()
                            .uppercase()
                            .filter { it.isLetterOrDigit() }
                            .take(PAIRING_CODE_LENGTH)
                        if (pasted.isEmpty()) {
                            pasteFailed = true
                        } else {
                            pasteFailed = false
                            viewModel.onCodeChanged(pasted)
                        }
                    },
                )
                PrimaryAction(
                    text = stringResource(R.string.pair_submit),
                    onClick = viewModel::submit,
                    enabled = viewModel.canSubmit,
                    hero = true,
                    modifier = Modifier.weight(1.4f),
                )
            }

            Spacer(Modifier.height(8.dp))

            // Goes to the guide rather than expanding a panel here.
            //
            // An inline version existed for one revision and had two problems:
            // it was a second copy of instructions that must match a dashboard
            // this app does not control, and it could only ever be the short
            // version — no room for the seating-map step, which is the one that
            // actually blocks people.
            QuietAction(
                text = stringResource(R.string.pair_help_link),
                onClick = onOpenGuide,
            )
        }
    }
}

/** Mirrors DeviceRepository.PAIRING_CODE_LENGTH, which is private to it. */
private const val PAIRING_CODE_LENGTH = 8

// CrashReportScreen moved to ui/components/CrashReport.kt — the menu needs it too,
// and this screen is unreachable once a tablet is paired.

@Composable
private fun pairErrorText(error: PairViewModel.State.Error): String = when (error.kind) {
    PairViewModel.Kind.INVALID_CODE -> stringResource(R.string.pair_failed_invalid)
    PairViewModel.Kind.EXPIRED -> stringResource(R.string.pair_failed_expired)
    PairViewModel.Kind.DEVICE_LIMIT -> stringResource(R.string.pair_failed_limit)
    PairViewModel.Kind.OFFLINE -> stringResource(R.string.prepare_failed_offline)
    PairViewModel.Kind.SERVER -> error.detail ?: stringResource(R.string.prepare_failed_unknown)
}
