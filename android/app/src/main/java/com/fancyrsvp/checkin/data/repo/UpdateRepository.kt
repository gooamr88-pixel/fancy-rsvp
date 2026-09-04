package com.fancyrsvp.checkin.data.repo

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.fancyrsvp.checkin.BuildConfig
import com.fancyrsvp.checkin.data.local.CheckinDatabase
import com.fancyrsvp.checkin.data.remote.UpdateManifestApi
import com.fancyrsvp.checkin.data.remote.UpdateManifestDto
import com.fancyrsvp.checkin.data.security.SecureStore
import com.fancyrsvp.checkin.device.DeviceStatusMonitor
import com.fancyrsvp.checkin.di.MediaClient
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Finding, fetching and handing over a newer build of this app.
 *
 * ── The problem ──
 *
 * The app is sideloaded, so there is no store to announce an update. Until now a
 * new build reached a tablet only if somebody browsed to the APK on that tablet
 * and installed it, which in practice meant tablets stayed on whatever they were
 * armed with and the standing advice was to uninstall and reinstall.
 *
 * ── What makes it safe ──
 *
 * Three things, none of which is this class being careful:
 *
 *  1. HTTPS only. network_security_config.xml forbids cleartext in release with
 *     no domain exceptions, so the manifest and the APK cannot be fetched over
 *     a connection somebody on the venue wifi can rewrite.
 *  2. The SHA-256 from the manifest is verified before the installer is ever
 *     invoked. It is the only thing between a truncated download and a prompt.
 *  3. Android refuses an install whose signing key differs from the installed
 *     app's. Releases are signed from one keystore on the build server, so a
 *     foreign APK cannot replace ours — and the same fact is why an update
 *     installs in place with the encrypted database intact, instead of needing
 *     an uninstall.
 *
 * Nothing here ever throws at a caller. A version check is a courtesy, and a
 * courtesy that can crash a door app is not one.
 */
@Singleton
class UpdateRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: UpdateManifestApi,
    @MediaClient private val client: OkHttpClient,
    private val secureStore: SecureStore,
    private val deviceStatus: DeviceStatusMonitor,
    private val db: CheckinDatabase,
    private val io: CoroutineDispatcher,
) {

    /** Where a download stands. Mirrors BundleRepository.Progress in spirit. */
    sealed interface Progress {
        data class Downloading(val bytes: Long, val total: Long) : Progress {
            /** 0..100, or null when the server declared no length. */
            val percent: Int? get() = if (total > 0) ((bytes * 100) / total).toInt() else null
        }

        data object Verifying : Progress
        data class Ready(val file: File) : Progress
        data class Failed(val reason: Reason) : Progress
    }

    /** Why a download did not produce an installable file. */
    enum class Reason {
        OFFLINE,
        NO_SPACE,
        /** The bytes did not match the published checksum. Never installed. */
        CORRUPT,
        SERVER,
    }

    /**
     * Reads the published manifest, or null.
     *
     * Null covers every failure — offline, 404, a web server that has not been
     * deployed with a manifest yet, malformed JSON. All of them mean the same
     * thing to the caller: there is nothing to offer, say nothing.
     */
    suspend fun fetchManifest(): UpdateManifestDto? = withContext(io) {
        runCatching {
            val response = api.manifest(MANIFEST_URL)
            if (!response.isSuccessful) return@runCatching null
            response.body()?.takeIf { it.versionCode > 0 }
        }.getOrNull()
    }

    /**
     * Deletes a downloaded APK once this build no longer needs it.
     *
     * ── Why this is not optional housekeeping ──
     *
     * The installer is launched by an intent and this process is usually killed
     * during the install, so nothing here runs afterwards to tidy up. Without
     * this the ~46 MB file sits in filesDir for the life of the device — on a
     * tablet that must hold a 2,000-guest bundle and that raises a storage
     * warning at 20 MB free (DeviceStatusMonitor.LOW_THRESHOLD). An update
     * feature that quietly consumes the headroom the bundle download needs would
     * trade one problem for a worse one.
     *
     * Called when a check finds nothing newer, which is precisely the signal
     * that the install landed — this build now IS the published one.
     */
    fun purgeDownloads() {
        runCatching { File(context.filesDir, UPDATE_DIR).listFiles()?.forEach { it.delete() } }
    }

    /** [UpdateGate.evaluate], with this device's own numbers filled in. */
    suspend fun evaluate(manifest: UpdateManifestDto?): UpdateGate.Verdict = withContext(io) {
        val unsent = runCatching { db.syncQueueDao().totalUnsentEvidence() }.getOrDefault(0)
        UpdateGate.evaluate(
            manifest = manifest,
            installedVersionCode = BuildConfig.VERSION_CODE.toLong(),
            dismissedVersionCode = secureStore.dismissedUpdateVersionCode,
            unsentEvidence = unsent,
            deviceSdk = Build.VERSION.SDK_INT,
        )
    }

    /** Records that this build was declined. A newer one still asks. */
    fun dismiss(versionCode: Long) {
        secureStore.dismissedUpdateVersionCode = versionCode
    }

    /**
     * Forgets a dismissal, so the offer comes back on the next check.
     *
     * Called when preparation refuses with `Failure.AppTooOld` — the server has
     * just declared this build too old to arm a tablet. "Later" was a reasonable
     * answer five minutes ago and is not one any more: without the update there
     * is nothing this device can do, and leaving the offer suppressed would
     * strand the operator on an error whose remedy the app is holding.
     */
    fun clearDismissal() {
        secureStore.dismissedUpdateVersionCode = 0L
    }

    /**
     * Downloads the APK and verifies it, reporting progress as it goes.
     *
     * Written to a `.part` file and promoted only after the checksum matches —
     * the same shape as EventImageStore.download, and for a sharper reason here:
     * a half-written APK at the real filename is a file the install path would
     * happily pick up on the next attempt.
     */
    suspend fun download(
        manifest: UpdateManifestDto,
        onProgress: (Progress) -> Unit,
    ): Progress = withContext(io) {
        val free = deviceStatus.storageFreeMb()
        if (free != null && free * 1024L * 1024L < UpdateGate.requiredFreeBytes(manifest.sizeBytes)) {
            return@withContext Progress.Failed(Reason.NO_SPACE).also(onProgress)
        }

        val dir = File(context.filesDir, UPDATE_DIR).apply { mkdirs() }
        // Everything else in this directory is a previous attempt. Clearing it
        // first means a failed download can never accumulate into the very
        // storage exhaustion this feature has to avoid.
        runCatching { dir.listFiles()?.forEach { it.delete() } }

        val target = File(dir, "fancy-checkin-${manifest.versionCode}.apk")
        val partial = File(dir, "${target.name}.part")

        val result = runCatching {
            val request = Request.Builder().url(manifest.url).build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@runCatching Progress.Failed(Reason.SERVER)
                val body = response.body ?: return@runCatching Progress.Failed(Reason.SERVER)

                // The declared length is used for the progress bar, and the
                // manifest's size is what bounds the copy. Trusting
                // Content-Length for the bound would let a server that omits or
                // lies about it fill the disk.
                val declared = body.contentLength().takeIf { it > 0 } ?: manifest.sizeBytes
                val digest = MessageDigest.getInstance("SHA-256")

                val written = body.byteStream().use { input ->
                    partial.outputStream().use { output ->
                        input.copyHashingAtMost(output, digest, manifest.sizeBytes) { soFar ->
                            onProgress(Progress.Downloading(soFar, declared))
                        }
                    }
                }
                if (written == null || written != manifest.sizeBytes) {
                    return@runCatching Progress.Failed(Reason.CORRUPT)
                }

                onProgress(Progress.Verifying)
                val hex = digest.digest().joinToString("") { "%02x".format(it) }
                if (!hex.equals(manifest.sha256, ignoreCase = true)) {
                    return@runCatching Progress.Failed(Reason.CORRUPT)
                }

                target.delete()
                if (!partial.renameTo(target)) return@runCatching Progress.Failed(Reason.SERVER)
                Progress.Ready(target)
            }
        }.getOrElse { Progress.Failed(Reason.OFFLINE) }

        if (result !is Progress.Ready) runCatching { partial.delete() }
        result.also(onProgress)
    }

    /**
     * True when this app may ask the system to install a package.
     *
     * From API 26 this is a per-app setting the user grants, not a manifest
     * permission that is simply held — declaring REQUEST_INSTALL_PACKAGES is
     * necessary and not sufficient. minSdk is 26, so there is no older path.
     */
    fun canInstall(): Boolean =
        runCatching { context.packageManager.canRequestPackageInstalls() }.getOrDefault(false)

    /** Sends the operator to the one settings screen that grants it. */
    fun installPermissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * Hands a verified APK to the system installer.
     *
     * A FileProvider content:// URI, never file:// — since API 24 a file URI in
     * an intent throws FileUriExposedException, and the read grant is what lets
     * the installer, a different process, open it at all.
     */
    fun installIntent(apk: File): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    /**
     * Copies while hashing, bounded, reporting as it goes.
     *
     * One pass: reading the file a second time to hash it would double the I/O
     * on a tablet that may be doing this on venue-office wifi with a queue of
     * other work. Returns null if the source exceeds [limit], which is what
     * stops a lying Content-Length from filling the disk — the same reasoning as
     * EventImageStore.copyAtMost, which this is modelled on.
     */
    private inline fun java.io.InputStream.copyHashingAtMost(
        out: OutputStream,
        digest: MessageDigest,
        limit: Long,
        onBytes: (Long) -> Unit,
    ): Long? {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        var lastReport = 0L
        while (true) {
            val read = read(buffer)
            if (read <= 0) break
            total += read
            if (total > limit) return null
            digest.update(buffer, 0, read)
            out.write(buffer, 0, read)
            // Throttled: a progress callback per 64 KB chunk on a 46 MB file is
            // ~700 recompositions, which is how a progress bar makes a download
            // slower than the network does.
            if (total - lastReport >= PROGRESS_STEP_BYTES) {
                lastReport = total
                onBytes(total)
            }
        }
        onBytes(total)
        return total
    }

    private companion object {
        /**
         * Absolute, and the same origin the public download page links.
         *
         * Not derived from BuildConfig.API_BASE_URL: the manifest is a static
         * file on the web server, not an API resource, and a debug build
         * pointing at a laptop must still find the real published release rather
         * than 404 against a dev machine.
         */
        const val MANIFEST_URL = "https://fancyrsvp.com/download/fancy-checkin.json"
        const val UPDATE_DIR = "updates"
        const val PROGRESS_STEP_BYTES = 512L * 1024
    }
}
