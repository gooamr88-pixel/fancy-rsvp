package com.fancyrsvp.checkin.data.repo

import android.content.Context
import android.os.Build
import com.fancyrsvp.checkin.BuildConfig
import com.fancyrsvp.checkin.data.local.CheckinDatabase
import com.fancyrsvp.checkin.data.remote.CheckinApi
import com.fancyrsvp.checkin.data.remote.DeviceFingerprint
import com.fancyrsvp.checkin.data.remote.PairRequest
import com.fancyrsvp.checkin.data.security.SecureStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Device pairing and lifecycle (spec §18.3, §18.4, §20.5).
 *
 * Devices are provisioned FROM the web dashboard, never self-enrolled here. The
 * app's only role is to redeem an 8-character code and store what comes back in
 * the Keystore.
 */
@Singleton
class DeviceRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: CheckinApi,
    private val db: CheckinDatabase,
    private val secureStore: SecureStore,
    private val eventImages: com.fancyrsvp.checkin.data.media.EventImageStore,
    private val io: CoroutineDispatcher,
) {

    sealed interface PairResult {
        data class Success(val eventId: String, val deviceLabel: String) : PairResult
        data object InvalidCode : PairResult
        data object CodeExpired : PairResult
        data object DeviceLimitReached : PairResult
        data object Offline : PairResult
        data class Failed(val code: Int, val message: String?) : PairResult
    }

    /**
     * Outcome of releasing a tablet from its account.
     *
     * [Blocked] is not an error the operator can retry past — it is the whole
     * point of the check. See [unpair].
     */
    sealed interface UnpairResult {
        data object Success : UnpairResult
        data class Blocked(val pending: Int) : UnpairResult
    }

    val isPaired: Boolean get() = secureStore.isPaired
    val pairedEventId: String? get() = secureStore.pairedEventId
    val deviceLabel: String? get() = secureStore.deviceLabel

    suspend fun pair(rawCode: String): PairResult = withContext(io) {
        // Normalised the same way the server does, so a code typed with spaces or
        // in lowercase off a dashboard screen still works.
        val code = rawCode.uppercase().filter { it.isLetterOrDigit() }
        if (code.length != PAIRING_CODE_LENGTH) return@withContext PairResult.InvalidCode

        try {
            val response = api.pairDevice(
                PairRequest(
                    code = code,
                    fingerprint = fingerprint(),
                    appVersion = BuildConfig.VERSION_NAME,
                ),
            )

            if (!response.isSuccessful) {
                val body = response.errorBody()?.string()
                return@withContext when {
                    response.code() == 410 -> PairResult.CodeExpired
                    response.code() == 409 -> PairResult.DeviceLimitReached
                    response.code() == 400 -> PairResult.InvalidCode
                    else -> PairResult.Failed(response.code(), body?.take(200))
                }
            }

            val data = response.body()?.data
                ?: return@withContext PairResult.Failed(response.code(), "empty body")

            // Both tokens go straight into the Keystore-wrapped store. They are
            // never written to SharedPreferences in plaintext, a file, or a log
            // (§20.2).
            secureStore.accessToken = data.accessToken
            secureStore.refreshToken = data.refreshToken
            secureStore.deviceId = data.deviceId
            secureStore.deviceLabel = data.deviceLabel
            secureStore.pairedEventId = data.eventId

            PairResult.Success(data.eventId, data.deviceLabel)
        } catch (_: java.io.IOException) {
            // Pairing requires internet by design — it is done during
            // preparation, never at the venue (§18.3).
            PairResult.Offline
        } catch (t: Throwable) {
            // Throwable, NOT Exception. The first database access in the whole app
            // happens inside this call — DeviceHealthInterceptor asks
            // DeviceHealthProvider for a snapshot, which opens the SQLCipher
            // database — so this is where a native-library or class-initialisation
            // failure surfaces. Those are Errors (UnsatisfiedLinkError,
            // ExceptionInInitializerError, NoClassDefFoundError), not Exceptions,
            // and `catch (e: Exception)` let them through to kill the process.
            //
            // The class name is included because on a tablet there is no logcat:
            // the operator reads the cause off the screen, and "UnsatisfiedLinkError"
            // versus "SocketTimeoutException" are completely different problems.
            PairResult.Failed(-1, "${t.javaClass.simpleName}: ${t.message ?: "no message"}")
        }
    }

    /**
     * A stable per-installation id for support triage.
     *
     * Deliberately NOT a hardware identifier: ANDROID_ID and the like are
     * privacy-sensitive and need no permission-free justification here. A random
     * UUID generated once per install identifies the installation for a support
     * conversation and nothing more, and it dies with an uninstall — which is the
     * correct lifetime.
     */
    private fun installId(): String {
        secureStore.deviceId?.let { return it }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY_INSTALL_ID, null)?.let { return it }
        val generated = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_INSTALL_ID, generated).apply()
        return generated
    }

    private fun fingerprint() = DeviceFingerprint(
        model = Build.MODEL ?: "unknown",
        manufacturer = Build.MANUFACTURER ?: "unknown",
        osVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
        installId = installId(),
    )

    /**
     * Releases this tablet from its account, so it can be paired to another.
     *
     * ── Why this exists ──
     *
     * Nothing in the app could undo a pairing. Not the menu, not the preparation
     * screen, not anywhere. A tablet paired to the wrong event, a rental going
     * back to the hire company, a device handed from one organiser to the next —
     * every one of those needed the app uninstalled and reinstalled, by someone
     * who probably does not have the tablet in front of them.
     *
     * ── Why it refuses while anything is unsent ──
     *
     * Unpairing clears the credentials the sync queue authenticates with, so a
     * check-in still sitting in that queue could never be delivered afterwards.
     * Those records exist NOWHERE else — they are guests who were admitted at a
     * door on a tablet that was offline. Losing them is the worst outcome in the
     * system, and it is exactly the outcome someone tidying up a device at the
     * end of a night would cause without this check.
     *
     * The count is returned rather than a bare refusal so the screen can say how
     * many, which is the difference between "wait for signal" and "something is
     * wrong".
     */
    suspend fun unpair(): UnpairResult = withContext(io) {
        // Counted as EVIDENCE, not as rows. A reversal the server refused holds
        // nothing that exists only here, and blocking on one left the tablet with
        // no exit at all — see SyncQueueDao.unsentEvidenceForEvent.
        val pending = db.syncQueueDao().totalUnsentEvidence()
        if (pending > 0) return@withContext UnpairResult.Blocked(pending)

        // Guest data goes with the credentials. Leaving a decrypted-at-rest guest
        // list on a tablet that no longer belongs to the event is the §20.3 leak
        // this whole storage design exists to prevent, and the next operator to
        // pair the device would have no idea it was there.
        //
        // purgeEventData re-checks the per-event queue depth. That is redundant
        // after the total check above and is left alone deliberately: it is the
        // guard that makes the function safe to call from anywhere.
        secureStore.pairedEventId?.let { purgeEventData(it) }

        secureStore.clearDeviceCredentials()
        UnpairResult.Success
    }

    /**
     * Purges local event data after a confirmed wipe or an event close (§20.5).
     *
     * BLOCKED while the sync queue is non-empty, and that is not a soft
     * preference: those check-ins exist nowhere else, and destroying them is the
     * single worst outcome in the system. Returns false so the caller can warn
     * explicitly rather than silently doing nothing.
     */
    suspend fun purgeEventData(eventId: String): Boolean = withContext(io) {
        val pending = db.syncQueueDao().unsentEvidenceForEvent(eventId)
        if (pending > 0) return@withContext false

        db.bundleDao().purgeGuestData(eventId)
        db.checkInDao().deleteForEvent(eventId)
        // The photograph leaves WITH the guest list, not after it. It is a
        // client's own picture of their wedding sitting on a tablet that gets
        // hired out again next weekend, so it is covered by the same §20.5
        // obligation as the names — and the file is outside the encrypted
        // database, so nothing else would ever remove it.
        eventImages.delete(eventId)
        db.eventDao().clearCoverImage(eventId)

        /*
         * The event row goes too. This was `markNotReady`, which only flipped a
         * flag — so every event a tablet had ever been armed for stayed in the
         * Prepare screen's picker for the life of the device, and dragged
         * `readyEvent()` back to the oldest one it had ever held.
         *
         * Safe here and nowhere else: the guard above has already established
         * that nothing is outstanding, and the row carries `lastAppliedSeq` —
         * the device's place in the change stream. Deleting it with work still
         * queued would lose that.
         *
         * The paired event comes back on the next `refreshEvents()`, which
         * rebuilds the row from the manifest.
         */
        db.eventDao().deleteById(eventId)
        true
    }

    /**
     * Handles a server instruction to wipe (§20.5).
     *
     * Credentials are cleared only when the device was REVOKED. A plain wipe
     * request leaves the tablet paired so it stays provisioned for future events.
     */
    suspend fun handleWipeInstruction(eventId: String, revoked: Boolean): Boolean = withContext(io) {
        val purged = purgeEventData(eventId)
        if (purged) {
            runCatching { api.confirmWipe() }
            if (revoked) secureStore.clearDeviceCredentials()
        }
        purged
    }

    private companion object {
        const val PAIRING_CODE_LENGTH = 8
        const val PREFS = "fancy_checkin_install"
        const val KEY_INSTALL_ID = "install_id"
    }
}
