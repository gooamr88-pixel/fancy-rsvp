package com.fancyrsvp.checkin.data.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-backed storage for the three secrets this app holds (spec §20.2):
 * the device access token, the device refresh token, and the local database
 * passphrase.
 *
 * ── Design constraints, each with a reason ──
 *
 * • Keys are generated ON DEVICE and never transmitted. Uninstalling destroys
 *   them, which correctly renders any residual local data unrecoverable.
 *
 * • Key access must NOT require user authentication at the Keystore level.
 *   The sync engine drains the queue in the background while the screen is
 *   locked; `setUserAuthenticationRequired(true)` would make it fail there.
 *   The PIN-on-resume requirement (§20.4) is enforced in the UI layer, which is
 *   the right place for it — a locked screen must not stop a background drain.
 *
 * • Secrets NEVER go to SharedPreferences in plaintext, plain files, source, or
 *   logs. The ciphertext below lives in SharedPreferences, but the AES-GCM key
 *   that decrypts it is hardware-backed where available and never leaves the
 *   Keystore.
 *
 * AES-GCM is used directly rather than via EncryptedSharedPreferences because
 * the database passphrase must be retrievable as a raw ByteArray for SQLCipher,
 * and Jetpack Security's API is String-oriented.
 */
class SecureStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private fun secretKey(): SecretKey {
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // Deliberately false — see the class comment. A background drain
                // must be able to decrypt while the screen is locked.
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val body = cipher.doFinal(plain)
        // iv || ciphertext. The IV is generated per-encryption by the provider
        // and must never be reused with the same key under GCM.
        return Base64.encodeToString(iv + body, Base64.NO_WRAP)
    }

    // Block body, not an expression body: the length guard below is a `return`,
    // and Kotlin prohibits `return` inside an expression body.
    private fun decrypt(encoded: String): ByteArray? {
        return try {
            val all = Base64.decode(encoded, Base64.NO_WRAP)
            // Anything this short cannot contain an IV plus a tag, so it is not
            // something we wrote. copyOfRange would throw on it.
            if (all.size <= GCM_IV_BYTES) return null
            val iv = all.copyOfRange(0, GCM_IV_BYTES)
            val body = all.copyOfRange(GCM_IV_BYTES, all.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.doFinal(body)
        } catch (_: Exception) {
            // A failure here means the Keystore key is gone (device reset, app data
            // cleared, restore onto different hardware). The correct response is to
            // treat the secret as absent and re-pair — never to crash, and never to
            // fall back to an unencrypted path.
            null
        }
    }

    private fun putSecret(key: String, value: ByteArray) {
        prefs.edit().putString(key, encrypt(value)).apply()
    }

    private fun getSecret(key: String): ByteArray? =
        prefs.getString(key, null)?.let { decrypt(it) }

    // ── Device credentials (§18.4) ──

    var accessToken: String?
        get() = getSecret(KEY_ACCESS)?.toString(Charsets.UTF_8)
        set(value) {
            if (value == null) prefs.edit().remove(KEY_ACCESS).apply()
            else putSecret(KEY_ACCESS, value.toByteArray(Charsets.UTF_8))
        }

    var refreshToken: String?
        get() = getSecret(KEY_REFRESH)?.toString(Charsets.UTF_8)
        set(value) {
            if (value == null) prefs.edit().remove(KEY_REFRESH).apply()
            else putSecret(KEY_REFRESH, value.toByteArray(Charsets.UTF_8))
        }

    /** Non-secret pairing metadata, safe in plaintext. */
    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) { prefs.edit().putString(KEY_DEVICE_ID, value).apply() }

    var deviceLabel: String?
        get() = prefs.getString(KEY_DEVICE_LABEL, null)
        set(value) { prefs.edit().putString(KEY_DEVICE_LABEL, value).apply() }

    var pairedEventId: String?
        get() = prefs.getString(KEY_PAIRED_EVENT, null)
        set(value) { prefs.edit().putString(KEY_PAIRED_EVENT, value).apply() }

    /**
     * The newest build this operator has said "Later" to, or 0 for none.
     *
     * Plaintext with the rest of the non-secret metadata: it is a version
     * number, and hiding it would protect nothing.
     *
     * Deliberately NOT cleared by [clearDeviceCredentials]. Unpairing hands the
     * tablet to another event, not to another world — the build installed on it
     * is the same one the operator already declined, and asking again the moment
     * it is re-paired would make "Later" mean nothing.
     */
    var dismissedUpdateVersionCode: Long
        get() = prefs.getLong(KEY_DISMISSED_UPDATE, 0L)
        set(value) { prefs.edit().putLong(KEY_DISMISSED_UPDATE, value).apply() }

    val isPaired: Boolean get() = accessToken != null && deviceId != null

    /**
     * Clears device credentials on revocation (§18.4).
     *
     * Deliberately does NOT purge guest data — that is BundleDao.purgeGuestData,
     * and it must only run once the sync queue is confirmed empty. Wiping
     * credentials and wiping data are separate decisions with different
     * preconditions, and collapsing them risks destroying unsynced check-ins.
     */
    fun clearDeviceCredentials() {
        prefs.edit()
            .remove(KEY_ACCESS).remove(KEY_REFRESH)
            .remove(KEY_DEVICE_ID).remove(KEY_DEVICE_LABEL).remove(KEY_PAIRED_EVENT)
            .apply()
    }

    // ── Database passphrase (§20.3) ──

    /**
     * Returns the SQLCipher passphrase, generating one on first use.
     *
     * The caller must treat the returned array as consumed: SQLCipher's
     * SupportOpenHelperFactory zeroes it.
     */
    fun databasePassphrase(): ByteArray {
        getSecret(KEY_DB_PASSPHRASE)?.let { return it }

        val generated = ByteArray(32)
        java.security.SecureRandom().nextBytes(generated)
        putSecret(KEY_DB_PASSPHRASE, generated)
        // Return a copy: the stored value is what matters, and the caller's copy
        // gets zeroed by SQLCipher.
        return generated.copyOf()
    }

    private companion object {
        const val PREFS = "fancy_checkin_secure"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "fancy_checkin_master"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_IV_BYTES = 12
        const val GCM_TAG_BITS = 128

        const val KEY_ACCESS = "access_token"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEVICE_LABEL = "device_label"
        const val KEY_PAIRED_EVENT = "paired_event_id"
        const val KEY_DB_PASSPHRASE = "db_passphrase"
        const val KEY_DISMISSED_UPDATE = "dismissed_update_version_code"
    }
}
