package com.fancyrsvp.checkin.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Url

/**
 * The update manifest published beside the APK, and the one call that reads it.
 *
 * ── Why this exists ──
 *
 * The door app is sideloaded, so nothing tells a tablet a newer build is out.
 * Every release writes `fancy-checkin.json` next to `fancy-checkin.apk` (see
 * `writeReleaseManifest` in app/build.gradle.kts), and an installed app reads it
 * to decide whether to offer an update. Before this, the only way onto a newer
 * build was for somebody to browse to the APK on that tablet and install it by
 * hand — so in practice tablets stayed on whatever they were set up with.
 *
 * ── Every field is defaulted, deliberately ──
 *
 * A tablet in the field may be older than the server it is talking to, or newer.
 * A manifest that gains a field must not stop parsing on an old build, and a
 * manifest missing one must not throw on a new build. The json instance is
 * already `ignoreUnknownKeys = true` (AppModule); defaults cover the other
 * direction. A version check is a courtesy — it may never become a crash.
 */
@Serializable
data class UpdateManifestDto(
    /**
     * The number Android itself compares. Written from the same `val` that
     * configured the APK, so it cannot describe a build that was never made.
     */
    @SerialName("versionCode") val versionCode: Long = 0,
    /** The human label — "1.6.1". Shown, never compared. */
    @SerialName("versionName") val versionName: String = "",
    /** Lowercase hex. Verified before the file is handed to the installer. */
    @SerialName("sha256") val sha256: String = "",
    @SerialName("sizeBytes") val sizeBytes: Long = 0,
    @SerialName("minSdk") val minSdk: Int = 0,
    @SerialName("releasedAt") val releasedAt: String? = null,
    /** What changed. Empty is normal; the screen omits the section. */
    @SerialName("notes") val notes: String = "",
    /** Absolute https URL of the APK this manifest describes. */
    @SerialName("url") val url: String = "",
)

/**
 * Fetches the manifest, and NOTHING else.
 *
 * `@Url` with an absolute address rather than a path on the API base: the
 * manifest is a static file on the web server, not an API resource, and it must
 * be reachable by a tablet whose device token has expired — the whole point is
 * that a stale build can still discover the build that fixes it.
 *
 * Bound to a client with no interceptors (see AppModule). Using the main client
 * would attach an `Authorization: Device <token>` header — this would be the
 * only request in the app that sends a credential somewhere other than the API —
 * and `DeviceHealthInterceptor` would put battery and queue-depth headers on a
 * request for a static file.
 */
interface UpdateManifestApi {
    @GET
    suspend fun manifest(@Url url: String): Response<UpdateManifestDto>
}
