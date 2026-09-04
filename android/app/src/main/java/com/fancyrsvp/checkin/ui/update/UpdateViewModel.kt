package com.fancyrsvp.checkin.ui.update

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fancyrsvp.checkin.BuildConfig
import com.fancyrsvp.checkin.data.remote.UpdateManifestDto
import com.fancyrsvp.checkin.data.repo.UpdateGate
import com.fancyrsvp.checkin.data.repo.UpdateRepository
import com.fancyrsvp.checkin.util.safeLaunch
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import javax.inject.Inject

/**
 * The update offer, and the download behind it.
 *
 * Held at the activity level so a check survives the operator moving between the
 * welcome and preparation screens — re-fetching the manifest on every navigation
 * would be a request per tap for an answer that changes once a release.
 */
@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val repository: UpdateRepository,
) : ViewModel() {

    /** What the operator is being shown, if anything. */
    sealed interface State {
        /** Nothing to say. The overlay is not drawn at all. */
        data object Idle : State

        data class Available(val manifest: UpdateManifestDto) : State

        data class Downloading(val manifest: UpdateManifestDto, val percent: Int?) : State

        data object Verifying : State

        /** Downloaded and checksum-verified. Waiting on the system installer. */
        data class Ready(val manifest: UpdateManifestDto, val file: File) : State

        /**
         * The operator has to grant "install unknown apps" first. Held as its own
         * state rather than a toast: they are about to leave the app for a
         * settings screen, and coming back to a blank scanner with no idea what
         * happened is how this feature would get abandoned.
         */
        data class NeedsPermission(val manifest: UpdateManifestDto, val file: File) : State

        data class Failed(val reason: UpdateRepository.Reason) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    /** The running transfer, so [cancelDownload] has something to cancel. */
    private var downloadJob: Job? = null

    /** The version this build is, for the "1.6.1 → 1.7.0" line. */
    val installedVersionName: String = BuildConfig.VERSION_NAME

    /**
     * Set only once the manifest has actually been READ, not once a check has
     * been attempted.
     *
     * The difference matters on the tablet this feature exists for. A device
     * that opens with no signal — the normal case when somebody powers one on
     * before joining the office wifi — would latch a failed attempt and never
     * look again for the life of the process. It would then sit on the
     * preparation screen, online, for an hour, and still never learn there is a
     * newer build. Latching the SUCCESS lets a failed attempt be retried the
     * next time the operator lands on an allowed screen, while still costing at
     * most one request once the answer is known.
     */
    private var answered = false

    /** Guards against a second in-flight check while one is still running. */
    private var checking = false

    /**
     * Looks for a newer build.
     *
     * Called from a composable that recomposes on navigation, so it must be
     * cheap to call repeatedly — hence both guards above.
     *
     * `safeLaunch` because a failure here must never reach viewModelScope and
     * take the process down. The app has to keep working offline, and an update
     * check is the least important thing it does.
     */
    fun checkOnce() {
        if (answered || checking) return
        checking = true
        safeLaunch(onError = { checking = false }) {
            try {
                val manifest = repository.fetchManifest()
                if (manifest != null) answered = true
                when {
                    manifest == null -> Unit

                    repository.evaluate(manifest) == UpdateGate.Verdict.OFFER ->
                        _state.value = State.Available(manifest)

                    /*
                     * Nothing newer published means this build IS the published
                     * one — so an install that ran earlier succeeded, and the
                     * ~46 MB APK it came from is dead weight. Nothing else can
                     * clean it up: the process is killed during the install, so
                     * no code of ours runs on the far side of it.
                     */
                    manifest.versionCode <= BuildConfig.VERSION_CODE.toLong() ->
                        repository.purgeDownloads()

                    else -> Unit
                }
            } finally {
                checking = false
            }
        }
    }

    /** "Later" — this build stops asking, a newer one still will. */
    fun dismiss() {
        val current = _state.value
        val code = when (current) {
            is State.Available -> current.manifest.versionCode
            is State.Downloading -> current.manifest.versionCode
            is State.Ready -> current.manifest.versionCode
            is State.NeedsPermission -> current.manifest.versionCode
            else -> null
        }
        code?.let(repository::dismiss)
        _state.value = State.Idle
    }

    /**
     * "Stop" during a transfer — NOT the same act as "Later".
     *
     * ── The bug this replaces ──
     *
     * The Stop button was wired to [dismiss], and that was wrong three times
     * over. It recorded a dismissal, so a build the operator still wanted went
     * quiet until the next release. It did not cancel the coroutine, so a 46 MB
     * transfer carried on over the venue's wifi after they had asked it to stop.
     * And when that transfer finished it wrote `Ready` over the Idle state,
     * resurrecting the overlay with an install prompt for something they had
     * just cancelled.
     *
     * Stopping a download means "not this transfer", so it returns to the offer
     * with nothing remembered. Cancelling the job also means the terminal state
     * assignment never runs: it sits after a suspension point, and a cancelled
     * coroutine does not resume past one.
     */
    fun cancelDownload() {
        val manifest = when (val current = _state.value) {
            is State.Downloading -> current.manifest
            else -> null
        }
        downloadJob?.cancel()
        downloadJob = null
        _state.value = manifest?.let(State::Available) ?: State.Idle
    }

    /** Failure is dismissible without being remembered — tomorrow may work. */
    fun clearFailure() {
        if (_state.value is State.Failed) _state.value = State.Idle
    }

    fun download() {
        val manifest = (_state.value as? State.Available)?.manifest ?: return
        _state.value = State.Downloading(manifest, null)

        // Held so Stop can actually stop it. Without the handle the only thing
        // the button could do was hide the screen while the transfer ran on.
        downloadJob = safeLaunch(
            onError = { _state.value = State.Failed(UpdateRepository.Reason.OFFLINE) },
        ) {
            val result = repository.download(manifest) { progress ->
                // Progress arrives off the main thread; StateFlow is safe to
                // write from anywhere and Compose reads it on the main thread.
                when (progress) {
                    is UpdateRepository.Progress.Downloading ->
                        _state.value = State.Downloading(manifest, progress.percent)

                    is UpdateRepository.Progress.Verifying -> _state.value = State.Verifying
                    else -> Unit
                }
            }

            _state.value = when (result) {
                is UpdateRepository.Progress.Ready ->
                    if (repository.canInstall()) State.Ready(manifest, result.file)
                    else State.NeedsPermission(manifest, result.file)

                is UpdateRepository.Progress.Failed -> State.Failed(result.reason)
                else -> State.Idle
            }
        }
    }

    /**
     * Called when the operator returns from the settings screen.
     *
     * Re-asks rather than assuming they granted it: they may have backed out,
     * and showing the install prompt for a permission that is still missing
     * produces a silent no-op.
     */
    fun recheckPermission() {
        val current = _state.value as? State.NeedsPermission ?: return
        if (repository.canInstall()) _state.value = State.Ready(current.manifest, current.file)
    }

    fun permissionIntent() = repository.installPermissionIntent()

    fun installIntent(file: File) = repository.installIntent(file)
}
