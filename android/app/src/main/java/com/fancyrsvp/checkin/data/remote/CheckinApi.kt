package com.fancyrsvp.checkin.data.remote

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The check-in API surface (`/api/v1/checkin/...`).
 *
 * Versioned independently of the organizer API (spec §21.4) so a breaking change
 * can ship as v2 while tablets already at venues keep talking to v1.
 *
 * Everything returns `Response<Envelope<T>>` rather than a bare body. The
 * repository needs the status code to distinguish outcomes that all "fail" but
 * demand opposite responses:
 *
 *   401 TOKEN_EXPIRED    → refresh and retry. Keep scanning throughout.
 *   403 DEVICE_REVOKED   → purge local event data (§20.5).
 *   403 FEATURE_*        → cannot arm this event; never re-gate a live device.
 *   413 BATCH_TOO_LARGE  → split the batch and retry. Not a data loss.
 *   429                  → a normal backoff signal, NEVER a reason to discard
 *                          queued check-ins (§21.9).
 *
 * Collapsing those into one exception type is how a device ends up wiping when it
 * should have refreshed.
 */
interface CheckinApi {

    // ── Pairing: no device credential exists yet ──

    @POST("checkin/devices/pair")
    suspend fun pairDevice(@Body body: PairRequest): Response<Envelope<PairResponse>>

    /*
     * `refreshToken` was declared here and is gone. Token refresh cannot use
     * this interface: it is the call made WHEN the access token has expired, so
     * it must not pass through DeviceAuthInterceptor — which would attach the
     * dead token and, on a 401, try to refresh by calling refresh. AppModule
     * builds a separate `RefreshOnlyApi` on a client with no auth interceptor
     * for exactly that reason, and that is the one in use. This declaration had
     * no call site and existed only to be picked up by mistake.
     */

    /** Confirms local event data has been destroyed after a remote wipe (§20.5). */
    @POST("checkin/devices/wipe-confirm")
    suspend fun confirmWipe(): Response<Envelope<Unit>>

    // ── Preparation (requires internet, done before travelling) ──

    /*
     * `listEvents` was declared here and is gone, along with the last use of
     * EventListResponse.
     *
     * A device is paired to exactly ONE event (§18.3), so there is no list to
     * choose from: BundleRepository.refreshEvents reads that event's manifest
     * instead, which is also the only call that carries the record count the
     * pre-download storage check needs. GET /checkin/events remains on the
     * server for the organizer's own dashboard.
     */

    @GET("checkin/events/{eventId}/bundle/manifest")
    suspend fun bundleManifest(
        @Path("eventId") eventId: String,
    ): Response<Envelope<BundleManifestDto>>

    /**
     * One page of guests.
     *
     * Resumable because pages are ordered by a stable key (guest id) server-side,
     * so re-requesting page N after an interruption returns the same rows.
     */
    @GET("checkin/events/{eventId}/bundle")
    suspend fun bundlePage(
        @Path("eventId") eventId: String,
        @Query("page") page: Int,
        @Query("limit") limit: Int,
    ): Response<Envelope<BundlePageDto>>

    // ── Live operation and reconciliation ──

    @POST("checkin/events/{eventId}/check-ins")
    suspend fun submitBatch(
        @Path("eventId") eventId: String,
        @Body body: CheckInBatchRequest,
    ): Response<Envelope<CheckInBatchResponse>>

    @GET("checkin/events/{eventId}/delta")
    suspend fun checkInDelta(
        @Path("eventId") eventId: String,
        @Query("since_seq") sinceSeq: Long,
    ): Response<Envelope<CheckInDeltaResponse>>

    @GET("checkin/events/{eventId}/guest-delta")
    suspend fun guestDelta(
        @Path("eventId") eventId: String,
        @Query("since_version") sinceVersion: Long,
        @Query("limit") limit: Int = 500,
    ): Response<Envelope<GuestDeltaResponse>>

    /**
     * Supervisor undo — soft delete with a mandatory reason (§9.6).
     *
     * @HTTP(hasBody = true) rather than @DELETE: Retrofit's @DELETE declares
     * hasBody = false and throws "Non-body HTTP method cannot contain @Body" at
     * interface-creation time. The reason is required by the server, so the body
     * is not optional.
     */
    @HTTP(method = "DELETE", path = "checkin/events/{eventId}/check-ins/{clientCheckinId}", hasBody = true)
    suspend fun undoCheckIn(
        @Path("eventId") eventId: String,
        @Path("clientCheckinId") clientCheckinId: String,
        @Body body: UndoRequest,
    ): Response<Envelope<UndoResponse>>

    @GET("checkin/events/{eventId}/controls")
    suspend fun controls(
        @Path("eventId") eventId: String,
    ): Response<Envelope<SyncControlsDto>>

    /*
     * `setControls` was declared here and is gone.
     *
     * It had no call site, and it could never have had one: PATCH
     * /events/:eventId/controls is `organizerOnly` on the server
     * (checkinSyncRoutes.js), so a device token is refused outright. The
     * emergency controls are set from the dashboard and READ here — which is
     * what `controls` above does, and is the whole of §21.5's contract with a
     * device: it obeys them, it does not author them.
     */
}
