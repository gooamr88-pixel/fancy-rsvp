package com.fancyrsvp.checkin.scan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins the duplicate-scan rule.
 *
 * This is the one piece of the kiosk-scanner work that is worth testing without a
 * device, because it is the piece that decides whether a guest can be admitted
 * twice. It also has to keep behaving exactly as it did when it lived inside
 * QrAnalyzer — the move was a refactor, and a refactor that changes behaviour at
 * a door is a defect.
 *
 * The clock is injected rather than slept through: a test that waits three real
 * seconds to prove a three-second window is a test nobody runs twice.
 */
class ScanDebouncerTest {

    private val ticket = "https://fancyrsvp.com/ticket/eyJhbGciOiJIUzI1NiJ9.eyJwIjoiMSJ9.sig"
    private val other = "https://fancyrsvp.com/ticket/eyJhbGciOiJIUzI1NiJ9.eyJwIjoiMiJ9.sig"

    @Test
    fun `first scan is accepted`() {
        val d = ScanDebouncer()
        assertTrue(d.accept(ticket, nowMillis = 0L))
    }

    @Test
    fun `same value inside the window is refused`() {
        val d = ScanDebouncer()
        d.accept(ticket, nowMillis = 0L)

        // The manufacturer's engine "will scan twice very quickly" — their words,
        // and visible in their own test video as two payloads back to back.
        assertFalse(d.accept(ticket, nowMillis = 40L))
        assertFalse(d.accept(ticket, nowMillis = 1_500L))
        assertFalse(d.accept(ticket, nowMillis = 2_999L))
    }

    @Test
    fun `same value once the window has passed is accepted`() {
        val d = ScanDebouncer()
        d.accept(ticket, nowMillis = 0L)
        assertTrue(d.accept(ticket, nowMillis = 3_000L))
    }

    @Test
    fun `a different value is never delayed`() {
        val d = ScanDebouncer()
        d.accept(ticket, nowMillis = 0L)

        // Two guests presenting back to back must both be admitted immediately.
        // A time-only debounce would have refused the second one, which is the
        // reason this rule is keyed on the value.
        assertTrue(d.accept(other, nowMillis = 10L))
    }

    @Test
    fun `the window follows the most recent accepted value`() {
        val d = ScanDebouncer()
        d.accept(ticket, nowMillis = 0L)
        d.accept(other, nowMillis = 10L)

        // `ticket` is no longer the last value, so it is admitted again straight
        // away. That is the existing behaviour, carried over unchanged: the rule
        // remembers one code, not a history.
        assertTrue(d.accept(ticket, nowMillis = 20L))
    }

    @Test
    fun `reset clears the window`() {
        val d = ScanDebouncer()
        d.accept(ticket, nowMillis = 0L)
        assertFalse(d.accept(ticket, nowMillis = 100L))

        // What dismiss() calls, so a guest whose first scan was mis-tapped can
        // present the same card again rather than waiting the window out.
        d.reset()
        assertTrue(d.accept(ticket, nowMillis = 101L))
    }

    @Test
    fun `repeated refusals do not extend the window past its start`() {
        val d = ScanDebouncer()
        d.accept(ticket, nowMillis = 0L)

        // A card left lying in front of the scanner is refused twenty times a
        // second. None of those refusals may count as an acceptance, or the
        // window would never expire and the card could never be re-presented.
        for (t in 100L until 3_000L step 100L) {
            assertFalse("unexpectedly accepted at $t", d.accept(ticket, nowMillis = t))
        }
        assertTrue(d.accept(ticket, nowMillis = 3_000L))
    }
}
