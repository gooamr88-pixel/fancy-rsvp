package com.fancyrsvp.checkin.ui.scanner

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.data.repo.CheckInRepository
import com.fancyrsvp.checkin.ui.components.BackToScannerBar
import com.fancyrsvp.checkin.ui.components.Chevron
import com.fancyrsvp.checkin.ui.components.pressableSurface
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.safeChrome
import com.fancyrsvp.checkin.ui.theme.StateAlready
import com.fancyrsvp.checkin.ui.theme.StateVip
import com.fancyrsvp.checkin.ui.theme.displayFamilyFor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Offline manual search (spec §8.5, §10).
 *
 * The fallback that makes every other failure survivable: a damaged or dirty
 * printed code, a guest with no invitation at all, a phone screen too dim to
 * scan. §10 requires it to be reachable in one tap from anywhere, which is why
 * it is an overlay rather than a separate destination — dismissing it returns to
 * a live camera with no navigation transition.
 *
 * Search runs entirely against the local bundle. It matches on NORMALISED names
 * (see NameNormalizer), so أحمد is found by typing احمد and a companion is found
 * by their own name rather than only by their party label.
 *
 * The way out is the same bar as every other screen. It used to be a small
 * "Close" button in the top corner, which is both a different pattern from the
 * rest of the app and the hardest place to reach one-handed.
 */
@Composable
fun ManualSearchOverlay(
    onSearch: suspend (String) -> List<CheckInRepository.PartyView>,
    onSelect: (CheckInRepository.PartyView) -> Unit,
    onClose: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<CheckInRepository.PartyView>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val dimens = LocalDimens.current

    // Focus the field immediately. An usher taps "search" because there is
    // someone in front of them; making them tap the field as well costs a
    // second every time.
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    // Debounced so a 2000-guest scan does not run on every keystroke. 180ms is
    // below the threshold where typing feels laggy but well above a single
    // keypress, so a full name costs one query rather than twenty.
    LaunchedEffect(query) {
        if (query.isBlank()) {
            results = emptyList()
            searching = false
            return@LaunchedEffect
        }
        searching = true
        delay(180)
        // This runs on the COMPOSITION's coroutine scope, which has no exception
        // handler: anything the encrypted database throws — a corrupt page, a
        // failed key read, a query error on a name with an unusual character —
        // reaches the default uncaught handler and kills the process. The overlay
        // is the fallback that makes every other failure survivable (§8.5), so it
        // is the last thing in the app allowed to take it down.
        results = try {
            onSearch(query)
        } catch (c: CancellationException) {
            // Normal: the next keystroke cancelled this one. Re-thrown, or the
            // debounce stops working.
            throw c
        } catch (_: Throwable) {
            emptyList()
        }
        searching = false
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            // Background first, insets second: the colour fills the whole window
            // so the system bars sit on it rather than on bare canvas, while the
            // field and the results are pushed clear of them.
            .background(MaterialTheme.colorScheme.background)
            .safeChrome(),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = dimens.screenPadding)
                .padding(top = dimens.screenPadding * 0.6f),
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = {
                    Text(
                        stringResource(R.string.search_hint),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.displayMedium,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                shape = RoundedCornerShape(dimens.cardRadius),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
            )

            Spacer(Modifier.height(dimens.sectionGap))

            when {
                query.isBlank() -> Text(
                    stringResource(R.string.search_prompt),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                results.isEmpty() && !searching -> Text(
                    stringResource(R.string.search_no_results, query),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(results, key = { it.partyId }) { party ->
                        SearchResultRow(party = party, onClick = { onSelect(party) })
                    }
                }
            }
        }

        BackToScannerBar(onClick = onClose)
    }
}

/**
 * One match, as a control.
 *
 * ── Why it looks like a button now ──
 *
 * These rows were a tinted panel with text in it and nothing else — no edge, no
 * shadow, no chevron, no press response. An usher who had found the right guest
 * then had to guess that the guest's own name was the thing to tap, which is the
 * one moment in the whole flow where hesitating is most expensive: the guest is
 * standing there, the queue is behind them, and the row looks like a search
 * result, because that is exactly what a search result looks like everywhere else.
 *
 * It is now the same object as every other control in the app — raised, rimmed,
 * chevroned, and it moves when pressed.
 */
@Composable
private fun SearchResultRow(
    party: CheckInRepository.PartyView,
    onClick: () -> Unit,
) {
    val dimens = LocalDimens.current
    val fullyArrived = party.unarrived.isEmpty()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            // Was 84dp. A row holding a name, a companion list, a table and a
            // badge at arm's length needs the room, and the taller target is
            // easier to hit while looking at the guest rather than the screen.
            .heightIn(min = 96.dp)
            .pressableSurface(
                onClick = onClick,
                shape = RoundedCornerShape(dimens.cardRadius),
            )
            .padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    party.label,
                    style = MaterialTheme.typography.headlineMedium.copy(
                        fontFamily = displayFamilyFor(party.label),
                    ),
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (party.hasVip) {
                    Spacer(Modifier.width(10.dp))
                    Text(
                        stringResource(R.string.result_welcome_vip),
                        style = MaterialTheme.typography.labelMedium,
                        color = StateVip,
                        maxLines = 1,
                    )
                }
            }
            // Party members listed, because the match may well have been on a
            // companion's name rather than the label shown above it.
            Text(
                text = party.members.joinToString(", ") { it.fullName },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Spacer(Modifier.width(20.dp))

        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = party.tableName ?: stringResource(R.string.result_no_table),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (fullyArrived) {
                Text(
                    stringResource(R.string.search_arrived_badge),
                    style = MaterialTheme.typography.labelMedium,
                    color = StateAlready,
                    maxLines = 1,
                )
            } else if (party.arrived.isNotEmpty()) {
                // Partial arrival: the count is what tells an usher whether the
                // people in front of them are the ones still expected (§9.1).
                Text(
                    "${party.arrived.size}/${party.members.size}",
                    style = MaterialTheme.typography.labelMedium,
                    color = StateAlready,
                    maxLines = 1,
                )
            }
        }

        // The mark that says "tapping this goes somewhere". Same chevron, same
        // direction, as every other forward move in the app — and the transition
        // that follows confirms it.
        Spacer(Modifier.width(16.dp))
        Chevron(color = MaterialTheme.colorScheme.primary, pointsBack = false, iconSize = 26.dp)
    }
}
