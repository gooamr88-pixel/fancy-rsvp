package com.fancyrsvp.checkin.scan

import javax.inject.Inject
import javax.inject.Singleton

/**
 * The one rule that stops a guest being admitted twice for one presentation.
 *
 * ── Why this is no longer inside QrAnalyzer ──
 *
 * It used to live in the camera analyser, which was correct while the camera was
 * the only way a code could reach the app. It is not any more: the kiosk's
 * hardware scanner delivers a decoded string straight from the vendor SDK, on a
 * completely different thread, having never touched CameraX.
 *
 * A guard that sits inside one transport protects one transport. Leaving it there
 * would have meant the new source arrived with no duplicate protection at all —
 * and the manufacturer has told us in writing that this engine "will scan twice
 * very quickly", which their own test video shows: one ticket, three copies of
 * the payload, back to back.
 *
 * So the rule moved UP, to the point both transports converge on
 * (`ScannerViewModel.onDecoded`). One rule, both sources, and a card presented to
 * the camera and the scanner at the same moment is admitted once.
 *
 * ── The rule itself is unchanged ──
 *
 * Keyed on the DECODED VALUE, not on time alone. Two different guests presenting
 * back-to-back are both admitted immediately; only a repeat of the same code
 * waits. That was the right behaviour before and copying it exactly is the point:
 * this refactor must not change what an usher sees.
 *
 * ── Thread safety is new, and required ──
 *
 * The old version was confined to a single analysis thread. This one is called
 * from the camera analysis thread AND from a native callback thread owned by the
 * scanner SDK, which is outside every dispatcher this app controls. Unsynchronised
 * read-modify-write across those two would let a duplicate through precisely when
 * both fire at once — which is the case it exists to stop.
 */
@Singleton
class ScanDebouncer @Inject constructor() {

    private val lock = Any()
    private var lastValue: String? = null
    private var lastAcceptedAt: Long = 0L

    /**
     * @return true when this value should be acted on, false when it is a repeat
     *   inside the window and must be dropped.
     */
    fun accept(value: String, nowMillis: Long = System.currentTimeMillis()): Boolean {
        // Block body, not an expression body: Kotlin rejects `return` inside a
        // function declared with `= expr`, even when the return sits in an inline
        // lambda like synchronized's.
        synchronized(lock) {
            if (value == lastValue && nowMillis - lastAcceptedAt < WINDOW_MS) return false
            lastValue = value
            lastAcceptedAt = nowMillis
            return true
        }
    }

    /**
     * Clears the window.
     *
     * Called when a result screen is dismissed, so a guest whose first scan was
     * mis-tapped can present the same card again immediately rather than waiting
     * it out with a queue behind them.
     */
    fun reset() = synchronized(lock) {
        lastValue = null
        lastAcceptedAt = 0L
    }

    private companion object {
        /**
         * Three seconds, carried over unchanged from QrAnalyzer.
         *
         * Comfortably longer than the "twice very quickly" burst the manufacturer
         * described, and short enough that a guest re-presenting a card after a
         * genuine misread is not left waiting.
         */
        const val WINDOW_MS = 3_000L
    }
}
