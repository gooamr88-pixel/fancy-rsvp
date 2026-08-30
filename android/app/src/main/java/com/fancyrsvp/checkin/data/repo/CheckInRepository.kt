package com.fancyrsvp.checkin.data.repo

import androidx.room.withTransaction
import com.fancyrsvp.checkin.data.local.CheckInEntity
import com.fancyrsvp.checkin.data.local.CheckinDatabase
import com.fancyrsvp.checkin.data.local.GuestEntity
import com.fancyrsvp.checkin.data.local.PartyEntity
import com.fancyrsvp.checkin.data.local.SyncQueueEntity
import com.fancyrsvp.checkin.scan.TicketResolver
import com.fancyrsvp.checkin.util.NameNormalizer
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The scan path and Layer 1 duplicate prevention (spec §5.3, §8.4, §9.1).
 *
 * ── Everything here is local ──
 *
 * A check-in is written to the encrypted database and appended to the outbound
 * queue. Nothing waits on the network. Any code path where a user action blocks on
 * connectivity is a defect (§5.1), so this class never calls the API — the sync
 * engine drains the queue separately.
 *
 * ── The rule that decides the product ──
 *
 * §5.3: "the door is never blocked by uncertainty." If this device cannot confirm
 * state with the server, the guest is ADMITTED. Refusing a legitimate guest in
 * front of other guests is a far worse outcome than a rare, fully-audited
 * duplicate. The only thing that blocks an admission is a check-in this device
 * already knows about — never an unknown, never a network failure.
 */
@Singleton
class CheckInRepository @Inject constructor(
    private val db: CheckinDatabase,
    private val io: CoroutineDispatcher,
) {

    /** A person, with everything the result screen needs to render them. */
    data class GuestView(
        val guestId: String,
        val fullName: String,
        val category: String,
        val isPrimaryContact: Boolean,
        val mealSelection: String?,
        val dietaryNotes: String?,
        val alreadyArrived: Boolean,
        val arrivedAt: Long?,
        val arrivedByStaff: String?,
        val arrivedAtDevice: String?,
    ) {
        val isVip: Boolean get() = category.equals("vip", ignoreCase = true)
    }

    /** A party plus its members and live table. */
    data class PartyView(
        val partyId: String,
        val label: String,
        /**
         * The LIVE table from the local bundle, not the one in the token.
         *
         * A ticket minted before seating was finalised carries a stale or absent
         * table (see tokenService.signQrTicketForResponse), and the server's own
         * scan handler re-queries it for exactly this reason. Reading the token's
         * value out to a guest would send them to the wrong seat.
         */
        val tableName: String?,
        /**
         * The same table's id, so the seating plan knows which element to light.
         *
         * Carried alongside the name rather than derived from it: table names
         * are free text and are NOT unique within an event — two rooms at the
         * same venue can each have a "Table 1" — so matching the plan by name
         * would light both, or the wrong one. Null when the party has no seat,
         * which is what makes the plan render as context rather than as an
         * answer.
         */
        val tableId: String?,
        val response: String,
        val notes: String?,
        val members: List<GuestView>,
    ) {
        val unarrived: List<GuestView> get() = members.filter { !it.alreadyArrived }
        val arrived: List<GuestView> get() = members.filter { it.alreadyArrived }
        val hasVip: Boolean get() = members.any { it.isVip }
    }

    /**
     * What the scan result screen should show (§8.4).
     *
     * Each state is visually unmistakable and, more importantly, tells the usher
     * what to DO. "Not found" is never a dead end — it routes to manual search.
     */
    sealed interface ScanOutcome {
        /** Resolved, and at least one member has not arrived. */
        data class Welcome(val party: PartyView) : ScanOutcome

        /** Every member has already arrived (§9.5). Override is supervisor-only. */
        data class AlreadyCheckedIn(val party: PartyView) : ScanOutcome

        /** A genuine ticket for another event. States which one. */
        data class WrongEvent(val belongsToEventId: String) : ScanOutcome

        /**
         * Parsed but the party is not in this bundle.
         *
         * Also the outcome for a FORGED token, because the bundle is an allowlist
         * (see TicketResolver): an invented partyId lands here, indistinguishable
         * from a guest who was deleted. Both need the same next step.
         */
        data object NotFound : ScanOutcome

        /** Not a Fancy ticket at all. Routes to manual search, never a dead end. */
        data object Unrecognised : ScanOutcome

        /** Expired ticket for this event — usually a clock problem, not fraud. */
        data class Expired(val party: PartyView?) : ScanOutcome
    }

    fun observeArrivedCount(eventId: String): Flow<Int> = db.checkInDao().observeArrivedCount(eventId)

    fun observePendingCount(): Flow<Int> = db.checkInDao().observePendingCount()

    fun observeQueueDepth(): Flow<Int> = db.syncQueueDao().observeDepth()

    /**
     * Resolves a scanned string to an outcome. Reads only; writes nothing.
     *
     * Kept separate from [checkIn] so the result screen can be shown and confirmed
     * before anything is recorded — and so a party arriving in two halves (§9.1)
     * can be presented for selection rather than admitted wholesale.
     */
    suspend fun resolveScan(scanned: String?, eventId: String): ScanOutcome = withContext(io) {
        when (val resolution = TicketResolver.resolve(scanned, eventId)) {
            TicketResolver.Resolution.NotATicket -> ScanOutcome.Unrecognised

            is TicketResolver.Resolution.WrongEvent ->
                ScanOutcome.WrongEvent(resolution.belongsToEventId)

            is TicketResolver.Resolution.Expired ->
                ScanOutcome.Expired(loadParty(eventId, resolution.partyId))

            is TicketResolver.Resolution.Ticket -> {
                val party = loadParty(eventId, resolution.partyId)
                    ?: return@withContext ScanOutcome.NotFound
                if (party.unarrived.isEmpty()) {
                    ScanOutcome.AlreadyCheckedIn(party)
                } else {
                    ScanOutcome.Welcome(party)
                }
            }
        }
    }

    /** Offline manual search over the local bundle (§8.5, §10). */
    suspend fun search(eventId: String, query: String, limit: Int = 30): List<PartyView> =
        withContext(io) {
            val needle = NameNormalizer.normalize(query)
            if (needle.isBlank()) return@withContext emptyList()

            // Searches GUESTS, not party labels, so a companion is findable by
            // their own name — the failure the server-side search had (finding R-3).
            val guests = db.guestDao().searchByName(eventId, needle, limit)
            guests.map { it.partyId }
                .distinct()
                .mapNotNull { loadParty(eventId, it) }
        }

    /**
     * Records arrivals for specific guests, locally, and queues them (§5.4).
     *
     * Explicitly takes the guest ids rather than a whole party, because partial
     * arrivals are extremely common: a party of four arriving as two, then two,
     * must produce four correct individual records and must never block the second
     * pair (§9.1 acceptance).
     *
     * Idempotent per guest: a guest this device already has a live check-in for is
     * skipped rather than double-recorded, so a double-tap costs nothing.
     */
    suspend fun checkIn(
        eventId: String,
        partyId: String,
        guestIds: List<String>,
        method: String,
        staffId: String?,
        staffDisplayName: String?,
        deviceId: String?,
        deviceLabel: String?,
        scanToken: String? = null,
    ): List<CheckInEntity> = withContext(io) {
        if (guestIds.isEmpty()) return@withContext emptyList()

        val alreadyLive = db.checkInDao().liveGuestIdsForParty(eventId, partyId).toSet()
        val toRecord = guestIds.filterNot { it in alreadyLive }
        if (toRecord.isEmpty()) return@withContext emptyList()

        val now = System.currentTimeMillis()
        val rows = toRecord.map { guestId ->
            CheckInEntity(
                clientCheckinId = UUID.randomUUID().toString(),
                eventId = eventId,
                guestId = guestId,
                partyId = partyId,
                checkedInAt = now,
                staffId = staffId,
                staffDisplayName = staffDisplayName,
                deviceId = deviceId,
                deviceLabel = deviceLabel,
                method = method,
                // Only attached for a scan, and only until the row syncs. It is a
                // live bearer credential; the server stores a fingerprint of it.
                scanToken = if (method == METHOD_SCAN) scanToken else null,
                syncState = "pending",
                serverId = null,
                serverSeq = null,
                isRemote = false,
            )
        }

        // Local write and queue insert are one transaction. If they could diverge,
        // a check-in could exist locally and never be queued — invisible loss that
        // no later drain would repair.
        db.withTransaction {
            db.checkInDao().upsertAll(rows)
            rows.forEach { row ->
                db.syncQueueDao().enqueue(
                    SyncQueueEntity(
                        payloadType = "check_in",
                        payloadJson = row.toQueuePayload(),
                        eventId = eventId,
                        createdAt = now,
                    ),
                )
            }
        }

        rows
    }

    /**
     * Supervisor undo, recorded locally and queued (§9.6).
     *
     * Soft: the row is marked, never deleted, so the arrival remains visible in the
     * audit trail. A reason is mandatory — the server rejects an undo without one.
     */
    suspend fun undo(
        eventId: String,
        clientCheckinId: String,
        reason: String,
        staffId: String?,
    ): Boolean = withContext(io) {
        if (reason.isBlank()) return@withContext false
        val row = db.checkInDao().byClientId(clientCheckinId) ?: return@withContext false
        if (row.undoneAt != null) return@withContext true // idempotent

        /*
         * WHICH check-in, in terms the SERVER can resolve.
         *
         * `clientCheckinId` only means something to the server for a check-in
         * this device created. Anything else — an arrival seeded when the tablet
         * was prepared, or one that came from another gate in the delta — was
         * rebuilt locally under an invented `seed:`/`remote:` key, and sending
         * that alone gets a 404 while the guest stays counted as present.
         *
         * `serverId` is the row's real primary key and is present on both of
         * those. Queued alongside so the drain can name the row either way; the
         * server prefers the server id when it has one.
         */
        val serverId = row.serverId

        val now = System.currentTimeMillis()
        db.withTransaction {
            db.checkInDao().markUndone(clientCheckinId, now, reason)
            db.syncQueueDao().enqueue(
                SyncQueueEntity(
                    payloadType = "undo",
                    payloadJson = Json.encodeToString(
                        JsonObject.serializer(),
                        JsonObject(
                            mapOf(
                                "client_checkin_id" to JsonPrimitive(clientCheckinId),
                                "reason" to JsonPrimitive(reason),
                                // Carried so the SERVER can check the role, not just
                                // this screen (§18.2). Queued with the undo because
                                // the drain may run hours later, under a different
                                // operator, or after a process restart — the acting
                                // supervisor has to be captured at the moment of the
                                // decision, not looked up at send time.
                                "staff_id" to (
                                    staffId?.let { JsonPrimitive(it) } ?: JsonNull
                                ),
                                // See above: the only reference that resolves
                                // for an arrival this device did not create.
                                "server_id" to (
                                    serverId?.let { JsonPrimitive(it) } ?: JsonNull
                                ),
                            ),
                        ),
                    ),
                    eventId = eventId,
                    createdAt = now,
                ),
            )
        }
        true
    }

    private suspend fun loadParty(eventId: String, partyId: String): PartyView? {
        val party: PartyEntity = db.partyDao().byId(partyId) ?: return null
        // A party from another event must never resolve, even if the id is somehow
        // present locally from a previous bundle.
        if (party.eventId != eventId) return null

        val guests = db.guestDao().byParty(partyId)
        if (guests.isEmpty()) return null

        val live = db.checkInDao().liveGuestIdsForParty(eventId, partyId).toSet()
        val members = guests.map { guest ->
            val record = if (guest.id in live) db.checkInDao().liveForGuest(eventId, guest.id) else null
            guest.toView(record)
        }

        return PartyView(
            partyId = party.id,
            label = party.label,
            tableName = party.tableName,
            tableId = party.tableId,
            response = party.response,
            notes = party.notes,
            members = members,
        )
    }

    private fun GuestEntity.toView(record: CheckInEntity?) = GuestView(
        guestId = id,
        fullName = fullName,
        category = category,
        isPrimaryContact = isPrimaryContact,
        mealSelection = mealSelection,
        dietaryNotes = dietaryNotes,
        alreadyArrived = record != null,
        arrivedAt = record?.checkedInAt,
        arrivedByStaff = record?.staffDisplayName,
        arrivedAtDevice = record?.deviceLabel,
    )

    /**
     * Serialises a queue entry in the exact shape the batch endpoint expects.
     *
     * Hand-built rather than delegated to the DTO so the queue payload is a stable
     * on-disk format: a queued entry may sit through an app update, and if its
     * shape tracked a serializable class it could become unreadable after a
     * refactor — losing check-ins that exist nowhere else.
     */
    private fun CheckInEntity.toQueuePayload(): String {
        val fields = buildMap {
            put("client_checkin_id", JsonPrimitive(clientCheckinId))
            put("guest_id", JsonPrimitive(guestId))
            put("checked_in_at", JsonPrimitive(java.time.Instant.ofEpochMilli(checkedInAt).toString()))
            put("method", JsonPrimitive(method))
            staffId?.let { put("staff_id", JsonPrimitive(it)) }
            staffDisplayName?.let { put("staff_display_name", JsonPrimitive(it)) }
            deviceId?.let { put("device_id", JsonPrimitive(it)) }
            deviceLabel?.let { put("device_label", JsonPrimitive(it)) }
            scanToken?.let { put("scan_token", JsonPrimitive(it)) }
        }
        return Json.encodeToString(JsonObject.serializer(), JsonObject(fields))
    }

    companion object {
        const val METHOD_SCAN = "qr_scan"
        const val METHOD_MANUAL = "manual_search"
        const val METHOD_GROUP = "group"
        const val METHOD_OVERRIDE = "override"
    }
}
