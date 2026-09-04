'use client';
import { toast } from '../../utils/toast';

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/apiClient';
import { supabase } from '../../utils/supabaseClient';
import PhoneNumberInput from '../../components/PhoneNumberInput';
import { ORGANIZER_TIMEZONES } from '../../utils/organizerTimezones';
import { formatInZone, zoneAbbreviation } from '../../utils/timezone';

const COLORS = {
  gold: '#B8944F', goldHover: '#a6833f', charcoal: '#191B1E', ivory: '#F8F4EC',
  champagne: '#D7BE80', stone: '#77736A', border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8',
  danger: '#C45E5E', dangerHover: '#a84c4c', success: '#4C9A6C'
};

function formatMemberSince(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getDeviceIcon(label = '') {
  const lowercase = label.toLowerCase();
  const isMobile = lowercase.includes('phone') || lowercase.includes('mobile') || lowercase.includes('android') || lowercase.includes('ios') || lowercase.includes('iphone');
  if (isMobile) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.stone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.stone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

export default function OrganizerProfile({ events = [], forcePasswordReset = false, onPasswordReset }) {
  const [profile, setProfile] = useState(null);
  /* The propose-then-confirm state for pushing the account zone onto existing
     events. Null until a save reports events on a different clock. */
  const [tzProposal, setTzProposal] = useState(null);
  const [applyingTz, setApplyingTz] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    bio: '',
    website: '',
    logo_url: '',
    timezone: '',
    socialLinks: { instagram: '', twitter: '', linkedin: '' }
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [sessionToRevoke, setSessionToRevoke] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState('');

  /* The clock under the timezone picker. It used to call `Date.now()` straight
     out of the JSX, which froze it at whatever minute that render happened in:
     an organizer comparing "it's currently …" against their own watch while
     they decide between two zones was reading a time that had stopped. Half a
     minute is close enough for an hour:minute line, and this is the only thing
     on the page that ticks. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/auth/profile');
      const p = res.profile || res;
      setProfile(p);
      setForm({
        name: p.name || '',
        phone: p.phone || '',
        bio: p.bio || '',
        website: p.website || '',
        logo_url: p.logo_url || '',
        timezone: p.timezone || '',
        socialLinks: p.social_links || { instagram: '', twitter: '', linkedin: '' }
      });
    } catch (err) {
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await apiFetch('/auth/sessions');
      setSessions(res.sessions || []);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    (async () => { await Promise.all([fetchProfile(), fetchSessions()]); })();
  }, [fetchProfile, fetchSessions]);

  const handleChange = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));
  
  const handleSocialChange = (field) => (e) => {
    const val = e.target.value;
    setForm(prev => ({
      ...prev,
      socialLinks: {
        ...prev.socialLinks,
        [field]: val
      }
    }));
  };

  const handlePasswordChange = (field) => (e) => setPasswordForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('File size exceeds 8MB. Please use a smaller file.');
      return;
    }
    setLogoUploading(true);
    try {
      if (!supabase) throw new Error('Supabase client is not initialized.');
      const fileExt = file.name.split('.').pop();
      const fileName = `${profile?.id || 'logo'}-${Date.now()}.${fileExt}`;
      const filePath = `logos/${fileName}`;
      const { error: uploadErr } = await supabase.storage
        .from('event-assets')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage
        .from('event-assets')
        .getPublicUrl(filePath);
      setForm(prev => ({ ...prev, logo_url: publicUrl }));
      toast.success('Logo uploaded successfully.');
    } catch (err) {
      console.error('Logo upload failed, falling back to base64:', err);
      if (file.size > 3.5 * 1024 * 1024) {
        toast.error("Couldn't upload to storage, and this file is too large to embed directly (max ~3.5MB). Please use a smaller file.");
        setLogoUploading(false);
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setForm(prev => ({ ...prev, logo_url: event.target.result }));
        setLogoUploading(false);
      };
      reader.onerror = () => {
        toast.error('Failed to read the logo file.');
        setLogoUploading(false);
      };
      reader.readAsDataURL(file);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name cannot be empty.'); return; }
    setSaving(true);
    try {
      const res = await apiFetch('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          bio: form.bio.trim() || null,
          website: form.website.trim() || null,
          logo_url: form.logo_url.trim() || null,
          /* Sent ONLY when it actually changed.
             The field is hydrated from the saved profile, so an organizer
             editing their bio would otherwise re-send the same zone on every
             save — and the server stamps `timezone_source: 'manual'` on any
             write. That would quietly convert a detected zone into a "human
             decided this" one, which is the exact flag a later re-resolution
             pass checks before it skips a row. An unrelated save must not
             change the provenance of a value nobody touched. */
          ...(form.timezone && form.timezone !== profile?.timezone
            ? { timezone: form.timezone }
            : {}),
          social_links: form.socialLinks
        }),
      });
      const p = res.profile || res;
      setProfile(prev => ({ ...prev, ...p }));

      /**
       * Confirm what the SERVER stored, not what we sent.
       *
       * A hardcoded "updated successfully" here was reporting on the request,
       * not on the result. The profile endpoint has a degraded path that saves
       * only the core fields when a column write fails, and it says so in its
       * `message` — which this ignored, so a save that quietly dropped fields
       * looked identical to one that worked.
       *
       * The timezone is the field that matters most, because nothing on this
       * screen re-reads it: an organizer who sets it, sees a green toast and
       * has it not stick has no way to find out until an event goes out on the
       * wrong clock.
       */
      const askedForZone = form.timezone && form.timezone !== profile?.timezone;
      if (askedForZone && p?.timezone !== form.timezone) {
        toast.error('Your other details were saved, but the timezone was not. Please try again.');
      } else {
        toast.success(res.message || 'Profile updated successfully.');
      }

      /* Existing events do NOT follow the account zone on their own — see the
         note in authController.updateProfile. The save reports which ones are
         on a different clock and the organizer applies it deliberately, which
         is the same propose-then-confirm shape as the event-change notice. */
      setTzProposal(res.timezonePropagation || null);
    } catch (err) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Push the saved account zone onto the events that are still on another one.
   *
   * Re-anchoring: the hour every event shows stays exactly as it is, on screen
   * and in invitations already sent. What moves is the real moment underneath,
   * and with it the reminder and the seating reveal. That is why this is safe
   * to offer and also why it needs a deliberate press.
   */
  const handleApplyTimezone = async () => {
    setApplyingTz(true);
    try {
      const res = await apiFetch('/auth/profile/timezone/apply', { method: 'POST' });
      if (res?.failed > 0) toast.error(res.message || 'Some events could not be updated.');
      else toast.success(res?.message || 'Your events now follow your account timezone.');
      setTzProposal(null);
    } catch (err) {
      toast.error(err.message || 'Could not apply the timezone to your events.');
    } finally {
      setApplyingTz(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (profile?.hasPassword && !passwordForm.currentPassword) { toast.error('Current password is required.'); return; }
    // Mirrors the server's actual rule (backend/controllers/authController.js
    // passwordRegex) — previously only checked length, so a password like
    // "aaaaaaaa" passed here and only failed after a round trip to the server
    // with a generic error, giving no indication which rule was missing.
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(passwordForm.newPassword)) {
      toast.error('Password must be at least 8 characters with uppercase, lowercase, and a number.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { toast.error('Passwords do not match.'); return; }

    setChangingPassword(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: profile?.hasPassword ? passwordForm.currentPassword : undefined,
          newPassword: passwordForm.newPassword
        })
      });
      toast.success(profile?.hasPassword ? 'Password changed successfully.' : 'Password created successfully.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setProfile(prev => ({ ...prev, hasPassword: true }));
      onPasswordReset?.();
    } catch (err) {
      toast.error(err.message || 'Failed to change password.');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleRevokeSession = async (sessionId) => {
    try {
      await apiFetch(`/auth/sessions/${sessionId}/revoke`, { method: 'POST' });
      toast.success('Device logged out successfully.');
      fetchSessions();
    } catch (err) {
      toast.error(err.message || 'Failed to log out device.');
    }
  };

  const sectionStyle = {
    background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: '12px',
    padding: '24px', marginBottom: '20px',
  };
  const sectionTitleStyle = {
    fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: COLORS.charcoal,
    margin: '0 0 20px', paddingBottom: '12px', borderBottom: `1px solid ${COLORS.border}`,
  };
  const labelStyle = {
    display: 'block', fontSize: '11px', fontWeight: 600, color: COLORS.stone,
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontFamily: 'var(--font-sans)',
  };
  const inputStyle = {
    width: '100%', padding: '10px 14px', border: `1px solid ${COLORS.border}`, borderRadius: '8px',
    fontSize: '14px', fontFamily: 'var(--font-sans)', color: COLORS.charcoal, background: COLORS.white,
    outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
  };
  const readOnlyStyle = { ...inputStyle, background: COLORS.softBg, color: COLORS.stone, cursor: 'not-allowed' };
  const textareaStyle = {
    ...inputStyle, minHeight: '80px', resize: 'vertical',
  };
  const fieldGroupStyle = { marginBottom: '16px' };
  const rowStyle = { display: 'grid', gap: '16px' };
  const statLabelStyle = { fontSize: '11px', color: COLORS.stone, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-sans)', marginBottom: '6px' };
  const statValueStyle = { fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 700, color: COLORS.charcoal };

  if (loading) {
    return (
      <div style={{ maxWidth: '720px' }}>
        <div style={sectionStyle}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ height: '48px', background: COLORS.softBg, borderRadius: '8px', marginBottom: '16px' }} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div style={sectionStyle}>
        <p style={{ color: '#C45E5E', fontSize: '13px', fontFamily: 'var(--font-sans)' }}>{error}</p>
        <button onClick={fetchProfile} style={{
          marginTop: '12px', padding: '8px 20px', minHeight: 'var(--fx-touch)', background: COLORS.gold, color: COLORS.white,
          border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
        }}>
          Retry
        </button>
      </div>
    );
  }

  const totalEvents = events.length;
  const liveEvents = events.filter(e => e && e.status !== 'draft').length;

  return (
    <div style={{ maxWidth: '720px', paddingBottom: '40px' }}>

      {/* ═══ ACCOUNT OVERVIEW ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" /></svg>
            Account Overview
          </span>
        </h3>
        <div className="profile-stats-grid" style={{ display: 'grid', gap: '16px' }}>
          <div>
            <div style={statLabelStyle}>Total Events</div>
            <div style={statValueStyle}>{totalEvents}</div>
          </div>
          <div>
            <div style={statLabelStyle}>Live Events</div>
            <div style={statValueStyle}>{liveEvents}</div>
          </div>
          <div>
            <div style={statLabelStyle}>Member Since</div>
            <div style={statValueStyle}>{formatMemberSince(profile?.created_at)}</div>
          </div>
        </div>
      </div>

      {/* ═══ PROFILE INFORMATION ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            Profile Information
          </span>
        </h3>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Organizer Name</label>
          <input value={form.name} onChange={handleChange('name')} placeholder="Your name or business name" style={inputStyle}
            onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
          />
        </div>

        <div className="profile-row-grid" style={rowStyle}>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Email Address</label>
            <input value={profile?.email || ''} readOnly style={readOnlyStyle} />
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Phone Number</label>
            <PhoneNumberInput value={form.phone} onChange={(val) => handleChange('phone')({ target: { value: val } })} />
          </div>
        </div>
      </div>

      {/* ═══ ORGANIZER BRANDING ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            Organizer Branding
          </span>
        </h3>

        <div className="profile-row-grid" style={rowStyle}>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Logo / Avatar</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              {/* Previously there was no way to see what was actually uploaded (or
                  fix a bad crop/wrong file) before saving — just a toast saying
                  "Logo uploaded successfully." with no visual confirmation. */}
              {form.logo_url && (
                <div style={{ position: 'relative', width: '44px', height: '44px', flexShrink: 0 }}>
                  <img src={form.logo_url} alt="Logo preview" style={{
                    width: '44px', height: '44px', borderRadius: '8px', objectFit: 'cover',
                    border: `1px solid ${COLORS.border}`, display: 'block',
                  }} onError={(e) => { e.target.style.display = 'none'; }} />
                  <button type="button" onClick={() => setForm(prev => ({ ...prev, logo_url: '' }))}
                    title="Remove logo" aria-label="Remove your organization logo"
                    style={{
                      position: 'absolute', top: -6, right: -6, width: '18px', height: '18px', borderRadius: '50%',
                      border: 'none', background: 'rgba(25,27,30,0.75)', color: COLORS.white, cursor: 'pointer',
                      fontSize: '11px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>×</button>
                </div>
              )}
              <input type="file" accept="image/*" onChange={handleLogoUpload} disabled={logoUploading} style={{ display: 'none' }} id="logo-upload-input" />
              <label htmlFor="logo-upload-input" style={{
                padding: '10px 20px', borderRadius: '8px', border: `1px solid ${COLORS.border}`,
                background: COLORS.white, color: COLORS.charcoal, fontSize: '13px', fontWeight: 600,
                cursor: logoUploading ? 'wait' : 'pointer', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
                whiteSpace: 'nowrap', transition: 'all 0.2s', userSelect: 'none'
              }}
              onMouseEnter={(e) => { if (!logoUploading) { e.currentTarget.style.background = COLORS.softBg; e.currentTarget.style.borderColor = COLORS.gold; } }}
              onMouseLeave={(e) => { if (!logoUploading) { e.currentTarget.style.background = COLORS.white; e.currentTarget.style.borderColor = COLORS.border; } }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                {logoUploading ? 'Uploading…' : form.logo_url ? 'Replace' : 'Upload'}
              </label>
            </div>
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Brand Website</label>
            <input value={form.website} onChange={handleChange('website')} placeholder="https://yourbrand.com" style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
          </div>

          {/* Time Zone.
              Set once, from where the account was created, and shown here so
              it can be corrected — the one predictable failure of detecting it
              from a signup IP is somebody opening an account for a business in
              one country while sitting in another. Without a control there is
              no route back, and every event they create would advertise the
              wrong hour.

              A native <select> rather than a search box: the list is short
              because it is scoped to zones this platform actually serves, and
              a free-text field would let an organizer type something that is
              not an IANA name and get a 400 they cannot interpret. */}
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Time Zone</label>
            <select
              value={form.timezone}
              onChange={handleChange('timezone')}
              style={{ ...inputStyle, appearance: 'auto' }}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            >
              {!form.timezone && <option value="">Not set</option>}
              {ORGANIZER_TIMEZONES.map((z) => (
                <option key={z.id} value={z.id}>{z.label}</option>
              ))}
              {/* A zone that was detected but is not on the curated list still
                  has to appear, or opening this dropdown would silently offer
                  to change it and show the wrong current value. */}
              {form.timezone && !ORGANIZER_TIMEZONES.some((z) => z.id === form.timezone) && (
                <option value={form.timezone}>{form.timezone}</option>
              )}
            </select>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11.5, color: COLORS.stone, margin: '6px 0 0', lineHeight: 1.5 }}>
              Every date and time you enter is read on this clock, and your guests
              see the same hours you type.
              {form.timezone && (
                <> It&rsquo;s currently <strong style={{ color: COLORS.charcoal }}>
                  {formatInZone(now, form.timezone, { hour: 'numeric', minute: '2-digit' })} {zoneAbbreviation(now, form.timezone)}
                </strong> there.</>
              )}
              {' '}Changing it does not move events you have already created —
              after saving you can choose to apply it to them.
            </p>
          </div>
        </div>

        {/* THE PROPOSAL. Appears only after a save that found events on another
            clock, and it states the one thing an organizer needs to weigh: the
            hours on their invitations do NOT change, the reminders do. */}
        {tzProposal && (
          <div style={{
            marginTop: 4, padding: '16px 18px', borderRadius: 12,
            border: `1px solid ${COLORS.gold}55`, background: 'rgba(184,148,79,0.06)',
          }}>
            {/* "At least N" when the server hit its per-account cap. Quoting a
                limit as though it were a count is how a number on screen ends
                up not describing what the button does. */}
            <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: COLORS.charcoal }}>
              {tzProposal.truncated ? 'At least ' : ''}{tzProposal.count}{' '}
              {tzProposal.count === 1 ? 'event is' : 'events are'} on a different clock
            </p>
            <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-sans)', fontSize: 12.5, color: COLORS.stone, lineHeight: 1.6 }}>
              Applying <strong style={{ color: COLORS.charcoal }}>{tzProposal.timezone}</strong> keeps every
              time exactly as your guests already see it. What changes is when reminders
              and the seating reveal actually fire.
            </p>

            <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
              {tzProposal.events.map((e) => (
                <li key={e.id} style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: COLORS.stone, padding: '3px 0' }}>
                  <strong style={{ color: COLORS.charcoal }}>{e.title || 'Untitled'}</strong>
                  {' — '}stays at {e.readsAs}
                  {e.shiftHours !== 0 && (
                    <>; reminders shift {Math.abs(e.shiftHours)}h {e.shiftHours > 0 ? 'later' : 'earlier'}</>
                  )}
                </li>
              ))}
              {tzProposal.count > tzProposal.events.length && (
                <li style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: COLORS.stone, padding: '3px 0' }}>
                  …and {tzProposal.count - tzProposal.events.length} more
                </li>
              )}
            </ul>

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleApplyTimezone}
                disabled={applyingTz}
                style={{
                  minHeight: 44, padding: '10px 20px', borderRadius: 9, border: 'none',
                  background: COLORS.gold, color: '#fff', fontFamily: 'var(--font-sans)',
                  fontSize: 13.5, fontWeight: 600, cursor: applyingTz ? 'default' : 'pointer',
                  opacity: applyingTz ? 0.6 : 1,
                }}
              >
                {applyingTz ? 'Applying…' : `Apply to ${tzProposal.count === 1 ? 'this event' : 'all events'}`}
              </button>
              <button
                type="button"
                onClick={() => setTzProposal(null)}
                disabled={applyingTz}
                style={{
                  minHeight: 44, padding: '10px 20px', borderRadius: 9,
                  border: `1px solid ${COLORS.border}`, background: 'transparent',
                  color: COLORS.stone, fontFamily: 'var(--font-sans)', fontSize: 13.5,
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                Leave them as they are
              </button>
            </div>
          </div>
        )}

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Organizer Bio</label>
          <textarea value={form.bio} onChange={handleChange('bio')} placeholder="Tell attendees about yourself, your company, and the types of events you host..." style={textareaStyle}
            onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
          />
        </div>
      </div>

      {/* ═══ SOCIAL LINKS ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
            Social Profiles
          </span>
        </h3>
        <div className="profile-social-grid" style={{ display: 'grid', gap: '16px' }}>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Instagram</label>
            <input value={form.socialLinks.instagram || ''} onChange={handleSocialChange('instagram')} placeholder="username" style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Twitter / X</label>
            <input value={form.socialLinks.twitter || ''} onChange={handleSocialChange('twitter')} placeholder="username" style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>LinkedIn</label>
            <input value={form.socialLinks.linkedin || ''} onChange={handleSocialChange('linkedin')} placeholder="company/name" style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
          </div>
        </div>
      </div>

      {/* ═══ SAVE BUTTON ═══ */}
      <div style={{ marginBottom: '32px' }}>
        <button onClick={handleSave} disabled={saving}
          style={{
            padding: '12px 32px', borderRadius: '10px', border: 'none',
            background: saving ? COLORS.champagne : COLORS.gold, color: COLORS.white,
            fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-sans)',
            cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center',
          }}
          onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = COLORS.goldHover; }}
          onMouseLeave={(e) => { if (!saving) e.currentTarget.style.background = COLORS.gold; }}
        >
          {saving ? 'Saving…' : 'Save Profile Changes'}
        </button>
      </div>

      {/* ═══ SECURITY & PASSWORD ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            {profile?.hasPassword ? 'Security & Password' : 'Security & Google Login'}
          </span>
        </h3>
        <form onSubmit={handleChangePassword}>
          {forcePasswordReset && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '12px', background: '#FDF6E9', border: '1px solid #EFDFB8',
              borderRadius: '8px', padding: '14px 16px', marginBottom: '18px', alignItems: 'flex-start'
            }}>
              <div style={{ fontSize: '13px', color: '#8A6416', fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>
                An admin reset your password. Please set a new one below to finish securing your account.
              </div>
            </div>
          )}
          {!profile?.hasPassword && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '12px', background: '#F0F4F8', border: '1px solid #D0E0F0',
              borderRadius: '8px', padding: '14px 16px', marginBottom: '18px', alignItems: 'flex-start'
            }}>
              <div style={{
                background: COLORS.white, borderRadius: '50%', width: '28px', height: '28px',
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#1B365D', fontFamily: 'var(--font-sans)', marginBottom: '3px' }}>
                  Connected with Google
                </div>
                <div style={{ fontSize: '12px', color: '#4E6A8A', fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>
                  Your account is currently using Google Sign-In. You don&apos;t have a local password set.
                  If you&apos;d like to sign in directly with your email as well, you can create a password below.
                </div>
              </div>
            </div>
          )}
          {profile?.hasPassword && (
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Current Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showCurrentPassword ? "text" : "password"} value={passwordForm.currentPassword} onChange={handlePasswordChange('currentPassword')} placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ ...inputStyle, paddingRight: '40px' }}
                  onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
                  onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
                />
                <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  style={{
                    position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    color: COLORS.stone, outline: 'none', padding: 0
                  }}
                >
                  {showCurrentPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>
          )}
          <div className="profile-row-grid" style={rowStyle}>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>{profile?.hasPassword ? 'New Password' : 'Create Password'}</label>
              <div style={{ position: 'relative' }}>
                <input type={showNewPassword ? "text" : "password"} value={passwordForm.newPassword} onChange={handlePasswordChange('newPassword')} placeholder="••••••••"
                  autoComplete="new-password"
                  style={{ ...inputStyle, paddingRight: '40px' }}
                  onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
                  onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
                />
                <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{
                    position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    color: COLORS.stone, outline: 'none', padding: 0
                  }}
                >
                  {showNewPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>{profile?.hasPassword ? 'Confirm New Password' : 'Confirm Password'}</label>
              <div style={{ position: 'relative' }}>
                <input type={showConfirmPassword ? "text" : "password"} value={passwordForm.confirmPassword} onChange={handlePasswordChange('confirmPassword')} placeholder="••••••••"
                  autoComplete="new-password"
                  style={{ ...inputStyle, paddingRight: '40px' }}
                  onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
                  onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
                />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{
                    position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    color: COLORS.stone, outline: 'none', padding: 0
                  }}
                >
                  {showConfirmPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>
          </div>
          <button type="submit" disabled={changingPassword}
            style={{
              marginTop: '8px', padding: '10px 24px', borderRadius: '8px', border: `1px solid ${COLORS.border}`,
              background: COLORS.white, color: COLORS.charcoal,
              fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-sans)',
              cursor: changingPassword ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
            onMouseEnter={(e) => { if (!changingPassword) { e.currentTarget.style.background = COLORS.softBg; e.currentTarget.style.borderColor = COLORS.gold; } }}
            onMouseLeave={(e) => { if (!changingPassword) { e.currentTarget.style.background = COLORS.white; e.currentTarget.style.borderColor = COLORS.border; } }}
          >
            {changingPassword ? (
              profile?.hasPassword ? 'Updating Password…' : 'Creating Password…'
            ) : (
              profile?.hasPassword ? 'Update Password' : 'Create Password'
            )}
          </button>
        </form>
      </div>

      {/* ═══ CONNECTED DEVICES & SESSIONS ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>
            Connected Devices
          </span>
        </h3>
        <p style={{ fontSize: '12px', color: COLORS.stone, fontFamily: 'var(--font-sans)', marginTop: '-10px', marginBottom: '20px' }}>
          These devices are currently logged into your account. You can log out of individual sessions.
        </p>

        {loadingSessions && sessions.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: COLORS.stone, fontSize: '13px' }}>Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: COLORS.stone, fontSize: '13px' }}>No active sessions found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sessions.map((s) => {
              const active = s.isActive;
              if (!active) return null;

              return (
                <div key={s.id} style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', borderRadius: '8px', border: `1px solid ${COLORS.border}`,
                  background: s.isCurrent ? COLORS.softBg : COLORS.white,
                  fontFamily: 'var(--font-sans)', fontSize: '13px'
                }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      background: COLORS.white, border: `1px solid ${COLORS.border}`,
                      borderRadius: '6px', width: '36px', height: '36px',
                      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {getDeviceIcon(s.device_label)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: COLORS.charcoal, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                        {s.device_label || 'Unknown Device'}
                        {s.isCurrent && (
                          <span style={{
                            background: '#E6F4EA', color: COLORS.success, fontSize: 'var(--fx-micro)',
                            fontWeight: 700, padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase'
                          }}>
                            This Device
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: COLORS.stone, marginTop: '2px' }}>
                        IP: {s.ip || 'Unknown'} • Active: {s.isCurrent ? 'Now' : formatRelativeTime(s.last_seen_at)}
                      </div>
                    </div>
                  </div>
                  {!s.isCurrent && (
                    <button onClick={() => setSessionToRevoke(s)}
                      style={{
                        padding: '6px 12px', minHeight: 'var(--fx-touch)', borderRadius: '6px', border: `1px solid ${COLORS.border}`,
                        background: COLORS.white, color: COLORS.danger, fontWeight: 600, fontSize: '11px',
                        cursor: 'pointer', transition: 'all 0.2s', outline: 'none'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.danger; e.currentTarget.style.background = '#FDF2F2'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.background = COLORS.white; }}
                    >
                      Log Out
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ CONFIRM REVOKE SESSION MODAL ═══ */}
      {sessionToRevoke && (
        <div
          onClick={() => setSessionToRevoke(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(25, 27, 30, 0.45)', backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)', animation: 'fadeIn 0.2s ease',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '90%', maxWidth: '400px', background: COLORS.white,
              borderRadius: '16px', border: `1px solid ${COLORS.border}`, boxShadow: '0 20px 40px rgba(0,0,0,0.08)',
              padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
              animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', color: COLORS.danger }}>
              <div style={{
                background: '#FEF2F2', borderRadius: '50%', width: '40px', height: '40px',
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </div>
              <h4 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 600, color: COLORS.charcoal }}>
                Log Out Device?
              </h4>
            </div>

            <p style={{ margin: 0, fontSize: '13px', color: COLORS.stone, fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
              Are you sure you want to log out <strong>{sessionToRevoke.device_label || 'this device'}</strong> (IP: {sessionToRevoke.ip || 'unknown'})? You will be signed out on that device immediately.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                onClick={() => setSessionToRevoke(null)}
                style={{
                  padding: '8px 16px', minHeight: 'var(--fx-touch)', borderRadius: '8px', border: `1px solid ${COLORS.border}`,
                  background: COLORS.white, color: COLORS.stone, fontSize: '13px', fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-sans)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.softBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.white; }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = sessionToRevoke.id;
                  setSessionToRevoke(null);
                  await handleRevokeSession(id);
                }}
                style={{
                  padding: '8px 16px', minHeight: 'var(--fx-touch)', borderRadius: '8px', border: 'none',
                  background: COLORS.danger, color: COLORS.white, fontSize: '13px', fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-sans)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.dangerHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.danger; }}
              >
                Log Out Device
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .profile-row-grid {
          grid-template-columns: 1fr 1fr;
        }
        .profile-stats-grid {
          grid-template-columns: repeat(3, 1fr);
        }
        .profile-social-grid {
          grid-template-columns: repeat(3, 1fr);
        }
        @media (max-width: 639.98px) {
          .profile-row-grid,
          .profile-stats-grid,
          .profile-social-grid {
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }
        }
      `}</style>

    </div>
  );
}
