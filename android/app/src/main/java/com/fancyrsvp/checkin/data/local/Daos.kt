package com.fancyrsvp.checkin.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface EventDao {
    @Upsert
    suspend fun upsert(event: EventEntity)

    @Query("SELECT * FROM events ORDER BY startsAt ASC")
    fun observeAll(): Flow<List<EventEntity>>

    @Query("SELECT * FROM events WHERE id = :eventId")
    suspend fun byId(eventId: String): EventEntity?

    /**
     * Refreshes DISPLAY fields only, for the event-selection list (§8.2).
     *
     * Deliberately not `@Upsert`. Upserting a summary fetched from the list
     * endpoint would overwrite isReadyOffline, lastFullSyncAt, bundleVersion and
     * lastAppliedSeq with defaults — silently DISARMING a tablet that had already
     * downloaded its bundle. An operator refreshing the list the morning of an
     * event would arrive at the venue with an unprepared device and no indication
     * anything had happened.
     *
     * totalInvited is untouched too: it comes from the bundle manifest, and the
     * list endpoint does not carry it. Overwriting it with 0 would break the
     * pre-download storage check (§21.9).
     */
    @Query("UPDATE events SET name = :name, venue = :venue, startsAt = :startsAt, timezone = :timezone WHERE id = :eventId")
    suspend fun updateSummary(eventId: String, name: String, venue: String?, startsAt: Long, timezone: String?)

    @Query("SELECT * FROM events WHERE id = :eventId")
    fun observe(eventId: String): Flow<EventEntity?>

    /**
     * The event this device is armed for, without needing its id.
     *
     * A device is paired to exactly one event (§18.3), so this is unambiguous in
     * practice. Prefers a prepared one and falls back to the most imminent, for
     * the window between pairing and the first successful bundle download —
     * during which the row exists but `isReadyOffline` is still false.
     *
     * ── WHY THE ORDER IS NOT JUST `startsAt ASC` ──
     *
     * It was, and combined with event rows that were never deleted (see
     * [deleteById]) that resolved to the OLDEST event the tablet had ever held,
     * forever. A device reused across a season would answer this with a wedding
     * from months ago.
     *
     * "Imminent" has to mean nearest in the FUTURE, with past events as a
     * fallback ordered most-recent-first — a tablet still being tidied up the
     * morning after belongs to last night's event, not to the first one it ever
     * ran.
     */
    @Query(
        """
        SELECT * FROM events
         ORDER BY isReadyOffline DESC,
                  CASE WHEN startsAt >= :now THEN 0 ELSE 1 END ASC,
                  CASE WHEN startsAt >= :now THEN startsAt ELSE -startsAt END ASC
         LIMIT 1
        """,
    )
    suspend fun readyEvent(now: Long): EventEntity?

    /**
     * Removes an event outright, after its guest data has been purged.
     *
     * Nothing deleted these. `purgeGuestData` clears parties, guests, tables and
     * staff; `markNotReady` only flipped a flag — so every event a tablet had
     * ever been armed for stayed in the picker on the Prepare screen for the
     * life of the device, and skewed [readyEvent] as described above.
     *
     * Called ONLY from DeviceRepository.purgeEventData, which refuses while the
     * queue still holds unsent check-ins. The row carries `lastAppliedSeq`, so
     * removing it while anything is outstanding would lose the device's place in
     * the change stream.
     */
    @Query("DELETE FROM events WHERE id = :eventId")
    suspend fun deleteById(eventId: String)

    @Query("UPDATE events SET bundleVersion = :version WHERE id = :eventId")
    suspend fun setBundleVersion(eventId: String, version: Long)

    /**
     * Forgets the event's photograph after the file has been deleted (§20.5).
     *
     * The row and the file are cleared together and in that order — a path
     * pointing at a file that no longer exists would have every screen try to
     * decode it once per composition and fall back silently, which looks exactly
     * like an event that never had a picture but costs a disk hit each time.
     */
    @Query("UPDATE events SET coverImagePath = NULL, coverImageUrl = NULL WHERE id = :eventId")
    suspend fun clearCoverImage(eventId: String)

    /**
     * Advances the applied check-in sequence.
     *
     * MAX() guards against an out-of-order realtime message dragging the cursor
     * backwards, which would make the device re-fetch the same delta forever
     * (§17.4: a lower-or-equal sequence is discarded, never applied).
     */
    @Query("UPDATE events SET lastAppliedSeq = MAX(lastAppliedSeq, :seq) WHERE id = :eventId")
    suspend fun advanceAppliedSeq(eventId: String, seq: Long)

    @Query(
        """
        UPDATE events SET syncDisabled = :syncDisabled,
                          realtimeDisabled = :realtimeDisabled,
                          pollingOnly = :pollingOnly
         WHERE id = :eventId
        """,
    )
    suspend fun setControls(
        eventId: String,
        syncDisabled: Boolean,
        realtimeDisabled: Boolean,
        pollingOnly: Boolean,
    )

    /*
     * `markNotReady` was here and is gone. Its only caller was
     * DeviceRepository.purgeEventData, which now deletes the row outright — a
     * purged event should leave the Prepare picker, not sit in it forever with
     * a flag turned off. See [deleteById].
     */

    /**
     * Highest bundle version this device holds, across all armed events.
     *
     * Reported in the device-health header so a supervisor can see, before an
     * event starts, which devices are actually PREPARED — an unprepared spare is
     * worthless at a venue with no internet (§21.7).
     */
    @Query("SELECT MAX(bundleVersion) FROM events WHERE isReadyOffline = 1")
    suspend fun maxPreparedBundleVersion(): Long?
}

@Dao
interface PartyDao {
    @Upsert
    suspend fun upsertAll(parties: List<PartyEntity>)

    /** The scan path: one primary-key lookup, no parsing, no computation. */
    @Query("SELECT * FROM parties WHERE id = :partyId")
    suspend fun byId(partyId: String): PartyEntity?

    /**
     * Every party for the event, for a screen that needs the label and table of
     * many guests at once.
     *
     * Exists so GuestListViewModel can stop calling [byId] once per row: 500
     * guests meant 500 of those plus 500 live-check-in lookups — 1,001 queries
     * against an SQLCipher database on every filter change, which is a visible
     * freeze on a tablet.
     */
    @Query("SELECT * FROM parties WHERE eventId = :eventId")
    suspend fun forEvent(eventId: String): List<PartyEntity>

    @Query("DELETE FROM parties WHERE eventId = :eventId")
    suspend fun deleteForEvent(eventId: String)
}

@Dao
interface GuestDao {
    @Upsert
    suspend fun upsertAll(guests: List<GuestEntity>)

    @Query("SELECT * FROM guests WHERE partyId = :partyId ORDER BY isPrimaryContact DESC, fullName ASC")
    suspend fun byParty(partyId: String): List<GuestEntity>

    @Query("SELECT * FROM guests WHERE id = :guestId")
    suspend fun byId(guestId: String): GuestEntity?

    @Query("SELECT COUNT(*) FROM guests WHERE eventId = :eventId")
    suspend fun countForEvent(eventId: String): Int

    /**
     * Offline manual search (§8.5).
     *
     * Matches the NORMALISED column, so the caller must normalise the needle
     * with the same NameNormalizer. That is what makes أحمد findable by typing
     * احمد, and a companion findable by their own name rather than only by their
     * party label.
     */
    @Query(
        """
        SELECT * FROM guests
         WHERE eventId = :eventId AND nameNormalized LIKE '%' || :needle || '%'
         ORDER BY fullName ASC
         LIMIT :limit
        """,
    )
    suspend fun searchByName(eventId: String, needle: String, limit: Int = 30): List<GuestEntity>

    @Query("DELETE FROM guests WHERE eventId = :eventId")
    suspend fun deleteForEvent(eventId: String)

    @Query("DELETE FROM guests WHERE id IN (:guestIds)")
    suspend fun deleteByIds(guestIds: List<String>)

    /**
     * The browsable guest list (§8.7), with every filter the spec names, expressed
     * as nullable parameters so one query serves all of them.
     *
     * A single query rather than one per filter: the combinations (VIP + not
     * arrived + one table) are exactly what "has the bride's aunt arrived yet?"
     * turns into, and composing them in Kotlin would mean loading the whole list
     * to filter it in memory.
     *
     * `arrivedFilter`: null = all, 1 = arrived, 0 = not arrived.
     */
    @Query(
        """
        SELECT g.* FROM guests g
          LEFT JOIN parties p ON p.id = g.partyId
         WHERE g.eventId = :eventId
           AND (:category IS NULL OR g.category = :category)
           AND (:tableName IS NULL OR p.tableName = :tableName)
           AND (:needle IS NULL OR g.nameNormalized LIKE '%' || :needle || '%')
           AND (
                :arrivedFilter IS NULL
             OR (:arrivedFilter = 1 AND EXISTS (
                   SELECT 1 FROM check_ins c
                    WHERE c.guestId = g.id AND c.eventId = :eventId AND c.undoneAt IS NULL))
             OR (:arrivedFilter = 0 AND NOT EXISTS (
                   SELECT 1 FROM check_ins c
                    WHERE c.guestId = g.id AND c.eventId = :eventId AND c.undoneAt IS NULL))
           )
         ORDER BY g.fullName ASC
         LIMIT :limit OFFSET :offset
        """,
    )
    suspend fun filteredGuests(
        eventId: String,
        category: String?,
        tableName: String?,
        arrivedFilter: Int?,
        /**
         * Normalised name fragment, or null for no name filter.
         *
         * ── WHY THE LIST NEEDED A SEARCH AT ALL ──
         *
         * The caller asks for 500 rows at offset 0 and the screen has no paging.
         * On a 2,000-guest event that put 1,500 people beyond reach — not merely
         * hard to find, unreachable: the guest list is the ONLY surface in the
         * app that offers undo, so a supervisor could not reverse anyone whose
         * name sorted past the cap.
         *
         * Matches the NORMALISED column, so the caller must normalise with the
         * same NameNormalizer the scanner's manual search uses. That is what
         * makes أحمد findable by typing احمد, and it keeps the two search
         * surfaces answering identically.
         */
        needle: String?,
        limit: Int,
        offset: Int,
    ): List<GuestEntity>

    /**
     * How many guests match the same filters, ignoring the page.
     *
     * The screen needs this to say "showing 500 of 2,100" rather than presenting
     * a truncated list as if it were the whole one.
     */
    @Query(
        """
        SELECT COUNT(*) FROM guests g
          LEFT JOIN parties p ON p.id = g.partyId
         WHERE g.eventId = :eventId
           AND (:category IS NULL OR g.category = :category)
           AND (:tableName IS NULL OR p.tableName = :tableName)
           AND (:needle IS NULL OR g.nameNormalized LIKE '%' || :needle || '%')
           AND (
                :arrivedFilter IS NULL
             OR (:arrivedFilter = 1 AND EXISTS (
                   SELECT 1 FROM check_ins c
                    WHERE c.guestId = g.id AND c.eventId = :eventId AND c.undoneAt IS NULL))
             OR (:arrivedFilter = 0 AND NOT EXISTS (
                   SELECT 1 FROM check_ins c
                    WHERE c.guestId = g.id AND c.eventId = :eventId AND c.undoneAt IS NULL))
           )
        """,
    )
    suspend fun countFilteredGuests(
        eventId: String,
        category: String?,
        tableName: String?,
        arrivedFilter: Int?,
        needle: String?,
    ): Int


    /** Category breakdown for the dashboard (§8.6), arrived vs total. */
    @Query(
        """
        SELECT g.category AS category,
               COUNT(*) AS total,
               SUM(CASE WHEN EXISTS (
                   SELECT 1 FROM check_ins c
                    WHERE c.guestId = g.id AND c.eventId = :eventId AND c.undoneAt IS NULL
               ) THEN 1 ELSE 0 END) AS arrived
          FROM guests g
         WHERE g.eventId = :eventId
         GROUP BY g.category
         ORDER BY total DESC
        """,
    )
    fun observeCategoryBreakdown(eventId: String): Flow<List<CategoryCount>>

    /** Distinct assigned tables, for the by-table filter (§8.7). */
    @Query(
        """
        SELECT DISTINCT p.tableName FROM parties p
         WHERE p.eventId = :eventId AND p.tableName IS NOT NULL
         ORDER BY p.tableName ASC
        """,
    )
    suspend fun distinctTables(eventId: String): List<String>
}

/** Projection for [GuestDao.observeCategoryBreakdown]. */
data class CategoryCount(
    val category: String,
    val total: Int,
    val arrived: Int,
)

/** Projection for the arrivals-over-time chart (§8.6). */
data class ArrivalBucket(
    /** Epoch millis, truncated to the bucket start. */
    val bucketStart: Long,
    val count: Int,
)

/** Projection for per-staff activity (§8.6, supervisor only). */
data class StaffActivity(
    val staffDisplayName: String?,
    val count: Int,
)

@Dao
interface GuestStagingDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(rows: List<GuestStagingEntity>)

    @Query("SELECT * FROM guests_staging WHERE eventId = :eventId")
    suspend fun allForEvent(eventId: String): List<GuestStagingEntity>

    @Query("SELECT COUNT(*) FROM guests_staging WHERE eventId = :eventId")
    suspend fun countForEvent(eventId: String): Int

    /** Highest page fully written — the resume point after an interruption. */
    @Query("SELECT COALESCE(MAX(page), 0) FROM guests_staging WHERE eventId = :eventId")
    suspend fun lastPage(eventId: String): Int

    @Query("DELETE FROM guests_staging WHERE eventId = :eventId")
    suspend fun clearForEvent(eventId: String)
}

@Dao
interface CheckInDao {
    @Upsert
    suspend fun upsert(checkIn: CheckInEntity)

    @Upsert
    suspend fun upsertAll(checkIns: List<CheckInEntity>)

    @Query("SELECT * FROM check_ins WHERE clientCheckinId = :clientCheckinId")
    suspend fun byClientId(clientCheckinId: String): CheckInEntity?

    /**
     * Layer 1 of duplicate prevention (§5.3): the local guard.
     *
     * `undoneAt IS NULL` matters — a reversed admission must not block the guest
     * from being admitted again, or a supervisor's correction locks the door.
     */
    @Query(
        """
        SELECT * FROM check_ins
         WHERE eventId = :eventId AND guestId = :guestId AND undoneAt IS NULL
         LIMIT 1
        """,
    )
    suspend fun liveForGuest(eventId: String, guestId: String): CheckInEntity?

    @Query(
        """
        SELECT guestId FROM check_ins
         WHERE eventId = :eventId AND partyId = :partyId AND undoneAt IS NULL
        """,
    )
    suspend fun liveGuestIdsForParty(eventId: String, partyId: String): List<String>

    @Query("SELECT COUNT(*) FROM check_ins WHERE eventId = :eventId AND undoneAt IS NULL")
    fun observeArrivedCount(eventId: String): Flow<Int>

    /** One-shot arrived count, for screens that read rather than observe. */
    @Query("SELECT COUNT(*) FROM check_ins WHERE eventId = :eventId AND undoneAt IS NULL")
    suspend fun countArrived(eventId: String): Int

    @Query("SELECT * FROM check_ins WHERE eventId = :eventId AND syncState = 'pending' ORDER BY checkedInAt ASC LIMIT :limit")
    suspend fun pending(eventId: String, limit: Int): List<CheckInEntity>

    @Query("SELECT COUNT(*) FROM check_ins WHERE syncState = 'pending'")
    fun observePendingCount(): Flow<Int>

    @Query("UPDATE check_ins SET syncState = :state, serverId = :serverId, serverSeq = :serverSeq, scanToken = NULL WHERE clientCheckinId = :clientCheckinId")
    suspend fun markSynced(clientCheckinId: String, state: String, serverId: String?, serverSeq: Long?)

    @Query("UPDATE check_ins SET syncState = 'conflict' WHERE clientCheckinId = :clientCheckinId")
    suspend fun markConflict(clientCheckinId: String)

    @Query("UPDATE check_ins SET attemptCount = attemptCount + 1, lastError = :error WHERE clientCheckinId = :clientCheckinId")
    suspend fun recordFailure(clientCheckinId: String, error: String?)

    @Query("UPDATE check_ins SET undoneAt = :at, undoReason = :reason WHERE clientCheckinId = :clientCheckinId")
    suspend fun markUndone(clientCheckinId: String, at: Long, reason: String)

    /**
     * One check-in by the SERVER's id — the only key both devices agree on.
     *
     * A delta says "this check-in was reversed" and names it by server id. The
     * row it refers to may be stored here either way round: as `remote:<id>` if
     * another device made it, or under a real client id if THIS device did and
     * has since synced (`markSynced` writes the server id back). Looking it up
     * by the `remote:` key alone therefore finds only half of them — and the
     * half it misses is a device's own admissions, so a tablet went on showing a
     * guest as arrived after the other gate had reversed them, and refused to
     * re-admit them on the Layer 1 duplicate guard.
     */
    @Query("SELECT * FROM check_ins WHERE eventId = :eventId AND serverId = :serverId LIMIT 1")
    suspend fun byServerId(eventId: String, serverId: String): CheckInEntity?

    /**
     * Takes back a local undo the server would not accept.
     *
     * The undo is marked here first and queued second, so the operator sees the
     * reversal immediately — right, and the whole point of an offline-first
     * door. But when the server answers 404 the reversal did NOT happen and
     * cannot: the id names a check-in it has never held (see
     * SyncRepository.drainUndos). Leaving the local mark makes the tablet insist
     * on a reversal that exists only on this device, which is the disagreement
     * with the dashboard that the whole undo path is being fixed for.
     *
     * So the guest goes back to arrived, because that is what is true. The guest
     * list then shows them as arrived with the note that the reversal has to be
     * done from the dashboard, which is the accurate account of what happened.
     */
    @Query("UPDATE check_ins SET undoneAt = NULL, undoReason = NULL WHERE clientCheckinId = :clientCheckinId")
    suspend fun clearUndone(clientCheckinId: String)

    @Query("DELETE FROM check_ins WHERE eventId = :eventId")
    suspend fun deleteForEvent(eventId: String)

    /**
     * Arrivals bucketed into fixed windows (§8.6 "arrivals over time").
     *
     * Bucketing in SQL rather than in Kotlin: a 2000-guest event's check-ins would
     * otherwise all be loaded to be counted, and this screen is refreshed live
     * while a rush is happening.
     *
     * Integer division truncates to the bucket start; :bucketMs is supplied by the
     * caller so the same query serves a 15-minute and an hourly view.
     */
    @Query(
        """
        SELECT (checkedInAt / :bucketMs) * :bucketMs AS bucketStart,
               COUNT(*) AS count
          FROM check_ins
         WHERE eventId = :eventId AND undoneAt IS NULL
         GROUP BY bucketStart
         ORDER BY bucketStart ASC
        """,
    )
    fun observeArrivalBuckets(eventId: String, bucketMs: Long): Flow<List<ArrivalBucket>>

    /** Per-staff activity (§8.6, supervisor-only). */
    @Query(
        """
        SELECT staffDisplayName AS staffDisplayName, COUNT(*) AS count
          FROM check_ins
         WHERE eventId = :eventId AND undoneAt IS NULL
         GROUP BY staffDisplayName
         ORDER BY count DESC
        """,
    )
    fun observeStaffActivity(eventId: String): Flow<List<StaffActivity>>

    /** Reversed admissions, for the audit view (§9.6). Retained, never deleted. */
    @Query(
        """
        SELECT * FROM check_ins
         WHERE eventId = :eventId AND undoneAt IS NOT NULL
         ORDER BY undoneAt DESC
        """,
    )
    fun observeUndone(eventId: String): Flow<List<CheckInEntity>>

    /** Entries the server could not place; surfaced, never dropped (§21.3). */
    @Query(
        """
        SELECT * FROM check_ins
         WHERE eventId = :eventId AND syncState = 'conflict'
         ORDER BY checkedInAt DESC
        """,
    )
    fun observeConflicted(eventId: String): Flow<List<CheckInEntity>>

    /** A guest's live check-in, for the undo flow. */
    @Query(
        """
        SELECT * FROM check_ins
         WHERE eventId = :eventId AND guestId = :guestId AND undoneAt IS NULL
         LIMIT 1
        """,
    )
    suspend fun liveRecordFor(eventId: String, guestId: String): CheckInEntity?

    /**
     * Every live check-in for the event, in one read.
     *
     * The guest list needs one of these per row it renders. Asking per guest
     * meant 500 round trips to an encrypted database on every filter change; the
     * whole set is at most a few thousand small rows and is one query.
     */
    @Query("SELECT * FROM check_ins WHERE eventId = :eventId AND undoneAt IS NULL")
    suspend fun liveForEvent(eventId: String): List<CheckInEntity>
}

@Dao
interface SyncQueueDao {
    @Insert
    suspend fun enqueue(item: SyncQueueEntity): Long

    @Query("SELECT * FROM sync_queue WHERE eventId = :eventId ORDER BY id ASC LIMIT :limit")
    suspend fun peek(eventId: String, limit: Int): List<SyncQueueEntity>

    @Query("SELECT COUNT(*) FROM sync_queue")
    fun observeDepth(): Flow<Int>

    @Query("SELECT COUNT(*) FROM sync_queue WHERE isStalled = 1")
    fun observeStalledCount(): Flow<Int>

    /**
     * The ONLY removal path. Called after the server explicitly confirmed the
     * entry (`accepted` or `duplicate`) — never on a timer, never on age
     * (§21.3).
     */
    @Query("DELETE FROM sync_queue WHERE id IN (:ids)")
    suspend fun confirmAndRemove(ids: List<Long>)

    @Query("UPDATE sync_queue SET attemptCount = attemptCount + 1, lastError = :error, isStalled = (attemptCount + 1 >= 10) WHERE id = :id")
    suspend fun recordFailure(id: Long, error: String?)

    @Query("SELECT COUNT(*) FROM sync_queue WHERE eventId = :eventId")
    suspend fun depthForEvent(eventId: String): Int

    /**
     * Depth EXCLUDING stalled entries — what is still worth sending.
     *
     * The drain reports `Partial` to mean "there is more to send, come straight
     * back", and `SyncQueueWorker` honours that by looping with no delay. Counted
     * with `depthForEvent`, a single permanently-stalled entry makes that true
     * forever and spins the worker against something that can never move.
     */
    @Query("SELECT COUNT(*) FROM sync_queue WHERE eventId = :eventId AND isStalled = 0")
    suspend fun pendingDepthForEvent(eventId: String): Int

    /** Total across every event — what the device-health header reports (§21.7). */
    @Query("SELECT COUNT(*) FROM sync_queue")
    suspend fun totalDepth(): Int

    /**
     * Stalled entries for one event.
     *
     * Counted separately from pending because the remedy differs: a pending entry
     * clears by waiting for a network, a stalled one never will — the server refused
     * it repeatedly and someone has to intervene. Telling a supervisor to "wait for
     * sync" when nothing will ever send is how a tablet gets wiped in frustration.
     */
    @Query("SELECT COUNT(*) FROM sync_queue WHERE eventId = :eventId AND isStalled = 1")
    suspend fun stalledCountForEvent(eventId: String): Int

    /**
     * Entries that hold EVIDENCE EXISTING NOWHERE ELSE — the only thing worth
     * refusing to close, unpair or purge over.
     *
     * ── THE BUG THIS EXISTS FOR ──
     *
     * Three guards (close event, unpair, purge) counted `depthForEvent`, which
     * is every row in the queue. That is right for a check-in: it is the record
     * of somebody admitted at a door on a tablet that may have been offline, and
     * destroying it is the worst outcome in the system.
     *
     * It is wrong for a REVERSAL the server has permanently refused. That entry
     * holds no evidence — the check-in it refers to is already on the server,
     * safe, and what could not be applied is the correction. Yet a single one
     * blocked all three exits at once, and no control anywhere in the app could
     * clear it. The Prepare screen is only reachable through Close Event, so a
     * tablet in that state could not even be re-prepared: the only way out was
     * clearing the app's data, which destroys the very check-ins the guard was
     * protecting. The guard ate what it was guarding.
     *
     * So: every `check_in` entry counts, stalled or not. An `undo` counts only
     * while it can still be sent.
     *
     * Written with an explicit type check rather than `payloadType != 'undo'` so
     * a future payload type is BLOCKING by default. Getting that wrong in the
     * other direction discards data.
     */
    @Query(
        """
        SELECT COUNT(*) FROM sync_queue
         WHERE eventId = :eventId
           AND (payloadType = 'check_in' OR isStalled = 0)
        """,
    )
    suspend fun unsentEvidenceForEvent(eventId: String): Int

    /** The same count across every event, for the unpair guard. */
    @Query("SELECT COUNT(*) FROM sync_queue WHERE payloadType = 'check_in' OR isStalled = 0")
    suspend fun totalUnsentEvidence(): Int

    /*
     * A `discardStalledUndos` delete was drafted here and deliberately dropped.
     *
     * It would have given a supervisor a way to clear a reversal the server had
     * refused. Once SyncRepository.drainUndos takes the local mark back on ANY
     * non-retryable 4xx, there is almost nothing left for it to clear: the only
     * remaining route to a stalled undo is a payload this app itself wrote and
     * can no longer parse.
     *
     * Shipping an unreachable control — especially one whose whole job is to
     * delete queue rows — is worse than not having it. If a stalled undo is ever
     * actually observed in the field, this is the shape the fix takes, and it
     * must stay scoped to `payloadType = 'undo'` in SQL rather than by the
     * caller: §21.3 should not be enforced by whoever writes the next call site.
     */
}

@Dao
interface StaffDao {
    @Upsert
    suspend fun upsertAll(staff: List<StaffEntity>)

    @Query("SELECT * FROM staff WHERE eventId = :eventId ORDER BY displayName ASC")
    fun observeForEvent(eventId: String): Flow<List<StaffEntity>>

    @Query("SELECT * FROM staff WHERE staffId = :staffId")
    suspend fun byId(staffId: String): StaffEntity?

    @Query("UPDATE staff SET failedAttempts = :attempts, lockedUntil = :lockedUntil WHERE staffId = :staffId")
    suspend fun setLockState(staffId: String, attempts: Int, lockedUntil: Long?)

    @Query("UPDATE staff SET pinHash = :pinHash, failedAttempts = 0, lockedUntil = NULL WHERE staffId = :staffId")
    suspend fun setPinHash(staffId: String, pinHash: String)

    @Query("DELETE FROM staff WHERE eventId = :eventId")
    suspend fun deleteForEvent(eventId: String)
}

@Dao
interface VenueTableDao {
    @Upsert
    suspend fun upsertAll(tables: List<VenueTableEntity>)

    @Query("SELECT * FROM venue_tables WHERE eventId = :eventId ORDER BY name ASC")
    suspend fun forEvent(eventId: String): List<VenueTableEntity>

    @Query("DELETE FROM venue_tables WHERE eventId = :eventId")
    suspend fun deleteForEvent(eventId: String)
}

@Dao
interface ConflictDao {
    @Upsert
    suspend fun upsertAll(conflicts: List<ConflictEntity>)

    @Query("SELECT * FROM conflicts WHERE eventId = :eventId AND acknowledgedAt IS NULL")
    fun observeUnacknowledged(eventId: String): Flow<List<ConflictEntity>>

    @Query("DELETE FROM conflicts WHERE eventId = :eventId")
    suspend fun deleteForEvent(eventId: String)
}

/**
 * Cross-table operations that MUST be atomic.
 *
 * Room's @Transaction on an abstract class method is what makes bundle
 * promotion all-or-nothing. Doing this from a repository with separate DAO calls
 * would leave a window where the live guest list is half-replaced — and a
 * half-updated guest list is worse than a stale one (§19.4).
 */
@Dao
abstract class BundleDao {

    @Transaction
    open suspend fun promoteStaging(
        eventId: String,
        parties: List<PartyEntity>,
        guests: List<GuestEntity>,
        tables: List<VenueTableEntity>,
        staff: List<StaffEntity>,
    ) {
        clearParties(eventId)
        clearGuests(eventId)
        clearTables(eventId)
        clearStaff(eventId)
        insertParties(parties)
        insertGuests(guests)
        insertTables(tables)
        insertStaff(staff)
        clearStaging(eventId)
    }

    /**
     * Purge on event close or remote wipe (§20.5).
     *
     * Deliberately does NOT touch sync_queue or check_ins — the caller must
     * verify the queue is empty first, and event close is BLOCKED while it is
     * not. Destroying unsynced check-ins is the single worst outcome in the
     * whole system, so this method is not given the ability to do it.
     */
    @Transaction
    open suspend fun purgeGuestData(eventId: String) {
        clearParties(eventId)
        clearGuests(eventId)
        clearTables(eventId)
        clearStaff(eventId)
        clearStaging(eventId)
        clearConflicts(eventId)
    }

    @Query("DELETE FROM parties WHERE eventId = :eventId")
    protected abstract suspend fun clearParties(eventId: String)

    @Query("DELETE FROM guests WHERE eventId = :eventId")
    protected abstract suspend fun clearGuests(eventId: String)

    @Query("DELETE FROM venue_tables WHERE eventId = :eventId")
    protected abstract suspend fun clearTables(eventId: String)

    @Query("DELETE FROM staff WHERE eventId = :eventId")
    protected abstract suspend fun clearStaff(eventId: String)

    @Query("DELETE FROM guests_staging WHERE eventId = :eventId")
    protected abstract suspend fun clearStaging(eventId: String)

    @Query("DELETE FROM conflicts WHERE eventId = :eventId")
    protected abstract suspend fun clearConflicts(eventId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    protected abstract suspend fun insertParties(parties: List<PartyEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    protected abstract suspend fun insertGuests(guests: List<GuestEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    protected abstract suspend fun insertTables(tables: List<VenueTableEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    protected abstract suspend fun insertStaff(staff: List<StaffEntity>)
}
