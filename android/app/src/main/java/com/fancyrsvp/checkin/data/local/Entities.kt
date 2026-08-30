package com.fancyrsvp.checkin.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room schema for the offline check-in app.
 *
 * Aligned to the REAL backend schema discovered in Phase 0, not to the
 * indicative field list in spec §6.1. The corrections are recorded in
 * docs/Checkin-Spec-Amendments.md (A-1, A-3, A-5) and matter here:
 *
 *   • NO `qr_index` table. The scanned value is a per-PARTY signed JWT wrapped
 *     in a `/ticket/<token>` URL, minted on demand and never persisted, so
 *     there is no stable code string to index. Resolution is: parse the token
 *     payload → read partyId → indexed lookup on `parties`. (A-1)
 *   • NO `parent_guest_id` / `is_companion`. A companion is just another guest
 *     row in the same party with isPrimaryContact = false. There is no
 *     parent/child link between guests on the server. (A-3)
 *   • NO `photo_local_path`. No guest photo exists on any server table, so
 *     modelling one would be an unfunded feature. (A-3)
 *
 * Everything here is durable and encrypted at rest (see CheckinDatabase).
 */

@Entity(tableName = "events")
data class EventEntity(
    @PrimaryKey val id: String,
    val name: String,
    val venue: String?,
    val venueAddress: String?,
    /** Epoch millis. */
    val startsAt: Long,
    /**
     * The event's IANA zone ("America/Los_Angeles"), or null on a row written
     * before this column existed. Null means "unknown" and every reader falls
     * back to the device zone, which is the old behaviour.
     */
    val timezone: String? = null,
    val brandingPrimaryColor: String?,
    /**
     * Where the event's photograph came from. Kept so a re-prepare can tell
     * whether the organizer changed the picture and the cached copy is stale.
     */
    val coverImageUrl: String? = null,
    /**
     * Absolute path to the DOWNLOADED photograph on this device, or null.
     *
     * The path, not the bytes. A wedding cover is routinely 2–5MB and the
     * database is SQLCipher-encrypted — putting it in a row would mean decrypting
     * megabytes to draw one screen, and every query that touches `events` would
     * carry it. The file lives in internal storage and is deleted by the same
     * purge that clears the guest list (§20.5).
     *
     * Non-null means "downloaded and decodable", which is what the UI branches
     * on. It is set only after the file is written and verified, so a half-
     * finished download can never be rendered.
     */
    val coverImagePath: String? = null,
    val noKidsAllowed: Boolean,
    /** Derived server-side as count(guests); denormalised for the counter. */
    val totalInvited: Int,
    /**
     * Guest-data version this device holds (§19.2). Sent as `since_version` on
     * every guest-delta call.
     */
    val bundleVersion: Long,
    /** Highest check-in sequence applied (§17.4). Drives gap detection. */
    val lastAppliedSeq: Long,
    val lastFullSyncAt: Long?,
    /**
     * Set ONLY after a downloaded bundle passes record-count AND content-hash
     * verification and is promoted out of staging (§21.1). A bundle that fails
     * verification must never flip this.
     */
    val isReadyOffline: Boolean,
    // Emergency controls, cached so an offline device retains the last
    // instruction rather than reverting to a default (§21.5).
    val syncDisabled: Boolean = false,
    val realtimeDisabled: Boolean = false,
    val pollingOnly: Boolean = false,
)

/**
 * A party — the unit a QR ticket addresses.
 *
 * This is the table a scan resolves against: the token payload carries
 * `partyId`, and this is a primary-key lookup on it.
 */
@Entity(
    tableName = "parties",
    indices = [Index("eventId")],
)
data class PartyEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val label: String,
    /** Normalised match key for offline search. NEVER shown to a user. */
    val labelNormalized: String,
    /** yes | no | maybe | pending | waitlist */
    val response: String,
    val tableId: String?,
    val tableName: String?,
    val notes: String?,
    val side: String?,
)

@Entity(
    tableName = "guests",
    indices = [
        Index("eventId"),
        Index("partyId"),
        Index("nameNormalized"),
    ],
)
data class GuestEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val partyId: String,
    val fullName: String,
    /**
     * Lowercased, diacritics/hamza/alef folded — computed on ingest by
     * NameNormalizer, which mirrors the server's normalizeNameForSearch.
     * Indexed because §11 requires manual search under 300 ms on a
     * 2000-guest event.
     */
    val nameNormalized: String,
    val isPrimaryContact: Boolean,
    /** `vip` is the reserved value that triggers the premium welcome (§8.4). */
    val category: String,
    val mealSelection: String?,
    val dietaryNotes: String?,
)

/**
 * Staging table for a bundle download in flight (§21.1).
 *
 * Pages land here and are promoted into `guests` in a single transaction only
 * after verification passes. An interrupted download therefore can never leave
 * the live guest list partially populated — which is the failure that presents
 * as a working app holding 60% of a guest list.
 */
@Entity(
    tableName = "guests_staging",
    indices = [Index("eventId")],
)
data class GuestStagingEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val partyId: String,
    val partyLabel: String?,
    val fullName: String,
    val isPrimaryContact: Boolean,
    val category: String,
    val response: String,
    val tableId: String?,
    val tableName: String?,
    val mealSelection: String?,
    val dietaryNotes: String?,
    val partyNotes: String?,
    val side: String?,
    /** Which bundle page this row arrived on, so a resume can skip it. */
    val page: Int,
)

@Entity(
    tableName = "check_ins",
    indices = [
        Index("eventId"),
        Index("guestId"),
        Index("syncState"),
    ],
)
data class CheckInEntity(
    /** Device-generated UUID — the idempotency key (§5.4). */
    @PrimaryKey val clientCheckinId: String,
    val eventId: String,
    val guestId: String,
    val partyId: String,
    /** Device clock at scan time. The server records its own receipt time too. */
    val checkedInAt: Long,
    val staffId: String?,
    val staffDisplayName: String?,
    val deviceId: String?,
    val deviceLabel: String?,
    /** qr_scan | manual_search | self_service | group | override */
    val method: String,
    /**
     * The raw scanned token, held ONLY until this row syncs.
     *
     * Decision D-20 removed on-device signature verification, so the server is
     * the only place a forged scan can be detected (amendment A-11) — it needs
     * the token to do that. Cleared on successful sync so a live bearer
     * credential does not sit on a hired tablet indefinitely.
     */
    val scanToken: String?,
    /** pending | synced | conflict | stalled */
    val syncState: String,
    val serverId: String?,
    val serverSeq: Long?,
    /** True when received from another device rather than created here. */
    val isRemote: Boolean,
    /** Set locally when a supervisor reverses this admission. */
    val undoneAt: Long? = null,
    val undoReason: String? = null,
    val attemptCount: Int = 0,
    val lastError: String? = null,
)

/**
 * Outbound queue (§21.3).
 *
 * Nothing is ever removed on a time basis — only after the server explicitly
 * confirms it (`accepted` or `duplicate`). A queued check-in exists ONLY on
 * this device, so dropping one is permanent data loss.
 */
@Entity(tableName = "sync_queue")
data class SyncQueueEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** check_in | undo */
    val payloadType: String,
    val payloadJson: String,
    val eventId: String,
    val createdAt: Long,
    val attemptCount: Int = 0,
    val lastError: String? = null,
    /** Set after 10 consecutive failures; surfaced to the supervisor, never dropped. */
    val isStalled: Boolean = false,
)

/**
 * Cached staff roster for offline PIN login (§18.5).
 *
 * pinHash is a server-issued PBKDF2-SHA512 `salt:hash` string. A plaintext PIN
 * is never stored or transmitted.
 */
@Entity(
    tableName = "staff",
    indices = [Index("eventId")],
)
data class StaffEntity(
    @PrimaryKey val staffId: String,
    val eventId: String,
    val displayName: String,
    /** usher | supervisor */
    val role: String,
    val pinHash: String,
    /** Epoch millis until which this staff entry is locked on THIS device. */
    val lockedUntil: Long? = null,
    val failedAttempts: Int = 0,
)

/**
 * The venue layout — every element the organizer drew, tables AND zones.
 *
 * ── What this used to be, and why it was dead ──
 *
 * `id, name, capacity`, filtered server-side to `element_type = 'table'`. It was
 * written on every prepare and read by nothing: a table's NAME already rides on
 * each guest row, so the list carried no information any screen needed. The
 * seating plan on the scan result is the first thing that uses it, and a plan
 * needs the room — the stage, the dance floor, and above all the entrance,
 * which is the element an usher actually points at.
 *
 * ── Geometry, and the one trap in it ──
 *
 * [positionX] / [positionY] are PERCENTAGES of a fixed 2600 x 1700 logical
 * world, addressing the element's **top-left corner** — never its centre. See
 * VenueTableDto and `ui/seating/SeatingGeometry.kt`, which is the only place
 * allowed to convert between the two.
 *
 * Every geometry column is NULLABLE, and deliberately so. A row written before
 * these columns existed reads as null everywhere, which every consumer already
 * treats as "this event has no plan" — so an upgraded tablet that has not
 * re-prepared shows the table numeral alone, exactly as it does today, instead
 * of drawing a room at the origin. It also keeps MIGRATION_3_4 to bare
 * `ALTER TABLE ... ADD COLUMN` with no DEFAULT clause, which is the only shape
 * of migration that cannot fail Room's schema validation (see MIGRATION_1_2).
 */
@Entity(
    tableName = "venue_tables",
    indices = [Index("eventId")],
)
data class VenueTableEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val name: String,
    val capacity: Int?,
    /** table | zone. Null on a pre-migration row; the shape's category covers it. */
    val elementType: String? = null,
    /** Catalogue key. Unknown values degrade to a round table, never to a crash. */
    val shape: String? = null,
    val positionX: Double? = null,
    val positionY: Double? = null,
    /** Honoured for zones only. Null means "use the catalogue's size". */
    val width: Double? = null,
    val height: Double? = null,
    val rotation: Double? = null,
    val color: String? = null,
)

/**
 * Conflicts reported by the server on sync (§5.3 Layer 4), kept locally so a
 * supervisor can see them at the venue without connectivity.
 */
@Entity(tableName = "conflicts")
data class ConflictEntity(
    @PrimaryKey val clientCheckinId: String,
    val eventId: String,
    val guestId: String,
    val winningStaffName: String?,
    val winningDeviceLabel: String?,
    val winningCheckedInAt: Long?,
    val detectedAt: Long,
    val acknowledgedAt: Long? = null,
)
