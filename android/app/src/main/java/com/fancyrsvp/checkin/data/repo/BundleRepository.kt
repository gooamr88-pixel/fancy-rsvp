package com.fancyrsvp.checkin.data.repo

import com.fancyrsvp.checkin.BuildConfig
import com.fancyrsvp.checkin.data.local.CheckInEntity
import com.fancyrsvp.checkin.data.local.CheckinDatabase
import com.fancyrsvp.checkin.data.local.EventEntity
import com.fancyrsvp.checkin.data.local.GuestEntity
import com.fancyrsvp.checkin.data.local.GuestStagingEntity
import com.fancyrsvp.checkin.data.local.PartyEntity
import com.fancyrsvp.checkin.data.local.StaffEntity
import com.fancyrsvp.checkin.data.local.VenueTableEntity
import com.fancyrsvp.checkin.data.remote.BundleGuestDto
import com.fancyrsvp.checkin.data.remote.BundleManifestDto
import com.fancyrsvp.checkin.data.remote.CheckinApi
import com.fancyrsvp.checkin.util.BundleIntegrity
import com.fancyrsvp.checkin.util.NameNormalizer
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Offline preparation: download a guest list, PROVE it is complete, then arm the
 * event (spec §5.2 Stage 1, §21.1).
 *
 * ── The failure this class exists to prevent ──
 *
 * A bundle download interrupted at 60% leaves an app that believes it holds a
 * complete guest list. It looks like a working app. Nobody discovers otherwise
 * until guests are being told "not found" at a venue with no internet to fix it.
 *
 * The defence is a four-step sequence, and skipping any step reintroduces the
 * failure:
 *
 *   1. Fetch the manifest first — it carries recordCount and contentHash.
 *   2. Page guests into a STAGING table, never into the live one.
 *   3. Verify the full staged set against both figures.
 *   4. Promote staging → live in a single transaction, and only then set
 *      isReadyOffline.
 *
 * A partially valid bundle is never accepted. On any verification failure the
 * staged data is discarded entirely and the previous state is left untouched, so
 * a failed refresh cannot destroy a bundle that was already good.
 */
@Singleton
class BundleRepository @Inject constructor(
    private val api: CheckinApi,
    private val db: CheckinDatabase,
    private val secureStore: com.fancyrsvp.checkin.data.security.SecureStore,
    private val eventImages: com.fancyrsvp.checkin.data.media.EventImageStore,
    private val io: CoroutineDispatcher,
) {

    /** Progress for the preparation screen — real counts, never a spinner (§8.2). */
    sealed interface Progress {
        data object FetchingManifest : Progress
        data class Downloading(val downloaded: Int, val total: Int, val page: Int, val totalPages: Int) : Progress
        data object Verifying : Progress

        /**
         * Fetching the event's photograph (§9.8).
         *
         * Its own state rather than part of [Promoting], because it is the one
         * phase whose duration depends on a file of unknown size over the
         * office's wifi. Folded into "Promoting" — which is otherwise a database
         * transaction measured in milliseconds — a slow 5MB download presents as
         * a frozen progress panel, and an operator who thinks preparation has
         * hung will kill the app in the middle of it.
         */
        data object FetchingArtwork : Progress
        data object Promoting : Progress
        data class Done(val recordCount: Int) : Progress
        data class Failed(val reason: Failure) : Progress
    }

    /**
     * Why preparation failed, in terms the UI can act on.
     *
     * Distinguished rather than collapsed into one error because they need
     * different words in front of an operator: "no internet" is retryable now,
     * "not on your plan" is not, and "the download was incomplete" must never be
     * presented as success.
     */
    sealed interface Failure {
        data object Offline : Failure
        data object NotAuthorised : Failure
        data object FeatureNotAvailable : Failure
        data class Incomplete(val expected: Int, val actual: Int) : Failure
        data class Corrupted(val expectedHash: String, val actualHash: String) : Failure

        /**
         * Not enough room on the device (§21.9).
         *
         * Raised BEFORE any transfer starts, so no partial bundle is ever written —
         * running out of space mid-download is precisely the silent failure §21.1
         * exists to prevent.
         */
        data class NoStorage(val guestCount: Int) : Failure
        data class Server(val code: Int, val error: String?) : Failure
        data class Unknown(val message: String?) : Failure

        /**
         * This build is older than the server will support (§21.4).
         *
         * ── WHY THIS IS RAISED HERE AND ONLY HERE ──
         *
         * Every sync response carries `meta.min_supported_app_version`, and
         * nothing read it. The single access to `meta` anywhere in the app was
         * an empty lambda with a comment saying it was "acted on at
         * preparation" — it was not acted on anywhere. An operator could arm a
         * tablet the server had already declared too old and find out at a
         * venue, which is the one thing §21.4 forbids.
         *
         * Preparation is the ONLY correct place to act on it: it happens in an
         * office, with internet, hours before anyone arrives, and it is the last
         * moment at which installing an update costs nothing. A device already
         * at a door must keep working regardless of its version — refusing to
         * scan because of a version number is a worse failure than any bug the
         * new build fixes.
         */
        data class AppTooOld(val installed: String, val required: String) : Failure
    }

    /**
     * Compares two dotted version strings numerically.
     *
     * String comparison is wrong in the way that matters: "1.10.0" < "1.9.0"
     * lexicographically, so the first two-digit minor release would lock every
     * tablet in the field out of preparation. Missing segments read as 0, and a
     * non-numeric segment reads as 0 rather than throwing — a version this build
     * cannot parse must not become a refusal to arm.
     */
    private fun isVersionBelow(installed: String, required: String): Boolean {
        val a = installed.split('.').map { it.toIntOrNull() ?: 0 }
        val b = required.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x < y
        }
        return false
    }

    fun observeEvents(): Flow<List<EventEntity>> = db.eventDao().observeAll()

    /** Outcome of a refresh, so the screen can say WHY it is empty. */
    sealed interface EventsRefresh {
        data class Ok(val count: Int) : EventsRefresh
        data object NotPaired : EventsRefresh
        data object Offline : EventsRefresh
        data class Failed(val message: String) : EventsRefresh
    }

    /**
     * Loads the event this device is provisioned for (§8.2).
     *
     * ── Why this does NOT list events ──
     *
     * `GET /checkin/events` is behind `requireAuth` — an ORGANIZER session. A
     * device token can never satisfy it, so calling it from the tablet returns
     * 401 no matter what credential is attached. That is not a bug in the
     * backend: listing every event an organizer owns is a dashboard concern, and
     * a tablet has no business enumerating events it was not provisioned for.
     *
     * A device is paired to exactly one gate on exactly one event (§18.3), and
     * the id is stored at pairing time. So there is nothing to choose between —
     * the screen shows the one event this tablet exists to serve, fetched through
     * the manifest endpoint, which IS device-accessible.
     *
     * An existing row gets a metadata-only update (see EventDao.updateSummary),
     * so refreshing can never disarm an event that is already downloaded.
     */
    suspend fun refreshEvents(): EventsRefresh = withContext(io) {
        val eventId = secureStore.pairedEventId
            ?: return@withContext EventsRefresh.NotPaired

        try {
            val response = api.bundleManifest(eventId)
            if (!response.isSuccessful) {
                return@withContext EventsRefresh.Failed(
                    "HTTP ${response.code()} ${response.errorBody()?.string()?.take(120) ?: ""}".trim(),
                )
            }

            val manifest = response.body()?.data
                ?: return@withContext EventsRefresh.Failed("Empty response from the server.")

            val dto = manifest.event
            val startsAt = dto.startsAt?.toEpochMillisOrNull() ?: 0L

            if (db.eventDao().byId(dto.id) != null) {
                db.eventDao().updateSummary(dto.id, dto.name, dto.venue, startsAt, dto.timezone)
            } else {
                db.eventDao().upsert(
                    EventEntity(
                        id = dto.id,
                        name = dto.name,
                        venue = dto.venue,
                        venueAddress = dto.venueAddress,
                        startsAt = startsAt,
                        timezone = dto.timezone,
                        brandingPrimaryColor = dto.brandingPrimaryColor,
                        // URL only. The file is fetched during preparation, not
                        // here — a refresh is a metadata poll that may run
                        // repeatedly, and it must not pull megabytes each time.
                        coverImageUrl = dto.coverImageUrl,
                        coverImagePath = null,
                        noKidsAllowed = dto.noKidsAllowed,
                        // The real figure, from the manifest the download will be
                        // verified against (§21.1). It also drives the pre-download
                        // storage check, so a placeholder here would break §21.9.
                        totalInvited = manifest.integrity.recordCount,
                        bundleVersion = manifest.bundleVersion,
                        lastAppliedSeq = 0L,
                        // NOT ready: the guest list has not been downloaded yet.
                        // Only a verified, promoted bundle may set these (§21.1).
                        lastFullSyncAt = null,
                        isReadyOffline = false,
                    ),
                )
            }
            EventsRefresh.Ok(1)
        } catch (_: java.io.IOException) {
            EventsRefresh.Offline
        } catch (t: Throwable) {
            // Throwable: a device that cannot load its event must say so on the
            // screen rather than disappear.
            EventsRefresh.Failed("${t.javaClass.simpleName}: ${t.message ?: "no message"}")
        }
    }

    private fun String.toEpochMillisOrNull(): Long? =
        runCatching { java.time.Instant.parse(this).toEpochMilli() }.getOrNull()

    fun observeEvent(eventId: String): Flow<EventEntity?> = db.eventDao().observe(eventId)

    /**
     * Downloads and arms an event. Emits progress; the caller renders it.
     *
     * Resumable: staged pages already written are skipped, so an interrupted
     * download continues rather than restarting. Page ordering is stable
     * server-side (ordered by guest id), which is what makes that safe.
     */
    suspend fun prepareEvent(
        eventId: String,
        forceRestart: Boolean = false,
        onProgress: suspend (Progress) -> Unit = {},
    ): Progress = withContext(io) {
        try {
            onProgress(Progress.FetchingManifest)

            val manifestResponse = api.bundleManifest(eventId)
            if (!manifestResponse.isSuccessful) {
                return@withContext fail(manifestResponse.code(), manifestResponse.errorBody()?.string(), onProgress)
            }
            val manifest = manifestResponse.body()?.data
                ?: return@withContext failWith(Failure.Unknown("Manifest response had no data"), onProgress)

            /*
             * The version gate, acted on for the first time.
             *
             * `meta.min_supported_app_version` rides on every sync response and
             * was read by nothing — see Failure.AppTooOld. Checked HERE, at
             * preparation, and deliberately nowhere else: this is an office with
             * internet hours before the event, and it is the last moment at
             * which updating costs nothing. A tablet already at a door keeps
             * working whatever its version.
             *
             * A missing or unparseable value is not a refusal. An older server
             * simply does not send it, and a tablet that cannot arm because it
             * failed to understand a version string is a worse outcome than one
             * running a build that is merely behind.
             */
            val minVersion = manifestResponse.body()?.meta?.minSupportedAppVersion
            if (!minVersion.isNullOrBlank() &&
                isVersionBelow(BuildConfig.VERSION_NAME, minVersion)
            ) {
                return@withContext failWith(
                    Failure.AppTooOld(BuildConfig.VERSION_NAME, minVersion),
                    onProgress,
                )
            }

            val staging = db.guestStagingDao()

            // A changed bundle version invalidates a partial download: resuming
            // across versions would mix rows from two different guest lists, and
            // the hash would fail anyway — but only after wasting the transfer.
            val existing = db.eventDao().byId(eventId)
            val versionChanged = existing != null && existing.bundleVersion != manifest.bundleVersion
            if (forceRestart || versionChanged) {
                staging.clearForEvent(eventId)
            }

            val resumeFrom = staging.lastPage(eventId)
            val totalPages = manifest.integrity.totalPages.coerceAtLeast(1)
            val pageSize = manifest.integrity.pageSize.coerceAtLeast(1)

            for (page in (resumeFrom + 1)..totalPages) {
                val pageResponse = api.bundlePage(eventId, page, pageSize)
                if (!pageResponse.isSuccessful) {
                    // Staged pages are deliberately LEFT IN PLACE so the next
                    // attempt resumes. Nothing live has been touched yet.
                    return@withContext fail(pageResponse.code(), pageResponse.errorBody()?.string(), onProgress)
                }
                val body = pageResponse.body()?.data
                    ?: return@withContext failWith(Failure.Unknown("Bundle page $page had no data"), onProgress)

                staging.insertAll(body.guests.map { it.toStaging(eventId, page) })

                onProgress(
                    Progress.Downloading(
                        downloaded = staging.countForEvent(eventId),
                        total = manifest.integrity.recordCount,
                        page = page,
                        totalPages = totalPages,
                    ),
                )
            }

            onProgress(Progress.Verifying)

            val staged = staging.allForEvent(eventId)
            val hashable = staged.map {
                BundleIntegrity.HashableGuest(
                    id = it.id,
                    partyId = it.partyId,
                    fullName = it.fullName,
                    tableName = it.tableName,
                    category = it.category,
                )
            }

            when (
                val verdict = BundleIntegrity.verify(
                    hashable,
                    manifest.integrity.recordCount,
                    manifest.integrity.contentHash,
                )
            ) {
                is BundleIntegrity.Verification.CountMismatch -> {
                    // Discard EVERYTHING. A partially valid bundle is never
                    // acceptable, and keeping it would let a later resume believe
                    // it was complete.
                    staging.clearForEvent(eventId)
                    return@withContext failWith(
                        Failure.Incomplete(verdict.expected, verdict.actual),
                        onProgress,
                    )
                }
                is BundleIntegrity.Verification.HashMismatch -> {
                    staging.clearForEvent(eventId)
                    return@withContext failWith(
                        Failure.Corrupted(verdict.expected, verdict.actual),
                        onProgress,
                    )
                }
                BundleIntegrity.Verification.Valid -> Unit
            }

            /*
             * The event's photograph, fetched while there is still internet
             * (§9.8).
             *
             * Here rather than at first display, because first display is at a
             * venue with no connectivity. This is the last moment the app is
             * guaranteed to be online for this event.
             *
             * Deliberately NOT part of the integrity contract: it is downloaded
             * after verification has already passed, and a failure returns null
             * instead of throwing. A tablet with a complete, verified guest list
             * and no picture is armed and correct; refusing to arm it over a
             * decorative asset would be the wrong trade at 14:00 on the day.
             *
             * Announced only when there is actually something to fetch, so an
             * event with no photograph does not flash a phase that does no work.
             */
            val coverPath = manifest.event.coverImageUrl?.let { url ->
                onProgress(Progress.FetchingArtwork)
                eventImages.download(eventId, url)
            }

            onProgress(Progress.Promoting)

            // Parties are derived from the guest rows: the bundle is guest-shaped,
            // but a scan resolves by partyId, so the party table is built here
            // rather than fetched separately.
            val parties = staged
                .groupBy { it.partyId }
                .map { (partyId, rows) ->
                    val first = rows.first()
                    PartyEntity(
                        id = partyId,
                        eventId = eventId,
                        label = first.partyLabel ?: first.fullName,
                        labelNormalized = NameNormalizer.normalize(first.partyLabel ?: first.fullName),
                        response = first.response,
                        tableId = first.tableId,
                        tableName = first.tableName,
                        notes = first.partyNotes,
                        side = first.side,
                    )
                }

            val guests = staged.map {
                GuestEntity(
                    id = it.id,
                    eventId = eventId,
                    partyId = it.partyId,
                    fullName = it.fullName,
                    nameNormalized = NameNormalizer.normalize(it.fullName),
                    isPrimaryContact = it.isPrimaryContact,
                    category = it.category,
                    mealSelection = it.mealSelection,
                    dietaryNotes = it.dietaryNotes,
                )
            }

            /*
             * The venue layout, geometry and all.
             *
             * Stored verbatim — no defaulting, no normalising, no dropping of
             * shapes this build does not recognise. The shape catalogue is
             * edited on the web side and `ui/seating/SeatingGeometry.kt` falls
             * back to a round table for anything it cannot name, so a layout
             * drawn with a shape added after this APK shipped still renders as a
             * room rather than disappearing from it.
             *
             * Nulls are preserved for the same reason they are nullable on the
             * entity: for a zone's size, null means "use the catalogue's", and
             * for a whole row it means "prepared by a server that did not send
             * geometry" — which draws no plan, exactly as before.
             */
            val tables = manifest.tables.map {
                VenueTableEntity(
                    id = it.id,
                    eventId = eventId,
                    name = it.name,
                    capacity = it.capacity,
                    elementType = it.elementType,
                    shape = it.shape,
                    positionX = it.positionX,
                    positionY = it.positionY,
                    width = it.width,
                    height = it.height,
                    rotation = it.rotation,
                    color = it.color,
                )
            }
            val staff = manifest.staff.map {
                StaffEntity(
                    staffId = it.staffId,
                    eventId = eventId,
                    displayName = it.displayName,
                    role = it.role,
                    pinHash = it.pinHash,
                )
            }

            db.bundleDao().promoteStaging(eventId, parties, guests, tables, staff)

            // Seed arrivals recorded before this device was armed, so the Layer 1
            // duplicate guard is correct from the FIRST scan rather than only
            // after the first delta (§5.3, §7). These are marked isRemote and
            // already synced — they did not originate here and must never be
            // re-submitted.
            val knownGuestIds = guests.mapTo(HashSet()) { it.id }
            val seeded = manifest.existingCheckIns
                .filter { it.guestId in knownGuestIds }
                .map {
                    CheckInEntity(
                        // Deterministic id derived from the server's own keys, so
                        // re-preparing the event cannot duplicate the row.
                        clientCheckinId = "seed:$eventId:${it.guestId}",
                        eventId = eventId,
                        guestId = it.guestId,
                        partyId = it.partyId ?: guests.first { g -> g.id == it.guestId }.partyId,
                        checkedInAt = parseIsoMillis(it.checkedInAt) ?: System.currentTimeMillis(),
                        staffId = null,
                        staffDisplayName = it.staffName,
                        deviceId = null,
                        deviceLabel = it.deviceLabel,
                        method = it.method ?: "qr_scan",
                        scanToken = null,
                        syncState = "synced",
                        // The server's own id for this arrival. Kept because it
                        // is the ONLY reference a supervisor can undo it by: the
                        // clientCheckinId above is invented here and the server
                        // has never seen it. Null from a server too old to send
                        // it, which leaves the arrival un-reversible from the
                        // door exactly as it was before.
                        serverId = it.serverId,
                        serverSeq = it.serverSeq,
                        isRemote = true,
                    )
                }
            if (seeded.isNotEmpty()) db.checkInDao().upsertAll(seeded)

            // isReadyOffline is set ONLY here — after verification passed and the
            // promotion transaction committed (§21.1).
            db.eventDao().upsert(manifest.toEventEntity(guests.size, existing, coverPath))

            val done = Progress.Done(guests.size)
            onProgress(done)
            done
        } catch (e: java.io.IOException) {
            // No connectivity. Preparation requires internet by design (§5.2), so
            // this is an expected outcome with a clear remedy, not a defect.
            failWith(Failure.Offline, onProgress)
        } catch (e: Exception) {
            failWith(Failure.Unknown(e.message), onProgress)
        }
    }

    private suspend fun fail(
        code: Int,
        errorBody: String?,
        onProgress: suspend (Progress) -> Unit,
    ): Progress {
        val failure = when {
            code == 401 -> Failure.NotAuthorised
            // 403 covers both a revoked device and a tier that lacks check-in.
            // The body distinguishes them; a revoked device is handled by the
            // caller because it must also purge local data (§20.5).
            code == 403 && errorBody?.contains("FEATURE") == true -> Failure.FeatureNotAvailable
            code == 403 -> Failure.NotAuthorised
            code == 402 -> Failure.FeatureNotAvailable
            else -> Failure.Server(code, errorBody?.take(200))
        }
        return failWith(failure, onProgress)
    }

    private suspend fun failWith(
        failure: Failure,
        onProgress: suspend (Progress) -> Unit,
    ): Progress {
        val progress = Progress.Failed(failure)
        onProgress(progress)
        return progress
    }

    /**
     * Applies a guest-data delta (§19.4).
     *
     * Returns false when the server said a delta cannot serve this device, in
     * which case the caller must run a full prepareEvent — NOT attempt to
     * reconcile. A half-updated guest list is worse than a stale one.
     */
    suspend fun applyGuestDelta(eventId: String): Boolean = withContext(io) {
        val event = db.eventDao().byId(eventId) ?: return@withContext false

        val response = api.guestDelta(eventId, event.bundleVersion)
        if (!response.isSuccessful) return@withContext false
        val delta = response.body()?.data ?: return@withContext false

        if (delta.requiresFullResync) return@withContext false

        if (delta.upserts.isNotEmpty()) {
            val parties = delta.upserts
                .groupBy { it.partyId }
                .map { (partyId, rows) ->
                    val first = rows.first()
                    PartyEntity(
                        id = partyId,
                        eventId = eventId,
                        label = first.partyLabel ?: first.fullName,
                        labelNormalized = NameNormalizer.normalize(first.partyLabel ?: first.fullName),
                        response = first.response,
                        tableId = first.tableId,
                        tableName = first.tableName,
                        notes = first.partyNotes,
                        side = first.side,
                    )
                }
            db.partyDao().upsertAll(parties)
            db.guestDao().upsertAll(
                delta.upserts.map {
                    GuestEntity(
                        id = it.id,
                        eventId = eventId,
                        partyId = it.partyId,
                        fullName = it.fullName,
                        nameNormalized = NameNormalizer.normalize(it.fullName),
                        isPrimaryContact = it.isPrimaryContact,
                        category = it.category,
                        mealSelection = it.mealSelection,
                        dietaryNotes = it.dietaryNotes,
                    )
                },
            )
        }

        // §19.5: a guest removed while already checked in is NOT deleted locally —
        // the person is physically inside the venue, and deleting them produces a
        // report that contradicts the room. Only unchecked guests are removed.
        if (delta.removedGuestIds.isNotEmpty()) {
            val safeToRemove = delta.removedGuestIds.filter { guestId ->
                db.checkInDao().liveForGuest(eventId, guestId) == null
            }
            if (safeToRemove.isNotEmpty()) db.guestDao().deleteByIds(safeToRemove)
        }

        db.eventDao().setBundleVersion(eventId, delta.toVersion)
        true
    }

    private fun BundleGuestDto.toStaging(eventId: String, page: Int) = GuestStagingEntity(
        id = id,
        eventId = eventId,
        partyId = partyId,
        partyLabel = partyLabel,
        fullName = fullName,
        isPrimaryContact = isPrimaryContact,
        category = category,
        response = response,
        tableId = tableId,
        tableName = tableName,
        mealSelection = mealSelection,
        dietaryNotes = dietaryNotes,
        partyNotes = partyNotes,
        side = side,
        page = page,
    )

    private fun BundleManifestDto.toEventEntity(
        guestCount: Int,
        previous: EventEntity?,
        coverImagePath: String?,
    ) = EventEntity(
        id = event.id,
        name = event.name,
        venue = event.venue,
        venueAddress = event.venueAddress,
        startsAt = parseIsoMillis(event.startsAt) ?: previous?.startsAt ?: 0L,
        // Falls back to the cached zone rather than to null: a manifest that
        // omits it must not blank a zone the device already has.
        timezone = event.timezone ?: previous?.timezone,
        brandingPrimaryColor = event.brandingPrimaryColor,
        coverImageUrl = event.coverImageUrl,
        // Falls back to whatever was already cached. A re-prepare on venue-office
        // wifi that cannot reach the image host must not blank a photograph the
        // device successfully downloaded last week.
        coverImagePath = coverImagePath ?: previous?.coverImagePath,
        noKidsAllowed = event.noKidsAllowed,
        totalInvited = guestCount,
        bundleVersion = bundleVersion,
        // Preserve the applied sequence across a re-prepare: resetting it would
        // make the device re-apply every check-in another device has recorded.
        lastAppliedSeq = maxOf(previous?.lastAppliedSeq ?: 0L, lastSeq),
        lastFullSyncAt = System.currentTimeMillis(),
        isReadyOffline = true,
        syncDisabled = previous?.syncDisabled ?: false,
        realtimeDisabled = previous?.realtimeDisabled ?: false,
        pollingOnly = previous?.pollingOnly ?: false,
    )

    private fun parseIsoMillis(iso: String?): Long? =
        if (iso.isNullOrBlank()) {
            null
        } else {
            try {
                Instant.parse(iso).toEpochMilli()
            } catch (_: Exception) {
                null
            }
        }
}
