package com.fancyrsvp.checkin.di

import android.content.Context
import com.fancyrsvp.checkin.BuildConfig
import com.fancyrsvp.checkin.data.local.CheckinDatabase
import com.fancyrsvp.checkin.data.remote.CheckinApi
import com.fancyrsvp.checkin.data.remote.DeviceAuthInterceptor
import com.fancyrsvp.checkin.data.remote.DeviceHealthInterceptor
import com.fancyrsvp.checkin.data.remote.Envelope
import com.fancyrsvp.checkin.data.remote.RefreshRequest
import com.fancyrsvp.checkin.data.remote.RefreshResponse
import com.fancyrsvp.checkin.data.remote.UpdateManifestApi
import com.fancyrsvp.checkin.data.security.SecureStore
import com.fancyrsvp.checkin.device.DeviceHealthProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

/**
 * Marks the application-lifetime coroutine scope.
 *
 * Distinct from a ViewModel scope on purpose: the sync engine's work must survive
 * the scanner screen being recreated on rotation or briefly backgrounded. A drain
 * cancelled halfway leaves check-ins in the queue that nothing is trying to send,
 * and they exist nowhere else.
 */
@Retention(AnnotationRetention.BINARY)
@javax.inject.Qualifier
annotation class ApplicationScope

/**
 * Marks the client used to fetch third-party assets, which carries NO credentials.
 *
 * ── Why this qualifier has to exist ──
 *
 * `DeviceAuthInterceptor` decides whether to attach the device token by PATH, not
 * by host — everything except `/checkin/devices/pair` and `/refresh` gets an
 * `Authorization: Device <token>` header. That is correct for the app's own API,
 * where every request goes to one known backend.
 *
 * The event's cover photograph does not. `cover_image_url` points wherever the
 * organizer's upload landed — object storage, a CDN, in principle any host. Using
 * the main client to fetch it would send that host the device access token, which
 * reads the complete guest list and posts check-ins, plus the device-health
 * headers (battery, storage, queue depth, bundle version). A credential handed to
 * an arbitrary third party is a credential leak whether or not that party wanted
 * it, and it would be invisible: the image downloads fine either way.
 *
 * So asset fetches get their own client with no interceptors at all.
 */
@Retention(AnnotationRetention.BINARY)
@javax.inject.Qualifier
annotation class MediaClient

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun ioDispatcher(): CoroutineDispatcher = Dispatchers.IO

    /**
     * SupervisorJob so one failed child does not tear down sibling sync work —
     * a failed delta poll must not also kill the outbound drain.
     */
    @Provides
    @Singleton
    @ApplicationScope
    fun applicationScope(): kotlinx.coroutines.CoroutineScope =
        kotlinx.coroutines.CoroutineScope(
            // The handler is NOT redundant with SupervisorJob. SupervisorJob only
            // stops a failed child cancelling its siblings — the exception still
            // travels on to the default uncaught handler, which kills the process.
            // Without this, a failed background poll could take the app down from
            // a background thread while an usher was mid-scan.
            kotlinx.coroutines.SupervisorJob() + Dispatchers.Default +
                com.fancyrsvp.checkin.util.SyncExceptionHandler,
        )

    @Provides
    @Singleton
    fun secureStore(@ApplicationContext context: Context): SecureStore = SecureStore(context)

    @Provides
    @Singleton
    fun database(
        @ApplicationContext context: Context,
        secureStore: SecureStore,
    ): CheckinDatabase =
        // The passphrase array is zeroed by SQLCipher's factory, so it is fetched
        // fresh here and never retained.
        CheckinDatabase.build(context, secureStore.databasePassphrase())

    /**
     * Tolerant JSON (§21.4).
     *
     * ignoreUnknownKeys is not a convenience — it is the rule that lets the
     * backend add a field without breaking a tablet that has been offline at a
     * venue for a week. explicitNulls = false keeps request bodies small on a
     * poor connection.
     */
    @Provides
    @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    @Provides
    @Singleton
    fun healthProvider(
        @ApplicationContext context: Context,
        database: CheckinDatabase,
    ): DeviceHealthProvider = DeviceHealthProvider(context, database)

    @Provides
    @Singleton
    fun okHttpClient(
        secureStore: SecureStore,
        json: Json,
        healthProvider: DeviceHealthProvider,
    ): OkHttpClient {
        // A bare client used ONLY to refresh a device token. It carries no
        // interceptors, which prevents the refresh call from recursing back
        // through DeviceAuthInterceptor and refreshing while refreshing.
        val refreshClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()

        val refreshApi = Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(refreshClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(RefreshOnlyApi::class.java)

        val builder = OkHttpClient.Builder()
            // Generous but bounded. A venue connection is often slow rather than
            // absent, and a hung request must not pin a worker forever.
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
            // OkHttp's own retry is left ON: it only replays idempotent-safe
            // failures, and the batch endpoint is idempotent by client_checkin_id
            // anyway.
            .retryOnConnectionFailure(true)
            .addInterceptor(DeviceHealthInterceptor { healthProvider.snapshot() })
            .addInterceptor(
                DeviceAuthInterceptor(secureStore) { refreshToken ->
                    try {
                        val response = refreshApi.refresh(RefreshRequest(refreshToken)).execute()
                        val body = response.body()?.data
                        if (response.isSuccessful && body != null) {
                            secureStore.accessToken = body.accessToken
                            secureStore.refreshToken = body.refreshToken
                            body.accessToken
                        } else {
                            // A 403 here means the device was revoked. Credentials
                            // are cleared so the app stops presenting a dead
                            // token, but LOCAL DATA is deliberately untouched —
                            // purging it is a separate decision that must first
                            // confirm the sync queue is empty (§20.5).
                            if (response.code() == 403) secureStore.clearDeviceCredentials()
                            null
                        }
                    } catch (_: Exception) {
                        null
                    }
                },
            )

        // Resolved per source set: BODY logging in debug, null in release. Guest
        // names and device tokens travel in these payloads and §20.7 forbids
        // personal data in logs, so the logging library is `debugImplementation`
        // and is physically absent from the release APK — which is also why this
        // cannot be a `BuildConfig.DEBUG` branch in shared code. See
        // src/{debug,release}/java/.../di/HttpLogging.kt.
        httpLoggingInterceptor()?.let { builder.addInterceptor(it) }

        return builder.build()
    }

    /**
     * A bare client for third-party assets. No interceptors — see [MediaClient].
     *
     * Not derived from the main client with `newBuilder()`, deliberately: that
     * COPIES the interceptor list, so the credential would come with it and the
     * only thing separating the two clients would be a call to
     * `interceptors().clear()` that a later edit could quietly drop. Built from
     * scratch, there is nothing to remove and nothing to forget.
     */
    @Provides
    @Singleton
    @MediaClient
    fun mediaClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        // Longer than the API client's: this is a multi-megabyte photograph over
        // whatever wifi the office has, and it is fetched once.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    @Provides
    @Singleton
    fun retrofit(client: OkHttpClient, json: Json): Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides
    @Singleton
    fun checkinApi(retrofit: Retrofit): CheckinApi = retrofit.create(CheckinApi::class.java)

    /**
     * Reads the update manifest — the static JSON published beside the APK.
     *
     * On the credential-free [MediaClient], not the API client, for two reasons
     * that are both about what would otherwise ride along:
     *
     *  • DeviceAuthInterceptor decides whether to attach the device token by
     *    PATH SUFFIX (see its isUnauthenticatedPath). A static file on the web
     *    server matches nothing it exempts, so this would be the one request in
     *    the app that sends a device credential outside the API.
     *  • DeviceHealthInterceptor puts battery, storage and queue-depth headers
     *    on every request it sees. None of that belongs on a fetch for a file
     *    the public download page serves to anyone.
     *
     * The baseUrl is required by Retrofit and never used — every call passes an
     * absolute @Url, so a debug build pointed at a laptop still finds the real
     * published release instead of 404-ing against a dev machine.
     */
    @Provides
    @Singleton
    fun updateManifestApi(@MediaClient client: OkHttpClient, json: Json): UpdateManifestApi =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(UpdateManifestApi::class.java)
}

/**
 * The refresh endpoint in isolation.
 *
 * Separate from CheckinApi so it can be called from inside an interceptor with a
 * client that has no interceptors of its own. Using CheckinApi here would make a
 * 401 during refresh trigger another refresh, recursively.
 */
interface RefreshOnlyApi {
    @retrofit2.http.POST("checkin/devices/refresh")
    fun refresh(@retrofit2.http.Body body: RefreshRequest): retrofit2.Call<Envelope<RefreshResponse>>
}
