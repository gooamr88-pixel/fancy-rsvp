package com.fancyrsvp.checkin.ui.prepare

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.data.repo.BundleRepository
import com.fancyrsvp.checkin.ui.components.Chevron
import com.fancyrsvp.checkin.ui.components.EventCoverFrame
import com.fancyrsvp.checkin.ui.components.PrimaryAction
import com.fancyrsvp.checkin.ui.components.QuietAction
import com.fancyrsvp.checkin.ui.components.ScrollableCenteredColumn
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.components.SetupHeader
import com.fancyrsvp.checkin.ui.components.SetupStep
import com.fancyrsvp.checkin.ui.components.pressableSurface
import com.fancyrsvp.checkin.ui.components.rememberEventCover
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.StateAlready
import com.fancyrsvp.checkin.ui.theme.StateAttention
import com.fancyrsvp.checkin.ui.theme.StateNeutral
import com.fancyrsvp.checkin.ui.theme.StateWelcome
import java.text.DateFormat
import java.util.Date
import java.util.TimeZone

/**
 * The event start, on the VENUE's clock rather than this tablet's.
 *
 * `startsAt` is a real instant, so formatting it with the platform default
 * DateFormat renders it in whatever zone the DEVICE is set to. A check-in
 * tablet is routinely rented, borrowed, or straight out of the box, and its
 * zone is something nobody has ever checked — so staff at the door could be
 * shown a start time hours away from the one printed on the invitations the
 * guests in front of them are holding.
 *
 * A null zone means the row predates the column (see MIGRATION_2_3) or the
 * server did not supply one. Falling back to the device zone keeps exactly the
 * old behaviour for those rows rather than inventing a clock.
 */
private fun formatEventStart(startsAt: Long, timezone: String?): String {
    val fmt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
    if (timezone != null) {
        val zone = TimeZone.getTimeZone(timezone)
        // getTimeZone falls back to GMT for an unrecognised id rather than
        // throwing, so an unknown zone would silently render GMT. Checking the
        // resolved id catches that and keeps the device zone instead.
        if (zone.id == timezone) fmt.timeZone = zone
    }
    return fmt.format(Date(startsAt))
}

/**
 * Is this tablet ready for tonight? (spec §8.2)
 *
 * ── One question, one card ──
 *
 * This screen used to stack seven things: a title, an internet notice, a
 * refresh button, an error slot, an empty state, a progress panel, and a list
 * of event cards — all visible at once, whether or not any of them applied.
 *
 * There is only ever one thing an operator needs to know here, and it is not a
 * list: can I leave for the venue yet. So the normal case — one event assigned
 * to this gate — is ONE card, stating the answer in words, with one large
 * button under it.
 *
 * A second event only appears if one genuinely exists, and picking one is
 * screen state rather than a route, so this stays a single level.
 */
@Composable
fun PrepareScreen(
    onEventReady: (eventId: String) -> Unit,
    onReleased: () -> Unit,
    viewModel: PrepareViewModel = hiltViewModel(),
) {
    val events by viewModel.events.collectAsState()
    val progress by viewModel.progress.collectAsState()
    val preparingId by viewModel.preparingEventId.collectAsState()
    val refreshing by viewModel.refreshing.collectAsState()
    val listError by viewModel.listError.collectAsState()
    val unpairBlockedBy by viewModel.unpairBlockedBy.collectAsState()
    val unpairing by viewModel.unpairing.collectAsState()
    val dimens = LocalDimens.current

    var confirmRelease by remember { mutableStateOf(false) }
    var chosenId by remember { mutableStateOf<String?>(null) }
    // With a single event there is nothing to choose, so the picker is skipped
    // entirely rather than shown as a list of one.
    val selected = events.firstOrNull { it.id == chosenId }
        ?: events.singleOrNull()

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                // Half the padding vertically. The app is locked to landscape, so
                // height is always the scarce axis and the full inset is spent
                // where there is least of it — on a phone, 24dp top and bottom is
                // an eighth of the whole window given to empty margin.
                .padding(
                    horizontal = dimens.screenPadding,
                    vertical = dimens.screenPadding * 0.5f,
                ),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SetupHeader(
                current = SetupStep.Prepare,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(dimens.sectionGap * 0.6f))

            // "This tablet" named the screen. The screen's job is a question —
            // can I leave for the venue yet — and its title should be the
            // instruction that answers it.
            Text(
                text = stringResource(R.string.prepare_title),
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(dimens.sectionGap * 0.7f))

            Box(Modifier.widthIn(max = 760.dp).weight(1f)) {
                /*
                 * The scroll is applied per-branch rather than once around the
                 * `when`, and that is not a style choice: three of these branches
                 * are fixed columns and need one, but [EventPicker] owns a
                 * LazyColumn, and a lazy list measured against an infinite height
                 * throws rather than degrading.
                 *
                 * The card matters most here. Heading, date, guest count,
                 * readiness sentence and a hero button do not fit a landscape
                 * phone, and this is the screen an operator reads before deciding
                 * whether they can leave for the venue.
                 */
                val currentProgress = progress
                when {
                    // Progress replaces the card entirely while it runs. An
                    // operator watching a 2000-guest download has exactly one
                    // question, and a card behind the progress panel does not
                    // help them answer it.
                    currentProgress != null -> ScrollableCenteredColumn(
                        horizontalAlignment = Alignment.Start,
                    ) {
                        ProgressPanel(
                            progress = currentProgress,
                            onDismiss = viewModel::dismissProgress,
                        )
                    }

                    selected != null -> ScrollableCenteredColumn(
                        horizontalAlignment = Alignment.Start,
                    ) {
                        ReadyCard(
                            event = selected,
                            isBusy = preparingId == selected.id,
                            anyBusy = preparingId != null,
                            onPrepare = { viewModel.prepare(selected.id) },
                            onOpen = { onEventReady(selected.id) },
                        )
                    }

                    events.isEmpty() -> ScrollableCenteredColumn(
                        horizontalAlignment = Alignment.Start,
                    ) {
                        NothingAssigned(
                            refreshing = refreshing,
                            error = listError,
                            onRefresh = viewModel::refresh,
                        )
                    }

                    // Owns a LazyColumn. Already scrollable; must not be wrapped.
                    else -> EventPicker(
                        events = events,
                        onPick = { chosenId = it },
                    )
                }
            }

            // Only offered where it is the answer to something. With a card on
            // screen the operator's next action is the button on the card, not
            // a refresh.
            if (progress == null && selected != null) {
                Spacer(Modifier.height(dimens.sectionGap))
                SecondaryAction(
                    text = stringResource(
                        if (refreshing) R.string.prepare_refreshing else R.string.prepare_refresh,
                    ),
                    onClick = viewModel::refresh,
                    enabled = !refreshing && preparingId == null,
                )
                if (events.size > 1) {
                    Spacer(Modifier.height(8.dp))
                    QuietAction(
                        text = stringResource(R.string.prepare_choose_another),
                        onClick = { chosenId = null },
                    )
                }
            }

            /*
             * The way out of a pairing.
             *
             * Deliberately the quietest control on the screen and deliberately
             * present on all of its states, including "no events assigned" —
             * which is precisely the screen a tablet paired to the wrong account
             * lands on, and where the operator previously had nothing to do but
             * tap Refresh at a dashboard that was never going to answer.
             */
            if (progress == null) {
                Spacer(Modifier.height(8.dp))
                QuietAction(
                    text = stringResource(R.string.prepare_release),
                    onClick = { confirmRelease = true },
                )
            }
        }
    }

    if (confirmRelease) {
        ReleaseTabletDialog(
            busy = unpairing,
            onConfirm = {
                viewModel.unpair {
                    confirmRelease = false
                    onReleased()
                }
            },
            onDismiss = { confirmRelease = false },
        )
    }

    // Shown INSTEAD of the release going through, not alongside it. The tablet
    // is still paired and still holds the check-ins, which is the whole reason
    // the attempt was refused.
    unpairBlockedBy?.let { pending ->
        ReleaseBlockedDialog(
            pending = pending,
            onDismiss = {
                viewModel.clearUnpairBlock()
                confirmRelease = false
            },
        )
    }
}

/**
 * Confirms releasing the tablet.
 *
 * A confirmation rather than a straight action because it destroys the local
 * guest list and the credentials together, and the control sits on a screen
 * staff open before every event. The body says what is lost, in the order it
 * matters.
 */
@Composable
private fun ReleaseTabletDialog(
    busy: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = {
            Text(
                stringResource(R.string.prepare_release_title),
                style = MaterialTheme.typography.headlineLarge,
            )
        },
        text = {
            Text(
                stringResource(R.string.prepare_release_body),
                style = MaterialTheme.typography.bodyLarge,
            )
        },
        // TextButton, matching the app's other dialogs. PrimaryAction and
        // DestructiveAction both apply fillMaxWidth internally, so dropping one
        // into a dialog's button slot makes it claim the whole row and pushes
        // Cancel onto a second line at hero height.
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = !busy,
                modifier = Modifier.heightIn(min = LocalDimens.current.minTouch),
            ) {
                Text(
                    stringResource(R.string.prepare_release_confirm),
                    style = MaterialTheme.typography.titleLarge,
                    // The one destructive word in the dialog, in the one colour
                    // reserved for destructive actions.
                    color = StateAttention,
                )
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                enabled = !busy,
                modifier = Modifier.heightIn(min = LocalDimens.current.minTouch),
            ) {
                Text(
                    stringResource(R.string.action_cancel),
                    style = MaterialTheme.typography.titleLarge,
                )
            }
        },
    )
}

/**
 * The refusal. Unsent check-ins exist nowhere else, and releasing the tablet
 * clears the credentials they would be sent with.
 */
@Composable
private fun ReleaseBlockedDialog(
    pending: Int,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                stringResource(R.string.prepare_release_blocked_title),
                style = MaterialTheme.typography.headlineLarge,
            )
        },
        text = {
            Text(
                // Zero is the view model's marker for "the attempt itself
                // failed", which is a different sentence: nothing is being held
                // back, the release simply did not happen.
                text = if (pending > 0) {
                    stringResource(R.string.prepare_release_blocked_body, pending)
                } else {
                    stringResource(R.string.prepare_release_failed)
                },
                style = MaterialTheme.typography.bodyLarge,
            )
        },
        confirmButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.heightIn(min = LocalDimens.current.minTouch),
            ) {
                Text(
                    stringResource(R.string.action_ok),
                    style = MaterialTheme.typography.titleLarge,
                )
            }
        },
    )
}

/**
 * The card. Says in words whether this tablet is ready tonight.
 *
 * Readiness is the card's own ground colour and its headline sentence, not a
 * 12dp coloured dot beside a label — at arm's length in an office a dot is not
 * a status, it is a decoration.
 */
@Composable
private fun ReadyCard(
    event: PrepareViewModel.EventRow,
    isBusy: Boolean,
    anyBusy: Boolean,
    onPrepare: () -> Unit,
    onOpen: () -> Unit,
) {
    val dimens = LocalDimens.current
    val ready = event.readiness == PrepareViewModel.Readiness.READY_OFFLINE

    val (accent, headline) = when (event.readiness) {
        PrepareViewModel.Readiness.READY_OFFLINE -> StateWelcome to stringResource(R.string.prepare_ready)
        PrepareViewModel.Readiness.NEEDS_SYNC -> StateAlready to stringResource(R.string.prepare_needs_sync)
        PrepareViewModel.Readiness.NOT_PREPARED -> StateNeutral to stringResource(R.string.prepare_not_prepared)
    }

    // Sized for the portrait it is: 168dp square on a tablet, 120 on a phone
    // where the card has to share a much shorter window.
    val portraitSize = if (dimens.compact) 120.dp else 168.dp
    val cover = rememberEventCover(path = event.coverImagePath, targetWidth = portraitSize)

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(dimens.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(dimens.cardPadding),
    ) {
        // The photograph BESIDE the name, not behind it.
        //
        // This card is read, not admired — an operator is checking a date, a
        // venue and a guest count before they drive somewhere. Type over
        // photography would cost legibility for no gain, so the picture sits
        // alongside as a portrait and the text keeps its plain surface.
        //
        // It disappears entirely when the event has none, and the row collapses
        // back to exactly the old layout rather than leaving a placeholder.
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (cover != null) {
                EventCoverFrame(
                    image = cover,
                    modifier = Modifier.size(portraitSize),
                    cornerRadius = dimens.cardRadius * 0.7f,
                )
                Spacer(Modifier.width(dimens.cardPadding))
            }

            Column(Modifier.weight(1f)) {
                Text(
                    event.name,
                    style = MaterialTheme.typography.headlineLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = listOfNotNull(
                        event.venue,
                        formatEventStart(event.startsAt, event.timezone),
                        event.totalInvited.takeIf { it > 0 }
                            ?.let { stringResource(R.string.prepare_guest_count, it) },
                    ).joinToString("  ·  "),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Spacer(Modifier.height(dimens.sectionGap))

        // The answer, as a sentence, in the state's own colour.
        Text(
            headline,
            style = MaterialTheme.typography.displayMedium,
            color = accent,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        event.lastSyncedAt?.let {
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(
                    R.string.freshness_from,
                    DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)),
                ),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }

        Spacer(Modifier.height(dimens.sectionGap))

        if (ready) {
            PrimaryAction(
                text = stringResource(R.string.prepare_start),
                onClick = onOpen,
                hero = true,
            )
        } else {
            PrimaryAction(
                text = if (isBusy) {
                    stringResource(R.string.prepare_fetching_manifest)
                } else {
                    stringResource(R.string.prepare_download)
                },
                onClick = onPrepare,
                // Disabled while ANY event is preparing: two concurrent bundle
                // downloads would compete for the same weak connection and make
                // both slower, and the progress panel can only speak for one.
                enabled = !anyBusy,
                hero = true,
            )
            Spacer(Modifier.height(10.dp))
            // Stated where it applies, as §8.2 requires: the operator must
            // understand that connectivity is needed NOW, not at the venue.
            Text(
                stringResource(R.string.prepare_internet_notice),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * More than one event is assigned to this gate.
 *
 * Rare, and the only reason a list survives on this screen at all. Each row is
 * a full card rather than a dense line, because it is picked once, in an
 * office, and being unmistakable matters more than being compact.
 */
@Composable
private fun EventPicker(
    events: List<PrepareViewModel.EventRow>,
    onPick: (String) -> Unit,
) {
    val dimens = LocalDimens.current

    Column {
        Text(
            stringResource(R.string.prepare_which_event),
            style = MaterialTheme.typography.headlineLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(dimens.sectionGap))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(events, key = { it.id }) { event ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 88.dp)
                        .pressableSurface(
                            onClick = { onPick(event.id) },
                            shape = RoundedCornerShape(dimens.cardRadius),
                        )
                        .padding(horizontal = 24.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            event.name,
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onBackground,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            formatEventStart(event.startsAt, event.timezone),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                    Chevron(color = MaterialTheme.colorScheme.primary, pointsBack = false)
                }
            }
        }
    }
}

/**
 * No events. Says WHY and what to do.
 *
 * Silence here reads as a broken app, and the operator has no way to tell
 * "still loading" from "this device is not assigned to any event".
 */
@Composable
private fun NothingAssigned(
    refreshing: Boolean,
    error: String?,
    onRefresh: () -> Unit,
) {
    val dimens = LocalDimens.current
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            stringResource(
                if (refreshing) R.string.prepare_refreshing else R.string.prepare_no_events,
            ),
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(
                it,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.error,
            )
        }
        Spacer(Modifier.height(dimens.sectionGap))
        PrimaryAction(
            text = stringResource(R.string.prepare_refresh),
            onClick = onRefresh,
            enabled = !refreshing,
        )
    }
}

/**
 * Download progress with REAL COUNTS, never an indeterminate spinner (§8.2).
 *
 * On a 2000-guest event over a weak connection a spinner cannot distinguish
 * "working" from "stalled", and the operator has to decide whether to wait.
 */
@Composable
private fun ProgressPanel(
    progress: BundleRepository.Progress,
    onDismiss: () -> Unit,
) {
    val dimens = LocalDimens.current
    val accent = when (progress) {
        is BundleRepository.Progress.Failed -> StateAttention
        is BundleRepository.Progress.Done -> StateWelcome
        else -> MaterialTheme.colorScheme.primary
    }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(dimens.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(dimens.cardPadding),
    ) {
        Text(
            text = progressText(progress),
            style = MaterialTheme.typography.headlineMedium,
            color = accent,
        )

        if (progress is BundleRepository.Progress.Downloading && progress.total > 0) {
            Spacer(Modifier.height(dimens.sectionGap))
            LinearProgressIndicator(
                progress = { progress.downloaded.toFloat() / progress.total.toFloat() },
                color = accent,
                trackColor = MaterialTheme.colorScheme.outline,
                modifier = Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)),
            )
        }

        if (progress is BundleRepository.Progress.Failed || progress is BundleRepository.Progress.Done) {
            Spacer(Modifier.height(dimens.sectionGap))
            PrimaryAction(
                text = stringResource(R.string.action_ok),
                onClick = onDismiss,
                containerColor = accent,
                contentColor = Color.White,
            )
        }
    }
}

@Composable
private fun progressText(progress: BundleRepository.Progress): String = when (progress) {
    BundleRepository.Progress.FetchingManifest -> stringResource(R.string.prepare_fetching_manifest)
    is BundleRepository.Progress.Downloading -> stringResource(
        R.string.prepare_downloading,
        progress.downloaded, progress.total, progress.page, progress.totalPages,
    )
    BundleRepository.Progress.Verifying -> stringResource(R.string.prepare_verifying)
    BundleRepository.Progress.FetchingArtwork -> stringResource(R.string.prepare_fetching_artwork)
    BundleRepository.Progress.Promoting -> stringResource(R.string.prepare_promoting)
    is BundleRepository.Progress.Done -> stringResource(R.string.prepare_done, progress.recordCount)
    is BundleRepository.Progress.Failed -> failureText(progress.reason)
}

@Composable
private fun failureText(failure: BundleRepository.Failure): String = when (failure) {
    BundleRepository.Failure.Offline -> stringResource(R.string.prepare_failed_offline)
    BundleRepository.Failure.NotAuthorised -> stringResource(R.string.prepare_failed_not_authorised)
    BundleRepository.Failure.FeatureNotAvailable -> stringResource(R.string.prepare_failed_feature)
    // These two say plainly that NOTHING was saved. A partially downloaded guest
    // list is the failure §21.1 exists to prevent, and it must never be left
    // looking like a partial success the operator could work with.
    is BundleRepository.Failure.Incomplete -> stringResource(
        R.string.prepare_failed_incomplete, failure.actual, failure.expected,
    )
    is BundleRepository.Failure.Corrupted -> stringResource(R.string.prepare_failed_corrupted)
    is BundleRepository.Failure.NoStorage ->
        stringResource(R.string.prepare_no_space, failure.guestCount)
    is BundleRepository.Failure.Server -> stringResource(R.string.prepare_failed_server, failure.code)
    is BundleRepository.Failure.Unknown -> stringResource(R.string.prepare_failed_unknown)
}
