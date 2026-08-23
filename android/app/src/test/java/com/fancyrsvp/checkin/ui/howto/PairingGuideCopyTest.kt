package com.fancyrsvp.checkin.ui.howto

import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * The pairing guide tells an operator which buttons to press in a web dashboard
 * that lives in another part of this repository and ships on its own schedule.
 *
 * ── Why this test exists ──
 *
 * Nothing else connects the two. The guide hardcodes "Check-in setup",
 * "Tablets", "Create pairing code" and the rest, because they are labels an
 * operator is reading in English on another screen and translating them would
 * make them useless. Hardcoded, unreferenced strings drift silently: rename a
 * tab in the dashboard and the tablet goes on giving confident, wrong
 * directions to the one person least able to work out why.
 *
 * That is not hypothetical. The first version of this copy said "Go to Check-in
 * devices, tap Add device" — a button that has never existed — and it omitted
 * the seating-map step entirely, which is the one that actually blocks people.
 *
 * ── What a failure here means ──
 *
 * NOT that the dashboard is broken. It means the dashboard was changed and the
 * tablet's instructions now lie. Fix `PairingArtwork.kt` and the `howto_*`
 * strings to match, then update the expected value here.
 *
 * ── Why it skips instead of failing when the frontend is absent ──
 *
 * The Android module is sometimes checked out or built on its own, and a test
 * that cannot see `frontend/` has learned nothing — failing there would train
 * people to ignore this file, which defeats it.
 */
class PairingGuideCopyTest {

    /**
     * Gradle runs unit tests with the module directory as the working directory,
     * so the repository root is two levels up. Walked rather than hardcoded as
     * "../..", so moving the module surfaces as a skip instead of a false pass.
     *
     * A `while` with an elvis-return rather than `repeat { }`: a local var
     * reassigned inside a lambda cannot be smart-cast, so the closure version
     * does not compile.
     */
    private fun repoRoot(): File? {
        var dir: File? = File("").absoluteFile
        var depth = 0
        while (depth < MAX_WALK_UP) {
            val here = dir ?: return null
            if (File(here, "frontend/src/app/dashboard").isDirectory) return here
            dir = here.parentFile
            depth++
        }
        return null
    }

    private fun dashboardFile(relative: String): File? =
        repoRoot()?.let { File(it, relative) }?.takeIf { it.isFile }

    @Test
    fun `check-in setup page still uses the labels the guide names`() {
        val page = dashboardFile("frontend/src/app/dashboard/checkin-setup/page.js")
        assumeTrue("frontend/ not present — nothing to check against", page != null)
        val source = page!!.readText()

        // Quoted by ArtDashboard and ArtCreateCode, and by howto_1_body /
        // howto_3_body.
        assertContains(source, "Check-in setup", "the page heading the guide sends people to")
        assertContains(source, "Before the event", "the tab group named in howto_3_body")
        assertContains(source, "Tablets", "the tab the guide tells them to choose")
    }

    @Test
    fun `device panel still uses the labels the guide names`() {
        val panel = dashboardFile("frontend/src/app/dashboard/components/DeviceManagement.js")
        assumeTrue("frontend/ not present — nothing to check against", panel != null)
        val source = panel!!.readText()

        assertContains(source, "Check-in devices", "the panel title drawn in ArtCreateCode")
        assertContains(source, "Create pairing code", "THE button the whole guide leads to")
        // The prerequisite the guide's step 2 exists for. If this copy goes, the
        // gate requirement has probably changed and step 2 may be wrong or
        // unnecessary.
        assertContains(
            source,
            "seating map",
            "the gate prerequisite that howto_2_body and howto_2_note explain",
        )
    }

    @Test
    fun `pairing code shape still matches what the guide promises`() {
        val service = dashboardFile("backend/services/checkinDeviceService.js")
        assumeTrue("backend/ not present — nothing to check against", service != null)
        val source = service!!.readText()

        // howto_4_body promises no O, zero, I, one or L. That promise is only
        // true while the server's alphabet excludes them.
        assertContains(
            source,
            "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
            "the unambiguous alphabet howto_4_body describes",
        )
        // howto_4_note promises ten minutes.
        assertContains(
            source,
            "PAIRING_CODE_TTL_MS = 10 * 60 * 1000",
            "the 10-minute expiry howto_4_note states",
        )
    }

    private companion object {
        /** android/app → android → repo root is two; six is slack, not a guess. */
        const val MAX_WALK_UP = 6
    }

    private fun assertContains(haystack: String, needle: String, why: String) {
        if (!haystack.contains(needle)) {
            throw AssertionError(
                "The pairing guide names \"$needle\" — $why — but it is no longer in the " +
                    "dashboard source. The tablet is now giving wrong instructions. " +
                    "Update PairingArtwork.kt and the howto_* strings, then update this test.",
            )
        }
    }
}
