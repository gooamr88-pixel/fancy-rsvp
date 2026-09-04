'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from '../../utils/toast';
import PlanLock from '../components/PlanLock';
import { startSmsCreditPurchase } from '../../utils/smsPurchase';
import { useOrganizerTimeZone } from '../components/OrganizerClock';
import { formatInZone } from '../../utils/timezone';
import OrganizerSmsPanel from './OrganizerSmsPanel';
import SmsTemplateStudio from './SmsTemplateStudio';

/**
 * THE MESSAGES PAGE — balance, delivery log, and the four switches.
 *
 * ── What this page used to be ──
 *
 * 1,546 lines, most of them a campaign composer: a free-text message box, an
 * audience segment picker, a live cost estimator, a smartphone preview mockup, a
 * scheduling panel, a progress poller and a launch confirmation. It was the most
 * elaborate screen in the product and the one organizers understood least — it
 * asked someone planning a wedding to compose bulk marketing.
 *
 * It is gone. Not simplified — removed. An organizer never needed to write their
 * own text; they needed their invitation sent, their guests told where to sit,
 * and to be told if something changed. All three are now templated and live where
 * the guests are (the RSVPs tab), which leaves this page to answer the three
 * questions that are actually about MESSAGING rather than about guests:
 *
 *   1. How many messages do I have left?   → the balance card
 *   2. What has been sent, and what didn't? → the delivery log
 *   3. What is allowed to send itself?      → the four switches
 *
 * ── Why there is no <style jsx> here ──
 *
 * Every responsive rule uses the global .fx-* utilities. AGENTS.md is explicit
 * that a new scoped block should not be written where a primitive already
 * covers it, and that a class can never beat an inline style — so no inline
 * display/grid/gap keys sit on any element carrying an fx- class.
 */

const C = {
  gold: '#B8944F',
  goldHover: '#a6833f',
  charcoal: '#191B1E',
  ivory: '#F8F4EC',
  stone: '#77736A',
  border: '#E8E2D6',
  softBg: '#FAFAF8',
  white: '#FFFFFF',
  success: '#3B9B6D',
  error: '#C45E5E',
  amber: '#B8894F',
};

export default function MessagesPage() {
  const timeZone = useOrganizerTimeZone();
  const params = useSearchParams();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

  /**
   * WHICH EVENT — derived from the URL, not captured from it once.
   *
   * This was `useState(params.get('event') || '')`, which reads the query string
   * exactly once, at mount. The dashboard sidebar now lives in the layout and its
   * "Working on" switcher rewrites `?event=` in place — so changing event there
   * updated every nav link and left THIS page showing the previous event's balance
   * and history, with nothing on screen admitting the two disagreed.
   *
   * Deriving means there is one value and it cannot drift. `fallbackEventId` covers
   * only the first load, before the URL names anything.
   */
  const urlEventId = params.get('event') || '';
  const router = useRouter();
  const [fallbackEventId, setFallbackEventId] = useState('');
  const [events, setEvents] = useState([]);
  const eventId = (urlEventId && events.some((e) => e.id === urlEventId))
    ? urlEventId
    : fallbackEventId;
  const [data, setData] = useState(null);
  const [log, setLog] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState(null);
  const [resending, setResending] = useState(null);
  const [buyOpen, setBuyOpen] = useState(false);

  /* ── Which event ──────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/events`, { credentials: 'include' });
        const j = await res.json();
        if (!cancelled && j?.success) {
          const list = j.events || [];
          setEvents(list);
          // Only ever the first-load default. Once the URL names an event that
          // exists, the derived `eventId` above ignores this entirely.
          if (list.length > 0) setFallbackEventId((prev) => prev || list[0].id);
        }
      } catch { /* the empty state explains itself */ }
    })();
    return () => { cancelled = true; };
    // The eslint-disable that used to sit here reported no problems — the deps are
    // complete now that eventId is derived rather than read into this effect.
  }, [apiUrl]);

  /* ── Everything about this event's messaging ──────────────────────────── */
  const load = useCallback(async () => {
    if (!eventId) { setLoading(false); return; }
    setLoading(true);
    try {
      // Three independent reads. allSettled rather than all: a missing delivery
      // log must not blank the balance card, which is the thing most people came
      // for.
      const [settingsRes, logRes, historyRes] = await Promise.allSettled([
        fetch(`${apiUrl}/events/${eventId}/campaigns/settings`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${apiUrl}/events/${eventId}/campaigns/log`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${apiUrl}/events/${eventId}/campaigns/history`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      if (settingsRes.status === 'fulfilled' && settingsRes.value?.success) setData(settingsRes.value);
      if (logRes.status === 'fulfilled' && logRes.value?.success) setLog(logRes.value.entries || []);
      if (historyRes.status === 'fulfilled' && historyRes.value?.success) setLedger(historyRes.value.history || []);
    } catch {
      toast.error('Could not load your messages.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, eventId]);

  /**
   * Wrapped in an async IIFE, not `useEffect(() => { load(); })`.
   *
   * `load` calls setLoading(true) before its first await, so calling it bare from
   * an effect body is a synchronous setState in an effect — a cascading render and
   * an error under react-hooks/set-state-in-effect. (Pre-existing; it predates this
   * pass, and the same IIFE technique is used for the events fetch above.)
   */
  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

  /* ── Flip one of the four switches ────────────────────────────────────── */
  const toggleType = async (key, next) => {
    if (!data) return;
    const updated = { ...data.settings, [key]: next };
    // Optimistic: a switch that waits for a round trip before moving feels
    // broken, and the failure path below puts it back.
    setData({ ...data, settings: updated });
    setSavingType(key);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updated }),
      });
      const j = await res.json();
      if (!res.ok || j.success === false) throw new Error(j.message || 'Could not save that.');
    } catch (err) {
      setData((d) => ({ ...d, settings: { ...d.settings, [key]: !next } }));
      toast.error(err.message || 'Could not save that.');
    } finally {
      setSavingType(null);
    }
  };

  /* ── Retry one failed message ─────────────────────────────────────────── */
  const retry = async (logId) => {
    setResending(logId);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/resend/${logId}`, {
        method: 'POST', credentials: 'include',
      });
      const j = await res.json();
      if (j.success) { toast.success('Sent.'); load(); }
      else toast.error(j.message || 'Still could not send it.');
    } catch {
      toast.error('Still could not send it.');
    } finally {
      setResending(null);
    }
  };

  const balance = data?.balance;
  const active = !!data?.addonActive;
  /* Server's verdict, not re-derived here — see the note on campaigns/settings.
     A missing `access` (older API) reads as allowed, so a version skew never
     hides a paying customer's texting behind an upsell. */
  const planLocked = data?.access === 'locked';
  const activeEvent = events.find((e) => e.id === eventId) || null;

  /* ── Empty state: no events at all ────────────────────────────────────── */
  if (!loading && events.length === 0) {
    /* fx-gutter, because .fx-container deliberately has NO horizontal padding —
       it assumes an .fx-section above it supplied one, and on this route there is
       nothing above but .dnav-content (margin-left + padding-bottom only).
       Without it this page rendered flush against both screen edges. */
    return (
      <div className="fx-container fx-container--3xl fx-gutter fx-gutter--sm" style={{ paddingTop: 48 }}>
        <Empty
          title="No events yet"
          body="Create an event and you will be able to text your guests their invitation, their table and any changes."
          cta={{ href: '/dashboard/create-event', label: 'Create an event' }}
        />
      </div>
    );
  }

  return (
    <div className="fx-container fx-container--4xl fx-gutter fx-gutter--sm" style={{ paddingTop: 34, paddingBottom: 60 }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <Link href="/dashboard" style={{ fontSize: 13, color: C.stone, textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
        &larr; Back to dashboard
      </Link>

      <div className="fx-row fx-row--between" style={{ alignItems: 'flex-end', marginTop: 16, marginBottom: 26 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            margin: 0, fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 600,
            color: C.charcoal, fontFamily: 'var(--font-serif)', lineHeight: 1.2,
          }}>
            Text messages
          </h1>
          {/* NAMES the event, now that the switcher moved to the sidebar.
              Every number on this page — balance, history, switches — belongs to
              one event, and with the selector gone there would otherwise be
              nothing on the page itself saying which. */}
          <p style={{ margin: '7px 0 0', fontSize: 14, color: C.stone, fontFamily: 'var(--font-sans)' }}>
            What has been sent, what is left, and what sends itself
            {activeEvent?.title ? <> — for <strong style={{ color: C.charcoal, fontWeight: 600 }}>{activeEvent.title}</strong></> : null}.
          </p>
        </div>

        {/**
          * The page's own event <select> used to sit here.
          *
          * The dashboard sidebar now carries a "Working on" switcher on every
          * page, so this was a SECOND switcher for the same choice, three
          * centimetres from the first — free to show a different event and give no
          * hint which one the numbers below belonged to. One control, in the one
          * place it appears on every screen.
          */}
      </div>

      {loading ? (
        <p style={{ color: C.stone, fontFamily: 'var(--font-sans)' }}>Loading…</p>
      ) : planLocked ? (
        /* ── The plan does not carry texting ──────────────────────────────
           Checked BEFORE `!active`, because the two look identical to a
           customer and lead to opposite places. "Not on for this event" offers
           a purchase; this plan cannot make that purchase, so offering it would
           walk the organizer into a checkout that refuses them. */
        <PlanLock
          title="Text messaging is not on your plan"
          description="Send invitations, reminders and entry passes straight to your guests' phones — and reach the guests who never open email."
          plans={data?.plansWithSms || []}
          meteredNote="Messages are charged separately, per message"
          onUpgrade={() => router.push('/dashboard?tab=events')}
          upgradeLabel="See plans"
        />
      ) : !active ? (
        /* ── Not purchased. Sell it; do not scold. ───────────────────────── */
        <Empty
          title="Text messaging is not on for this event"
          body="Add it whenever you like. Your guests get their invitation, their table and any changes by text — and everyone still gets the email."
          cta={{ href: `/dashboard/sms-plans?event=${eventId}`, label: 'See what it costs' }}
        />
      ) : (
        <>
          {/* ── Balance ──────────────────────────────────────────────────── */}
          <BalanceCard
            balance={balance}
            coverage={data.coverage}
            onBuy={() => setBuyOpen(true)}
            eventId={eventId}
          />

          {/* ── The switches ─────────────────────────────────────────────────
              The count is NOT written in the copy any more. It said "Four kinds of
              message" while the registry now holds five, and a lede that has to be
              edited every time a type ships is a lede that will eventually lie —
              this one already had. The list below renders from the registry, so it
              was right and the sentence above it was wrong. */}
          <Panel
            title="What sends automatically"
            lede="These are the only messages ever sent by text, and you control each one."
          >
            {(data.messageTypes || []).map((t) => (
              <TypeRow
                key={t.key}
                type={t}
                on={data.settings?.[t.key] !== false}
                saving={savingType === t.key}
                onToggle={(next) => toggleType(t.key, next)}
                organizerSms={data.organizerSms}
              />
            ))}

            {/* Named plainly, because "why didn't my aunt get it?" is the single
                most common support question this feature generates. */}
            {data.skipSummary && Object.keys(data.skipSummary).length > 0 && (
              <div style={{
                marginTop: 14, padding: '12px 14px', borderRadius: 10,
                background: C.softBg, border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.charcoal, marginBottom: 7, fontFamily: 'var(--font-sans)' }}>
                  Messages we could not send
                </div>
                {Object.entries(data.skipSummary).map(([reason, count]) => (
                  <div key={reason} style={{
                    display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12,
                    fontSize: 12.5, color: C.stone, padding: '3px 0', fontFamily: 'var(--font-sans)',
                  }}>
                    <span>{data.skipLabels?.[reason] || reason}</span>
                    <strong style={{ color: C.charcoal }}>{count}</strong>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* ── The organizer's own number ───────────────────────────────────
              TypeRow above tells anyone whose organizer alerts are switched on
              to "add your own number below". Until now there was nothing below:
              PATCH /campaigns/organizer-sms existed, the settings response
              already carried `organizerSms`, and emailScheduler reads
              organizations.sms_consent before every final report — but no
              surface in the product could record that consent, so the
              organizer_report message type had never once been able to fire. */}
          <OrganizerSmsPanel
            apiUrl={apiUrl}
            eventId={eventId}
            organizerSms={data.organizerSms}
            onSaved={load}
          />

          {/* ── The words themselves ─────────────────────────────────────────
              Directly under the switches, because the two answer consecutive
              questions: "what is allowed to send itself?" and then "and what
              does it say?". Loads its own data — the bodies, our defaults and
              the worst-case cost of each are a much heavier payload than the
              settings response, and an organizer who never opens this section
              should not pay for it on every visit to the balance card. */}
          <SmsTemplateStudio apiUrl={apiUrl} eventId={eventId} />

          {/* ── Delivery log ─────────────────────────────────────────────── */}
          <Panel
            title="Every message"
            lede="Who it went to, and what happened."
          >
            {log.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13.5, color: C.stone, fontFamily: 'var(--font-sans)' }}>
                Nothing has been sent yet.
              </p>
            ) : (
              <div className="fx-scroll-x">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead>
                    <tr>
                      {['Guest', 'Message', 'What happened', ''].map((h, i) => (
                        <th key={i} style={{
                          textAlign: i === 3 ? 'right' : 'left', padding: '8px 10px',
                          fontSize: 'var(--fx-micro)', fontWeight: 700, letterSpacing: '0.08em',
                          textTransform: 'uppercase', color: C.stone,
                          borderBottom: `1px solid ${C.border}`, fontFamily: 'var(--font-sans)',
                          whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((r) => (
                      <tr key={r.id}>
                        <td style={cell}>{r.guestName || '—'}</td>
                        <td style={{ ...cell, color: r.retiredType ? C.stone : C.charcoal }}>
                          {r.typeLabel || 'Message'}
                        </td>
                        <td style={cell}>
                          <span style={{ color: r.status === 'sent' ? C.success : C.stone }}>
                            {r.outcome}
                          </span>
                          {r.reason && (
                            <span style={{ display: 'block', fontSize: 11.5, color: C.stone }}>{r.reason}</span>
                          )}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          {r.canResend && (
                            <button
                              type="button"
                              onClick={() => retry(r.id)}
                              disabled={resending === r.id}
                              style={{
                                padding: '5px 11px', minHeight: 'var(--fx-touch)', borderRadius: 7,
                                border: `1px solid ${C.border}`, background: C.white,
                                color: C.charcoal, fontSize: 11.5, fontWeight: 700,
                                cursor: resending === r.id ? 'wait' : 'pointer',
                                fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                              }}
                            >
                              {resending === r.id ? 'Sending…' : 'Try again'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* ── Money ────────────────────────────────────────────────────── */}
          {ledger.length > 0 && (
            <Panel title="Payments and usage" lede="Every purchase and every message charged.">
              <div className="fx-scroll-x">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                  <tbody>
                    {ledger.slice(0, 25).map((row) => (
                      <tr key={row.id}>
                        <td style={cell}>
                          {row.transaction_type === 'purchase' ? 'Messages added'
                            : row.transaction_type === 'refund' ? 'Refunded'
                              : 'Message sent'}
                        </td>
                        <td style={{ ...cell, color: C.stone, fontSize: 12 }}>
                          {formatInZone(row.created_at, timeZone, { month: 'short', day: 'numeric', year: 'numeric' }) || '—'}
                        </td>
                        <td style={{
                          ...cell, textAlign: 'right', fontWeight: 700,
                          color: row.credits > 0 ? C.success : C.charcoal,
                        }}>
                          {row.credits > 0 ? `+${row.credits}` : row.credits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}

      {buyOpen && (
        <TopUpModal
          apiUrl={apiUrl}
          eventId={eventId}
          onClose={() => setBuyOpen(false)}
        />
      )}
    </div>
  );
}

const cell = {
  padding: '10px', fontSize: 13, color: C.charcoal,
  borderBottom: `1px solid ${C.border}`, fontFamily: 'var(--font-sans)',
  verticalAlign: 'top',
};

/* ── Balance ─────────────────────────────────────────────────────────────── */
// `eventId` is here only for the "What messages cost" link below — that page
// cannot sell anything without it.
function BalanceCard({ balance, coverage, onBuy, eventId }) {
  const remaining = balance?.remaining ?? 0;
  const purchased = balance?.purchased ?? 0;
  const pct = balance?.percentRemaining ?? 0;
  const short = coverage && coverage.enough === false;
  const tone = balance?.isEmpty ? C.error : (balance?.isLow || short) ? C.amber : C.success;

  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`, borderLeft: `3px solid ${tone}`,
      borderRadius: 14, padding: 20, marginBottom: 22,
    }}>
      <div className="fx-row fx-row--between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 12, color: C.stone, fontFamily: 'var(--font-sans)' }}>Messages left</div>
          <div style={{ fontSize: 38, fontWeight: 700, color: C.charcoal, fontFamily: 'var(--font-serif)', lineHeight: 1.1 }}>
            {remaining.toLocaleString()}
          </div>
          <div style={{ fontSize: 12.5, color: C.stone, fontFamily: 'var(--font-sans)', marginTop: 2 }}>
            {purchased > 0 ? `of ${purchased.toLocaleString()} bought` : 'None bought yet'}
            {balance?.lastUsedLabel ? ` · last sent ${balance.lastUsedLabel}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onBuy}
          style={{
            padding: '10px 20px', borderRadius: 9, border: 'none', background: C.gold,
            color: C.white, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
          }}
        >
          Add messages
        </button>
      </div>

      {purchased > 0 && (
        <div style={{ height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.06)', overflow: 'hidden', marginTop: 14 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: tone, borderRadius: 999 }} />
        </div>
      )}

      {/* In guests, not in segments. "1,350 messages" means nothing to someone
          holding a guest list; "enough for 90 of your 140" is the same fact in
          the unit they are already thinking in. */}
      {coverage && (
        <div style={{
          marginTop: 13, padding: '10px 13px', borderRadius: 9,
          background: short ? 'rgba(184,137,79,0.08)' : C.softBg,
          border: `1px solid ${short ? 'rgba(184,137,79,0.25)' : C.border}`,
          fontSize: 12.5, lineHeight: 1.55, color: short ? C.amber : C.stone,
          fontFamily: 'var(--font-sans)',
        }}>
          {short
            ? `Enough for about ${coverage.coversInvitations} of your ${coverage.invitations} invitations. Add about ${coverage.shortfall.toLocaleString()} more to cover everyone.`
            : `Enough for all ${coverage.invitations} of your invitations.`}
        </div>
      )}

      {/* This link is now the ONLY route to the pricing explainer — "Texting &
          pricing" used to be its own sidebar entry, at the same weight as a control
          panel, which is why it was folded in here. So it has to be legible rather
          than a footnote: an organizer wondering what a message costs is standing
          on this card. */}
      <div style={{ fontSize: 12.5, color: C.stone, marginTop: 12, fontFamily: 'var(--font-sans)' }}>
        These messages belong to this event only.{' '}
        {/* CARRIES THE EVENT. Without `?event=`, the pricing page has nothing to
            buy for: its CTA falls back to "Choose an event" and pressing it
            bounces to /dashboard instead of opening checkout. This link is the
            most likely way anyone reaches that page — "an organizer wondering
            what a message costs is standing on this card", per the note above —
            so dropping the id here is what made the buy button look broken. */}
        <Link href={eventId ? `/dashboard/sms-plans?event=${eventId}` : '/dashboard/sms-plans'} style={{ color: C.gold, fontWeight: 700 }}>
          What messages cost &rarr;
        </Link>
      </div>
    </div>
  );
}

/* ── One of the four switches ────────────────────────────────────────────── */
function TypeRow({ type, on, saving, onToggle, organizerSms }) {
  // The organizer's own alerts cannot send until they have given us their own
  // number and opt-in — a switch that is on but structurally cannot fire is
  // worse than one that explains itself.
  const blocked = type.audience === 'organizer' && !organizerSms?.consent;

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14,
      padding: '13px 0', borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.charcoal, fontFamily: 'var(--font-sans)' }}>
          {type.label}
        </div>
        <div style={{ fontSize: 12.5, color: C.stone, marginTop: 2, lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>
          {type.description}
        </div>
        {blocked && (
          <div style={{ fontSize: 12, color: C.amber, marginTop: 5, fontFamily: 'var(--font-sans)' }}>
            Add your own number below to receive these.
          </div>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${type.label}: ${on ? 'on' : 'off'}`}
        onClick={() => onToggle(!on)}
        disabled={saving}
        style={{
          width: 44, height: 25, borderRadius: 999, border: 'none', flexShrink: 0,
          background: on ? C.gold : '#D5D0C6',
          cursor: saving ? 'wait' : 'pointer', position: 'relative',
          transition: 'background 0.2s ease', opacity: saving ? 0.6 : 1,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: on ? 22 : 3,
          width: 19, height: 19, borderRadius: '50%', background: C.white,
          transition: 'left 0.2s ease',
        }} />
      </button>
    </div>
  );
}

/* ── Top-up ──────────────────────────────────────────────────────────────── */
function TopUpModal({ apiUrl, eventId, onClose }) {
  const [count, setCount] = useState(500);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);

  // Priced by the SERVER, always. The organizer must never meet the real number
  // for the first time on Stripe's page.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        // ?messages= — the endpoint's actual parameter name. It was `credits`
        // here, which the server ignored, silently quoting the minimum purchase
        // whatever the slider said and then charging the real amount at Stripe.
        const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/topup-quote?messages=${count}`, { credentials: 'include' });
        const j = await res.json();
        if (!cancelled && j?.success) setQuote(j);
      } catch { /* the button still works; it just cannot preview */ }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [apiUrl, eventId, count]);

  const buy = () => {
    setBusy(true);
    startSmsCreditPurchase({ apiUrl, eventId, creditCount: count })
      /**
       * The SERVER's sentence, not a generic one.
       *
       * This said "Could not open checkout" for every outcome, which is wrong
       * for the two most likely ones: card payments being switched off
       * platform-wide (503 STRIPE_DISABLED) and the organization having no card
       * on file because the event was paid by bank transfer (400
       * NO_STRIPE_CUSTOMER). Neither is a checkout that failed to open, and both
       * have a different next step — the backend already words them for an
       * organizer, so pass them through.
       */
      .catch((err) => toast.error(err?.message || 'Could not open checkout.'))
      .finally(() => setBusy(false));
  };

  return (
    <div
      role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(25,27,30,0.55)',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{ background: C.white, borderRadius: 16, width: '100%', maxWidth: 400, padding: 22 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: C.charcoal, fontFamily: 'var(--font-serif)' }}>
          Add messages
        </h2>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.charcoal, margin: '18px 0 7px', fontFamily: 'var(--font-sans)' }}>
          How many?
        </label>
        <input
          type="range" min={50} max={10000} step={50}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          style={{ width: '100%', accentColor: C.gold }}
        />
        <div style={{ fontSize: 26, fontWeight: 700, color: C.charcoal, fontFamily: 'var(--font-serif)' }}>
          {count.toLocaleString()}
        </div>

        <div style={{
          marginTop: 14, padding: '12px 14px', borderRadius: 10,
          background: C.softBg, border: `1px solid ${C.border}`,
          fontSize: 14, color: C.charcoal, fontFamily: 'var(--font-sans)',
        }}>
          {/* priceCents, not chargeCents — the endpoint deliberately does not
              expose our carrier cost or profit, so it renames the one figure the
              customer is allowed to see. Reading the wrong key rendered $NaN on a
              payment screen. */}
          {quote && Number.isFinite(quote.priceCents)
            ? (
              <>
                <strong style={{ fontSize: 20 }}>${(quote.priceCents / 100).toFixed(2)}</strong>
                {quote.discountPct > 0 && (
                  <span style={{ color: C.success, fontSize: 12.5, marginInlineStart: 8 }}>
                    {quote.discountPct}% volume discount
                  </span>
                )}
                {/* The server clamps to its own bounds. Say so rather than letting
                    the slider and the price disagree in silence. */}
                {quote.messages !== count && (
                  <span style={{ display: 'block', fontSize: 12, color: C.stone, marginTop: 4 }}>
                    for {quote.messages.toLocaleString()} messages — the closest amount we can sell
                  </span>
                )}
              </>
            )
            : <span style={{ color: C.stone, fontSize: 13 }}>Pricing…</span>}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{
            padding: '9px 16px', minHeight: 'var(--fx-touch)', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.white, color: C.charcoal, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}>Cancel</button>
          <button type="button" onClick={buy} disabled={busy} style={{
            padding: '9px 18px', minHeight: 'var(--fx-touch)', borderRadius: 8, border: 'none',
            background: busy ? C.stone : C.gold, color: C.white,
            fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
            fontFamily: 'var(--font-sans)',
          }}>{busy ? 'Opening…' : 'Continue to payment'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */
function Panel({ title, lede, children }) {
  return (
    <section style={{
      background: C.white, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: 20, marginBottom: 22,
    }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.charcoal, fontFamily: 'var(--font-serif)' }}>
        {title}
      </h2>
      {lede && (
        <p style={{ margin: '5px 0 14px', fontSize: 13, color: C.stone, fontFamily: 'var(--font-sans)' }}>{lede}</p>
      )}
      {children}
    </section>
  );
}

function Empty({ title, body, cta }) {
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`, borderRadius: 16,
      padding: 'clamp(24px, 5vw, 44px)', textAlign: 'center',
    }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: C.charcoal, fontFamily: 'var(--font-serif)' }}>
        {title}
      </h2>
      <p style={{
        margin: '11px auto 20px', maxWidth: 440, fontSize: 14, lineHeight: 1.65,
        color: C.stone, fontFamily: 'var(--font-sans)',
      }}>{body}</p>
      <Link href={cta.href} style={{
        display: 'inline-block', padding: '11px 22px', borderRadius: 9,
        background: C.gold, color: C.white, fontSize: 14, fontWeight: 700,
        textDecoration: 'none', fontFamily: 'var(--font-sans)',
      }}>{cta.label}</Link>
    </div>
  );
}
