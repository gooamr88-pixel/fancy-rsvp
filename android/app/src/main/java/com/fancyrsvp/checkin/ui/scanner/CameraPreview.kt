package com.fancyrsvp.checkin.ui.scanner

import android.annotation.SuppressLint
import android.view.MotionEvent
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.TorchState
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import androidx.lifecycle.repeatOnLifecycle
import com.fancyrsvp.checkin.scan.QrAnalyzer
import kotlinx.coroutines.delay
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit

/**
 * What the camera pipeline is actually doing, as the screen needs to see it.
 *
 * [Starting] and [Unavailable] used to be the same thing — a black rectangle —
 * and that is the whole reason this type exists. Bring-up takes a moment on a
 * cold tablet, so a black frame is normal for the first half-second and must not
 * flash an error panel. It is also what a permanently failed bind looks like,
 * and THAT must not be left as a black rectangle with live chrome over it: the
 * operator has no way to tell "wait a second" from "this will never work", and
 * the one thing they need to know is that SEARCH BY NAME is now the way in.
 */
enum class CameraStatus { Starting, Running, Unavailable }

/**
 * The camera's own state, hoisted so the screen's chrome can read it.
 *
 * The bottom bar needs [hasFlash] to decide whether a torch control is a control
 * or a lie, and [torchActive] because the button's colour is the only indication
 * of whether the light is on — a value the app cannot know by remembering what
 * it last asked for. See the torch effect below.
 */
@Stable
class CameraController {
    var status by mutableStateOf(CameraStatus.Starting)
        internal set

    /** False on a device with no flash unit — most front-facing-only tablets. */
    var hasFlash by mutableStateOf(false)
        internal set

    /** The torch as the CAMERA reports it, not as the UI last requested it. */
    var torchActive by mutableStateOf(false)
        internal set

    /** Bumped by [retry] to force a full re-bind. */
    var attempt by mutableStateOf(0)
        private set

    /**
     * Tear the pipeline down and build it again.
     *
     * Worth offering because the most common bring-up failure at a venue is
     * another app holding the camera — a scanner left running, an OEM camera
     * widget — and that clears on its own. Without this the only fix is killing
     * the app, which on a paired tablet mid-shift is a much bigger ask.
     */
    fun retry() {
        status = CameraStatus.Starting
        hasFlash = false
        torchActive = false
        attempt++
    }
}

@Composable
fun rememberCameraController(): CameraController = remember { CameraController() }

/**
 * CameraX preview bound to the lifecycle.
 *
 * KEEP_ONLY_LATEST because a backlog of stale frames is useless at a door — the
 * guest has already moved the card. Binding to the lifecycle owner means the
 * preview pauses when the app is backgrounded, which §11 requires for battery.
 *
 * ── Why every camera call here is guarded ──
 *
 * This block runs on the main executor, NOT inside a coroutine, so `safeLaunch`
 * does nothing for it: an uncaught throw goes straight to the default handler and
 * the process dies with no dialog. And camera bring-up throws for reasons that
 * have nothing to do with this app being correct — another process holding the
 * camera, a vendor HAL that fails to initialise, the operator leaving the screen
 * before the provider future resolves. At a venue every one of those was the app
 * disappearing mid-shift.
 *
 * Every one of those now also reports [CameraStatus.Unavailable] rather than
 * failing silently, so the screen can say so and hand the door to manual search.
 */
@Composable
fun CameraPreview(
    analyzer: QrAnalyzer,
    /**
     * The thread CameraX delivers frames on — created by the caller, because the
     * analyzer runs ML Kit's callbacks on it too. Deliberately NOT shut down
     * here; see the disposal note below.
     */
    executor: ExecutorService,
    controller: CameraController,
    /** The torch the OPERATOR has asked for. What the lamp is doing is [CameraController.torchActive]. */
    torchOn: Boolean,
    lifecycleOwner: LifecycleOwner,
    modifier: Modifier = Modifier,
) {
    // Not a delegated property: the touch listener installed in `factory` closes
    // over this reference once, for the life of the view, and has to read
    // whatever camera is bound at the time it fires rather than the null that
    // was in scope when the view was built.
    val cameraRef = remember { mutableStateOf<Camera?>(null) }
    val camera = cameraRef.value

    // Retained so the use cases can be DETACHED before the analysis executor is
    // shut down. Without the unbind, CameraX goes on delivering frames to an
    // executor that no longer accepts work — a RejectedExecutionException raised
    // on a camera thread, which is another silent process kill. It fired on the
    // way back from the menu, when the previous binding is re-attached to a
    // lifecycle that has just come round again.
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }

    /*
     * ── The bring-up that never finishes ──
     *
     * Every failure below is a THROW, and throws are caught and reported. This
     * covers the other shape: `ProcessCameraProvider.getInstance()` returns a
     * future that simply never resolves, so the listener never runs, nothing
     * throws, and `status` stays Starting for ever. The operator gets a black
     * rectangle under live chrome — the precise thing reporting Unavailable was
     * added to eliminate — with no error and no retry offered.
     *
     * It happens: a camera HAL wedged by the app that had the device before
     * this one, and a provider initialisation that deadlocks on a busy boot.
     *
     * Keyed on Unit rather than on the attempt counter because the caller
     * already rebuilds this whole composable per attempt, so a fresh timer
     * starts with each retry on its own.
     */
    LaunchedEffect(Unit) {
        delay(BRING_UP_TIMEOUT_MS)
        if (controller.status == CameraStatus.Starting) {
            controller.status = CameraStatus.Unavailable
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            // Unbind ONLY. The executor belongs to the caller and is deliberately
            // not shut down here.
            //
            // It used to be created and destroyed in this composable, which was
            // safe while it was private to it. Now that the analyzer shares it,
            // shutting it down here would kill a thread the caller still holds:
            // if the camera permission is revoked and re-granted, this composable
            // leaves and re-enters, and the second time it would hand CameraX an
            // executor that no longer accepts work — a RejectedExecutionException
            // on a camera thread, which is a process kill.
            //
            // Compose disposes children before parents, so the caller's shutdown
            // still runs after this unbind, which is the order that matters.
            runCatching { provider?.unbindAll() }
        }
    }

    /*
     * ── The torch, observed rather than assumed ──
     *
     * The UI used to render its button from the boolean it had last written,
     * which is only true while nothing else touches the lamp. Backgrounding the
     * app unbinds the camera and the torch goes out with it — physically, in the
     * operator's hand — while the button stayed gold and captioned "Light off".
     * Coming back, tapping it turned the state OFF, so the one control staff use
     * most in a dark venue needed two presses and looked broken for the first.
     *
     * torchState is what the camera reports, so it cannot drift.
     */
    DisposableEffect(camera) {
        val info = camera?.cameraInfo
        controller.hasFlash = info?.hasFlashUnit() == true
        if (info == null) {
            controller.torchActive = false
            onDispose { }
        } else {
            val live = info.torchState
            val observer = Observer<Int> { value ->
                controller.torchActive = value == TorchState.ON
            }
            live.observeForever(observer)
            onDispose { live.removeObserver(observer) }
        }
    }

    /*
     * Re-applied on every RESUMED, not once per binding.
     *
     * `camera` is the same object across a background/foreground cycle, so a
     * plain LaunchedEffect keyed on it never fires again — and the lamp that
     * went out with the unbind stays out. repeatOnLifecycle re-runs the moment
     * the pipeline is live again, which is what restores a torch the operator
     * never chose to turn off.
     */
    LaunchedEffect(camera, torchOn, lifecycleOwner) {
        val bound = camera ?: return@LaunchedEffect
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            // enableTorch on a camera that has just been unbound throws rather
            // than returning a failed future on some devices, and the torch is
            // the control staff hit most often in a dark venue.
            runCatching {
                if (bound.cameraInfo.hasFlashUnit()) bound.cameraControl.enableTorch(torchOn)
            }
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }

            installTapToFocus(previewView, cameraRef)

            val providerFuture = ProcessCameraProvider.getInstance(ctx)
            providerFuture.addListener({
                val outcome = runCatching {
                    // The future resolves asynchronously. If the operator has moved
                    // on in the meantime, binding to a destroyed lifecycle throws —
                    // so check first and simply do nothing.
                    if (lifecycleOwner.lifecycle.currentState == Lifecycle.State.DESTROYED) {
                        return@runCatching
                    }

                    // .get() on a failed future throws ExecutionException, wrapping
                    // whatever the camera stack objected to.
                    val cameraProvider = providerFuture.get()
                    provider = cameraProvider

                    /*
                     * ── Which lens ──
                     *
                     * DEFAULT_BACK_CAMERA was hardcoded, and `bindToLifecycle`
                     * throws IllegalArgumentException when the requested lens does
                     * not exist. On a front-camera-only tablet — which is a real
                     * and cheap class of device, and exactly the kind someone buys
                     * six of for a door — that throw was swallowed and the screen
                     * stayed black forever.
                     *
                     * Back is still strongly preferred: it is the lens an usher can
                     * point at a guest's phone. Front is a genuine fallback, not a
                     * co-equal choice, and scanning with it means turning the
                     * tablet round — which beats not scanning at all.
                     */
                    val selector = cameraProvider.firstAvailableLens()
                    if (selector == null) {
                        controller.status = CameraStatus.Unavailable
                        return@runCatching
                    }

                    /*
                     * ── Resolution: 1280x720, explicitly ──
                     *
                     * CameraX defaults ImageAnalysis to 640x480. That is cheaper
                     * per frame — decode cost scales with pixel count, so 720p is
                     * roughly three times the work — and it is still the wrong
                     * choice here.
                     *
                     * Time-to-decode is not frames-per-second, it is how many
                     * frames pass before the code is RESOLVABLE at all. A QR on a
                     * phone screen held at arm's length occupies a small part of a
                     * tablet's wide field of view, and below a certain pixel
                     * density ML Kit cannot decode it in any number of frames. At
                     * 480p that guest has to be asked to step closer; at 720p the
                     * first or second frame reads. Three times the work on frames
                     * that succeed beats free frames that never do.
                     *
                     * The preview is capped at the same size for a different
                     * reason: it shares the camera pipeline, and letting it run at
                     * the sensor's full resolution spends bandwidth and ISP time
                     * on pixels nobody decodes.
                     */
                    val resolution = ResolutionSelector.Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(
                                android.util.Size(1280, 720),
                                // Fall back to the closest available in either
                                // direction rather than failing: a device without
                                // exactly 720p must still scan.
                                ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                            ),
                        )
                        .build()

                    val preview = Preview.Builder()
                        .setResolutionSelector(resolution)
                        .build()
                        .also {
                            it.setSurfaceProvider(previewView.surfaceProvider)
                        }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .setResolutionSelector(resolution)
                        // YUV_420_888 is the default and is kept deliberately:
                        // ML Kit consumes YUV natively, so asking CameraX for RGBA
                        // would add a full-frame colour conversion per frame for
                        // nothing.
                        .build()
                        .also { it.setAnalyzer(executor, analyzer) }

                    cameraProvider.unbindAll()
                    cameraRef.value = cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        selector,
                        preview,
                        analysis,
                    )
                    controller.status = CameraStatus.Running
                }

                // Anything the camera stack objected to lands here. Saying so is
                // the point: the status bar, the counter, MENU and SEARCH BY NAME
                // are all still live, so the door keeps working by name — which is
                // the degradation §8.3 asks for. It only works if the operator is
                // told to use it instead of staring at a black rectangle.
                if (outcome.isFailure) controller.status = CameraStatus.Unavailable
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        },
    )
}

/**
 * Back if it exists, front if it does not, null if the device has no camera the
 * provider will admit to.
 *
 * `hasCamera` itself throws CameraInfoUnavailableException, so each probe is
 * guarded independently — a device that fails the back-camera query must still
 * get as far as trying the front one.
 */
private fun ProcessCameraProvider.firstAvailableLens(): CameraSelector? = listOf(
    CameraSelector.DEFAULT_BACK_CAMERA,
    CameraSelector.DEFAULT_FRONT_CAMERA,
).firstOrNull { runCatching { hasCamera(it) }.getOrDefault(false) }

/**
 * Tap anywhere on the preview to focus and meter there.
 *
 * ── Why this is not a nicety ──
 *
 * The hardest thing this app is asked to read is a QR on a phone screen held
 * close to the lens: bright, small, and at the near end of the focus range.
 * Continuous autofocus on a budget tablet hunts on exactly that subject — it
 * locks onto the guest's hand, or onto the room behind them — and from the
 * usher's side the scanner has simply stopped working, with no control that
 * addresses it. A tap is the standard gesture for this and costs nothing when
 * unused.
 *
 * AF and AE together, because a phone screen is also the wrong exposure: metered
 * on the room, it blows out to white and the code is unreadable even in focus.
 *
 * Auto-cancel after three seconds returns the camera to continuous focus on its
 * own. Without it the tap becomes a lock, and the next guest — at a different
 * distance — is focused for the last one's position with nothing on screen to
 * explain why.
 */
@SuppressLint("ClickableViewAccessibility")
private fun installTapToFocus(
    previewView: PreviewView,
    cameraRef: MutableState<Camera?>,
) {
    previewView.setOnTouchListener { view, event ->
        if (event.actionMasked != MotionEvent.ACTION_UP) {
            // Claim the gesture from ACTION_DOWN or no ACTION_UP is ever
            // delivered here, and the tap is silently dropped.
            return@setOnTouchListener event.actionMasked == MotionEvent.ACTION_DOWN
        }

        val camera = cameraRef.value ?: return@setOnTouchListener false

        // Every call in here is a camera call on the main thread: an uncaught
        // throw is a process kill, not a missed focus.
        runCatching {
            val point = previewView.meteringPointFactory.createPoint(event.x, event.y)
            camera.cameraControl.startFocusAndMetering(
                FocusMeteringAction.Builder(
                    point,
                    FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE,
                )
                    .setAutoCancelDuration(FOCUS_HOLD_SECONDS, TimeUnit.SECONDS)
                    .build(),
            )
        }

        view.performClick()
        true
    }
}

private const val FOCUS_HOLD_SECONDS = 3L

/**
 * How long a camera is allowed to take to start before the screen gives up on
 * it and offers manual search.
 *
 * Eight seconds. Bring-up on a cold budget tablet is routinely two to three, so
 * anything under about six would declare a working camera broken; much beyond
 * ten and an usher with a queue has already decided the app is dead. Giving up
 * is cheap here — RETRY rebuilds the whole pipeline, and the door keeps working
 * by name in the meantime.
 */
private const val BRING_UP_TIMEOUT_MS = 8_000L
