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
                    SessionGate(sessionManager, navController)
                }
            }
        }
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
