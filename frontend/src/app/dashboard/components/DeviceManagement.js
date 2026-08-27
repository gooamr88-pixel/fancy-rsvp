'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../utils/apiClient';
import { toast } from '../../utils/toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import PlanLock from './PlanLock';
import { usePublicPricing } from '../../utils/usePublicPricing';
import { CHECKIN_APP_FEATURE_LABEL } from '../../utils/checkinApp';
import { buildCheckinReadiness, BLOCK, WARN } from './checkinReadiness';

const C = {
  gold: '#B8944F', charcoal: '#191B1E', ivory: '#F8F4EC', stone: '#77736A',
  border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8',
  danger: '#B03A2E', warn: '#C8871B', success: '#2E7D5B',
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box', background: C.white,
  border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px',
  fontSize: '16px', color: C.charcoal, outline: 'none', fontFamily: 'var(--font-sans)',
};

const relative = (iso) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

/**
 * Device management and pre-event readiness (amendment A-16 items 2 and 3).
 *
 * ── Gates come from the seating map (amendment A-17) ──
 *
 * A device is not given a typed label. It binds to a named `entrance` element on
 * this event's seating map, so the venue layout is the single source of truth for
 * the names that appear in the audit trail, in conflict reports, and here. If the
 * map has no entrance yet, provisioning is genuinely unavailable — and this screen
 * says so and links to the editor rather than showing an empty dropdown.
 *
 * ── Readiness is a blocker, not a hint ──
 *
 * §21.7: an unprepared spare is worthless at a venue with no internet. The
 * readiness panel is therefore worded as things that are wrong, listed first, and
 * only collapses to a green line when there is genuinely nothing to fix.
 */
export default function DeviceManagement({ eventId }) {
  const router = useRouter();
  const [devices, setDevices] = useState([]);
  const [gates, setGates] = useState([]);
  const [staff, setStaff] = useState([]);
  const [canProvision, setCanProvision] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedGate, setSelectedGate] = useState('');
  const [issued, setIssued] = useState(null); // { code, deviceLabel, expiresAt }
  const [revoking, setRevoking] = useState(null); // the device awaiting confirmation

  /**
   * Is the door app on this event's plan?
   *
   * Minting a pairing code is now `requireFeature('checkin_app')` — it is the
   * one moment the entitlement is decidable, since a tablet cannot pair without
   * a code. Without this the screen would look completely available and then
   * answer a 403 toast at the press of the only button that matters, which is
   * the exact walk-into-a-403 that PlanLock exists to prevent.
   *
   * Resolved from the server, not from `tier_features` in the browser, for the
   * reason DashboardNav states: a second implementation of "does this plan
   * include X" disagrees with the gate the first time an admin edits a tier.
   * `/checkin-app/release` carries the same `checkin_app` gate as pairing does,
   * so its 403 IS the answer. A failure that is not a gate denial leaves the
   * screen unlocked — a panel that cannot resolve an entitlement must not
   * invent a padlock over a feature the customer has paid for.
   */
  const [planLocked, setPlanLocked] = useState(false);
  const { tiers } = usePublicPricing();
  useEffect(() => {
    if (!eventId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        await apiFetch(`/events/${eventId}/checkin-app/release`);
        if (!cancelled) setPlanLocked(false);
      } catch (err) {
        if (cancelled) return;
        setPlanLocked(err?.code === 'FEATURE_NOT_AVAILABLE' || err?.code === 'FEATURE_REQUIRES_PAYMENT');
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const includedIn = (tiers || [])
    .filter((t) => (t.features || []).includes(CHECKIN_APP_FEATURE_LABEL))
    .map((t) => t.name);

  const load = useCallback(async () => {
    try {
      // The roster is fetched here as well as in the Door team tab, because
      // readiness is not readiness without it: a perfectly prepared tablet with
      // nobody on the sign-in list cannot check a single guest in. Both this
      // panel and the page header must reach the same verdict, so both feed the
      // same inputs into buildCheckinReadiness.
      const [deviceRes, gateRes, staffRes] = await Promise.all([
        apiFetch(`/checkin/events/${eventId}/devices`),
        apiFetch(`/checkin/events/${eventId}/gates`),
        apiFetch(`/checkin/events/${eventId}/staff`),
      ]);
      setDevices(deviceRes?.data?.devices || []);
      setStaff(staffRes?.data?.staff || []);
      const list = gateRes?.data?.gates || [];
      setGates(list);
      setCanProvision(!!gateRes?.data?.canProvision);
      // Keep the current choice only if that gate still exists. Entrances are
      // edited on a different screen, so a gate can be renamed away or deleted
      // between loads — and a stale id here would issue a pairing code against a
      // gate the organizer can no longer see, or fail with a confusing error.
      setSelectedGate((prev) => (
        list.some((g) => g.id === prev) ? prev : (list[0]?.id || '')
      ));
    } catch (err) {
      toast.error(err.message || 'Could not load devices.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      setLoading(true);
      await load();
    })();
  }, [eventId, load]);

  const issueCode = async () => {
    if (!selectedGate) return toast.error('Choose a gate first.');
    setBusy(true);
    try {
      const res = await apiFetch(`/checkin/events/${eventId}/devices/pairing-codes`, {
        method: 'POST',
        body: JSON.stringify({ gateTableId: selectedGate }),
      });
      setIssued(res?.data || null);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not create a pairing code.');
    } finally {
      setBusy(false);
    }
  };

  // Throws on failure so ConfirmDialog restores its buttons for a retry.
  const revoke = async (device) => {
    setBusy(true);
    try {
      await apiFetch(`/checkin/events/${eventId}/devices/${device.id}`, { method: 'DELETE' });
      toast.success('Device revoked.');
      setRevoking(null);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not revoke that device.');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const moveGate = async (device, gateTableId) => {
    setBusy(true);
    try {
      await apiFetch(`/checkin/events/${eventId}/devices/${device.id}/gate`, {
        method: 'PATCH',
        body: JSON.stringify({ gateTableId }),
      });
      // Stated explicitly because it is the surprising, correct behaviour.
      toast.success('Device moved. Guests already checked in keep the gate they arrived at.');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not move that device.');
    } finally {
      setBusy(false);
    }
  };

  const activeDevices = devices.filter((d) => d.isActive);
  const readiness = buildCheckinReadiness({ gates, devices, staff, staffLoaded: !loading });

  return (
    <div className="fx-stack" style={{ gap: '24px' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '20px', color: C.charcoal }}>Check-in devices</h3>
        <p style={{ margin: '6px 0 0', fontSize: '14px', color: C.stone, lineHeight: 1.6 }}>
          Tablets that scan guests in at the door. Each one is tied to a gate from
          your seating map, so arrival records always say which entrance a guest
          came through.
        </p>
      </div>

      <ReadinessPanel items={readiness} />

      {/* ── Provision ──
          Only this block is locked, never the device list below it. A tablet
          paired before the plan changed keeps working — the drain and delta
          endpoints are ungated by design (D-21) — so the organizer must still
          be able to see it, move it and revoke it. Taking that away would
          strand a live door, which is a worse outcome than an ungated one. */}
      {planLocked ? (
        <PlanLock
          title="The door app is part of a higher plan"
          description="Fancy Check-in holds your whole guest list on the tablet, so it keeps scanning and admitting guests with no internet at the venue — then syncs the moment it is back."
          plans={includedIn}
          upgradeLabel="See plans"
          onUpgrade={() => router.push('/pricing')}
        />
      ) : !canProvision ? (
        <div style={{
          background: C.softBg, border: `1px solid ${C.border}`,
          borderRadius: '14px', padding: '24px',
        }}>
          <h4 style={{ margin: 0, fontSize: '16px', color: C.charcoal }}>
            Add an entrance to your seating map first
          </h4>
          <p style={{ margin: '8px 0 16px', fontSize: '14px', color: C.stone, lineHeight: 1.6 }}>
            Devices are tied to gates, and gates come from the seating map. Add an
            entrance and give it the name your staff will use for it — &ldquo;Main
            entrance&rdquo;, &ldquo;Garden gate&rdquo; — then come back here.
          </p>
          <Link
            href="/dashboard/seating-map"
            style={{
              display: 'inline-block', background: C.gold, color: C.white,
              borderRadius: '10px', padding: '12px 24px', fontSize: '15px', textDecoration: 'none',
            }}
          >
            Open the seating map
          </Link>
        </div>
      ) : (
        <div style={{
          background: C.softBg, border: `1px solid ${C.border}`,
          borderRadius: '14px', padding: '20px',
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: C.stone, marginBottom: '6px' }}>
                Gate
              </label>
              <select
                style={inputStyle}
                value={selectedGate}
                onChange={(e) => setSelectedGate(e.target.value)}
              >
                {gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <button
              onClick={issueCode}
              disabled={busy}
              style={{
                background: C.gold, color: C.white, border: 'none', borderRadius: '10px',
                padding: '12px 24px', fontSize: '15px',
                cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >
              Create pairing code
            </button>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: '13px', color: C.stone }}>
            More than one tablet can share a gate — a busy main entrance often runs two.
          </p>
        </div>
      )}

      {issued && <PairingCode issued={issued} onDone={() => setIssued(null)} />}

      {/* ── Device list ── */}
      {loading ? (
        <p style={{ color: C.stone }}>Loading…</p>
      ) : activeDevices.length === 0 ? (
        <div style={{
          border: `1px dashed ${C.border}`, borderRadius: '14px',
          padding: '28px', textAlign: 'center', color: C.stone,
        }}>
          <p style={{ margin: 0, fontSize: '15px' }}>No tablets paired yet.</p>
        </div>
      ) : (
        <div className="fx-stack" style={{ gap: '10px' }}>
          {activeDevices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              gates={gates}
              busy={busy}
              onRevoke={() => setRevoking(device)}
              onMove={(gateId) => moveGate(device, gateId)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!revoking}
        title={`Revoke ${revoking?.label ?? ''}?`}
        body="The tablet stops working the moment it next reaches the internet, and erases its copy of the guest list. Anything it has already checked in but not yet sent would be lost with it — make sure it has nothing left to send before you do this."
        confirmLabel="Revoke tablet"
        danger
        onConfirm={() => revoke(revoking)}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}

function ReadinessPanel({ items }) {
  const blockers = items.filter((i) => i.level === BLOCK);
  const warnings = items.filter((i) => i.level === WARN);
  const clean = items.length === 0;

  const border = blockers.length ? C.danger : warnings.length ? C.warn : C.success;

  return (
    <div style={{
      background: C.white, border: `1px solid ${border}`, borderLeft: `4px solid ${border}`,
      borderRadius: '12px', padding: '20px',
    }}>
      <h4 style={{ margin: 0, fontSize: '16px', color: C.charcoal }}>Ready for the event?</h4>
      {clean ? (
        <p style={{ margin: '8px 0 0', fontSize: '15px', color: C.success }}>
          Everything is in place — tablets paired, guest list downloaded, and a spare ready.
        </p>
      ) : (
        <ul style={{ margin: '10px 0 0', paddingLeft: '20px' }}>
          {[...blockers, ...warnings].map((item, i) => (
            <li
              key={`${item.level}-${i}`}
              style={{
                fontSize: '14px', lineHeight: 1.7,
                color: item.level === BLOCK ? C.danger : C.warn,
              }}
            >
              {item.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The pairing code, shown once.
 *
 * Displayed as large monospaced text and as a QR (§18.3). The QR is rendered by
 * the existing backend endpoint rather than a client-side library — it already
 * serves PNGs for guest tickets, so there is nothing new to add to the bundle.
 */
/*
 * Responsive sizing for the code itself.
 *
 * ── The arithmetic this fixes ──
 *
 * At a 320px viewport the space this component actually gets is 168px:
 * 320 − 40 (.fx-gutter) − 56 (the tab panel's padding) − 56 (this card's).
 * The code was set at 48px monospace with 10px of tracking, so eight
 * characters needed 8 × (0.6 × 48 + 10) = 310px. It overflowed by 142px — the
 * page's `overflow-x: clip` guard then HID the overflow rather than scrolling
 * it, so the last characters of the pairing code were simply unreachable on a
 * phone. An unreadable pairing code is an unpairable tablet.
 *
 * clamp() rather than a media query because these are inline styles, and an
 * inline style object cannot hold one (see frontend/AGENTS.md). clamp is a
 * value, not a rule, so it works here.
 *
 * At 320px this resolves to 24px / 2.88px → 8 × (14.4 + 2.88) = 138px, inside
 * the 212px left once the paddings below shrink too.
 */
const CODE_SIZE = 'clamp(24px, 7.5vw, 48px)';
const CODE_TRACKING = 'clamp(2px, 0.9vw, 10px)';

function PairingCode({ issued, onDone }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!issued?.expiresAt) return undefined;
    const tick = () => {
      const secs = Math.max(0, Math.round((new Date(issued.expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [issued]);

  const expired = remaining === 0;

  return (
    <div style={{
      background: C.charcoal, borderRadius: '14px',
      padding: 'clamp(16px, 4vw, 28px)', textAlign: 'center',
    }}>
      <p style={{ margin: 0, fontSize: '14px', color: C.ivory, opacity: 0.75 }}>
        On the tablet, enter this code for <strong>{issued.deviceLabel}</strong>
      </p>

      <div style={{
        margin: '18px 0',
        // A real stack, not bare `monospace` — that resolves to the browser's
        // default mono face, which on Windows is Courier New: narrow, light, and
        // the worst possible face for reading a code off one screen and typing
        // it into another.
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontSize: CODE_SIZE,
        letterSpacing: CODE_TRACKING,
        // letter-spacing adds its space AFTER every character including the
        // last, so a centred run sits half a tracking-unit left of true centre.
        // Padding the start by one full unit moves it back by half. Visible at
        // 10px tracking; this is the difference between "centred" and "nearly".
        paddingInlineStart: CODE_TRACKING,
        color: expired ? C.stone : C.gold,
        textDecoration: expired ? 'line-through' : 'none',
      }}>
        {issued.code}
      </div>

      <p style={{ margin: 0, fontSize: '14px', color: expired ? C.danger : C.ivory, opacity: expired ? 1 : 0.75 }}>
        {expired
          ? 'This code has expired. Create another one.'
          : `Expires in ${Math.floor((remaining ?? 0) / 60)}:${String((remaining ?? 0) % 60).padStart(2, '0')} · single use`}
      </p>

      <button
        onClick={onDone}
        style={{
          marginTop: '20px', background: 'transparent', color: C.ivory,
          border: `1px solid ${C.stone}`, borderRadius: '10px',
          padding: '10px 22px', cursor: 'pointer', fontSize: '14px',
        }}
      >
        Done
      </button>
    </div>
  );
}

function DeviceRow({ device, gates, busy, onRevoke, onMove }) {
  const [moving, setMoving] = useState(false);

  const health = [
    device.batteryLevel != null ? `${device.batteryLevel}% battery` : null,
    device.storageFreeMb != null ? `${device.storageFreeMb} MB free` : null,
    device.bundleVersion != null ? `guest list v${device.bundleVersion}` : 'guest list not downloaded',
    device.queueDepth ? `${device.queueDepth} to send` : null,
    `seen ${relative(device.lastSeenAt)}`,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`,
      borderRadius: '12px', padding: '16px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ fontSize: '16px', color: C.charcoal }}>
            {device.label}
            {device.gateMissing && (
              <span style={{ marginLeft: '8px', fontSize: '12px', color: C.warn }}>
                gate removed from map
              </span>
            )}
          </div>
          <div style={{ fontSize: '13px', color: C.stone, marginTop: '2px' }}>{health}</div>
          {device.wipePending && (
            <div style={{ fontSize: '13px', color: C.warn, marginTop: '2px' }}>
              Will erase its guest list on next contact.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            onClick={() => setMoving((v) => !v)}
            disabled={busy || gates.length === 0}
            style={{
              background: 'transparent', color: C.charcoal, border: `1px solid ${C.border}`,
              borderRadius: '8px', padding: '10px 16px', cursor: 'pointer', fontSize: '14px',
            }}
          >
            Move gate
          </button>
          <button
            onClick={onRevoke}
            disabled={busy}
            style={{
              background: 'transparent', color: C.danger, border: `1px solid ${C.border}`,
              borderRadius: '8px', padding: '10px 16px', cursor: 'pointer', fontSize: '14px',
            }}
          >
            Revoke
          </button>
        </div>
      </div>

      {moving && (
        <div style={{ marginTop: '14px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            style={{ ...inputStyle, width: 'auto', minWidth: '220px' }}
            defaultValue={device.gateId || ''}
            onChange={(e) => { onMove(e.target.value); setMoving(false); }}
          >
            <option value="" disabled>Choose a gate…</option>
            {gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <span style={{ fontSize: '13px', color: C.stone }}>
            Guests already checked in keep the gate they arrived at.
          </span>
        </div>
      )}
    </div>
  );
}
