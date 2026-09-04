'use client';

/* `React` is imported and it is NOT unused. Next compiles JSX with the automatic
   runtime, but vitest compiles it with the CLASSIC one, so every element here
   becomes React.createElement at test time. Without it the screenshot probe
   throws "React is not defined" while the app itself keeps building. */
import React from 'react';
import { T, card } from '../../_components/theme';
import { money } from '../../_lib/format';

const fmt = (cents) => money(cents, 0);

/**
 * Extracted from finance/page.js so it can be rendered on its own and LOOKED AT
 * (test/shots/pendingCashProbe). A money surface whose button marks an event
 * PAID, rendering a table - the shape most likely to push a page sideways - is
 * not something to ship on the strength of a string assertion. A Next page.js
 * cannot export it: extra named exports from a route segment are not free.
 */
export default function PendingCashPanel({ rows, loading, error, onApprove, approving, onRetry }) {
  if (loading) {
    return <div style={{ ...card, padding: 24, color: T.text500, fontSize: 13 }}>Loading cash payments…</div>;
  }
  if (error) {
    return (
      <div style={{ ...card, padding: 24, color: T.text500, fontSize: 13 }}>
        {error}{' '}
        <button
          type="button"
          onClick={onRetry}
          style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: 0 }}
        >
          Try again
        </button>
      </div>
    );
  }

  const list = Array.isArray(rows) ? rows : [];

  return (
    <section style={{ marginTop: 34 }}>
      <header style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: T.text900, margin: 0, fontFamily: 'var(--font-serif)' }}>
          Cash payments awaiting approval
          {list.length > 0 && (
            <span style={{
              marginLeft: 9, padding: '2px 9px', borderRadius: 999, fontSize: 12,
              fontWeight: 800, color: '#8A5A12', background: 'rgba(184,137,79,0.16)',
              fontFamily: 'var(--font-sans)', verticalAlign: 'middle',
            }}>
              {list.length}
            </span>
          )}
        </h2>
        <p style={{ fontSize: 12.5, color: T.text500, margin: '4px 0 0' }}>
          Paid outside Stripe. The event stays unpaid until one of these is approved.
        </p>
      </header>

      {list.length === 0 ? (
        <div style={{ ...card, padding: 24, color: T.text500, fontSize: 13 }}>
          Nothing waiting.
        </div>
      ) : (
        <div style={{ ...card, padding: 20 }}>
          <div className="fx-scroll-x">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Organizer', 'Event', 'Amount', 'Received', ''].map((h, i) => (
                    <th
                      key={h || 'action'}
                      style={{
                        textAlign: i >= 2 ? 'right' : 'left', padding: '7px 10px', color: T.text400,
                        fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase',
                        letterSpacing: '0.06em', whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const ev = p.events || {};
                  const org = ev.organizations || {};
                  const busy = approving === p.id;
                  return (
                    <tr key={p.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: '9px 10px', color: T.text900, fontWeight: 600 }}>
                        {org.name || '—'}
                        {org.email && (
                          <div style={{ fontSize: 11, color: T.text500, fontWeight: 400 }}>{org.email}</div>
                        )}
                      </td>
                      <td style={{ padding: '9px 10px', color: T.text900 }}>{ev.title || '—'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', color: T.text900, fontWeight: 800 }}>
                        {fmt(p.amount_cents)}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', color: T.text500, whiteSpace: 'nowrap' }}>
                        {p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        {/* The amount is sent back exactly as stored rather than
                            re-entered: this screen approves a payment that already
                            happened, and a second chance to type a figure is a
                            second chance to type the wrong one. */}
                        <button
                          type="button"
                          disabled={busy || !ev.id}
                          onClick={() => onApprove(p)}
                          style={{
                            background: busy ? T.border : T.primary, color: '#FFF', border: 'none',
                            borderRadius: 7, padding: '7px 14px', fontSize: 12.5, fontWeight: 700,
                            cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          {busy ? 'Approving…' : 'Approve'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
