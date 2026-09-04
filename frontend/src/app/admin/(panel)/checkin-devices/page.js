'use client';

import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { T, card } from '../../_components/theme';
import DataTable from '../../_components/DataTable';
import FilterBar from '../../_components/FilterBar';
import StatCard from '../../_components/StatCard';
import { StatusBadge, Button } from '../../_components/Modal';
import { usePermissions } from '../../_hooks/usePermissions';
import { useAlert } from '../../_components/AlertContext';
import adminApi from '../../_lib/adminApi';

/**
 * Super-admin check-in device registry (amendment A-16).
 *
 * Spans every organization, which is the point: the case this exists for is
 * "a client's tablet was stolen", and requiring an operator to first work out
 * which organizer owns it is exactly the wrong response.
 *
 * ── The column that matters most ──
 *
 * "Holding old data". §20.5 auto-purges a device's guest list 7 days after the
 * event — but only on next launch. A tablet switched off in a drawer keeps the
 * complete guest list of a private event indefinitely. This screen is how that
 * becomes visible rather than staying theoretical.
 */

const STALE_OPTIONS = [
  { value: '', label: 'All devices' },
  { value: '7', label: 'Not seen in 7 days' },
  { value: '30', label: 'Not seen in 30 days' },
];

function relative(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function CheckinDevicesPage() {
  const { can } = usePermissions();
  // Reading the registry and destroying data on a device are separate
  // permissions, so a support role can investigate "which tablets still hold
  // guest data" without also being able to remotely wipe a client's list.
  const canManage = can('security.manage');
  const { showConfirm, showToast } = useAlert();

  const [staleDays, setStaleDays] = useState('');
  const [q, setQ] = useState('');

  /* `staleDays` plus this tick name the request the screen currently wants;
     revoking or wiping bumps the tick because both change what the registry
     holds. */
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => { setReloadTick((t) => t + 1); }, []);
  const wanted = `${staleDays}|${reloadTick}`;

  /* One state carrying the answer AND which request it answers. "Loading" is
     then a comparison rather than a fourth flag raised at the top of the fetch
     and lowered in a `finally` — and the `cancelled` guard closes a real race
     the old shape had: switching the filter twice quickly could land the first
     response last and leave the table showing rows for the wrong filter. */
  const [result, setResult] = useState(null);
  const loading = result?.key !== wanted;
  const rows = result?.rows || [];
  const counts = result?.counts || null;

  /* Reported through an Effect Event so the load does not DEPEND on the
     reporter. `showToast` is a plain function rebuilt on every AlertProvider
     render, and the provider re-renders both when a toast appears and again
     when it auto-dismisses three seconds later. With it in the dependency list
     a failed load raised a toast, the toast re-rendered the provider, the new
     identity re-ran the effect, and the load failed again — an endless
     fetch-and-toast loop for as long as the endpoint was down, and two
     redundant refetches even on a successful one. This was the only effect in
     the app that listed it. */
  const reportLoadFailure = useEffectEvent((message) => {
    showToast(message || 'Could not load devices.', 'error');
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminApi.get('/checkin/devices', { staleDays: staleDays || undefined });
        if (cancelled) return;
        setResult({ key: wanted, rows: res?.data?.devices || [], counts: res?.data?.counts || null });
      } catch (err) {
        if (cancelled) return;
        reportLoadFailure(err.message);
        // Keep whatever is already on screen: a failed refresh is a worse
        // reason to empty a stolen-tablet registry than to leave it stale.
        setResult((prev) => ({ key: wanted, rows: prev?.rows || [], counts: prev?.counts || null }));
      }
    })();
    return () => { cancelled = true; };
  }, [wanted, staleDays]);

  const revoke = async (device) => {
    const ok = await showConfirm(
      `This tablet stops working immediately and erases its copy of ${device.orgName || 'the organizer'}'s guest list the next time it reaches the internet. It will need pairing again to be used.`,
      `Revoke ${device.label}?`,
      'danger',
    );
    if (!ok) return;

    try {
      await adminApi.del(`/checkin/devices/${device.id}`);
      showToast('Device revoked.');
      reload();
    } catch (err) {
      showToast(err.message || 'Could not revoke.', 'error');
    }
  };

  const wipe = async (device) => {
    const ok = await showConfirm(
      'The tablet stays paired and can be used for future events — it just forgets this one. It erases the next time it reaches the internet, which may be a while if it is switched off.',
      `Erase the guest list on ${device.label}?`,
      'warning',
    );
    if (!ok) return;

    try {
      await adminApi.post(`/checkin/devices/${device.id}/wipe`);
      showToast('Erase requested.');
      reload();
    } catch (err) {
      showToast(err.message || 'Could not request an erase.', 'error');
    }
  };

  // Filtered client-side: the registry is a few hundred rows at most, and a
  // server round trip per keystroke would be slower than the filter it replaces.
  const filtered = q
    ? rows.filter((r) => `${r.label} ${r.eventTitle || ''} ${r.orgName || ''}`.toLowerCase().includes(q.toLowerCase()))
    : rows;

  const columns = [
    {
      key: 'label',
      header: 'Device',
      render: (r) => (
        <div>
          <div style={{ color: T.text900, fontWeight: 600 }}>{r.label}</div>
          <div style={{ fontSize: 11.5, color: T.text500 }}>
            {r.appVersion ? `v${r.appVersion}` : 'version unknown'}
          </div>
        </div>
      ),
    },
    {
      key: 'org',
      header: 'Organizer / event',
      render: (r) => (
        <div>
          <div style={{ color: T.text900 }}>{r.orgName || '—'}</div>
          <div style={{ fontSize: 11.5, color: T.text500 }}>{r.eventTitle || '—'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        if (!r.isActive) return <StatusBadge status="canceled" label="Revoked" />;
        if (r.wipePending) return <StatusBadge status="past_due" label="Erase pending" />;
        if (r.holdingStaleData) return <StatusBadge status="past_due" label="Holding old data" />;
        return <StatusBadge status="active" label="Active" />;
      },
    },
    {
      key: 'health',
      header: 'Health',
      render: (r) => (
        <div style={{ fontSize: 11.5, color: T.text500 }}>
          {[
            r.batteryLevel != null ? `${r.batteryLevel}%` : null,
            r.storageFreeMb != null ? `${r.storageFreeMb} MB free` : null,
            // Non-zero here means it stopped reporting with arrivals still
            // unsent — the case worth chasing, because those exist nowhere else.
            r.queueDepth ? `${r.queueDepth} unsent` : null,
            r.bundleVersion != null ? `list v${r.bundleVersion}` : 'no guest list',
          ].filter(Boolean).join(' · ') || '—'}
        </div>
      ),
    },
    { key: 'lastSeenAt', header: 'Last seen', render: (r) => relative(r.lastSeenAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        canManage && r.isActive ? (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {/* Erase is recoverable — the tablet stays paired. Revoke is not. */}
            <Button variant="warning" onClick={() => wipe(r)}>Erase</Button>
            <Button variant="danger" onClick={() => revoke(r)}>Revoke</Button>
          </div>
        ) : null
      ),
    },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 22, color: T.text900, margin: '0 0 4px', fontFamily: 'var(--font-serif)' }}>
        Check-in devices
      </h1>
      <p style={{ fontSize: 13, color: T.text500, margin: '0 0 20px', maxWidth: 720, lineHeight: 1.6 }}>
        Every tablet paired for door check-in, across all organizers. Each one holds
        a copy of its event&rsquo;s guest list, so a tablet that has stopped
        reporting is a private guest list nobody is watching.
      </p>

      {counts && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          <StatCard label="Devices" value={counts.total} />
          <StatCard label="Active" value={counts.active} accent={T.primary} />
          <StatCard label="Erase pending" value={counts.wipePending} />
          <StatCard
            label="Holding old data"
            value={counts.holdingStaleData}
            accent={counts.holdingStaleData > 0 ? '#C8871B' : undefined}
          />
        </div>
      )}

      {counts?.holdingStaleData > 0 && (
        <div style={{ ...card, padding: 16, marginBottom: 20, borderLeft: '3px solid #C8871B' }}>
          <div style={{ fontSize: 13, color: T.text900, fontWeight: 600 }}>
            {counts.holdingStaleData} {counts.holdingStaleData === 1 ? 'device is' : 'devices are'} still
            holding a guest list for an event that has finished.
          </div>
          <div style={{ fontSize: 12, color: T.text500, marginTop: 4, lineHeight: 1.6 }}>
            Devices erase themselves 7 days after an event, but only once they are
            switched on and online. Requesting an erase queues it for the next time
            each one connects.
          </div>
        </div>
      )}

      <FilterBar onSearch={setQ} placeholder="Device, event or organizer…">
        <select
          value={staleDays}
          onChange={(e) => setStaleDays(e.target.value)}
          style={{
            minHeight: 44, padding: '10px 14px', border: `1px solid ${T.border}`,
            borderRadius: T.radiusSm, fontSize: 13.5, background: T.surface,
            color: T.text900, outline: 'none',
          }}
        >
          {STALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FilterBar>

      <DataTable
        title="Registry"
        columns={columns}
        rows={filtered}
        loading={loading}
        emptyText="No check-in devices match."
        rowKey={(r) => r.id}
        onRefresh={load}
      />
    </div>
  );
}
