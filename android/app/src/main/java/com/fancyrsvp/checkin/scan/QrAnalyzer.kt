package com.fancyrsvp.checkin.scan

import android.annotation.SuppressLint
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * CameraX analyser that decodes QR codes on-device (spec §4, §8.3).
 *
 * ── Bundled ML Kit model, not the Play-Services download ──
 *
 * The dependency is `com.google.mlkit:barcode-scanning`, which embeds the model in
 * the APK. The Play-Services variant downloads it on first use, and a fresh tablet
 * with no internet AT THE VENUE may not have it — scanning would fail at exactly
 * the moment it matters. That choice lives in libs.versions.toml with the same
 * note.
 *
 * ── Debounce lives elsewhere now ──
 *
 * §8.3's "same code within 3 seconds must not re-trigger" rule used to be a pair
 * of fields on this class. It moved to [ScanDebouncer], applied in
 * ScannerViewModel.onDecoded, when the kiosk's hardware scanner became a second
 * way for a code to reach the app.
 *
 * Nothing about the rule changed — see ScanDebouncer for why it had to move. What
 * matters here is that this class now forwards EVERY successful decode, twenty
 * times a second while a guest holds a card up, and the guard downstream is what
 * keeps that from thrashing the result screen. That is safe because onDecoded
 * returns immediately once a scan is resolving or a result is showing, and it is
 * correct because one guard covering both transports cannot disagree with itself.
 */
class QrAnalyzer(
    /**
     * Where ML Kit's completion callbacks run.
     *
     * ── The throughput bug this parameter exists to fix ──
     *
     * `Task.addOnSuccessListener(listener)` with no executor posts to the MAIN
     * THREAD. That is the Play-services default and it is the wrong one here.
     *
     * Two costs, both invisible until you look for them. Every analysed frame
     * posts a runnable onto the main queue, where it lines up behind Compose's
     * recomposition and animation work — 30 of them a second, competing with the
     * UI they are trying to update. Worse, `imageProxy.close()` lives in that
     * callback, and closing the proxy is what RELEASES THE BUFFER the camera
     * needs to hand us the next frame. So the scan pipeline's frame rate was
     * gated by main-thread latency: exactly when the UI is busiest — a result
     * screen animating in — the scanner slowed down.
     *
     * Running the callbacks on the analysis executor removes both. Nothing in
     * this class touches a View, and `onDecoded` lands on a StateFlow, which is
     * thread-safe.
     *
     * Callers MUST pass the same executor CameraX delivers frames on, so the
     * close happens on the thread that owns the buffer.
     */
    private val callbackExecutor: Executor,
    private val onDecoded: (String) -> Unit,
) : ImageAnalysis.Analyzer {

    private val scanner: BarcodeScanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            // QR only. Restricting the format set measurably speeds up detection,
            // and no other symbology is ever presented at this door.
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build(),
    )

    /**
     * Guards against overlapping analyses.
     *
     * CameraX delivers frames faster than ML Kit completes on a mid-range tablet.
     * STRATEGY_KEEP_ONLY_LATEST drops frames for us, but the callback can still be
     * re-entered while a decode is in flight; this keeps exactly one outstanding.
     */
    private val inFlight = AtomicBoolean(false)

    /**
     * Set by [close], checked by [analyze].
     *
     * ML Kit throws `IllegalStateException` from `process()` once the detector has
     * been closed, and `analyze` runs on a CAMERA thread — outside every coroutine
     * guard in this app, so that throw reaches the default uncaught handler and
     * kills the process.
     *
     * This is not a theoretical race. The screen closes the analyser when it leaves
     * composition while CameraX is still detaching its use cases asynchronously, so
     * every navigation away from the scanner — menu, guest list, entrance display —
     * gives a frame already in flight the chance to land on a closed detector. That
     * is the app vanishing at the door, several times a night, for nothing.
     */
    private val closed = AtomicBoolean(false)

    @SuppressLint("UnsafeOptInUsageError")
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (closed.get() || mediaImage == null || !inFlight.compareAndSet(false, true)) {
            imageProxy.close()
            return
        }

        // The `closed` check above narrows the window but cannot eliminate it: close()
        // can land between the check and process(). Nothing on this thread may throw.
        try {
            val input = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)

            scanner.process(input)
                .addOnSuccessListener(callbackExecutor) { barcodes ->
                    // Runs on the analysis thread — see callbackExecutor. Guarded
                    // for the same reason as everything else here: an uncaught
                    // throw on this thread is a process kill, not an exception.
                    runCatching {
                        barcodes.firstNotNullOfOrNull { it.rawValue }?.let(onDecoded)
                    }
                }
                .addOnCompleteListener(callbackExecutor) {
                    // Release the buffer FIRST, then reopen the gate. The camera
                    // cannot produce another frame until this proxy is closed, so
                    // closing before clearing `inFlight` means the next frame is
                    // already being captured while this one finishes bookkeeping.
                    //
                    // In onComplete rather than onSuccess: a failed decode must
                    // also release the frame, or the pipeline stalls after the
                    // first unreadable card and the scanner silently dies.
                    imageProxy.close()
                    inFlight.set(false)
                }
        } catch (_: Throwable) {
            // Release the slot and the frame, then wait for the next one. A camera
            // that skips a frame is invisible to an usher; a camera that takes the
            // app down with it is the whole complaint.
            inFlight.set(false)
            imageProxy.close()
        }
    }

    fun close() {
        // Flag BEFORE closing, so any frame that arrives during the close is turned
        // away rather than handed to a half-torn-down detector.
        closed.set(true)
        runCatching { scanner.close() }
    }
}
