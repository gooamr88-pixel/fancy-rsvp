'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { isAccepted } from '../../utils/responseHelpers';

/* One definition, worn by both the link and the button, so the two can never
   drift into looking like different controls. `border: none` matters: a
   <button> inherits a UA border and a <a> does not, so without it the demo's
   version would sit a pixel wider than the organizer's. */
const floorPlanStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '10px 20px', minHeight: 'var(--fx-touch)', borderRadius: 9, border: 'none',
  background: 'linear-gradient(135deg, #D7BE80 0%, #B8944F 100%)',
  color: '#FFFFFF', fontSize: 12.5, fontWeight: 700,
  fontFamily: 'var(--font-sans)', cursor: 'pointer',
  textDecoration: 'none', whiteSpace: 'nowrap',
};

function FloorPlanIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

/**
 * How far along the seating is, and where the map fits.
 *
 * ── Why this had to be added ──
 *
 * The seating section was a table-creation form beside a paginated list of
 * dropdowns. Neither answered the only question an organizer opens it to ask —
 * "have I seated everyone?" — and the filter next to the list offered the four RSVP
 * states but nothing about seating, so the question could not be asked either.
 * Finding the guests who still needed a table meant paging through the list reading
 * "Unassigned" off each dropdown.
 *
 * ── Why it counts PEOPLE, not parties ──
 *
 * Capacity is in seats. A family of four occupies four of them, so a party count
 * would let an organizer read "12 of 12 seated" while thirty people have nowhere to
 * sit. Everything here is heads, and the tables' remaining capacity is computed the
 * same way — the same rule the assign_seat RPC enforces server-side.
 *
 * ── Why it says the map is the same chart ──
 *
 * Two surfaces both create tables and both assign guests: this list, and the
 * drag-and-drop map. Nothing told the organizer whether they were two views of one
 * chart or two separate tools, so assigning here felt like it might not "count".
 * One sentence settles it, and the link carries the event so the map opens on the
 * one they are working on.
 */
export default function SeatingProgress({ rsvps = [], tables = [], onShowUnseated, eventId, onOpenFloorPlan }) {
  const stats = useMemo(() => {
    const attending = rsvps.filter((r) => isAccepted(r.response));
    const heads = (list) => list.reduce((sum, r) => sum + (r.party_size || 1), 0);

    const seatedParties = attending.filter((r) => !!r.tableId);
    const unseatedParties = attending.filter((r) => !r.tableId);

    const capacity = tables.reduce((sum, t) => sum + (Number(t.max_capacity) || 0), 0);
    const seatedHeads = heads(seatedParties);

    return {
      seated: seatedHeads,
      unseated: heads(unseatedParties),
      unseatedParties: unseatedParties.length,
      total: heads(attending),
      capacity,
      tables: tables.length,
      // Negative is possible and is worth showing: assign_seat can be forced past
      // capacity from the map, and an organizer who did that should see it here
      // rather than discover it at the venue.
      spare: capacity - seatedHeads,
    };
  }, [rsvps, tables]);

  const done = stats.total > 0 && stats.unseated === 0;
  const pct = stats.total > 0 ? Math.round((stats.seated / stats.total) * 100) : 0;

  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E8E2D6', borderRadius: 12,
      padding: '16px 20px', fontFamily: 'var(--font-sans)',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16,
      justifyContent: 'space-between',
    }}>
      <div style={{ minWidth: 220, flex: '1 1 260px' }}>
        {stats.total === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: '#77736A', lineHeight: 1.6 }}>
            Nobody has accepted yet. Seating opens up as your guests reply — only
            guests who said yes can be given a seat.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 18, color: '#191B1E' }}>
                {stats.seated} of {stats.total}
              </strong>
              <span style={{ fontSize: 12.5, color: '#77736A' }}>
                guests seated{done ? ' — everyone has a table' : ''}
              </span>
            </div>

            {/* A bar rather than only a number: "34 of 47" needs arithmetic to feel
                like progress, and this screen is often opened just to check. */}
            <div style={{
              height: 6, borderRadius: 999, background: '#F0ECE3',
              marginTop: 8, overflow: 'hidden',
            }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 999,
                background: done ? '#3D7A3D' : 'linear-gradient(90deg, #D7BE80, #B8944F)',
                transition: 'width 0.4s ease',
              }} />
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: '#77736A' }}>
              {stats.tables === 0
                ? 'No tables yet — create one on the left to start seating.'
                : `${stats.tables} ${stats.tables === 1 ? 'table' : 'tables'}, ${
                  stats.spare >= 0
                    ? `${stats.spare} ${stats.spare === 1 ? 'seat' : 'seats'} spare`
                    : `${Math.abs(stats.spare)} over capacity`
                }`}
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {stats.unseated > 0 && (
          <button
            type="button"
            onClick={onShowUnseated}
            style={{
              padding: '9px 16px', minHeight: 'var(--fx-touch)', borderRadius: 9,
              border: '1px solid #E8E2D6', background: '#FFFFFF',
              color: '#191B1E', fontSize: 12.5, fontWeight: 700,
              fontFamily: 'var(--font-sans)', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Show the {stats.unseatedParties} still to seat
          </button>
        )}
        {/* A LINK for an organizer, a BUTTON in the demo.

            The floor plan is its own full-bleed route behind the dashboard's
            auth middleware, so following this link from the public demo
            lands a visitor on a login screen — a dead end that reads as the
            product being broken rather than as a boundary. `onOpenFloorPlan`
            lets the caller answer for it instead; every other caller passes
            nothing and gets the link it always had. */}
        {onOpenFloorPlan ? (
          <button type="button" onClick={onOpenFloorPlan} style={floorPlanStyle}>
            <FloorPlanIcon />
            Open the floor plan
          </button>
        ) : (
          <Link
            href={`/dashboard/seating-map${eventId ? `?event=${eventId}` : ''}`}
            style={floorPlanStyle}
          >
            <FloorPlanIcon />
            Open the floor plan
          </Link>
        )}
      </div>

      <p style={{
        margin: 0, flexBasis: '100%', fontSize: 11.5, color: '#9A958B', lineHeight: 1.55,
      }}>
        The floor plan is the same chart, arranged visually — drag guests onto tables
        there, or use the list below. Either way it is one seating chart.
      </p>
    </div>
  );
}
