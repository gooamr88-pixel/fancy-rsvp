package com.fancyrsvp.checkin.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire models for the check-in API.
 *
 * Field names are pinned with @SerialName against the ACTUAL backend responses,
 * not inferred from a convention. The backend mixes cases deliberately in one
 * place — the batch endpoint returns camelCase envelope fields (`maxSeq`) around
 * snake_case per-record results (`client_checkin_id`), because the records come
 * straight out of a Postgres RPC. Guessing either way would fail at runtime with
 * silently-null fields rather than a parse error, so every name is explicit.
 *
 * Parsing is TOLERANT by design (§21.4): unknown fields are ignored, never
 * fatal, so a backend that adds a field cannot break a tablet already in the
 * field. That is configured on the Json instance in NetworkModule.
 */

/** The platform's standard response envelope: {success, data, meta}. */
@Serializable
data class Envelope<T>(
    val success: Boolean = false,
    val data: T? = null,
    val meta: SyncMeta? = null,
    val error: String? = null,
    val message: String? = null,
)

/**
 * Version and control metadata attached to every sync response (§21.4, §21.5).
 *
 * `minSupportedAppVersion` must only ever be acted on during PREPARATION. A
 * device already at a venue keeps operating regardless — blocking it there is
 * the one thing §21.4 forbids outright.
 */
@Serializable
data class SyncMeta(
    @SerialName("min_supported_app_version") val minSupportedAppVersion: String? = null,
    @SerialName("api_contract_version") val apiContractVersion: Int? = null,
    @SerialName("server_time") val serverTime: String? = null,
    @SerialName("max_batch") val maxBatch: Int? = null,
    @SerialName("wipe_required") val wipeRequired: Boolean? = null,
)

// ══════════════════════════════════════════════════════════════════
// Device pairing (§18.3, §18.4)
// ══════════════════════════════════════════════════════════════════

@Serializable
data class PairRequest(
    val code: String,
    val fingerprint: DeviceFingerprint,
    val appVersion: String,
)

/** Support triage only — model, OS, install id. Contains no personal data. */
@Serializable
data class DeviceFingerprint(
    val model: String,
    val manufacturer: String,
    val osVersion: String,
    val installId: String,
)

@Serializable
data class PairResponse(
    val deviceId: String,
    val eventId: String,
    val deviceLabel: String,
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAt: String? = null,
    val refreshExpiresAt: String? = null,
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RefreshResponse(
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAt: String? = null,
)

// ══════════════════════════════════════════════════════════════════
// Event list and bundle (§7, §21.1)
// ══════════════════════════════════════════════════════════════════

@Serializable
data class EventListResponse(val events: List<EventSummaryDto> = emptyList())

@Serializable
data class EventSummaryDto(
    val id: String,
    val name: String,
    val venue: String? = null,
    val startsAt: String? = null,
    val timezone: String? = null,
    val status: String? = null,
    val isPaid: Boolean = false,
    val tierName: String? = null,
)

@Serializable
data class BundleManifestDto(
    val event: BundleEventDto,
    val staff: List<StaffDto> = emptyList(),
    val tables: List<VenueTableDto> = emptyList(),
    /**
     * Arrivals already recorded before this device was armed (§7).
     *
     * Seeded into the local check_ins table so the Layer 1 duplicate guard
     * (§5.3) is correct from the FIRST scan. Without it a freshly-prepared
     * device does not know who came in through the web kiosk, and would admit an
     * already-arrived guest with no warning.
     */
    val existingCheckIns: List<ExistingCheckInDto> = emptyList(),
    val integrity: BundleIntegrityDto,
    val bundleVersion: Long = 0,
    val lastSeq: Long = 0,
    val generatedAt: String? = null,
)

@Serializable
data class ExistingCheckInDto(
    /**
     * The check-in's SERVER id, and the only handle the device has for it.
     *
     * A seeded arrival is rebuilt locally under an invented `seed:` key, so
     * without this the device holds nothing the server can resolve and the
     * arrival can never be reversed from the door — it 404s and the guest stays
     * counted as present. Nullable because a server that predates this field
     * simply does not send it, and a tablet in the field must still arm.
     */
    val serverId: String? = null,
    val guestId: String,
    val partyId: String? = null,
    val checkedInAt: String? = null,
    val method: String? = null,
    val serverSeq: Long? = null,
    val staffName: String? = null,
    val deviceLabel: String? = null,
)

@Serializable
data class BundleEventDto(
    val id: String,
    val name: String,
    val startsAt: String? = null,
    val timezone: String? = null,
    val venue: String? = null,
    val venueAddress: String? = null,
    val brandingPrimaryColor: String? = null,
    /**
     * Absolute http(s) URL of the event's own photograph — the couple, on a
     * wedding (§9.8). The same image the invitation uses.
     *
     * Null whenever the organizer never set one, which is normal and must render
     * as the plain themed screens rather than as a gap.
     */
    val coverImageUrl: String? = null,
    val noKidsAllowed: Boolean = false,
)

/**
 * The figures a device must verify a downloaded guest list against before it may
 * mark an event ready offline (§21.1). Without these, an interrupted download
 * presents as a working app holding a partial guest list.
 */
@Serializable
data class BundleIntegrityDto(
    val recordCount: Int,
    val contentHash: String,
    val pageSize: Int,
    val totalPages: Int,
)

@Serializable
data class StaffDto(
    val staffId: String,
    val displayName: String,
    val role: String,
    /** Server-issued PBKDF2 "salt:hash". A plaintext PIN never crosses the wire. */
    val pinHash: String,
)

/**
 * One element of the venue layout — a seatable table OR a zone.
 *
 * ── The coordinate convention, which is the whole trap ──
 *
 * [positionX] / [positionY] are PERCENTAGES (0–100) of a fixed logical world of
 * 2600 x 1700 units, and they address the element's **top-left corner**. They
 * are not a centre. Reading them as one does not shift the layout, it scrambles
 * it: every element moves by half of ITS OWN size, and sizes differ per shape,
 * so a 96-unit round table and a 360-unit stage land on top of each other.
 * `ui/seating/SeatingGeometry.kt` is the only place that converts, and every
 * consumer goes through it.
 *
 * [width] / [height] are honoured for ZONES only; a table always takes its size
 * from the shape catalogue. Null means "not set" — which for a zone means "use
 * the catalogue's size", a distinction a 0 would destroy, so the server sends
 * null rather than defaulting.
 *
 * Every field after [capacity] is nullable with a default because a tablet in
 * the field parses a bundle from whatever backend it can reach: an older server
 * simply sends the three original keys, and the device draws no plan rather
 * than failing to arm.
 */
@Serializable
data class VenueTableDto(
    val id: String,
    val name: String,
    val capacity: Int? = null,
    /** table | zone. Authoritative when present; the shape's category covers old rows. */
    val elementType: String? = null,
    /**
     * The catalogue key — `round`, `stage`, `dance_floor`… It is deliberately
     * NOT an enum on the wire. The catalogue is edited on the web side, and a
     * value this build has never heard of must degrade to a round table rather
     * than fail the whole manifest to parse (§21.4).
     */
    val shape: String? = null,
    val positionX: Double? = null,
    val positionY: Double? = null,
    val width: Double? = null,
    val height: Double? = null,
    val rotation: Double? = null,
    /** The organizer's own colour for a zone, `#RRGGBB`, or null for the catalogue's. */
    val color: String? = null,
)

@Serializable
data class BundlePageDto(
    val guests: List<BundleGuestDto> = emptyList(),
    val pagination: PaginationDto,
    val pageHash: String? = null,
)

@Serializable
data class PaginationDto(
    val page: Int,
    val limit: Int,
    val total: Int,
    val totalPages: Int,
    val hasMore: Boolean,
)

@Serializable
data class BundleGuestDto(
    val id: String,
    val partyId: String,
    val partyLabel: String? = null,
    val fullName: String,
    val isPrimaryContact: Boolean = false,
    val category: String = "standard",
    val response: String = "pending",
    val tableId: String? = null,
    val tableName: String? = null,
    val mealSelection: String? = null,
    val dietaryNotes: String? = null,
    val partyNotes: String? = null,
    val side: String? = null,
    /** Present on guest-delta rows; absent in a full bundle page. */
    val checkedIn: Boolean? = null,
)

// ══════════════════════════════════════════════════════════════════
// Check-in batch (§7)
// ══════════════════════════════════════════════════════════════════

@Serializable
data class CheckInBatchRequest(
    val records: List<CheckInRecordDto>,
    /**
     * Where this device is in the check-in stream (amendment A-15).
     *
     * Sending it asks the server to return the delta inline. Without it the
     * response carries no delta and the device falls back to its poll timer —
     * which still works, because §17.1 keeps polling as the correctness baseline.
     */
    @SerialName("since_seq") val sinceSeq: Long? = null,
)

/**
 * One queued check-in. Snake_case because the backend reads these keys directly
 * off req.body.records before handing them to the Postgres RPC.
 */
@Serializable
data class CheckInRecordDto(
    @SerialName("client_checkin_id") val clientCheckinId: String,
    @SerialName("guest_id") val guestId: String,
    /** ISO-8601. The device clock; the server records its own receipt time too. */
    @SerialName("checked_in_at") val checkedInAt: String,
    val method: String,
    @SerialName("staff_id") val staffId: String? = null,
    @SerialName("staff_display_name") val staffDisplayName: String? = null,
    @SerialName("device_id") val deviceId: String? = null,
    @SerialName("device_label") val deviceLabel: String? = null,
    /**
     * The raw scanned token, for `qr_scan` records only.
     *
     * Decision D-20 removed on-device signature verification, so the server is
     * the only place a forged scan can be detected (amendment A-11) — and it
     * needs the token to do it. The server stores a fingerprint, never the token.
     */
    @SerialName("scan_token") val scanToken: String? = null,
)

@Serializable
data class CheckInBatchResponse(
    val results: List<CheckInResultDto> = emptyList(),
    val summary: BatchSummaryDto? = null,
    val maxSeq: Long? = null,
    /**
     * Changes made by OTHER devices since the `since_seq` sent with the request
     * (amendment A-15).
     *
     * Part of the documented schema, not an optional extra. Null only when the
     * request omitted `since_seq`, or when the server could not build the delta —
     * in which case the poll timer covers it.
     */
    val delta: InlineDeltaDto? = null,
)

@Serializable
data class InlineDeltaDto(
    val changes: List<CheckInChangeDto> = emptyList(),
    val maxSeq: Long = 0,
    /** True when more remains; fetch again rather than assuming caught up. */
    val truncated: Boolean = false,
)

@Serializable
data class CheckInResultDto(
    @SerialName("client_checkin_id") val clientCheckinId: String? = null,
    @SerialName("guest_id") val guestId: String? = null,
    /** accepted | duplicate | conflict | rejected */
    val status: String,
    @SerialName("server_id") val serverId: String? = null,
    @SerialName("server_seq") val serverSeq: Long? = null,
    /** Set on `duplicate` when the check-in was subsequently undone. */
    val undone: Boolean? = null,
    /** Set on `rejected`: MALFORMED_RECORD | GUEST_NOT_IN_EVENT. */
    val reason: String? = null,
    val winning: ConflictWinnerDto? = null,
)

@Serializable
data class ConflictWinnerDto(
    @SerialName("staff_name") val staffName: String? = null,
    @SerialName("device_label") val deviceLabel: String? = null,
    @SerialName("checked_in_at") val checkedInAt: String? = null,
)

@Serializable
data class BatchSummaryDto(
    val accepted: Int = 0,
    val duplicate: Int = 0,
    val conflict: Int = 0,
    val rejected: Int = 0,
)

// ══════════════════════════════════════════════════════════════════
// Deltas (§17.5, §19.4)
// ══════════════════════════════════════════════════════════════════

@Serializable
data class CheckInDeltaResponse(
    val changes: List<CheckInChangeDto> = emptyList(),
    val maxSeq: Long = 0,
    val bundleVersion: Long = 0,
    /** True when more remains; fetch again from maxSeq rather than assuming caught up. */
    val truncated: Boolean = false,
)

@Serializable
data class CheckInChangeDto(
    /** check_in | check_in_undone */
    val type: String,
    val serverId: String? = null,
    val guestId: String,
    val partyId: String? = null,
    val checkedInAt: String? = null,
    val method: String? = null,
    val serverSeq: Long = 0,
    val staffName: String? = null,
    val deviceLabel: String? = null,
    val tokenVerified: Boolean? = null,
)

@Serializable
data class GuestDeltaResponse(
    val fromVersion: Long = 0,
    val toVersion: Long = 0,
    /**
     * When true the device MUST perform a full bundle download and must not
     * attempt to reconcile — a half-updated guest list is worse than a stale one
     * (§19.4).
     */
    val requiresFullResync: Boolean = false,
    /** VERSION_TOO_OLD | NO_BASELINE | CHANGE_VOLUME */
    val reason: String? = null,
    val changedCount: Int = 0,
    val upserts: List<BundleGuestDto> = emptyList(),
    val removedGuestIds: List<String> = emptyList(),
)

// ══════════════════════════════════════════════════════════════════
// Emergency controls (§21.5)
// ══════════════════════════════════════════════════════════════════

@Serializable
data class SyncControlsDto(
    val syncDisabled: Boolean = false,
    val realtimeDisabled: Boolean = false,
    val pollingOnly: Boolean = false,
)

@Serializable
/**
 * An undo carries the acting supervisor's id. The device token proves only that
 * the tablet is paired, so the server checks this id against the event roster
 * before allowing the reversal — the on-screen role check in `GuestListScreen`
 * is a convenience, not the gate (§18.2).
 */
data class UndoRequest(
    val reason: String,
    val staffId: String?,
    /**
     * Which check-in, by the server's own id — sent whenever the device knows it.
     *
     * The URL still carries the `client_checkin_id`, and for a check-in this
     * device created that is enough. For every other arrival it holds — seeded
     * at preparation, or received from another gate — the id in the URL is one
     * the device invented and the server has never held, so this is the only
     * reference that can resolve. The server prefers it when present
     * (`checkin_undo_by_ref`).
     */
    val serverId: String? = null,
)

@Serializable
data class UndoResponse(
    val serverId: String? = null,
    val alreadyUndone: Boolean = false,
    val serverSeq: Long? = null,
)
