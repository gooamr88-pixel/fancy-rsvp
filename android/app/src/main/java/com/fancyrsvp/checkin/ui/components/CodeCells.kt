package com.fancyrsvp.checkin.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.fancyrsvp.checkin.ui.theme.LocalDimens

/**
 * A pairing code as separate character boxes.
 *
 * ── What this replaces, and why ──
 *
 * An `OutlinedTextField` with monospace text and wide letter-spacing. It was a
 * careful piece of work and it was still the wrong control:
 *
 *  • **One long target.** Eight characters in one underlined run, on a screen an
 *    operator reaches across a desk to reach. Boxes give each character its own
 *    place, so a missing one is a gap rather than a shorter word.
 *
 *  • **Nothing to check against.** Reading a code off a phone and typing it into
 *    a tablet is the error-prone act here, and a continuous string has to be
 *    re-read from the start to be verified. Grouped boxes are checked in two
 *    glances, which is also how the code is read aloud.
 *
 *  • **The field never showed you where you were.** The active box does.
 *
 * ── How it works, and why not `decorationBox` ──
 *
 * A real [BasicTextField] does the actual work — focus, the IME, hardware
 * keyboards, a scanner gun, accessibility — and draws nothing: its text and
 * cursor are transparent. The boxes are drawn underneath it, and the field is
 * stretched over them with `matchParentSize`.
 *
 * The obvious alternative is `decorationBox`, drawing the cells there and never
 * calling `innerTextField()`. That produces a control that looks right and
 * cannot be typed into: the focus, pointer and text-input modifiers all live on
 * the inner field, so a decoration box that never composes it has no input
 * session and no tap target. Overlaying a real field keeps every one of those
 * behaviours and replaces only the appearance.
 *
 * @param groupAfter where the visual break falls. Zero disables it.
 */
@Composable
fun CodeCells(
    value: String,
    onValueChange: (String) -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    length: Int = 8,
    enabled: Boolean = true,
    isError: Boolean = false,
    groupAfter: Int = 4,
) {
    val dimens = LocalDimens.current

    val cellWidth = if (dimens.compact) 46.dp else 62.dp
    val cellHeight = if (dimens.compact) 62.dp else 84.dp
    // Derived from the theme's code size rather than a new Dimens field: the
    // glyph has to sit inside a box now, where before it sat on a baseline with
    // the whole field's width to spread into.
    val glyph = dimens.codeFontSize * 0.78f

    Box(modifier = modifier) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(if (dimens.compact) 8.dp else 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(length) { index ->
                if (groupAfter in 1 until length && index == groupAfter) {
                    // A rule, not a hyphen: a hyphen looks like a character the
                    // operator is expected to type.
                    Box(
                        Modifier
                            .width(if (dimens.compact) 12.dp else 18.dp)
                            .height(2.dp)
                            .background(MaterialTheme.colorScheme.outline),
                    )
                }
                Cell(
                    char = value.getOrNull(index),
                    // The next empty box, and only while there is one left to
                    // fill. A full code marks nothing, so the row reads as
                    // finished rather than as still waiting.
                    active = enabled && index == value.length,
                    isError = isError,
                    width = cellWidth,
                    height = cellHeight,
                    fontSize = glyph,
                )
            }
        }

        BasicTextField(
            value = value,
            onValueChange = { raw ->
                /*
                 * Normalised here, not in the view model, because this is where
                 * the damage happens: a keyboard that autocapitalises
                 * inconsistently, a paste carrying a trailing newline, a code
                 * written "K7QM-4XR2" with the separator this control already
                 * draws. The server's alphabet is uppercase letters and digits,
                 * so anything else is noise from the input path rather than a
                 * character the operator meant.
                 */
                val cleaned = raw.uppercase().filter { it.isLetterOrDigit() }.take(length)
                if (cleaned != value) onValueChange(cleaned)
            },
            enabled = enabled,
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { onDone() }),
            // Both must be transparent, or the real text draws over the boxes,
            // offset and doubled.
            textStyle = TextStyle(color = Color.Transparent),
            cursorBrush = SolidColor(Color.Transparent),
            // Sized by the row beneath it and contributing nothing to layout, so
            // a tap anywhere across the boxes lands on the field and opens the
            // keyboard. Without this the boxes are decoration and nothing has a
            // tap target.
            modifier = Modifier.matchParentSize(),
        )
    }
}

@Composable
private fun Cell(
    char: Char?,
    active: Boolean,
    isError: Boolean,
    width: Dp,
    height: Dp,
    fontSize: TextUnit,
) {
    val dimens = LocalDimens.current
    val shape = RoundedCornerShape(dimens.cardRadius * 0.55f)

    val border = when {
        isError -> MaterialTheme.colorScheme.error
        active || char != null -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.outline
    }
    val borderWidth = if (active) 3.dp else 2.dp

    Box(
        modifier = Modifier
            .size(width = width, height = height)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surface)
            .border(borderWidth, border, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (char != null) {
            Text(
                text = char.toString(),
                style = TextStyle(
                    fontSize = fontSize,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                ),
                color = MaterialTheme.colorScheme.onBackground,
            )
        } else if (active) {
            // A static bar, not a blinking one. The box already carries a
            // thicker rim in the accent colour, so a blink would be a second
            // signal for the same fact — and one that cannot be turned off for
            // anyone who finds motion distracting.
            Box(
                Modifier
                    .width(3.dp)
                    .height(height * 0.42f)
                    .background(MaterialTheme.colorScheme.primary),
            )
        }
    }
}
