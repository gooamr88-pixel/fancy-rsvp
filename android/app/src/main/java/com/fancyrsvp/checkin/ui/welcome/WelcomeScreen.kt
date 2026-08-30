package com.fancyrsvp.checkin.ui.welcome

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.CrashLog
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.ui.components.CrashReportScreen
import com.fancyrsvp.checkin.ui.components.PrimaryAction
import com.fancyrsvp.checkin.ui.components.ScrollableCenteredColumn
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.components.SetupRail
import com.fancyrsvp.checkin.ui.components.Wordmark
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.safeChrome

/**
 * The first thing an unpaired tablet shows.
 *
 * ── Why this screen exists ──
 *
 * The app used to open straight onto the pairing form: a headline, a sentence
 * about a dashboard, and an eight-character field. No logo, no name, nothing
 * saying what the tablet in your hands was for. Someone handed a device in an
 * office could not tell which app had opened, let alone that they were three
 * screens from a working door.
 *
 * One screen, one sentence, one button. It is shown once in the life of a
 * tablet and never again — a paired device goes straight to preparation,
 * because staff arriving at a venue must not be made to tap past a greeting.
 *
 * ── What it is NOT ──
 *
 * Not a splash. Nothing here expires on a timer and nothing routes on its own:
 * a screen that vanishes while you are still reading it teaches people to stop
 * reading. It waits.
 */
@Composable
fun WelcomeScreen(
    onStart: () -> Unit,
    onOpenGuide: () -> Unit,
) {
    val dimens = LocalDimens.current
    val context = LocalContext.current

    /*
     * The crash report takes over the whole screen, and it lives here because
     * this is now the first screen an unpaired tablet shows — it moved with
     * that title, from PairScreen.
     *
     * A takeover rather than something appended below the greeting: a crash
     * report is long, and tucked under a hero button it is something nobody
     * scrolls to. Taking the screen is the only way it gets read.
     *
     * A paired tablet never reaches this screen. Its route to the same report
     * is Menu → "Last crash", which is unchanged.
     */
    var crashReport by remember { mutableStateOf(CrashLog.read(context)) }
    crashReport?.let { report ->
        CrashReportScreen(
            report = report,
            onDismiss = {
                CrashLog.clear(context)
                crashReport = null
            },
        )
        return
    }

    Surface(modifier = Modifier.fillMaxSize()) {
        /*
         * ScrollableCenteredColumn, not a plain Column with weighted spacers.
         *
         * It was the latter, and that clips. The tightest case this has to survive
         * is a 390dp-tall landscape phone; this screen stacks a large script
         * wordmark, a headline, a
         * tagline, an 88dp hero, a secondary action, a notice and the step rail,
         * which is more than that height holds. Weighted spacers collapse to
         * zero and then the overflow is simply cut off — taking the step rail
         * with it, on a Column that cannot scroll to reach it.
         *
         * The helper centres the content when there is room, which is the tablet
         * case and how this screen is meant to look, and scrolls when there is
         * not. Same component PrepareScreen uses for the same reason.
         */
        ScrollableCenteredColumn(
            // Insets before the design padding: the Surface above keeps the full
            // window so its colour runs under the system bars, and the content is
            // pushed clear of them.
            modifier = Modifier
                .safeChrome()
                .padding(
                    horizontal = dimens.screenPadding,
                    vertical = dimens.screenPadding * 0.5f,
                ),
        ) {
            // The mark is the content here, not a header on top of it, so it is
            // set large and centred rather than tucked into a corner. Every
            // screen after this one carries the small version in SetupHeader.
            Wordmark(large = true)

            Spacer(Modifier.height(if (dimens.compact) 2.dp else 6.dp))

            Text(
                text = stringResource(R.string.welcome_product),
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(dimens.sectionGap * 0.6f))

            Text(
                text = stringResource(R.string.welcome_tagline),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 520.dp),
            )

            Spacer(Modifier.height(dimens.sectionGap))

            Box(Modifier.widthIn(max = dimens.codeFieldMax)) {
                PrimaryAction(
                    text = stringResource(R.string.welcome_start),
                    onClick = onStart,
                    hero = true,
                )
            }

            Spacer(Modifier.height(10.dp))

            /*
             * The second thing on this screen, and deliberately not a third
             * hero.
             *
             * Someone who has a code presses the gold button and never reads
             * this. Someone who does not have one — which is most people
             * setting up a tablet for the first time, because the dashboard
             * belongs to the organizer and the tablet is being set up by whoever
             * was handed it — has nowhere else to go. The pairing screen behind
             * the button would ask them for eight characters and offer no way to
             * get them.
             */
            SecondaryAction(
                text = stringResource(R.string.howto_link),
                onClick = onOpenGuide,
                modifier = Modifier.widthIn(max = dimens.codeFieldMax),
            )

            Spacer(Modifier.height(14.dp))

            // Said here, before anything is attempted, because it is the single
            // most common way setup goes wrong: a tablet prepared at the venue,
            // on the venue's wifi, at the hour the guests arrive. Pairing and
            // the guest-list download both need a connection; nothing after
            // them does.
            Text(
                text = stringResource(R.string.welcome_internet_notice),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 520.dp),
            )

            Spacer(Modifier.height(dimens.sectionGap))

            // The whole errand, visible before it starts.
            //
            // `null`, not SetupStep.Pair. Passing Pair lit the first dot and
            // rendered a rail identical to the pairing screen's, so the one
            // indicator whose job is to say where you are could not tell these
            // two consecutive screens apart. Nothing has been started here yet,
            // and the rail now says so.
            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                SetupRail(current = null)
            }
        }
    }
}
