package com.fancyrsvp.checkin.ui.howto

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fancyrsvp.checkin.ui.theme.Gold
import com.fancyrsvp.checkin.ui.theme.Hairline
import com.fancyrsvp.checkin.ui.theme.Ink
import com.fancyrsvp.checkin.ui.theme.InkMuted
import com.fancyrsvp.checkin.ui.theme.StateAttention

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  Artwork for the pairing guide.
 *
 *  ── Why these are drawn and not screenshotted ──
 *
 *  A screenshot of the dashboard would be a bitmap of a web page rendered at
 *  some width, on some day, in some browser. It would go stale the first time a
 *  button moved, it would ship several hundred kilobytes into an APK that a
 *  venue may install over a phone hotspot, and at tablet scale a full-page
 *  capture reduced to fit is unreadable exactly where it matters — the one
 *  control the operator is being told to press.
 *
 *  These are miniatures instead: the same boxes, the same labels, the same gold
 *  button, drawn with the same primitives as the app itself. They scale, they
 *  cost nothing, and the one thing being pointed at can be the only thing at
 *  full contrast while everything else recedes.
 *
 *  ── The rule these follow ──
 *
 *  Every string that appears inside a miniature is copied from the real
 *  dashboard source, not invented:
 *
 *    • "Check-in setup", "Before the event", "Tablets"
 *          → frontend/src/app/dashboard/checkin-setup/page.js
 *    • "Check-in devices", "Gate", "Create pairing code",
 *      "Add an entrance to your seating map first"
 *          → frontend/src/app/dashboard/components/DeviceManagement.js
 *
 *  They are deliberately NOT in strings.xml. A localised label here would
 *  mistranslate what is written on a screen the operator is looking at in
 *  English, which is worse than not translating it at all.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The pale ground the dashboard uses, so the miniatures read as "not this app". */
private val WebIvory = Color(0xFFFBF9F5)
private val WebPanel = Color(0xFFFFFFFF)
private val WebSoft = Color(0xFFF4F0E8)
private val WebBorder = Color(0xFFE6DFD2)

/**
 * A browser window. Every miniature sits in one, because the single most
 * important thing these pictures say is "this happens somewhere else, on
 * another device" — not on the tablet in your hands.
 */
@Composable
private fun BrowserFrame(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(WebIvory)
            .border(2.dp, WebBorder, RoundedCornerShape(10.dp)),
    ) {
        // Chrome: three dots and an address bar. Enough to read as a browser at
        // a glance without inviting anyone to read it.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(WebSoft)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            repeat(3) {
                Box(
                    Modifier
                        .size(7.dp)
                        .clip(RoundedCornerShape(50))
                        .background(WebBorder),
                )
            }
            Spacer(Modifier.width(6.dp))
            Box(
                Modifier
                    .weight(1f)
                    .height(14.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(WebPanel),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(
                    "fancyrsvp.com",
                    fontSize = 8.sp,
                    color = InkMuted,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
        Column(Modifier.padding(12.dp), content = content)
    }
}

/** A label the operator is being told to look for. Full contrast. */
@Composable
private fun WebLabel(text: String, bold: Boolean = false) {
    Text(
        text = text,
        fontSize = 10.sp,
        fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal,
        color = Ink,
    )
}

/** Everything that is on the real screen but is not the point. Recedes. */
@Composable
private fun WebGhost(width: Int, height: Int = 8) {
    Box(
        Modifier
            .width(width.dp)
            .height(height.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(WebBorder),
    )
}

/** The dashboard's gold button, at miniature scale. */
@Composable
private fun WebGoldButton(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Gold)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(text, fontSize = 9.sp, color = Color.White, fontWeight = FontWeight.Bold)
    }
}

/**
 * The ring that says "press this one".
 *
 * A gold halo rather than an arrow: an arrow needs a direction, a start point
 * and room to travel, and at this size it ends up pointing at two things at
 * once. A ring around the target has none of those problems and survives being
 * looked at quickly.
 */
@Composable
private fun Highlight(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(9.dp))
            .background(Gold.copy(alpha = 0.14f))
            .border(2.dp, Gold, RoundedCornerShape(9.dp))
            .padding(4.dp),
    ) {
        content()
    }
}

// ── Step 1 ──────────────────────────────────────────────────────────────────

/** Dashboard → Check-in setup. */
@Composable
fun ArtDashboard(modifier: Modifier = Modifier) {
    BrowserFrame(modifier) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            // Sidebar
            Column(
                modifier = Modifier
                    .width(76.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(WebPanel)
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                WebGhost(44, 9)
                Spacer(Modifier.height(2.dp))
                WebGhost(52)
                WebGhost(38)
                Highlight { WebLabel("Check-in setup", bold = true) }
                WebGhost(46)
                WebGhost(34)
            }
            // Body
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(6.dp))
                    .background(WebPanel)
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                WebLabel("Check-in setup", bold = true)
                WebGhost(120)
                WebGhost(96)
                Spacer(Modifier.height(4.dp))
                WebGhost(64, 22)
            }
        }
    }
}

// ── Step 2 ──────────────────────────────────────────────────────────────────

/**
 * The entrance on the seating map — the prerequisite everybody hits.
 *
 * Drawn as a floor plan with one gate marked, because "gate" is a word from the
 * seating map and means nothing on its own to someone who has not opened one.
 */
@Composable
fun ArtSeatingGate(modifier: Modifier = Modifier) {
    BrowserFrame(modifier) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .background(WebPanel)
                .padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            WebLabel("Seating map", bold = true)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(96.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(WebSoft),
            ) {
                // Round tables, scattered. Canvas rather than layout: these are
                // decoration with no structure worth expressing as boxes.
                Canvas(Modifier.fillMaxSize()) {
                    val r = size.minDimension * 0.075f
                    listOf(
                        0.30f to 0.30f, 0.55f to 0.24f, 0.78f to 0.36f,
                        0.36f to 0.62f, 0.62f to 0.66f, 0.84f to 0.70f,
                    ).forEach { (fx, fy) ->
                        drawCircle(
                            color = WebBorder,
                            radius = r,
                            center = Offset(size.width * fx, size.height * fy),
                        )
                    }
                    // The wall the gate sits in.
                    drawLine(
                        color = WebBorder,
                        start = Offset(size.width * 0.06f, size.height * 0.10f),
                        end = Offset(size.width * 0.06f, size.height * 0.90f),
                        strokeWidth = 3f,
                        cap = StrokeCap.Round,
                    )
                }
                // The gate itself, on the wall, named the way staff name it.
                Row(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Highlight {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            GateIcon()
                            Spacer(Modifier.width(5.dp))
                            WebLabel("Main entrance", bold = true)
                        }
                    }
                }
            }
            WebGoldButton("Add entrance")
        }
    }
}

/** A doorway: two posts and a lintel. Reads as a gate at 14dp, which an arrow does not. */
@Composable
private fun GateIcon(modifier: Modifier = Modifier) {
    Canvas(modifier.size(14.dp)) {
        val w = size.width
        val h = size.height
        val s = w * 0.14f
        // Lintel
        drawLine(Gold, Offset(w * 0.12f, h * 0.18f), Offset(w * 0.88f, h * 0.18f), s, StrokeCap.Round)
        // Posts
        drawLine(Gold, Offset(w * 0.22f, h * 0.18f), Offset(w * 0.22f, h * 0.90f), s, StrokeCap.Round)
        drawLine(Gold, Offset(w * 0.78f, h * 0.18f), Offset(w * 0.78f, h * 0.90f), s, StrokeCap.Round)
    }
}

// ── Step 3 ──────────────────────────────────────────────────────────────────

/** Check-in setup → Before the event → Tablets → Gate → Create pairing code. */
@Composable
fun ArtCreateCode(modifier: Modifier = Modifier) {
    BrowserFrame(modifier) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "BEFORE THE EVENT",
                fontSize = 8.sp,
                fontWeight = FontWeight.Bold,
                color = InkMuted,
            )
            // The tab row. "Tablets" is the one to press; "Door team" sits beside
            // it on the real screen and is the one people press by mistake.
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Highlight { WebLabel("Tablets", bold = true) }
                Box(
                    Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(WebPanel)
                        .border(1.dp, WebBorder, RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 7.dp),
                ) {
                    Text("Door team", fontSize = 10.sp, color = InkMuted)
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(WebPanel)
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                WebLabel("Check-in devices", bold = true)
                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Gate", fontSize = 8.sp, color = InkMuted)
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(5.dp))
                                .background(WebSoft)
                                .border(1.dp, WebBorder, RoundedCornerShape(5.dp))
                                .padding(horizontal = 7.dp, vertical = 6.dp),
                        ) {
                            Text("Main entrance", fontSize = 9.sp, color = Ink)
                        }
                    }
                    Highlight { WebGoldButton("Create pairing code") }
                }
            }
        }
    }
}

// ── Step 4 ──────────────────────────────────────────────────────────────────

/**
 * The code itself, as it is shown, next to the boxes it goes into.
 *
 * The only miniature that shows BOTH devices, because this is the one step
 * where the operator has to move something from one screen to another — and the
 * ten-minute clock is the reason it is worth saying so plainly.
 */
@Composable
fun ArtEnterCode(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        BrowserFrame(Modifier.weight(1f)) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(WebPanel)
                    .padding(vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "K7QM 4XR2",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    color = Ink,
                )
                Text("Expires in 9:41", fontSize = 9.sp, color = StateAttention)
            }
        }

        // Direction of travel. One glyph, no animation.
        Canvas(Modifier.size(width = 22.dp, height = 14.dp)) {
            val y = size.height / 2f
            drawLine(Gold, Offset(0f, y), Offset(size.width, y), 3f, StrokeCap.Round)
            drawLine(
                Gold,
                Offset(size.width - 6f, y - 5f),
                Offset(size.width, y),
                3f,
                StrokeCap.Round,
            )
            drawLine(
                Gold,
                Offset(size.width - 6f, y + 5f),
                Offset(size.width, y),
                3f,
                StrokeCap.Round,
            )
        }

        // This tablet. Drawn in the APP's colours, not the web ones, so the two
        // halves of the picture are never confused for each other.
        Column(
            modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.background)
                .border(2.dp, Hairline, RoundedCornerShape(10.dp))
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                "K7QM".forEach { MiniCell(it) }
                Box(
                    Modifier
                        .align(Alignment.CenterVertically)
                        .width(6.dp)
                        .height(2.dp)
                        .background(Hairline),
                )
                repeat(4) { MiniCell(null) }
            }
        }
    }
}

@Composable
private fun MiniCell(char: Char?) {
    Box(
        modifier = Modifier
            .size(width = 15.dp, height = 21.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(
                width = if (char != null) 2.dp else 1.dp,
                color = if (char != null) Gold else Hairline,
                shape = RoundedCornerShape(4.dp),
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (char != null) {
            Text(
                char.toString(),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = Ink,
            )
        }
    }
}

/**
 * Keeps every miniature the same shape, so the illustration does not resize
 * between steps and pull the text beside it up and down as the operator pages
 * through. A fixed ratio is the cheapest way to hold that still.
 */
@Composable
fun ArtworkFrame(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier.aspectRatio(1.45f),
        contentAlignment = Alignment.Center,
        content = { content() },
    )
}
