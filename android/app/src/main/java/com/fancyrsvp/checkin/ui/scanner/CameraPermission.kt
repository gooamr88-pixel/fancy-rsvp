package com.fancyrsvp.checkin.ui.scanner

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

/**
 * Where the camera permission actually stands, as the door needs to see it.
 *
 * Two states is not enough. Android has three, and conflating the last two is
 * what produced a button that did nothing:
 *
 *  • [Granted]  — scan.
 *  • [Denied]   — refused, but the system will still show the dialog. Asking
 *                 again is worth doing.
 *  • [Blocked]  — refused for good ("Don't allow" twice, or a device policy).
 *                 `launch()` returns `false` IMMEDIATELY with no dialog. Asking
 *                 again is not a weaker option, it is a no-op, and offering it
 *                 as a button is worse than offering nothing: an usher taps it,
 *                 nothing happens, and they have no idea why. The only route
 *                 back is the system settings page.
 */
enum class CameraPermissionStatus { Granted, Denied, Blocked }

/**
 * Camera-permission state that survives the two things the old inline
 * `remember { checkSelfPermission(...) }` did not:
 *
 *  1. **A grant made outside the app.** Permission changes happen in Settings,
 *     which is a different process. The old state was written only by the
 *     request callback, so an operator who followed instructions — go to
 *     Settings, allow the camera, come back — returned to the same "Camera not
 *     available" screen they left, with no way to make it notice. Re-reading on
 *     every ON_RESUME costs one cheap call and closes that hole in both
 *     directions: a permission revoked mid-shift is picked up too.
 *
 *  2. **Permanent denial.** See [CameraPermissionStatus].
 */
@Stable
class CameraPermissionState internal constructor(private val context: Context) {

    var status by mutableStateOf(
        if (isGrantedNow(context)) CameraPermissionStatus.Granted else CameraPermissionStatus.Denied,
    )
        private set

    val isGranted: Boolean get() = status == CameraPermissionStatus.Granted

    /**
     * Whether the system dialog has been through at least one round.
     *
     * Load-bearing for the [Blocked][CameraPermissionStatus.Blocked] test.
     * `shouldShowRequestPermissionRationale` is false BOTH before the first ask
     * and after the last one, so without this a fresh install would be
     * classified as permanently blocked the moment it was seen, and the operator
     * would be sent to Settings for a permission the app had never requested.
     */
    internal var hasAsked: Boolean = false

    /**
     * True from `request()` until its result lands.
     *
     * The permission dialog PAUSES the host activity rather than stopping it,
     * so dismissing it — or backgrounding the app while it is up — fires
     * ON_RESUME. Refreshing there would read a rationale flag that has not been
     * updated yet and mis-file a first-time ask as permanently blocked.
     */
    private var awaitingResult: Boolean = false

    internal var requester: (() -> Unit)? = null

    /** Shows the system dialog. A no-op once [status] is Blocked — by design. */
    fun request() {
        if (status == CameraPermissionStatus.Granted) return

        // Flag only if a request is genuinely going out. Setting it first and
        // finding no launcher would leave the state permanently "awaiting", and
        // [refresh] returns early while that is set — so every later resume would
        // be ignored and a permission granted in Settings would never be noticed.
        val launch = requester ?: return
        awaitingResult = true
        launch()
    }

    /**
     * The only route back from [Blocked][CameraPermissionStatus.Blocked].
     *
     * Guarded: a stripped OEM build or a kiosk launcher can have no activity for
     * this intent, and an ActivityNotFoundException here would take the app down
     * at the door over a settings shortcut.
     */
    fun openSettings() {
        runCatching {
            context.startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", context.packageName, null),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }

    internal fun onResult() {
        awaitingResult = false
        hasAsked = true
        refresh()
    }

    internal fun refresh() {
        if (awaitingResult) return

        if (isGrantedNow(context)) {
            status = CameraPermissionStatus.Granted
            return
        }

        // No activity means no way to read the rationale flag — a context that is
        // not an activity cannot have shown a dialog either. Treat it as askable
        // rather than blocked: the worst case is one more request that the system
        // silently drops, which is strictly better than sending someone to
        // Settings for nothing.
        val activity = context.findActivity()
        val canAskAgain = activity == null ||
            ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.CAMERA)

        status = if (hasAsked && !canAskAgain) {
            CameraPermissionStatus.Blocked
        } else {
            CameraPermissionStatus.Denied
        }
    }
}

/**
 * Camera-permission state wired to the launcher and to the lifecycle.
 *
 * Survives process death well enough to stay honest: [hasAsked] is the one bit
 * that cannot be re-derived from the system afterwards, so it is the one bit
 * that is saved.
 */
@Composable
fun rememberCameraPermissionState(): CameraPermissionState {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val state = remember(context) { CameraPermissionState(context) }

    var askedBefore by rememberSaveable { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        askedBefore = true
        state.onResult()
    }

    SideEffect {
        state.requester = { launcher.launch(Manifest.permission.CAMERA) }

        // Restoring after process death: re-classify straight away rather than
        // waiting for the screen's arrival request to be silently dropped and
        // corrected a frame later. That correction works, but it shows "Allow
        // camera" first and swaps it for "Open settings" once the answer lands,
        // and a button that changes under a thumb is its own kind of broken.
        if (askedBefore && !state.hasAsked) {
            state.hasAsked = true
            state.refresh()
        }
    }

    DisposableEffect(lifecycleOwner, state) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) state.refresh()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    return state
}

private fun isGrantedNow(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED

/**
 * Compose hands out a context that is usually — but not always — the activity
 * itself. It can be a wrapper (a themed context, a display context), so unwrap
 * rather than casting: a ClassCastException here would kill the scanner.
 */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
