package com.fancyrsvp.checkin.ui.close

import androidx.lifecycle.ViewModel
import com.fancyrsvp.checkin.data.local.CheckinDatabase
import com.fancyrsvp.checkin.data.repo.DeviceRepository
import com.fancyrsvp.checkin.sync.SyncCoordinator
import com.fancyrsvp.checkin.util.readable
import com.fancyrsvp.checkin.util.safeLaunch
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * Closing an event and purging its data (spec §20.5, §21.3).
 *
 * ── The single most important control in §20, and the most likely to be omitted ──
 *
 * "Sync queue not empty at close: BLOCK the purge. Warn explicitly that unsynced
 * check-ins would be permanently lost. Never destroy unsynced data."
 *
 * That is not a confirmation dialog with a scary colour. It is a hard block. Those
 * check-ins exist on this tablet and nowhere else in the world; deleting them
 * silently rewrites a night's attendance. So this class cannot purge while the queue
 * is non-empty — not "warns and proceeds", cannot.
 *
 * The counterpart risk is the opposite one: cached guest data left on a hired tablet
 * indefinitely (§20.1). So once the queue IS empty, purging is offered plainly and
 * the 7-day automatic purge (decision D-12) runs regardless of whether anyone
 * remembers.
 */
@HiltViewModel
class CloseEventViewModel @Inject constructor(
    private val db: CheckinDatabase,
    private val deviceRepository: DeviceRepository,
    private val syncCoordinator: SyncCoordinator,
    private val io: CoroutineDispatcher,
) : ViewModel() {

    sealed interface State {
        data object Loading : State

        /** Ready to purge: nothing outstanding. */
        data class Ready(val arrived: Int, val guests: Int) : State

        /**
         * BLOCKED. Purging is impossible, not merely discouraged.
         *
         * `stalled` is called out separately because a stalled entry will not clear
         * by waiting — the server refused it repeatedly, and someone has to
         * intervene. Telling a supervisor to "wait for sync" when nothing will ever
         * send is how a tablet ends up wiped in frustration.
         */
        data class Blocked(val pending: Int, val stalled: Int) : State

        data object Purging : State
        data class Purged(val removedGuests: Int) : State
        data class Failed(val reason: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    private var eventId: String? = null

    fun start(eventId: String) {
        this.eventId = eventId
        refresh()
    }

    fun refresh() {
        val id = eventId ?: return
        // A failure to COUNT the queue must never read as "nothing pending".
        // Blocked with an unknown count is the safe direction: this screen guards
        // a purge that destroys check-ins existing nowhere else (§20.5).
        safeLaunch(onError = { _state.value = State.Blocked(pending = -1, stalled = 0) }) {
            _state.value = withContext(io) {
                /*
                 * Counted as EVIDENCE, not as rows. This was `depthForEvent` —
                 * every entry in the queue — so one reversal the server had
                 * permanently refused blocked the event from ever being closed,
                 * and with it the only route back to the Prepare screen. See
                 * SyncQueueDao.unsentEvidenceForEvent.
                 */
                val pending = db.syncQueueDao().unsentEvidenceForEvent(id)
                // Stalled entries are counted separately so the message can
                // distinguish "wait for signal" from "this will never send".
                val stalled = db.syncQueueDao().stalledCountForEvent(id)

                if (pending > 0) {
                    State.Blocked(pending, stalled)
                } else {
                    State.Ready(
                        arrived = db.checkInDao().countArrived(id),
                        guests = db.guestDao().countForEvent(id),
                    )
                }
            }
        }
    }

    /** Asks the sync engine to try again — the remedy for a Blocked state. */
    fun retrySync() {
        val id = eventId ?: return
        syncCoordinator.requestDrain(id)
    }

    /**
     * Purges local guest data.
     *
     * Re-checks the queue inside the repository rather than trusting the state this
     * ViewModel last observed: between rendering and tapping, a scan could have added
     * an entry. The guard has to be at the point of destruction, not at the point of
     * display.
     */
    fun purge() {
        val id = eventId ?: return
        val current = _state.value
        if (current !is State.Ready) return

        _state.value = State.Purging
        // Never leave this stuck on Purging: the operator cannot tell whether
        // their data was destroyed, and the screen offers no way out.
        safeLaunch(onError = { t -> _state.value = State.Failed(t.readable()) }) {
            val purged = withContext(io) { deviceRepository.purgeEventData(id) }
            _state.value = if (purged) {
                State.Purged(current.guests)
            } else {
                // The repository refused, meaning something arrived in the queue
                // after this screen was drawn. Correct outcome; re-read and show why.
                refresh()
                State.Failed(BLOCKED_LATE)
            }
        }
    }

    private companion object {
        const val BLOCKED_LATE =
            "Something was queued while this screen was open. Nothing was deleted."
    }
}
