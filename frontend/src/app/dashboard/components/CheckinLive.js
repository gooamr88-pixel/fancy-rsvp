'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../utils/apiClient';
import { toast } from '../../utils/toast';

const C = {
  gold: '#B8944F', charcoal: '#191B1E', stone: '#77736A', border: '#E8E2D6',
  white: '#FFFFFF', softBg: '#FAFAF8', danger: '#B03A2E', warn: '#C8871B', success: '#2E7D5B',
};

import { useOrganizerTimeZone } from './OrganizerClock';
import { formatInZone } from '../../utils/timezone';

const REFRESH_MS = 15_000;

// Takes the zone rather than reading it: hooks cannot be called from a
// module-level helper, so the component resolves it once and passes it in.
const fmtTime = (iso, timeZone) => formatInZone(iso, timeZone, { hour: '2-digit', minute: '2-digit' }) || '—';

/**
 * Live check-in view (amendment A-16 item 4; spec §8.6 for the organizer).
 *
 * Reuses the post-event report endpoint in `json` mode rather than adding a
 * parallel stats endpoint. That is deliberate: the report already computes every
 * figure here — attendance, arrivals over time, category breakdown, per-staff
 * activity — and a second implementation would eventually disagree with the file
 * the client is emailed afterwards. One computation, two presentations.
 *
 * Polled rather than pushed. The realtime channel has no authorisation model yet
 * (discovery finding R-2), and an organizer watching a number tick is well served
 * by a 15-second refresh.
 */
export default function CheckinLive({ eventId }) {
  const timeZone = useOrganizerTimeZone();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Not an error. The report is gated on qr_checkin/manual_checkin, so an event
  // whose plan lacks both gets a 403 every time — retrying can only fail again,
  // and showing the API's sentence next to a "Try again" button invites exactly
  // that. It needs a different surface, so it is tracked separately.
  const [locked, setLocked] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/checkin/events/${eventId}/report?format=json`);
      setReport(res?.data || null);
      setError(null);
      setLocked(null);
    } catch (err) {
      if (err.status === 403 && (err.code === 'FEATURE_NOT_AVAILABLE' || err.code === 'FEATURE_REQUIRES_PAYMENT')) {
        setLocked(err.message || 'Door check-in is not included in this event’s plan.');
        setError(null);
      } else {
        setError(err.message || 'Could not load attendance.');
      }
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return undefined;
    let cancelled = false;

    (async () => {
      setLoading(true);
      await load();
    })();

    // Stop polling once the plan has locked the feature: nothing about the
    // answer can change while the organizer sits on this tab, and a 403 every
    // 15 seconds is just noise in the logs.
    if (locked) return () => { cancelled = true; };

    const id = setInterval(() => { if (!cancelled) load(); }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [eventId, load, locked]);

  if (loading) return <p style={{ color: C.stone }}>Loading…</p>;
  if (locked) {
    return (
      <div style={{
        background: C.softBg, border: `1px solid ${C.border}`, borderRadius: '12px',
        padding: '24px', textAlign: 'center',
      }}>
        <p style={{ margin: '0 0 8px', color: C.charcoal, fontSize: '16px', fontWeight: 600 }}>
          Live attendance is not part of this plan
        </p>
        <p style={{ margin: '0 0 16px', color: C.stone, fontSize: '14px', lineHeight: 1.6 }}>
          {locked}
        </p>
        {/* next/link, not a bare anchor: /pricing is a route in this app, and a
            full document load here throws away the dashboard the organizer is
            standing in to reach a page they will come straight back from. */}
        <Link
          href="/pricing"
          style={{
            display: 'inline-block', background: C.gold, color: C.white,
            borderRadius: '8px', padding: '10px 20px', fontSize: '14px',
            fontWeight: 600, textDecoration: 'none',
          }}
        >
          View plans
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ color: C.danger, fontSize: '15px' }}>
        {error}
        <button
          onClick={load}
          style={{
            marginLeft: '12px', background: 'transparent', color: C.charcoal,
            border: `1px solid ${C.border}`, borderRadius: '8px',
            padding: '8px 16px', minHeight: 'var(--fx-touch)', cursor: 'pointer', fontSize: '14px',
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!report) return null;

  const { stats } = report;
  const peak = stats.peakWindow;

  return (
    <div className="fx-stack" style={{ gap: '28px' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '20px', color: C.charcoal }}>Arrivals</h3>
        <p style={{ margin: '6px 0 0', fontSize: '13px', color: C.stone }}>
          Updates every {REFRESH_MS / 1000} seconds.
        </p>
      </div>

      {/* ── Headline ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '56px', lineHeight: 1, color: C.success, fontWeight: 700 }}>
          {stats.totals.arrived}
        </span>
        <span style={{ fontSize: '18px', color: C.stone, paddingBottom: '6px' }}>
          of {stats.totals.confirmedYes} expected · {stats.totals.attendanceRate}%
        </span>
      </div>

      <div style={{ height: '10px', background: C.border, borderRadius: '5px', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(stats.totals.attendanceRate, 100)}%`,
          height: '100%', background: C.success,
        }} />
      </div>

      <div className="fx-grid fx-grid--4 fx-grid--gap-sm">
        <Stat label="Still to arrive" value={stats.totals.noShows} />
        <Stat label="First arrival" value={fmtTime(stats.firstArrivalAt, timeZone)} />
        <Stat label="Latest arrival" value={fmtTime(stats.lastArrivalAt, timeZone)} />
        <Stat
          label="Busiest 15 min"
          value={peak ? `${fmtTime(peak.startsAt, timeZone)} · ${peak.arrivals}` : '—'}
        />
      </div>

      {/* ── Anything that needs attention, before the breakdowns ── */}
      {(stats.anomalies.conflicts > 0
        || stats.anomalies.unverifiedScans > 0
        || stats.anomalies.reversedAdmissions > 0) && (
        <div style={{
          background: C.white, border: `1px solid ${C.warn}`,
          borderLeft: `4px solid ${C.warn}`, borderRadius: '12px', padding: '16px 20px',
        }}>
          <div style={{ fontSize: '15px', color: C.charcoal }}>
            {[
              stats.anomalies.unresolvedConflicts && `${stats.anomalies.unresolvedConflicts} duplicate admissions to review`,
              stats.anomalies.unverifiedScans && `${stats.anomalies.unverifiedScans} tickets that did not check out`,
              stats.anomalies.reversedAdmissions && `${stats.anomalies.reversedAdmissions} reversed`,
            ].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: '13px', color: C.stone, marginTop: '4px' }}>
            See the Checks tab.
          </div>
        </div>
      )}

      <Breakdown
        title="By category"
        rows={stats.byCategory.map((r) => ({ key: r.key, value: `${r.arrived} of ${r.count}` }))}
      />
      <Breakdown
        title="Checked in by"
        rows={stats.byStaff.map((r) => ({ key: r.key, value: r.count }))}
        empty="Nobody has checked a guest in yet."
      />
      <Breakdown
        title="By gate"
        rows={stats.byDevice.map((r) => ({ key: r.key, value: r.count }))}
        empty="No arrivals recorded at a gate yet."
      />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{
      background: C.softBg, border: `1px solid ${C.border}`,
      borderRadius: '10px', padding: '14px 16px',
    }}>
      <div style={{ fontSize: '12px', color: C.stone, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '20px', color: C.charcoal, marginTop: '4px' }}>{value}</div>
    </div>
  );
}

function Breakdown({ title, rows, empty }) {
  return (
    <div>
      <h4 style={{ margin: '0 0 8px', fontSize: '16px', color: C.charcoal }}>{title}</h4>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: '14px', color: C.stone }}>{empty || 'Nothing yet.'}</p>
      ) : (
        <div className="fx-stack" style={{ gap: '6px' }}>
          {rows.map((r) => (
            <div
              key={r.key}
              style={{
                display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
                borderBottom: `1px solid ${C.border}`, padding: '8px 0', fontSize: '15px',
              }}
            >
              <span style={{ color: C.charcoal }}>{r.key}</span>
              <span style={{ color: C.stone }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
