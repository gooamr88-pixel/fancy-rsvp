'use client';

import { useEffect, useState } from 'react';
import adminApi from '../../_lib/adminApi';
import StatCard from '../../_components/StatCard';
import { PageLoading } from '../../_components/Spinner';
import { ErrorState } from '../../_components/ErrorState';
import { T, card } from '../../_components/theme';
import { money } from '../../_lib/format';
import PendingCashPanel from './PendingCashPanel';

/**
 * Financial Command Center (Master Plan §22). Reads GET /admin/finance/summary
 * (backed by the mv_daily_revenue rollup) and renders gross/net/refunded/profit
 * KPIs, a daily net bar chart, and a simple forecast.
 */
const fmt = (cents) => money(cents, 0);

const ICONS = {
  gross: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>,
  net: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></svg>,
  commission: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18" /><polyline points="17 6 23 6 23 12" /></svg>,
  payments: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
  forecast: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><path d="M3 20h18" /></svg>,
};

/**
 * SMS profit and loss.
 *
 * The question this exists to answer is blunt: does text messaging make money?
 * Before carrier costs were recorded per send it could not be answered at all —
 * only estimated by multiplying today's rate by historic volume, which is wrong
 * whenever the rate has changed, and wrong in the flattering direction.
 *
 * Revenue and cost are shown side by side rather than as a single "profit"
 * figure, because the interesting failure is not "profit is low" — it is
 * "revenue looks healthy and cost is eating all of it". A margin below zero is
 * called out in red rather than left as a number to notice.
 */
function SmsProfitPanel({ sms, loading, error }) {
  if (loading) {
    return <div style={{ ...card, padding: 24, color: T.text500, fontSize: 13 }}>Loading SMS financials…</div>;
  }
  if (error) {
    return <div style={{ ...card, padding: 24, color: T.text500, fontSize: 13 }}>{error}</div>;
  }
  if (!sms) return null;

  const revenue = Number(sms.revenueCents) || 0;
  const cost = Number(sms.costCents) || 0;
  const profit = Number(sms.profitCents) || 0;
  const losing = profit < 0;

  const stat = (label, value, sub, color) => (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.text400, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || T.text900, marginTop: 4, fontFamily: 'var(--font-serif)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: T.text500, marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <section style={{ marginTop: 34 }}>
      <header style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: T.text900, margin: 0, fontFamily: 'var(--font-serif)' }}>
          Text messaging
        </h2>
        <p style={{ fontSize: 12.5, color: T.text500, margin: '4px 0 0' }}>
          What organizers paid us, what the phone networks charged us, and what is left.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {stat('SMS revenue', fmt(revenue), `${(sms.messagesBought || 0).toLocaleString()} messages sold`)}
        {/* "Carrier", not "Twilio": the sending carrier is switchable (Twilio or
            Vonage), and on Vonage this figure is the price the carrier actually
            reported rather than an estimate from config. */}
        {stat('Carrier cost', fmt(cost), `${(sms.messagesSent || 0).toLocaleString()} messages sent`)}
        {stat('Net profit', fmt(profit), `${sms.marginPct}% margin`, losing ? T.danger || '#C45E5E' : T.success)}
        {stat('Per event', fmt(sms.avgRevenuePerEventCents), `${sms.avgMessagesPerEvent} messages on average`)}
      </div>

      {losing && (
        <p style={{ marginTop: 14, padding: '11px 13px', borderRadius: 9, background: 'rgba(196,94,94,0.08)', border: '1px solid rgba(196,94,94,0.3)', fontSize: 12.5, color: '#C45E5E', fontWeight: 600, lineHeight: 1.6 }}>
          Text messaging is running at a loss over this period. Raise the markup or reduce a
          volume discount in System Configuration → SMS Pricing.
        </p>
      )}

      {/* Honesty about the data rather than a confident wrong number: sends that
          predate cost capture have no cost recorded, so profit is an upper bound
          until the window clears them. */}
      {sms.costCaveat && (
        <p style={{ marginTop: 12, fontSize: 11.5, color: T.text500, lineHeight: 1.6 }}>
          {sms.costCaveat}
        </p>
      )}

      {Array.isArray(sms.topEvents) && sms.topEvents.length > 0 && (
        <div style={{ ...card, padding: 20, marginTop: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: T.text900, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Heaviest events
          </h3>
          <div className="fx-scroll-x">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 360 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Event', 'Messages sent', 'Cost to us'].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '7px 10px', color: T.text400, fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sms.topEvents.map((e) => (
                  <tr key={e.event_id || e.title} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: '7px 10px', color: T.text900, fontWeight: 600 }}>{e.title}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: T.text900, fontWeight: 700 }}>{Number(e.messages_sent).toLocaleString()}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: T.text500 }}>{fmt(e.cost_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * CASH PAYMENTS WAITING FOR SOMEONE TO SAY YES.
 *
 * ── Why this exists ──
 *
 * Manual cash approval is a live feature: an organizer pays outside Stripe, a
 * row lands in `event_payments` as pending/cash_manual, and an admin approves
 * it — which runs `approve_event_cash` and marks the event paid. The approve
 * half was reachable (POST /admin/manual-approve). The half that tells you
 * WHICH payments are waiting was not: GET /admin/pending-payments shipped with
 * its RBAC permission wired and no caller anywhere in the product.
 *
 * So the only way to find an unapproved cash payment was to already know it
 * existed. An organizer who paid in cash sat unpaid until they complained.
 *
 * ── Why it is its own request ──
 *
 * Loaded separately from the summary, like the SMS panel above and for the same
 * reason: this list is the actionable part of the page, and it must still
 * render if the revenue rollup is unavailable.
 */

export default function FinancePage() {
  /* Each of these is one value tagged with the attempt it answers, rather than
     a data/loading/error trio kept in step by hand. Both loaders used to raise
     their own flag synchronously at the top of the effect — a whole extra
     render before paint, and a flag that outlives its request the moment any
     one of the three writes is missed. Read off the tag, "still loading" is
     not a fact anything has to remember to update. */
  const [finResult, setFinResult] = useState(null);
  const [smsResult, setSmsResult] = useState(null);
  const [cash, setCash] = useState(null);
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState(null);
  const [approving, setApproving] = useState(null);
  // MOB-15: the native `title` attribute was the ONLY way to read a bar's
  // value — it never fires on touch. onClick doubles as a tap handler on
  // touch devices, so one handler covers both mouse and touch.
  const [activeDay, setActiveDay] = useState(null);
  const [retryTick, setRetryTick] = useState(0);

  /* Below `retryTick`, and it has to be: these read it during render, so
     declaring them up with the other state would be a temporal dead zone —
     `ReferenceError` on every render of this page, not a lint opinion. */
  const loading = finResult?.tick !== retryTick;
  const fin = finResult?.data ?? null;
  const error = finResult?.error ?? null;

  const smsLoading = smsResult?.tick !== retryTick;
  const sms = smsResult?.data ?? null;
  const smsError = smsResult?.error ?? null;

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await adminApi.get('/finance/summary');
        if (!ignore) setFinResult({ tick: retryTick, data: res?.finance || null, error: null });
      } catch (err) {
        if (!ignore) {
          setFinResult({ tick: retryTick, data: null, error: err.message || 'Failed to load financials' });
        }
      }
    })();
    return () => { ignore = true; };
  }, [retryTick]);

  // Cash awaiting approval — its own request, so the actionable list still
  // renders when the revenue rollup is unavailable.
  useEffect(() => {
    let ignore = false;
    (async () => {
      /* INSIDE the IIFE, not in the effect body: a bare setState there is a
         synchronous cascading render and an error under
         react-hooks/set-state-in-effect.

         The two effects above answer the same problem the better way — one
         value tagged with the attempt it belongs to, no flag at all. This one
         keeps its flags because `approveCash` writes `cashError` from outside
         any fetch, so there is a second writer with no attempt to tag. */
      setCashLoading(true);
      try {
        const res = await adminApi.get('/pending-payments');
        if (!ignore) { setCash(res?.payments || []); setCashError(null); }
      } catch (err) {
        if (!ignore) setCashError(err.message || 'Cash payments are unavailable.');
      } finally {
        if (!ignore) setCashLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [retryTick]);

  const approveCash = async (payment) => {
    setApproving(payment.id);
    try {
      await adminApi.post('/manual-approve', {
        eventId: payment.events?.id,
        amountCents: payment.amount_cents,
      });
      // Re-read rather than splicing the row out locally: approval also marks
      // the event paid and moves money into the summary above, and both panels
      // must agree with the database rather than with each other.
      setRetryTick((t) => t + 1);
    } catch (err) {
      setCashError(err.message || 'Could not approve that payment.');
    } finally {
      setApproving(null);
    }
  };

  // Loaded separately from the main summary so a missing analytics migration
  // degrades one panel rather than blanking the whole Financial Command Center.
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await adminApi.get('/finance/sms');
        if (!ignore) setSmsResult({ tick: retryTick, data: res || null, error: null });
      } catch (err) {
        if (!ignore) {
          setSmsResult({ tick: retryTick, data: null, error: err.message || 'SMS financials are unavailable.' });
        }
      }
    })();
    return () => { ignore = true; };
  }, [retryTick]);

  if (loading) return <PageLoading label="Loading financials…" />;
  if (error) return <ErrorState message={error} onRetry={() => setRetryTick((t) => t + 1)} />;
  if (!fin) return <p style={{ color: T.text500 }}>No financial data.</p>;

  const t = fin.totals || {};
  const series = fin.series || [];
  const maxNet = Math.max(1, ...series.map((s) => s.net_cents || 0));

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text900, margin: 0, fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}>Financial Command Center</h1>
        <p style={{ fontSize: 13, color: T.text500, margin: '4px 0 0' }}>
          {fin.range?.from} → {fin.range?.to}
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 22 }}>
        <StatCard label="Gross Revenue" value={fmt(t.grossCents)} accent={T.success} icon={ICONS.gross} />
        <StatCard label="Net Revenue" value={fmt(t.netCents)} sub={`${fmt(t.refundedCents)} refunded`} icon={ICONS.net} />
        <StatCard label="Platform Profit" value={fmt(t.platformProfitCents)} sub={`${t.commissionPct || 0}% commission`} accent={T.primary} icon={ICONS.commission} />
        <StatCard label="Payments" value={t.paymentCount || 0} icon={ICONS.payments} />
        <StatCard label="Forecast (30d net)" value={fmt(fin.forecast?.next30DaysNetCents)} sub={`${fmt(fin.forecast?.avgDailyNetCents)}/day avg`} accent={T.warning} icon={ICONS.forecast} />
      </div>

      <div style={{ ...card, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text900, margin: 0 }}>Daily net revenue</h3>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: activeDay ? (activeDay.net_cents < 0 ? T.danger : T.primary) : T.text400 }}>
            {activeDay ? `${activeDay.day} — ${fmt(activeDay.net_cents || 0)}` : 'Tap a bar for its value'}
          </span>
        </div>
        {series.length === 0 ? (
          <p style={{ color: T.text400, fontSize: 13 }}>No revenue recorded in this window.</p>
        ) : (
          <div className="fx-scroll-x" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 160 }}>
            {series.map((s) => {
              const net = s.net_cents || 0;
              // A day with more refunds than gross has negative net — flooring that
              // straight into the same height formula used to still draw a small
              // gold bar, visually implying revenue on a day that was actually a
              // net loss. Render those as a distinct (red) minimum-height marker.
              const isNegative = net < 0;
              const heightPx = isNegative ? 2 : Math.max(2, (net / maxNet) * 150);
              const isActive = activeDay?.day === s.day;
              return (
                <div
                  key={s.day}
                  title={`${s.day}: ${fmt(net)}`}
                  onClick={() => setActiveDay(s)}
                  onMouseEnter={() => setActiveDay(s)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${s.day}: ${fmt(net)}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDay(s); } }}
                  style={{
                    flex: '1 0 8px',
                    minWidth: 8,
                    height: `${heightPx}px`,
                    background: isNegative ? T.danger : T.primary,
                    opacity: isActive ? 1 : 0.85,
                    outline: isActive ? `2px solid ${T.text900}` : 'none',
                    outlineOffset: 1,
                    borderRadius: '4px 4px 0 0',
                    cursor: 'pointer',
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Above the SMS panel deliberately: this is the only section on the page
          that asks for a decision, and money sits unrecognised until it is made. */}
      <PendingCashPanel
        rows={cash}
        loading={cashLoading}
        error={cashError}
        approving={approving}
        onApprove={approveCash}
        onRetry={() => setRetryTick((t) => t + 1)}
      />

      <SmsProfitPanel sms={sms} loading={smsLoading} error={smsError} />
    </div>
  );
}
