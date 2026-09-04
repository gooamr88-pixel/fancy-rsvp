'use client';
import { toast } from '../../utils/toast';
import React, { useState, useMemo, useCallback } from 'react';
import { smsReachability, countReachable } from '../../utils/smsReachability';
import { isAccepted, isDeclined } from '../../utils/responseHelpers';
import { matchesGuestSearch } from '../../utils/guestSearch';
import EditGuestModal from './EditGuestModal';
import SmsBalanceBanner from './SmsBalanceBanner';
import GuestSendMenu from './GuestSendMenu';
import ConfirmBulkTextModal from './ConfirmBulkTextModal';
import ConfirmRemoveGuestModal from './ConfirmRemoveGuestModal';
import SendInvitationModal from './SendInvitationModal';
import FeatureGate from './FeatureGate';
import { PlanLockBadge, plansSentence } from './PlanLock';
import MobileDisclosure from './MobileDisclosure';
import { useOrganizerTimeZone } from './OrganizerClock';
import { formatTimestamp } from '../../utils/timezone';

const COLORS = {
  gold: '#B8944F',
  goldHover: '#a6833f',
  charcoal: '#191B1E',
  ivory: '#F8F4EC',
  champagne: '#D7BE80',
  stone: '#77736A',
  border: '#E8E2D6',
  white: '#FFFFFF',
  softBg: '#FAFAF8',
  rose: '#C45E5E',
  roseLight: '#FDF2F2',
  greenLight: '#F0FAF0',
  greenDark: '#3D7A3D',
  champagneLight: '#FFF9EE',
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

const PAGE_SIZE = 10;

/* ── tiny SVG icons ─────────────────────────────────────────── */
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.stone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const TrashIcon = ({ color = COLORS.stone }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const PencilIcon = ({ color = COLORS.stone }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const EmptyIcon = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={COLORS.border} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
);

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={COLORS.stone} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, pointerEvents: 'none' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/* ── helpers ─────────────────────────────────────────────────── */
function isPending(response) {
  return !isAccepted(response) && !isDeclined(response);
}

// When a reply arrived, on the organizer's clock and labelled with it. Takes
// the zone as an argument because hooks cannot be called from a module-level
// helper — the component resolves it once and passes it down.
function formatTime(ts, timeZone) {
  return formatTimestamp(ts, timeZone) || '—';
}

function responseBadge(response) {
  if (isAccepted(response)) return { label: 'Accepted', bg: COLORS.greenLight, color: COLORS.greenDark, dot: COLORS.greenDark };
  if (isDeclined(response)) return { label: 'Declined', bg: COLORS.roseLight, color: COLORS.rose, dot: COLORS.rose };
  return { label: 'Pending', bg: COLORS.ivory, color: COLORS.stone, dot: COLORS.champagne };
}

/* ── sub-components ──────────────────────────────────────────── */

/**
 * A count, and the filter for it.
 *
 * ── Two problems, one fix ──
 *
 * These were four inert numbers sitting directly above a <select> offering the
 * same four categories by the same names — so reading "Declined 12" and wanting to
 * see those twelve meant looking away and re-picking the word you were already
 * looking at. Same duplication the Guest list had.
 *
 * ── And the unit ──
 *
 * "Total Responses" here counted PARTIES while "Total Guests" in the Guest list
 * counted PEOPLE. Two sections, similar labels, different units, and a family of
 * four is one of the first and four of the second — so the two screens appeared to
 * contradict each other and neither said which it meant. `people` is now shown
 * underneath whenever it differs from the party count.
 */
const SummaryCard = React.memo(function SummaryCard({ count, people, label, accent, active, onClick, title }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: '1 1 0',
        minWidth: 140,
        textAlign: 'left',
        font: 'inherit',
        background: active ? `${accent}0F` : COLORS.white,
        border: `1px solid ${active ? accent : COLORS.border}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: '20px 24px',
        transition: 'all 0.3s ease',
        boxShadow: active ? `0 2px 10px ${accent}22` : hovered ? '0 8px 24px rgba(0,0,0,0.06)' : 'none',
        transform: hovered && !active ? 'translateY(-2px)' : 'translateY(0)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{
        display: 'block',
        fontSize: 28,
        fontWeight: 700,
        color: COLORS.charcoal,
        fontFamily: 'var(--font-sans)',
        letterSpacing: '-0.5px',
      }}>{count}</span>
      <span style={{
        display: 'block',
        fontSize: 'var(--fx-micro)',
        fontWeight: 700,
        color: active ? accent : COLORS.stone,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginTop: 6,
        fontFamily: 'var(--font-sans)',
      }}>{label}</span>
      {/* Only when it differs — on a list of solo guests the two numbers are the
          same and repeating it would be noise. */}
      {typeof people === 'number' && people !== count && (
        <span style={{
          display: 'block', fontSize: 11, color: COLORS.stone,
          marginTop: 3, fontFamily: 'var(--font-sans)', fontWeight: 500,
        }}>
          {people} {people === 1 ? 'person' : 'people'}
        </span>
      )}
    </button>
  );
});

/**
 * A labelled cluster of bulk sends, with the price stated once for the cluster.
 *
 * The heading is what lets the buttons inside be short. "Invitation" and "All
 * their details" are unambiguous under "By text message"; spelled out on every
 * button they would be four long labels repeating the same two words.
 */
function BulkGroup({ heading, note, noteColor, badge, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontSize: 'var(--fx-micro)', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
          color: COLORS.stone, fontFamily: 'var(--font-sans)',
        }}>{heading}</span>
        {/* A badge replaces the note rather than sitting beside it: the price of
            a balance is irrelevant to somebody who cannot buy one. */}
        {badge || (note ? (
          <span style={{ fontSize: 'var(--fx-micro)', fontWeight: 700, color: noteColor, fontFamily: 'var(--font-sans)' }}>
            {note}
          </span>
        ) : null)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </div>
  );
}

function BulkButton({ primary, busy, disabled, onClick, label, busyLabel, title }) {
  const dead = disabled && !busy;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      style={{
        padding: '9px 16px', minHeight: 'var(--fx-touch)', borderRadius: 9,
        border: primary ? 'none' : `1px solid ${COLORS.border}`,
        background: dead ? '#EFECE5'
          : primary ? 'linear-gradient(135deg, #D7BE80 0%, #B8944F 100%)' : COLORS.white,
        color: dead ? '#9A958B' : primary ? COLORS.white : COLORS.charcoal,
        fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
        cursor: busy ? 'wait' : dead ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {busy ? busyLabel : label}
    </button>
  );
}

/* ── main component ──────────────────────────────────────────── */
export default function RSVPsTab({
  rsvps = [], eventId, event, customFields, onRefresh,
  smsAddonActive = false, smsMaxPerSend = 0, onBuySms,
  /* Plan-level SMS access — see the note on dashboard/page.js's smsAddon state.
     Threaded to every send surface so "your plan does not include texting" and
     "you have not bought messages yet" stay distinguishable at the point of use:
     they lead to different screens, and offering a purchase to somebody whose
     plan forbids texting sends them to a checkout that refuses them. */
  smsAccess = 'granted', plansWithSms = [], onUpgradePlan,
  // Derived once: the bulk bar and both send menus must agree on why texting is
  // unavailable, or the same event tells the organizer two different stories
  // depending on whether they selected one guest or twenty.
  smsPlanLocked = smsAccess === 'locked',
  // Balance figures for the banner. Supplied by the dashboard, which already
  // holds them for the sidebar — refetching here would put a second, slightly
  // different number on the same screen as the first.
  smsRemaining = 0, smsPurchased = 0, smsCoverage = null,
  // Adding one guest by hand is a paid feature (`add_guest_manual`), and it now
  // lives in this section — so this tab needs the tier context the Guest list
  // already had. Ungated, the button would open a modal whose submit comes back
  // 403 after the organizer has typed everything in.
  isPaid = false, tierFeatures, onUpgrade,
}) {
  const [search, setSearch] = useState('');
  // The one-guest send. Mounted only while open so each visit starts empty —
  // same reasoning as ClearGuestListModal.
  const [inviteOpen, setInviteOpen] = useState(false);
  /**
   * Whether the four bulk sends are showing. PHONE ONLY — at md and up the CSS
   * forces the panel open regardless, so this value is simply not consulted.
   *
   * Collapsed by default: the bar is pinned above the nav bar on a phone, and
   * expanded it is ~330px of a ~667px screen. The organizer needs to see the
   * guests they are ticking.
   */
  const [sendOpen, setSendOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState(null);
  const [resending, setResending] = useState(null); // `${rsvpId}:${type}` while a resend is in flight
  // `${rsvpId}:invite-${channel}` or `bulk:${channel}` while an invitation send
  // is in flight. Separate from `resending` so a per-guest spinner and a bulk
  // send can never disable each other's button.
  const [sending, setSending] = useState(null);
  const [editingGuest, setEditingGuest] = useState(null);
  // The guest awaiting removal, captured when the row button was pressed.
  const [removing, setRemoving] = useState(null);

  // Party ids the organizer has ticked. A Set because every operation here is a
  // membership test, and the list can run to thousands of guests.
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  /* counts */
  /**
   * Counts in BOTH units.
   *
   * A "response" is one party; a family of four is one of them and four people. The
   * Guest list section counts people, this one counted parties, and neither said
   * so — so the two screens looked like they disagreed. Both numbers are computed
   * here and the card shows the second one underneath whenever it differs.
   */
  const counts = useMemo(() => {
    const heads = (list) => list.reduce((sum, r) => sum + (r.party_size || 1), 0);
    const acceptedList = rsvps.filter(r => isAccepted(r.response));
    const declinedList = rsvps.filter(r => isDeclined(r.response));
    const pendingList = rsvps.filter(r => isPending(r.response));
    return {
      total: rsvps.length,
      accepted: acceptedList.length,
      declined: declinedList.length,
      pending: pendingList.length,
      people: {
        total: heads(rsvps),
        accepted: heads(acceptedList),
        declined: heads(declinedList),
        pending: heads(pendingList),
      },
    };
  }, [rsvps]);

  /* filtered + sorted */
  const processed = useMemo(() => {
    let list = [...rsvps];

    // search
    if (search.trim()) {
      // Name, email, PHONE, meal, notes, side and every companion name — the
      // same helper the Guest list uses, so the two searches cannot drift.
      list = list.filter((r) => matchesGuestSearch(r, search));
    }

    // filter
    if (filter === 'attending') list = list.filter(r => isAccepted(r.response));
    else if (filter === 'declined') list = list.filter(r => isDeclined(r.response));
    else if (filter === 'pending') list = list.filter(r => isPending(r.response));

    // sort
    if (sort === 'newest') list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    else if (sort === 'oldest') list.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    else if (sort === 'az') list.sort((a, b) => (a.guest_name || '').localeCompare(b.guest_name || ''));
    else if (sort === 'za') list.sort((a, b) => (b.guest_name || '').localeCompare(a.guest_name || ''));

    return list;
  }, [rsvps, search, filter, sort]);

  // Reset page when filters change — adjusted during render (like
  // RsvpWizard's prevLangParam) rather than in an effect, since this is a
  // "reset paginator when the filter key changes" case, and `page` is
  // otherwise independently mutable via the pager buttons below.
  const filterKey = `${search}|${filter}|${sort}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
  const paginated = processed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* ── Selection ──────────────────────────────────────────────────────────
     Everything below is derived from the CURRENT filter, not the whole list.
     Acting on what you are looking at is the entire point of selecting here —
     a "select all" that silently included rows a filter had hidden would send
     messages the organizer never saw. */
  const toggleOne = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const visibleIds = useMemo(() => processed.map((r) => r.id), [processed]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everySelected = visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
      // Only the rows the filter is currently showing are affected — a selection
      // made under a different filter is left alone rather than wiped.
      if (everySelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }, [visibleIds]);

  // Closes the send panel with the selection. The whole bar unmounts when the
  // selection empties, so a stale `true` would re-open it expanded the next
  // time somebody ticked a single guest — 330px of panel for one name.
  const clearSelection = useCallback(() => { setSelectedIds(new Set()); setSendOpen(false); }, []);

  // Resolved against the FULL list, so a selection survives changing the filter.
  const selectedGuests = useMemo(
    () => rsvps.filter((r) => selectedIds.has(r.id)),
    [rsvps, selectedIds],
  );
  const reach = useMemo(() => countReachable(selectedGuests), [selectedGuests]);

  // Warn before opening rather than after sending: the ramp-up cap is enforced
  // server-side and would otherwise surface as a 429 at the end of the flow.
  const overSendLimit = smsMaxPerSend > 0 && reach.reachable > smsMaxPerSend;

  /**
   * The entry-pass and details sends only apply to guests who ACCEPTED.
   *
   * signQrTicketForResponse mints nothing for a maybe or a no, and there is no
   * table or meal to report for them either — so the server refuses those rows.
   * Counting them here means the button says how many it will actually reach
   * instead of promising the whole selection and quietly skipping most of it.
   */
  const attendingSelectedIds = useMemo(
    () => selectedGuests.filter((g) => isAccepted(g.response)).map((g) => g.id),
    [selectedGuests],
  );
  const attendingSelected = attendingSelectedIds.length;
  const detailReachable = useMemo(
    () => selectedGuests.filter((g) => isAccepted(g.response) && smsReachability(g).reachable).length,
    [selectedGuests],
  );

  /* Downloading the guest list moved to GuestsTab — see the pointer in the
     toolbar below for why. */

  /* resend confirmation or QR-ticket email */
  const handleResend = useCallback(async (rsvpId, type) => {
    const endpoint = type === 'qr' ? 'send-qr-ticket' : 'send-confirmation';
    setResending(`${rsvpId}:${type}`);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/notifications/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rsvpId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || 'Failed to send email.');
      }
      toast.success(type === 'qr' ? 'QR ticket email sent.' : 'Confirmation email sent.');
    } catch (err) {
      toast.error(err.message || 'Failed to send email.');
    } finally {
      setResending(null);
    }
  }, [eventId]);

  /**
   * Send the INVITATION to a set of guests, by one channel.
   *
   * The one send path in this tab, used by both the bulk bar and the per-guest
   * buttons — a bulk send is just this with more ids. The modal that used to sit
   * between the organizer and this call is gone: it asked them to pick an
   * audience and tick a consent box they had already answered per guest, which
   * was three screens of friction in front of a decision they had already made
   * by ticking the rows.
   *
   * `channel` is the only discriminator; the server picks the wording. There is
   * no message box anywhere in this flow, deliberately — see the note on the
   * invitations route.
   */
  const handleSendInvitations = useCallback(async (partyIds, channel, smsType = null) => {
    const ids = Array.isArray(partyIds) ? partyIds : [partyIds];
    if (ids.length === 0) return;

    /* The spinner key has to include smsType. Four of the menu's items are
       channel 'sms' now and differ only by type, so keying on the channel alone
       would spin every one of their buttons when any one was pressed. */
    const what = smsType ? `${channel}:${smsType}` : channel;
    const key = ids.length === 1 ? `${ids[0]}:${what}` : `bulk:${what}`;
    setSending(key);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/invitations/send`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // smsType omitted entirely when absent, so the server keeps applying
        // its own default rather than being handed an explicit null.
        body: JSON.stringify({ channel, partyIds: ids, ...(smsType ? { smsType } : {}) }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success === false) {
        throw new Error(data.message || 'Could not send the invitations.');
      }

      const d = data.data || data;
      // The server already grouped skip reasons into plain sentences. Surfacing
      // them is the difference between "12 of 15 sent" — which reads as a fault —
      // and "3 haven't agreed to receive texts", which reads as a fact the
      // organizer can act on.
      toast.success(d.message || `Invitation sent to ${d.sent ?? ids.length}.`);
      if (Array.isArray(d.breakdown) && d.breakdown.length > 0) {
        const worst = d.breakdown[0];
        toast(`${worst.count} not sent — ${worst.message.toLowerCase()}.`, { icon: 'ℹ️' });
      }
      onRefresh?.();
    } catch (err) {
      toast.error(err.message || 'Could not send the invitations.');
    } finally {
      setSending(null);
    }
  }, [apiUrl, eventId, onRefresh]);

  /**
   * ONE entry point for everything the Send menu can do to one guest.
   *
   * The four channels do not all reach the same endpoint — `qr` is an email sent by
   * the notifications route, the other three go through invitations/send — and the
   * menu has no business knowing that. It says which of the four things the
   * organizer picked; this decides how it gets sent.
   *
   * Without this the menu would have had to hold two different fetch shapes and
   * two different in-flight key formats, which is how the two spinners drifted
   * apart in the first place.
   */
  /**
   * `sel` is `{ channel, smsType }` from GuestSendMenu.
   *
   * It was a bare channel string, which stopped being enough when the menu grew
   * items that share a channel and differ only by message type. A string is
   * still accepted so nothing that calls this with one breaks mid-refactor.
   */
  const handleSendGuest = useCallback((rsvpId, sel) => {
    const { channel, smsType } = typeof sel === 'string' ? { channel: sel, smsType: null } : (sel || {});
    if (channel === 'qr') return handleResend(rsvpId, 'qr');
    return handleSendInvitations([rsvpId], channel, smsType);
  }, [handleResend, handleSendInvitations]);

  /**
   * The confirmation that stands between a click and a bill.
   *
   * Held here rather than inside the dialog so the dialog stays a pure renderer of
   * "you are about to send X to N guests" — and so a stale open dialog cannot fire
   * against a selection that has since changed: the ids are captured at the moment
   * the button was pressed, not read back when Send is clicked.
   */
  const [bulkAsk, setBulkAsk] = useState(null); // { channel, ids, reachable }

  // A plain function, not a useCallback. It is only ever called from inline
  // onClick handlers in this component's own JSX — nothing memoized receives it,
  // so wrapping it bought nothing and the React Compiler rejected the memo it
  // could not preserve.
  const askBulkSms = (channel, ids, reachable) => {
    if (!ids || ids.length === 0 || reachable === 0) return;
    setBulkAsk({ channel, ids, reachable });
  };

  /**
   * ASK, then delete.
   *
   * This used `window.confirm('Are you sure you want to delete this RSVP?')` — no
   * name, no party size, nothing identifying the row. On a paginated table reached
   * by a small icon, a prompt that cannot say WHICH guest is a prompt that cannot
   * catch a misclick, which is the only reason it exists. Shares
   * ConfirmRemoveGuestModal with the Guest list so both ask the same question the
   * same way.
   */
  const askRemove = useCallback((rsvp) => {
    if (!rsvp?.id) return;
    setRemoving({ id: rsvp.id, name: rsvp.guest_name || '', partySize: rsvp.party_size || 1 });
  }, []);

  const handleDelete = useCallback(async (rsvpId) => {
    if (!rsvpId) return;
    setDeletingId(rsvpId);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/rsvps/${rsvpId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      setRemoving(null);
      onRefresh?.();
    } catch (err) {
      console.error('Delete RSVP error:', err);
      // The dialog stays open on failure — closing it would leave the error in a
      // toast with no way to retry the thing that caused it.
      toast.error('Failed to remove this guest. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }, [eventId, onRefresh]);

  /* shared input / select style */
  const inputStyle = {
    padding: '9px 14px',
    fontSize: 13,
    fontFamily: 'var(--font-sans)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    outline: 'none',
    background: COLORS.white,
    color: COLORS.charcoal,
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  };

  const selectWrapStyle = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/**
        * ── Header ───────────────────────────────────────────
        *
        * This section had no heading at all, while Guest list next door had one —
        * so the two halves of the same workflow looked like a titled screen and an
        * untitled fragment. It also had no way IN: you could only reach people who
        * were already on the list, put there from another section.
        *
        * "Send an invitation" is the button that used to read "Add Guest" in Guest
        * list. It moved because that is what it does: it takes a name and an
        * address and sends that person their invitation. Naming it after the
        * bookkeeping side-effect rather than the act hid the send completely —
        * organizers pressed "Add Guest" and had no idea an email had gone out.
        */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 500, color: COLORS.charcoal, margin: 0 }}>
            Invitations &amp; replies
          </h2>
          <p style={{ fontSize: 11.5, color: COLORS.stone, fontFamily: 'var(--font-sans)', marginTop: 4, lineHeight: 1.6 }}>
            Invite one guest at a time, or tick several below and send to them together.
          </p>
        </div>
        <FeatureGate tierFeatures={tierFeatures} isPaid={isPaid} feature="add_guest_manual" onUpgrade={onUpgrade}>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            style={{
              padding: '10px 18px', background: COLORS.gold, color: COLORS.white, border: 'none',
              borderRadius: 8, fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
              cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 7,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = COLORS.goldHover; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = COLORS.gold; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            Send an invitation
          </button>
        </FeatureGate>
      </div>

      {/**
        * ── Summary Bar — and the filter. Tap a card to see those guests; tap the
        * active one again to clear it. The `<select>` that used to duplicate
        * these four categories underneath is gone.
        *
        * Collapsed to one line on a phone, where four full-width cards plus the
        * SMS banner put the first reply most of a screen down. The cards ARE the
        * filter, so nothing is lost by opening the disclosure to reach them.
        *
        * The SMS banner that used to sit above this has moved below the list —
        * see the note there. Its own comment claimed it had to be "above
        * everything" because the question is asked while looking at the list;
        * that is an argument for it being ON this screen, which it still is, not
        * for it being the first thing between the organizer and their replies.
        */}
      <MobileDisclosure
        label="Reply counts and filters"
        summary={
          <>
            <strong style={{ fontWeight: 800 }}>{counts.total}</strong> {counts.total === 1 ? 'reply' : 'replies'}
            {' · '}{counts.accepted} accepted
            {counts.pending > 0 && <>{' · '}{counts.pending} pending</>}
          </>
        }
      >
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'Total Responses', n: counts.total, people: counts.people.total, accent: COLORS.stone },
          { key: 'attending', label: 'Accepted', n: counts.accepted, people: counts.people.accepted, accent: COLORS.gold },
          { key: 'declined', label: 'Declined', n: counts.declined, people: counts.people.declined, accent: COLORS.rose },
          { key: 'pending', label: 'Pending', n: counts.pending, people: counts.people.pending, accent: COLORS.champagne },
        ].map((c) => (
          <SummaryCard
            key={c.key}
            count={c.n}
            people={c.people}
            label={c.label}
            accent={c.accent}
            active={filter === c.key && c.key !== 'all'}
            title={c.key === 'all' ? 'Show everyone' : `Show only ${c.label.toLowerCase()}`}
            onClick={() => { setFilter(filter === c.key ? 'all' : c.key); setPage(1); }}
          />
        ))}
      </div>
      </MobileDisclosure>

      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        background: COLORS.white,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: '16px 20px',
      }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
            <SearchIcon />
          </div>
          <input
            type="text"
            placeholder="Search name, email or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '100%', paddingLeft: 36 }}
            onFocus={e => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = `0 0 0 3px ${COLORS.ivory}`; }}
            onBlur={e => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        {/* The response filter used to be a <select> here, offering the same four
            categories as the four cards above it under the same four names. The
            cards are the filter now; a second control for the same choice only
            made it possible for them to disagree. */}

        {/* Sort */}
        <div style={selectWrapStyle}>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            style={{ ...inputStyle, paddingRight: 30, appearance: 'none', cursor: 'pointer', minWidth: 140 }}
            onFocus={e => { e.target.style.borderColor = COLORS.gold; }}
            onBlur={e => { e.target.style.borderColor = COLORS.border; }}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="az">Name A–Z</option>
            <option value="za">Name Z–A</option>
          </select>
          <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex' }}>
            <ChevronDown />
          </div>
        </div>

        {/**
          * Downloading moved to the Guest list section.
          *
          * It lived here as a sort selector plus two buttons, hitting the export
          * endpoints with `attending=true` — while the page header rendered a
          * third button hitting the same endpoint with no parameters at all. Two
          * visibly similar controls, two different files, no way to tell which
          * was which until you opened them.
          *
          * This section is about REACHING the list; the list itself — and every
          * column an export contains — belongs to Guest list. A pointer rather
          * than silence, because anyone who used the old buttons will look here
          * first.
          */}
        <span style={{ fontSize: 12, color: COLORS.stone, fontFamily: 'var(--font-sans)' }}>
          Need a spreadsheet? It’s in <strong style={{ color: COLORS.charcoal }}>Guest list</strong> → Download list.
        </span>
      </div>

      {/* ── Table / Empty ────────────────────────────────────── */}
      {processed.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '64px 24px',
          background: COLORS.white,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
        }}>
          <EmptyIcon />
          {/* It said "Share your invitation link to start collecting responses"
              and then offered no link and no button — an instruction with nothing
              to act on. Both empties now end in the thing to do next. */}
          <p style={{
            marginTop: 20,
            fontSize: 14.5,
            color: COLORS.stone,
            fontFamily: 'var(--font-sans)',
            textAlign: 'center',
            maxWidth: 420,
            lineHeight: 1.65,
            margin: '20px auto 0',
          }}>
            {rsvps.length === 0
              ? 'Nobody has been invited yet. Send one guest their invitation to start — or upload a whole list from Guest list, then tick and send from here.'
              : `None of your ${rsvps.length} guests match this search or filter.`}
          </p>
          {/**
            * The empty state now DOES the thing instead of pointing elsewhere.
            *
            * It used to send the organizer to Guest list, because that is where
            * adding lived. Adding lives here now, so the button that used to be a
            * redirect is the actual action — and the gate matches the header's, so
            * a locked plan shows the lock rather than a modal that 403s on submit.
            */}
          {rsvps.length === 0 ? (
            <FeatureGate tierFeatures={tierFeatures} isPaid={isPaid} feature="add_guest_manual" onUpgrade={onUpgrade}>
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                style={{
                  marginTop: 18, padding: '11px 22px', borderRadius: 30, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #D7BE80 0%, #B8944F 100%)',
                  color: COLORS.white, fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
                  boxShadow: '0 4px 15px rgba(184, 148, 79, 0.25)',
                }}
              >
                Send your first invitation
              </button>
            </FeatureGate>
          ) : (
            <button
              type="button"
              onClick={() => { setSearch(''); setFilter('all'); setPage(1); }}
              style={{
                marginTop: 18, padding: '9px 18px', minHeight: 'var(--fx-touch)', borderRadius: 8,
                border: `1px solid ${COLORS.border}`, background: COLORS.white,
                color: COLORS.charcoal, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)',
              }}
            >
              Show all guests
            </button>
          )}
        </div>
      ) : (
        <>
        {/* Action bar — appears on first selection.
            Wraps rather than scrolls: at 320px a nowrap row of a sentence plus
            three buttons would push the whole page sideways. */}
        {selectedIds.size > 0 && (
          /**
           * STICKY ON A PHONE, in place on a desktop.
           *
           * This bar renders above the list, so on a phone it scrolled out of
           * view the moment the organizer started working down the rows: tick,
           * tick, tick, scroll all the way back up, send. `.fx-sticky-actions`
           * pins it just above the mobile nav bar while a selection exists and
           * reverts to a normal block at lg, where the bar it clears does not
           * exist. A shadow, because a sticky element over a scrolling list has
           * to read as floating rather than as a row that stopped moving.
           */
          /**
           * ── THE SEND BOX ────────────────────────────────────────────────
           *
           * COMPACT AND COLLAPSED on a phone; unchanged at md and up.
           *
           * Pinning this to the bottom of the screen was right in intent and
           * wrong in size. Measured at a 320px viewport it renders about 330px
           * tall — a count line, two channel groups whose buttons each wrap onto
           * two rows ("All their details (8)" alone is ~184px against 256px of
           * usable width), and Clear. Sticky above the 60px nav bar, that covers
           * more than half of a 667px screen: the organizer could no longer see
           * the guests they were selecting.
           *
           * So the bar keeps only what has to be permanently visible — how many
           * are selected, one Send toggle, and Clear — and the four sends live
           * behind it. That is roughly 60px pinned instead of 330px.
           *
           * `.fx-disclose__body` is the same primitive the stat tiles use: hidden
           * below md unless opened, forced visible at md and up, one rendering
           * either way. It pairs with `.fx-sticky-actions` reverting at md too,
           * so "collapsed" and "pinned" switch off together.
           */
          <div className="fx-sticky-actions" style={{
            background: COLORS.white, border: `1px solid ${COLORS.gold}`,
            borderRadius: 12, padding: '12px 16px', marginBottom: 14,
            boxShadow: '0 6px 24px rgba(25,27,30,0.10)',
          }}>
            <div className="rsvps-send-head" style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
              justifyContent: 'space-between',
            }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.charcoal, fontFamily: 'var(--font-sans)' }}>
                {selectedIds.size} selected
              </span>
              {/* The honest number. Selecting someone unreachable is allowed, so
                  the count has to say how many will actually get a text rather
                  than letting the selection imply they all will. */}
              <span style={{ display: 'block', fontSize: 11.5, color: COLORS.stone, marginTop: 2, fontFamily: 'var(--font-sans)' }}>
                {reach.reachable === reach.total
                  ? 'All of them can be texted.'
                  : `${reach.reachable} can be texted · ${reach.unreachable} cannot`}
              </span>
              {overSendLimit && (
                <span style={{ display: 'block', fontSize: 11.5, color: '#8A6D34', marginTop: 4, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
                  You can text up to {smsMaxPerSend} at a time for now — send this group in smaller batches.
                </span>
              )}
            </div>

            {/* The phone-only controls. Hidden at md and up, where the four
                sends are always on screen and a toggle would be a control for
                something already visible. */}
            <div className="fx-disclose__summary" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setSendOpen((v) => !v)}
                aria-expanded={sendOpen}
                style={{
                  padding: '9px 16px', minHeight: 'var(--fx-touch)', borderRadius: 9, border: 'none',
                  background: 'linear-gradient(135deg, #D7BE80 0%, #B8944F 100%)', color: COLORS.white,
                  fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {sendOpen ? 'Close' : 'Send…'}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                aria-label="Clear selection"
                style={{
                  padding: '9px 12px', minHeight: 'var(--fx-touch)', borderRadius: 9,
                  border: `1px solid ${COLORS.border}`, background: COLORS.white, color: COLORS.stone,
                  fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
            </div>

            {/**
              * FOUR bulk sends, grouped by channel, and the paid pair asks first.
              *
              * There were two buttons and neither confirmed anything: pressing
              * "Text invitation (74)" billed 74 messages on one click, with no
              * dialog and no undo. The backend's own comment assumed otherwise —
              * invitationService says a repeat press is fine because "the confirm
              * dialog already told them the cost", and that dialog did not exist.
              * It does now, for the two channels that spend money.
              *
              * Email stays one click. It is free, and putting a dialog in front of
              * a free action teaches organizers to dismiss dialogs.
              */}
            {/* The class goes on a BARE wrapper. Put it on the flex row itself
                and the inline `display: 'flex'` beats `display: none`, so the
                panel would never collapse and the class would be inert — the
                one rule in AGENTS.md, and easy to walk into precisely here. */}
            <div className={`fx-disclose__body${sendOpen ? ' fx-disclose__body--open' : ''}`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
              <BulkGroup heading="By email" note="Free" noteColor={COLORS.greenDark}>
                <BulkButton
                  primary
                  busy={sending === 'bulk:email'}
                  disabled={sending !== null}
                  onClick={() => handleSendInvitations([...selectedIds], 'email')}
                  label="Invitation"
                  busyLabel="Emailing…"
                  title={`Email the invitation to the ${selectedIds.size} selected`}
                />
                <BulkButton
                  busy={sending === 'bulk:qr'}
                  disabled={sending !== null || attendingSelected === 0}
                  onClick={() => handleSendInvitations([...selectedIds], 'qr')}
                  label={`Entry pass${attendingSelected !== selectedIds.size ? ` (${attendingSelected})` : ''}`}
                  busyLabel="Emailing…"
                  title={attendingSelected === 0
                    ? 'Only guests who accepted have a seat and a pass'
                    : `Email the entry pass and table to ${attendingSelected} who accepted`}
                />
              </BulkGroup>

              {/* THREE states, not two. The per-guest send menu already made
                  this distinction and the bulk bar did not, so a plan-locked
                  organizer selecting twenty guests was offered "Add texting"
                  and sent to a checkout that refuses them — the exact bug the
                  menu's upgradeInstead/buyInstead split exists to prevent. */}
              <BulkGroup
                heading="By text message"
                note={smsPlanLocked ? null : 'Uses your balance'}
                noteColor={COLORS.gold}
                badge={smsPlanLocked ? <PlanLockBadge label="Plan feature" /> : null}
              >
                <BulkButton
                  primary
                  busy={sending === 'bulk:sms'}
                  disabled={sending !== null || (!smsPlanLocked && smsAddonActive && reach.reachable === 0)}
                  onClick={() => {
                    if (smsPlanLocked) return onUpgradePlan?.();
                    return smsAddonActive
                      ? askBulkSms('sms', [...selectedIds], reach.reachable)
                      : onBuySms?.();
                  }}
                  label={smsPlanLocked
                    ? 'See plans'
                    : smsAddonActive
                      ? `Invitation${reach.reachable !== selectedIds.size ? ` (${reach.reachable})` : ''}`
                      : 'Add texting'}
                  busyLabel="Texting…"
                  title={smsPlanLocked
                    ? `Text messaging is part of a higher plan${plansWithSms.length ? ` — ${plansSentence(plansWithSms)}` : ''}.`
                    : smsAddonActive
                      ? `Text the invitation to ${reach.reachable} of the ${selectedIds.size} selected`
                      : 'Text messaging is not switched on for this event yet.'}
                />
                <BulkButton
                  busy={sending === 'bulk:detail-sms'}
                  disabled={sending !== null || smsPlanLocked || !smsAddonActive || detailReachable === 0}
                  onClick={() => askBulkSms('detail-sms', attendingSelectedIds, detailReachable)}
                  label={`All their details${detailReachable !== selectedIds.size ? ` (${detailReachable})` : ''}`}
                  busyLabel="Texting…"
                  title={smsPlanLocked
                    ? 'Text messaging is part of a higher plan.'
                    : !smsAddonActive
                      ? 'Text messaging is not switched on for this event yet.'
                      : detailReachable === 0
                        ? 'Needs guests who accepted and agreed to texts'
                        : `Text table, companions, meals and pass link to ${detailReachable} guests`}
                />
              </BulkGroup>

              <button
                type="button"
                onClick={clearSelection}
                style={{
                  padding: '9px 14px', minHeight: 'var(--fx-touch)', marginTop: 18, borderRadius: 9, border: 'none',
                  background: 'transparent', color: COLORS.stone,
                  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                Clear
              </button>
            </div>
            </div>
          </div>
        )}

        <div style={{
          background: COLORS.white,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {/* Table on desktop, stacked cards on mobile — a raw table forced
              into overflow-x:auto is the classic mobile anti-pattern (every
              row needs two-directional scrolling to reach Actions). Both are
              rendered and toggled via CSS so there's no JS viewport check /
              hydration risk; RSVPRow and RSVPCard share the same row data. */}
          {/* minWidth grew from 720 to 880 with the select and Texting columns:
              left at 720 the columns squeeze instead of scrolling, and "Hasn't
              agreed to texts" wraps to three lines in a 60px cell. Below 640px
              this whole table is hidden and the cards below replace it. */}
          <div className="rsvps-table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
              <thead>
                <tr style={{ background: COLORS.softBg }}>
                  {/* Selects only what the current filter shows — see toggleAllVisible. */}
                  <th style={{
                    padding: '14px 8px 14px 20px', width: 40,
                    borderBottom: `1px solid ${COLORS.border}`,
                  }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Select all shown"
                      style={{ width: 15, height: 15, accentColor: COLORS.gold, cursor: 'pointer' }}
                    />
                  </th>
                  {['Guest', 'Party Size', 'Response', 'Meal', 'Time', 'Texting', ''].map((h, i) => (
                    <th key={i} style={{
                      padding: '14px 20px',
                      textAlign: i === 6 ? 'center' : 'left',
                      fontSize: 'var(--fx-micro)',
                      fontWeight: 700,
                      color: COLORS.stone,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      fontFamily: 'var(--font-sans)',
                      borderBottom: `1px solid ${COLORS.border}`,
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((rsvp, idx) => (
                  <RSVPRow
                    key={rsvp.id || idx}
                    rsvp={rsvp}
                    isEven={idx % 2 === 0}
                    deletingId={deletingId}
                    onDelete={askRemove}
                    resending={resending}
                    onEdit={setEditingGuest}
                    selected={selectedIds.has(rsvp.id)}
                    onToggleSelect={toggleOne}
                    sending={sending}
                    onSendGuest={handleSendGuest}
                    onBuySms={onBuySms}
                    smsAddonActive={smsAddonActive}
                    smsAccess={smsAccess}
                    plansWithSms={plansWithSms}
                    onUpgradePlan={onUpgradePlan}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="rsvps-cards-wrap" style={{ display: 'none', flexDirection: 'column', gap: 10, padding: 12 }}>
            {paginated.map((rsvp, idx) => (
              <RSVPCard
                key={rsvp.id || idx}
                rsvp={rsvp}
                deletingId={deletingId}
                onDelete={askRemove}
                resending={resending}
                onEdit={setEditingGuest}
                selected={selectedIds.has(rsvp.id)}
                onToggleSelect={toggleOne}
                sending={sending}
                onSendGuest={handleSendGuest}
                onBuySms={onBuySms}
                smsAddonActive={smsAddonActive}
                smsAccess={smsAccess}
                plansWithSms={plansWithSms}
                onUpgradePlan={onUpgradePlan}
              />
            ))}
          </div>

          <style jsx>{`
            @media (max-width: 639.98px) {
              .rsvps-table-wrap { display: none; }
              .rsvps-cards-wrap { display: flex !important; }
            }
          `}</style>

          {/* ── Footer / Pagination ───────────────────────────── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderTop: `1px solid ${COLORS.border}`,
            background: COLORS.softBg,
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <span style={{
              fontSize: 12,
              color: COLORS.stone,
              fontFamily: 'var(--font-sans)',
            }}>
              Showing <b style={{ color: COLORS.charcoal }}>{Math.min((page - 1) * PAGE_SIZE + 1, processed.length)}–{Math.min(page * PAGE_SIZE, processed.length)}</b> of <b style={{ color: COLORS.charcoal }}>{processed.length}</b> responses
            </span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                <PageBtn label="‹" disabled={page === 1} onClick={() => setPage(p => p - 1)} />
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce((acc, p, i, arr) => {
                    if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === '...'
                      ? <span key={`e${i}`} style={{ padding: '0 4px', fontSize: 12, color: COLORS.stone }}>…</span>
                      : <PageBtn key={p} label={String(p)} active={p === page} onClick={() => setPage(p)} />
                  )}
                <PageBtn label="›" disabled={page === totalPages} onClick={() => setPage(p => p + 1)} />
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {/**
        * BELOW THE LIST. It used to open this section, on the reasoning that
        * "will I have enough messages?" is asked while looking at the list — but
        * that argues for the banner being on this SCREEN, which it still is, not
        * for it standing between the organizer and their replies. On a phone it
        * plus the four summary cards were most of a screen before the first row.
        *
        * It keeps its place in the reading order: scroll to the end of the
        * replies and there is the balance, next to the thing you would do about
        * it.
        */}
      <SmsBalanceBanner
        active={smsAddonActive}
        remaining={smsRemaining}
        purchased={smsPurchased}
        coverage={smsCoverage}
        topUpHref="/dashboard/campaigns"
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

      {/* Mounted only while asking, so each open starts fresh and there is no
          stale state to re-arm — see the same note in ClearGuestListModal. The ids
          were captured when the button was pressed, so changing the selection
          behind the dialog cannot change who it sends to. */}
      {removing && (
        <ConfirmRemoveGuestModal
          guestName={removing.name}
          partySize={removing.partySize}
          busy={deletingId === removing.id}
          onCancel={() => setRemoving(null)}
          onConfirm={() => handleDelete(removing.id)}
        />
      )}

      {inviteOpen && (
        <SendInvitationModal
          isOpen
          onClose={() => setInviteOpen(false)}
          eventId={eventId}
          event={event}
          customFields={customFields}
          smsAddonActive={smsAddonActive}
          smsRemaining={smsRemaining}
          onBuySms={onBuySms}
          onSent={onRefresh}
        />
      )}

      {bulkAsk && (
        <ConfirmBulkTextModal
          channel={bulkAsk.channel}
          count={bulkAsk.reachable}
          remaining={smsRemaining}
          busy={sending === `bulk:${bulkAsk.channel}`}
          onCancel={() => setBulkAsk(null)}
          onConfirm={() => {
            const { channel, ids } = bulkAsk;
            setBulkAsk(null);
            handleSendInvitations(ids, channel);
          }}
        />
      )}
    </div>
  );
}

/* ── Table Row ───────────────────────────────────────────────── */
const RSVPRow = React.memo(function RSVPRow({ rsvp, isEven, deletingId, onDelete, resending, onEdit, selected, onToggleSelect, sending, onSendGuest, smsAddonActive, onBuySms, smsAccess, plansWithSms, onUpgradePlan }) {
  // Read here rather than passed in: RSVPRow is React.memo'd, and adding a
  // prop that never changes would widen its comparison for no benefit. The
  // context re-renders it only if the organizer's zone actually changes.
  const timeZone = useOrganizerTimeZone();
  const [hovered, setHovered] = useState(false);
  const badge = responseBadge(rsvp.response);
  const reach = smsReachability(rsvp);
  const reachability = reach;

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? COLORS.ivory : isEven ? COLORS.white : COLORS.softBg,
        transition: 'background 0.2s ease',
      }}
    >
      {/* Select. Never disabled, even when this guest cannot be texted: they may
          still be emailed from the same action bar, and hiding them would also
          hide how many of a selection are unreachable. */}
      <td style={{ padding: '14px 8px 14px 20px', borderBottom: `1px solid ${COLORS.border}` }}>
        <input
          type="checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect(rsvp.id)}
          aria-label={`Select ${rsvp.guest_name || 'guest'}`}
          style={{ width: 15, height: 15, accentColor: COLORS.gold, cursor: 'pointer' }}
        />
      </td>

      {/* Guest */}
      <td style={{ padding: '14px 20px', borderBottom: `1px solid ${COLORS.border}` }}>
        <span style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 600,
          color: COLORS.charcoal,
          fontFamily: 'var(--font-sans)',
        }}>{rsvp.guest_name || '—'}</span>
        {rsvp.email && (
          <span style={{
            display: 'block',
            fontSize: 11,
            color: COLORS.stone,
            marginTop: 2,
            fontFamily: 'var(--font-sans)',
          }}>{rsvp.email}</span>
        )}
      </td>

      {/* Party Size */}
      <td style={{
        padding: '14px 20px',
        borderBottom: `1px solid ${COLORS.border}`,
        fontSize: 13,
        color: COLORS.charcoal,
        fontFamily: 'var(--font-sans)',
        fontWeight: 500,
      }}>
        {rsvp.party_size ?? '—'}
      </td>

      {/* Response Badge */}
      <td style={{ padding: '14px 20px', borderBottom: `1px solid ${COLORS.border}` }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 6,
          background: badge.bg,
          fontSize: 'var(--fx-micro)',
          fontWeight: 700,
          color: badge.color,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontFamily: 'var(--font-sans)',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: badge.dot, flexShrink: 0 }} />
          {badge.label}
        </span>
      </td>

      {/* Meal */}
      <td style={{
        padding: '14px 20px',
        borderBottom: `1px solid ${COLORS.border}`,
        fontSize: 13,
        color: COLORS.charcoal,
        fontFamily: 'var(--font-sans)',
      }}>
        {rsvp.meal || '—'}
      </td>

      {/* Time */}
      <td style={{
        padding: '14px 20px',
        borderBottom: `1px solid ${COLORS.border}`,
        fontSize: 12,
        color: COLORS.stone,
        fontFamily: 'var(--font-sans)',
        whiteSpace: 'nowrap',
      }}>
        {formatTime(rsvp.timestamp, timeZone)}
      </td>

      {/* Texting — states WHY, not just yes/no. The same sentence appears in the
          message history afterwards, so the list and the log never disagree. */}
      <td style={{ padding: '14px 20px', borderBottom: `1px solid ${COLORS.border}` }}>
        <span
          title={reach.title}
          style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: 100,
            background: reach.bg, color: reach.color,
            fontSize: 'var(--fx-micro)', fontWeight: 700, fontFamily: 'var(--font-sans)',
            whiteSpace: 'nowrap',
          }}
        >
          {reach.label}
        </span>
      </td>

      {/* Actions */}
      <td style={{
        padding: '14px 20px',
        borderBottom: `1px solid ${COLORS.border}`,
        textAlign: 'center',
      }}>
        {/**
          * Four unlabelled send icons became one labelled "Send" menu.
          *
          * The four were: email-invitation (paper plane), text-invitation (speech
          * bubble), resend-confirmation (envelope) and send-QR-pass (ticket) — each
          * explained only by a `title`, which touch devices never show. Two of the
          * four were a plane and an envelope side by side, and the comment that
          * used to sit here conceded they "must not share a glyph".
          *
          * The menu groups them by channel, states once per group that email is
          * free and text costs balance, and gives every item a sentence describing
          * what the guest actually receives. Edit and Remove stay in the row: they
          * are frequent, they are not sends, and they do not belong under a heading
          * about how a message arrives.
          */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
          <GuestSendMenu
            guestName={rsvp.guest_name}
            busy={[sending, resending].some((k) => !!k && String(k).startsWith(`${rsvp.id}:`))}
            smsActive={smsAddonActive}
            smsAccess={smsAccess}
            plansWithSms={plansWithSms}
            onUpgradePlan={onUpgradePlan}
            reach={reachability}
            attending={isAccepted(rsvp.response)}
            onBuySms={onBuySms}
            onSend={(sel) => onSendGuest(rsvp.id, sel)}
          />
          <IconActionButton
            title="Edit guest"
            aria-label={`Edit ${rsvp.guest_name || 'guest'}`}
            onClick={() => onEdit(rsvp)}
            icon={PencilIcon}
          />
          <DeleteButton rsvp={rsvp} deletingId={deletingId} onDelete={onDelete} />
        </div>
      </td>
    </tr>
  );
});

/* ── Mobile Card (same data/actions as RSVPRow, stacked instead of tabular) ── */
const RSVPCard = React.memo(function RSVPCard({ rsvp, deletingId, onDelete, resending, onEdit, selected, onToggleSelect, sending, onSendGuest, smsAddonActive, onBuySms, smsAccess, plansWithSms, onUpgradePlan }) {
  const timeZone = useOrganizerTimeZone();
  const badge = responseBadge(rsvp.response);
  const reach = smsReachability(rsvp);
  return (
    <div style={{
      background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 12,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        {/* Selection is not a desktop-only feature — the table is hidden below
            640px and these cards replace it, so without this the whole workflow
            would vanish on a phone. */}
        <input
          type="checkbox"
          checked={!!selected}
          onChange={() => onToggleSelect(rsvp.id)}
          aria-label={`Select ${rsvp.guest_name || 'guest'}`}
          style={{ width: 16, height: 16, accentColor: COLORS.gold, flexShrink: 0, marginTop: 3, cursor: 'pointer' }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: COLORS.charcoal, fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rsvp.guest_name || '—'}
          </span>
          <span style={{
            display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 100,
            background: reach.bg, color: reach.color,
            fontSize: 'var(--fx-micro)', fontWeight: 700, fontFamily: 'var(--font-sans)',
          }}>{reach.label}</span>
          {rsvp.email && (
            <span style={{ display: 'block', fontSize: 12, color: COLORS.stone, marginTop: 2, fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rsvp.email}
            </span>
          )}
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
          padding: '4px 12px', borderRadius: 6, background: badge.bg,
          fontSize: 'var(--fx-micro)', fontWeight: 700, color: badge.color, textTransform: 'uppercase',
          letterSpacing: '0.06em', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: badge.dot, flexShrink: 0 }} />
          {badge.label}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: COLORS.stone, fontFamily: 'var(--font-sans)' }}>
        <span>Party of {rsvp.party_size ?? '—'}</span>
        {rsvp.meal && <span>· {rsvp.meal}</span>}
        <span>· {formatTime(rsvp.timestamp, timeZone)}</span>
      </div>

      {/* Identical actions to the desktop row, in the same order. The two views
          are one workflow rendered twice — a guest reachable on a laptop and not
          on a phone would be a bug, not a simplification. And the phone is where
          the old six unlabelled icons were worst: `title` never renders on touch,
          so all six were blank squares there. */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
        <GuestSendMenu
          guestName={rsvp.guest_name}
          busy={[sending, resending].some((k) => !!k && String(k).startsWith(`${rsvp.id}:`))}
          smsActive={smsAddonActive}
          smsAccess={smsAccess}
          plansWithSms={plansWithSms}
          onUpgradePlan={onUpgradePlan}
          reach={reach}
          attending={isAccepted(rsvp.response)}
          onBuySms={onBuySms}
          onSend={(sel) => onSendGuest(rsvp.id, sel)}
        />
        <IconActionButton
          title="Edit guest"
          aria-label={`Edit ${rsvp.guest_name || 'guest'}`}
          onClick={() => onEdit(rsvp)}
          icon={PencilIcon}
        />
        <DeleteButton rsvp={rsvp} deletingId={deletingId} onDelete={onDelete} />
      </div>
    </div>
  );
});

/* ── Delete Button ───────────────────────────────────────────── */
function DeleteButton({ rsvp, deletingId, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const isDeleting = deletingId === rsvp.id;

  return (
    <button
      onClick={() => onDelete(rsvp)}
      disabled={isDeleting}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Remove guest"
      // Named, because `title` is a desktop-hover affordance that touch never
      // shows — so on a phone this was an unlabelled square that deletes someone.
      aria-label={`Remove ${rsvp.guest_name || 'this guest'} from this event`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        borderRadius: 8,
        border: 'none',
        cursor: isDeleting ? 'wait' : 'pointer',
        background: hovered ? COLORS.roseLight : 'transparent',
        transition: 'all 0.2s ease',
        opacity: isDeleting ? 0.4 : 1,
      }}
    >
      <TrashIcon color={hovered ? COLORS.rose : COLORS.stone} />
    </button>
  );
}

/* ── Generic Icon Action Button ──────────────────────────────── */
function IconActionButton({ title, onClick, icon: Icon, 'aria-label': ariaLabel }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      aria-label={ariaLabel || title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 44, height: 44, borderRadius: 8, border: 'none',
        cursor: 'pointer', background: hovered ? COLORS.champagneLight : 'transparent',
        transition: 'all 0.2s ease',
      }}
    >
      <Icon color={hovered ? COLORS.gold : COLORS.stone} />
    </button>
  );
}



/* ── Export Button ───────────────────────────────────────────── */

/* ── Pagination Button ───────────────────────────────────────── */
function PageBtn({ label, active, disabled, onClick }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minWidth: 30,
        height: 30,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        fontFamily: 'var(--font-sans)',
        color: active ? COLORS.white : disabled ? COLORS.border : COLORS.charcoal,
        background: active ? COLORS.gold : hovered && !disabled ? COLORS.ivory : 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.2s ease',
        padding: '0 6px',
      }}
    >
      {label}
    </button>
  );
}
