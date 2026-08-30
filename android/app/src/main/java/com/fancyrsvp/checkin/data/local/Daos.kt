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
     */
    @Query("SELECT * FROM events ORDER BY isReadyOffline DESC, startsAt ASC LIMIT 1")
    suspend fun readyEvent(): EventEntity?

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

    @Query("UPDATE events SET isReadyOffline = 0, lastFullSyncAt = NULL WHERE id = :eventId")
    suspend fun markNotReady(eventId: String)

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
        limit: Int,
        offset: Int,
    ): List<GuestEntity>

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
