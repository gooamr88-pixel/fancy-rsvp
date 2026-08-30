package com.fancyrsvp.checkin.ui.theme

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Keeping controls out from under the system bars.
 *
 * ── The bug these exist to fix ──
 *
 * `targetSdk = 35`. From Android 15 the system stops reserving space for its own
 * bars: every app draws EDGE TO EDGE whether it asked to or not, and an app that
 * does nothing about it has the navigation bar sitting on top of whatever it drew
 * at the bottom of the window.
 *
 * On the scanner that was the two controls an usher actually uses — LIGHT and
 * SEARCH BY NAME — underneath the navigation icons. The buttons were still there
 * and still worked; they were just partly covered, so on a tablet the torch was a
 * sliver and the search button took two attempts. Nothing in the app handled
 * insets anywhere, so the same fault ran through every screen with a bar at the
 * bottom.
 *
 * ── Why safeDrawing and not systemBars ──
 *
 * `safeDrawing` is the union of the system bars, the IME, and the display cutout.
 * The cutout matters here: a tablet rotated so its camera notch is on the long
 * edge puts that notch straight through a bar that only avoided `systemBars`.
 * Rotation is now unlocked, so all four edges have to be treated as hostile.
 *
 * ── Why per-surface rather than once at the root ──
 *
 * Applying this to the whole app in MainActivity would be one line, and it would
 * inset the CAMERA too — boxing the preview inside a frame of background colour
 * on the one screen that is meant to be full-bleed. So the camera keeps the whole
 * window and only the chrome drawn over it is inset.
 *
 * Nesting is safe: `windowInsetsPadding` consumes what it applies, so an inner
 * call only ever pads by the remainder.
 */

/**
 * Every edge. The default for an ordinary screen with no full-bleed content.
 *
 * ── Why all three of these are @Composable ──
 *
 * `WindowInsets.safeDrawing` is a COMPOSABLE property getter — it has to be, since
 * it subscribes to insets that change while the app is running (the keyboard
 * opening, a bar hiding). Reading it makes the reader composable too, so the
 * annotation is not decoration and removing it will not compile.
 *
 * Every call site is already inside a composable, building a modifier chain.
 */
@Composable
fun Modifier.safeChrome(): Modifier =
    this.windowInsetsPadding(WindowInsets.safeDrawing)

/**
 * Top and sides, for a bar pinned to the top of a full-bleed surface.
 *
 * Horizontal is included because a tablet in landscape can put the navigation bar
 * down one side, and a cutout can appear on either.
 */
@Composable
fun Modifier.safeChromeTop(): Modifier =
    this.windowInsetsPadding(
        WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal),
    )

/** Bottom and sides, for a bar pinned to the bottom of a full-bleed surface. */
@Composable
fun Modifier.safeChromeBottom(): Modifier =
    this.windowInsetsPadding(
        WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal),
    )
