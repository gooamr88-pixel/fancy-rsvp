package com.fancyrsvp.checkin.data.repo

import com.fancyrsvp.checkin.data.local.CheckInEntity
import com.fancyrsvp.checkin.data.local.CheckinDatabase
import com.fancyrsvp.checkin.data.local.ConflictEntity
import com.fancyrsvp.checkin.data.remote.CheckInBatchRequest
import com.fancyrsvp.checkin.data.remote.CheckInRecordDto
import com.fancyrsvp.checkin.data.remote.CheckinApi
import com.fancyrsvp.checkin.sync.SyncPolicy
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The sync engine's data layer (spec §17, §21.3).
 *
 * ── The governing rule ──
 *
 * §21.3: "Nothing is ever removed from the queue on a time basis. Entries are
 * removed only after the server has explicitly confirmed them."
 *
 * A queued check-in exists ONLY on this device. Every branch below that removes an
 * entry does so because the server said it holds it — never because an entry looked
 * old, never because a response was ambiguous, never because a retry count got
 * high. Failure is always "keep and try again", because the alternative is erasing
 * a guest's arrival with no error and no trace.
 *
 * ── Realtime is absent on purpose ──
 *
 * §17.1: "Realtime is an optimisation, never a correctness dependency. Implement
 * and test the polling fallback FIRST, then add realtime on top." Polling is what
 * this class does, and it is sufficient for every acceptance criterion in §9.2.
 * Realtime is additionally blocked by discovery finding R-2 — the channel has no
 * authorisation model, and subscribing with the anon key would let any holder read
 * any event's guest data. It is not shipped until that is designed.
 */
@Singleton
class SyncRepository @Inject constructor(
    private val api: CheckinApi,
    private val db: CheckinDatabase,
    /**
     * Injected for ONE purpose: acting on the server's instruction to destroy
     * this event's local data. No cycle — DeviceRepository knows nothing about
     * this class.
     */
    private val deviceRepository: DeviceRepository,
    private val io: CoroutineDispatcher,
) {

    /**
     * ── THE REMOTE WIPE, WHICH DID NOTHING AT ALL ──
     *
     * An organizer can ask a lost or stolen tablet to erase its guest list. The
     * server records it, and from then on `requireDevice` answers EVERY call
     * from that device with 403 and `meta.wipe_required: true`.
     *
     * Nothing on the device read it. `DeviceRepository.handleWipeInstruction`
     * had zero callers, `SyncMeta.wipeRequired` was parsed and never accessed —
     * the only read of `meta` anywhere was an empty lambda — and the auth
     * interceptor reacts to 401 alone, so a 403 passed straight through to a
     * caller that only cared whether it was 2xx. Guest names, phone numbers,
     * dietary notes and table assignments stayed readable on a missing tablet
     * indefinitely, while the dashboard told the organizer in as many words
     * that they would be erased on next contact.
     *
     * Every sync path funnels through here because the 403 is not attached to
     * any one endpoint — it is the answer to everything the device asks.
     *
     * The purge itself still refuses while the outbound queue holds unsent
     * check-ins (DeviceRepository.purgeEventData). That is deliberate and is
     * not weakened here: those records exist nowhere else, and a wipe must not
     * become a way to lose them. It retries on the next call, which is seconds
     * away.
     *
     * @return true when a wipe instruction was seen, so the caller can stop
     *   rather than report an ordinary transport failure.
     */
    private suspend fun handleWipeSignal(eventId: String, rawErrorBody: String?): Boolean {
        if (rawErrorBody.isNullOrBlank()) return false

        val body = runCatching { Json.parseToJsonElement(rawErrorBody) as JsonObject }.getOrNull()
            ?: return false
        val code = body["error"]?.jsonPrimitive?.contentOrNull
        val wipeRequired = (body["meta"] as? JsonObject)
            ?.get("wipe_required")?.jsonPrimitive?.booleanOrNull == true

        // Both spellings, because the server states it two ways: an explicit
        // meta flag, and the error code itself.
        if (!wipeRequired && code != "WIPE_REQUESTED" && code != "DEVICE_REVOKED") return false

        // Credentials are cleared only for a REVOKED device. A plain wipe leaves
        // the tablet paired so it stays provisioned for the next event.
        deviceRepository.handleWipeInstruction(eventId, revoked = code == "DEVICE_REVOKED")
        return true
    }

    /**
     * Records per request, shrunk by a 413 and restored by the next success.
     *
     * A field rather than a constant so the device can actually obey the
     * server's "too large" — see the 413 branch in [drainOnce]. Only ever
     * touched inside `withContext(io)`, which is a single-threaded confinement
     * for this repository's writes, so it needs no further synchronisation.
     */
    private var batchSize: Int = SyncPolicy.BATCH_SIZE

    /** What a drain attempt did, for the worker's retry decision. */
    sealed interface DrainResult {
        /** Queue is empty, or everything outstanding was confirmed. */
        data class Complete(val accepted: Int, val duplicate: Int, val conflict: Int) : DrainResult

        /** Progress was made but more remains. Run again immediately. */
        data class Partial(val remaining: Int) : DrainResult

        /** Transport or server failure. The worker backs off; nothing was lost. */
        data class Failed(val reason: String, val retryable: Boolean) : DrainResult

        /** The kill switch is on (§21.5). Not a failure — local work continues. */
        data object SyncDisabled : DrainResult
    }

    /**
     * Drains one batch of the outbound queue.
     *
     * Returns [DrainResult.Partial] rather than looping internally so the worker
     * owns the pacing: a long drain must stay interruptible and must not hold a
     * coroutine for minutes on a poor connection.
     */
    suspend fun drainOnce(eventId: String): DrainResult = withContext(io) {
        val event = db.eventDao().byId(eventId)
            ?: return@withContext DrainResult.Failed("unknown event", retryable = false)

        // The cached kill-switch flag, so a device that went offline retains the
        // last instruction rather than reverting to a default (§21.5).
        if (event.syncDisabled) return@withContext DrainResult.SyncDisabled

        val batch = db.syncQueueDao().peek(eventId, batchSize)
        if (batch.isEmpty()) return@withContext DrainResult.Complete(0, 0, 0)

        val checkIns = batch.filter { it.payloadType == "check_in" }
        if (checkIns.isEmpty()) {
            // Only undo entries at the head. Handled on their own path so a failing
            // undo cannot block check-ins behind it.
            return@withContext drainUndos(eventId, batch.filter { it.payloadType == "undo" })
        }

        val records = checkIns.mapNotNull { entry -> entry.payloadJson.toRecordOrNull() }
        if (records.isEmpty()) {
            // Unparseable payloads. Stalled and KEPT — a corrupt entry is still
            // evidence that someone was admitted, and a supervisor must see it.
            checkIns.forEach { db.syncQueueDao().recordFailure(it.id, "unparseable payload") }
            return@withContext DrainResult.Failed("unparseable queue payloads", retryable = false)
        }

        val response = try {
            api.submitBatch(
                eventId,
                CheckInBatchRequest(
                    records = records,
                    // A-15: ask for the delta inline. During a rush this is the
                    // highest-frequency channel the device has, so it converges on
                    // other gates' check-ins in a second or two rather than at the
                    // next poll tick.
                    sinceSeq = event.lastAppliedSeq,
                ),
            )
        } catch (e: java.io.IOException) {
            // Offline. Every entry stays exactly where it is.
            return@withContext DrainResult.Failed(e.message ?: "network", retryable = true)
        }

        if (!response.isSuccessful) {
            // Read BEFORE anything else looks at the response: errorBody() is a
            // one-shot stream, and a wipe instruction arrives as a 403 on
            // whatever call the device happened to make next.
            if (handleWipeSignal(eventId, runCatching { response.errorBody()?.string() }.getOrNull())) {
                return@withContext DrainResult.Failed("wipe requested", retryable = false)
            }

            val retryable = when (response.code()) {
                // 429 is a NORMAL backoff signal, never a reason to discard data
                // (§21.9). 5xx and 408 are transient by definition.
                429, 408, in 500..599 -> true
                413 -> true
                else -> false
            }

            /*
             * ── 413 HAS TO ACTUALLY SEND FEWER ──
             *
             * The comment here read "the next attempt sends fewer" and nothing
             * implemented it: `peek` asked for the same `SyncPolicy.BATCH_SIZE`
             * constant every time, so a 413 produced an identical request on an
             * unbounded retry ladder and NO check-in would ever upload again.
             *
             * It has never fired because the device's batch size and the
             * server's cap are both exactly 100 (`MAX_BATCH` in
             * checkinSyncService.js), and the check is `>`. That is a zero-width
             * margin: lowering the server cap, or raising this constant, turns a
             * tuning change into total upload failure at every venue at once.
             *
             * Halving is the standard response and it converges fast — 100, 50,
             * 25… — and the floor of 1 means the worst case is one record per
             * request, which is slow but still drains. Reset on the next success
             * so a one-off does not cost throughput for the rest of the night.
             */
            if (response.code() == 413) {
                batchSize = (batchSize / 2).coerceAtLeast(1)
            }

            checkIns.forEach {
                db.syncQueueDao().recordFailure(it.id, "HTTP ${response.code()}")
            }
            return@withContext DrainResult.Failed("HTTP ${response.code()}", retryable)
        }

        // The server accepted a batch of this size, so any earlier 413 shrink has
        // done its job and full throughput can resume.
        batchSize = SyncPolicy.BATCH_SIZE

        val body = response.body()?.data
            ?: return@withContext DrainResult.Failed("empty batch response", retryable = true)

        // Server controls ride along on every sync response (§21.5).
        response.body()?.meta?.let { /* version metadata; acted on at preparation */ }

        val byClientId = checkIns.associateBy { entry ->
            entry.payloadJson.toRecordOrNull()?.clientCheckinId
        }

        var accepted = 0
        var duplicate = 0
        var conflicts = 0
        val toRemove = mutableListOf<Long>()

        for (result in body.results) {
            val clientId = result.clientCheckinId ?: continue
            val entry = byClientId[clientId]

            when (SyncPolicy.actionFor(result.status)) {
                SyncPolicy.QueueAction.CONFIRM_AND_REMOVE -> {
                    db.checkInDao().markSynced(clientId, "synced", result.serverId, result.serverSeq)
                    entry?.let { toRemove.add(it.id) }
                    if (result.status == "accepted") accepted++ else duplicate++
                }

                SyncPolicy.QueueAction.MARK_CONFLICT_AND_REMOVE -> {
                    db.checkInDao().markConflict(clientId)
                    result.guestId?.let { guestId ->
                        db.conflictDao().upsertAll(
                            listOf(
                                ConflictEntity(
                                    clientCheckinId = clientId,
                                    eventId = eventId,
                                    guestId = guestId,
                                    winningStaffName = result.winning?.staffName,
                                    winningDeviceLabel = result.winning?.deviceLabel,
                                    winningCheckedInAt = result.winning?.checkedInAt?.toEpochMillisOrNull(),
                                    detectedAt = System.currentTimeMillis(),
                                ),
                            ),
                        )
                    }
                    entry?.let { toRemove.add(it.id) }
                    conflicts++
                }

                SyncPolicy.QueueAction.MARK_STALLED_AND_KEEP -> {
                    // Kept in the database and raised to the supervisor. Retrying
                    // will not help, but §21.3 forbids discarding it.
                    entry?.let {
                        db.syncQueueDao().recordFailure(it.id, "rejected: ${result.reason ?: "unknown"}")
                    }
                    db.checkInDao().recordFailure(clientId, "rejected: ${result.reason ?: "unknown"}")
                }

                SyncPolicy.QueueAction.RETRY -> {
                    entry?.let { db.syncQueueDao().recordFailure(it.id, "unknown status ${result.status}") }
                }
            }
        }

        // The ONLY removal path, and it runs after every outcome is recorded.
        if (toRemove.isNotEmpty()) db.syncQueueDao().confirmAndRemove(toRemove)

        // ── Inline delta (A-15) ──
        // Applied BEFORE advancing the cursor from the batch's own max_seq, so a
        // change carried here is written while the cursor still sits behind it.
        // Advancing first would skip these rows on the next fetch.
        body.delta?.let { inline ->
            applyChanges(eventId, inline.changes)
            db.eventDao().advanceAppliedSeq(eventId, inline.maxSeq)

            // Truncated means more remains. Followed up here rather than by
            // returning Partial: the next drainOnce would find an empty queue and
            // return early WITHOUT sending a batch, so the rest of the delta would
            // wait out a full poll interval in the middle of a rush.
            var more = inline.truncated
            var guard = 0
            while (more && guard < MAX_TRUNCATED_FOLLOWUPS) {
                guard++
                more = pollDelta(eventId)
            }
        }

        // The server's max_seq covers everything it now holds, including these.
        body.maxSeq?.let { db.eventDao().advanceAppliedSeq(eventId, it) }

        val remaining = db.syncQueueDao().depthForEvent(eventId)
        if (remaining > 0) DrainResult.Partial(remaining)
        else DrainResult.Complete(accepted, duplicate, conflicts)
    }

    private suspend fun drainUndos(
        eventId: String,
        undos: List<com.fancyrsvp.checkin.data.local.SyncQueueEntity>,
    ): DrainResult {
        /*
         * A stalled entry is waiting on a person, not on the network.
         *
         * `SyncQueueWorker` loops on `Partial` with no delay between batches, so
         * anything left in this list that cannot succeed turns the drain into a
         * spin — one doomed HTTP request per iteration. They stay in the table
         * (§21.3 — an entry leaves only on server confirmation) and stay visible
         * through `observeStalledCount`; they are simply not sent again.
         */
        val sendable = undos.filterNot { it.isStalled }
        if (sendable.isEmpty()) return DrainResult.Complete(0, 0, 0)

        val removed = mutableListOf<Long>()
        for (entry in sendable) {
            val obj = runCatching { Json.parseToJsonElement(entry.payloadJson) as JsonObject }.getOrNull()
            val clientId = obj?.get("client_checkin_id")?.jsonPrimitive?.content
            val reason = obj?.get("reason")?.jsonPrimitive?.content
            // Undos queued before this field existed carry no staff id. The server
            // refuses them with 403, which lands in the non-retryable branch below
            // and surfaces on the conflicts screen rather than stalling the queue.
            val staffId = obj?.get("staff_id")?.jsonPrimitive?.contentOrNull
            // Absent on undos queued before this field existed — those keep the
            // old behaviour and resolve by client id alone.
            val serverId = obj?.get("server_id")?.jsonPrimitive?.contentOrNull
            if (clientId == null || reason.isNullOrBlank()) {
                db.syncQueueDao().recordFailure(entry.id, "malformed undo payload")
                continue
            }

            val response = try {
                api.undoCheckIn(
                    eventId, clientId,
                    com.fancyrsvp.checkin.data.remote.UndoRequest(reason, staffId, serverId),
                )
            } catch (e: java.io.IOException) {
                return DrainResult.Failed(e.message ?: "network", retryable = true)
            }

            when {
                response.isSuccessful -> removed.add(entry.id)

                /*
                 * ── A 404 IS NOT SUCCESS, AND TREATING IT AS ONE LOST UNDOS ──
                 *
                 * This branch used to read `response.isSuccessful ||
                 * response.code() == 404 -> removed.add(entry.id)`, on the
                 * reasoning that the server never received the original
                 * check-in, so there was nothing to reverse and the entry was
                 * done.
                 *
                 * That reasoning does not hold. The undo path only runs once no
                 * check-in entries remain in the batch, so an offline check-in
                 * queued ahead of its own undo has already been sent by the time
                 * we get here — the server DOES have it. What actually produces a
                 * 404 is an arrival this device did not create: it holds a
                 * locally-invented `seed:`/`remote:` id the server has never seen
                 * (see GuestListViewModel.Row.reversibleHere). The server's
                 * check-in is live and must be reversed — and discarding the
                 * entry meant it never was, silently and permanently, while both
                 * screens reported the guest as un-admitted.
                 *
                 * So the LOCAL MARK IS TAKEN BACK and the entry is dropped.
                 *
                 * Taking the mark back is the part that matters. The undo is
                 * applied locally before it is queued, so the guest is showing as
                 * reversed on this tablet; if the server never accepts it, that
                 * display is simply wrong, and leaving it is the exact
                 * tablet-says-one-thing-dashboard-says-another failure this path
                 * is being repaired for. The guest goes back to arrived, which is
                 * true, and the guest list explains that the reversal has to be
                 * done from the dashboard.
                 *
                 * Dropping the entry does not violate §21.3. That rule protects
                 * CHECK-INS — evidence of an admission that exists nowhere else.
                 * This is a correction the server has already refused as
                 * unresolvable; retrying cannot change the answer, and keeping it
                 * would leave the queue permanently non-empty, which BLOCKS
                 * closing the event (CloseEventScreen) with no control anywhere
                 * that can clear it.
                 */
                /*
                 * ── AND THE SAME IS TRUE OF EVERY OTHER REFUSAL ──
                 *
                 * This was `response.code() == 404` alone, with everything else
                 * falling through to `recordFailure` below. That left three
                 * refusals the server will never change its mind about — 400,
                 * 403 SUPERVISOR_REQUIRED, 403 UNKNOWN_STAFF — being retried
                 * ten times and then parked in the queue forever, with the
                 * local reversal still displayed.
                 *
                 * None of them can resolve. The acting staff id is captured at
                 * the moment of the decision and queued with the undo, so a
                 * different supervisor picking up the tablet does not change
                 * what gets re-sent. And a parked entry is not harmless: it
                 * blocks closing the event, unpairing and purging, and no
                 * control anywhere in the app can clear it.
                 *
                 * 429 and 408 are excluded because they mean "not now", not
                 * "no" — those still belong on the retry ladder.
                 */
                response.code() in 400..499 && response.code() != 429 && response.code() != 408 -> {
                    db.checkInDao().clearUndone(clientId)
                    // Kept ON THE ROW so the guest list can say why the guest is
                    // still showing as arrived. Clearing the mark without this
                    // would look like the undo was never attempted.
                    db.checkInDao().recordFailure(clientId, "undo refused: HTTP ${response.code()}")
                    removed.add(entry.id)
                }

                response.code() in 500..599 || response.code() == 429 ->
                    return DrainResult.Failed("HTTP ${response.code()}", retryable = true)
                else -> db.syncQueueDao().recordFailure(entry.id, "HTTP ${response.code()}")
            }
        }

        if (removed.isNotEmpty()) db.syncQueueDao().confirmAndRemove(removed)
        // Counted WITHOUT stalled entries: `Partial` means "come straight back",
        // and the worker obeys it with no delay.
        val remaining = db.syncQueueDao().pendingDepthForEvent(eventId)
        return if (remaining > 0) DrainResult.Partial(remaining) else DrainResult.Complete(0, 0, 0)
    }

    /**
     * Applies check-ins recorded by OTHER devices (§17.5, §5.3 Layer 2).
     *
     * This is what makes a guest checked in at the main entrance read "already
     * checked in" at the garden gate within seconds — the multi-entrance gap §9.2
     * measures.
     *
     * Returns true if there may be more to fetch, so the caller can loop on a
     * truncated response rather than assuming it is caught up.
     */
    suspend fun pollDelta(eventId: String): Boolean = withContext(io) {
        val event = db.eventDao().byId(eventId) ?: return@withContext false

        val response = try {
            api.checkInDelta(eventId, event.lastAppliedSeq)
        } catch (_: java.io.IOException) {
            return@withContext false
        }
        if (!response.isSuccessful) {
            // The poll is the call a quiet gate makes most often, so on a tablet
            // that is not admitting anyone this is usually where the wipe
            // instruction is first seen.
            handleWipeSignal(eventId, runCatching { response.errorBody()?.string() }.getOrNull())
            return@withContext false
        }
        val delta = response.body()?.data ?: return@withContext false

        applyChanges(eventId, delta.changes)

        // MAX() inside the DAO guards against an out-of-order response dragging the
        // cursor backwards, which would make the device re-fetch forever (§17.4).
        db.eventDao().advanceAppliedSeq(eventId, delta.maxSeq)

        // A truncated response means "fetch again from maxSeq", not "caught up".
        delta.truncated
    }

    /**
     * Applies a set of check-in changes made by other devices.
     *
     * Shared by the polling path and the inline-delta path (A-15) so both write
     * exactly the same rows. Two implementations would drift, and the symptom
     * would be a guest reading as arrived at one gate and not at another
     * depending on which channel delivered the news.
     */
    private suspend fun applyChanges(
        eventId: String,
        changes: List<com.fancyrsvp.checkin.data.remote.CheckInChangeDto>,
    ) {
        if (changes.isEmpty()) return

        val remoteRows = mutableListOf<CheckInEntity>()
        for (change in changes) {
            when (change.type) {
                "check_in" -> {
                    // Skip anything this device already holds locally: its own
                    // check-ins come back in the delta, and overwriting them would
                    // clobber the pending sync state of a row still in the queue.
                    val existing = db.checkInDao().liveForGuest(eventId, change.guestId)
                    if (existing != null) continue

                    remoteRows.add(
                        CheckInEntity(
                            // Deterministic, derived from the server id, so
                            // re-applying the same delta cannot duplicate the row.
                            clientCheckinId = "remote:${change.serverId ?: "${change.guestId}:${change.serverSeq}"}",
                            eventId = eventId,
                            guestId = change.guestId,
                            partyId = change.partyId ?: continue,
                            checkedInAt = change.checkedInAt?.toEpochMillisOrNull()
                                ?: System.currentTimeMillis(),
                            staffId = null,
                            staffDisplayName = change.staffName,
                            deviceId = null,
                            deviceLabel = change.deviceLabel,
                            method = change.method ?: "qr_scan",
                            scanToken = null,
                            syncState = "synced",
                            serverId = change.serverId,
                            serverSeq = change.serverSeq,
                            isRemote = true,
                        ),
                    )
                }

                "check_in_undone" -> {
                    /*
                     * Another device's supervisor reversed an admission. Applied so
                     * this device stops reporting the guest as arrived — and so the
                     * guest can be admitted again here if they really are present.
                     *
                     * ── Resolved by SERVER ID first, and that is the fix ──
                     *
                     * This looked the row up as `remote:<serverId>` and nothing
                     * else, which only ever matches an admission made on ANOTHER
                     * device. A check-in this tablet made itself is stored under
                     * its own client id, so when the other gate reversed one of
                     * OURS the lookup missed, the row stayed live here, and the
                     * tablet went on showing the guest as arrived — then refused
                     * to re-admit them on the Layer 1 duplicate guard (§5.3).
                     *
                     * The server id is written back onto our own rows when they
                     * sync (`markSynced`) and onto remote rows when they arrive,
                     * so it matches both. The `remote:` lookup stays as a fallback
                     * for rows stored before the id was recorded.
                     */
                    val row = change.serverId?.let { db.checkInDao().byServerId(eventId, it) }
                        // The fallback key is derived EXACTLY as the insert above
                        // derives it, including the no-server-id branch. Writing
                        // `"remote:$serverId"` here instead produced the literal
                        // string "remote:null" for a change with no server id —
                        // a key nothing is ever stored under, so the fallback
                        // silently matched nothing in the one case it exists for.
                        ?: db.checkInDao().byClientId(
                            "remote:${change.serverId ?: "${change.guestId}:${change.serverSeq}"}",
                        )
                    row?.let {
                        db.checkInDao().markUndone(
                            it.clientCheckinId,
                            System.currentTimeMillis(),
                            "Reversed on another device",
                        )
                    }
                }
            }
        }

        if (remoteRows.isNotEmpty()) db.checkInDao().upsertAll(remoteRows)
    }

    /** Reads and caches the emergency controls (§21.5). */
    suspend fun refreshControls(eventId: String) = withContext(io) {
        val response = try {
            api.controls(eventId)
        } catch (_: java.io.IOException) {
            return@withContext
        }
        val controls = response.body()?.data ?: return@withContext
        db.eventDao().setControls(
            eventId,
            syncDisabled = controls.syncDisabled,
            realtimeDisabled = controls.realtimeDisabled,
            pollingOnly = controls.pollingOnly,
        )
    }

    private fun String.toRecordOrNull(): CheckInRecordDto? = try {
        QUEUE_JSON.decodeFromString(CheckInRecordDto.serializer(), this)
    } catch (_: Exception) {
        null
    }

    private fun String.toEpochMillisOrNull(): Long? = try {
        Instant.parse(this).toEpochMilli()
    } catch (_: Exception) {
        null
    }

    // Not private: SyncCoordinator runs the same truncated-delta chase from its
    // poll loop and reads MAX_TRUNCATED_FOLLOWUPS from here.
    companion object {
        /**
         * Lenient by necessity: a queue entry may have been written by an OLDER app
         * version and sat through an update. Refusing to parse it would strand a
         * check-in permanently.
         */
        private val QUEUE_JSON = Json { ignoreUnknownKeys = true; isLenient = true }

        /** Bound on chasing a truncated delta, so a busy event cannot spin. */
        const val MAX_TRUNCATED_FOLLOWUPS = 20
    }
}
