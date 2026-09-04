package com.fancyrsvp.checkin.data.repo

import com.fancyrsvp.checkin.data.remote.UpdateManifestDto

/**
 * WHETHER an update should be offered — the whole decision, with no Android in
 * it, so it can be tested on the JVM.
 *
 * Every rule here has a way of going wrong that ends with a tablet nagging
 * somebody at a door, or with a tablet that never updates at all. Both are worse
 * than the feature not existing, so the logic lives apart from the plumbing and
 * is pinned by UpdateGateTest.
 */
object UpdateGate {

    /** Why an available build is not being offered right now. */
    enum class Verdict {
        /** Offer it. */
        OFFER,

        /** Nothing newer is published. */
        UP_TO_DATE,

        /** Newer, but this operator already said Later to this exact build. */
        DISMISSED,

        /** The manifest does not describe a build this device can install. */
        UNUSABLE,

        /** Work is still queued. Never interrupt a device holding evidence. */
        BUSY,
    }

    /**
     * @param manifest what the server published, or null when it could not be
     *   read at all — offline, 404, malformed. Null is never an error here: a
     *   version check must not produce something a person has to read.
     * @param installedVersionCode BuildConfig.VERSION_CODE
     * @param dismissedVersionCode the last build this operator said Later to, 0
     *   for none
     * @param unsentEvidence rows in the outbound queue that exist nowhere else
     * @param deviceSdk Build.VERSION.SDK_INT
     */
    fun evaluate(
        manifest: UpdateManifestDto?,
        installedVersionCode: Long,
        dismissedVersionCode: Long,
        unsentEvidence: Int,
        deviceSdk: Int,
    ): Verdict {
        if (manifest == null) return Verdict.UP_TO_DATE

        /*
         * `<=`, not `<`. Equal means this IS the published build, and an app that
         * offers to install itself is the kind of loop that gets a tablet wiped.
         * A LOWER published code also lands here: a rollback has happened and the
         * device is ahead of the server. Android would refuse that install
         * outright, so offering it would only produce a failure the operator
         * cannot act on.
         */
        if (manifest.versionCode <= installedVersionCode) return Verdict.UP_TO_DATE

        /*
         * A manifest that cannot be acted on is worse than none: the operator
         * taps Update, the download fails, and the screen comes back tomorrow.
         * Checked before the dismissal so a broken publish never consumes the
         * one dismissal an operator gets.
         */
        if (!manifest.url.startsWith("https://")) return Verdict.UNUSABLE
        if (manifest.sha256.length != SHA256_HEX_LENGTH) return Verdict.UNUSABLE
        if (!manifest.sha256.all { it in HEX }) return Verdict.UNUSABLE
        if (manifest.sizeBytes <= 0) return Verdict.UNUSABLE

        // A build that needs a newer Android than this tablet runs cannot be
        // installed, and saying so is more useful than letting the installer
        // refuse it after a 46 MB download.
        if (manifest.minSdk > 0 && deviceSdk < manifest.minSdk) return Verdict.UNUSABLE

        /*
         * Dismissal is per BUILD, not forever. Saying Later to 1.6.1 must not
         * silence 1.7.0 — otherwise one tap in an office opts a tablet out of
         * every future fix, which is exactly the failure this feature exists to
         * end.
         */
        if (manifest.versionCode <= dismissedVersionCode) return Verdict.DISMISSED

        /*
         * Installing restarts the process. The database survives it, but a queue
         * holding check-ins that exist on this tablet and nowhere else is not
         * something to restart around for a version number.
         */
        if (unsentEvidence > 0) return Verdict.BUSY

        return Verdict.OFFER
    }

    /**
     * Bytes that must be free before the download starts.
     *
     * Twice the APK plus headroom: the download lands on disk, and then the
     * package installer takes its OWN copy before installing. Sizing for one
     * copy is how a 46 MB update fails at 99% on a tablet that also has to hold
     * a 2,000-guest bundle.
     */
    fun requiredFreeBytes(apkBytes: Long): Long = apkBytes * 2 + HEADROOM_BYTES

    private const val SHA256_HEX_LENGTH = 64
    private val HEX = ('0'..'9') + ('a'..'f')
    private const val HEADROOM_BYTES = 200L * 1024 * 1024
}
