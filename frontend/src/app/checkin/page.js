'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { logout } from '../utils/apiClient';
import LogoutModal from '../components/LogoutModal';
import FeatureGate from '../dashboard/components/FeatureGate';
import ImpersonationBanner from '../components/ImpersonationBanner';
import { useIsClient } from '../utils/useIsClient';
import { playAccept, playError, buzz } from '../utils/sound';
import Icon from '../components/icons/Icon';
import SeatingMiniMap from '../[slug]/rsvp/SeatingMiniMap';
import { formatInZone } from '../utils/timezone';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const C = { gold: '#B8944F', goldHover: '#a6833f', charcoal: '#191B1E', ivory: '#F8F4EC', champagne: '#D7BE80', stone: '#77736A', border: '#E8E2D6', white: '#FFFFFF' };
// Roomier padding + 16px font for touch kiosks (16px also prevents iOS focus-zoom).
const inputStyle = { width: '100%', boxSizing: 'border-box', background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '16px 18px', fontSize: '16px', color: C.charcoal, outline: 'none', fontFamily: 'var(--font-sans)', transition: 'border-color 0.25s ease' };

// QR tickets encode a "<origin>/ticket/<token>" link (guest-facing); pull the
// bare token back out of it for this endpoint. Falls back to the raw scanned
// text so a still-bare token (older emailed tickets) keeps working.
const extractTicketToken = (raw) => {
  const text = (raw || '').trim();
  const match = text.match(/\/ticket\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : text;
};

export default function CheckInPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState(null);
  // Full venue layout (tables + zones) for the active event — fetched once
  // per event, then reused to highlight whichever guest is selected on a
  // wayfinding map, so staff can see exactly where to point them.
  const [seatingElements, setSeatingElements] = useState([]);
  const [qrTokenInput, setQrTokenInput] = useState('');
  const [scanStatus, setScanStatus] = useState(null);
  const [totalArrivals, setTotalArrivals] = useState(0);
  const [checkInLogs, setCheckInLogs] = useState([]);
  const [showConfirmOverlay, setShowConfirmOverlay] = useState(false);
  const [overlayData, setOverlayData] = useState(null);

  /**
   * Reversing an arrival.
   *
   * ── Why this needed its own dialog rather than a confirm ──
   *
   * The server REQUIRES a reason (400 REASON_REQUIRED without one) and writes it
   * to the audit trail beside who did it, because an undo erases the evidence
   * that someone was admitted. So the UI has to collect free text, and the
   * result overlay above is a report with no input in it.
   *
   * Until now this console had no way to reverse anything at all: the only
   * action button was hidden behind `!isCheckedIn`, so once a guest was marked
   * arrived the panel became read-only and a mis-tap was permanent from here.
   * The endpoint has existed and been tested the whole time — nothing called it.
   */
  const [undoTarget, setUndoTarget] = useState(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoBusy, setUndoBusy] = useState(false);

  // Escape closes it, like every dialog anyone has ever met. Not while a request
  // is in flight: dismissing then would hide an action that is still going to
  // land, and the operator would have no idea whether it did.
  useEffect(() => {
    if (!undoTarget) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !undoBusy) { setUndoTarget(null); setUndoReason(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoTarget, undoBusy]);

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [eventIdSeeded, setEventIdSeeded] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  // isClient gates every localStorage read below until we're past hydration
  // (SSR has no localStorage, and reading it before hydration would produce a
  // client/server markup mismatch). authReady replaces the old authReady +
  // authChecked pair, which were always set to the same value together —
  // there was never a case where they differed.
  const isClient = useIsClient();
  const orgId = isClient ? localStorage.getItem('org_id') : null;
  const authReady = isClient && !!orgId;
  // Check-in is very often run on a tablet/phone at the venue over spotty wifi.
  // This page previously had zero connectivity awareness — a dropped
  // connection just surfaced as a generic "Could not connect" error with no
  // indication of whether the check-in silently succeeded server-side before
  // the response was lost, and staff had to blindly re-tap (risking a
  // duplicate-check-in race).
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const router = useRouter();
  // Ref-based re-entry guards (independent of React's render cycle, so they
  // catch a rapid double-tap even before the disabled state below re-renders)
  // for the two check-in submit paths — mirrors useIdempotentRsvpSubmit's
  // pattern on the guest-facing RSVP flow, which this kiosk page lacked.
  const manualCheckInInFlight = useRef(false);
  const qrCheckInInFlight = useRef(false);
  const undoInFlight = useRef(false);
  const [manualCheckInBusy, setManualCheckInBusy] = useState(false);
  const [qrCheckInBusy, setQrCheckInBusy] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  useEffect(() => { if (showConfirmOverlay) { const timer = setTimeout(() => setShowConfirmOverlay(false), 3200); return () => clearTimeout(timer); } }, [showConfirmOverlay]);

  const [showLogoutModal, setShowLogoutModal] = useState(false);

  /* The clock the arrival log is stamped on.
     Read off the SELECTED EVENT rather than the device. A check-in kiosk is
     routinely a rented, borrowed, or freshly-unboxed machine whose timezone
     nobody has ever looked at, so its own clock is not evidence of anything —
     and this log is the record staff read back when a guest disputes whether
     they were already admitted. Derived rather than stored in state: it is a
     pure function of two values already held here, so a third piece of state
     could only ever disagree with them. */
  const eventTimeZone = events.find((e) => e.id === eventId)?.timezone || null;

  // Seed eventId from localStorage the moment we know authReady — adjusting
  // state during render (like RsvpWizard's prevLangParam) rather than in an
  // effect, since this is a one-time "derive initial value once a precondition
  // is met" case, not a subscription to an external system.
  if (authReady && !eventIdSeeded) {
    setEventIdSeeded(true);
    const savedEventId = localStorage.getItem('active_event_id');
    if (savedEventId) setEventId(savedEventId);
  }

  // The redirect itself is a genuine imperative side effect (navigation),
  // which does need an effect — but it no longer also carries state updates.
  useEffect(() => {
    if (isClient && !orgId) router.push('/login');
  }, [isClient, orgId, router]);

  useEffect(() => {
    if (!authReady) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/events`, { credentials: 'include' });
        const data = await res.json();
        if (data.success && data.events.length > 0) {
          setEvents(data.events);
          if (!eventId) setEventId(data.events[0].id);
        } else if (!eventId) {
          setError('Please select an event first. Go to the Dashboard to create or select an event.');
          setLoading(false);
        }
      } catch (err) {
        if (!eventId) {
          setError('Please select an event first. Go to the Dashboard to create or select an event.');
          setLoading(false);
        }
      }
    })();
  }, [authReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchCheckInSummary = useCallback(async () => {
    if (!eventId || !authReady) return;
    try { const res = await fetch(`${API_URL}/events/${eventId}/stats`, { credentials: 'include' }); const data = await res.json(); if (data.success) { setTotalArrivals(data.stats.checkedInGuests); setError(null); } }
    catch (err) { setError('Could not connect to backend check-in server. Make sure port 5000 is running.'); }
    finally { setLoading(false); }
  }, [eventId, authReady]);

  useEffect(() => {
    if (!eventId) return;
    (async () => { await fetchCheckInSummary(); })();
  }, [fetchCheckInSummary, eventId]);

  // Full venue layout, fetched once per active event (not per guest) — the
  // wayfinding map below just re-highlights whichever table the currently
  // selected guest is assigned to. ?include=all pulls in venue zones (bar,
  // entrance, dance floor…) alongside tables, same as the organizer's own
  // seating-map editor, so staff get real landmarks to orient by.
  useEffect(() => {
    if (!eventId || !authReady) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/events/${eventId}/tables?include=all`, { credentials: 'include' });
        const data = await res.json();
        if (!cancelled && data.success) setSeatingElements(data.tables || []);
      } catch { /* wayfinding map is a nice-to-have — search/check-in still work without it */ }
    })();
    return () => { cancelled = true; };
  }, [eventId, authReady]);

  // Clearing the results the instant the query goes empty (and flagging a
  // non-empty query as "searching" right away, before the debounce below
  // even fires) is a pure reset-on-change — adjusted during render rather
  // than via an effect. This is what lets the "no guest found" state below
  // only ever appear once a search has actually completed, never as a flash
  // between keystrokes. The actual debounced search fetch (which genuinely
  // needs to wait/subscribe) stays in its own effect below.
  const [prevSearchQuery, setPrevSearchQuery] = useState(searchQuery);
  if (searchQuery !== prevSearchQuery) {
    setPrevSearchQuery(searchQuery);
    if (!searchQuery.trim()) { setSearchResults([]); setSearching(false); }
    else setSearching(true);
  }

  useEffect(() => {
    if (!eventId || !authReady || !searchQuery.trim()) return;
    const delaySearch = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/events/${eventId}/checkin/search?query=${encodeURIComponent(searchQuery)}`, { credentials: 'include' });
        const data = await res.json();
        if (data.success) setSearchResults(data.data?.results || []);
      } catch (err) { /* search failed silently */ }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(delaySearch);
  }, [searchQuery, eventId, authReady]);

  // A dropped connection at the venue previously meant an immediate hard
  // failure with no way to know whether the check-in landed server-side
  // before the response was lost. One quiet automatic retry (matching the
  // pattern used elsewhere in this codebase for transient blips) smooths over
  // a brief blip instead of forcing staff to guess and re-tap, which risked
  // racing the ALREADY_CHECKED_IN guard.
  const fetchWithRetry = useCallback(async (url, options) => {
    try {
      return await fetch(url, options);
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return fetch(url, options);
    }
  }, []);

  const handleManualCheckIn = async (partyId) => {
    if (!authReady) return;
    if (!isOnline) { setOverlayData({ type: 'error', message: 'No internet connection. Reconnect and try again.' }); setShowConfirmOverlay(true); return; }
    if (manualCheckInInFlight.current) return;
    manualCheckInInFlight.current = true;
    setManualCheckInBusy(true);
    try {
      const res = await fetchWithRetry(`${API_URL}/events/${eventId}/checkin/manual`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ partyId }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.message || 'Check-in failed');
      if (data.success) {
        const result = data.data;
        playAccept(); buzz([12, 24, 12]);
        setSelectedGuest(prev => prev ? { ...prev, isCheckedIn: true, checkedInAt: formatInZone(Date.now(), eventTimeZone, { hour: '2-digit', minute: '2-digit' }) } : null);
        setCheckInLogs(logs => [{ partyId, guestName: result.guestName, partySize: result.partySize, tableName: result.tableName, checkedInAt: formatInZone(Date.now(), eventTimeZone, { hour: '2-digit', minute: '2-digit' }), method: 'manual_search' }, ...logs]);
        fetchCheckInSummary();
        setOverlayData({ type: 'success', guestName: result.guestName, partySize: result.partySize, tableName: result.tableName, message: 'Guest arrival verified. Welcome to the event!' });
        setShowConfirmOverlay(true);
      }
    } catch (err) {
      const message = err.message === 'Failed to fetch' || !navigator.onLine
        ? 'Connection lost. If this guest was actually checked in, re-searching will show them as already arrived.'
        : err.message;
      playError(); buzz([40, 30, 40]);
      setOverlayData({ type: 'error', message }); setShowConfirmOverlay(true);
    } finally {
      manualCheckInInFlight.current = false;
      setManualCheckInBusy(false);
    }
  };

  /**
   * Reverses a party's arrival (spec §9.6).
   *
   * ── It is scoped to the PARTY, and that is the point ──
   *
   * `POST /checkin/undo` takes a partyId, not the id of one check-in record, so
   * it reverses every live row for that party in one statement. That is what
   * makes it work here regardless of HOW the guest was admitted — the web
   * kiosk, a tablet at another gate, or a tablet that has since been re-paired.
   * The device endpoint cannot do that: it addresses a single check-in by the
   * client id that created it, which this console never had.
   *
   * It is a SOFT delete. The row stays as evidence with the reason, the actor
   * and the timestamp on it; the dashboard's counters exclude it because every
   * one of them filters `deleted_at`. Nothing is erased.
   */
  const handleUndo = async (partyId, reason) => {
    if (!authReady) return;
    if (!isOnline) { setOverlayData({ type: 'error', message: 'No internet connection. Reconnect and try again.' }); setShowConfirmOverlay(true); return; }
    if (undoInFlight.current) return;
    undoInFlight.current = true;
    setUndoBusy(true);
    try {
      const res = await fetchWithRetry(`${API_URL}/events/${eventId}/checkin/undo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ partyId, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 404 is not a fault here: someone else may have already reversed it, or
        // the guest was never actually admitted. Say which, rather than showing
        // a raw failure for a state that is arguably what the operator wanted.
        throw new Error(res.status === 404
          ? 'There is no live check-in for this guest. They may have been reversed already.'
          : (data.message || 'Could not reverse the check-in.'));
      }
      playAccept(); buzz([12, 24, 12]);
      setSelectedGuest(prev => (prev ? { ...prev, isCheckedIn: false, checkedInAt: null } : null));
      // Drop them from the arrivals feed too. Leaving a reversed guest sitting in
      // a list headed "Arrivals" is the same disagreement between the screen and
      // the record that this whole control exists to fix.
      setCheckInLogs(logs => logs.filter(l => l.partyId !== partyId));
      fetchCheckInSummary();
      setUndoTarget(null);
      setUndoReason('');
      setOverlayData({
        type: 'success',
        eyebrow: 'Check-in reversed',
        guestName: selectedGuest?.guestName,
        message: 'They are no longer counted as arrived. The record is kept with your reason on it.',
      });
      setShowConfirmOverlay(true);
    } catch (err) {
      const message = err.message === 'Failed to fetch' || !navigator.onLine
        ? 'Connection lost. Re-search this guest to see whether the reversal landed.'
        : err.message;
      playError(); buzz([40, 30, 40]);
      setOverlayData({ type: 'error', eyebrow: 'Reversal failed', heading: 'Not reversed', message });
      setShowConfirmOverlay(true);
    } finally {
      undoInFlight.current = false;
      setUndoBusy(false);
    }
  };

  const handleQRScan = useCallback(async (scannedToken) => {
    if (!scannedToken) return;
    if (!isOnline) {
      const msg = 'No internet connection. Reconnect and try again.';
      setScanStatus({ type: 'error', message: msg }); setOverlayData({ type: 'error', message: msg }); setShowConfirmOverlay(true);
      return;
    }
    if (qrCheckInInFlight.current) return;
    qrCheckInInFlight.current = true;
    setQrCheckInBusy(true);
    // The QR image now encodes a guest-facing "/ticket/<token>" URL (so a guest
    // scanning their own ticket with a phone camera lands on their seating view)
    // instead of the bare JWT — pull the token back out for the staff scanner,
    // while still accepting a raw pasted token for tickets emailed before this change.
    const token = extractTicketToken(scannedToken);
    try {
      const res = await fetchWithRetry(`${API_URL}/events/${eventId}/checkin/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token }) });
      const data = await res.json();
      if (!res.ok) { playError(); buzz([40, 30, 40]); setScanStatus({ type: 'error', message: data.message || 'QR Ticket signature verification failed.' }); setOverlayData({ type: 'error', message: data.message || 'QR Ticket signature verification failed.' }); setShowConfirmOverlay(true); return; }
      if (data.success) {
        const result = data.data;
        playAccept(); buzz([12, 24, 12]);
        setScanStatus({ type: 'success', message: `${result.guestName} (${result.partySize} guests) checked in successfully at ${result.tableName}.` });
        setCheckInLogs(logs => [{ partyId: result.partyId, guestName: result.guestName, partySize: result.partySize, tableName: result.tableName, checkedInAt: formatInZone(Date.now(), eventTimeZone, { hour: '2-digit', minute: '2-digit' }), method: 'qr_scan' }, ...logs]);
        fetchCheckInSummary();
        setOverlayData({ type: 'success', guestName: result.guestName, partySize: result.partySize, tableName: result.tableName, message: 'QR Ticket credentials verified successfully!' });
        setShowConfirmOverlay(true);
      }
    } catch (err) {
      const message = err.message === 'Failed to fetch' || !navigator.onLine
        ? 'Connection lost while verifying. If this guest was actually checked in, re-scanning will show them as already arrived.'
        : 'Could not connect to scanner backend service.';
      playError(); buzz([40, 30, 40]);
      setScanStatus({ type: 'error', message }); setOverlayData({ type: 'error', message }); setShowConfirmOverlay(true);
    } finally {
      qrCheckInInFlight.current = false;
      setQrCheckInBusy(false);
    }
    // `eventTimeZone` belongs here: the arrival time written into the log above
    // is formatted in it. Omitted, this callback captured whatever the zone was
    // when the scanner first mounted, so a page open from before the event's
    // timezone resolved kept stamping arrivals in the stale one — invisible,
    // because the times still look plausible.
  }, [eventId, fetchCheckInSummary, fetchWithRetry, isOnline, eventTimeZone]);

  const handleQRScanSubmit = async (e) => { e.preventDefault(); if (!qrTokenInput.trim()) return; await handleQRScan(qrTokenInput); setQrTokenInput(''); };

  const startCameraScanner = () => { setCameraStarting(true); setCameraError(null); setCameraActive(true); };

  // Html5QrcodeScanner (the library's full stock widget) shows its own
  // generic "camera vs. file, request permissions" chooser screen before
  // ever touching the camera — confusing on a kiosk that only ever wants the
  // camera. Html5Qrcode (the bare engine) instead requests the camera the
  // moment scanning is turned on, with our own status/error UI below.
  useEffect(() => {
    if (!cameraActive) return undefined;
    let cancelled = false;
    let instance = null;

    const onDecoded = async (decodedText) => {
      await handleQRScan(decodedText);
      setCameraActive(false);
    };

    import('html5-qrcode').then(async ({ Html5Qrcode }) => {
      if (cancelled) return;
      instance = new Html5Qrcode('qr-reader', { verbose: false });
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      try {
        // The rear/environment camera is what an install actually wants at a
        // check-in desk — this is also what triggers the browser's native
        // permission prompt directly, immediately, on the first attempt.
        await instance.start({ facingMode: 'environment' }, config, onDecoded, () => {});
        if (!cancelled) setCameraStarting(false);
      } catch (err) {
        if (cancelled) return;
        // No "environment"-facing camera (common on laptops/desktops with a
        // single front webcam) — fall back to whatever camera exists.
        try {
          const cameras = await Html5Qrcode.getCameras();
          if (!cameras || cameras.length === 0) throw new Error('NO_CAMERA');
          await instance.start(cameras[cameras.length - 1].id, config, onDecoded, () => {});
          if (!cancelled) setCameraStarting(false);
        } catch (fallbackErr) {
          if (cancelled) return;
          setCameraStarting(false);
          const msg = String(fallbackErr?.message || fallbackErr || '');
          setCameraError(
            /NO_CAMERA|NotFoundError/i.test(msg) ? 'No camera found on this device.'
              : /NotAllowedError|Permission/i.test(msg) ? 'Camera access was denied. Allow camera permission for this site in your browser settings, then try again.'
              : 'Could not start the camera. Check your browser/site camera permissions and try again.'
          );
        }
      }
    }).catch(() => { if (!cancelled) { setCameraStarting(false); setCameraError('Could not load the camera scanner.'); } });

    return () => {
      cancelled = true;
      if (instance) instance.stop().then(() => instance.clear()).catch(() => {});
    };
  }, [cameraActive, handleQRScan]);

  // MOB-16: this kiosk is meant to run for hours at a venue door — without a
  // wake lock the device sleeps mid-shift, forcing staff to unlock and
  // re-navigate repeatedly during the busiest arrival window. Best-effort:
  // unsupported browsers (iOS Safari < 16.4) just silently skip it.
  useEffect(() => {
    if (!cameraActive || typeof navigator === 'undefined' || !navigator.wakeLock) return undefined;
    let sentinel;
    let released = false;
    navigator.wakeLock.request('screen').then((s) => { if (released) { s.release().catch(() => {}); } else { sentinel = s; } }).catch(() => {});
    return () => { released = true; if (sentinel) sentinel.release().catch(() => {}); };
  }, [cameraActive]);

  const cardStyle = { background: C.white, border: `1px solid ${C.border}`, padding: '24px', borderRadius: '12px' };
  const activeEvent = events.find(ev => ev.id === eventId) || null;
  const tierFeatures = activeEvent?.tier_features;
  const eventIsPaid = !!activeEvent?.is_paid;

  if (!authReady || loading) {
    return (
      <div style={{ minHeight: '100dvh', background: C.ivory, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', border: `3px solid ${C.border}`, borderTop: `3px solid ${C.gold}`, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: C.stone, fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 300 }}>Loading check-in console...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100dvh', background: C.ivory, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '440px', width: '100%', textAlign: 'center', background: C.white, border: `1px solid ${C.border}`, padding: '48px 32px', borderRadius: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.06)' }}>
          <Icon name="plug" size={44} color="#C45E5E" strokeWidth={1.3} />
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 600, color: '#C45E5E', marginTop: '12px' }}>Backend Connection Error</h2>
          <p style={{ color: C.stone, marginTop: '12px', fontSize: '13px', lineHeight: 1.7, fontWeight: 300 }}>{error}</p>
          <button onClick={() => { setLoading(true); fetchCheckInSummary(); }} style={{ marginTop: '24px', padding: '12px 24px', background: C.gold, color: C.white, border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Retry Connection</button>
        </div>
      </div>
    );
  }

  return (
    <>
    <ImpersonationBanner />
    <div className="checkin-page" style={{ minHeight: '100dvh', background: '#FAFAF8', color: C.charcoal, padding: '32px', fontFamily: 'var(--font-sans)' }}>

      {!isOnline && (
        <div style={{
          maxWidth: '1200px', margin: '0 auto 16px', padding: '10px 16px', borderRadius: '10px',
          background: 'rgba(196,94,94,0.08)', border: '1px solid rgba(196,94,94,0.2)', color: '#C45E5E',
          fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <Icon name="noSignal" size={15} strokeWidth={1.6} /> No internet connection — check-ins and QR scans won&apos;t work until you&apos;re back online.
        </div>
      )}

      {/* Header */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', borderBottom: `1px solid ${C.border}`, paddingBottom: '24px', marginBottom: '32px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <div>
          <Link href="/dashboard" style={{ fontSize: '13px', fontWeight: 600, color: C.gold, textDecoration: 'none' }}>← Back to Dashboard</Link>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 500, color: C.charcoal, marginTop: '4px' }}>Fancy RSVP Front-Desk Check-In</h1>
          <p style={{ fontSize: '12px', color: C.stone, marginTop: '4px' }}>Tablet Mode — Gate 1 Desk Kiosk (Connected to API)</p>
          {events.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: C.stone, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Active Event:</span>
              <select value={eventId} onChange={e => setEventId(e.target.value)}
                style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '4px 8px', fontSize: '12px', color: C.charcoal, cursor: 'pointer', outline: 'none', fontFamily: 'var(--font-sans)' }}>
                {events.map(ev => (<option key={ev.id} value={ev.id}>{ev.title}</option>))}
              </select>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ ...cardStyle, padding: '12px 20px', textAlign: 'center' }}>
            <span style={{ fontSize: '10px', color: C.stone, display: 'block', fontWeight: 600 }}>Total Checked-In</span>
            <span style={{ fontSize: '20px', fontWeight: 900, color: C.gold }}>{totalArrivals} Arrivals</span>
          </div>
          <button onClick={() => setShowLogoutModal(true)} aria-label="Sign out" style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', color: C.stone, fontSize: '13px', fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: '6px' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FFF1F2'; e.currentTarget.style.color = '#C45E5E'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.stone; }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }} className="checkin-grid">

        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* QR Scanner — the highest-frequency door action, surfaced first
              rather than buried below search/detail. */}
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 500 }}>QR Ticket Validation</h3>
            <p style={{ fontSize: '12px', color: C.stone, lineHeight: 1.6 }}>Verify credentials using device camera scanning or token string submission below.</p>
            <FeatureGate tierFeatures={tierFeatures} isPaid={eventIsPaid} feature="qr_checkin" onUpgrade={() => router.push('/dashboard')} wrapperStyle={{ display: 'flex', width: '100%' }}>
              <button type="button" onClick={() => (cameraActive ? setCameraActive(false) : startCameraScanner())}
                style={{ width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: cameraActive ? '#C45E5E' : C.gold, color: C.white, transition: 'all 0.3s' }}>
                <Icon name={cameraActive ? 'stop' : 'camera'} size={15} strokeWidth={1.6} /> {cameraActive ? 'Stop Camera Scanner' : 'Open Camera Scanner'}
              </button>
            </FeatureGate>
            {cameraActive && (
              <div style={{ background: C.ivory, padding: '16px', border: `1px solid ${C.border}`, borderRadius: '10px' }}>
                {cameraStarting && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '28px 0' }}>
                    <div style={{ width: '26px', height: '26px', border: `2.5px solid ${C.border}`, borderTop: `2.5px solid ${C.gold}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <p style={{ fontSize: '12px', color: C.stone, margin: 0 }}>Requesting camera access…</p>
                  </div>
                )}
                {cameraError && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '24px 12px', textAlign: 'center' }}>
                    <Icon name="warning" size={28} color="#C45E5E" strokeWidth={1.4} />
                    <p style={{ fontSize: '13px', fontWeight: 700, color: '#C45E5E', margin: 0 }}>Camera unavailable</p>
                    <p style={{ fontSize: '12px', color: C.stone, margin: 0, lineHeight: 1.6, maxWidth: '320px' }}>{cameraError}</p>
                    <button type="button" onClick={() => { setCameraActive(false); setTimeout(startCameraScanner, 50); }}
                      style={{ marginTop: '4px', padding: '8px 18px', borderRadius: '8px', border: `1px solid ${C.gold}`, background: 'transparent', color: C.gold, fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                      Try Again
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'center', visibility: (cameraStarting || cameraError) ? 'hidden' : 'visible', height: (cameraStarting || cameraError) ? 0 : 'auto', overflow: 'hidden' }}>
                  <div id="qr-reader" style={{ width: '100%', maxWidth: '360px', borderRadius: '8px', overflow: 'hidden' }} />
                </div>
              </div>
            )}
            <form onSubmit={handleQRScanSubmit} style={{ display: 'flex', gap: '10px', paddingTop: '8px' }}>
              <input type="text" value={qrTokenInput} onChange={e => setQrTokenInput(e.target.value)} placeholder="Or paste signed JWT token here..."
                style={{ ...inputStyle, flex: 1 }} onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border} />
              <FeatureGate tierFeatures={tierFeatures} isPaid={eventIsPaid} feature="qr_checkin" onUpgrade={() => router.push('/dashboard')}>
                <button type="submit" disabled={!isOnline || qrCheckInBusy} title={!isOnline ? 'No internet connection' : undefined}
                  style={{ padding: '12px 24px', background: isOnline ? C.gold : C.border, color: C.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: (isOnline && !qrCheckInBusy) ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-sans)' }}>{qrCheckInBusy ? 'Verifying…' : 'Verify'}</button>
              </FeatureGate>
            </form>
            {scanStatus && (
              <div style={{ padding: '16px', borderRadius: '10px', border: `1px solid ${scanStatus.type === 'success' ? 'rgba(184,148,79,0.2)' : 'rgba(196,94,94,0.15)'}`, background: scanStatus.type === 'success' ? 'rgba(184,148,79,0.06)' : 'rgba(196,94,94,0.04)', color: scanStatus.type === 'success' ? C.gold : '#C45E5E', fontSize: '13px' }}>
                {scanStatus.type === 'success' ? '✓ Success: ' : '✕ Failed: '}{scanStatus.message}
              </div>
            )}
          </div>

          {/* Guest Search */}
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 500 }}>Guest Search & Check-In</h3>
            <div style={{ position: 'relative' }}>
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search guest name..."
                style={inputStyle} onFocus={e => e.target.style.borderColor = C.gold} onBlur={e => e.target.style.borderColor = C.border} />
              {searchResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '8px', background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', overflow: 'hidden', zIndex: 20, maxHeight: '220px', overflowY: 'auto' }}>
                  {searchResults.map(guest => (
                    <div key={guest.id} onClick={() => { setSelectedGuest(guest); setSearchQuery(''); }}
                      style={{ padding: '16px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.ivory}`, transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = C.ivory} onMouseLeave={e => e.currentTarget.style.background = C.white}>
                      <div>
                        <span style={{ fontWeight: 600, color: C.charcoal, display: 'block', fontSize: '14px' }}>{guest.guestName}</span>
                        <span style={{ fontSize: '11px', color: C.stone }}>Party of {guest.partySize} • {guest.tableName}</span>
                      </div>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '10px', background: guest.isCheckedIn ? 'rgba(184,148,79,0.1)' : C.ivory, color: guest.isCheckedIn ? C.gold : C.stone }}>
                        {guest.isCheckedIn ? 'Arrived' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {searchQuery.trim() && searchResults.length === 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '8px', background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', zIndex: 20, padding: '28px 20px', textAlign: 'center' }}>
                  {searching ? (
                    <>
                      <div style={{ width: '22px', height: '22px', border: `2.5px solid ${C.border}`, borderTop: `2.5px solid ${C.gold}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
                      <p style={{ fontSize: '12px', color: C.stone, margin: 0 }}>Searching…</p>
                    </>
                  ) : (
                    <>
                      <Icon name="search" size={26} color="#CFC8BB" strokeWidth={1.4} />
                      <p style={{ fontSize: '14px', fontWeight: 700, color: C.charcoal, margin: '10px 0 4px' }}>No guest found</p>
                      <p style={{ fontSize: '12px', color: C.stone, margin: 0, lineHeight: 1.6 }}>
                        No one matches &ldquo;<strong>{searchQuery.trim()}</strong>&rdquo; on this event&apos;s guest list.<br />
                        Double-check the spelling, or ask for the name the invitation was sent under.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Guest Detail */}
          {selectedGuest && (
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${C.border}`, paddingBottom: '16px' }}>
                <div>
                  <h4 style={{ fontSize: '20px', fontWeight: 700, color: C.charcoal }}>{selectedGuest.guestName}</h4>
                  <span style={{ fontSize: '11px', color: C.stone }}>{(selectedGuest.response || '').toUpperCase()} RESPONSE</span>
                </div>
                <span style={{ padding: '4px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: selectedGuest.isCheckedIn ? 'rgba(184,148,79,0.1)' : C.ivory, color: selectedGuest.isCheckedIn ? C.gold : C.stone, border: `1px solid ${selectedGuest.isCheckedIn ? 'rgba(184,148,79,0.2)' : C.border}` }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Icon name={selectedGuest.isCheckedIn ? 'check' : 'hourglass'} size={12} strokeWidth={1.8} /> {selectedGuest.isCheckedIn ? 'Checked-In' : 'Pending Arrival'}</span>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }} className="checkin-detail-grid">
                <div style={{ background: C.ivory, padding: '16px', border: `1px solid ${C.border}`, borderRadius: '10px' }}>
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.stone, display: 'block', fontWeight: 700 }}>Assigned Table</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px', display: 'block', color: C.charcoal }}>{selectedGuest.tableName}</span>
                </div>
                <div style={{ background: C.ivory, padding: '16px', border: `1px solid ${C.border}`, borderRadius: '10px' }}>
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.stone, display: 'block', fontWeight: 700 }}>Total Party Size</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px', display: 'block', color: C.gold }}>{selectedGuest.partySize} people</span>
                </div>
                <div style={{ background: C.ivory, padding: '16px', border: `1px solid ${C.border}`, borderRadius: '10px' }}>
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.stone, display: 'block', fontWeight: 700 }}>Meal Selections</span>
                  {selectedGuest.meals && selectedGuest.meals.length > 0 ? (
                    <div style={{ marginTop: '4px' }}>
                      {selectedGuest.meals.map((m, i) => (
                        <span key={i} style={{ fontSize: '11px', color: C.charcoal, display: 'block', lineHeight: 1.6 }}>
                          {m.mealSelection || 'Not selected'}{m.dietaryNotes ? ` (${m.dietaryNotes})` : ''}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: '13px', fontWeight: 500, marginTop: '4px', display: 'block', color: C.stone }}>No meals</span>
                  )}
                </div>
              </div>
              {selectedGuest.tableId && seatingElements.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.stone, fontWeight: 700 }}>Guide to Seat</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: C.gold, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Icon name="mapPin" size={12} strokeWidth={1.8} /> {selectedGuest.tableName}
                    </span>
                  </div>
                  {/* `youLabel` used to be passed here and has not been a prop
                      since the worded "you are here" pill was replaced by a gold
                      star — see markerStyle in seatingPlanStyle.js. It was doing
                      nothing. The legend under the map is new and earns its
                      place on this screen: it is what lets someone walking a
                      guest to their seat say "past the champagne bar". */}
                  <SeatingMiniMap tables={seatingElements} myTableId={selectedGuest.tableId} />
                </div>
              )}
              {!selectedGuest.isCheckedIn && (
                <>
                  {selectedGuest.tableName === 'Unassigned' && (
                    <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(196,94,94,0.06)', border: '1px solid rgba(196,94,94,0.15)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#C45E5E', fontWeight: 500 }}>
                      <Icon name="warning" size={14} strokeWidth={1.6} /> This guest has no table assignment. They will be checked in as a walk-in.
                    </div>
                  )}
                  <FeatureGate tierFeatures={tierFeatures} isPaid={eventIsPaid} feature="manual_checkin" onUpgrade={() => router.push('/dashboard')} wrapperStyle={{ display: 'flex', width: '100%' }}>
                    <button onClick={() => handleManualCheckIn(selectedGuest.id)} disabled={!isOnline || manualCheckInBusy}
                      title={!isOnline ? 'No internet connection' : undefined}
                      style={{ width: '100%', padding: '16px', background: isOnline ? C.gold : C.border, borderRadius: '10px', fontWeight: 700, fontSize: '15px', border: 'none', cursor: (isOnline && !manualCheckInBusy) ? 'pointer' : 'not-allowed', color: C.white, fontFamily: 'var(--font-sans)', transition: 'all 0.3s', opacity: manualCheckInBusy ? 0.7 : 1 }}
                      onMouseEnter={e => { if (isOnline && !manualCheckInBusy) e.target.style.background = C.goldHover; }}
                      onMouseLeave={e => { if (isOnline && !manualCheckInBusy) e.target.style.background = C.gold; }}>
                      {!isOnline ? 'Offline — cannot check in' : manualCheckInBusy ? 'Checking in…' : selectedGuest.tableName === 'Unassigned' ? `Walk-In Check-In (${selectedGuest.partySize} guests)` : `Confirm Check-In (${selectedGuest.partySize} guests)`}
                    </button>
                  </FeatureGate>
                </>
              )}
              {/*
                The correction path, and deliberately the quieter object on the
                panel. A check-in is the routine action and owns the solid gold
                block; reversing one is rare, privileged and audited, so it is an
                outlined control in the warning colour — findable when it is
                wanted, never the thing a tired thumb lands on at a door.

                Gated on EITHER entitlement, matching the server's
                requireAnyFeature('qr_checkin','manual_checkin'). Asking for only
                one would draw a padlock over an endpoint that answers.
              */}
              {selectedGuest.isCheckedIn && (
                <FeatureGate tierFeatures={tierFeatures} isPaid={eventIsPaid} feature={['qr_checkin', 'manual_checkin']} onUpgrade={() => router.push('/dashboard')} wrapperStyle={{ display: 'flex', width: '100%' }}>
                  <button
                    onClick={() => { setUndoReason(''); setUndoTarget(selectedGuest); }}
                    disabled={!isOnline}
                    title={!isOnline ? 'No internet connection' : undefined}
                    style={{ width: '100%', padding: '14px', background: 'transparent', borderRadius: '10px', fontWeight: 600, fontSize: '14px', border: `1px solid ${isOnline ? 'rgba(196,94,94,0.35)' : C.border}`, cursor: isOnline ? 'pointer' : 'not-allowed', color: isOnline ? '#C45E5E' : C.stone, fontFamily: 'var(--font-sans)', transition: 'all 0.25s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    onMouseEnter={e => { if (isOnline) e.currentTarget.style.background = 'rgba(196,94,94,0.06)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Icon name="cross" size={14} strokeWidth={1.8} />
                    {isOnline ? 'Undo check-in' : 'Offline — cannot undo'}
                  </button>
                </FeatureGate>
              )}
            </div>
          )}
        </div>

        {/* Right: Arrivals Feed */}
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', height: '500px', overflow: 'hidden' }}>
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 500, borderBottom: `1px solid ${C.border}`, paddingBottom: '12px' }}>Arrivals Feed</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1, paddingRight: '4px', marginTop: '12px' }}>
            {checkInLogs.length > 0 ? (
              checkInLogs.map((log, index) => (
                <div key={index} style={{ background: '#FAFAF8', padding: '12px', border: '1px solid #F0ECE3', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: C.charcoal, display: 'block', fontSize: '13px' }}>{log.guestName}</span>
                    <span style={{ fontSize: '11px', color: C.stone }}>Party of {log.partySize} • {log.tableName}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', color: C.stone, display: 'block' }}>{log.checkedInAt}</span>
                    <span style={{ fontSize: '9px', color: '#A09A91', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{log.method.replace('_', ' ')}</span>
                  </div>
                </div>
              ))
            ) : (
              <p style={{ fontSize: '12px', color: C.stone, textAlign: 'center', padding: '80px 0' }}>No arrivals logged in this kiosk session yet.</p>
            )}
          </div>
        </div>
      </div>

      {/*
        Undo — the reason dialog.

        The reason is not a formality: the server refuses the request without one
        (400 REASON_REQUIRED) and stores it on the row beside who did it, because
        the check-in it reverses is the evidence that a guest was admitted. So
        the confirm button stays disabled until something has been typed, and the
        300-character ceiling is the server's, enforced here so a long note is
        trimmed while it is still being written rather than rejected after.
      */}
      {undoTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Undo check-in for ${undoTarget.guestName}`}
          style={{ position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'rgba(25,27,30,0.8)', backdropFilter: 'blur(8px)' }}
          onClick={() => { if (!undoBusy) { setUndoTarget(null); setUndoReason(''); } }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: '440px', background: C.white, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '32px', boxShadow: '0 24px 60px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '18px' }}
          >
            <div>
              <span style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#C45E5E', fontWeight: 800, display: 'block' }}>Undo check-in</span>
              <h3 style={{ fontSize: '22px', fontWeight: 900, color: C.charcoal, marginTop: '8px', fontFamily: 'var(--font-serif)' }}>{undoTarget.guestName}</h3>
              <p style={{ color: C.stone, fontSize: '13px', marginTop: '6px', lineHeight: 1.6 }}>
                This reverses the arrival for the whole party ({undoTarget.partySize} {undoTarget.partySize === 1 ? 'guest' : 'guests'}) and removes them from the arrival count. The record is kept, with your reason on it.
              </p>
            </div>

            <div>
              <label htmlFor="undo-reason" style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.stone, fontWeight: 700, display: 'block', marginBottom: '8px' }}>
                Reason (required)
              </label>
              <input
                id="undo-reason"
                autoFocus
                value={undoReason}
                onChange={(e) => setUndoReason(e.target.value.slice(0, 300))}
                onKeyDown={(e) => { if (e.key === 'Enter' && undoReason.trim() && !undoBusy) handleUndo(undoTarget.id, undoReason.trim()); }}
                placeholder="e.g. Checked in the wrong guest"
                style={inputStyle}
              />
              <span style={{ fontSize: '11px', color: C.stone, display: 'block', marginTop: '6px' }}>
                Recorded in the audit trail. {300 - undoReason.length} characters left.
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <button
                onClick={() => { setUndoTarget(null); setUndoReason(''); }}
                disabled={undoBusy}
                style={{ padding: '14px', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.white, color: C.charcoal, fontWeight: 700, fontSize: '14px', cursor: undoBusy ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)' }}
              >
                Keep them in
              </button>
              <button
                onClick={() => handleUndo(undoTarget.id, undoReason.trim())}
                disabled={!undoReason.trim() || undoBusy}
                style={{ padding: '14px', borderRadius: '10px', border: 'none', background: (!undoReason.trim() || undoBusy) ? C.border : '#C45E5E', color: C.white, fontWeight: 700, fontSize: '14px', cursor: (!undoReason.trim() || undoBusy) ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)' }}
              >
                {undoBusy ? 'Reversing…' : 'Undo check-in'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Overlay */}
      {showConfirmOverlay && overlayData && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'rgba(25,27,30,0.8)', backdropFilter: 'blur(8px)' }}>
          <div style={{ width: '100%', maxWidth: '440px', background: C.white, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '40px', boxShadow: '0 24px 60px rgba(0,0,0,0.15)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', position: 'relative', overflow: 'hidden' }}>
            {overlayData.type === 'success' ? (
              <>
                <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(184,148,79,0.1)', border: '1px solid rgba(184,148,79,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gold }}>
                  <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </div>
                <div>
                  <span style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: C.gold, fontWeight: 800, display: 'block' }}>{overlayData.eyebrow || 'Verification Success'}</span>
                  <h3 style={{ fontSize: '24px', fontWeight: 900, color: C.charcoal, marginTop: '8px', fontFamily: 'var(--font-serif)' }}>{overlayData.guestName}</h3>
                  <p style={{ color: C.stone, fontSize: '13px', marginTop: '4px' }}>{overlayData.message}</p>
                </div>
                {/* Only an admission has a party size and a seat to report. A
                    reversal has neither, and the grid rendered "undefined Guests"
                    at "undefined" when it was shown one. */}
                {overlayData.partySize != null && (
                  <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '16px 0' }}>
                    <div style={{ background: C.ivory, padding: '12px', borderRadius: '10px', border: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.stone, display: 'block', fontWeight: 700 }}>Party Size</span>
                      <span style={{ fontSize: '18px', fontWeight: 700, color: C.gold, marginTop: '4px', display: 'block' }}>{overlayData.partySize} Guests</span>
                    </div>
                    <div style={{ background: C.ivory, padding: '12px', borderRadius: '10px', border: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: C.stone, display: 'block', fontWeight: 700 }}>Assigned Seat</span>
                      <span style={{ fontSize: '18px', fontWeight: 700, color: C.charcoal, marginTop: '4px', display: 'block' }}>{overlayData.tableName}</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(196,94,94,0.08)', border: '1px solid rgba(196,94,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C45E5E' }}>
                  <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </div>
                <div>
                  <span style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#C45E5E', fontWeight: 800, display: 'block' }}>{overlayData.eyebrow || 'Verification Failure'}</span>
                  {/* "Access Denied" is the right words for a refused admission
                      and the wrong words for a reversal that could not be sent,
                      so the caller may name its own failure. */}
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#C45E5E', marginTop: '8px' }}>{overlayData.heading || 'Access Denied'}</h3>
                  <p style={{ color: C.stone, fontSize: '13px', marginTop: '8px', lineHeight: 1.6, maxWidth: '300px' }}>{overlayData.message}</p>
                </div>
              </>
            )}
            <button onClick={() => setShowConfirmOverlay(false)} style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', color: C.stone, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>Tap to close screen</button>
            {overlayData.type === 'success' && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, height: '4px', background: C.gold, animation: 'shrink 3.2s linear forwards', width: '100%' }} />
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes shrink { from { width: 100%; } to { width: 0%; } }
        @media (max-width: 767.98px) {
          /* The page had a hard 32px padding with no mobile override — 64px of a
             375px phone spent on empty margins before any content. */
          .checkin-page { padding: 16px !important; }
          .checkin-grid { grid-template-columns: 1fr !important; }
          /* Large phones in landscape / small tablets (481–768px): drop the
             3-up detail grid to 2 columns instead of leaving three cramped
             slivers, then to a single column below. */
          .checkin-detail-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 639.98px) {
          .checkin-detail-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <LogoutModal isOpen={showLogoutModal} onClose={() => setShowLogoutModal(false)} onConfirm={logout} />
    </div>
    </>
  );
}
