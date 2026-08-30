'use client';
import { toast } from '../../utils/toast';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logout, apiFetch } from '../../utils/apiClient';
import LogoutModal from '../../components/LogoutModal';
import { useIsClient } from '../../utils/useIsClient';
import Icon from '../../components/icons/Icon';
import { useConfirm } from '../../components/useConfirm';
// The shape catalogue and world geometry are shared with the two guest-facing
// maps — see utils/seatingGeometry.js for why they must not be re-declared here.
import {
  WORLD_W, WORLD_H, SHAPES, shapeMeta, isZone,
  elWidth, elHeight, pctToPx, elBox,
} from '../../utils/seatingGeometry';
/**
 * The printed pack lives in its own module, and that is not just file hygiene.
 * This page is already ~2,700 lines of editor; the export is a different
 * artefact with its own layout rules, its own page geometry and its own type
 * scale, and the one time they shared a scope the export shipped dead for
 * everybody (a top-level function read a `useState` local of THIS component and
 * threw ReferenceError on every render). Separate modules make that class of
 * mistake a build-visible import instead of a silent free variable.
 */
import SeatingChartPrintModal from './SeatingChartPrint';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const C = { gold: '#B8944F', goldHover: '#a6833f', charcoal: '#191B1E', ivory: '#F8F4EC', champagne: '#D7BE80', stone: '#77736A', border: '#E8E2D6', white: '#FFFFFF', danger: '#C45E5E' };
/* The printed chart's one ink now lives with the document that uses it, in
   SeatingChartPrint.js — this editor is deliberately colour-coded and does not
   share it. */
// Shared style for the "Select All ▾" menu's Type/Capacity <select> controls.
const selectMenuInputStyle = { width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, outline: 'none', marginTop: 3, background: C.white, color: C.charcoal, fontFamily: 'var(--font-sans, sans-serif)' };

/* ════════════════════════════════════════════════════════════════
   Editor-only constants. The world size, the shape catalogue and every
   coordinate helper live in utils/seatingGeometry.js and are imported
   above — they are shared with the two guest-facing maps and must not be
   re-declared here (see that file's header for the two bugs that caused).
   ════════════════════════════════════════════════════════════════ */
const MIN_SCALE = 0.18;
const MAX_SCALE = 2.5;
const ROW_H = 58;          // guest row height (virtualization)
const PAGE_SIZE = 100;     // server page size for guest list

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * ── THE VIEW CANNOT BE PANNED INTO NOTHING. ──
 *
 * `tx`/`ty` are the screen position of the world's origin, and until now they
 * were completely unbounded. That was survivable while the only way to pan was
 * to hold space and physically drag: getting lost took real effort, and "Fit"
 * was there for when you did.
 *
 * It stops being survivable the moment the WHEEL pans. Two flicks of a trackpad
 * move the view several thousand pixels, the 2600x1700 world leaves the
 * viewport entirely, and the organizer is looking at blank ivory with no cue
 * that their layout still exists — which is a new and worse version of the
 * "مفيش حرية في التنقل" this whole change set out to fix.
 *
 * So: at least KEEP px of the world stays on screen on each axis. Not a hard
 * "world must fill the viewport" clamp — you still need to pan a little past
 * the edge to place an element near the boundary, and at a zoomed-out scale the
 * world is SMALLER than the viewport, where such a rule would fight every
 * gesture. `Math.min(KEEP, worldOnScreen)` handles that case by degrading to
 * "the world may not leave the viewport at all".
 *
 * Applied centrally to every write that moves the view — drag, wheel, arrows,
 * zoom buttons, and the drag-an-element edge auto-pan — so no future caller
 * can reintroduce an unbounded one.
 */
const VIEW_KEEP_PX = 140;
const clampView = (v, vw, vh) => {
  // A zero-size viewport happens for one render before the ResizeObserver
  // measures; clamping against it would slam tx/ty to nonsense.
  if (!(vw > 0) || !(vh > 0)) return v;
  const worldW = WORLD_W * v.scale;
  const worldH = WORLD_H * v.scale;
  const keepX = Math.min(VIEW_KEEP_PX, worldW);
  const keepY = Math.min(VIEW_KEEP_PX, worldH);
  return {
    ...v,
    tx: clamp(v.tx, keepX - worldW, vw - keepX),
    ty: clamp(v.ty, keepY - worldH, vh - keepY),
  };
};

/* ── Seat dots around a table ── */
function renderSeats(shape, capacity, occupied, w, h) {
  const meta = shapeMeta(shape);
  const cap = Math.max(0, Math.min(capacity || 0, 60));
  const dots = [];
  for (let i = 0; i < cap; i++) {
    const filled = i < occupied;
    const bg = filled ? C.gold : '#E3DCCB';
    let x, y;
    if (meta.round) {
      const angle = (i * 2 * Math.PI) / cap - Math.PI / 2;
      const rx = w / 2 + 9, ry = h / 2 + 9;
      x = w / 2 + rx * Math.cos(angle) - 4;
      y = h / 2 + ry * Math.sin(angle) - 4;
    } else {
      const per = Math.ceil(cap / 2);
      const top = i < per;
      const idx = top ? i : i - per;
      const cnt = top ? per : (cap - per);
      const step = w / (cnt + 1);
      x = step * (idx + 1) - 4;
      y = top ? -10 : h + 2;
    }
    dots.push(<div key={i} style={{ position: 'absolute', left: x, top: y, width: 8, height: 8, borderRadius: '50%', background: bg, border: '1px solid rgba(0,0,0,0.06)', pointerEvents: 'none' }} />);
  }
  return dots;
}

/* ════════════════════════════════════════════════════════════════
   Canvas element (memoized so only the dragged/visible ones re-render)
   ════════════════════════════════════════════════════════════════ */
const EMPTY_NAMES = [];

const CanvasElement = React.memo(function CanvasElement({ el, occupied, names = EMPTY_NAMES, selected, showHandles, dragOver, scale, onPointerDownMove, onResizeStart, onRotateStart, onDropGuest, onDragOverEl, onDragLeaveEl, onSelect }) {
  const meta = shapeMeta(el.shape);
  const zone = isZone(el);
  const w = elWidth(el), h = elHeight(el);
  const left = pctToPx(el.position_x, WORLD_W);
  const top = pctToPx(el.position_y, WORLD_H);
  const rotation = Number(el.rotation) || 0;
  const cap = el.max_capacity || 0;
  const fill = cap > 0 ? (occupied / cap) * 100 : 0;
  const color = el.color || meta.color || C.gold;

  // This element sits inside the canvas's `transform: scale(view.scale)`
  // wrapper, so any px value set here gets shrunk (or grown) by that same
  // factor on screen. Selection borders/handles were defined as flat px
  // values, meaning at a typically-zoomed-out view (scale ~0.3-0.4) a "2px"
  // border rendered under 1px — selection state was updating correctly on
  // click, it just became visually imperceptible, reading as "clicking does
  // nothing." Dividing by scale keeps these a constant size on screen
  // (roughly what they'd look like at 1:1 zoom) at any zoom level.
  const s = Math.max(scale || 1, 0.0001);
  const inv = (px) => px / s;

  return (
    <div
      data-el-id={el.id}
      onPointerDown={(e) => onPointerDownMove(e, el.id)}
      onDragOver={(e) => onDragOverEl(e, el.id)}
      onDragLeave={onDragLeaveEl}
      onDrop={(e) => onDropGuest(e, el.id)}
      style={{
        position: 'absolute', left, top, width: w, height: h,
        transform: `rotate(${rotation}deg)`, transformOrigin: 'center center',
        cursor: 'grab', touchAction: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        borderRadius: meta.round ? '50%' : zone ? '14px' : '12px',
        border: dragOver ? `${inv(2)}px solid ${C.gold}` : selected ? `${inv(2.5)}px solid ${C.gold}` : `${inv(1)}px solid ${zone ? color : C.border}`,
        background: zone ? `${color}1A` : dragOver ? 'rgba(184,148,79,0.10)' : C.white,
        boxShadow: dragOver ? `0 0 ${inv(22)}px rgba(184,148,79,0.25)` : selected ? `0 0 0 ${inv(3)}px rgba(184,148,79,0.18), 0 ${inv(6)}px ${inv(20)}px rgba(0,0,0,0.10)` : 'none',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        userSelect: 'none',
      }}
    >
      {zone ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          maxWidth: '86%', pointerEvents: 'none',
          background: 'rgba(255,255,255,0.94)', border: `1px solid ${color}3D`,
          borderRadius: 10, padding: '9px 14px',
          boxShadow: '0 4px 14px rgba(25,27,30,0.14), 0 1px 3px rgba(25,27,30,0.08)',
        }}>
          {meta.icon && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              width: Math.max(24, Math.min(32, Math.min(w, h) / 4.5)), height: Math.max(24, Math.min(32, Math.min(w, h) / 4.5)),
              borderRadius: '50%', background: `${color}1F`,
            }}>
              <Icon name={meta.icon} size={Math.max(13, Math.min(17, Math.min(w, h) / 8))} color={color} strokeWidth={2} />
            </div>
          )}
          <span style={{
            fontSize: Math.max(14, Math.min(19, Math.min(w, h) / 6)), fontWeight: 700, color: C.charcoal,
            textTransform: 'uppercase', letterSpacing: '0.07em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', textAlign: 'center',
          }}>
            {el.table_name}
          </span>
        </div>
      ) : (
        <>
          {renderSeats(el.shape, cap, occupied, w, h)}
          {/**
            * THE TABLE NUMBER — the one thing on this canvas anyone reads.
            *
            * It was a flat 11px, with the seat count at 9px under it. On a floor
            * plan zoomed out far enough to see the room, that is unreadable, and
            * this label is the whole reason for looking at the map.
            *
            * Scaled to the table rather than fixed, so a small round table does
            * not have its name overflow the shape: 15px on the smallest table,
            * up to 22px on a wide one. Not a --fx-* token — this is canvas text
            * inside a transform that already scales with zoom, so it needs to
            * track the ELEMENT's size, not the viewport's.
            */}
          <span style={{ fontSize: Math.max(15, Math.min(22, Math.min(w, h) / 4.2)), fontWeight: 800, color: C.charcoal, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', padding: '0 4px', pointerEvents: 'none', lineHeight: 1.15 }}>{el.table_name}</span>
          <span style={{ fontSize: Math.max(11, Math.min(14, Math.min(w, h) / 7)), color: C.stone, marginTop: 3, pointerEvents: 'none' }}>{occupied} / {cap}</span>
          {names.length > 0 && (
            <span style={{ fontSize: 9, fontWeight: 600, color: C.gold, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '92%', padding: '0 4px', pointerEvents: 'none', textAlign: 'center' }}>
              {names[0]}{names.length > 1 ? ` +${names.length - 1} more` : ''}
            </span>
          )}
          <div style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 5, border: `1px solid ${C.border}`, background: fill >= 100 ? C.danger : fill >= 80 ? C.champagne : C.gold, pointerEvents: 'none' }} />
        </>
      )}

      {/* Resize handle (zones only) + rotate handle (any element, when selected) —
          rotation lets a rectangular/oval/banquet/head table flip between a
          lengthwise and widthwise layout. Hidden during a multi-selection so a
          "Select All" doesn't sprout a handle on every table at once. Sized
          via inv() too, so they stay a real, grabbable target at any zoom
          instead of shrinking to a few unclickable screen-pixels when zoomed out. */}
      {selected && showHandles && (
        <>
          {zone && (
            <div
              onPointerDown={(e) => onResizeStart(e, el.id)}
              style={{ position: 'absolute', right: inv(-7), bottom: inv(-7), width: inv(14), height: inv(14), borderRadius: inv(4), background: C.white, border: `${inv(2)}px solid ${C.gold}`, cursor: 'nwse-resize', zIndex: 5 }}
            />
          )}
          <div
            onPointerDown={(e) => onRotateStart(e, el.id)}
            style={{ position: 'absolute', left: '50%', top: inv(-26), marginLeft: inv(-7), width: inv(14), height: inv(14), borderRadius: '50%', background: C.gold, border: `${inv(2)}px solid ${C.white}`, cursor: 'grab', zIndex: 5 }}
            title="Rotate"
          />
        </>
      )}
    </div>
  );
}, (a, b) => (
  a.el === b.el && a.occupied === b.occupied && a.names === b.names && a.selected === b.selected && a.showHandles === b.showHandles && a.dragOver === b.dragOver && a.scale === b.scale
));

/* ── "Select All ▾" menu row — a shape/category filter, with its count. ── */
function SelectMenuItem({ label, count, onClick }) {
  const disabled = !count;
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 6,
        padding: '7px 9px', minHeight: 'var(--fx-touch)', fontSize: 12, fontFamily: 'var(--font-sans, sans-serif)',
        color: disabled ? C.border : C.charcoal, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'rgba(184,148,79,0.08)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 10, color: C.stone, fontWeight: 700 }}>{count || 0}</span>
    </button>
  );
}
function SelectMenuDivider() {
  return <div style={{ height: 1, background: C.border, margin: '4px 2px' }} />;
}

/* ════════════════════════════════════════════════════════════════
   Virtualized guest list (renders only the visible window)
   ════════════════════════════════════════════════════════════════ */
function VirtualGuestList({ items, height, onDragStartGuest, onTapGuest, armedGuestId, onReachEnd, loading, emptyText, onResendGuest, resendingId, pendingIds }) {
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef(null);

  const total = items.length;
  const visibleCount = Math.ceil(height / ROW_H) + 6;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - 3);
  const endIdx = Math.min(total, startIdx + visibleCount);
  const slice = items.slice(startIdx, endIdx);

  const onScroll = (e) => {
    const st = e.currentTarget.scrollTop;
    setScrollTop(st);
    if (st + e.currentTarget.clientHeight >= e.currentTarget.scrollHeight - ROW_H * 4) onReachEnd?.();
  };

  if (total === 0) {
    return <p style={{ fontSize: 12, color: C.stone, textAlign: 'center', padding: '32px 0' }}>{loading ? 'Loading…' : emptyText}</p>;
  }

  return (
    <div ref={ref} onScroll={onScroll} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
      <div style={{ height: total * ROW_H, position: 'relative' }}>
        {slice.map((g, i) => {
          const idx = startIdx + i;
          const armed = armedGuestId === g.id;
          return (
            <div
              key={g.id}
              draggable="true"
              onDragStart={(e) => onDragStartGuest(e, g)}
              onClick={() => onTapGuest?.(g)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTapGuest?.(g); } }}
              aria-pressed={armed}
              style={{
                position: 'absolute', top: idx * ROW_H, left: 0, right: 6, height: ROW_H - 8,
                background: armed ? 'rgba(184,148,79,0.12)' : '#FAFAF8', padding: '0 12px',
                border: `1.5px solid ${armed ? C.gold : C.border}`, borderRadius: 10,
                cursor: 'pointer', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
                minHeight: 44, boxSizing: 'border-box',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: C.charcoal, display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.guest_name}</span>
                <span style={{ fontSize: 11, color: C.stone }}>Party of {g.party_size}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {armed ? (
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tap a table</span>
                ) : (
                  <>
                    {/* Seated guests already got their location email automatically on
                        first assignment — any further change is manual, via this resend,
                        so the guest isn't re-emailed every time a table gets nudged. Hidden
                        while a move is staged but unsaved — the backend still has the old
                        table, so resending now would email the wrong assignment. */}
                    {g.tableId && onResendGuest && !pendingIds?.has(g.id) && (
                      <button
                        type="button"
                        title="Resend seating location email"
                        aria-label="Resend seating location email"
                        onClick={(e) => { e.stopPropagation(); onResendGuest(g); }}
                        disabled={resendingId === g.id}
                        style={{
                          width: 26, height: 26, borderRadius: 7, border: `1px solid ${C.border}`,
                          background: C.white, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
                          cursor: resendingId === g.id ? 'wait' : 'pointer', flexShrink: 0,
                        }}
                      >
                        {resendingId === g.id ? (
                          <span style={{ width: 10, height: 10, border: `2px solid ${C.border}`, borderTopColor: C.gold, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        ) : (
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke={C.stone} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1z" /></svg>
                        )}
                      </button>
                    )}
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke={C.stone} strokeWidth={2}><path strokeLinecap="round" d="M4 8h16M4 16h16" /></svg>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {loading && <p style={{ fontSize: 11, color: C.stone, textAlign: 'center', padding: '8px 0' }}>Loading more…</p>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Page
   ════════════════════════════════════════════════════════════════ */
export default function SeatingMapPage() {
  // Awaitable confirms. All three of these sit mid-flow — one inside a save
  // that retries itself with force — so a promise keeps each call site one
  // line instead of splitting working logic into ask/resume halves.
  const [confirm, confirmDialog] = useConfirm();
  const router = useRouter();
  // isClient gates the localStorage reads until we're past hydration (SSR has
  // no localStorage). authChecked/eventId are both fully derived from those
  // reads — neither is ever set anywhere else, so no separate state is needed.
  const isClient = useIsClient();
  const orgId = isClient ? localStorage.getItem('org_id') : null;
  const storedEventId = isClient ? localStorage.getItem('active_event_id') : null;
  const authChecked = isClient && !!orgId && !!storedEventId;
  const eventId = authChecked ? storedEventId : '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [eventIsPaid, setEventIsPaid] = useState(null); // null = loading, true/false = known
  const [hasSeatingFeature, setHasSeatingFeature] = useState(null); // null = loading, true/false = known
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState(null);
  const [eventTimezone, setEventTimezone] = useState(null);
  // Organizer's own display name — shown on the printed/exported chart's
  // letterhead ("Prepared for <organizer>") alongside the event name and the
  // Fancy RSVP brand mark. Non-critical: the print header just omits it if
  // this fetch fails, so it's kept out of the page's main loading/error gate.
  const [organizerName, setOrganizerName] = useState('');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const [elements, setElements] = useState([]);          // tables + zones
  const [summary, setSummary] = useState({ attendingGuests: 0, seatedGuests: 0, unseatedGuests: 0 });
  const [selectedId, setSelectedId] = useState(null);

  // pending seating changes: rsvpId -> { from, to, size }
  const [pending, setPending] = useState({});
  const [movedIds, setMovedIds] = useState(() => new Set());   // tables whose position changed
  const [saving, setSaving] = useState(false);
  /**
   * How many elements have staged geometry (resize/rotate).
   *
   * Declared HERE, immediately above its only reader, and not beside
   * `dirtyGeometryRef` further down where it naturally belongs — `layoutDirty`
   * is evaluated during render, so a `const` declared later is in the temporal
   * dead zone and throws "Cannot access before initialization". That failure
   * does not show up in the dev server or the unit tests; it surfaced only when
   * `next build` tried to prerender this route.
   *
   * A ref cannot drive a re-render, which is why this counter exists at all:
   * without it the Save button could not know it had work to do.
   */
  const [geoDirtyCount, setGeoDirtyCount] = useState(0);

  // Moves AND staged resize/rotate. It counted moves only, which was correct
  // while geometry saved itself and became wrong the moment it stopped.
  const layoutDirty = movedIds.size > 0 || geoDirtyCount > 0;

  // Professional Editor State
  // Off by default — every drag used to lock to a 32px grid from the moment
  // the page loaded, so an element could only ever land on fixed grid steps
  // instead of exactly where it was dragged. That reads as the map fighting
  // you rather than a deliberate alignment aid. Free movement is now the
  // default; the "Snap to Grid" toolbar button still turns it on for anyone
  // who wants tables to line up precisely.
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  const initialLayoutRef = useRef([]);

  const updateHistoryIndex = (val) => {
    setHistoryIndex(val);
    historyIndexRef.current = val;
  };

  // Complete, unfiltered/unpaginated guest roster — used ONLY to label seated
  // guests directly on their table shape on the canvas. Deliberately separate
  // from `guests` below: that list is scoped to whatever search/filter/page
  // the sidebar currently has loaded, so it can't reliably tell us who's at
  // EVERY table at once.
  const [allSeatedGuests, setAllSeatedGuests] = useState([]);

  // guest list (server-paginated + searchable + virtualized)
  const [guests, setGuests] = useState([]);
  const [guestPage, setGuestPage] = useState(1);
  const [guestTotal, setGuestTotal] = useState(0);
  const [guestLoading, setGuestLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('unseated');      // unseated | seated | all

  // Guest whose "resend seating location email" is in flight (disables that
  // row's button + shows a spinner while the request is out).
  const [resendingId, setResendingId] = useState(null);

  // selected table's seated members (fetched on demand)
  const [tableGuests, setTableGuests] = useState([]);

  // inspector edit fields
  const [inspectName, setInspectName] = useState('');
  const [inspectCapacity, setInspectCapacity] = useState('');

  // add-element modal
  const [showAdd, setShowAdd] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  // viewport (zoom/pan) — held in a ref for smooth interaction + mirrored to state for culling
  const viewportRef = useRef(null);
  const [view, setView] = useState({ scale: 0.4, tx: 60, ty: 40 });
  const [containerSize, setContainerSize] = useState({ w: 900, h: 560 });
  // Mirrors containerSize for the stable useCallback([]) handlers (onWheel, the
  // pointermove pan, the edge auto-pan loop). Reading the state value there
  // would capture whatever it was when the closure was created — 900x560, the
  // placeholder — and clamp every pan against a viewport that isn't the real one.
  const containerSizeRef = useRef({ w: 900, h: 560 });
  const [dragPos, setDragPos] = useState(null);          // { id, x, y } during element move
  const dragPosRef = useRef(null);                       // mirrors dragPos for pointerup closure
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // multi-select (Select All, Ctrl/Cmd/Shift-click, + group move)
  const [selectMenuOpen, setSelectMenuOpen] = useState(false);     // "Select All ▾" filter menu (by category/shape)
  const selectMenuRef = useRef(null);
  const [groupDragPos, setGroupDragPos] = useState(null); // Map id -> {x,y} during group move
  const groupDragPosRef = useRef(null);                  // mirrors groupDragPos for pointerup closure
  const [dragOverId, setDragOverId] = useState(null);
  const [panning, setPanning] = useState(false);
  const interaction = useRef(null);                      // { mode, id, ... }
  const lastPointerRef = useRef({ x: 0, y: 0 });         // latest pointer screen coords, for the edge auto-pan loop below
  const movedIdsRef = useRef(new Set());                 // mirrors movedIds for loadLayout merge
  const dirtyGeometryRef = useRef({});                   // id -> { width, height, rotation } unsaved
  // Shift-drag rubber-band select — { x0, y0, x1, y1 } in viewport-relative
  // screen px while active, null otherwise. Mirrored to a ref so the
  // pointerup handler (below) always reads the latest rectangle, same reason
  // dragPos/groupDragPos are mirrored.
  const [marquee, setMarquee] = useState(null);
  // Drives the cursor and the toolbar hint while space is held — the ref that
  // actually gates the gesture cannot re-render anything.
  const [spacePanHint, setSpacePanHint] = useState(false);
  /**
   * ── THE ACTIVE TOOL. 'select' (default, unchanged) or 'hand'. ──
   *
   * Moving around this canvas used to require a gesture nobody discovers:
   * hold space, or press the middle mouse button. A laptop trackpad has
   * neither in easy reach, so on the machines most organizers actually use,
   * the ONLY way to reach a part of the map that was off-screen was to hold a
   * key down with one hand and drag with the other — "لازم الايد تسحب".
   *
   * A visible tool toggle is the fix every layout tool converged on, and it
   * removes nothing: marquee-drag, space-drag, middle-drag and touch all still
   * behave exactly as before while this sits on 'select'. It is a fourth way
   * to pan, not a replacement for the first three.
   */
  const [tool, setTool] = useState('select');
  const toolRef = useRef('select');
  const setToolBoth = useCallback((next) => { toolRef.current = next; setTool(next); }, []);
  const marqueeRef = useRef(null);
  const elementsRef = useRef(elements);                  // lets pointerup read latest elements w/o re-binding the effect
  const viewRef = useRef(view);                           // lets pointerup read the latest pan/zoom w/o re-binding the effect

  const selected = useMemo(() => elements.find(e => e.id === selectedId) || null, [elements, selectedId]);

  /* ── auth + event ── */
  // The redirects are genuine imperative side effects (navigation); they no
  // longer also carry the eventId/authChecked state updates, which are now
  // plain derived values above.
  useEffect(() => {
    if (!isClient) return;
    if (!orgId) { router.push('/login'); return; }
    if (!storedEventId) router.push('/dashboard');
  }, [isClient, orgId, storedEventId, router]);

  // Check event payment status for feature gate
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/events/${eventId}`, { credentials: 'include' });
        const data = await res.json();
        if (data?.event) {
          setEventTitle(data.event.title || '');
          setEventDate(data.event.event_date || null);
          setEventTimezone(data.event.timezone || null);
          setEventIsPaid(!!data.event.is_paid || !!data.event.manual_override);
          // is_paid alone used to be the whole gate here — a paid organizer on a
          // tier that excludes seating_map could still reach this page directly
          // (the dashboard's "Seating" tab correctly checked tier_features via
          // FeatureGate, but this standalone page and the tab's own content did
          // not). manual_override bypasses the tier check entirely, same as the
          // dashboard tab.
          // EITHER key opens the editor, because either key opens the table
          // routes it writes through (requireAnyFeature('seating_map',
          // 'table_management')). Asking for seating_map alone would lock the
          // page against a plan sold on table management, whose saves the
          // server would have accepted.
          const features = Array.isArray(data.event.tier_features) ? data.event.tier_features : [];
          setHasSeatingFeature(
            !!data.event.manual_override
            || features.includes('seating_map')
            || features.includes('table_management'),
          );
        } else {
          setEventIsPaid(false);
          setHasSeatingFeature(false);
        }
      } catch {
        setEventIsPaid(false);
        setHasSeatingFeature(false);
      }
    })();
  }, [eventId]);

  // Organizer's display name for the print/export letterhead — fetched once,
  // independent of the event/layout data above.
  useEffect(() => {
    if (!isClient) return;
    (async () => {
      try {
        const res = await apiFetch('/auth/profile');
        const p = res.profile || res;
        setOrganizerName(p?.name || '');
      } catch { /* non-critical — the print header just omits the name */ }
    })();
  }, [isClient]);

  /* ── keep refs in sync ── */
  useEffect(() => { dragPosRef.current = dragPos; }, [dragPos]);
  useEffect(() => { groupDragPosRef.current = groupDragPos; }, [groupDragPos]);
  useEffect(() => { movedIdsRef.current = movedIds; }, [movedIds]);
  useEffect(() => { marqueeRef.current = marquee; }, [marquee]);
  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { viewRef.current = view; }, [view]);

  /* ── load elements + summary (merges with local dirty state) ── */
  const loadLayout = useCallback(async () => {
    if (!eventId) return;
    try {
      const [tRes, sRes] = await Promise.all([
        fetch(`${API_URL}/events/${eventId}/tables?include=all`, { credentials: 'include' }),
        fetch(`${API_URL}/events/${eventId}/seating/summary`, { credentials: 'include' }),
      ]);
      const tData = await tRes.json();
      if (tData.success) {
        const serverElements = tData.tables || [];
        setElements(prev => {
          const dirty = movedIdsRef.current;
          const geo = dirtyGeometryRef.current;
          let updated = serverElements;
          // If nothing is dirty locally, fast-path replace
          if (dirty.size === 0 && Object.keys(geo).length === 0) {
            updated = serverElements;
          } else {
            // Build overlay of local unsaved changes keyed by id
            const localOverrides = {};
            prev.forEach(el => {
              const overrides = {};
              if (dirty.has(el.id)) {
                overrides.position_x = el.position_x;
                overrides.position_y = el.position_y;
              }
              if (geo[el.id]) {
                Object.assign(overrides, geo[el.id]);
              }
              if (Object.keys(overrides).length > 0) localOverrides[el.id] = overrides;
            });
            // Merge: server data + local dirty overrides
            updated = serverElements.map(el =>
              localOverrides[el.id] ? { ...el, ...localOverrides[el.id] } : el
            );
          }

          initialLayoutRef.current = serverElements;
          const snap = updated.map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
          setHistory([snap]);
          updateHistoryIndex(0);

          return updated;
        });
      }
      const sData = await sRes.json().catch(() => ({}));
      if (sData.success) setSummary(sData.summary);
      setError(null);
    } catch (err) {
      setError('Could not connect to the backend. Make sure the server is running on port 5000.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { if (eventId) loadLayout(); }, [eventId, loadLayout]);

  /* ── guest list: fetch (debounced on search/filter) ── */
  const fetchGuests = useCallback(async (page, replace) => {
    if (!eventId) return;
    setGuestLoading(true);
    try {
      const qs = new URLSearchParams({ search, filter, page: String(page), pageSize: String(PAGE_SIZE) });
      const res = await fetch(`${API_URL}/events/${eventId}/seating/guests?${qs}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setGuestTotal(data.pagination?.total || 0);
        setGuests(prev => replace ? data.guests : [...prev, ...data.guests]);
        setGuestPage(page);
      }
    } catch { /* surfaced via main error state on initial load */ }
    finally { setGuestLoading(false); }
  }, [eventId, search, filter]);

  useEffect(() => {
    if (!eventId) return;
    const t = setTimeout(() => fetchGuests(1, true), 250);
    return () => clearTimeout(t);
  }, [eventId, search, filter, fetchGuests]);

  /* ── complete guest roster for canvas name labels (see allSeatedGuests above) ──
     Pages through filter=all with no search term, independent of whatever the
     sidebar's own search/filter/pagination is currently showing. Capped at 50
     pages (25k guests) as a sanity limit against runaway loops on bad data. */
  const fetchAllGuestsForLabels = useCallback(async () => {
    if (!eventId) return;
    try {
      let all = [];
      for (let page = 1; page <= 50; page++) {
        const qs = new URLSearchParams({ search: '', filter: 'all', page: String(page), pageSize: '500' });
        const res = await fetch(`${API_URL}/events/${eventId}/seating/guests?${qs}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success || !Array.isArray(data.guests) || data.guests.length === 0) break;
        all = all.concat(data.guests);
        const total = data.pagination?.total || 0;
        if (all.length >= total) break;
      }
      setAllSeatedGuests(all);
    } catch { /* non-fatal — canvas labels are a nice-to-have; sidebar/inspector still work */ }
  }, [eventId]);

  // Refetched alongside the layout/summary — same "something about seating
  // changed" signal `loadLayout` already reacts to (assign/reassign/unassign/
  // batch-save all end by calling loadLayout(), which bumps `summary`).
  // Debounced the same way the sidebar's own fetchGuests effect below is —
  // avoids calling the state-setting fetch synchronously from the effect body.
  useEffect(() => {
    if (!eventId) return;
    const t = setTimeout(() => fetchAllGuestsForLabels(), 250);
    return () => clearTimeout(t);
  }, [eventId, summary, fetchAllGuestsForLabels]);

  /* ── who is actually IN each party, for the printed guest index ──
     The seating endpoints deal in parties: one row, one label, a headcount.
     That is the right shape for seating people, and the wrong shape for the
     document somebody holds at the door — a companion arriving before the host
     is not findable under a party label. The full guest list already returns
     every party's member names, so the pack is built from that when it can be.

     Fetched only once the organizer opens the preview, because it is a handful
     of extra requests that nothing on this page needs otherwise, and it
     degrades cleanly: an empty map just means the index lists parties instead
     of people, which is exactly what it did before. */
  const [membersByParty, setMembersByParty] = useState(null);
  const [membersLoading, setMembersLoading] = useState(false);

  // Cleared whenever the active event changes, so the pack can never print one
  // event's guest names against another's tables. `membersByParty` is the
  // effect's own "already loaded" flag, and without this reset a truthy map
  // from the previous event would suppress the refetch entirely.
  const [membersEventId, setMembersEventId] = useState(eventId);
  if (membersEventId !== eventId) {
    setMembersEventId(eventId);
    setMembersByParty(null);
  }

  useEffect(() => {
    if (!showPrintPreview || !eventId || membersByParty) return undefined;
    let cancelled = false;
    setMembersLoading(true);
    (async () => {
      try {
        const map = {};
        // 100 is the endpoint's own hard ceiling; 50 pages is the same runaway
        // guard fetchAllGuestsForLabels uses.
        for (let page = 1; page <= 50; page++) {
          const qs = new URLSearchParams({ response: 'yes', page: String(page), limit: '100' });
          const res = await fetch(`${API_URL}/events/${eventId}/rsvps?${qs}`, { credentials: 'include' });
          const data = await res.json();
          const parties = data?.data?.rsvps;
          if (!data?.success || !Array.isArray(parties) || parties.length === 0) break;
          parties.forEach((p) => {
            const names = (p.guests || [])
              .map((g) => (g.full_name || '').trim())
              .filter(Boolean);
            if (names.length > 0) map[p.id] = names;
          });
          const total = data?.meta?.pagination?.total || 0;
          if (Object.keys(map).length >= total || parties.length < 100) break;
        }
        if (!cancelled) setMembersByParty(map);
      } catch {
        // Non-fatal by design — the pack still prints, keyed on party labels.
        if (!cancelled) setMembersByParty({});
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showPrintPreview, eventId, membersByParty]);

  /* ── derived: seated guest names per table, for the canvas labels ── */
  const namesByTable = useMemo(() => {
    const m = {};
    allSeatedGuests.forEach(g => {
      const tableId = pending[g.id] ? pending[g.id].to : g.tableId;
      if (!tableId) return;
      (m[tableId] || (m[tableId] = [])).push(g.guest_name);
    });
    return m;
  }, [allSeatedGuests, pending]);

  /* ── derived: the parties at each table, WITH their headcount ──
     namesByTable above is a list of labels, which is all a canvas caption
     needs. The printed pack needs the size too: one row here is one RSVP, and
     an RSVP can cover four people. Counting rows is how the old export printed
     "3" against a table with ten chairs occupied. */
  const partiesByTable = useMemo(() => {
    const m = {};
    allSeatedGuests.forEach(g => {
      const tableId = pending[g.id] ? pending[g.id].to : g.tableId;
      if (!tableId) return;
      (m[tableId] || (m[tableId] = [])).push({
        id: g.id,
        name: g.guest_name,
        size: Number(g.party_size) || 1,
      });
    });
    return m;
  }, [allSeatedGuests, pending]);

  /* ── derived: attending, but with nowhere to sit yet ──
     They get their own sheet in the pack. A guest who is missing from every
     printed page is a guest the door concludes was never invited. */
  const unseatedParties = useMemo(() => allSeatedGuests
    .filter(g => !(pending[g.id] ? pending[g.id].to : g.tableId))
    .map(g => ({ id: g.id, name: g.guest_name, size: Number(g.party_size) || 1 })),
  [allSeatedGuests, pending]);

  /* ── derived: live occupancy per table (server + pending deltas) ── */
  const occByTable = useMemo(() => {
    const m = {};
    elements.forEach(e => { m[e.id] = e.occupied || 0; });
    Object.values(pending).forEach(({ from, to, size }) => {
      if (from && m[from] != null) m[from] -= size;
      if (to && m[to] != null) m[to] += size;
    });
    return m;
  }, [elements, pending]);

  /* ── derived: guest ids with an unsaved seating change staged ── */
  const pendingIds = useMemo(() => new Set(Object.keys(pending)), [pending]);

  /* ── derived: guest list with pending overrides applied + filter ── */
  const effectiveGuests = useMemo(() => {
    return guests
      .map(g => ({ ...g, tableId: pending[g.id] ? pending[g.id].to : g.tableId }))
      .filter(g => {
        if (filter === 'unseated') return !g.tableId;
        if (filter === 'seated') return !!g.tableId;
        return true;
      });
  }, [guests, pending, filter]);

  /* ── sync inspector fields when selection changes ── */
  // Adjusting state during render (like RsvpWizard's prevLangParam) instead of
  // in an effect — this is a "reset editable fields when the selection
  // changes" case, not a subscription to an external system.
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId ?? null);
  if ((selectedId ?? null) !== prevSelectedId) {
    setPrevSelectedId(selectedId ?? null);
    if (selected) {
      setInspectName(selected.table_name || '');
      setInspectCapacity(selected.max_capacity != null ? String(selected.max_capacity) : '');
    } else {
      setInspectName(''); setInspectCapacity('');
    }
  }

  /* ── fetch selected table's seated guests ──
     No longer clears tableGuests synchronously when the selection is invalid
     (null/zone) — seatedHere below now derives [] for that case itself, so
     stale data is never read rather than needing to be proactively cleared. */
  useEffect(() => {
    if (!eventId || !selectedId || !selected || isZone(selected)) return;
    let cancel = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ tableId: selectedId, pageSize: '500' });
        const res = await fetch(`${API_URL}/events/${eventId}/seating/guests?${qs}`, { credentials: 'include' });
        const data = await res.json();
        if (!cancel && data.success) setTableGuests(data.guests);
      } catch { /* non-fatal */ }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, selectedId]);

  const seatedHere = useMemo(() => {
    // A zone (or no selection) never has seated guests — tableGuests may
    // still hold stale data from a previously-selected table since the fetch
    // effect above only clears it by simply not running, not by resetting it.
    if (!selected || isZone(selected)) return [];
    const base = tableGuests.filter(g => !pending[g.id] || pending[g.id].to === selected.id);
    const movedIn = guests.filter(g => pending[g.id]?.to === selected.id && !tableGuests.some(t => t.id === g.id));
    return [...base, ...movedIn];
  }, [tableGuests, guests, pending, selected]);

  /* ── container size (for culling + the pan clamp) ── */
  useEffect(() => {
    const measure = () => {
      if (viewportRef.current) {
        const r = viewportRef.current.getBoundingClientRect();
        containerSizeRef.current = { w: r.width, h: r.height };
        setContainerSize({ w: r.width, h: r.height });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // The gate values matter for the same reason they do on the wheel listener:
    // while this page is loading/errored/locked, viewportRef.current is null and
    // a single run would measure nothing and never retry. `loading` alone was
    // enough before the clamp needed a real size; it is not now.
  }, [loading, error, authChecked, eventIsPaid, hasSeatingFeature]);

  /* ── culling: only render elements intersecting the viewport ── */
  const visibleElements = useMemo(() => {
    const { scale, tx, ty } = view;
    const worldL = -tx / scale, worldT = -ty / scale;
    const worldR = worldL + containerSize.w / scale;
    const worldB = worldT + containerSize.h / scale;
    const margin = 120;
    return elements.filter(el => {
      const b = elBox(el);
      return b.right >= worldL - margin && b.x <= worldR + margin &&
             b.bottom >= worldT - margin && b.y <= worldB + margin;
    });
  }, [elements, view, containerSize]);

  // Shared by both the mouse drag-and-drop drop handler (below) and the
  // touch-friendly tap-to-assign flow (native HTML5 drag-and-drop never fires
  // on touch, so tap-to-assign is the only way a phone/tablet organizer can
  // seat anyone). Declared ahead of onElementPointerDown, which depends on
  // onTapAssign below — both are useCallback deps evaluated at render time,
  // so they must exist before that point, not just before it's *called*.
  const assignGuestToTable = useCallback(async (rsvpId, partySize, from, tableId) => {
    const el = elements.find(x => x.id === tableId);
    if (!el || isZone(el)) { toast.error('Guests can only be seated at tables, not venue zones.'); return; }
    if (from === tableId) return;
    const projected = occByTable[tableId] || 0;
    if (projected + partySize > (el.max_capacity || 0)) {
      const remaining = (el.max_capacity || 0) - projected;
      const ok = await confirm({
        title: `${el.table_name} does not have room for ${partySize}`,
        body: `Only ${remaining} ${remaining === 1 ? 'seat is' : 'seats are'} left there. You can seat them anyway and rearrange the room later.`,
        confirmLabel: 'Seat them anyway',
        cancelLabel: 'Pick another table',
      });
      if (!ok) return;
    }
    setPending(prev => ({ ...prev, [rsvpId]: { from: from || '', to: tableId, size: partySize } }));
    toast.success(`${el.table_name} — seated`);
  }, [elements, occByTable, confirm]);

  /* ════════ tap-to-assign (touch-friendly alternative to drag-and-drop) ════════
     Tap a guest in the list to "arm" them, then tap a table to seat them —
     mirrors the drag gesture's outcome without requiring a drag gesture. */
  const [armedGuest, setArmedGuest] = useState(null);
  const onTapGuest = useCallback((g) => {
    setArmedGuest(prev => (prev && prev.id === g.id) ? null : g);
  }, []);

  // Manually resend the seating-location email — the first assignment emails
  // automatically, but every change after that is deliberately silent (see
  // saveSeatingBatch on the backend), so this is how the organizer notifies a
  // guest after a later move, or if the guest just asks again.
  const handleResendGuest = useCallback(async (guest) => {
    if (resendingId) return;
    setResendingId(guest.id);
    try {
      const res = await fetch(`${API_URL}/events/${eventId}/notifications/send-qr-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rsvpId: guest.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast.success(`Seating location resent to ${guest.guest_name}.`);
      } else {
        toast.error(data.message || 'Could not resend the email.');
      }
    } catch {
      toast.error('Could not resend the email.');
    } finally {
      setResendingId(null);
    }
  }, [eventId, resendingId]);

  const onTapAssign = useCallback((tableId) => {
    if (!armedGuest) return false;
    const from = pending[armedGuest.id] ? pending[armedGuest.id].to : (armedGuest.tableId || '');
    assignGuestToTable(armedGuest.id, armedGuest.party_size, from, tableId);
    setArmedGuest(null);
    return true;
  }, [armedGuest, pending, assignGuestToTable]);

  /* ════════ pointer interaction (pan / move / resize / rotate) ════════ */
  const onElementPointerDown = useCallback((e, id) => {
    if (e.button !== 0) return;

    /**
     * With the Hand tool picked, an element is just part of the floor.
     *
     * Falling through WITHOUT stopPropagation lets the canvas handler below
     * start its pan, which is the whole point of the tool: "drag anywhere to
     * move around" has to include dragging over a table, or the map is still
     * unpannable in exactly the crowded middle where you most need it. It also
     * makes the Hand tool a safe way to explore a finished layout — you
     * cannot nudge a table out of place while looking at it.
     */
    if (toolRef.current === 'hand') return;

    e.stopPropagation();

    // A guest is "armed" from the list (tap-to-assign) — this tap seats them
    // instead of selecting/moving the table. Takes priority over every other
    // click behavior below, same as a drag-and-drop drop would.
    if (onTapAssign(id)) return;

    // Ctrl/Cmd/Shift-click toggles this one element in or out of the
    // multi-selection, so specific elements can be picked instead of only
    // using "Select All". This is a discrete pick, not a drag.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelectedId(null);
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }

    // Dragging an element that's part of an active multi-selection moves the
    // whole group together, preserving everyone's relative position.
    if (selectedIds.size > 1 && selectedIds.has(id)) {
      const origins = {};
      elements.forEach(el => {
        if (selectedIds.has(el.id)) origins[el.id] = { x: Number(el.position_x) || 0, y: Number(el.position_y) || 0 };
      });
      interaction.current = { mode: 'group-move', ids: Array.from(selectedIds), startX: e.clientX, startY: e.clientY, origins };
      return;
    }

    // Clicking an element outside the current multi-selection collapses back
    // to a normal single selection/drag.
    if (selectedIds.size > 0) setSelectedIds(new Set());
    setSelectedId(id);
    const el = elements.find(x => x.id === id);
    if (!el) return;
    interaction.current = { mode: 'move', id, startX: e.clientX, startY: e.clientY, origX: Number(el.position_x) || 0, origY: Number(el.position_y) || 0 };
  }, [elements, selectedIds, onTapAssign]);

  const selectAll = useCallback(() => {
    setSelectedId(null);
    setSelectedIds(new Set(elements.map(e => e.id)));
    setSelectMenuOpen(false);
  }, [elements]);

  // "Select All ▾" narrowed to one shape, or to every table / every zone —
  // the plain Select All above still grabs literally everything.
  const selectByFilter = useCallback((predicate) => {
    setSelectedId(null);
    setSelectedIds(new Set(elements.filter(predicate).map(e => e.id)));
    setSelectMenuOpen(false);
  }, [elements]);

  // "Select All ▾" → Filter & Select — combines a type filter (any / all
  // tables / all zones / one specific shape) with a seat-capacity filter
  // (any / an exact seat count), so e.g. "Round Table" + "8 seats" selects
  // only the 8-seat round tables. Capacity is meaningless for zones (they
  // have no max_capacity), so it's ignored whenever the chosen type resolves
  // to zones only.
  const [filterType, setFilterType] = useState('any');
  const [filterCapacity, setFilterCapacity] = useState('any');

  const matchesTypeCapacity = useCallback((el) => {
    const typeOk = filterType === 'any' ? true
      : filterType === 'table' ? shapeMeta(el.shape).cat === 'table'
      : filterType === 'zone' ? shapeMeta(el.shape).cat === 'zone'
      : (el.shape === 'rectangular' ? 'rectangle' : el.shape) === filterType;
    const capOk = filterCapacity === 'any' || Number(el.max_capacity) === Number(filterCapacity);
    return typeOk && capOk;
  }, [filterType, filterCapacity]);

  // Only seat counts that actually exist among the current tables, so the
  // dropdown never offers a capacity that would always select nothing.
  const capacityOptions = useMemo(() => {
    const set = new Set();
    elements.forEach((el) => { if (shapeMeta(el.shape).cat === 'table' && el.max_capacity) set.add(Number(el.max_capacity)); });
    return Array.from(set).sort((a, b) => a - b);
  }, [elements]);

  // Live preview of how many elements the current type+capacity combo
  // matches, shown right on the Select button before it's clicked.
  const filteredCount = useMemo(() => elements.filter(matchesTypeCapacity).length, [elements, matchesTypeCapacity]);

  const applyTypeCapacityFilter = useCallback(() => {
    selectByFilter(matchesTypeCapacity);
  }, [selectByFilter, matchesTypeCapacity]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Close the "Select All ▾" menu on an outside click/tap.
  useEffect(() => {
    if (!selectMenuOpen) return;
    const onPointerDown = (e) => {
      if (selectMenuRef.current && !selectMenuRef.current.contains(e.target)) setSelectMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [selectMenuOpen]);

  const onResizeStart = useCallback((e, id) => {
    e.stopPropagation();
    const el = elements.find(x => x.id === id);
    if (!el) return;
    interaction.current = { mode: 'resize', id, startX: e.clientX, startY: e.clientY, origW: elWidth(el), origH: elHeight(el) };
  }, [elements]);

  const onRotateStart = useCallback((e, id) => {
    e.stopPropagation();
    const el = elements.find(x => x.id === id);
    if (!el) return;
    interaction.current = { mode: 'rotate', id, origRot: Number(el.rotation) || 0, startX: e.clientX };
  }, [elements]);

  const onCanvasPointerDown = useCallback((e) => {
    // Pointers that landed on a table/zone belong to that element's own
    // handler — EXCEPT under the Hand tool and the right button, the two
    // gestures that mean "move the view" no matter what is underneath them.
    // (onElementPointerDown deliberately does not stopPropagation in those
    // cases, so the event reaches here.)
    if (e.target.closest('[data-el-id]') && toolRef.current !== 'hand' && e.button !== 2) return;
    // Button 2 (right) joins 0 and 1 here purely as a pan gesture — see
    // wantsPan below and the onContextMenu that swallows the menu it would
    // otherwise open. It never selects, never deselects and never marquees.
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;

    /**
     * DRAG SELECTS. Space-drag, middle-drag and touch pan.
     *
     * It was the other way round: plain drag panned and the marquee needed
     * Shift held for the whole gesture, so box-selecting a cluster — the thing
     * an organizer does constantly — was the awkward one, while panning a
     * canvas that also has scroll-wheel zoom and a Reset View button was the
     * easy one. Figma, Canva and every other layout tool make the same choice
     * this now makes.
     *
     * TOUCH IS EXEMPT, deliberately. On a phone or tablet a one-finger drag is
     * how you move around; there is no space bar and no middle button, so
     * turning that into a marquee would leave no way to pan at all.
     */
    const wantsPan = e.button === 1 || e.button === 2 || spaceHeldRef.current
      || toolRef.current === 'hand' || e.pointerType === 'touch';

    if (!wantsPan) {
      const rect = viewportRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      setSelectedId(null);
      // Shift or Cmd/Ctrl adds to the existing selection instead of replacing
      // it, matching how those modifiers already work on a click.
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) setSelectedIds(new Set());
      const rectState = { x0: sx, y0: sy, x1: sx, y1: sy };
      interaction.current = { mode: 'marquee', additive: e.shiftKey || e.ctrlKey || e.metaKey };
      marqueeRef.current = rectState;
      setMarquee(rectState);
      return;
    }

    // Kept for the case where somebody still reaches for Shift-drag out of
    // habit while also holding space — selection wins, as it did before.
    // The two pure-pan buttons are excluded: a Shift held during a middle- or
    // right-drag is almost always left over from a previous gesture, and
    // turning it into a marquee would make those two buttons unreliable.
    if (e.shiftKey && e.button !== 1 && e.button !== 2) {
      const rect = viewportRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      setSelectedId(null);
      // Cmd/Ctrl+Shift-drag adds to the existing selection instead of
      // replacing it, mirroring how Cmd/Ctrl+click already adds one element.
      if (!(e.ctrlKey || e.metaKey)) setSelectedIds(new Set());
      const rectState = { x0: sx, y0: sy, x1: sx, y1: sy };
      interaction.current = { mode: 'marquee', additive: e.ctrlKey || e.metaKey };
      marqueeRef.current = rectState;
      setMarquee(rectState);
      return;
    }

    // background → pan.
    //
    // The two NEW pan gestures (right-drag, and the Hand tool) deliberately do
    // NOT clear the selection: they exist to let you look at another part of
    // the room while keeping hold of what you were working on. The three
    // original ones keep clearing it, exactly as they always did, so nothing
    // an organizer already relies on changes underneath them.
    const keepsSelection = e.button === 2 || (toolRef.current === 'hand' && e.button === 0);
    if (!keepsSelection) {
      setSelectedId(null);
      setSelectedIds(new Set());
    }
    setPanning(true);
    interaction.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty };
  }, [view]);

  /**
   * Space = "pan instead of select", held.
   *
   * A ref rather than state: onCanvasPointerDown reads it at pointerdown, and a
   * state value would be captured in that callback's closure and could be one
   * render stale — which on a pan gesture means selecting a box across the
   * canvas instead of moving it.
   *
   * The keydown also has to swallow the space bar's default page-scroll while
   * the canvas has focus, or holding it scrolls the dashboard behind the map.
   */
  /**
   * NOTHING SAVES ITSELF NOW, so leaving with staged work has to be refused.
   *
   * While rotate and resize auto-saved, closing the tab lost only unsaved
   * MOVES. With every geometry edit staged behind the button, a closed tab
   * loses the whole session's arrangement — which is the cost of the explicit
   * save model and the one thing that makes it unacceptable if unguarded.
   *
   * beforeunload covers the tab close, reload and external navigation. It does
   * NOT cover Next's client-side router (the "Back to Dashboard" link), which
   * is why that link checks `layoutDirty` itself.
   */
  useEffect(() => {
    if (!layoutDirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      // Browsers ignore custom text and show their own wording; returnValue
      // still has to be set for the prompt to appear at all.
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [layoutDirty]);

  const spaceHeldRef = useRef(false);
  useEffect(() => {
    const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e) => {
      if (e.code !== 'Space' || isTyping(e.target)) return;
      spaceHeldRef.current = true;
      setSpacePanHint(true);
      e.preventDefault();
    };
    const up = (e) => {
      if (e.code !== 'Space') return;
      spaceHeldRef.current = false;
      setSpacePanHint(false);
    };
    // Releasing space while the tab is not focused would otherwise leave it
    // stuck on, and every later drag would pan.
    const blur = () => { spaceHeldRef.current = false; setSpacePanHint(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /**
   * ── STAGE a geometry change. Nothing on this canvas saves itself. ──
   *
   * The map used to have two save models at once: moving a table staged the
   * change and lit up "Save Layout", while rotating or resizing PATCHed the
   * server the moment you let go. So an organizer nudging a layout had some
   * edits already committed and some not, with no way to tell them apart, no
   * undo for half of them, and a Save button that did not cover what it
   * appeared to cover.
   *
   * Every geometry edit now lands here and waits for the button.
   *
   * `dirtyGeometryRef` stays a ref because loadLayout() reads it during a
   * refetch to re-apply local edits over server data, and it must see the
   * current value rather than one captured in a closure. The counter beside it
   * is what makes the Save button re-render — a ref alone changes nothing on
   * screen, which is precisely how a "you have unsaved work" indicator would
   * end up lying.
   */
  const markGeometryDirty = useCallback((id, patch) => {
    dirtyGeometryRef.current = {
      ...dirtyGeometryRef.current,
      [id]: { ...(dirtyGeometryRef.current[id] || {}), ...patch },
    };
    setGeoDirtyCount(Object.keys(dirtyGeometryRef.current).length);
  }, []);

  /* ── write one element's geometry to the server (called only by saveLayout) ── */
  const persistGeometry = useCallback(async (id, body) => {
    try {
      await fetch(`${API_URL}/events/${eventId}/tables/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
    } catch { /* non-fatal; layout save will reconcile */ }
  }, [eventId]);

  /* ── one-click 90° rotate — lets a rectangle/oval/banquet/head table flip
     between a lengthwise and widthwise layout, or a non-square zone (stage,
     bar, DJ booth, entrance, custom area) flip orientation, without needing
     free-drag precision. Square-ish elements hide the button entirely (see
     the elWidth/elHeight guard at the call site) since a 90° turn on those
     looks identical. ── */
  /**
   * Rotate the WHOLE selection, and stage it.
   *
   * Two bugs in one line before: it read `selectedId` (the single-select slot)
   * so a group of twelve tables rotated exactly one of them, and it PATCHed
   * immediately so the change was already saved before anyone could undo it.
   *
   * Each element turns 90° about its own centre rather than the group's — for a
   * seating chart that is what "turn these tables" means; orbiting a cluster
   * around a shared origin would move tables the organizer had already placed.
   */
  const rotateSelected = useCallback(() => {
    const ids = selectedIds.size > 0 ? [...selectedIds] : (selectedId ? [selectedId] : []);
    if (ids.length === 0) return;

    const targets = elements.filter(x => ids.includes(x.id));
    if (targets.length === 0) return;

    const nextById = new Map(targets.map(el => [el.id, ((Number(el.rotation) || 0) + 90) % 360]));
    setElements(prev => prev.map(x => (nextById.has(x.id) ? { ...x, rotation: nextById.get(x.id) } : x)));
    for (const [id, rotation] of nextById) markGeometryDirty(id, { rotation });
  }, [selectedId, selectedIds, elements, markGeometryDirty]);

  /* ── shared move/group-move math — used by real pointermove events AND by
     the edge auto-pan loop below, which synthesizes the same update using the
     last-known pointer position after panning the view out from under it. ── */
  const applyMoveAt = useCallback((clientX, clientY) => {
    const it = interaction.current;
    if (!it) return;
    if (it.mode === 'move') {
      const dx = (clientX - it.startX) / view.scale / WORLD_W * 100;
      const dy = (clientY - it.startY) / view.scale / WORLD_H * 100;
      let finalX = it.origX + dx;
      let finalY = it.origY + dy;

      if (snapToGrid) {
        const stepX = (32 / WORLD_W) * 100;
        const stepY = (32 / WORLD_H) * 100;
        finalX = Math.round(finalX / stepX) * stepX;
        finalY = Math.round(finalY / stepY) * stepY;
      }

      // Full range, no inner margin — an element can be dragged flush to
      // any edge or corner of the venue canvas instead of stopping a few
      // percent short of it.
      const newPos = { id: it.id, x: clamp(finalX, 0, 100), y: clamp(finalY, 0, 100) };
      dragPosRef.current = newPos;
      setDragPos(newPos);
    } else if (it.mode === 'group-move') {
      // Snap the overall delta (not each element individually) so the group
      // keeps its relative layout instead of drifting apart.
      let dx = (clientX - it.startX) / view.scale / WORLD_W * 100;
      let dy = (clientY - it.startY) / view.scale / WORLD_H * 100;
      if (snapToGrid) {
        const stepX = (32 / WORLD_W) * 100;
        const stepY = (32 / WORLD_H) * 100;
        dx = Math.round(dx / stepX) * stepX;
        dy = Math.round(dy / stepY) * stepY;
      }
      const next = new Map();
      it.ids.forEach(id => {
        const o = it.origins[id];
        if (!o) return;
        next.set(id, { x: clamp(o.x + dx, 0, 100), y: clamp(o.y + dy, 0, 100) });
      });
      groupDragPosRef.current = next;
      setGroupDragPos(next);
    }
  }, [view.scale, snapToGrid]);

  /* ── edge auto-pan while dragging — without this, moving an element (or a
     group) beyond whatever sliver of the 2600×1700 world the current zoom/pan
     happens to show is impossible in a single gesture: physical mouse travel
     is capped by the monitor, so at any real zoom level large parts of the
     canvas were simply unreachable mid-drag. Holding a dragged element near
     the viewport edge now pans the canvas underneath it (like Figma/Miro),
     revealing the rest of the map without needing to drop, pan, and re-grab
     repeatedly. Mutating interaction.current.startX/Y by the same amount the
     view just panned keeps applyMoveAt's delta math correct — from its
     perspective this is indistinguishable from the mouse having moved. ── */
  useEffect(() => {
    const EDGE = 56;       // px from the viewport edge that triggers panning
    const MAX_SPEED = 16;  // px/frame at the very edge
    let raf;
    const tick = () => {
      const it = interaction.current;
      const vp = viewportRef.current;
      if (it && (it.mode === 'move' || it.mode === 'group-move') && vp) {
        const rect = vp.getBoundingClientRect();
        const px = lastPointerRef.current.x - rect.left;
        const py = lastPointerRef.current.y - rect.top;
        const speed = (dist) => dist >= EDGE ? 0 : ((EDGE - dist) / EDGE) * MAX_SPEED;
        let stepX = 0, stepY = 0;
        if (px < EDGE) stepX = speed(px);
        else if (px > rect.width - EDGE) stepX = -speed(rect.width - px);
        if (py < EDGE) stepY = speed(py);
        else if (py > rect.height - EDGE) stepY = -speed(rect.height - py);
        if (stepX !== 0 || stepY !== 0) {
          /**
           * startX/Y are corrected by the distance the view ACTUALLY moved, not
           * by the distance we asked it to move.
           *
           * Panning tx/ty by +step shifts the world under a stationary cursor by
           * -step/scale in world space; startX/Y must move the OPPOSITE way
           * (+step) so applyMoveAt's (clientX - startX) delta shrinks to match —
           * i.e. the dragged item stays glued to the cursor instead of drifting
           * away as the canvas scrolls underneath it.
           *
           * That correction was exact while pan was unbounded. It is not once
           * clampView can refuse the move: at the world's edge the view would
           * stop while startX kept accumulating, so every frame the pointer sat
           * in the edge zone would shove the dragged element further from the
           * cursor — at 16px/frame, right off the map.
           *
           * Read-then-write against viewRef rather than a functional setView
           * updater: the correction is a side effect, and React invokes updaters
           * twice under StrictMode to catch exactly that, which would double
           * every correction in development. viewRef is assigned synchronously
           * here so the next frame (16ms away, likely before React has committed
           * and re-run the mirroring effect) reads the value this one produced.
           */
          const cur = viewRef.current;
          const next = clampView({ ...cur, tx: cur.tx + stepX, ty: cur.ty + stepY }, rect.width, rect.height);
          const dxApplied = next.tx - cur.tx;
          const dyApplied = next.ty - cur.ty;
          // Parked against the world edge: nothing moved, so don't re-render or
          // nudge the drag origin 60 times a second for no reason.
          if (dxApplied !== 0 || dyApplied !== 0) {
            viewRef.current = next;
            setView(next);
            it.startX += dxApplied;
            it.startY += dyApplied;
            applyMoveAt(lastPointerRef.current.x, lastPointerRef.current.y);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [applyMoveAt]);

  useEffect(() => {
    const onMove = (e) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const it = interaction.current;
      if (!it) return;
      if (it.mode === 'pan') {
        const cs = containerSizeRef.current;
        setView(v => clampView({ ...v, tx: it.tx + (e.clientX - it.startX), ty: it.ty + (e.clientY - it.startY) }, cs.w, cs.h));
      } else if (it.mode === 'move' || it.mode === 'group-move') {
        applyMoveAt(e.clientX, e.clientY);
      } else if (it.mode === 'resize') {
        const dw = (e.clientX - it.startX) / view.scale;
        const dh = (e.clientY - it.startY) / view.scale;
        let newW = it.origW + dw;
        let newH = it.origH + dh;
        if (snapToGrid) {
          newW = Math.round(newW / 32) * 32;
          newH = Math.round(newH / 32) * 32;
        }
        it.newW = clamp(newW, 60, 900);
        it.newH = clamp(newH, 50, 900);
        setElements(prev => prev.map(el => el.id === it.id ? { ...el, width: it.newW, height: it.newH } : el));
      } else if (it.mode === 'rotate') {
        it.newRot = Math.round(it.origRot + (e.clientX - it.startX) * 0.5);
        setElements(prev => prev.map(el => el.id === it.id ? { ...el, rotation: it.newRot } : el));
      } else if (it.mode === 'marquee') {
        const rect = viewportRef.current.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const next = { x0: marqueeRef.current.x0, y0: marqueeRef.current.y0, x1: sx, y1: sy };
        marqueeRef.current = next;
        setMarquee(next);
      }
    };
    const onUp = async () => {
      const it = interaction.current;
      interaction.current = null;
      setPanning(false);
      if (!it) return;
      // Read latest dragPos from ref (not stale closure value)
      const currentDragPos = dragPosRef.current;
      if (it.mode === 'move' && currentDragPos && currentDragPos.id === it.id) {
        setElements(prev => {
          const updated = prev.map(el => el.id === it.id ? { ...el, position_x: currentDragPos.x, position_y: currentDragPos.y } : el);
          const snap = updated.map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
          setHistory(h => {
            const nextHistory = h.slice(0, historyIndexRef.current + 1);
            historyIndexRef.current = nextHistory.length;
            setHistoryIndex(nextHistory.length);
            return [...nextHistory, snap];
          });
          return updated;
        });
        dragPosRef.current = null;
        setDragPos(null);
        setMovedIds(prev => new Set(prev).add(it.id));
      } else if (it.mode === 'group-move') {
        const finalPositions = groupDragPosRef.current;
        if (finalPositions && finalPositions.size > 0) {
          setElements(prev => {
            const updated = prev.map(el => finalPositions.has(el.id)
              ? { ...el, position_x: finalPositions.get(el.id).x, position_y: finalPositions.get(el.id).y }
              : el);
            const snap = updated.map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
            setHistory(h => {
              const nextHistory = h.slice(0, historyIndexRef.current + 1);
              historyIndexRef.current = nextHistory.length;
              setHistoryIndex(nextHistory.length);
              return [...nextHistory, snap];
            });
            return updated;
          });
          setMovedIds(prev => {
            const next = new Set(prev);
            finalPositions.forEach((_, id) => next.add(id));
            return next;
          });
        }
        groupDragPosRef.current = null;
        setGroupDragPos(null);
      } else if (it.mode === 'resize' && it.newW != null) {
        // STAGED, not saved. See markGeometryDirty — resize and rotate used to
        // PATCH the server the instant the pointer came up, while a move sat
        // waiting for "Save Layout". One canvas, two rules, nothing on screen
        // saying which was which.
        markGeometryDirty(it.id, { width: Math.round(it.newW), height: Math.round(it.newH) });
      } else if (it.mode === 'rotate' && it.newRot != null) {
        markGeometryDirty(it.id, { rotation: it.newRot });
      } else if (it.mode === 'marquee') {
        const rect = marqueeRef.current;
        marqueeRef.current = null;
        setMarquee(null);
        if (!rect) return;
        const left = Math.min(rect.x0, rect.x1), right = Math.max(rect.x0, rect.x1);
        const top = Math.min(rect.y0, rect.y1), bottom = Math.max(rect.y0, rect.y1);
        // A tap with no real drag (e.g. an accidental Shift+click on empty
        // canvas) shouldn't clear an existing selection someone was building.
        if (right - left < 4 && bottom - top < 4) return;
        const { scale, tx, ty } = viewRef.current;
        const hits = elementsRef.current.filter((el) => {
          // elBox is the world-space AABB; convert it to the same
          // viewport-relative screen px the marquee rectangle was drawn in.
          // This used to re-derive the box as x±w/2 — treating a top-left
          // position as a centre — so the rubber band selected the elements
          // NEXT to whatever it was actually drawn over.
          const b = elBox(el);
          const elLeft = b.x * scale + tx;
          const elRight = b.right * scale + tx;
          const elTop = b.y * scale + ty;
          const elBottom = b.bottom * scale + ty;
          return elLeft < right && elRight > left && elTop < bottom && elBottom > top;
        }).map((el) => el.id);
        if (hits.length === 0) return;
        setSelectedIds((prev) => (it.additive ? new Set([...prev, ...hits]) : new Set(hits)));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    // view.scale is needed for coordinate conversion; dragPos intentionally read from ref.
    // markGeometryDirty replaced persistGeometry here when resize/rotate stopped
    // saving themselves — it is a stable useCallback([]), so listing it does not
    // re-subscribe these listeners on every render.
  }, [view.scale, markGeometryDirty, snapToGrid]);

  /**
   * ── THE WHEEL SCROLLS THE MAP. Ctrl/Cmd + wheel zooms it. ──
   *
   * It used to zoom unconditionally, and that was the second half of "مفيش
   * حرية في التنقل": the canvas has no scrollbars, so with the wheel spent on
   * zoom there was no scroll gesture left at all. Wanting to see the tables
   * below the ones on screen meant zooming out, losing all your detail, and
   * zooming back in somewhere else.
   *
   * Plain wheel now pans vertically, Shift+wheel horizontally, and a trackpad's
   * two-finger scroll pans in both axes at once (it reports a real deltaX,
   * which the old handler threw away entirely). This is the same split Figma,
   * Miro and Google Maps use, so Ctrl/Cmd+wheel remains the zoom for anyone
   * with the muscle memory — and the toolbar's −/+/Fit buttons are untouched.
   *
   * deltaMode is honoured because a mouse wheel on Firefox reports LINE units
   * (deltaY ≈ 3) rather than pixels; multiplying by a line height keeps one
   * notch of a real wheel feeling like a scroll instead of a twitch.
   */
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = viewportRef.current.getBoundingClientRect();

    if (e.ctrlKey || e.metaKey) {
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      setView(v => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
        const k = scale / v.scale;
        return clampView({ scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }, rect.width, rect.height);
      });
      return;
    }

    // DOM_DELTA_LINE = 1, DOM_DELTA_PAGE = 2; anything else is already pixels.
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? rect.height : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    // Shift+wheel is the conventional "scroll sideways" on a device with only
    // one wheel axis. A trackpad already sends deltaX, so this only reassigns
    // when there is no horizontal component to lose.
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
    // The view translates the world, so scrolling DOWN moves the world UP.
    setView(v => clampView({ ...v, tx: v.tx - dx, ty: v.ty - dy }, rect.width, rect.height));
  }, []);

  /**
   * Bound by hand, NOT via JSX `onWheel`, and that is the whole reason wheel
   * panning works at all.
   *
   * React registers `wheel` on its root container as a PASSIVE listener, so
   * `preventDefault()` inside a synthetic onWheel handler is silently ignored
   * (Chrome logs "Unable to preventDefault inside passive event listener").
   * The dashboard page behind the canvas would therefore scroll on every
   * notch while the map panned underneath it — the two moving at once. An
   * explicit `{ passive: false }` listener is the same escape hatch
   * SeatingMapFullscreen already uses for its own zoom.
   */
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
    // The gate values are dependencies because the canvas is BEHIND them: while
    // this page is loading, errored, unauthenticated or payment-locked it
    // returns early and viewportRef.current is null. With `[onWheel]` alone
    // (a stable useCallback) this would run exactly once, on the loading
    // render, find nothing to bind to, and never run again.
  }, [onWheel, loading, error, authChecked, eventIsPaid, hasSeatingFeature]);

  const zoomBy = (factor) => setView(v => {
    const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
    const cx = containerSize.w / 2, cy = containerSize.h / 2, k = scale / v.scale;
    return clampView({ scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }, containerSize.w, containerSize.h);
  });
  // Deliberately NOT clamped: this IS the recovery action. Fit computes a
  // known-good view from scratch, so running it through the clamp could only
  // ever move it away from the one position guaranteed to show the layout.
  const resetView = () => setView({ scale: clamp(containerSize.w / WORLD_W, MIN_SCALE, MAX_SCALE), tx: 40, ty: 30 });

  /* ════════ guest drag & drop ════════ */
  const onDragStartGuest = (e, g) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ rsvpId: g.id, partySize: g.party_size, from: pending[g.id] ? pending[g.id].to : (g.tableId || '') }));
  };
  const onDragOverEl = (e, id) => { e.preventDefault(); if (dragOverId !== id) setDragOverId(id); };
  const onDragLeaveEl = () => setDragOverId(null);

  const onDropGuest = (e, tableId) => {
    e.preventDefault();
    setDragOverId(null);
    let payload;
    try { payload = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
    const { rsvpId, partySize, from } = payload;
    assignGuestToTable(rsvpId, partySize, from, tableId);
  };

  const unseatGuest = (g) => {
    const from = pending[g.id] ? pending[g.id].from : (g.tableId || (selected ? selected.id : ''));
    setPending(prev => ({ ...prev, [g.id]: { from: from || (selected ? selected.id : ''), to: '', size: g.party_size } }));
  };

  /* ── save pending seating (auto-saves dirty layout first) ── */
  const saveSeating = async (force = false) => {
    const entries = Object.entries(pending);
    if (entries.length === 0) return;
    setSaving(true);
    try {
      // Persist any unsaved layout positions first so loadLayout() won't lose them
      if (movedIds.size > 0) {
        const moved = elements.filter(el => movedIds.has(el.id)).map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
        const CHUNK = 500;
        for (let i = 0; i < moved.length; i += CHUNK) {
          const slice = moved.slice(i, i + CHUNK);
          await fetch(`${API_URL}/events/${eventId}/tables/positions`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ tablePositions: slice }),
          });
        }
        setMovedIds(new Set());
      }
      const assignments = entries.map(([rsvpId, info]) => ({ rsvpId, tableId: info.to || null }));
      const res = await fetch(`${API_URL}/events/${eventId}/seating/save-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ assignments, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        const capacityIssue = !force && data.error === 'BATCH_SAVE_FAILED' && /remaining seats|CAPACITY_EXCEEDED/i.test(data.message || '');
        if (capacityIssue && await confirm({
          title: 'Some tables are over capacity',
          body: data.message,
          confirmLabel: 'Save anyway',
          cancelLabel: 'Let me fix it',
        })) { setSaving(false); return saveSeating(true); }
        throw new Error(data.message || 'Failed to save seating.');
      }
      setPending({});
      // Clear dirty geometry since we just persisted layout
      dirtyGeometryRef.current = {};
      setGeoDirtyCount(0);
      await Promise.all([loadLayout(), fetchGuests(1, true)]);
      setTableGuests([]);
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  /* ── save layout (only the moved/resized/rotated elements, chunked for scale) ── */
  const saveLayout = async () => {
    setSaving(true);
    try {
      // 1. Save position changes
      const moved = elements.filter(el => movedIds.has(el.id)).map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
      const CHUNK = 500;
      for (let i = 0; i < moved.length; i += CHUNK) {
        const slice = moved.slice(i, i + CHUNK);
        const res = await fetch(`${API_URL}/events/${eventId}/tables/positions`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ tablePositions: slice }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Failed to save layout.'); }
      }
      // 2. Save any dirty resize/rotate geometry that hasn't been persisted yet
      const geo = dirtyGeometryRef.current;
      for (const [id, body] of Object.entries(geo)) {
        await persistGeometry(id, body);
      }
      setMovedIds(new Set());
      dirtyGeometryRef.current = {};
      setGeoDirtyCount(0);

      // Reset history baseline to the saved state
      initialLayoutRef.current = elements;
      const snap = elements.map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
      setHistory([snap]);
      updateHistoryIndex(0);
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  /* ── add element ── */
  const addElement = async (payloads) => {
    // Same in-flight guard as duplicateElement — without it, a double-click on
    // "Add to Canvas" while a 50-element batch is still POSTing fires a second
    // overlapping batch, multiplying the duplication.
    if (saving) return;
    const items = Array.isArray(payloads) ? payloads : [payloads];
    setSaving(true);
    try {
      for (const item of items) {
        // shapeMeta, not SHAPES[...] — a raw lookup returns undefined for the
        // legacy 'rectangular' alias and the next line throws on meta.cat.
        const meta = shapeMeta(item.shape);
        const body = {
          tableName: item.tableName || item.name,
          shape: item.shape,
          elementType: item.elementType || meta.cat,
          x: item.x !== undefined ? item.x : clamp((-view.tx / view.scale) / WORLD_W * 100 + 8, 0, 100),
          y: item.y !== undefined ? item.y : clamp((-view.ty / view.scale) / WORLD_H * 100 + 8, 0, 100),
        };
        if (body.elementType === 'table') body.maxCapacity = item.maxCapacity || item.capacity;
        else { body.width = item.width || meta.w; body.height = item.height || meta.h; body.color = item.color || meta.color; }

        const res = await fetch(`${API_URL}/events/${eventId}/tables`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to add element');
      }
      setShowAdd(false);
      loadLayout();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  /* ── inspector save / delete ── */
  const saveInspector = async () => {
    if (!selected) return;
    if (!inspectName.trim()) { toast.error(isZone(selected) ? 'Please enter a label.' : 'Please enter a table number.'); return; }
    // Same rule as AddElementModal: a venue zone is identified by name, never
    // a bare number — only tables get numbers.
    if (isZone(selected) && /^\d+$/.test(inspectName.trim())) { toast.error('Venue zones need a name, not just a number — try something like "Stage" or "Bar 2".'); return; }
    const body = { tableName: inspectName };
    if (!isZone(selected)) {
      const cap = parseInt(inspectCapacity);
      if (isNaN(cap) || cap < 1) { toast.error('Capacity must be a positive number.'); return; }
      body.maxCapacity = cap;
    }
    try {
      const res = await fetch(`${API_URL}/events/${eventId}/tables/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update');
      loadLayout();
    } catch (err) { toast.error(err.message); }
  };

  /**
   * Delete the WHOLE selection.
   *
   * It read `selected` — the single-select slot — so selecting twelve tables
   * and pressing Delete removed one, and clearing a section meant twelve
   * confirmations. The group case is now the general case; a single selection
   * is just a group of one and keeps its original wording.
   *
   * Occupied tables are FILTERED OUT rather than blocking the whole delete. On
   * one table "unassign the guests first" is the right answer; on a selection of
   * twenty it would refuse the entire operation because of one seated table and
   * make the organizer hunt for it. The dialog says how many are being kept back
   * and why, so nothing disappears — or survives — silently.
   *
   * This is NOT staged behind Save. Adding and deleting create and destroy
   * records rather than editing geometry, they are already explicit actions
   * behind their own button and confirmation, and a staged deletion would mean
   * holding a tombstone list that "Save" has to replay. Geometry is what the
   * Save button governs.
   */
  const deleteElement = useCallback(async () => {
    const ids = selectedIds.size > 0 ? [...selectedIds] : (selected ? [selected.id] : []);
    if (ids.length === 0) return;

    const targets = elements.filter(el => ids.includes(el.id));
    if (targets.length === 0) return;

    const occupied = targets.filter(el => !isZone(el) && (occByTable[el.id] || 0) > 0);
    const removable = targets.filter(el => !occupied.includes(el));

    if (removable.length === 0) {
      toast.error(targets.length === 1
        ? 'Unassign guests before deleting this table.'
        : 'Every table you selected has guests seated at it. Unassign them first.');
      return;
    }

    const single = removable.length === 1 && targets.length === 1;
    const keptBack = occupied.length > 0
      ? ` ${occupied.length} of them ${occupied.length === 1 ? 'has guests seated and will be kept' : 'have guests seated and will be kept'}.`
      : '';

    if (!(await confirm({
      title: single
        ? `Delete ${removable[0].table_name}?`
        : `Delete ${removable.length} elements?`,
      body: single
        ? 'It is removed from the floor plan. Nobody is seated there, so no guest loses a seat.'
        : `They are removed from the floor plan. Nobody is seated at them, so no guest loses a seat.${keptBack}`,
      confirmLabel: single ? 'Delete it' : `Delete ${removable.length}`,
      cancelLabel: single ? 'Keep it' : 'Keep them',
      tone: 'danger',
    }))) return;

    try {
      // Sequential, not Promise.all: a 50-element delete fired at once is 50
      // simultaneous connections, and a partial failure mid-flight would leave
      // no way to say which ones went.
      let removed = 0;
      for (const el of removable) {
        const res = await fetch(`${API_URL}/events/${eventId}/tables/${el.id}`, { method: 'DELETE', credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `Failed to delete ${el.table_name}.`);
        removed += 1;
      }
      if (!single) toast.success(`Deleted ${removed} ${removed === 1 ? 'element' : 'elements'}.`);
      setSelectedId(null);
      setSelectedIds(new Set());
      loadLayout();
    } catch (err) {
      toast.error(err.message);
      // Reload regardless: some may already be gone, and leaving the canvas
      // showing elements the server no longer has is worse than the error.
      loadLayout();
    }
  }, [selected, selectedIds, elements, occByTable, eventId, loadLayout, confirm]);

  const duplicateElement = useCallback(async () => {
    // Guard against runaway duplication: the "Duplicate" button and its Ctrl/Cmd+D
    // shortcut had no in-flight check, so OS key-repeat while the key was held (or a
    // fast double-click) fired one POST per keydown event — with no uniqueness
    // constraint on table_name, every one of those succeeded, creating dozens of
    // identically-named tables from a single held keypress.
    if (!selected || saving) return;
    const meta = shapeMeta(selected.shape);
    // Every duplicate — table or zone — gets the next free NUMBER in sequence
    // with everything already on the map, instead of a repeated "(Copy)"
    // suffix: a table numbers off getNextTableNumber (same as a fresh table),
    // and a zone reuses its own base label (stripping any trailing number
    // first, so duplicating "Bar" *or* "Bar 2" both count against the same
    // "Bar" family) and finds the next free "Bar N".
    const zoneBaseLabel = selected.table_name?.match(/^(.*?)\s*\d+$/)?.[1]?.trim() || selected.table_name || meta.label;
    const body = {
      tableName: meta.cat === 'table' ? String(getNextTableNumber(elements)) : getUniqueZoneName(elements, zoneBaseLabel),
      shape: selected.shape,
      elementType: selected.element_type || meta.cat,
      x: clamp((Number(selected.position_x) || 0) + 3, 0, 100),
      y: clamp((Number(selected.position_y) || 0) + 3, 0, 100),
      rotation: Number(selected.rotation) || 0,
    };
    if (meta.cat === 'table' || selected.max_capacity) body.maxCapacity = selected.max_capacity || meta.defaultCap || 10;
    if (isZone(selected)) {
      body.width = elWidth(selected);
      body.height = elHeight(selected);
      body.color = selected.color || meta.color;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/events/${eventId}/tables`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to duplicate element');
      // Awaited (not fire-and-forget) so `elements` reflects this new element
      // before the button re-enables — otherwise a fast second click could
      // compute the same "next number" again off the stale list and collide.
      await loadLayout();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }, [selected, saving, elements, eventId, loadLayout]);

  // Undo/Redo movement handlers
  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    const newIdx = historyIndexRef.current - 1;
    updateHistoryIndex(newIdx);
    
    setHistory(h => {
      const snap = h[newIdx];
      if (snap) {
        setElements(prev => prev.map(el => {
          const match = snap.find(s => s.id === el.id);
          if (match) return { ...el, position_x: match.x, position_y: match.y };
          return el;
        }));
        
        // Recalculate movedIds
        const dirty = new Set();
        snap.forEach(item => {
          const orig = initialLayoutRef.current.find(o => o.id === item.id);
          if (orig && (Number(orig.position_x) !== Number(item.x) || Number(orig.position_y) !== Number(item.y))) {
            dirty.add(item.id);
          }
        });
        setMovedIds(dirty);
      }
      return h;
    });
  }, []);

  const redo = useCallback(() => {
    setHistory(h => {
      if (historyIndexRef.current >= h.length - 1) return h;
      const newIdx = historyIndexRef.current + 1;
      updateHistoryIndex(newIdx);
      const snap = h[newIdx];
      if (snap) {
        setElements(prev => prev.map(el => {
          const match = snap.find(s => s.id === el.id);
          if (match) return { ...el, position_x: match.x, position_y: match.y };
          return el;
        }));
        
        // Recalculate movedIds
        const dirty = new Set();
        snap.forEach(item => {
          const orig = initialLayoutRef.current.find(o => o.id === item.id);
          if (orig && (Number(orig.position_x) !== Number(item.x) || Number(orig.position_y) !== Number(item.y))) {
            dirty.add(item.id);
          }
        });
        setMovedIds(dirty);
      }
      return h;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Widened from INPUT/TEXTAREA to also cover SELECT and contenteditable:
      // this handler now claims two bare letter keys (V and H), so anywhere a
      // letter could legitimately be typed has to be excluded or the inspector's
      // name field would start switching tools mid-word.
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) {
        return;
      }

      if (e.key === 'Escape' && selectedIds.size > 0) {
        e.preventDefault();
        setSelectedIds(new Set());
        return;
      }

      /**
       * V / H — the two tool shortcuts, matching every layout editor.
       * Guarded on the modifier keys so they can never fire during Ctrl+V.
       *
       * `typeof e.key === 'string'` because this branch, unlike the Ctrl-key
       * ones below it, runs on EVERY keydown. A synthetic or IME-composed event
       * with no `key` would throw here and take the whole handler with it —
       * meaning Delete, Ctrl+Z and the arrow keys would all stop working for the
       * rest of the session, from a single malformed event.
       */
      if (typeof e.key === 'string' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'v') { e.preventDefault(); setToolBoth('select'); return; }
        if (k === 'h') { e.preventDefault(); setToolBoth('hand'); return; }
      }

      /**
       * ── ARROWS PAN THE VIEW WHEN NOTHING IS SELECTED. ──
       *
       * With a selection they nudge the element, which is what they have
       * always done and is untouched below. With nothing selected they used to
       * do nothing at all — an early `if (!selected) return` swallowed them —
       * which is why the map felt like it had no keyboard navigation.
       *
       * Nudging is 1px (10 with Shift) because it is a precision act on one
       * element; panning is a whole screen-ful of travel, so it uses a much
       * larger screen-space step. Screen space, not world space, deliberately:
       * a fixed world step would crawl when zoomed out and fly when zoomed in.
       */
      const ARROW_PAN = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [1, 0], ArrowRight: [-1, 0] };
      if (!selected && selectedIds.size === 0 && ARROW_PAN[e.key]) {
        e.preventDefault();
        const [ux, uy] = ARROW_PAN[e.key];
        const step = e.shiftKey ? 240 : 60;
        const cs = containerSizeRef.current;
        setView(v => clampView({ ...v, tx: v.tx + ux * step, ty: v.ty + uy * step }, cs.w, cs.h));
        return;
      }

      if (!selected) return;

      const step = e.shiftKey ? 10 : 1; // 10px shift-nudging, 1px default

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const currentY = pctToPx(selected.position_y, WORLD_H);
        let targetY = currentY - step;
        if (snapToGrid) targetY = Math.round(targetY / 32) * 32;
        const newYPct = clamp((targetY / WORLD_H) * 100, 0, 100);
        
        setElements(prev => {
          const updated = prev.map(el => el.id === selected.id ? { ...el, position_y: newYPct } : el);
          const snap = updated.map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
          setHistory(h => {
            const nextHistory = h.slice(0, historyIndexRef.current + 1);
            updateHistoryIndex(nextHistory.length);
            return [...nextHistory, snap];
          });
          return updated;
        });
        setMovedIds(prev => new Set(prev).add(selected.id));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const currentY = pctToPx(selected.position_y, WORLD_H);
        let targetY = currentY + step;
        if (snapToGrid) targetY = Math.round(targetY / 32) * 32;
        const newYPct = clamp((targetY / WORLD_H) * 100, 0, 100);
        
        setElements(prev => {
          const updated = prev.map(el => el.id === selected.id ? { ...el, position_y: newYPct } : el);
          const snap = updated.map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
          setHistory(h => {
            const nextHistory = h.slice(0, historyIndexRef.current + 1);
            updateHistoryIndex(nextHistory.length);
            return [...nextHistory, snap];
          });
          return updated;
        });
        setMovedIds(prev => new Set(prev).add(selected.id));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const currentX = pctToPx(selected.position_x, WORLD_W);
        let targetX = currentX - step;
        if (snapToGrid) targetX = Math.round(targetX / 32) * 32;
        const newXPct = clamp((targetX / WORLD_W) * 100, 0, 100);
        
        setElements(prev => {
          const updated = prev.map(el => el.id === selected.id ? { ...el, position_x: newXPct } : el);
          const snap = updated.map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
          setHistory(h => {
            const nextHistory = h.slice(0, historyIndexRef.current + 1);
            updateHistoryIndex(nextHistory.length);
            return [...nextHistory, snap];
          });
          return updated;
        });
        setMovedIds(prev => new Set(prev).add(selected.id));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const currentX = pctToPx(selected.position_x, WORLD_W);
        let targetX = currentX + step;
        if (snapToGrid) targetX = Math.round(targetX / 32) * 32;
        const newXPct = clamp((targetX / WORLD_W) * 100, 0, 100);
        
        setElements(prev => {
          const updated = prev.map(el => el.id === selected.id ? { ...el, position_x: newXPct } : el);
          const snap = updated.map(el => ({ id: el.id, x: el.position_x, y: el.position_y }));
          setHistory(h => {
            const nextHistory = h.slice(0, historyIndexRef.current + 1);
            updateHistoryIndex(nextHistory.length);
            return [...nextHistory, snap];
          });
          return updated;
        });
        setMovedIds(prev => new Set(prev).add(selected.id));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteElement();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateElement();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, selectedIds, snapToGrid, deleteElement, duplicateElement, undo, redo, setToolBoth]);

  const btn = { padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.2s' };
  const pendingCount = Object.keys(pending).length;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.ivory, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, border: `3px solid ${C.border}`, borderTop: `3px solid ${C.gold}`, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: C.stone, fontFamily: 'var(--font-sans)', fontSize: 14 }}>Drawing seating layout…</p>
        </div>
        <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: C.ivory, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 440, textAlign: 'center', background: C.white, border: `1px solid ${C.border}`, padding: '48px 32px', borderRadius: 16 }}>
          <Icon name="plug" size={44} color={C.danger} strokeWidth={1.3} />
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, color: C.danger, marginTop: 12 }}>Backend Connection Error</h2>
          <p style={{ color: C.stone, marginTop: 12, fontSize: 13 }}>{error}</p>
          <button onClick={() => { setLoading(true); loadLayout(); }} style={{ ...btn, marginTop: 24, background: C.gold, color: C.white }}>Retry</button>
        </div>
      </div>
    );
  }

  /* ── Payment gate: locked state for unpaid events / a tier without seating_map ── */
  if (!authChecked) return null;
  if (eventIsPaid === false || hasSeatingFeature === false) {
    return (
      <div style={{ minHeight: '100vh', background: C.ivory, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)' }}>
        <div style={{
          maxWidth: 480, width: '100%', textAlign: 'center', background: C.white,
          border: `1px solid ${C.border}`, padding: '64px 32px', borderRadius: '20px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.06)', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 0.05, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: '15%', left: '10%', width: 70, height: 70, borderRadius: '50%', border: `2px solid ${C.gold}` }} />
            <div style={{ position: 'absolute', top: '50%', left: '65%', width: 100, height: 50, borderRadius: '8px', border: `2px solid ${C.gold}` }} />
            <div style={{ position: 'absolute', top: '70%', left: '25%', width: 55, height: 55, borderRadius: '50%', border: `2px solid ${C.gold}` }} />
            <div style={{ position: 'absolute', top: '20%', left: '80%', width: 80, height: 80, borderRadius: '50%', border: `2px solid ${C.gold}` }} />
          </div>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', margin: '0 auto 24px',
            background: 'linear-gradient(135deg, rgba(215,190,128,0.15) 0%, rgba(184,148,79,0.15) 100%)',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: C.charcoal, margin: 0 }}>Seating Map</h2>
          <p style={{ fontSize: '14px', color: C.stone, maxWidth: 340, margin: '12px auto 0', lineHeight: 1.7 }}>
            Design your venue layout with our interactive drag-and-drop seating map. Complete your event payment to unlock this feature.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              marginTop: 32, padding: '14px 36px',
              background: 'linear-gradient(135deg, #D7BE80 0%, #B8944F 100%)',
              color: C.white, border: 'none', borderRadius: '30px',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(184,148,79,0.25)',
              transition: 'all 0.3s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(184,148,79,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(184,148,79,0.25)'; }}
          >
            Complete Payment & Activate →
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              display: 'block', margin: '16px auto 0', background: 'none', border: 'none',
              color: C.stone, fontSize: '13px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sm-page" style={{ minHeight: '100vh', background: C.white, color: C.charcoal, padding: 24, userSelect: 'none', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div className="fx-container fx-container--wide" style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 20, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <Link href="/dashboard" style={{ color: C.gold, fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>← Back to Dashboard</Link>
            <span style={{ color: C.border }}>|</span>
            <span style={{ fontSize: 10, textTransform: 'uppercase', color: C.stone, fontWeight: 700, letterSpacing: '0.1em' }}>Visual Planner</span>
          </div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 500, marginTop: 4 }}>Venue & Seating Map</h1>
          <p style={{ fontSize: 12, color: C.stone, marginTop: 2 }}>
            {summary.attendingGuests} attending · {summary.seatedGuests} seated · {summary.unseatedGuests} to seat · {elements.length} elements
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {pendingCount > 0 && <button onClick={() => saveSeating()} disabled={saving} style={{ ...btn, background: C.gold, color: C.white }}>{saving ? 'Saving…' : `Save Seating (${pendingCount})`}</button>}
          {layoutDirty && <button onClick={saveLayout} disabled={saving} style={{ ...btn, background: C.white, border: `1px solid ${C.gold}`, color: C.gold }}>Save Layout</button>}
          <button
            onClick={() => setShowPrintPreview(true)}
            title="Build the event-day pack — floor plan, guest index, table assignments — then print it or save it as a PDF"
            style={{ ...btn, background: 'transparent', border: `1px solid ${C.gold}`, color: C.gold, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
            Print / Export
          </button>
          <button onClick={() => setShowLogoutModal(true)} style={{ ...btn, background: 'transparent', border: `1px solid ${C.border}`, color: C.stone }}>Sign Out</button>
        </div>
      </div>

      {armedGuest && (
        <div style={{
          maxWidth: 1480, margin: '0 auto 12px', padding: '10px 16px', borderRadius: 10,
          background: 'rgba(184,148,79,0.1)', border: `1px solid ${C.gold}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.charcoal }}>
            Tap a table to seat <strong style={{ color: C.gold }}>{armedGuest.guest_name}</strong> (party of {armedGuest.party_size})
          </span>
          <button onClick={() => setArmedGuest(null)} style={{ ...btn, background: C.white, border: `1px solid ${C.border}`, color: C.stone, padding: '6px 14px' }}>
            Cancel
          </button>
        </div>
      )}

      <div className="seating-layout-grid fx-container fx-container--wide" style={{ display: 'grid', gridTemplateColumns: '300px 1fr 300px', gap: 18 }}>

        {/* ── Left: guest list ── */}
        <div className="seating-guestlist-panel" style={{ background: C.white, border: `1px solid ${C.border}`, padding: 18, borderRadius: 12, display: 'flex', flexDirection: 'column', height: 640 }}>
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 500, marginBottom: 12 }}>Guests</h3>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search guests…"
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 16, outline: 'none', marginBottom: 8 }}
            onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {['unseated', 'seated', 'all'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{ flex: 1, padding: '6px 4px', minHeight: 'var(--fx-touch)', fontSize: 11, fontWeight: 700, borderRadius: 6, border: `1px solid ${filter === f ? C.gold : C.border}`, background: filter === f ? 'rgba(184,148,79,0.08)' : C.white, color: filter === f ? C.gold : C.stone, cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: C.stone, marginBottom: 8 }}>{guestTotal.toLocaleString()} {filter} guest{guestTotal === 1 ? '' : 's'} · tap a guest, then tap a table to seat them</span>
          <VirtualGuestList
            items={effectiveGuests}
            height={470}
            loading={guestLoading}
            onDragStartGuest={onDragStartGuest}
            onTapGuest={onTapGuest}
            armedGuestId={armedGuest?.id}
            onReachEnd={() => { if (!guestLoading && guests.length < guestTotal) fetchGuests(guestPage + 1, false); }}
            emptyText={filter === 'unseated' ? 'Everyone is seated.' : 'No guests found.'}
            onResendGuest={handleResendGuest}
            resendingId={resendingId}
            pendingIds={pendingIds}
          />
        </div>

        {/* ── Center: canvas ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="sm-canvas-toolbar" style={{ background: C.white, padding: '8px 14px', borderRadius: 10, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            {/* Wraps, because this group cannot fit a phone on one line: "+ Add
                Element", Undo, Redo and the selection control sum to roughly 371px
                of min-content, and a nowrap flex row is floored at that sum. The
                toolbar around it already wraps, so the group dropped to its own
                line and then overflowed it. */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <button onClick={() => setShowAdd(true)} style={{ ...btn, background: C.gold, color: C.white, padding: '6px 14px' }}>+ Add Element</button>
              <button onClick={undo} disabled={historyIndex <= 0} style={{
                ...btn, minHeight: 'var(--fx-touch)',
                background: C.white,
                border: `1px solid ${C.border}`,
                color: historyIndex <= 0 ? C.border : C.charcoal,
                padding: '6px 12px', minHeight: 'var(--fx-touch)',
                cursor: historyIndex <= 0 ? 'not-allowed' : 'pointer'
              }} title="Undo (Ctrl+Z)">
                Undo
              </button>
              <button onClick={redo} disabled={historyIndex >= history.length - 1} style={{
                ...btn,
                background: C.white,
                border: `1px solid ${C.border}`,
                color: historyIndex >= history.length - 1 ? C.border : C.charcoal,
                padding: '6px 12px', minHeight: 'var(--fx-touch)',
                cursor: historyIndex >= history.length - 1 ? 'not-allowed' : 'pointer'
              }} title="Redo (Ctrl+Y)">
                Redo
              </button>
              {selectedIds.size > 0 ? (
                <button onClick={clearSelection} style={{
                  ...btn, background: 'rgba(184,148,79,0.08)', border: `1px solid ${C.gold}`, color: C.gold, padding: '6px 12px', minHeight: 'var(--fx-touch)',
                }} title="Click an empty area or press this to deselect">
                  {selectedIds.size} selected · Deselect
                </button>
              ) : (
                <div ref={selectMenuRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setSelectMenuOpen(v => !v)}
                    disabled={elements.length === 0}
                    style={{
                      ...btn, background: C.white, border: `1px solid ${C.border}`, color: elements.length === 0 ? C.border : C.charcoal, padding: '6px 12px', minHeight: 'var(--fx-touch)',
                      cursor: elements.length === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                    }}
                    title="Select every table & zone, or narrow it to just tables, zones, or one shape (e.g. round tables only). Ctrl/Cmd/Shift-click individual elements on the canvas to select only those."
                  >
                    Select All
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: selectMenuOpen ? 'rotate(180deg)' : undefined }}><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  {selectMenuOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20, minWidth: 210,
                      background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
                      boxShadow: '0 12px 30px rgba(0,0,0,0.14)', padding: 6, display: 'flex', flexDirection: 'column', gap: 1,
                    }}>
                      <SelectMenuItem label="Everything" count={elements.length} onClick={selectAll} />
                      <SelectMenuDivider />
                      <div style={{ padding: '4px 9px 2px', fontSize: 10, color: C.stone, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Filter & Select
                      </div>
                      <div style={{ padding: '4px 9px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label style={{ fontSize: 10, color: C.stone, fontWeight: 600, display: 'block' }}>
                          Type of element
                          <select
                            value={filterType}
                            onChange={(e) => {
                              const v = e.target.value;
                              setFilterType(v);
                              const isZoneType = v === 'zone' || SHAPES[v]?.cat === 'zone';
                              if (isZoneType) setFilterCapacity('any');
                            }}
                            style={selectMenuInputStyle}
                          >
                            <option value="any">Any type</option>
                            <option value="table">All Tables</option>
                            <option value="zone">All Zones</option>
                            <optgroup label="Tables">
                              {Object.entries(SHAPES).filter(([, m]) => m.cat === 'table').map(([key, meta]) => (
                                <option key={key} value={key}>{meta.label}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Zones">
                              {Object.entries(SHAPES).filter(([, m]) => m.cat === 'zone').map(([key, meta]) => (
                                <option key={key} value={key}>{meta.label}</option>
                              ))}
                            </optgroup>
                          </select>
                        </label>
                        <label style={{ fontSize: 10, color: C.stone, fontWeight: 600, display: 'block' }}>
                          Seat capacity
                          <select
                            value={filterCapacity}
                            onChange={(e) => setFilterCapacity(e.target.value)}
                            disabled={filterType === 'zone' || SHAPES[filterType]?.cat === 'zone'}
                            style={selectMenuInputStyle}
                          >
                            <option value="any">Any capacity</option>
                            {capacityOptions.map((c) => <option key={c} value={c}>{c} seats</option>)}
                          </select>
                        </label>
                        <button
                          onClick={applyTypeCapacityFilter}
                          disabled={filteredCount === 0}
                          style={{
                            ...btn, background: filteredCount === 0 ? C.white : C.gold, color: filteredCount === 0 ? C.border : C.white,
                            border: `1px solid ${filteredCount === 0 ? C.border : C.gold}`, padding: '7px 10px', minHeight: 'var(--fx-touch)', fontSize: 11,
                            cursor: filteredCount === 0 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Select {filteredCount} element{filteredCount === 1 ? '' : 's'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {/* ── Select / Hand. The discoverable way to move around. ──
                  Every other pan gesture (space, middle-drag, right-drag,
                  one-finger touch) still works from either tool; this only
                  changes what a PLAIN left-drag on empty canvas does, and it
                  starts on Select so nothing behaves differently until it is
                  deliberately switched. */}
              {/* flexWrap is a no-op at any real width — the two buttons come to
                  ~120px of min-content and the narrowest gutter leaves 280px —
                  but test/mobileFit.test.js ratchets rigid horizontal rows to
                  zero, and "it happens to fit today" is exactly the reasoning
                  that put 397 rows on that list. */}
              <div role="group" aria-label="Canvas tool" style={{ display: 'flex', flexWrap: 'wrap', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                {[
                  { key: 'select', label: 'Select', hint: 'Select tool (V) — drag the background to box-select',
                    icon: <path d="M3 2l7.5 18 2.4-7.1L20 10.5z" /> },
                  { key: 'hand', label: 'Move', hint: 'Hand tool (H) — drag anywhere to move around the map',
                    icon: <><path d="M18 11V6a2 2 0 0 0-4 0v5" /><path d="M14 10V4a2 2 0 0 0-4 0v7" /><path d="M10 10.5V6a2 2 0 0 0-4 0v9" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8v-1a2 2 0 1 1 4 0" /></> },
                ].map(({ key, label, hint, icon }) => {
                  const on = tool === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setToolBoth(key)}
                      aria-pressed={on}
                      title={hint}
                      style={{
                        ...btn, borderRadius: 0, border: 'none',
                        background: on ? 'rgba(184,148,79,0.10)' : C.white,
                        color: on ? C.gold : C.stone,
                        padding: '6px 11px', minHeight: 'var(--fx-touch)',
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
                      {label}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setSnapToGrid(!snapToGrid)} style={{
                ...btn,
                background: snapToGrid ? 'rgba(184,148,79,0.08)' : C.white,
                border: `1px solid ${snapToGrid ? C.gold : C.border}`,
                color: snapToGrid ? C.gold : C.stone,
                padding: '6px 12px', minHeight: 'var(--fx-touch)',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
                Snap to Grid
              </button>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, borderLeft: `1px solid ${C.border}`, paddingLeft: 8 }}>
                <button onClick={() => zoomBy(1 / 1.2)} style={{ ...btn, background: C.white, border: `1px solid ${C.border}`, color: C.charcoal, padding: '6px 12px' }}>−</button>
                <span style={{ fontSize: 11, color: C.stone, minWidth: 42, textAlign: 'center' }}>{Math.round(view.scale * 100)}%</span>
                <button onClick={() => zoomBy(1.2)} style={{ ...btn, background: C.white, border: `1px solid ${C.border}`, color: C.charcoal, padding: '6px 12px' }}>+</button>
                <button onClick={resetView} style={{ ...btn, minHeight: 'var(--fx-touch)', background: C.white, border: `1px solid ${C.border}`, color: C.stone, padding: '6px 12px' }}>Fit</button>
              </div>
            </div>
          </div>

          <div
            ref={viewportRef}
            onPointerDown={onCanvasPointerDown}
            // Right-drag is a pan gesture here, so the browser menu that would
            // otherwise open on mouseup has to be suppressed — without this the
            // pan works but ends with a context menu over the map every time.
            onContextMenu={(e) => e.preventDefault()}
            style={{ width: '100%', height: 590, background: C.ivory, border: `2px dashed ${C.border}`, borderRadius: 16, position: 'relative', overflow: 'hidden', /* The cursor is the cue for which gesture is live: a grab hand while the
   Hand tool is picked or space is held, a crosshair while a plain drag would
   draw a selection box. (The wheel listener is attached imperatively in an
   effect above, not here — React's synthetic onWheel is passive and cannot
   preventDefault, which would let the dashboard scroll behind the map.) */
            cursor: panning ? 'grabbing' : (tool === 'hand' || spacePanHint) ? 'grab' : 'crosshair', touchAction: 'none' }}
          >
            <div style={{ position: 'absolute', left: 0, top: 0, width: WORLD_W, height: WORLD_H, transformOrigin: '0 0', transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, backgroundImage: 'radial-gradient(#E0D8C6 1px, transparent 1px)', backgroundSize: '32px 32px' }}>
              {visibleElements.map(el => {
                const groupOverride = groupDragPos && groupDragPos.get(el.id);
                const display = groupOverride
                  ? { ...el, position_x: groupOverride.x, position_y: groupOverride.y }
                  : (dragPos && dragPos.id === el.id) ? { ...el, position_x: dragPos.x, position_y: dragPos.y } : el;
                return (
                  <CanvasElement
                    key={el.id}
                    el={display}
                    occupied={occByTable[el.id] || 0}
                    names={namesByTable[el.id] || EMPTY_NAMES}
                    selected={selectedId === el.id || selectedIds.has(el.id)}
                    showHandles={selectedId === el.id && selectedIds.size === 0}
                    dragOver={dragOverId === el.id}
                    scale={view.scale}
                    onPointerDownMove={onElementPointerDown}
                    onResizeStart={onResizeStart}
                    onRotateStart={onRotateStart}
                    onDropGuest={onDropGuest}
                    onDragOverEl={onDragOverEl}
                    onDragLeaveEl={onDragLeaveEl}
                    onSelect={setSelectedId}
                  />
                );
              })}
            </div>
            {elements.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <p style={{ color: C.stone, fontSize: 13, fontStyle: 'italic' }}>Click “Add Element” to place tables, a stage, dance floor and more.</p>
              </div>
            )}
            {/* Shift-drag rubber-band select — drawn in the same viewport-
                relative screen space it's hit-tested against on release. */}
            {marquee && (
              <div style={{
                position: 'absolute', pointerEvents: 'none',
                left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
                border: `1.5px dashed ${C.gold}`, background: 'rgba(184,148,79,0.10)', borderRadius: 3,
              }} />
            )}
          </div>
          <p style={{ fontSize: 11, color: C.stone, textAlign: 'center' }}>
            Scroll to move around · Shift-scroll sideways · Ctrl/Cmd-scroll or the −/+ buttons to zoom · arrow keys pan when nothing is selected<br />
            Drag the background to select · switch to the Move tool, hold space, or drag with the right or middle mouse button to pan · drag a guest onto a table to seat them · Ctrl/Cmd/Shift-click to add one to a selection.
          </p>
        </div>

        {/* ── Right: inspector ── */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, padding: 18, borderRadius: 12, display: 'flex', flexDirection: 'column', height: 640 }}>
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 500, borderBottom: `1px solid ${C.border}`, paddingBottom: 12, marginBottom: 14 }}>Inspector</h3>
          {!selected ? (
            /**
             * THE GROUP PANEL — and the reason it has to exist.
             *
             * A marquee selection sets `selectedId` to null and fills
             * `selectedIds`, so `selected` is null and this branch renders. It
             * used to be a sentence and nothing else, which meant that after
             * wiring bulk rotate and bulk delete the two buttons still had no
             * surface: the only way to reach either was the Delete key, and
             * rotate had no trigger at all. The handlers were fixed and the
             * complaint — "you cannot delete or rotate the selected elements" —
             * was still true through the interface.
             */
            selectedIds.size > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 12.5, color: C.charcoal, margin: 0, lineHeight: 1.6 }}>
                  <strong>{selectedIds.size} element{selectedIds.size > 1 ? 's' : ''} selected.</strong>{' '}
                  Drag any one of them to move the whole group.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    onClick={rotateSelected}
                    disabled={saving}
                    style={{ ...btn, background: 'rgba(184,148,79,0.06)', border: '1px solid rgba(184,148,79,0.2)', color: C.gold, padding: '7px 10px', minHeight: 'var(--fx-touch)', fontSize: 11, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}
                  >
                    Rotate all 90°
                  </button>
                  <button
                    onClick={deleteElement}
                    disabled={saving}
                    style={{ ...btn, background: 'rgba(196,94,94,0.06)', border: '1px solid rgba(196,94,94,0.2)', color: C.danger, padding: '7px 10px', minHeight: 'var(--fx-touch)', fontSize: 11, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}
                  >
                    Delete all
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    style={{ ...btn, background: 'transparent', border: `1px solid ${C.border}`, color: C.stone, padding: '7px 10px', minHeight: 'var(--fx-touch)', fontSize: 11 }}
                  >
                    Clear
                  </button>
                </div>
                <p style={{ fontSize: 11, color: C.stone, margin: 0, lineHeight: 1.55 }}>
                  Rotating turns each element about its own centre. Tables with guests seated
                  at them are kept when deleting.
                </p>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: C.stone, maxWidth: 180 }}>
                  Select an element on the canvas to edit it.
                </p>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
              <div>
                <label style={{ fontSize: 10, color: C.stone, fontWeight: 700, textTransform: 'uppercase' }}>{isZone(selected) ? 'Label' : 'Table Number'}</label>
                <input
                  type={isZone(selected) ? 'text' : 'number'}
                  min={isZone(selected) ? undefined : 1}
                  value={inspectName}
                  onChange={e => setInspectName(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, outline: 'none', marginTop: 4 }}
                />
              </div>
              {!isZone(selected) && (
                <div>
                  <label style={{ fontSize: 10, color: C.stone, fontWeight: 700, textTransform: 'uppercase' }}>Max Capacity</label>
                  <input type="number" min="1" value={inspectCapacity} onChange={e => setInspectCapacity(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, outline: 'none', marginTop: 4 }} />
                </div>
              )}
              <div style={{ fontSize: 9, color: C.stone, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
                {shapeMeta(selected.shape).label}
                {!isZone(selected) && ` • ${occByTable[selected.id] || 0} / ${selected.max_capacity} seated`}
                {isZone(selected) && ` • ${Math.round(elWidth(selected))}×${Math.round(elHeight(selected))}`}
                {` • ${Math.round(Number(selected.rotation) || 0)}°`}
              </div>
              {elWidth(selected) !== elHeight(selected) && (
                <button onClick={rotateSelected} disabled={saving} style={{ ...btn, background: 'rgba(184,148,79,0.06)', border: '1px solid rgba(184,148,79,0.2)', color: C.gold, padding: '7px 10px', minHeight: 'var(--fx-touch)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                  {isZone(selected) ? 'Rotate 90°' : 'Rotate 90° (lengthwise / widthwise)'}
                </button>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button onClick={saveInspector} disabled={saving} style={{ ...btn, flex: 1, background: C.gold, color: C.white, padding: '7px 10px', minHeight: 'var(--fx-touch)', fontSize: 11, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>Save</button>
                <button onClick={duplicateElement} disabled={saving} style={{ ...btn, background: 'rgba(184,148,79,0.06)', border: '1px solid rgba(184,148,79,0.2)', color: C.gold, padding: '7px 10px', minHeight: 'var(--fx-touch)', fontSize: 11, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>Duplicate</button>
                <button onClick={deleteElement} disabled={saving} style={{ ...btn, background: 'rgba(196,94,94,0.06)', border: '1px solid rgba(196,94,94,0.2)', color: C.danger, padding: '7px 10px', minHeight: 'var(--fx-touch)', fontSize: 11, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>Delete</button>
              </div>

              {!isZone(selected) && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
                  <span style={{ fontSize: 10, color: C.stone, fontWeight: 700 }}>Seated Guests ({seatedHere.length})</span>
                  <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {seatedHere.length === 0 ? (
                      <p style={{ fontSize: 12, color: C.stone, fontStyle: 'italic' }}>No guests seated yet.</p>
                    ) : seatedHere.map(g => (
                      <div key={g.id} style={{ background: '#FAFAF8', padding: 8, border: `1px solid #F0ECE3`, borderRadius: 8, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.guest_name}</span>
                          <span style={{ fontSize: 10, color: C.stone }}>Party of {g.party_size}</span>
                        </div>
                        <button onClick={() => unseatGuest(g)} style={{ padding: '4px 10px', minHeight: 'var(--fx-touch)', background: 'rgba(196,94,94,0.06)', border: '1px solid rgba(196,94,94,0.15)', borderRadius: 6, fontSize: 10, fontWeight: 700, color: C.danger, cursor: 'pointer' }}>Unseat</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add element modal */}
      {showAdd && <AddElementModal onClose={() => setShowAdd(false)} onAdd={addElement} btn={btn} view={view} saving={saving} elements={elements} />}

      {/* Print preview — an on-screen, drag-to-arrange rehearsal of the whole
          event-day pack. Only mounted while open; window.print() inside it
          targets its own .print-seating-chart content (see globals.css). */}
      {showPrintPreview && (
        <SeatingChartPrintModal
          eventTitle={eventTitle}
          eventDate={eventDate}
          eventTimezone={eventTimezone}
          organizerName={organizerName}
          elements={elements}
          partiesByTable={partiesByTable}
          unseatedParties={unseatedParties}
          membersByParty={membersByParty}
          occByTable={occByTable}
          summary={summary}
          membersLoading={membersLoading}
          onClose={() => setShowPrintPreview(false)}
        />
      )}

      <style jsx>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        /* MOB-7: the 3-column planner (guest list | canvas | inspector) was a
           fixed grid with no breakpoint at all — on a phone the columns
           compressed to unusably narrow slivers. Stacked instead; the canvas
           itself still benefits from more room, so it keeps a taller default
           height once full-width rather than the cramped 590px meant for a
           1/3-width column. */
        @media (max-width: 1023.98px) {
          .seating-layout-grid { grid-template-columns: 1fr !important; }
          .seating-guestlist-panel { height: 360px !important; }
        }
        /* Canvas toolbar buttons (Undo/Redo/Select All/Snap to Grid/zoom) are
           sized for a mouse (~28-34px tall) — bump to a real touch target and
           trim the page's flat 24px padding, which eats a lot of a 320-375px
           phone's width. */
        @media (max-width: 639.98px) {
          .sm-page { padding: 12px !important; }
          .sm-canvas-toolbar button { min-height: 40px !important; padding: 8px 14px !important; }
        }
      `}</style>
      <LogoutModal isOpen={showLogoutModal} onClose={() => setShowLogoutModal(false)} onConfirm={logout} />
      {confirmDialog}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Smart helper for naming incrementing (letters/numbers)
   ════════════════════════════════════════════════════════════════ */
function generateNumberedName(baseName, index, startNum) {
  // 1. Check if name ends with a DELIBERATE letter suffix — a space then a
  // single letter (e.g. "Table A", "Exit B"). Increments like a spreadsheet
  // column (A, B, … Z, AA, AB, …) so a batch larger than 26 never silently
  // falls through to branch 3 and mixes letters with a number on the same
  // name (e.g. the old code produced "Table A 27" once it ran past "Z").
  //
  // The space before the letter is REQUIRED (\s+, not \s*): an earlier
  // version matched any trailing letter with no space needed at all, which
  // means it fired on the last letter of an ordinary word — batch-adding
  // zones named "Bar" or "WC" came out as "Ba r", "Ba s", "W D", "W E" …
  // mangling the label instead of numbering it. Requiring the space means
  // only names actually ending " <letter>" take this branch; plain words
  // fall through to the number-suffix branch below ("Bar" → "Bar 2", "WC" →
  // "WC 2"), which is what a zone label should do.
  const letterMatch = baseName.match(/^(.*?)\s+([a-zA-Z])$/);
  if (letterMatch) {
    const prefix = letterMatch[1];
    const letter = letterMatch[2];
    const isLower = letter >= 'a' && letter <= 'z';
    let n = (letter.toUpperCase().charCodeAt(0) - 64) + index; // A=1
    let letters = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return `${prefix} ${isLower ? letters.toLowerCase() : letters}`.trim();
  }

  // 2. Check if name ends with a number (e.g. Table 1)
  const numMatch = baseName.match(/^(.*?)\s*(\d+)$/);
  if (numMatch) {
    const prefix = numMatch[1];
    const num = parseInt(numMatch[2]);
    return `${prefix} ${num + index}`.trim();
  }

  return `${baseName} ${startNum + index}`.trim();
}

/* Tables are always identified by a plain unique number (no names) — find the
   next free one from whatever's already on the canvas. Scans EVERY table
   element regardless of its specific shape (round, rectangle, banquet, …) —
   they all share cat: 'table', so a round table numbered 3 and a rectangle
   table numbered 3 can never coexist. */
function getNextTableNumber(elements) {
  let max = 0;
  (elements || []).forEach(el => {
    if (shapeMeta(el.shape).cat === 'table') {
      const n = parseInt(el.table_name, 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return max + 1;
}

/* Zones (Stage, Bar, DJ Booth, …) default to their type label, which isn't
   unique on its own — a second "Bar" would otherwise collide with the first
   (the backend now rejects that outright). Suffixes a number only once the
   plain label is already taken, so the first of a kind stays clean. */
function getUniqueZoneName(elements, baseLabel) {
  const used = new Set((elements || []).map(el => (el.table_name || '').trim().toLowerCase()));
  if (!used.has(baseLabel.trim().toLowerCase())) return baseLabel;
  let n = 2;
  while (used.has(`${baseLabel} ${n}`.trim().toLowerCase())) n++;
  return `${baseLabel} ${n}`;
}


/* ════════════════════════════════════════════════════════════════
   Add element modal — pick a shape (table) or a zone, then details
   ════════════════════════════════════════════════════════════════ */
function AddElementModal({ onClose, onAdd, btn, view, saving, elements }) {
  const [shape, setShape] = useState('round');
  const meta = SHAPES[shape];
  const nextTableNumber = useMemo(() => getNextTableNumber(elements), [elements]);
  // Default shape ('round') is a table, so the field starts pre-filled with the
  // next free number — tables never get a typed-in name, only a unique number.
  const [name, setName] = useState(() => String(getNextTableNumber(elements)));
  // Tracks whether the organizer has actually typed into the name/label field
  // — see pick() below, which used this (previously "is the field blank?")
  // to decide whether switching shapes should refresh the default name.
  const [nameTouched, setNameTouched] = useState(false);
  const [capacity, setCapacity] = useState(String(SHAPES.round.defaultCap));
  const [customColor, setCustomColor] = useState('');
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');

  // Layout arrangement states
  const [isMultiple, setIsMultiple] = useState(false);
  const [layoutMode, setLayoutMode] = useState('horizontal'); // 'horizontal', 'vertical', 'grid'
  const [quantity, setQuantity] = useState('4');
  const [gridCols, setGridCols] = useState('3');
  const [gridRows, setGridRows] = useState('2');
  const [spacing, setSpacing] = useState('40');
  const [startNumber, setStartNumber] = useState(() => String(getNextTableNumber(elements)));
  const [autoNumber, setAutoNumber] = useState(true);

  const pick = (s) => {
    setShape(s);
    setCapacity(String(SHAPES[s].defaultCap || 10));
    setCustomColor(SHAPES[s].color || '');
    setCustomWidth(String(SHAPES[s].w));
    setCustomHeight(String(SHAPES[s].h));
    // BUG this fixes: picking a table first (default) pre-fills a plain
    // number, e.g. "5". Switching to a zone (e.g. Stage) only refreshed the
    // name when the field was *blank* — since "5" isn't blank, the zone got
    // created with the leftover table number as its label instead of
    // "Stage". Now it refreshes whenever the organizer hasn't manually typed
    // a name themselves, regardless of category switched from/to — a zone's
    // default is always its proper label, never a bare number.
    if (!nameTouched || !name.trim()) {
      setName(SHAPES[s].cat === 'table' ? String(nextTableNumber) : getUniqueZoneName(elements, SHAPES[s].label));
    }
  };

  /**
   * The ADD panel offers pickable shapes only — Banquet and Head are Rectangle
   * at other proportions, so they were three buttons for one silhouette.
   *
   * The "Select All ▾" filter above deliberately still lists EVERY shape: an
   * organizer with existing banquet tables has to be able to select them.
   * Offering a shape and recognising one are different questions.
   */
  const tables = Object.entries(SHAPES).filter(([, m]) => m.cat === 'table' && m.pickable !== false);
  const zones = Object.entries(SHAPES).filter(([, m]) => m.cat === 'zone' && m.pickable !== false);

  const submit = () => {
    if (saving) return;
    if (!name.trim()) { toast.error(meta.cat === 'table' ? 'Please enter a table number.' : 'Please enter a label.'); return; }
    if (meta.cat === 'table' && isNaN(parseInt(name, 10))) { toast.error('Table number must be a number.'); return; }
    // Venue zones (Stage, Bar, DJ Booth, …) are identified by name, never a
    // bare number — tables are the only element type numbers are meaningful
    // for. Catches a manually-typed all-digit label, not just the stale-
    // default case pick() now avoids above.
    if (meta.cat === 'zone' && /^\d+$/.test(name.trim())) { toast.error('Venue zones need a name, not just a number — try something like "Stage" or "Bar 2".'); return; }

    let numElements = 1;
    let qty = 1;
    let cols = 1;
    let rows = 1;
    let gap = 40;
    
    if (isMultiple) {
      gap = parseInt(spacing);
      if (isNaN(gap) || gap < 0) { toast.error('Please enter a valid spacing.'); return; }
      
      if (layoutMode !== 'grid') {
        qty = parseInt(quantity);
        if (isNaN(qty) || qty < 2 || qty > 50) { toast.error('Quantity must be between 2 and 50.'); return; }
        numElements = qty;
      } else {
        cols = parseInt(gridCols);
        rows = parseInt(gridRows);
        if (isNaN(cols) || cols < 1 || cols > 10 || isNaN(rows) || rows < 1 || rows > 10) {
          toast.error('Grid columns and rows must be between 1 and 10.');
          return;
        }
        if (cols * rows < 2) {
          toast.error('Grid layout must contain at least 2 elements.');
          return;
        }
        numElements = cols * rows;
      }
    }

    const payloads = [];
    const itemW = meta.cat === 'table' ? meta.w : (parseInt(customWidth) || meta.w);
    const itemH = meta.cat === 'table' ? meta.h : (parseInt(customHeight) || meta.h);
    
    const startXPercent = clamp((-view.tx / view.scale) / WORLD_W * 100 + 8, 0, 100);
    const startYPercent = clamp((-view.ty / view.scale) / WORLD_H * 100 + 8, 0, 100);
    const startXPx = startXPercent / 100 * WORLD_W;
    const startYPx = startYPercent / 100 * WORLD_H;

    for (let i = 0; i < numElements; i++) {
      let xPx = startXPx;
      let yPx = startYPx;

      if (isMultiple) {
        if (layoutMode === 'horizontal') {
          xPx = startXPx + i * (itemW + gap);
        } else if (layoutMode === 'vertical') {
          yPx = startYPx + i * (itemH + gap);
        } else if (layoutMode === 'grid') {
          const colIdx = i % cols;
          const rowIdx = Math.floor(i / cols);
          xPx = startXPx + colIdx * (itemW + gap);
          yPx = startYPx + rowIdx * (itemH + gap);
        }
      }

      const xPct = clamp((xPx / WORLD_W) * 100, 0, 100);
      const yPct = clamp((yPx / WORLD_H) * 100, 0, 100);

      let finalName = name.trim();
      if (isMultiple && autoNumber) {
        if (meta.cat === 'table') {
          const base = parseInt(startNumber, 10);
          finalName = String((isNaN(base) ? nextTableNumber : base) + i);
        } else {
          finalName = generateNumberedName(finalName, i, parseInt(startNumber) || 1);
        }
      }

      const payload = {
        shape,
        tableName: finalName,
        elementType: meta.cat,
        x: xPct,
        y: yPct,
      };

      if (meta.cat === 'table') {
        const cap = parseInt(capacity);
        if (isNaN(cap) || cap < 1) { toast.error('Enter a valid capacity.'); return; }
        payload.maxCapacity = cap;
      } else {
        payload.width = parseInt(customWidth) || meta.w;
        payload.height = parseInt(customHeight) || meta.h;
        payload.color = customColor || meta.color;
      }

      payloads.push(payload);
    }

    onAdd(payloads);
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 13, outline: 'none', fontFamily: 'var(--font-sans)', transition: 'border-color 0.2s' };
  const labelStyle = { fontSize: 11, color: C.stone, fontWeight: 600, display: 'block', marginBottom: 4 };

  const Tile = ({ s, m }) => (
    <button key={s} onClick={() => pick(s)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 6px', borderRadius: 10, border: `1px solid ${shape === s ? C.gold : C.border}`, background: shape === s ? 'rgba(184,148,79,0.08)' : C.white, cursor: 'pointer', transition: 'all 0.15s' }}>
      {m.icon ? <Icon name={m.icon} size={20} strokeWidth={1.4} /> : <span style={{ fontSize: 20 }}>{m.round ? '⬤' : '▭'}</span>}
      <span style={{ fontSize: 10, fontWeight: 600, color: C.charcoal, textAlign: 'center' }}>{m.label}</span>
    </button>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(25,27,30,0.6)', backdropFilter: 'blur(4px)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.white, border: `1px solid ${C.border}`, width: '100%', maxWidth: 520, borderRadius: 16, padding: 24, maxHeight: '88vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500 }}>Add Element</h3>

        {/**
          * .fx-grid rather than repeat(3|4, 1fr).
          *
          * The fixed grids fitted a 320px phone by 1.5px. Arithmetic: the modal is
          * 288px there, its 24px padding leaves 240px, and four tracks with three
          * 8px gaps give each tile 54px — 40px inside its own padding and border.
          * "Welcome" (the longest unbreakable run in "Welcome Desk") needs about
          * 38.5px at font-size 10. It fitted, and one longer zone label would have
          * overflowed with nothing to catch it.
          *
          * auto-fit contributes ZERO to min-content width (AGENTS.md), so the tiles
          * now drop to two columns on a phone and grow to five in the modal's full
          * 520px instead of being pinned to a count that only suits one width.
          *
          * `--fx-col` and `--fx-gap` are the class's documented inputs; the inline
          * `display`, `gridTemplateColumns` and `gap` are DELETED rather than left
          * beside it, because an inline style always beats a class and would have
          * made the class inert at every viewport.
          */}
        <div>
          <span style={{ fontSize: 11, color: C.stone, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tables</span>
          <div className="fx-grid" style={{ '--fx-col': '76px', '--fx-gap': '8px', marginTop: 8 }}>
            {tables.map(([s, m]) => <Tile key={s} s={s} m={m} />)}
          </div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: C.stone, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Venue Zones</span>
          <div className="fx-grid" style={{ '--fx-col': '76px', '--fx-gap': '8px', marginTop: 8 }}>
            {zones.map(([s, m]) => <Tile key={s} s={s} m={m} />)}
          </div>
        </div>

        {/* Details section */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 11, color: C.stone, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Details</span>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{meta.cat === 'zone' ? 'Label' : 'Table Number'}</label>
              {meta.cat === 'zone' ? (
                <input value={name} onChange={e => { setName(e.target.value); setNameTouched(true); }} placeholder={meta.label} style={inputStyle} onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border} />
              ) : (
                <input type="number" min="1" value={name} onChange={e => { setName(e.target.value); setNameTouched(true); }} style={inputStyle} onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border} />
              )}
            </div>
            {meta.cat === 'table' && (
              <div style={{ width: 120 }}>
                <label style={labelStyle}>Capacity</label>
                <input type="number" min="1" value={capacity} onChange={e => setCapacity(e.target.value)} style={inputStyle} onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border} />
              </div>
            )}
          </div>

          {meta.cat === 'zone' && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Width (px)</label>
                  <input type="number" min="60" value={customWidth || meta.w} onChange={e => setCustomWidth(e.target.value)} style={inputStyle} onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Height (px)</label>
                  <input type="number" min="50" value={customHeight || meta.h} onChange={e => setCustomHeight(e.target.value)} style={inputStyle} onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Color</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={customColor || meta.color || C.gold} onChange={e => setCustomColor(e.target.value)} style={{ width: 40, height: 36, border: `1px solid ${C.border}`, borderRadius: 8, padding: 2, cursor: 'pointer', background: C.white }} />
                  <input value={customColor || meta.color || ''} onChange={e => setCustomColor(e.target.value)} placeholder="#hex color" style={{ ...inputStyle, flex: 1 }} onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border} />
                </div>
              </div>
            </>
          )}

          {/* Multiple Elements Layout section */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={isMultiple} onChange={e => setIsMultiple(e.target.checked)} style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.charcoal }}>Add multiple elements in a layout</span>
            </label>

            {isMultiple && (
              <div style={{
                marginTop: 4, padding: 14, background: C.softBg, border: `1px solid ${C.border}`,
                borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 12,
                animation: 'fadeIn 0.2s ease'
              }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Arrangement</label>
                    <select value={layoutMode} onChange={e => setLayoutMode(e.target.value)} style={inputStyle}>
                      <option value="horizontal">Horizontal Row</option>
                      <option value="vertical">Vertical Column</option>
                      <option value="grid">Grid Layout</option>
                    </select>
                  </div>
                  {layoutMode !== 'grid' ? (
                    <div style={{ width: 120 }}>
                      <label style={labelStyle}>Quantity</label>
                      <input type="number" min="2" max="50" value={quantity} onChange={e => setQuantity(e.target.value)} style={inputStyle} />
                    </div>
                  ) : (
                    <>
                      <div style={{ width: 70 }}>
                        <label style={labelStyle}>Columns</label>
                        <input type="number" min="1" max="10" value={gridCols} onChange={e => setGridCols(e.target.value)} style={inputStyle} />
                      </div>
                      <div style={{ width: 70 }}>
                        <label style={labelStyle}>Rows</label>
                        <input type="number" min="1" max="10" value={gridRows} onChange={e => setGridRows(e.target.value)} style={inputStyle} />
                      </div>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Gap Spacing (px)</label>
                    <input type="number" min="0" max="500" value={spacing} onChange={e => setSpacing(e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Start Numbering</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      <input type="number" min="1" value={startNumber} onChange={e => setStartNumber(e.target.value)} style={{ ...inputStyle, flex: 1 }} disabled={!autoNumber} />
                      <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 11, color: C.stone }}>
                        <input type="checkbox" checked={autoNumber} onChange={e => setAutoNumber(e.target.checked)} />
                        Auto
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          <button onClick={onClose} style={{ ...btn, background: C.white, border: `1px solid ${C.border}`, color: C.stone }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...btn, background: C.gold, color: C.white, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Adding…' : 'Add to Canvas'}</button>
        </div>
      </div>
    </div>
  );
}
