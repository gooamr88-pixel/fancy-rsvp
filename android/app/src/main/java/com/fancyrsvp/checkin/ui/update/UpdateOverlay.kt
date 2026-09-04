package com.fancyrsvp.checkin.ui.update

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.R
import com.fancyrsvp.checkin.data.remote.UpdateManifestDto
import com.fancyrsvp.checkin.data.repo.UpdateRepository
import com.fancyrsvp.checkin.ui.components.PrimaryAction
import com.fancyrsvp.checkin.ui.components.ScrollableCenteredColumn
import com.fancyrsvp.checkin.ui.components.SecondaryAction
import com.fancyrsvp.checkin.ui.theme.LocalDimens
import com.fancyrsvp.checkin.ui.theme.safeChrome
import java.io.File

/**
 * "A newer version is ready" — the whole reason nobody has to uninstall and
 * reinstall this app by hand any more.
 *
 * Built the way SessionLockOverlay is, and layered the same way: an opaque,
 * full-size Box drawn as a sibling of the nav host. Full size plus opacity IS
 * the mechanism that stops touches reaching the screen behind — there is no
 * scrim and nothing intercepts input explicitly.
 *
 * It only ever appears on the welcome and preparation screens (see MainActivity)
 * and never while the outbound queue holds anything. An operator meets it in an
 * office, before leaving for a venue — never at a door with people waiting.
 */
@Composable
fun UpdateOverlay(
    state: UpdateViewModel.State,
    installedVersionName: String,
    onUpdate: () -> Unit,
    onLater: () -> Unit,
    /**
     * Stopping a TRANSFER, which is not the same act as "Later".
     *
     * Separate callback because the two must not share one: Stop returns to the
     * offer and remembers nothing, while Later silences this build. Wiring Stop
     * to Later left a cancelled download running, silenced a build the operator
     * still wanted, and then reopened the overlay with an install prompt when
     * the transfer they cancelled finished anyway.
     */
    onStop: () -> Unit,
    onGrantPermission: () -> Unit,
    onInstall: (File) -> Unit,
    onDismissFailure: () -> Unit,
) {
    val dimens = LocalDimens.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeChrome(),
        contentAlignment = Alignment.Center,
    ) {
        ScrollableCenteredColumn(horizontalAlignment = Alignment.CenterHorizontally) {
            when (state) {
                is UpdateViewModel.State.Available -> Offer(
                    manifest = state.manifest,
                    installedVersionName = installedVersionName,
                    onUpdate = onUpdate,
                    onLater = onLater,
                )

                is UpdateViewModel.State.Downloading -> Working(
                    headline = stringResource(R.string.update_downloading),
                    percent = state.percent,
                    onStop = onStop,
                )

                UpdateViewModel.State.Verifying -> Working(
                    // Named, not folded into "downloading". The checksum is what
                    // makes installing this file safe, and a device that pauses
                    // for a few seconds on a 46 MB file should say why.
                    headline = stringResource(R.string.update_verifying),
                    percent = null,
                    // No Stop: the bytes are already on disk and hashing them
                    // takes a moment. A button that saves nothing and can leave
                    // a half-checked file behind is worse than no button.
                    onStop = null,
                )

                is UpdateViewModel.State.Ready -> {
                    Headline(stringResource(R.string.update_ready_title))
                    Body(stringResource(R.string.update_ready_body))
                    Spacer(Modifier.height(dimens.sectionGap))
                    PrimaryAction(
                        text = stringResource(R.string.update_install),
                        onClick = { onInstall(state.file) },
                        hero = true,
                    )
                    Spacer(Modifier.height(12.dp))
                    SecondaryAction(text = stringResource(R.string.update_later), onClick = onLater)
                }

                is UpdateViewModel.State.NeedsPermission -> {
                    Headline(stringResource(R.string.update_permission_title))
                    // Says WHY before sending them out of the app. A settings
                    // screen reached with no explanation is where this feature
                    // would quietly die.
                    Body(stringResource(R.string.update_permission_body))
                    Spacer(Modifier.height(dimens.sectionGap))
                    PrimaryAction(
                        text = stringResource(R.string.update_permission_open),
                        onClick = onGrantPermission,
                        hero = true,
                    )
                    Spacer(Modifier.height(12.dp))
                    SecondaryAction(text = stringResource(R.string.update_later), onClick = onLater)
                }

                is UpdateViewModel.State.Failed -> {
                    Headline(stringResource(R.string.update_failed_title))
                    Body(
                        when (state.reason) {
                            UpdateRepository.Reason.NO_SPACE -> stringResource(R.string.update_failed_space)
                            UpdateRepository.Reason.CORRUPT -> stringResource(R.string.update_failed_corrupt)
                            UpdateRepository.Reason.OFFLINE -> stringResource(R.string.update_failed_offline)
                            UpdateRepository.Reason.SERVER -> stringResource(R.string.update_failed_server)
                        },
                    )
                    Spacer(Modifier.height(dimens.sectionGap))
                    // Not remembered as a dismissal: the build is still wanted,
                    // this attempt simply failed, and tomorrow may work.
                    PrimaryAction(
                        text = stringResource(R.string.update_failed_continue),
                        onClick = onDismissFailure,
                        hero = true,
                    )
                }

                UpdateViewModel.State.Idle -> Unit
            }
        }
    }
}

@Composable
private fun Offer(
    manifest: UpdateManifestDto,
    installedVersionName: String,
    onUpdate: () -> Unit,
    onLater: () -> Unit,
) {
    val dimens = LocalDimens.current

    Headline(stringResource(R.string.update_title))
    Body(
        stringResource(
            R.string.update_versions,
            installedVersionName,
            manifest.versionName,
            megabytes(manifest.sizeBytes),
        ),
    )

    // Only when the release actually said something. An empty "What's new"
    // heading over nothing is worse than no heading.
    if (manifest.notes.isNotBlank()) {
        Spacer(Modifier.height(dimens.sectionGap))
        Text(
            text = stringResource(R.string.update_whats_new),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(6.dp))
        Body(manifest.notes)
    }

    Spacer(Modifier.height(dimens.sectionGap))
    Body(stringResource(R.string.update_keeps_data))

    Spacer(Modifier.height(dimens.sectionGap))
    PrimaryAction(text = stringResource(R.string.update_now), onClick = onUpdate, hero = true)
    Spacer(Modifier.height(12.dp))
    SecondaryAction(text = stringResource(R.string.update_later), onClick = onLater)
}

@Composable
private fun Working(headline: String, percent: Int?, onStop: (() -> Unit)?) {
    val dimens = LocalDimens.current

    Headline(headline)
    Spacer(Modifier.height(dimens.sectionGap))

    /*
     * A determinate bar whenever the server declared a length, because a 46 MB
     * transfer on venue-office wifi is long enough that an indeterminate spinner
     * reads as a hang. `percent` is null only when Content-Length was absent.
     */
    if (percent != null) {
        LinearProgressIndicator(
            progress = { percent / 100f },
            modifier = Modifier.fillMaxWidth().widthIn(max = 420.dp),
        )
        Spacer(Modifier.height(10.dp))
        Body(stringResource(R.string.update_percent, percent))
    } else {
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth().widthIn(max = 420.dp))
    }

    if (onStop != null) {
        Spacer(Modifier.height(dimens.sectionGap))
        SecondaryAction(text = stringResource(R.string.update_cancel), onClick = onStop)
    }
}

@Composable
private fun Headline(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.displayMedium,
        color = MaterialTheme.colorScheme.onBackground,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun Body(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.widthIn(max = 420.dp),
    )
}

/**
 * One decimal place. "46.1 MB" is a size; "46083910 bytes" is a number.
 *
 * Locale.US explicitly, not the device default. The staff UI ships in English
 * only, and on a tablet set to Arabic the default locale renders this as ٤٦٫١ —
 * Arabic-Indic digits and a decimal comma, dropped into an otherwise English
 * sentence. (It is also an Android lint error: DefaultLocale.)
 */
private fun megabytes(bytes: Long): String =
    if (bytes <= 0) "" else String.format(java.util.Locale.US, "%.1f", bytes / 1024.0 / 1024.0)
