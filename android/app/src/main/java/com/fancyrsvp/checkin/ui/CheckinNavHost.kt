package com.fancyrsvp.checkin.ui

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.fancyrsvp.checkin.ui.close.CloseEventScreen
import com.fancyrsvp.checkin.ui.entrance.EntranceDisplayScreen
import com.fancyrsvp.checkin.ui.guests.GuestListScreen
import com.fancyrsvp.checkin.ui.howto.HowToPairScreen
import com.fancyrsvp.checkin.ui.login.StaffLoginScreen
import com.fancyrsvp.checkin.ui.menu.MenuScreen
import com.fancyrsvp.checkin.ui.pair.PairScreen
import com.fancyrsvp.checkin.ui.prepare.PrepareScreen
import com.fancyrsvp.checkin.ui.scanner.ScannerScreen
import com.fancyrsvp.checkin.ui.session.SessionManager
import com.fancyrsvp.checkin.ui.welcome.WelcomeScreen
import com.fancyrsvp.checkin.ui.theme.enterDeeper
import com.fancyrsvp.checkin.ui.theme.enterShallower
import com.fancyrsvp.checkin.ui.theme.exitDeeper
import com.fancyrsvp.checkin.ui.theme.exitShallower

/**
 * Navigation.
 *
 * ── The shape ──
 *
 * Setup runs once, in order, and is never seen again:
 *
 *     welcome -> pair -> prepare -> login -> SCANNER
 *
 * `welcome` is reached only by an UNPAIRED tablet. A paired one starts at
 * `prepare`, because staff arriving at a venue must not be made to tap past a
 * greeting they have already read.
 *
 * After that the scanner is home and the graph is flat:
 *
 *     SCANNER -> menu -> { guests | entrance | close }
 *
 * Pairing and preparation both REQUIRE internet and happen before travelling to
 * the venue. Login and scanning must work with none. That boundary is why the
 * graph is shaped this way rather than as one gated flow: once an event is
 * armed, nothing downstream may depend on connectivity.
 *
 * ── Two rules this file enforces ──
 *
 * 1. **Nothing is more than two taps from the scanner, and one tap back.**
 *    Depth is at most two (menu, then one screen), and every screen below the
 *    scanner carries a BackToScannerBar that returns to the CAMERA rather than
 *    to the screen above it. So going in costs two taps and coming out costs
 *    one, from anywhere.
 *
 * 2. **Direction is visible.** Going deeper slides in from the end edge; coming
 *    back slides out to it. An operator who has lost track of where they are
 *    can still tell which way they just moved.
 */
object Routes {
    const val WELCOME = "welcome"
    /** Reachable from BOTH welcome and pairing — see the composable's comment. */
    const val HOW_TO_PAIR = "how-to-pair"
    const val PAIR = "pair"
    const val PREPARE = "prepare"
    const val LOGIN = "login/{eventId}"
    const val SCANNER = "scanner/{eventId}/{staffId}/{staffName}/{role}"
    const val MENU = "menu/{eventId}/{role}"
    const val GUESTS = "guests/{eventId}/{role}"
    const val ENTRANCE = "entrance/{eventId}"
    const val CLOSE = "close/{eventId}"

    /**
     * Sentinel for an absent path argument.
     *
     * Navigation's string arguments cannot be null in a non-optional path
     * segment, and an empty segment collapses the route. A literal is clearer
     * than encoding absence as a blank.
     */
    const val NONE = "-"

    fun login(eventId: String) = "login/$eventId"

    /**
     * The staff identity travels in the route rather than in a shared singleton.
     *
     * That keeps the operator tied to the navigation entry, so returning to
     * login on a session timeout cannot leave a stale operator attributed to
     * later check-ins — attribution is written at creation time and is immutable
     * thereafter (§18.6), which only holds if it was right to begin with.
     */
    fun scanner(eventId: String, staffId: String?, staffName: String?, role: String) =
        "scanner/$eventId/${staffId ?: NONE}/${staffName?.let { Uri.encode(it) } ?: NONE}/$role"

    fun menu(eventId: String, role: String) = "menu/$eventId/$role"

    fun guests(eventId: String, role: String) = "guests/$eventId/$role"

    fun entrance(eventId: String) = "entrance/$eventId"

    fun close(eventId: String) = "close/$eventId"
}

@Composable
fun CheckinNavHost(
    isPaired: Boolean,
    sessionManager: SessionManager,
    navController: NavHostController = rememberNavController(),
) {
    /**
     * The one gesture that matters: get me back to the camera.
     *
     * `popUpTo(SCANNER)` rather than `popBackStack()`, so a screen two levels
     * down returns home in ONE tap instead of two. It also collapses the stack,
     * which means an operator cannot accumulate a pile of half-open screens
     * behind them over a five-hour shift.
     *
     * If the scanner is somehow not on the stack this is a no-op rather than a
     * crash, and the system back gesture still works.
     */
    fun backToScanner() {
        navController.popBackStack(Routes.SCANNER, inclusive = false)
    }

    NavHost(
        navController = navController,
        // An unpaired tablet has nothing else it can usefully do.
        startDestination = if (isPaired) Routes.PREPARE else Routes.WELCOME,
        enterTransition = { enterDeeper() },
        exitTransition = { exitDeeper() },
        popEnterTransition = { enterShallower() },
        popExitTransition = { exitShallower() },
    ) {
        composable(Routes.WELCOME) {
            // NOT popped on the way to pairing. Going back from the code form to
            // read the greeting again is a reasonable thing to want, and the
            // screen is free to return to — it holds no state and consumes
            // nothing. Everything from PAIR onward is popped, because those
            // screens do consume something.
            WelcomeScreen(
                onStart = { navController.navigate(Routes.PAIR) },
                onOpenGuide = { navController.navigate(Routes.HOW_TO_PAIR) },
            )
        }

        /*
         * The pairing guide, reachable from welcome AND from the code form.
         *
         * `popBackStack()` rather than a route, so it returns to whichever of
         * the two opened it. Reading the guide from the code form must land back
         * on the code form with the digits still there — sending it to a fixed
         * destination would throw away a half-typed code, which is exactly what
         * someone consulting instructions is in the middle of.
         */
        composable(Routes.HOW_TO_PAIR) {
            HowToPairScreen(onDone = { navController.popBackStack() })
        }

        composable(Routes.PAIR) {
            PairScreen(
                onOpenGuide = { navController.navigate(Routes.HOW_TO_PAIR) },
                onPaired = {
                    // popUpTo the START of setup, inclusive: after a successful
                    // pair neither the code form nor the greeting may be reached
                    // again. Returning to pairing would offer to consume a code
                    // that is already spent, and returning to the welcome screen
                    // would offer to start setup on a tablet that has finished
                    // it.
                    navController.navigate(Routes.PREPARE) {
                        popUpTo(Routes.WELCOME) { inclusive = true }
                    }
                },
            )
        }

        composable(Routes.PREPARE) {
            PrepareScreen(
                onEventReady = { eventId -> navController.navigate(Routes.login(eventId)) },
                // A released tablet is an unpaired tablet, so it goes back to
                // where an unpaired tablet starts. The whole stack is dropped,
                // inclusive: preparation is now a screen for an account this
                // device no longer belongs to, and its event list is gone.
                onReleased = {
                    navController.navigate(Routes.WELCOME) {
                        popUpTo(Routes.PREPARE) { inclusive = true }
                    }
                },
            )
        }

        composable(Routes.LOGIN) { entry ->
            val eventId = entry.arguments?.getString("eventId")
            if (eventId == null) {
                navController.popBackStack()
            } else {
                StaffLoginScreen(
                    eventId = eventId,
                    onLoggedIn = { staffId, displayName, role ->
                        // Registers the session so §20.4's inactivity and
                        // background rules have something to expire.
                        sessionManager.onLoggedIn(staffId, displayName, role)
                        navController.navigate(Routes.scanner(eventId, staffId, displayName, role)) {
                            // Login is popped so a session timeout returns here
                            // deliberately rather than the back gesture skipping
                            // it.
                            popUpTo(Routes.LOGIN) { inclusive = true }
                        }
                    },
                )
            }
        }

        composable(Routes.SCANNER) { entry ->
            val eventId = entry.arguments?.getString("eventId")
            if (eventId == null) {
                navController.popBackStack()
            } else {
                val role = entry.arguments?.getString("role") ?: "usher"
                ScannerScreen(
                    eventId = eventId,
                    staffId = entry.arguments?.getString("staffId")?.takeIf { it != Routes.NONE },
                    staffName = entry.arguments?.getString("staffName")
                        ?.takeIf { it != Routes.NONE }
                        ?.let { Uri.decode(it) },
                    role = role,
                    onOpenMenu = { navController.navigate(Routes.menu(eventId, role)) },
                )
            }
        }

        composable(Routes.MENU) { entry ->
            val eventId = entry.arguments?.getString("eventId")
            val role = entry.arguments?.getString("role") ?: "usher"
            if (eventId == null) {
                navController.popBackStack()
            } else {
                MenuScreen(
                    eventId = eventId,
                    isSupervisor = role == "supervisor",
                    onOpenGuestList = { navController.navigate(Routes.guests(eventId, role)) },
                    onOpenEntranceDisplay = { navController.navigate(Routes.entrance(eventId)) },
                    // Closing an event destroys local data, so only a supervisor
                    // reaches it — and the screen itself blocks the purge while
                    // anything is unsent, regardless of who holds the tablet.
                    onCloseEvent = if (role == "supervisor") {
                        { navController.navigate(Routes.close(eventId)) }
                    } else {
                        null
                    },
                    onBackToScanner = { backToScanner() },
                )
            }
        }

        composable(Routes.GUESTS) { entry ->
            val eventId = entry.arguments?.getString("eventId")
            val role = entry.arguments?.getString("role") ?: "usher"
            if (eventId == null) {
                navController.popBackStack()
            } else {
                GuestListScreen(
                    eventId = eventId,
                    isSupervisor = role == "supervisor",
                    onBackToScanner = { backToScanner() },
                )
            }
        }

        composable(Routes.ENTRANCE) { entry ->
            val eventId = entry.arguments?.getString("eventId")
            if (eventId == null) {
                navController.popBackStack()
            } else {
                // Guest-facing (§8.8): no operational state on screen, because
                // people walk past this and will touch it. It used to have NO
                // exit at all — the system back gesture was the only way out,
                // which is an invisible affordance and the exact failure this
                // redesign exists to remove. It now has a deliberate two-step
                // exit: quiet enough that a passer-by will not trigger it,
                // visible enough that an operator can find it.
                EntranceDisplayScreen(
                    eventId = eventId,
                    onExit = { backToScanner() },
                )
            }
        }

        composable(Routes.CLOSE) { entry ->
            val eventId = entry.arguments?.getString("eventId")
            if (eventId == null) {
                navController.popBackStack()
            } else {
                CloseEventScreen(
                    eventId = eventId,
                    onClosed = {
                        // The event is no longer armed, so the whole stack back
                        // to event selection is dropped: leaving a scanner
                        // behind for a purged event would present an empty guest
                        // list as though it were a real one.
                        navController.navigate(Routes.PREPARE) {
                            popUpTo(Routes.PREPARE) { inclusive = true }
                        }
                    },
                    onBackToScanner = { backToScanner() },
                )
            }
        }
    }
}
