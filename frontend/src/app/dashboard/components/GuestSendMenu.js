'use client';

// The default import is needed by the test runner's classic JSX transform —
// Next compiles with the automatic runtime and does not, which is why this file
// went without one until it grew a test. Every other tested component here
// imports it the same way.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { PlanLockBadge, plansSentence } from './PlanLock';

/**
 * The four things you can send ONE guest, named, and grouped by how they arrive.
 *
 * ── What this replaces ──
 *
 * A row of six 44px squares: edit, email-invitation, text-invitation,
 * resend-confirmation, send-QR-pass, delete. Six different actions — one of which
 * bills per segment and one of which deletes a guest — distinguished only by small
 * SVG glyphs, with their meaning in a `title` attribute. `title` is a desktop
 * hover tooltip: it is never shown on touch and is not reliably announced. So on a
 * phone the row was six unlabelled squares.
 *
 * Two of the glyphs were a paper plane and an envelope, sitting adjacent, and the
 * code comment beside them admitted the problem in as many words: "The two sit
 * next to each other in the same row, so they must not share a glyph."
 *
 * ── Why grouped by channel ──
 *
 * The organizer asked for the email actions distinguishable in one place and the
 * text actions in another, and that grouping happens to carry the only distinction
 * that actually matters here: **email is free, text costs money.** A heading per
 * group states it once, rather than repeating a price on four buttons or leaving it
 * unsaid.
 *
 * ── Why a menu and not more buttons ──
 *
 * Four full-width labelled send buttons per row, times twenty rows, is a wall. The
 * two highest-frequency actions stay visible in the row; these four live behind one
 * labelled "Send" button, where each has room for a sentence explaining what the
 * guest will receive. An organizer who is not sure what "entry pass" means can read
 * it here instead of guessing from a ticket icon.
 */

const C = {
  gold: '#B8944F',
  charcoal: '#191B1E',
  stone: '#77736A',
  border: '#E8E2D6',
  white: '#FFFFFF',
  ivory: '#F8F4EC',
  hover: '#FDFCF9',
  greenDark: '#3D7A3D',
};

export default function GuestSendMenu({
  guestName,
  /**
   * ({ channel, smsType }) => void
   *   channel: 'email' | 'qr' | 'sms' | 'detail-sms'  — HOW it travels
   *   smsType: null | 'seating_reminder' | 'event_update'  — WHICH text
   *
   * Two fields rather than one, because several items are channel 'sms' and
   * differ only by which message they send. The JSDoc here always said
   * "{ channel }" while the implementation passed a bare string; it passes the
   * object now, and the string form is still tolerated by the caller.
   */
  onSend,
  /** Truthy while any send for this guest is in flight. */
  busy = false,
  /** Whether this event bought texting at all. */
  smsActive = false,
  /**
   * Plan-level access: 'granted' | 'grandfathered' | 'locked'.
   *
   * Distinct from `smsActive`, and the distinction is what the organizer sees:
   * "you have not bought messages yet" is a purchase away and the row routes to
   * checkout, while "your plan does not include texting" is an upgrade away and
   * routing to checkout would send them to a screen they cannot use.
   */
  smsAccess = 'granted',
  /** Plan names that carry texting, for the locked wording. */
  plansWithSms = [],
  /** Called when texting is locked by PLAN, to route to the plans screen. */
  onUpgradePlan,
  /** { reachable, label } from smsReachability — why this guest cannot be texted. */
  reach = null,
  /** Only an accepted guest has a seat and a pass to be told about. */
  attending = false,
  /** Called when texting is locked, to route to the purchase page. */
  onBuySms,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  /**
   * ── WHY THIS MENU IS PORTALLED AND POSITIONED BY HAND ──
   *
   * It was `position: absolute` inside the row. Both of its ancestors in the
   * replies list CLIP:
   *
   *   <div style={{ borderRadius: 12, overflow: 'hidden' }}>        ← clips
   *     <div className="rsvps-table-wrap" style={{ overflowX: 'auto' }}>  ← clips
   *
   * `overflow-x: auto` is not one-dimensional either: with `overflow-y: visible`
   * the spec computes the y axis to `auto` as well, so the panel was boxed in on
   * both axes. A 292px panel opening from a row near the bottom of the table was
   * cut off, and on the last rows it was invisible — while its width could push
   * the wrapper into horizontal scrolling. `z-index: 60` never helped, because
   * clipping is not a stacking question.
   *
   * That is why it looked broken "in all modes": it is a desktop bug and a phone
   * bug with one cause.
   *
   * Rendering into document.body escapes every ancestor. The cost is that the
   * panel no longer follows the trigger, so its position is measured on open and
   * re-measured on scroll and resize — and `position: fixed` keeps it in
   * viewport coordinates, which is what getBoundingClientRect already returns.
   */
  const [coords, setCoords] = useState(null);

  const place = useCallback(() => {
    const trigger = wrapRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const GAP = 6;
    const MARGIN = 12;          // never touch the screen edge

    /**
     * BELOW md THIS IS A BOTTOM SHEET, not a dropdown.
     *
     * Escaping the clip made the panel correct; it did not make it right for a
     * phone. Anchored to a row, a ~300px panel on a 667px screen still lands
     * wherever the row happens to be, flips direction depending on how far you
     * have scrolled, and puts its options under whichever thumb is not holding
     * the phone. Every mobile OS answers this the same way — a sheet from the
     * bottom edge, full width, thumb-reachable, with the page dimmed behind it.
     *
     * Measured at open time rather than through a media-query hook: the panel
     * only exists after a tap, so there is no server render to mismatch, and
     * `place` already re-runs on resize and orientation change.
     */
    if (window.innerWidth < 768) {
      setCoords({ sheet: true });
      return;
    }

    const width = Math.min(292, window.innerWidth - MARGIN * 2);
    // Right-aligned to the trigger, then pulled back inside the viewport.
    const left = Math.min(
      Math.max(MARGIN, r.right - width),
      window.innerWidth - width - MARGIN,
    );
    // Flip above when there is not room below. The panel is ~300px tall with
    // both groups; on the last row of a list, below is exactly where there is
    // no room.
    const estimated = 320;
    const below = window.innerHeight - r.bottom - GAP;
    const above = r.top - GAP;
    const openUp = below < estimated && above > below;
    /**
     * The cap is the room on the side actually chosen — no floor.
     *
     * This was `Math.max(180, room - MARGIN)`, which is not a minimum height so
     * much as a promise to overflow: on a short viewport (a landscape phone, or
     * a desktop window dragged small) the real room can be under 180px, and
     * forcing 180 pushes the panel off the screen — reintroducing, by a
     * different route, exactly the "cannot reach the options" bug this change
     * exists to fix. Less room simply means more scrolling.
     */
    setCoords({
      left,
      width,
      ...(openUp ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      maxHeight: Math.max(120, (openUp ? above : below) - MARGIN),
    });
  }, []);

  // Close on an outside click or Escape. Registered only while open, so a page of
  // twenty rows is not carrying twenty idle document listeners.
  useEffect(() => {
    if (!open) return undefined;
    /**
     * NOTE the first measurement does NOT happen here.
     *
     * Calling `place()` in the effect body is a synchronous setState in an
     * effect — a cascading render, and an error under this repo's
     * react-hooks/set-state-in-effect rule. It is also unnecessary: the trigger
     * is mounted long before the menu opens, so its rect can be measured in the
     * click handler that opens it (see `openAt`). This effect only subscribes.
     */
    const onDoc = (e) => {
      // BOTH refs: the panel is no longer a descendant of the wrapper, so
      // testing the wrapper alone would treat every click inside the menu as an
      // outside click and close it before the button could fire.
      if (wrapRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // Reposition rather than close: a fixed panel would otherwise sit still
    // while the list scrolls out from under it. `capture` catches scrolls on the
    // inner table wrapper, which do not bubble to window.
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  /**
   * Measure, THEN open — both in the click handler.
   *
   * Ordering matters: `place()` first means `coords` is already set on the
   * render that first shows the panel, so it never paints at a default position
   * and jump to the right one.
   */
  const openAt = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) place();
      return !wasOpen;
    });
  }, [place]);

  /**
   * Three reasons texting can be unavailable, in the order they must be
   * reported. Plan first: an organizer whose PLAN lacks texting cannot fix
   * anything by buying an allowance, so telling them "not switched on for this
   * event" sends them to a purchase screen that will refuse them.
   */
  const planLocked = smsAccess === 'locked';
  const textBlocked = planLocked ? 'Your plan does not include text messaging'
    : !smsActive ? 'Texting is not switched on for this event'
      : !reach?.reachable ? (reach?.label || 'This guest cannot be texted')
        : null;

  const groups = [
    {
      id: 'email',
      heading: 'By email',
      note: 'Free',
      noteColor: C.greenDark,
      items: [
        {
          channel: 'email',
          label: 'The invitation',
          hint: 'Their invitation card and a link to reply.',
          disabled: null,
        },
        {
          channel: 'qr',
          label: 'Entry pass & table',
          hint: attending
            ? 'A scannable pass for the door, plus where they are sitting.'
            : 'Only for guests who accepted — they have no seat yet.',
          disabled: attending ? null : 'This guest has not accepted yet',
        },
      ],
    },
    {
      id: 'sms',
      heading: 'By text message',
      // Said once per group rather than on each button. The organizer is paying per
      // segment and has a right to see that before pressing, not after.
      // When the plan does not carry texting the group is merchandised instead:
      // the price of a balance is irrelevant to somebody who cannot buy one.
      note: planLocked ? null : 'Uses your message balance',
      noteColor: C.gold,
      lockBadge: planLocked,
      items: [
        {
          channel: 'sms',
          label: 'The invitation',
          hint: 'A short text with a link to their invitation.',
          disabled: textBlocked,
        },
        {
          channel: 'detail-sms',
          label: 'All their details',
          hint: attending
            ? 'Date, venue, their table, who is with them, the meals, and their pass link — in the message itself.'
            : 'Only for guests who accepted — there are no details to send yet.',
          disabled: textBlocked || (attending ? null : 'This guest has not accepted yet'),
        },
        /**
         * The two types that were only ever sent on a schedule, now sendable by
         * hand as well.
         *
         * Both carry `smsType` rather than a new `channel` string, and that
         * distinction is deliberate: `channel` says HOW the message travels and
         * the parent keys its per-button spinner off it, while `smsType` says
         * WHICH message. Minting a fresh channel per type would mean every
         * caller of onSend has to learn a new string, and the API would grow a
         * branch per message type — exactly the split the unified endpoint
         * exists to close.
         *
         * `detail-sms` above keeps its own channel only because it predates
         * `smsType` and clients in flight still post it.
         */
        {
          channel: 'sms',
          smsType: 'seating_reminder',
          label: 'Table & entry pass',
          hint: attending
            ? 'Sends automatically 2 hours before the event — use this to send it now.'
            : 'Only for guests who accepted — they have no seat yet.',
          disabled: textBlocked || (attending ? null : 'This guest has not accepted yet'),
        },
        {
          channel: 'sms',
          smsType: 'event_update',
          label: 'Something has changed',
          // Says what it does NOT do. The cancellation wording is reachable only
          // by actually cancelling the event, and an organizer looking for a way
          // to tell people it is off needs to be sent to the right place rather
          // than left thinking this button did it.
          hint: 'Tells them the date or place has changed and links to the new details. To call the event off, cancel it instead.',
          disabled: textBlocked,
        },
      ],
    },
  ];

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={openAt}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Send something to ${guestName || 'this guest'}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', minHeight: 'var(--fx-touch)',
          borderRadius: 8, border: `1px solid ${open ? C.gold : C.border}`,
          background: open ? C.ivory : C.white,
          color: open ? C.gold : C.charcoal,
          fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)',
          cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" />
        </svg>
        {busy ? 'Sending…' : 'Send'}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <>
        {/* The dim behind a sheet. Phone only — a desktop dropdown that darkened
            the whole page for four options would be heavy-handed. It is also the
            close affordance: on a phone there is nowhere obvious to "click
            outside" when the sheet covers the bottom of the screen. */}
        {coords.sheet && (
          <div
            onMouseDown={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(25,27,30,0.45)' }}
          />
        )}
        <div
          ref={panelRef}
          role="menu"
          style={coords.sheet ? {
            /**
             * ── PHONE: a bottom sheet ──
             * Full width against the bottom edge, rounded at the top only, and
             * padded for the home indicator. 85vh so a short landscape screen
             * scrolls the options instead of hiding them.
             */
            position: 'fixed', zIndex: 1000,
            left: 0, right: 0, bottom: 0,
            maxHeight: '85vh', overflowY: 'auto', overscrollBehavior: 'contain',
            background: C.white,
            borderTop: `1px solid ${C.border}`,
            borderRadius: '16px 16px 0 0',
            boxShadow: '0 -12px 32px rgba(0,0,0,0.18)',
            /**
             * Longhands, not the `padding` shorthand.
             *
             * `padding: 6px 6px max(10px, env(...))` is valid CSS, but a parser
             * that does not understand `env()` inside `max()` drops the WHOLE
             * declaration — losing all four sides, not just the bottom one it
             * could not read. Splitting it means the worst case is a sheet whose
             * last option sits a little close to the home indicator, instead of
             * one with no padding at all.
             */
            paddingTop: 6, paddingLeft: 6, paddingRight: 6,
            paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
            textAlign: 'left',
          } : {
            /**
             * fixed + portalled to <body>. See the note on `place` for why: the
             * two ancestors in the replies list both clip, so an absolutely
             * positioned panel was cut off on every row near the bottom.
             *
             * z-index 1000 matches the modals in this dashboard — the panel now
             * shares a stacking context with them rather than with the table it
             * used to live in.
             */
            position: 'fixed', zIndex: 1000,
            left: coords.left,
            ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
            width: coords.width,
            // Scrolls rather than overflowing the screen when a short viewport
            // (a phone in landscape, or the keyboard open) cannot fit both groups.
            maxHeight: coords.maxHeight,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            padding: 6, textAlign: 'left',
          }}
        >
          {groups.map((group, gi) => (
            <div key={group.id} style={{ marginTop: gi === 0 ? 0 : 4 }}>
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
                padding: '8px 10px 6px',
              }}>
                <span style={{
                  fontSize: 'var(--fx-micro)', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
                  color: C.stone, fontFamily: 'var(--font-sans)',
                }}>{group.heading}</span>
                {group.lockBadge ? (
                  <PlanLockBadge label="Plan feature" title="Text messaging is part of a higher plan" />
                ) : group.note ? (
                  <span style={{
                    fontSize: 'var(--fx-micro)', fontWeight: 700, color: group.noteColor, fontFamily: 'var(--font-sans)',
                    whiteSpace: 'nowrap',
                  }}>{group.note}</span>
                ) : null}
              </div>

              {group.items.map((item) => {
                const locked = !!item.disabled;
                /**
                 * Two "disabled" states in this group have an action behind
                 * them, so they stay clickable rather than being dead rows —
                 * and they lead to DIFFERENT places:
                 *   plan does not include texting → the plans screen
                 *   plan includes it, none bought → the purchase screen
                 * Sending the first case to checkout is the bug this split
                 * exists to prevent: that screen refuses them.
                 */
                const upgradeInstead = locked && planLocked && group.id === 'sms';
                const buyInstead = locked && !planLocked && !smsActive && group.id === 'sms';
                const actionable = upgradeInstead || buyInstead;
                return (
                  <button
                    /* `channel` alone is no longer unique — three items in this
                       group are channel 'sms' and differ only by smsType, so a
                       bare channel key would collide and React would reuse the
                       wrong node between them. */
                    key={item.smsType ? `${item.channel}:${item.smsType}` : item.channel}
                    type="button"
                    role="menuitem"
                    disabled={locked && !actionable}
                    title={locked ? item.disabled : undefined}
                    onClick={() => {
                      setOpen(false);
                      if (upgradeInstead) { onUpgradePlan?.(); return; }
                      if (buyInstead) { onBuySms?.(); return; }
                      // The whole descriptor, not just the channel: the caller
                      // needs smsType to know WHICH text was asked for.
                      if (!locked) onSend?.({ channel: item.channel, smsType: item.smsType || null });
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      // Each option is a two-line block (label + hint), so it
                      // clears 44px on its own at every width EXCEPT when the
                      // hint wraps to nothing — the floor makes that certain
                      // rather than incidental.
                      padding: '10px', minHeight: 'var(--fx-touch)',
                      borderRadius: 8, border: 'none',
                      background: 'transparent',
                      cursor: locked && !actionable ? 'not-allowed' : 'pointer',
                      opacity: locked && !actionable ? 0.5 : 1,
                      fontFamily: 'var(--font-sans)',
                    }}
                    onMouseEnter={(e) => { if (!locked || actionable) e.currentTarget.style.background = C.hover; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.charcoal }}>
                      {item.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.stone, lineHeight: 1.5, marginTop: 2 }}>
                      {locked ? item.disabled : item.hint}
                    </span>
                    {(buyInstead || upgradeInstead) && (
                      <span style={{ display: 'block', fontSize: 11.5, color: C.gold, fontWeight: 700, marginTop: 3 }}>
                        {upgradeInstead
                          ? (plansWithSms.length > 0 ? `On ${plansSentence(plansWithSms)} →` : 'See plans →')
                          : 'Add texting →'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}
