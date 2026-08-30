package com.fancyrsvp.checkin.ui.guests

import androidx.lifecycle.ViewModel
import com.fancyrsvp.checkin.data.local.CheckinDatabase
import com.fancyrsvp.checkin.data.repo.CheckInRepository
import com.fancyrsvp.checkin.util.safeLaunch
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * The browsable guest list (spec §8.7).
 *
 * "Serves the common request 'has the bride's aunt arrived yet?'" — which is why
 * the filters are exactly the ones the spec names, and why searching and filtering
 * compose rather than replacing each other.
 *
 * Also hosts the supervisor undo (§9.6): a guest checked in by mistake is corrected
 * from the list where the mistake is visible, not from a buried settings screen.
 */
@HiltViewModel
class GuestListViewModel @Inject constructor(
    private val db: CheckinDatabase,
    private val checkInRepository: CheckInRepository,
    private val sessionManager: com.fancyrsvp.checkin.ui.session.SessionManager,
    private val io: CoroutineDispatcher,
) : ViewModel() {

    /** The filters §8.7 names: all, arrived, not arrived, VIP, by table. */
    enum class Filter { ALL, ARRIVED, NOT_ARRIVED, VIP }

    data class Row(
        val guestId: String,
        val fullName: String,
        val partyLabel: String?,
        val tableName: String?,
        val category: String,
        val arrived: Boolean,
        val arrivedAt: Long?,
        val arrivedByStaff: String?,
        /** Present only when arrived — the key the undo needs. */
        val clientCheckinId: String?,
        /**
         * Whether THIS DEVICE can reverse this arrival.
         *
         * ── What has to be true for the server to find the row ──
         *
         * The undo names ONE check-in, and the server resolves it two ways:
         *
         *   • `client_checkin_id` — works only for a check-in this device
         *     created. Anything else it holds was reconstructed locally under an
         *     invented key (`seed:<eventId>:<guestId>` when the arrival was
         *     already recorded at preparation, `remote:<serverId>` when it came
         *     from another gate) and the server has never held that value. It is
         *     not even a uuid.
         *   • `serverId` — the row's own primary key, carried on both of those,
         *     and preferred by the server when present (`checkin_undo_by_ref`).
         *
         * So an arrival is reversible from here if EITHER applies. In practice
         * that is now everything, which is the point: at a two-gate event most of
         * the list was admitted somewhere else.
         *
         * The one case that stays false is a tablet prepared by a server too old
         * to send the server id. That is honest rather than unfortunate — the
         * undo genuinely cannot be applied, and the control is hidden with the
         * screen saying where it CAN be done. It used to be offered anyway: the
         * local row was marked reversed and the supervisor was shown success
         * while the request could never land, so the guest stayed counted as
         * arrived on the dashboard, permanently, with nothing admitting it.
         */
        val reversibleHere: Boolean,
    ) {
        val isVip: Boolean get() = category.equals("vip", ignoreCase = true)
    }

    private val _rows = MutableStateFlow<List<Row>>(emptyList())
    val rows: StateFlow<List<Row>> = _rows.asStateFlow()

    private val _filter = MutableStateFlow(Filter.ALL)
    val filter: StateFlow<Filter> = _filter.asStateFlow()

    private val _tableFilter = MutableStateFlow<String?>(null)
    val tableFilter: StateFlow<String?> = _tableFilter.asStateFlow()

    private val _tables = MutableStateFlow<List<String>>(emptyList())
    val tables: StateFlow<List<String>> = _tables.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private var eventId: String? = null

    fun start(eventId: String) {
        this.eventId = eventId
        safeLaunch {
            _tables.value = withContext(io) { db.guestDao().distinctTables(eventId) }
            reload()
        }
    }

    fun setFilter(filter: Filter) {
        _filter.value = filter
        safeLaunch { reload() }
    }

    fun setTableFilter(tableName: String?) {
        _tableFilter.value = tableName
        safeLaunch { reload() }
    }

    private suspend fun reload() {
        val id = eventId ?: return
        _loading.value = true

        _rows.value = withContext(io) {
            val guests = db.guestDao().filteredGuests(
                eventId = id,
                category = if (_filter.value == Filter.VIP) VIP else null,
                tableName = _tableFilter.value,
                arrivedFilter = when (_filter.value) {
                    Filter.ARRIVED -> 1
                    Filter.NOT_ARRIVED -> 0
                    else -> null
                },
                limit = PAGE_LIMIT,
                offset = 0,
            )

            guests.map { guest ->
                val party = db.partyDao().byId(guest.partyId)
                val record = db.checkInDao().liveRecordFor(id, guest.id)
                Row(
                    guestId = guest.id,
                    fullName = guest.fullName,
                    partyLabel = party?.label,
                    tableName = party?.tableName,
                    category = guest.category,
                    arrived = record != null,
                    arrivedAt = record?.checkedInAt,
                    arrivedByStaff = record?.staffDisplayName,
                    clientCheckinId = record?.clientCheckinId,
                    // Either reference will do: a check-in this device created
                    // (resolvable by its client id) or any arrival that arrived
                    // with a server id. See Row.reversibleHere.
                    reversibleHere = record != null && (!record.isRemote || record.serverId != null),
                )
            }
        }

        _loading.value = false
    }

    /**
     * Supervisor undo (§9.6).
     *
     * A reason is mandatory — the server rejects an undo without one, and the whole
     * point is that a reversal remains explicable months later when someone
     * questions the attendance figure.
     *
     * Returns false rather than throwing so the caller can keep the dialog open with
     * the text intact instead of losing what the supervisor typed.
     */
    suspend fun undo(clientCheckinId: String, reason: String): Boolean {
        val id = eventId ?: return false
        if (reason.isBlank()) return false

        // The signed-in operator, captured now and queued with the undo. The
        // server checks this against the event roster and refuses the reversal if
        // it does not belong to an active supervisor — the `canUndo` gate on the
        // row is only what keeps the button out of an usher's way (§18.2).
        val ok = checkInRepository.undo(
            id, clientCheckinId, reason.trim(),
            staffId = sessionManager.session.value?.staffId,
        )
        if (ok) reload()
        return ok
    }

    private companion object {
        const val VIP = "vip"

        /**
         * One page. §11 requires search under 300ms on a 2000-guest event; rendering
         * 2000 rows would blow that regardless of how fast the query is, and a
         * supervisor scanning for one name never scrolls past a few hundred.
         */
        const val PAGE_LIMIT = 500
    }
}
