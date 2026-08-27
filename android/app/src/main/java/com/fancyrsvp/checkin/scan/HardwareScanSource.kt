package com.fancyrsvp.checkin.scan

import android.util.Log
import com.fancyrsvp.checkin.BuildConfig
import com.tool.ScanActivity
import com.tool.SerialPortFinder
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The kiosk's physical QR scanner, as a source of decoded strings.
 *
 * ── What this is, and what it deliberately is not ──
 *
 * It is a thin adapter over the hardware manufacturer's serial SDK
 * (`libs/uart_scan_pro.jar` + `libts_serial_port.so`). Its entire job is to turn
 * "the engine decoded something" into a `String` on [decoded], so that
 * `ScannerViewModel.onDecoded` — which already exists and has not changed — cannot
 * tell whether a scan came from the camera or from the kiosk.
 *
 * It is NOT a keyboard-wedge reader. That was the earlier plan, and the
 * manufacturer's own test video ruled it out: the engine types the payload as key
 * events with no terminator at all, so three scans arrive as one 1,100-character
 * run with no boundary between them. The SDK hands over a COMPLETE, ALREADY-FRAMED
 * payload in a single callback, which removes that whole class of problem —
 * no character assembly, no terminator guessing, no fighting the search field for
 * keyboard focus.
 *
 * ── Off by default, on purpose ──
 *
 * [BuildConfig.SCANNER_PORT] is empty unless a build sets it. An empty value means
 * this class does nothing at all and the app behaves exactly as it did before.
 * That matters for two reasons:
 *
 *  • Staff tablets have no scanner. They must not pay for probing hardware that
 *    is not there.
 *  • The kiosk has a thermal printer on the same board, and it may well be on a
 *    serial port too. Opening ports speculatively on a device we have not
 *    characterised risks talking over the printer. A build that wants the scanner
 *    says so.
 *
 * Set `SCANNER_PORT=auto` in local.properties to probe every serial node the
 * board exposes — which is how the first kiosk brings back the answer — or pin it
 * to a path such as `/dev/ttyS1` once that answer is known.
 *
 * ── Nothing here may take the app down ──
 *
 * Every call into the vendor SDK is wrapped. Three of the failures are not
 * hypothetical:
 *
 *  • `UnsatisfiedLinkError` if the running device's ABI has no `.so`. It is
 *    thrown from a static initialiser, so it surfaces as the first touch of a
 *    vendor class rather than at a call site that looks dangerous.
 *  • `SecurityException` / IO failure if the process cannot open the device node.
 *    The SDK's own fallback for that is to shell out to `su` and `chmod 666`,
 *    which will simply fail on a device without root — see the report.
 *  • A native crash in the decode thread, which no Kotlin construct can catch.
 *    That one is the reason the port is opened once and left alone rather than
 *    being reopened on a timer.
 *
 * All three degrade to the same thing: [ready] stays false, the camera keeps
 * working, and the door keeps moving.
 */
@Singleton
class HardwareScanSource @Inject constructor(
    private val io: CoroutineDispatcher,
) {

    /**
     * Decoded payloads, exactly as the engine produced them.
     *
     * A SharedFlow rather than a StateFlow: two identical scans in a row are two
     * events, and a StateFlow would silently swallow the second by conflating it
     * with the first. Deduplication is [ScanDebouncer]'s job, applied downstream,
     * and it has to be able to see both to do it.
     */
    private val _decoded = MutableSharedFlow<String>(
        extraBufferCapacity = 8,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val decoded: SharedFlow<String> = _decoded.asSharedFlow()

    /**
     * Whether the scanner is usable.
     *
     * Seeded optimistically the moment a port opens, rather than waiting for the
     * engine's state callback, and this is deliberate. The vendor's own sample
     * only ever shows that callback firing with state 1, and nothing in their
     * documentation promises it is sent on connect rather than only on a
     * transition. A screen that waits for it could sit on "camera not available"
     * all night beside a scanner that is reading tickets perfectly.
     *
     * Once the engine does speak, it wins — it knows more than we do.
     */
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    private val started = AtomicBoolean(false)

    /**
     * @Volatile because it is written on whichever IO thread ran [start] and read
     * on whichever one runs a later retry. Dispatchers.IO is a pool, so "both on
     * the IO dispatcher" is not the same as "both on one thread", and without this
     * a retry could see a stale null and leak the engine it was meant to replace.
     */
    @Volatile
    private var engine: ScanActivity? = null

    /** True when this build is configured to use a hardware scanner at all. */
    val isEnabled: Boolean get() = BuildConfig.SCANNER_PORT.isNotBlank()

    /**
     * Opens the scanner, once.
     *
     * Idempotent, and deliberately never closed by the screen that calls it. The
     * scanner screen is home; an operator stepping into the guest list for ten
     * seconds must not cost a port teardown and re-open, and a serial handle held
     * for the length of a shift costs nothing. Scans that arrive while another
     * screen is showing are simply not collected by anyone, which is the correct
     * outcome — [decoded] has no replay.
     */
    suspend fun start() {
        if (!isEnabled) return
        if (!started.compareAndSet(false, true)) return

        withContext(io) {
            val outcome = runCatching { open() }
            outcome.exceptionOrNull()?.let { error ->
                /*
                 * Release before resetting the flag, or a retry leaks the engine.
                 *
                 * By the time open() can fail we have already constructed a
                 * ScanActivity, registered both callbacks on it and called
                 * ts_scan_init() — which starts the SDK's own reader thread.
                 * Abandoning that object and building a fresh one on the next
                 * attempt would leave the old reader running with OUR callbacks
                 * still attached to it, so a later decode could arrive twice, from
                 * two engines, for one presentation of one card.
                 */
                releaseEngine()
                started.set(false)
                _ready.value = false
                // A missing .so, a permission refusal and an absent scanner all
                // land here and all mean the same thing to an usher: use the
                // camera.
                Log.w(TAG, "scanner unavailable", error)
            }
        }
    }

    /** Best-effort teardown. Every step is optional; none may throw. */
    private fun releaseEngine() {
        val scan = engine ?: return
        runCatching { scan.ts_scan_decode_stop() }
        runCatching { scan.ts_scan_uart_close() }
        runCatching { scan.ts_scan_deinit() }
        engine = null
    }

    private fun open() {
        val scan = ScanActivity()
        engine = scan

        // Registered BEFORE the port is opened, so a decode that lands during
        // bring-up is not dropped on the floor.
        scan.ts_scan_get_data_fun_register(null, dataCallback)
        scan.ts_scan_state_fun_register(null, stateCallback)

        // Plain point-to-point, not the RS485 multi-drop addressing mode. The
        // vendor's own sample sets this explicitly rather than trusting the
        // default, and one scanner on one port is exactly the normal case.
        //
        // .toByte() is not decoration: the SDK declares this parameter as a Java
        // `byte`, and Kotlin will not widen an Int literal to it.
        runCatching { scan.ts_scan_set_rs485_net_mode(0.toByte()) }

        runCatching { scan.ts_scan_init() }

        // Populates the SDK's internal port list. Its return value is unused by
        // the vendor's sample too; discovery for our purposes goes through
        // SerialPortFinder below, which reads /proc/tty/drivers.
        runCatching { scan.ts_scan_uart_findPorts() }

        val opened = candidatePorts().firstOrNull { port ->
            val result = runCatching { scan.ts_scan_uart_open(port, BuildConfig.SCANNER_BAUD) }
                .getOrDefault(FAILED)
            Log.i(TAG, "open $port @${BuildConfig.SCANNER_BAUD} -> $result")
            result != FAILED
        }

        if (opened == null) {
            throw IllegalStateException("no serial port could be opened")
        }

        Log.i(TAG, "scanner attached on $opened @${BuildConfig.SCANNER_BAUD}")

        // Optimistic, and set here rather than left to the state callback — see
        // the note on [ready]. A port that opened is a scanner we can use.
        _ready.value = true

        // Ask the engine to start decoding. In auto-induction — the mode the
        // manufacturer configures for self-service — the engine triggers itself on
        // a brightness change and this is a no-op. It matters only if the unit
        // ships in host-trigger mode, where nothing is scanned until asked.
        runCatching { scan.ts_scan_decode_start() }

        // Identity, for the crash log and for telling two kiosks apart in a
        // support conversation. Best-effort: an engine that will not answer these
        // can still scan perfectly well.
        runCatching {
            val version = scan.ts_scan_get_version()
            val type = scan.ts_scan_get_product_type()
            Log.i(TAG, "sdk=$version productType=$type")
        }
    }

    /**
     * Which device nodes to try.
     *
     * A pinned path is used alone. `auto` walks everything the board exposes as a
     * serial driver, which is how the first kiosk tells us what the right answer
     * is — the log line above names the port that worked.
     */
    private fun candidatePorts(): List<String> {
        val configured = BuildConfig.SCANNER_PORT
        if (!configured.equals(AUTO, ignoreCase = true)) return listOf(configured)

        // getAllDevicesPath() walks /proc/tty/drivers for drivers of type "serial"
        // and returns the absolute path of every matching node under /dev.
        val found = runCatching { SerialPortFinder().getAllDevicesPath()?.toList().orEmpty() }
            .getOrDefault(emptyList())
            .filter { it.isNotBlank() }
        Log.i(TAG, "serial nodes discovered: $found")
        return found
    }

    /**
     * The decode callback. Runs on a thread owned by the vendor's native code —
     * outside every dispatcher and every coroutine guard in this app.
     *
     * Nothing in here may throw. An exception on a native callback thread does not
     * become a Kotlin exception; it reaches the default uncaught handler and takes
     * the process with it, at a door, mid-shift.
     */
    private val dataCallback = object : ScanActivity.TsDataCallBack {
        override fun ts_get_data_fun(pParam: ByteArray?, pbuf: ByteArray?, uiBufLen: Int): Int {
            runCatching {
                if (pbuf == null || uiBufLen <= 0 || uiBufLen > pbuf.size) return@runCatching

                // UTF-8 rather than the platform default. Our ticket is pure ASCII
                // so the two agree today, but the platform default is a property of
                // the device and this is a property of the data.
                val payload = String(pbuf, 0, uiBufLen, Charsets.UTF_8).trim()
                if (payload.isEmpty()) return@runCatching

                // Length only. The payload is a bearer credential for a guest's
                // admission and §20.7 keeps personal data out of logs entirely.
                Log.i(TAG, "decoded ${payload.length} chars")

                _decoded.tryEmit(payload)
            }
            return 0
        }
    }

    /**
     * Presence, as reported by the engine. `1` is its "connected" state, per the
     * vendor's sample.
     *
     * Authoritative once it speaks — it overrides the optimistic value [start]
     * set when the port opened, in both directions. An engine that reports itself
     * gone is a better source than our assumption that it is there.
     */
    private val stateCallback = object : ScanActivity.TsStateCallBack {
        override fun ts_scan_state_fun(pParam: ByteArray?, ucState: Byte): Int {
            runCatching {
                _ready.value = ucState.toInt() == STATE_CONNECTED
                Log.i(TAG, "scanner state=$ucState")
            }
            return 0
        }
    }

    /*
     * There is deliberately no public stop().
     *
     * The port belongs to the process, not to a screen or an event. A kiosk runs
     * one app for a shift; closing an event purges GUEST data, and the scanner
     * holds none of that, so tearing the port down there would cost a reopen for
     * no benefit. The kernel closes the descriptor when the process dies, which
     * is the only moment this genuinely ends.
     *
     * [releaseEngine] exists for the failure path, which is a different question:
     * cleaning up an engine that never worked.
     */

    private companion object {
        const val TAG = "HardwareScanSource"

        /** `ts_scan_uart_open` returns -1 on failure, per the vendor's sample. */
        const val FAILED = -1

        /** `ucState == 1` in the vendor's sample means the engine answered. */
        const val STATE_CONNECTED = 1

        const val AUTO = "auto"
    }
}
