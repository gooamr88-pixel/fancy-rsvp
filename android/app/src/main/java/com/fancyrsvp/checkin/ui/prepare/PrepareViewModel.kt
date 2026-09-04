package com.fancyrsvp.checkin.ui.prepare

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fancyrsvp.checkin.data.local.EventEntity
import com.fancyrsvp.checkin.data.repo.BundleRepository
import com.fancyrsvp.checkin.data.repo.DeviceRepository
import com.fancyrsvp.checkin.data.repo.UpdateRepository
import com.fancyrsvp.checkin.device.DeviceStatusMonitor
import com.fancyrsvp.checkin.ui.session.SessionManager
import com.fancyrsvp.checkin.util.safeLaunch
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Event selection and preparation (spec §8.2).
 *
 * The screen must state explicitly that internet is required NOW and will not be
 * required at the venue, and it must show real progress with counts rather than an
 * indeterminate spinner — an operator needs to know whether a 2000-guest download
 * is moving or stalled before they leave for the venue.
 */
@HiltViewModel
class PrepareViewModel @Inject constructor(
    private val bundleRepository: BundleRepository,
    private val deviceStatusMonitor: DeviceStatusMonitor,
    private val deviceRepository: DeviceRepository,
    private val sessionManager: SessionManager,
    private val updateRepository: UpdateRepository,
) : ViewModel() {

    /** Readiness, as §8.2 requires it to be presented. */
    enum class Readiness { READY_OFFLINE, NEEDS_SYNC, NOT_PREPARED }

    data class EventRow(
        val id: String,
        val name: String,
        val venue: String?,
        val startsAt: Long,
        /** The event's IANA zone, or null to fall back to the device clock. */
        val timezone: String?,
        val totalInvited: Int,
        val readiness: Readiness,
        val lastSyncedAt: Long?,
        /**
         * Local path to the event's photograph, or null until it is downloaded.
         *
         * On this screen the picture is doing a job rather than decorating: a
         * device is paired to exactly one event, and the way an operator confirms
         * they armed the RIGHT tablet is by recognising it. A name and a date are
         * checked by reading; a face is checked at a glance.
         */
        val coverImagePath: String?,
    )

    /**
     * The `catch` is not optional. This is a Room Flow over the encrypted
     * database, and an exception in a flow collected with `stateIn(viewModelScope)`
     * propagates to the scope and terminates the process. This screen is reached
     * immediately after pairing and the query runs on arrival with no user action,
     * so a database that will not open would take the app down the instant it
     * navigated here.
     *
     * Degrading to an empty list is right: the screen already renders "not
     * prepared" for an event it cannot read, which is honest and recoverable.
     */
    val events: StateFlow<List<EventRow>> = bundleRepository.observeEvents()
        .map { list -> list.map { it.toRow() } }
        .catch { emit(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _progress = MutableStateFlow<BundleRepository.Progress?>(null)
    val progress: StateFlow<BundleRepository.Progress?> = _progress.asStateFlow()

    private val _preparingEventId = MutableStateFlow<String?>(null)
    val preparingEventId: StateFlow<String?> = _preparingEventId.asStateFlow()

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    /** Null when the last refresh succeeded; a message to show when it did not. */
    private val _listError = MutableStateFlow<String?>(null)
    val listError: StateFlow<String?> = _listError.asStateFlow()

    init {
        // The list is fetched on arrival. The screen renders from the local table,
        // so without this a freshly paired tablet shows the instructions and no
        // events beneath them, with nothing to indicate why.
        refresh()
    }

    fun refresh() {
        if (_refreshing.value) return
        _refreshing.value = true

        safeLaunch {
            try {
                _listError.value = when (val result = bundleRepository.refreshEvents()) {
                    is BundleRepository.EventsRefresh.Ok -> null
                    BundleRepository.EventsRefresh.NotPaired -> NOT_PAIRED_MESSAGE
                    BundleRepository.EventsRefresh.Offline -> OFFLINE_MESSAGE
                    is BundleRepository.EventsRefresh.Failed -> result.message
                }
            } catch (t: Throwable) {
                // Bare launch: anything escaping here would terminate the process.
                _listError.value = "${t.javaClass.simpleName}: ${t.message ?: "no message"}"
            } finally {
                _refreshing.value = false
            }
        }
    }

    fun prepare(eventId: String, forceRestart: Boolean = false) {
        if (_preparingEventId.value != null) return // one at a time

        val expectedGuests = events.value.firstOrNull { it.id == eventId }?.totalInvited ?: 0

        // Storage is checked BEFORE the download, not during it (§21.9). "Failing
        // loudly at 14:00 in an office is recoverable; failing at 20:00 at a venue is
        // not." A part-written bundle that ran out of space is exactly the silent
        // failure §21.1 exists to prevent.
        if (expectedGuests > 0 && !deviceStatusMonitor.hasRoomForBundle(expectedGuests)) {
            _progress.value = BundleRepository.Progress.Failed(
                BundleRepository.Failure.NoStorage(expectedGuests),
            )
            return
        }

        _preparingEventId.value = eventId
        _progress.value = BundleRepository.Progress.FetchingManifest

        safeLaunch {
            try {
                bundleRepository.prepareEvent(eventId, forceRestart) { p -> _progress.value = p }

                /*
                 * The server has just refused this build as too old to arm a
                 * tablet, so a previous "Later" on the update offer is no longer
                 * a workable answer — there is nothing this device can do until
                 * it updates. Forgetting the dismissal brings the offer straight
                 * back, which is the remedy the app is already holding.
                 */
                val outcome = _progress.value
                if (outcome is BundleRepository.Progress.Failed &&
                    outcome.reason is BundleRepository.Failure.AppTooOld
                ) {
                    updateRepository.clearDismissal()
                }
            } catch (t: Throwable) {
                // try/finally alone let the exception escape into viewModelScope,
                // which terminates the process — the cleanup ran and the app still
                // died. A failed download must report itself and leave the operator
                // able to retry, because this is the step they do BEFORE travelling
                // to the venue and it is the last chance to fix anything (§8.2).
                _progress.value = BundleRepository.Progress.Failed(
                    BundleRepository.Failure.Unknown(
                        "${t.javaClass.simpleName}: ${t.message ?: "no message"}",
                    ),
                )
            } finally {
                _preparingEventId.value = null
            }
        }
    }

    fun dismissProgress() {
        // Only clears a terminal state. Dismissing mid-download would leave the
        // operator with no indication that a transfer is still running.
        val current = _progress.value
        if (current is BundleRepository.Progress.Done || current is BundleRepository.Progress.Failed) {
            _progress.value = null
        }
    }

    // ── Releasing the tablet ──

    /** How many check-ins are still unsent, or null while nothing is blocked. */
    private val _unpairBlockedBy = MutableStateFlow<Int?>(null)
    val unpairBlockedBy: StateFlow<Int?> = _unpairBlockedBy.asStateFlow()

    private val _unpairing = MutableStateFlow(false)
    val unpairing: StateFlow<Boolean> = _unpairing.asStateFlow()

    /**
     * Releases this tablet so it can be paired to another account.
     *
     * [onReleased] runs only on success, because the caller's job is to navigate
     * back to the start of setup and a blocked attempt must leave the operator
     * exactly where they are, reading why.
     */
    fun unpair(onReleased: () -> Unit) {
        if (_unpairing.value) return
        _unpairing.value = true
        _unpairBlockedBy.value = null

        safeLaunch(
            onError = {
                _unpairing.value = false
                // Treated as blocked rather than as a silent failure: the tablet
                // is still paired either way, and the operator must not be left
                // believing it was released.
                _unpairBlockedBy.value = 0
            },
        ) {
            when (val result = deviceRepository.unpair()) {
                is DeviceRepository.UnpairResult.Success -> {
                    _unpairing.value = false
                    /*
                     * A signed-in operator can be standing here: closing an
                     * event routes to this screen without ending their session.
                     * Left alone, that session outlives the pairing — and five
                     * minutes backgrounded would raise the PIN lock over the
                     * WELCOME screen of a tablet that now belongs to nobody,
                     * demanding a PIN from a roster that has just been deleted.
                     */
                    sessionManager.signOut()
                    onReleased()
                }
                is DeviceRepository.UnpairResult.Blocked -> {
                    _unpairing.value = false
                    _unpairBlockedBy.value = result.pending
                }
            }
        }
    }

    fun clearUnpairBlock() {
        _unpairBlockedBy.value = null
    }

    private companion object {
        const val OFFLINE_MESSAGE =
            "No connection. Preparation needs internet — connect and tap Refresh."

        // Should be unreachable: this screen is only entered after pairing. It
        // exists because "no events" with no explanation is what sent us hunting
        // through the app once already.
        const val NOT_PAIRED_MESSAGE =
            "This tablet is not paired to an event. Pair it again from the dashboard."
    }

    private fun EventEntity.toRow(): EventRow {
        val staleAfterMs = 2 * 60 * 60 * 1000L
        val readiness = when {
            !isReadyOffline -> Readiness.NOT_PREPARED
            lastFullSyncAt == null -> Readiness.NEEDS_SYNC
            System.currentTimeMillis() - lastFullSyncAt > staleAfterMs -> Readiness.NEEDS_SYNC
            else -> Readiness.READY_OFFLINE
        }
        return EventRow(
            id = id,
            name = name,
            venue = venue,
            startsAt = startsAt,
            timezone = timezone,
            totalInvited = totalInvited,
            readiness = readiness,
            lastSyncedAt = lastFullSyncAt,
            coverImagePath = coverImagePath,
        )
    }
}
