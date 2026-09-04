package com.fancyrsvp.checkin.data.repo

import com.fancyrsvp.checkin.data.remote.UpdateManifestDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The update gate decides whether a tablet is interrupted. Every branch here has
 * a failure that reaches a person: one way it nags at a door, the other way the
 * fleet never updates and somebody is told to uninstall and reinstall again.
 *
 * Runs in :app:testReleaseUnitTest, which deploy-android.bat executes on every
 * deploy — so a regression here stops a release rather than reaching a venue.
 */
class UpdateGateTest {

    private val good = UpdateManifestDto(
        versionCode = 200,
        versionName = "1.7.0",
        sha256 = "a".repeat(64),
        sizeBytes = 46_000_000,
        minSdk = 26,
        notes = "Two-device undo fixed.",
        url = "https://fancyrsvp.com/download/fancy-checkin.apk",
    )

    private fun evaluate(
        manifest: UpdateManifestDto? = good,
        installed: Long = 100,
        dismissed: Long = 0,
        unsent: Int = 0,
        sdk: Int = 34,
    ) = UpdateGate.evaluate(manifest, installed, dismissed, unsent, sdk)

    @Test
    fun `a newer build is offered`() {
        assertEquals(UpdateGate.Verdict.OFFER, evaluate())
    }

    @Test
    fun `the same build is never offered to itself`() {
        assertEquals(UpdateGate.Verdict.UP_TO_DATE, evaluate(installed = 200))
    }

    @Test
    fun `a device ahead of the server is left alone`() {
        // A rollback happened. Android would refuse the downgrade anyway, so
        // offering it would only produce a failure nobody can act on.
        assertEquals(UpdateGate.Verdict.UP_TO_DATE, evaluate(installed = 500))
    }

    @Test
    fun `an unreadable manifest is silence, not an error`() {
        // Offline, 404, malformed JSON — all arrive here as null. A version
        // check must never produce something a person has to read.
        assertEquals(UpdateGate.Verdict.UP_TO_DATE, evaluate(manifest = null))
    }

    @Test
    fun `saying Later silences that build only`() {
        assertEquals(UpdateGate.Verdict.DISMISSED, evaluate(dismissed = 200))
        // ...and the NEXT build asks again. One tap in an office must not opt a
        // tablet out of every future fix.
        assertEquals(
            UpdateGate.Verdict.OFFER,
            evaluate(manifest = good.copy(versionCode = 201), dismissed = 200),
        )
    }

    @Test
    fun `a queue holding unsent check-ins is never interrupted`() {
        assertEquals(UpdateGate.Verdict.BUSY, evaluate(unsent = 1))
    }

    @Test
    fun `a build needing a newer Android than this tablet is not offered`() {
        assertEquals(UpdateGate.Verdict.UNUSABLE, evaluate(sdk = 25))
        // minSdk absent from an older manifest must not block the update.
        assertEquals(
            UpdateGate.Verdict.OFFER,
            evaluate(manifest = good.copy(minSdk = 0), sdk = 21),
        )
    }

    @Test
    fun `a manifest we could not act on is refused before it is dismissed`() {
        // Each of these would have the operator tap Update and watch it fail,
        // then see the same screen tomorrow.
        assertEquals(UpdateGate.Verdict.UNUSABLE, evaluate(manifest = good.copy(url = "http://x/a.apk")))
        assertEquals(UpdateGate.Verdict.UNUSABLE, evaluate(manifest = good.copy(sha256 = "short")))
        assertEquals(UpdateGate.Verdict.UNUSABLE, evaluate(manifest = good.copy(sha256 = "Z".repeat(64))))
        assertEquals(UpdateGate.Verdict.UNUSABLE, evaluate(manifest = good.copy(sizeBytes = 0)))
    }

    @Test
    fun `a broken publish does not consume the operator's dismissal`() {
        // UNUSABLE is decided before DISMISSED on purpose: a bad manifest must
        // not burn the one dismissal, or fixing the publish would still leave
        // every tablet silent.
        assertEquals(
            UpdateGate.Verdict.UNUSABLE,
            evaluate(manifest = good.copy(sizeBytes = 0), dismissed = 200),
        )
    }

    @Test
    fun `free space is sized for the installer's own copy too`() {
        val apk = 46_000_000L
        assertTrue(
            "the installer copies the APK before installing it",
            UpdateGate.requiredFreeBytes(apk) >= apk * 2,
        )
    }
}
