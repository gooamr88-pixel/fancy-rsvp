'use client';

import React, { useState, useMemo, useCallback, memo } from 'react';
import { toast } from '../../utils/toast';
import { demoBlocked } from '../../utils/demoNotice';
import { smsReachability } from '../../utils/smsReachability';
import { isAccepted, isDeclined, isMaybe } from '../../utils/responseHelpers';
import { findMealField } from '../../utils/mealField';
import { sideLabel } from '../../utils/sideLabel';
import { matchesGuestSearch } from '../../utils/guestSearch';
import FeatureGate from './FeatureGate';
import EditGuestModal from './EditGuestModal';
import SmsBalanceBanner from './SmsBalanceBanner';
import ClearGuestListModal from './ClearGuestListModal';
import ConfirmRemoveGuestModal from './ConfirmRemoveGuestModal';
import GuestSheetGuide from './GuestSheetGuide';
import MobileDisclosure from './MobileDisclosure';

const COLORS = {
  gold: '#B8944F', goldHover: '#a6833f', charcoal: '#191B1E', ivory: '#F8F4EC',
  champagne: '#D7BE80', stone: '#77736A', border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8',
};

const PAGE_SIZE = 20;
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

/**
 * "on 40 invitations" — the party count, shown only when it differs from the head
 * count above it. On a list where every guest comes alone the two are identical and
 * repeating it would be noise.
 */
const partySub = (parties, people) => (
  parties === people ? null : `on ${parties} ${parties === 1 ? 'invitation' : 'invitations'}`
);


/* ── Stat Mini Card ──
 *
 * The tile IS the filter.
 *
 * There used to be six of these showing counts, and directly beneath them a
 * <select> offering the same six categories by the same names. So the numbers
 * were decoration: an organizer reading "Declined 12" and wanting to see those
 * twelve had to look away, find a dropdown, and re-pick the word they were
 * already looking at. Two controls for one intention.
 *
 * Making them buttons deletes the dropdown, turns every number into the answer to
 * "show me these", and means the current filter is legible from across the room
 * rather than collapsed inside a closed select.
 */
function StatMini({ icon, value, sub, label, accent, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        background: active ? `${accent}0F` : COLORS.white,
        border: `1px solid ${active ? accent : COLORS.border}`,
        borderRadius: '12px',
        padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px',
        borderLeft: `3px solid ${accent}`,
        transition: 'box-shadow 0.25s ease, background 0.2s ease, border-color 0.2s ease',
        cursor: 'pointer', textAlign: 'left', width: '100%',
        font: 'inherit',
        boxShadow: active ? `0 2px 10px ${accent}22` : 'none',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.05)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        width: '40px', height: '40px', borderRadius: '10px',
        background: `${accent}14`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        color: accent, flexShrink: 0,
      }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '22px', fontWeight: 800, color: COLORS.charcoal, fontFamily: 'var(--font-sans)', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 'var(--fx-micro)', fontWeight: 600, color: active ? accent : COLORS.stone, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px', fontFamily: 'var(--font-sans)' }}>{label}</div>
        {/* The second unit, only when it differs. Every headline here is a
            headcount; this says how many invitations those people arrived on, so
            a row of numbers that sums to the total cannot be mistaken for a row
            of party counts that does not. */}
        {sub && (
          <div style={{ fontSize: 'var(--fx-micro)', color: COLORS.stone, marginTop: '3px', fontFamily: 'var(--font-sans)', fontWeight: 500 }}>
            {sub}
          </div>
        )}
      </div>
    </button>
  );
}

/* ── Guest Card ── */
const GuestCard = memo(function GuestCard({ guest, tables, onAssignTable, customFields, event, onEdit, onDelete, deleting }) {
  const [expanded, setExpanded] = useState(false);
  const yes = isAccepted(guest.response);
  const no = isDeclined(guest.response);
  const maybe = isMaybe(guest.response);
  const accentColor = yes ? COLORS.gold : no ? '#C45E5E' : maybe ? '#6366F1' : COLORS.stone;
  const smsBadge = smsReachability(guest);

  const initials = guest.guest_name
    ? guest.guest_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  // Companions the guest brought (guests). The primary guest is included in
  // that table, so a party of N typically has N rows; surface them all.
  const party = Array.isArray(guest.guests) ? guest.guests : [];

  // Custom-question answers the party head gave during RSVP — resolve each
  // field_id against the event's field definitions to show a human label.
  // The meal field is excluded here since it's already shown via meal_selection.
  const mealField = findMealField(customFields);
  const customAnswers = (guest.customAnswers || [])
    .filter((a) => !mealField || a.field_id !== mealField.id)
    .map((a) => ({
      label: (customFields || []).find((f) => f.id === a.field_id)?.field_label || 'Question',
      value: a.answer_value,
    }))
    .filter((a) => a.value !== null && a.value !== undefined && String(a.value).trim() !== '');

  // Everyone in the party EXCEPT the person the card is already named after.
  // `party` includes the primary contact, so counting it gave every solo guest a
  // "1 party member" expander that opened to reveal the same name as the card
  // title — an affordance promising information it did not have.
  const companions = party.filter((p) => !p.is_primary_contact);

  const hasNotes = !!(guest.notes && guest.notes.trim());
  const hasDetails = companions.length > 0 || hasNotes || customAnswers.length > 0;

  return (
    <div style={{
      background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: '12px',
      padding: '20px', borderLeft: `3px solid ${accentColor}`,
      transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)', display: 'flex', flexWrap: 'wrap', gap: '14px',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Avatar */}
      <div style={{
        width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
        background: yes ? 'rgba(184,148,79,0.12)' : no ? 'rgba(196,94,94,0.1)' : maybe ? 'rgba(99,102,241,0.1)' : 'rgba(119,115,106,0.1)',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: '14px', color: accentColor, fontFamily: 'var(--font-sans)',
      }}>{initials}</div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row 1: Name + Badge — wraps on narrow phones so the badge/button
            group (side badge + response badge + two 44px touch targets, up to
            ~250px) never overflows the card and clips the delete button off
            screen the way FormBuilder's field rows used to (see its comment). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
          <span style={{ flex: '1 1 140px', minWidth: 0, fontWeight: 700, fontSize: '14px', color: COLORS.charcoal, fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {guest.guest_name}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', flexShrink: 0 }}>
            {event?.track_guest_side && guest.side && (
              <span style={{
                padding: '2px 10px', borderRadius: '6px', fontSize: 'var(--fx-micro)', fontWeight: 700,
                background: 'rgba(99,102,241,0.1)', color: '#6366F1', fontFamily: 'var(--font-sans)',
              }}>
                {sideLabel(guest.side, event)}
              </span>
            )}
            <span style={{
              padding: '2px 10px', borderRadius: '6px', fontSize: 'var(--fx-micro)', fontWeight: 700,
              background: yes ? 'rgba(184,148,79,0.1)' : no ? 'rgba(196,94,94,0.08)' : maybe ? 'rgba(99,102,241,0.1)' : 'rgba(119,115,106,0.1)',
              color: accentColor, fontFamily: 'var(--font-sans)', textTransform: 'uppercase',
            }}>
              {(guest.response || 'pending').toUpperCase()}
            </span>
            {/* aria-label as well as title. `title` is a desktop hover tooltip:
                it is never shown on touch and is not reliably announced, so on a
                phone these were two unlabelled squares — one of which deletes
                somebody. The label names the guest so it is unambiguous in a
                screen reader's list of buttons, where "Edit" x 20 is not. */}
            <button
              onClick={() => onEdit(guest)}
              title="Edit guest"
              aria-label={`Edit ${guest.guest_name || 'guest'}`}
              style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px',
              borderRadius: '6px', border: 'none', background: 'transparent', cursor: 'pointer', color: COLORS.stone,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = COLORS.ivory; e.currentTarget.style.color = COLORS.gold; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = COLORS.stone; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            </button>
            <button
              onClick={() => onDelete(guest)}
              title="Remove guest"
              aria-label={`Remove ${guest.guest_name || 'guest'} from this event`}
              disabled={deleting}
              style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px',
              borderRadius: '6px', border: 'none', background: 'transparent', cursor: deleting ? 'wait' : 'pointer',
              color: COLORS.stone, opacity: deleting ? 0.4 : 1,
            }}
              onMouseEnter={e => { if (!deleting) { e.currentTarget.style.background = 'rgba(196,94,94,0.08)'; e.currentTarget.style.color = '#C45E5E'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = COLORS.stone; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
            </button>
          </span>
        </div>

        {/* Row 2: Contact Info */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '11px', color: COLORS.stone, fontFamily: 'var(--font-sans)', marginBottom: '8px' }}>
          {guest.email && guest.email !== '-' && (
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              {guest.email}
            </span>
          )}
          {guest.phone && guest.phone !== '-' && (
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
              {guest.phone}
            </span>
          )}
          {/* Whether that number can actually be texted. Sits beside the phone
              because it is a fact about the phone, not about the guest. */}
          {smsBadge && (
            <span
              title={smsBadge.title}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '2px 8px', borderRadius: '5px', fontWeight: 700,
                fontSize: 'var(--fx-micro)', letterSpacing: '0.03em', textTransform: 'uppercase',
                background: smsBadge.bg, color: smsBadge.color, cursor: 'help',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {smsBadge.label}
            </span>
          )}
        </div>

        {/* Row 3: Party + Meal + Table */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          {/* Party Size */}
          <span style={{
            padding: '3px 10px', borderRadius: '6px', fontSize: 'var(--fx-micro)', fontWeight: 600,
            background: COLORS.ivory, color: COLORS.stone, fontFamily: 'var(--font-sans)',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            {guest.party_size} {guest.party_size === 1 ? 'guest' : 'guests'}
          </span>

          {/* Meal */}
          {guest.meal && guest.meal !== '-' && (
            <span style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: 'var(--fx-micro)', fontWeight: 600,
              background: COLORS.ivory, color: COLORS.stone, fontFamily: 'var(--font-sans)',
              maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: '4px',
            }} title={guest.meal}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>
              {guest.meal}
            </span>
          )}

          {/* Table Assignment */}
          {yes && (
            <select
              value={guest.tableId || ''}
              onChange={e => onAssignTable(guest.id, e.target.value)}
              style={{
                padding: '3px 8px', minHeight: 'var(--fx-touch)', borderRadius: '6px', fontSize: 'var(--fx-micro)', fontWeight: 600,
                border: `1px solid ${COLORS.border}`, background: COLORS.white, color: COLORS.charcoal,
                fontFamily: 'var(--font-sans)', cursor: 'pointer', outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={e => { e.target.style.borderColor = COLORS.border; }}
              aria-label={`Assign table for ${guest.guest_name}`}
            >
              <option value="">No Table</option>
              {tables.map(t => {
                const isCurrent = t.id === guest.tableId;
                const remaining = t.max_capacity - t.occupied;
                return (
                  <option key={t.id} value={t.id} disabled={!isCurrent && remaining < guest.party_size}>
                    {t.table_name} ({isCurrent ? 'Current' : `${remaining} left`})
                  </option>
                );
              })}
            </select>
          )}
        </div>

        {/* Row 4: who else is coming, and the rest of the detail.

            The names are shown INLINE rather than only behind the toggle. "Who is
            actually in this party" is the question this card exists to answer, and
            hiding it behind a click meant an organizer scanning a list of
            households could not see any of them without opening every card. The
            expander now carries what genuinely needs room: meals, dietary notes,
            answers and free-text notes. */}
        {companions.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '11.5px', color: COLORS.stone, fontFamily: 'var(--font-sans)', lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: COLORS.charcoal }}>With: </span>
            {companions.map((p) => p.full_name || 'Unnamed guest').join(' · ')}
          </div>
        )}

        {hasDetails && (
          <div style={{ marginTop: '10px', borderTop: `1px dashed ${COLORS.border}`, paddingTop: '8px' }}>
            <button onClick={() => setExpanded(v => !v)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: '11px', fontWeight: 700, color: COLORS.gold, fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              {expanded ? '▾' : '▸'} {expanded ? 'Hide details' : 'Show details'}
            </button>

            {expanded && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {party.map((p, i) => (
                  <div key={p.id || i} style={{
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px',
                    background: COLORS.softBg, border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '7px 10px',
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.charcoal, fontFamily: 'var(--font-sans)' }}>
                      {p.full_name || 'Unnamed guest'}
                    </span>
                    {p.is_primary_contact && <span style={{ fontSize: 'var(--fx-micro)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: COLORS.gold, background: 'rgba(184,148,79,0.12)', padding: '2px 6px', borderRadius: '4px' }}>Primary</span>}
                    {p.meal_selection && (
                      <span style={{ fontSize: 'var(--fx-micro)', color: COLORS.stone, fontFamily: 'var(--font-sans)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>
                        {p.meal_selection}
                      </span>
                    )}
                    {p.dietary_notes && (
                      <span style={{ fontSize: 'var(--fx-micro)', color: '#C45E5E', fontFamily: 'var(--font-sans)', fontStyle: 'italic' }} title="Dietary notes">
                        ⚠ {p.dietary_notes}
                      </span>
                    )}
                  </div>
                ))}
                {guest.notes && guest.notes.trim() && (
                  <div style={{ fontSize: '11px', color: COLORS.stone, fontFamily: 'var(--font-sans)', background: COLORS.softBg, border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '7px 10px' }}>
                    <strong style={{ color: COLORS.charcoal }}>Note: </strong>{guest.notes}
                  </div>
                )}
                {customAnswers.map((a, i) => (
                  <div key={i} style={{ fontSize: '11px', color: COLORS.stone, fontFamily: 'var(--font-sans)', background: COLORS.softBg, border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '7px 10px' }}>
                    <strong style={{ color: COLORS.charcoal }}>{a.label}: </strong>{Array.isArray(a.value) ? a.value.join(', ') : a.value}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/* ── Main Component ── */
export default function GuestsTab({
  rsvps, tables, customFields, eventId, event, onAssignTable, onRefresh,
  // `onOpenAddGuest` is gone with the button — adding one guest is now
  // "Send an invitation" in the Invitations & replies section.
  onOpenImport, isPaid, tierFeatures, onUpgrade,
  // Balance figures for the banner, passed down rather than refetched — the
  // dashboard already holds them, and two fetches would eventually show two
  // different numbers on the same screen.
  smsAddonActive = false, smsRemaining = 0, smsPurchased = 0, smsCoverage = null,
  /* The marketing demo. Rendering is untouched — this screen IS the guest
     list — but export and delete talk to the API directly rather than
     through a prop, so they cannot be made inert from outside and are
     stopped here instead. See utils/demoNotice.js. */
  demoMode = false,
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [editingGuest, setEditingGuest] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [clearOpen, setClearOpen] = useState(false);
  // The guest awaiting removal, captured when the row button was pressed.
  const [removing, setRemoving] = useState(null);

  /**
   * DOWNLOADING THE LIST — one control, in the section that holds the detail.
   *
   * Export used to exist in three places and nowhere useful:
   *
   *   • a header button on the RSVPs tab hitting `/export` with no parameters —
   *     every guest, unordered, saved as `guest-list.csv`;
   *   • a block inside the RSVPs tab hitting the same endpoint with
   *     `attending=true&sort=…` — a different file, from a button labelled the
   *     same way, sitting a few pixels away;
   *   • and nothing at all HERE, in the section that actually carries party
   *     sizes, meals, dietary notes, tables, sides and texting permission.
   *
   * So the two visible buttons quietly produced different files, and the list
   * with the detail in it could not be downloaded. Both scope choices are now
   * explicit inputs rather than hidden defaults.
   */
  const [exportOpen, setExportOpen] = useState(false);
  const [exportWho, setExportWho] = useState('all');
  const [exportSort, setExportSort] = useState('name');
  const [downloading, setDownloading] = useState(null); // 'csv' | 'excel' | null

  const handleDownload = useCallback(async (format) => {
    if (downloading) return;
    if (demoMode) { demoBlocked('Downloading the guest list'); return; }
    setDownloading(format);
    try {
      const path = format === 'excel' ? 'export-excel' : 'export';
      const qs = new URLSearchParams({ sort: exportSort });
      // Only sent when true — the endpoint reads `attending === 'true'`, so
      // sending `attending=false` would be indistinguishable from sending it.
      if (exportWho === 'attending') qs.set('attending', 'true');

      const res = await fetch(`${apiUrl}/events/${eventId}/rsvps/${path}?${qs}`, { credentials: 'include' });
      if (!res.ok) {
        // 403 is the tier gate (guest_export_csv / guest_export_excel are
        // separate features), and its message is the useful one.
        const msg = await res.json().then((d) => d?.message).catch(() => null);
        throw new Error(msg || 'Could not prepare the download.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const who = exportWho === 'attending' ? 'attending' : 'all-guests';
      a.download = `${who}-by-${exportSort}.${format === 'excel' ? 'xlsx' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // The export is capped server-side; the header says so when it bit.
      if (res.headers.get('X-Export-Truncated')) {
        toast(`Only the first ${res.headers.get('X-Export-Truncated')} guests are in this file.`, { icon: 'ℹ️' });
      }
    } catch (err) {
      toast.error(err.message || 'Could not prepare the download.');
    } finally {
      setDownloading(null);
    }
  }, [downloading, eventId, exportWho, exportSort, demoMode]);

  /**
   * Delete one guest.
   *
   * The confirmation NAMES them, and says what goes with them.
   *
   * It used to read "Are you sure you want to delete this guest?" — which, on a
   * two-column grid of visually similar cards reached by a 44px icon with no
   * label, is a dialog that cannot catch the mistake it exists to catch. If the
   * finger landed on the wrong card, nothing in the prompt would tell you.
   *
   * `guest` rather than `guestId`, because the name is the whole point.
   */
  /**
   * ASK, then delete — two steps, because the asking is now a real dialog.
   *
   * `window.confirm` blocked here until the rest of the dashboard had moved to
   * modals for every other destructive action. See ConfirmRemoveGuestModal for why
   * the native one had to go beyond consistency.
   */
  const askRemoveGuest = useCallback((guest) => {
    const guestId = typeof guest === 'string' ? guest : guest?.id;
    if (!guestId) return;
    setRemoving({
      id: guestId,
      name: (typeof guest === 'object' && guest?.guest_name) || '',
      partySize: (typeof guest === 'object' && guest?.party_size) || 1,
    });
  }, []);

  const handleDeleteGuest = useCallback(async (guestId) => {
    if (!guestId) return;
    if (demoMode) { demoBlocked('Removing a guest'); setRemoving(null); return; }
    setDeletingId(guestId);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/rsvps/${guestId}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || 'Delete failed');
      setRemoving(null);
      onRefresh?.();
    } catch (err) {
      toast.error(err.message || 'Failed to delete this guest. Please try again.');
      // The dialog stays open on failure: closing it would leave the error in a
      // toast with no way to retry the thing that produced it.
    } finally {
      setDeletingId(null);
    }
  }, [eventId, onRefresh, demoMode]);

  /**
   * COUNTS — every tile in the same unit, so the row adds up.
   *
   * ── The bug ──
   *
   * `total` summed `party_size` (PEOPLE) while accepted/declined/maybe/pending each
   * used `.length` (PARTIES). On a list of 120 people in 50 invitations the row read
   *
   *     Total Guests 120 · Accepted 40 · Declined 5 · Maybe 2 · Pending 3
   *
   * — four numbers that sum to 50 sitting under one that says 120, with nothing
   * anywhere naming the unit. Every tile is now counted BOTH ways: the headline is
   * people (the section is a guest list, and its total always said "Guests"), and
   * the party count rides underneath whenever the two differ.
   *
   * The four response states are mutually exclusive and exhaustive — `pending` is
   * the negation of the other three — so people across them sum exactly to `total`.
   *
   * `invited` is the exception and stays a PARTY count: an invitation goes to one
   * primary contact, not to each person in the family. Its tile says so.
   */
  const counts = useMemo(() => {
    const heads = (list) => list.reduce((sum, r) => sum + (r.party_size || 1), 0);

    const acceptedRsvps = rsvps.filter(r => isAccepted(r.response));
    const declinedRsvps = rsvps.filter(r => isDeclined(r.response));
    const maybeRsvps = rsvps.filter(r => isMaybe(r.response));
    const pendingRsvps = rsvps.filter(r => !isAccepted(r.response) && !isDeclined(r.response) && !isMaybe(r.response));
    const invitedRsvps = rsvps.filter(r => r.invitation_sent);

    return {
      total: heads(rsvps),
      accepted: heads(acceptedRsvps),
      declined: heads(declinedRsvps),
      maybe: heads(maybeRsvps),
      pending: heads(pendingRsvps),
      // One invitation per party, so this one is genuinely not a headcount.
      invited: invitedRsvps.length,
      seated: heads(acceptedRsvps.filter(r => r.tableId)),
      parties: {
        total: rsvps.length,
        accepted: acceptedRsvps.length,
        declined: declinedRsvps.length,
        maybe: maybeRsvps.length,
        pending: pendingRsvps.length,
      },
    };
  }, [rsvps]);

  const filtered = useMemo(() => {
    return rsvps.filter(r => {
      // Name, email, phone, meal, notes, side and every companion's name — see
      // matchesGuestSearch. It was name and email only.
      if (!matchesGuestSearch(r, search)) return false;

      switch (filter) {
        case 'attending': return isAccepted(r.response);
        case 'declined': return isDeclined(r.response);
        case 'maybe': return isMaybe(r.response);
        case 'pending': return !isAccepted(r.response) && !isDeclined(r.response) && !isMaybe(r.response);
        case 'seated': return isAccepted(r.response) && !!r.tableId;
        case 'unseated': return isAccepted(r.response) && !r.tableId;
        default: return true;
      }
    });
  }, [rsvps, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp rather than reset-via-effect: keeps this correct even when the list
  // shrinks out from under the current page (e.g. a delete or a data reload)
  // without a setState-in-effect render cascade.
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!eventId) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 24px', background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: '16px' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: `linear-gradient(135deg, ${COLORS.ivory}, ${COLORS.champagne}20)`, margin: '0 auto 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.champagne} strokeWidth="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        </div>
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 500, color: COLORS.charcoal, marginBottom: '8px' }}>No Event Selected</h3>
        <p style={{ fontSize: '13px', color: COLORS.stone, fontStyle: 'italic' }}>Select or create an event to manage guests.</p>
      </div>
    );
  }

  const inputStyle = {
    background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: '8px',
    padding: '9px 14px', fontSize: '12px', color: COLORS.charcoal, outline: 'none',
    fontFamily: 'var(--font-sans)', transition: 'border-color 0.25s ease',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 500, color: COLORS.charcoal, margin: 0 }}>Guest Management</h2>
          <p style={{ fontSize: '11px', color: COLORS.stone, fontFamily: 'var(--font-sans)', marginTop: '4px' }}>Manage your event&apos;s guest list, seating, and preferences</p>
        </div>
        {/*
          flexWrap is load-bearing: this row holds Import CSV, Download and
          Clear list. (It held a fourth, Add Guest, until that moved to
          Invitations & replies — the arithmetic below is quoted for four and is
          left as-is deliberately: it is the reason the property is here, and
          losing one button does not make wrapping optional. Three labels still
          sum past a 320px phone.)

          Without it the row cannot break, and a nowrap flex row's min-content is
          the SUM of its children: roughly 88 + 95 + 88 + 88 plus three 8px gaps,
          about 383px, inside the ~288px a 320px phone actually offers. The parent
          row above wraps, so the group dropped to its own line and then overflowed
          it anyway — and before overflowing, every label broke into two cramped
          lines because a button's min-content is only its longest single word.

          Wrapping makes the group's min-content max(children) ≈ 95px instead,
          which fits any phone with room to spare.
        */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {/**
            * "Add Guest" WAS HERE, and it has moved to Invitations & replies as
            * "Send an invitation".
            *
            * Its place and its name were both wrong. This section builds the list —
            * upload it, organise it, download it, clear it. Adding one person by
            * hand is not that: an organizer typing a single name and email is
            * inviting somebody, and the old button proved it by silently emailing
            * an invitation on submit while calling itself "Add Guest".
            *
            * So the act moved to the section about reaching people, and it is now
            * named after what it does. Bulk still starts here: upload the
            * spreadsheet, then tick and send from the other tab.
            */}
          <FeatureGate tierFeatures={tierFeatures} isPaid={isPaid} feature="import_guests_csv" onUpgrade={onUpgrade}>
          <button onClick={onOpenImport} style={{
            padding: '9px 18px', minHeight: 'var(--fx-touch)', background: COLORS.white, color: COLORS.stone, border: `1px solid ${COLORS.border}`,
            borderRadius: '8px', fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-sans)',
            cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.gold; e.currentTarget.style.color = COLORS.gold; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.stone; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import CSV
          </button>
          </FeatureGate>
          {/* Clearing the list, next to Import because that is the workflow it
              belongs to: export, edit, clear, re-import. Deliberately last, in
              plain red-on-white rather than a filled button — it must be
              findable without competing with Add Guest for a glance.

              Hidden on an empty list: an organizer who has not added anyone has
              nothing to clear, and offering a destructive action as one of three
              buttons on an empty screen is an invitation to explore it.

              NOT behind a FeatureGate. Every other button here is, because they
              add capability; removing your own data is not a paid feature, and
              gating it would mean a downgraded organizer could not clean up. */}
          {/* Download — beside Import, because they are the two halves of the
              same round trip, and an organizer looking for one is looking for
              the other. Hidden on an empty list: there is nothing to download. */}
          {rsvps.length > 0 && (
            <button onClick={() => setExportOpen(o => !o)} aria-expanded={exportOpen} style={{
              padding: '9px 18px', minHeight: 'var(--fx-touch)', background: COLORS.white, color: COLORS.stone, border: `1px solid ${COLORS.border}`,
              borderRadius: '8px', fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-sans)',
              cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.gold; e.currentTarget.style.color = COLORS.gold; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.stone; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Download list
            </button>
          )}
          {rsvps.length > 0 && (
            <button onClick={() => (demoMode ? demoBlocked('Clearing the guest list') : setClearOpen(true))} style={{
              padding: '9px 18px', minHeight: 'var(--fx-touch)', background: COLORS.white, color: '#C45E5E', border: '1px solid #FECACA',
              borderRadius: '8px', fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-sans)',
              cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.borderColor = '#C45E5E'; }}
              onMouseLeave={e => { e.currentTarget.style.background = COLORS.white; e.currentTarget.style.borderColor = '#FECACA'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Clear list
            </button>
          )}
          {/* "Send Invitations" was here too. It opened a modal that asked the
              organizer to pick an audience, search it, tick a consent box and
              choose a channel — four decisions to do the thing they had come to
              this screen to do.
              Sending now lives in the RSVPs tab, on the rows themselves: tick
              the guests, press Email or Text. This tab is for BUILDING the list;
              that one is for reaching it. */}
        </div>
      </div>

      {/* Where the button went. A pointer rather than silence, because anyone who
          used "Add Guest" will look here first — the same courtesy the RSVPs tab
          is shown for the download that moved the other way. */}
      <p style={{
        margin: 0, fontSize: 12, color: COLORS.stone, fontFamily: 'var(--font-sans)', lineHeight: 1.6,
      }}>
        Adding one guest? That is <strong style={{ color: COLORS.charcoal }}>Invitations &amp; replies</strong> →{' '}
        <a
          href={`/dashboard?tab=rsvps${eventId ? `&event=${eventId}` : ''}`}
          style={{ color: COLORS.gold, fontWeight: 700, textDecoration: 'underline' }}
        >
          Send an invitation
        </a>
        , which adds them and sends it in one step.
      </p>

      {/* ── Download panel ──
          Both choices are inputs, and the sentence says exactly what the file
          will contain — including the one thing that would otherwise surprise
          someone: it ignores the filter currently on screen. */}
      {exportOpen && rsvps.length > 0 && (
        <div style={{
          background: COLORS.white, border: `1px solid ${COLORS.border}`,
          borderRadius: 12, padding: '16px 18px', fontFamily: 'var(--font-sans)',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <select
              value={exportWho}
              onChange={e => setExportWho(e.target.value)}
              aria-label="Which guests to include"
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="all">Everyone on the list</option>
              <option value="attending">Only guests who accepted</option>
            </select>
            <select
              value={exportSort}
              onChange={e => setExportSort(e.target.value)}
              aria-label="Order of the downloaded list"
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="name">Ordered by name (A–Z)</option>
              <option value="table">Ordered by table</option>
            </select>

            {/* Two separate tier features server-side (guest_export_csv and
                guest_export_excel), so they are gated separately here too — one
                being locked must not imply the other is. */}
            <FeatureGate tierFeatures={tierFeatures} isPaid={isPaid} feature="guest_export_csv" onUpgrade={onUpgrade}>
              <button
                type="button"
                onClick={() => handleDownload('csv')}
                disabled={!!downloading}
                style={{
                  padding: '9px 18px', minHeight: 'var(--fx-touch)', borderRadius: 8, border: 'none',
                  background: COLORS.gold, color: COLORS.white,
                  fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
                  cursor: downloading ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                  opacity: downloading ? 0.7 : 1,
                }}
              >
                {downloading === 'csv' ? 'Preparing…' : 'Download CSV'}
              </button>
            </FeatureGate>
            <FeatureGate tierFeatures={tierFeatures} isPaid={isPaid} feature="guest_export_excel" onUpgrade={onUpgrade}>
              <button
                type="button"
                onClick={() => handleDownload('excel')}
                disabled={!!downloading}
                style={{
                  padding: '9px 18px', minHeight: 'var(--fx-touch)', borderRadius: 8,
                  border: `1px solid ${COLORS.border}`, background: COLORS.white,
                  color: COLORS.charcoal, fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
                  cursor: downloading ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                  opacity: downloading ? 0.7 : 1,
                }}
              >
                {downloading === 'excel' ? 'Preparing…' : 'Download Excel'}
              </button>
            </FeatureGate>
          </div>

          <p style={{ margin: '12px 0 0', fontSize: 12, color: COLORS.stone, lineHeight: 1.6 }}>
            Downloads your whole list — the search and filters above do not change the file.
            The <strong>CSV</strong> carries everything and imports straight back here, replies
            included. The <strong>Excel</strong> file is formatted for reading and printing, so
            re-importing it loses some detail.
          </p>
        </div>
      )}

      {/**
        * Stats Row — also the filter. Tapping a tile shows those guests;
        * tapping the active one again clears it.
        *
        * ON A PHONE these six tiles stack into six full-width cards, which is
        * most of a screen of counts sitting on top of the list they describe.
        * MobileDisclosure collapses them to the one line below and leaves the
        * grid exactly as it is at md and up — same markup, CSS decides.
        *
        * The summary states the headline number and the two counts an organizer
        * is actually chasing (who has said yes, who has not answered). The
        * filter is not lost: opening the disclosure gives back the tiles, which
        * ARE the filter.
        */}
      <MobileDisclosure
        label="Guest counts and filters"
        summary={
          <>
            <strong style={{ fontWeight: 800 }}>{counts.total}</strong> {counts.total === 1 ? 'guest' : 'guests'}
            {' · '}{counts.accepted} accepted
            {counts.pending > 0 && <>{' · '}{counts.pending} not replied</>}
          </>
        }
      >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        {[
          { key: 'all', label: 'Total Guests', value: counts.total, sub: partySub(counts.parties.total, counts.total), accent: COLORS.gold,
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> },
          // No filter for this one: "invitations sent" is a delivery fact, not a
          // slice of the list, and the filter has no equivalent. Left inert
          // rather than inventing a category that would not match the dropdown
          // this replaces.
          { key: null, label: 'Invitations Sent', value: counts.invited, sub: 'one per invitation', accent: '#0EA5E9',
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
          { key: 'attending', label: 'Accepted', value: counts.accepted, sub: partySub(counts.parties.accepted, counts.accepted), accent: '#22C55E',
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7"/></svg> },
          { key: 'declined', label: 'Declined', value: counts.declined, sub: partySub(counts.parties.declined, counts.declined), accent: '#C45E5E',
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> },
          { key: 'maybe', label: 'Maybe', value: counts.maybe, sub: partySub(counts.parties.maybe, counts.maybe), accent: '#6366F1',
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
          { key: 'pending', label: 'Pending', value: counts.pending, sub: partySub(counts.parties.pending, counts.pending), accent: '#77736A',
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
        ].map((t, i) => (
          <StatMini
            key={t.key || `stat-${i}`}
            accent={t.accent}
            value={t.value}
            label={t.label}
            icon={t.icon}
            sub={t.sub}
            active={!!t.key && filter === t.key && t.key !== 'all'}
            title={t.key ? `Show only ${t.label.toLowerCase()}` : undefined}
            onClick={t.key
              ? () => { setFilter(filter === t.key ? 'all' : t.key); setPage(1); }
              : undefined}
          />
        ))}
      </div>
      </MobileDisclosure>

      {/* Search stays visible at every width. It is how you FIND content, not
          chrome describing it — collapsing it would be the one thing on this
          screen worth a permanent slot. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.stone} strokeWidth="2" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text" placeholder="Search name, email or phone..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ ...inputStyle, width: '100%', paddingLeft: '34px' }}
            onFocus={e => { e.target.style.borderColor = COLORS.gold; }}
            onBlur={e => { e.target.style.borderColor = COLORS.border; }}
          />
        </div>
        {/* Seated/Unseated stay here rather than becoming tiles: they are about
            the seating chart rather than about replies, and a seventh and eighth
            tile would bury the six that answer "how is my list doing". */}
        <select
          value={['seated', 'unseated'].includes(filter) ? filter : ''}
          onChange={e => { setFilter(e.target.value || 'all'); setPage(1); }}
          aria-label="Filter by seating"
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="">Any seating</option>
          <option value="seated">Seated only</option>
          <option value="unseated">Not seated yet</option>
        </select>
        <span style={{ fontSize: '11px', color: COLORS.stone, fontFamily: 'var(--font-sans)' }}>
          {filtered.length} of {rsvps.length} shown
        </span>
        {(search || filter !== 'all') && (
          <button
            type="button"
            onClick={() => { setSearch(''); setFilter('all'); setPage(1); }}
            style={{
              padding: '7px 12px', minHeight: 'var(--fx-touch)', borderRadius: 8, border: `1px solid ${COLORS.border}`,
              background: COLORS.white, color: COLORS.stone, cursor: 'pointer',
              fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Guest Cards Grid */}
      {filtered.length === 0 ? (
        /**
         * Two genuinely different empties, and they used to share one sentence.
         *
         * "No guests added yet." in grey italic, with no action, was what a brand
         * new organizer saw on the screen whose entire purpose is adding guests —
         * while the two buttons that do it sat in the page header, above and away
         * from where the eye lands. The filtered-to-nothing case is a different
         * problem with a different fix (clear the filter), and saying the same
         * thing for both left each one unanswered.
         */
        rsvps.length === 0 ? (
          <div style={{
            padding: '44px 28px', background: COLORS.white,
            border: `1px solid ${COLORS.border}`, borderRadius: '12px',
            fontFamily: 'var(--font-sans)', textAlign: 'center',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.champagne} strokeWidth="1.4" style={{ margin: '0 auto 16px', display: 'block' }}>
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" />
            </svg>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: COLORS.charcoal }}>
              No guests yet
            </h3>
            <p style={{ margin: '8px auto 0', maxWidth: 430, fontSize: 13.5, lineHeight: 1.65, color: COLORS.stone }}>
              Upload a list you already have. A spreadsheet can carry names, contacts, party
              sizes and sides — and if you export from here later, that file imports straight
              back with the replies included.
            </p>
            {/* Gated exactly as the header button is. Ungated, this would open a
                modal whose submit comes back 403 — a dead end reached by following
                the screen's own primary instruction. FeatureGate shows the lock and
                explains the tier instead.

                The second button here was "Add a guest". It is now the secondary
                link below, pointing at Invitations & replies where that act lives —
                on an empty guest list, uploading is the thing worth a filled
                button, and inviting one person is worth a sentence. */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 22 }}>
              <FeatureGate tierFeatures={tierFeatures} isPaid={isPaid} feature="import_guests_csv" onUpgrade={onUpgrade}>
                <button
                  type="button"
                  onClick={onOpenImport}
                  style={{
                    padding: '11px 22px', borderRadius: 30, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #D7BE80 0%, #B8944F 100%)',
                    color: COLORS.white, fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    boxShadow: '0 4px 15px rgba(184, 148, 79, 0.25)',
                  }}
                >
                  Upload a list
                </button>
              </FeatureGate>
            </div>
            <p style={{ margin: '14px 0 0', fontSize: 12.5, color: COLORS.stone, lineHeight: 1.6 }}>
              Just one person?{' '}
              <a
                href={`/dashboard?tab=rsvps${eventId ? `&event=${eventId}` : ''}`}
                style={{ color: COLORS.gold, fontWeight: 700, textDecoration: 'underline' }}
              >
                Send them an invitation
              </a>
              {' '}— it adds them here at the same time.
            </p>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '48px 24px', background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: '12px' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.border} strokeWidth="1.5" style={{ margin: '0 auto 16px', display: 'block' }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <p style={{ color: COLORS.stone, fontSize: '13.5px', fontFamily: 'var(--font-sans)', margin: 0 }}>
              None of your {rsvps.length} guests match this search or filter.
            </p>
            <button
              type="button"
              onClick={() => { setSearch(''); setFilter('all'); setPage(1); }}
              style={{
                marginTop: 16, padding: '9px 18px', minHeight: 'var(--fx-touch)', borderRadius: 8,
                border: `1px solid ${COLORS.border}`, background: COLORS.white,
                color: COLORS.charcoal, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)',
              }}
            >
              Show all guests
            </button>
          </div>
        )
      ) : (
        <>
          <div className="guests-cards-grid" style={{ display: 'grid', gap: '12px' }}>
            {paginated.map(guest => (
              <GuestCard
                key={guest.id} guest={guest} tables={tables} onAssignTable={onAssignTable}
                customFields={customFields} event={event}
                onEdit={demoMode ? () => demoBlocked('Editing a guest') : setEditingGuest} onDelete={askRemoveGuest} deleting={deletingId === guest.id}
              />
            ))}
          </div>
          <style jsx>{`
            .guests-cards-grid { grid-template-columns: repeat(2, 1fr); }
            @media (max-width: 639.98px) {
              .guests-cards-grid { grid-template-columns: 1fr; }
            }
          `}</style>

          {totalPages > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} style={{
                padding: '6px 12px', minHeight: 'var(--fx-touch)', borderRadius: '6px', border: `1px solid ${COLORS.border}`, background: COLORS.white,
                color: safePage === 1 ? COLORS.border : COLORS.charcoal, fontSize: '12px', fontFamily: 'var(--font-sans)',
                cursor: safePage === 1 ? 'default' : 'pointer',
              }}>‹ Prev</button>
              <span style={{ fontSize: '12px', color: COLORS.stone, fontFamily: 'var(--font-sans)', padding: '0 8px' }}>
                Page {safePage} of {totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={{
                padding: '6px 12px', minHeight: 'var(--fx-touch)', borderRadius: '6px', border: `1px solid ${COLORS.border}`, background: COLORS.white,
                color: safePage === totalPages ? COLORS.border : COLORS.charcoal, fontSize: '12px', fontFamily: 'var(--font-sans)',
                cursor: safePage === totalPages ? 'default' : 'pointer',
              }}>Next ›</button>
            </div>
          )}
        </>
      )}

      {/**
        * BELOW THE LIST, deliberately — both of these used to sit above it.
        *
        * The SMS banner answers "can I reach these people?" and the sheet guide
        * answers "how do I build a file?". Both are real, and neither is what an
        * organizer opened Guest list to look at. Above the fold they cost two
        * screens of scrolling on a phone before the first guest appeared.
        *
        * They keep their place in the reading order — an organizer who scrolls
        * to the end of their list finds the two things they might do next — and
        * on a desktop, where vertical room is not scarce, the move is barely
        * noticeable.
        */}
      <SmsBalanceBanner
        active={smsAddonActive}
        remaining={smsRemaining}
        purchased={smsPurchased}
        coverage={smsCoverage}
        topUpHref="/dashboard/campaigns"
      />

      <GuestSheetGuide
        event={event}
        tables={tables}
        customFields={customFields}
        onOpenImport={onOpenImport}
      />

      <EditGuestModal
        isOpen={!!editingGuest}
        onClose={() => setEditingGuest(null)}
        eventId={eventId}
        event={event}
        customFields={customFields}
        rsvp={editingGuest}
        onGuestUpdated={onRefresh}
      />
      {removing && (
        <ConfirmRemoveGuestModal
          guestName={removing.name}
          partySize={removing.partySize}
          busy={deletingId === removing.id}
          onCancel={() => setRemoving(null)}
          onConfirm={() => handleDeleteGuest(removing.id)}
        />
      )}

      {/* Mounted only while open, so each visit starts with an empty
          confirmation box — see the note in the component. */}
      {clearOpen && (
        <ClearGuestListModal
          onClose={() => setClearOpen(false)}
          eventId={eventId}
          onCleared={(message) => { toast.success(message); onRefresh?.(); }}
        />
      )}
    </div>
  );
}
