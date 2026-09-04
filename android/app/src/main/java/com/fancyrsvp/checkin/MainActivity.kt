package com.fancyrsvp.checkin

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.fancyrsvp.checkin.data.repo.DeviceRepository
import com.fancyrsvp.checkin.ui.CheckinNavHost
import com.fancyrsvp.checkin.ui.Routes
import com.fancyrsvp.checkin.ui.session.SessionLockOverlay
import com.fancyrsvp.checkin.ui.session.SessionManager
import com.fancyrsvp.checkin.ui.theme.FancyCheckinTheme
import com.fancyrsvp.checkin.ui.update.UpdateOverlay
import com.fancyrsvp.checkin.ui.update.UpdateViewModel
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * The single activity hosting the whole app.
 *
 * Three window-level settings here are spec requirements, not preferences:
 *
 *  • FLAG_SECURE (§20.4) blocks screenshots and screen recording AND hides the
 *    content in the recent-apps switcher. Every screen past pairing shows guest
 *    data, so it is set once at the window rather than per-screen — a per-screen
 *    approach means the one screen someone forgets is the leak.
 *
 *  • KEEP_SCREEN_ON (§21.9). Staff must never have to wake and unlock a tablet
 *    with a queue forming at the door.
 *
 *  • Orientation is set in the manifest, not here, and is no longer LOCKED. The
 *    app follows the device in all four orientations — the kiosk is a portrait
 *    panel. The old warning that rotation "disrupts the CameraX pipeline"
 *    described an Activity RECREATION, which the manifest's configChanges has
 *    always prevented.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var deviceRepository: DeviceRepository
    @Inject lateinit var sessionManager: SessionManager

    override fun onCreate(savedInstanceState: Bundle?) {
        /*
         * Edge-to-edge, declared rather than inherited.
         *
         * targetSdk 35 means Android 15 and later impose this anyway. Calling it
         * explicitly makes ANDROID 11 — which is what the kiosk runs — behave the
         * same way, so the layout is not one shape on the test device and another
         * on the hardware at the venue. Insets are then handled per-surface; see
         * ui/theme/Insets.kt for why not at the root.
         *
         * Both bars are forced to the LIGHT style, which is what actually decides
         * the icon colour: light() means dark icons, for a pale background. The
         * default is `auto`, which picks from the SYSTEM's dark-mode setting — and
         * this app is light-only by deliberate choice (see FancyCheckinTheme), so
         * on a tablet with dark mode on, auto would paint white system icons onto
         * the app's parchment and they would disappear.
         *
         * Before super.onCreate(), as the API requires.
         */
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(
                android.graphics.Color.TRANSPARENT,
                android.graphics.Color.TRANSPARENT,
            ),
            navigationBarStyle = SystemBarStyle.light(
                android.graphics.Color.TRANSPARENT,
                android.graphics.Color.TRANSPARENT,
            ),
        )

        super.onCreate(savedInstanceState)

        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setContent {
            FancyCheckinTheme {
                // Read once at composition. Pairing state changes exactly once per
                // install, and the pair screen navigates explicitly on success, so
                // observing it as a Flow would add a subscription for an event that
                // is already handled directly.
                val startPaired = remember { deviceRepository.isPaired }

                // Shared with SessionGate so "switch staff" has somewhere to go.
                // The overlay is drawn over the nav host, not inside it, so without
                // this it can clear the session but cannot move off the screen the
                // signed-out operator was on.
                val navController = rememberNavController()

                Box(Modifier.fillMaxSize()) {
                    CheckinNavHost(
                        isPaired = startPaired,
                        sessionManager = sessionManager,
                        navController = navController,
                    )
                    // UpdateGate FIRST, SessionGate second: later children paint
                    // on top, so the PIN lock always wins. An update offer that
                    // could cover the lock screen would be a way past it.
                    UpdateGate(navController)
                    SessionGate(sessionManager, navController)
                }
            }
        }
    }
}

/**
 * Offers a newer build of the app, and only where it is safe to interrupt.
 *
 * ── Why this is gated on the route ──
 *
 * The app is sideloaded, so nothing else tells a tablet an update exists — but
 * an update prompt at a door is worse than a stale build. Installing restarts
 * the process, and the one moment that must never be interrupted is somebody
 * standing at the entrance with a queue behind them.
 *
 * WELCOME and PREPARE are the two screens reached in an office, on wifi, before
 * anyone travels — the same moment preparation already chooses to refuse a build
 * the server considers too old. Every other route means the tablet is armed or
 * working, so the overlay simply is not drawn.
 *
 * The queue is checked too, inside UpdateGate.evaluate: a tablet holding
 * check-ins that exist nowhere else is not restarted for a version number.
 */
@Composable
private fun UpdateGate(navController: NavHostController) {
    val viewModel: UpdateViewModel = hiltViewModel()
    val state by viewModel.state.collectAsState()
    val currentEntry by navController.currentBackStackEntryAsState()
    val context = LocalContext.current

    val route = currentEntry?.destination?.route
    val allowed = route == Routes.WELCOME || route == Routes.PREPARE

    // Fires once per process; the ViewModel guards re-entry. Keyed on `allowed`
    // rather than Unit so a tablet that starts on the scanner still checks when
    // it later reaches preparation.
    LaunchedEffect(allowed) { if (allowed) viewModel.checkOnce() }

    /*
     * ── ON_RESUME, and it has to be ──
     *
     * Granting "install unknown apps" happens in the Android Settings app, so
     * the ONLY signal that the operator came back and may have granted it is
     * this activity resuming.
     *
     * This was keyed on the nav back-stack entry, which sounds equivalent and is
     * not: leaving for Settings and returning does not change the back stack at
     * all, so the effect never re-ran. The operator granted the permission,
     * returned, and sat on "Open settings" with no way forward — the feature
     * dead at the last step, with a comment above it claiming this worked.
     */
    if (state is UpdateViewModel.State.NeedsPermission) {
        val lifecycleOwner = LocalLifecycleOwner.current
        DisposableEffect(lifecycleOwner) {
            val observer = LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) viewModel.recheckPermission()
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
        }
    }

    if (allowed && state !is UpdateViewModel.State.Idle) {
        UpdateOverlay(
            state = state,
            installedVersionName = viewModel.installedVersionName,
            onUpdate = viewModel::download,
            onLater = viewModel::dismiss,
            // Stop is NOT Later. See UpdateViewModel.cancelDownload.
            onStop = viewModel::cancelDownload,
            onGrantPermission = { context.startActivity(viewModel.permissionIntent()) },
            onInstall = { file -> context.startActivity(viewModel.installIntent(file)) },
            onDismissFailure = viewModel::clearFailure,
        )
    }
}

/**
 * Applies the session-expiry rules and shows the lock overlay (§20.4).
 *
 * Driven by lifecycle events rather than a timer: the "more than 5 minutes
 * backgrounded" rule is precisely a lifecycle question, and a polling timer would
 * both drain battery and miss the transition it exists to catch.
 *
 * The overlay is drawn OVER the nav host rather than replacing it, so returning from
 * a lock lands exactly where the operator left off — re-navigating would rebuild the
 * camera pipeline and cost a second of black screen at a door.
 */
@Composable
private fun SessionGate(sessionManager: SessionManager, navController: NavHostController) {
    val locked by sessionManager.locked.collectAsState()
    val session by sessionManager.session.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentEntry by navController.currentBackStackEntryAsState()

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> sessionManager.onBackgrounded()
                Lifecycle.Event.ON_START -> sessionManager.onForegrounded()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Only meaningful once someone is signed in. Before that the app is on the
    // pairing or event-selection screens, which hold no guest data.
    if (locked && session != null) {
        // Captured before sign-out clears anything. Every route past login carries
        // the armed event in its arguments, which is where this comes from.
        val eventId = currentEntry?.arguments?.getString("eventId")

        SessionLockOverlay(
            // Clearing the lock flag is all an unlock needs — the overlay is drawn
            // OVER the nav host, so hiding it reveals the screen the operator was
            // already on, camera pipeline and all.
            onUnlocked = { /* SessionManager.unlock() already cleared the flag */ },
            // Sign-out MUST navigate. It nulls the session, which hides this
            // overlay, and without a destination the tablet lands back on the
            // scanner with no operator signed in and no way to reach login.
            onSwitchStaff = {
                if (eventId != null) {
                    navController.navigate(Routes.login(eventId)) {
                        // Everything above event selection goes: the outgoing
                        // operator's dashboard and guest-list history must not be
                        // reachable by the person taking over.
                        popUpTo(Routes.PREPARE) { inclusive = false }
                    }
                } else {
                    // No armed event in the current route — nothing to log in to.
                    navController.navigate(Routes.PREPARE) {
                        popUpTo(Routes.PREPARE) { inclusive = true }
                    }
                }
            },
        )
    }
}
