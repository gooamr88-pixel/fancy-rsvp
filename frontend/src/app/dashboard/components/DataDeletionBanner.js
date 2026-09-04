'use client';

/* `React` is imported and it is NOT unused — vitest compiles this file with the
   classic JSX runtime. See SmsConsentText.js for the full note. */
import React from 'react';
import CountdownClock, { useCountdown } from '../../hooks/useCountdown';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "EVERYTHING FOR THIS EVENT IS DELETED IN …"
 *
 * Shown on a finished event once the organizer has been warned by email and a
 * deletion has actually been scheduled (`purge_scheduled_at`). It is the live
 * half of that email: the mail carries a figure frozen at the moment it was
 * sent, and this one ticks.
 *
 * ── Why this exists at all, rather than just the email ──
 *
 * The email is the notice; this is the reminder. An organizer who archived the
 * mail, or never saw it, opens their dashboard to a red bar counting down
 * rather than to an event that silently vanishes overnight. On a deletion that
 * cannot be undone, one notification is not enough.
 *
 * ── Why there is no <style jsx> here ──
 *
 * It renders inside the dashboard page's own tree, and styled-jsx scopes rules
 * to the component that declares them: a rule written here for markup rendered
 * through a parent silently matches nothing. Inline styles and global .fx-*
 * utilities only. (frontend/AGENTS.md, "three silent failure modes".)
 *
 * ── Layout ──
 *
 * `.fx-row` rather than a fixed grid, so at 320px the clock, the text and the
 * buttons stack instead of overflowing. Per AGENTS.md a fixed-column grid
 * cannot fit a phone, and this bar is at its most important on one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const C = {
  alert: '#B23B3B',
  alertBg: '#FBF0F0',
  alertBorder: '#EBC9C9',
  charcoal: '#191B1E',
  ink: '#4A4742',
  stone: '#77736A',
  white: '#FFFFFF',
  gold: '#B8944F',
};

function WarningIcon({ color = C.alert, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M12 9v4M12 17h.01" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * @param {object}  props
 * @param {string}  props.deleteAt      events.purge_scheduled_at (ISO). Null = nothing scheduled.
 * @param {string}  props.eventTitle
 * @param {string}  props.archiveUrl    signed download link from the warning email
 * @param {string}  [props.keepUrl]     signed opt-out link; omitted when PURGE_ALLOW_OPT_OUT=false
 * @param {boolean} [props.optedOut]    events.purge_opt_out — renders the resolved state instead
 */
export default function DataDeletionBanner({
  deleteAt, eventTitle, archiveUrl, keepUrl = null, optedOut = false,
}) {
  const countdown = useCountdown(deleteAt);

  /**
   * Nothing scheduled and no opt-out to report → render nothing.
   *
   * Deliberately BEFORE the countdown is consulted, so an event that was never
   * scheduled cannot flash a bar for one frame while the hook returns null.
   */
  if (!deleteAt && !optedOut) return null;

  if (optedOut) {
    /* The resolved state, kept rather than hiding the bar entirely. An
       organizer who clicked "keep my data" from an email on their phone has no
       other confirmation anywhere that it worked. */
    return (
      <div
        /* .fx-row, not a raw `display: flex`. A two-child flex row that cannot
           wrap is a rigid row, and at 320px this one's sentence has nowhere to
           go — mobileFit.test.js catches exactly this and caught this line. */
        className="fx-row"
        style={{
          alignItems: 'center', gap: 10,
          padding: '12px 16px', borderRadius: 12, marginBottom: 16,
          background: '#F3F8F4', border: '1px solid #BFE3CF',
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#2F6B4F',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M20 6 9 17l-5-5" stroke="#3B9B6D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>This event&rsquo;s data is being kept. Nothing will be deleted.</span>
      </div>
    );
  }

  // Past the deadline the sweep may not have run yet — it is periodic, not
  // instantaneous. Saying "being deleted now" is true and does not promise a
  // precision the backend does not have.
  const expired = countdown?.expired === true;

  return (
    <div
      role="region"
      aria-label="Scheduled data deletion"
      className="fx-row fx-row--between"
      style={{
        gap: 16, padding: '16px 18px', borderRadius: 14, marginBottom: 18,
        background: C.alertBg, border: `1px solid ${C.alertBorder}`,
        // A hairline of the true alert red down the leading edge. Logical
        // property so it flips for RTL rather than sitting on the wrong side.
        borderInlineStartWidth: 4, borderInlineStartColor: C.alert, borderInlineStartStyle: 'solid',
      }}
    >
      {/* THE FLEX SIZING HERE IS MEASURED, NOT GUESSED.
          At 390px the first version overflowed the card and wrapped the icon
          onto its own line, both from the same cause: a 260px flex-basis on
          this block plus a non-shrinking button group is 260 + ~313 against
          ~310px of available width.
          `1 1 180px` lets it shrink below its basis, which is what stops the
          overflow; the binding floor underneath is the countdown itself
          (8 monospace characters at 30px ≈ 145px) plus the icon and gap. */}
      <div className="fx-row fx-min0" style={{ gap: 12, alignItems: 'flex-start', flex: '1 1 180px' }}>
        <WarningIcon />
        {/* Grow/shrink from a ZERO basis rather than the default `0 1 auto`:
            with auto the text block sizes to its content, cannot shrink past
            it, and wraps below the icon instead of sitting beside it.

            Written as three longhands, not `flex: '1 1 0'`. The shorthand with a
            unitless basis is valid CSS that real browsers accept — and jsdom's
            parser rejects the whole declaration, so it silently vanished from
            the render and the wrap it was meant to fix was still there in the
            screenshot. `0%` in the shorthand would work too; longhands cannot be
            dropped as a unit. */}
        <div className="fx-min0" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: C.alert, marginBottom: 6,
          }}>
            {expired ? 'Deleting now' : 'Data deletion scheduled'}
          </div>

          {expired ? (
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: C.ink, lineHeight: 1.55 }}>
              Everything for <strong style={{ color: C.charcoal }}>{eventTitle}</strong> is being permanently
              deleted.
            </div>
          ) : (
            <>
              <CountdownClock
                target={deleteAt}
                size={30}
                color={C.alert}
                label="Time until this event's data is deleted"
                showDays
                style={{ display: 'block', marginBottom: 6 }}
              />
              <div className="fx-break" style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: C.ink, lineHeight: 1.6 }}>
                Everything for <strong style={{ color: C.charcoal }}>{eventTitle}</strong> — guests, RSVPs,
                seating, check-ins and the guest page — is permanently deleted when this reaches zero.
                This cannot be undone.
              </div>
            </>
          )}
        </div>
      </div>

      {/* `0 1 auto` — the middle of three settings that were each wrong in a
          different way, all three seen in a screenshot rather than reasoned
          about:
            0 0 auto (flexShrink: 0) → two nowrap pills are ~313px together and
                     cannot shrink, so the card overflowed a 390px phone.
            1 1 auto → shrinks fine, but GROWS on a desktop, so with
                     space-between the buttons floated in the middle of a
                     1100px bar instead of sitting at its end.
            0 1 auto → does not grow, so space-between pushes it hard right on
                     desktop; still shrinks and, once its own .fx-row wrap
                     stacks the two pills, fits 320px. */}
      <div className="fx-row" style={{ gap: 8, flex: '0 1 auto' }}>
        {archiveUrl && (
          /* A plain <a>, not next/link. This is an API route that streams a
             file, not an app route — routing it through the client router would
             try to render a spreadsheet as a page. */
          <a
            href={archiveUrl}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 16px', borderRadius: 999,
              background: C.alert, color: C.white, textDecoration: 'none',
              fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            Download everything
          </a>
        )}
        {keepUrl && !expired && (
          <a
            href={keepUrl}
            style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '10px 16px', borderRadius: 999,
              background: C.white, color: C.ink, textDecoration: 'none',
              border: `1px solid ${C.alertBorder}`,
              fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            Keep my data
          </a>
        )}
      </div>
    </div>
  );
}
