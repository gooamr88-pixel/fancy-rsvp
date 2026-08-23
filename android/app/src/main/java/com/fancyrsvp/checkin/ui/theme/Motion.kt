package com.fancyrsvp.checkin.ui.theme

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.ui.unit.IntOffset

/**
 * Motion tokens.
 *
 * ── The rule ──
 *
 * Slow and confident, never bouncy. There is not one spring in this file, and
 * there must not be one anywhere in the app: overshoot reads as playful, and a
 * tool that admits people to a wedding should read as calm. Everything is a
 * tween on a decelerating curve, so movement arrives and stops rather than
 * settling.
 *
 * ── Why transitions carry meaning here ──
 *
 * Temporary staff with no training lose track of where they are the moment two
 * screens look alike. Direction is therefore a signal, not decoration:
 *
 *   going deeper   content enters from the END edge and travels toward START
 *   coming back    content leaves toward the END edge — visibly the reverse
 *   result screen  scales UP toward the operator, because it is not a place
 *                  they navigated to; it arrived in front of them
 *
 * An operator never has to read a title to know which way they moved.
 */
object Motion {

    /**
     * The house curve. Decelerating, and it does NOT overshoot.
     *
     * Equivalent to CSS `cubic-bezier(0.16, 1, 0.3, 1)` — fast to leave, long
     * to arrive. The long tail is what makes it read as confident rather than
     * abrupt at the 400ms+ durations used here.
     */
    val Confident = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

    /** Screen-to-screen movement. */
    const val DURATION_ENTER = 420

    /** Small in-place changes: a value updating, a control appearing. */
    const val DURATION_SETTLE = 280

    /** A full-screen state ground washing in. Deliberately the slowest thing. */
    const val DURATION_FLOOD = 520

    /** One slow pass of the VIP shimmer. Long enough to register as luxury. */
    const val DURATION_SHIMMER = 2600

    /**
     * A control acknowledging a finger.
     *
     * Much shorter than everything else in this file, and deliberately so. Press
     * feedback is not a transition — it is the control reporting that it was hit,
     * and anything an operator can perceive as a delay makes them press again. At
     * a door that second press is a second scan.
     */
    const val DURATION_PRESS = 90

    fun <T> enter() = tween<T>(DURATION_ENTER, easing = Confident)

    fun <T> settle() = tween<T>(DURATION_SETTLE, easing = FastOutSlowInEasing)

    fun <T> press() = tween<T>(DURATION_PRESS, easing = FastOutSlowInEasing)

    fun <T> flood() = tween<T>(DURATION_FLOOD, easing = Confident)

    fun <T> shimmer() = tween<T>(DURATION_SHIMMER, easing = LinearEasing)
}

// ── Navigation transitions ───────────────────────────────────────────────────
//
// Written against the container edges (Start/End) rather than Left/Right, so
// the direction stays correct if the app is ever localised to Arabic. In RTL
// "deeper" comes from the left, which is what an Arabic reader expects.
//
// Generic in the target type rather than fixed to NavBackStackEntry. These are
// the app's grammar for "forward" and "back", and forward is not only a route
// change — the pairing guide pages through four steps inside one destination
// and has to move the same way, or the app has two contradictory ideas of which
// direction progress travels. The NavHost's own calls are unaffected: S simply
// infers as NavBackStackEntry there.

/** Entering a screen one level deeper. */
fun <S> AnimatedContentTransitionScope<S>.enterDeeper(): EnterTransition =
    slideIntoContainer(
        towards = AnimatedContentTransitionScope.SlideDirection.Start,
        animationSpec = Motion.enter<IntOffset>(),
    ) + fadeIn(Motion.enter())

/** The screen you are leaving behind as you go deeper. */
fun <S> AnimatedContentTransitionScope<S>.exitDeeper(): ExitTransition =
    slideOutOfContainer(
        towards = AnimatedContentTransitionScope.SlideDirection.Start,
        animationSpec = Motion.enter<IntOffset>(),
    ) + fadeOut(Motion.enter())

/** Coming back up. The exact reverse of [enterDeeper]. */
fun <S> AnimatedContentTransitionScope<S>.enterShallower(): EnterTransition =
    slideIntoContainer(
        towards = AnimatedContentTransitionScope.SlideDirection.End,
        animationSpec = Motion.enter<IntOffset>(),
    ) + fadeIn(Motion.enter())

/** Coming back up. The exact reverse of [exitDeeper]. */
fun <S> AnimatedContentTransitionScope<S>.exitShallower(): ExitTransition =
    slideOutOfContainer(
        towards = AnimatedContentTransitionScope.SlideDirection.End,
        animationSpec = Motion.enter<IntOffset>(),
    ) + fadeOut(Motion.enter())

// ── Overlay transitions ──────────────────────────────────────────────────────

/**
 * The scan result arriving over the camera.
 *
 * Scales up rather than sliding: sliding would imply the operator navigated
 * somewhere, and they did not — a guest presented a code and the answer
 * appeared. 0.92 is small enough to read as movement toward the viewer and
 * large enough that no text is ever illegibly small mid-animation.
 */
fun resultEnter(): EnterTransition =
    scaleIn(animationSpec = Motion.enter(), initialScale = 0.92f) + fadeIn(Motion.enter())

/** The result leaving. Fades back rather than scaling away — quieter to exit. */
fun resultExit(): ExitTransition =
    fadeOut(Motion.settle()) + scaleOut(animationSpec = Motion.settle(), targetScale = 0.96f)

/** Manual search and other full-screen overlays over the scanner. */
fun overlayEnter(): EnterTransition =
    fadeIn(Motion.settle()) + scaleIn(animationSpec = Motion.settle(), initialScale = 0.96f)

fun overlayExit(): ExitTransition =
    fadeOut(Motion.settle()) + scaleOut(animationSpec = Motion.settle(), targetScale = 0.98f)
