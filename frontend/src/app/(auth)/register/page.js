'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../utils/apiClient';
import { getAuthErrorMessage } from '../../utils/authErrors';
import Toast from '../../components/Toast';
import OtpBoxes from '../../components/OtpBoxes';
import TurnstileWidget, { turnstileEnabled } from '../../components/guest/TurnstileWidget';

// Mirrors the backend's passwordRegex (authController.js) so weak passwords are
// caught before the round trip instead of only after a WEAK_PASSWORD rejection.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const PASSWORD_HINT = 'At least 8 characters, with an uppercase letter, a lowercase letter, and a number.';

const EyeIcon = ({ show }) => show ? (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#77736A" strokeWidth="1.5"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" strokeLinecap="round" strokeLinejoin="round"/><line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round"/></svg>
) : (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#77736A" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
);

export default function RegisterPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  /* The signup captcha. `verifyTurnstile` now guards POST /auth/register on
     the server, so a configured deployment REJECTS a registration with no
     token — this is what supplies it. Both halves are no-ops until their env
     var is set (NEXT_PUBLIC_TURNSTILE_SITEKEY here, TURNSTILE_SECRET there),
     and they must be switched on together: a secret without a sitekey would
     400 every signup on the platform.

     It is mounted now because a free trial makes an account worth something
     the moment it is created — a live event, a publishable invitation and a
     daily email allowance — where before this it was worth nothing until
     somebody paid. */
  const [captchaToken, setCaptchaToken] = useState(null);
  const turnstileRef = useRef(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef(null);
  const googleInitRef = useRef(false);

  // OTP verification state
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const otpBoxesRef = useRef(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const cooldownRef = useRef(null);

  // Referral attribution — read client-side (not next/navigation's useSearchParams,
  // which would force this page into a Suspense boundary) so a "?ref=CODE" link
  // silently rides along with the registration request. Mirrored into a ref
  // too: the Google Sign-In callback below is a closure created once inside a
  // mount-only effect, so it would otherwise forever see the initial ('') value.
  const [refCode, setRefCode] = useState('');
  const refCodeRef = useRef('');

  const router = useRouter();

  // Cleanup cooldown interval on unmount
  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  useEffect(() => {
    (() => {
      try {
        const ref = new URLSearchParams(window.location.search).get('ref');
        if (ref && ref.trim()) {
          refCodeRef.current = ref.trim();
          setRefCode(ref.trim());
        }
      } catch { /* no-op — referral attribution is best-effort */ }
    })();
  }, []);

  const startResendCooldown = () => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); cooldownRef.current = null; return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!firstName) errors.firstName = 'First name is required.';
    if (!lastName) errors.lastName = 'Last name is required.';
    if (!email) errors.email = 'Email is required.';
    if (!password) errors.password = 'Password is required.';
    else if (!PASSWORD_REGEX.test(password)) errors.password = PASSWORD_HINT;
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setToast({ message: errors.password && Object.keys(errors).length === 1 ? `Your password must meet the requirements below. ${PASSWORD_HINT}` : 'Please fill in all fields to create your account.', kind: 'error' });
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    setToast(null);

    try {
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, orgName, email, password, refCode, ...(captchaToken ? { captchaToken } : {}) })
      });

      if (data.success && data.requiresVerification) {
        setOtpStep(true);
        startResendCooldown();
      } else if (data.success) {
        // Success but no verification needed — store session data before redirect
        if (data.organization?.id) localStorage.setItem('org_id', data.organization.id);
        if (data.user?.role) localStorage.setItem('user_role', data.user.role);
        router.push('/dashboard');
      } else {
        setToast({ message: data.message || 'Registration failed. Please try again.', kind: 'error' });
      }
    } catch (err) {
      setToast({ message: getAuthErrorMessage(err, 'Registration failed. Please try again.'), kind: 'error' });
    } finally {
      // Turnstile tokens are single-use, so a failed attempt must ask for a
      // fresh one or the retry is refused for a reason the person cannot see.
      if (turnstileEnabled) { turnstileRef.current?.reset(); setCaptchaToken(null); }
      setSubmitting(false);
    }
  };

  // Re-registering while unverified issues a fresh OTP (see authController.register) —
  // reuses the same endpoint as the initial submit rather than a separate resend route.
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setToast(null);
    try {
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, orgName, email, password, refCode, ...(captchaToken ? { captchaToken } : {}) })
      });
      if (data.success) {
        setOtp('');
        startResendCooldown();
        setToast({ message: 'A new verification code has been sent to your email.', kind: 'success' });
        otpBoxesRef.current?.focusFirst();
      } else {
        setToast({ message: data.message || 'Failed to resend code. Please try again.', kind: 'error' });
      }
    } catch (err) {
      setToast({ message: getAuthErrorMessage(err, 'Failed to resend code. Please try again.'), kind: 'error' });
    } finally {
      setResending(false);
    }
  };

  // Lets the organizer fix a mistyped email (previously the only way back was
  // an undocumented full page refresh) — form fields are left intact.
  const handleBackToForm = () => {
    setOtpStep(false);
    setOtp('');
    setToast(null);
    if (cooldownRef.current) { clearInterval(cooldownRef.current); cooldownRef.current = null; }
    setResendCooldown(0);
  };

  // Load Google Sign-In on mount
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || googleInitRef.current) return;
    googleInitRef.current = true;

    const initGoogle = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          setGoogleLoading(true);
          setToast(null);
          try {
            const data = await apiFetch('/auth/google', {
              method: 'POST',
              body: JSON.stringify({ credential: response.credential, refCode: refCodeRef.current })
            });
            if (data.success) {
              localStorage.setItem('org_id', data.organization.id);
              localStorage.setItem('user_role', data.user.role);
              setGoogleLoading(false);
              router.push('/dashboard');
            } else {
              setToast({ message: data.message || 'Google sign-up failed. Please try again.', kind: 'error' });
              setGoogleLoading(false);
            }
          } catch (err) {
            setToast({ message: getAuthErrorMessage(err, 'Google sign-up failed. Please try again.'), kind: 'error' });
            setGoogleLoading(false);
          }
        },
        ux_mode: 'popup',
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        locale: 'en',
        width: googleBtnRef.current.offsetWidth || 360,
      });
    };

    if (window.google?.accounts?.id) {
      initGoogle();
    } else {
      const existing = document.getElementById('gsi-script');
      if (!existing) {
        const s = document.createElement('script');
        s.id = 'gsi-script';
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => setTimeout(initGoogle, 100);
        document.head.appendChild(s);
      } else {
        const check = setInterval(() => {
          if (window.google?.accounts?.id) { clearInterval(check); initGoogle(); }
        }, 200);
        const timeout = setTimeout(() => clearInterval(check), 10000);
        return () => { clearInterval(check); clearTimeout(timeout); };
      }
    }
    return () => {
      // Cleanup: no pending intervals to clear if Google loaded synchronously or via script onload
    };
  }, [router]);

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) return;

    setVerifying(true);
    setToast(null);

    try {
      const data = await apiFetch('/auth/verify-registration', {
        method: 'POST',
        body: JSON.stringify({ email, otp })
      });

      if (data.success) {
        localStorage.setItem('org_id', data.organization.id);
        localStorage.setItem('user_role', data.user.role);
        router.push('/dashboard');
      } else {
        setToast({ message: data.message || 'Verification failed. Please try again.', kind: 'error' });
      }
    } catch (err) {
      setToast({ message: getAuthErrorMessage(err, 'Verification failed. Please try again.'), kind: 'error' });
      setOtp('');
      otpBoxesRef.current?.focusFirst();
    } finally {
      setVerifying(false);
    }
  };



  // ─── OTP Verification Screen ───
  if (otpStep) {
    return (
      <div className="auth-page">
        <Toast toast={toast} onClose={() => setToast(null)} />

        <div className="auth-image-panel">
          <div className="auth-image-overlay" />
          <div className="auth-image-content">
            <div className="auth-brand">
              <svg
                width="38"
                height="32"
                viewBox="0 0 38 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ flexShrink: 0 }}
              >
                <rect x="2" y="8" width="34" height="22" rx="2" stroke="#FFFFFF" strokeWidth="2" fill="none" />
                <path d="M2 10L19 22L36 10" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinejoin="round" />
                <path d="M4 8L19 0L34 8" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinejoin="round" />
              </svg>
              <span className="auth-brand-fancy">Fancy</span>
              <span className="auth-brand-rsvp">RSVP</span>
            </div>
            <div className="auth-ornament">✦ ✦ ✦</div>
            <p className="auth-tagline">Almost There...</p>
            <div className="auth-shimmer" />
          </div>
        </div>

        <div className="auth-form-panel">
          <div className="auth-form-container otp-container">
            <div className="auth-mobile-logo">
              <svg
                width="30"
                height="25"
                viewBox="0 0 38 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ flexShrink: 0 }}
              >
                <rect x="2" y="8" width="34" height="22" rx="2" stroke="#B8944F" strokeWidth="2" fill="none" />
                <path d="M2 10L19 22L36 10" stroke="#B8944F" strokeWidth="2" fill="none" strokeLinejoin="round" />
                <path d="M4 8L19 0L34 8" stroke="#B8944F" strokeWidth="2" fill="none" strokeLinejoin="round" />
              </svg>
              <span className="auth-brand-fancy">Fancy</span>
              <span className="auth-brand-rsvp">RSVP</span>
            </div>

            {/* OTP Icon */}
            <div className="auth-icon-circle otp-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B8944F" strokeWidth="1.5">
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <h1 className="auth-heading">Verify Your Email</h1>
            <p className="auth-subtext">We sent a 6-digit code to <strong style={{ color: 'var(--gold-cta)' }}>{email}</strong></p>

            <form onSubmit={handleVerifyOtp}>
              <OtpBoxes
                ref={otpBoxesRef}
                value={otp}
                onChange={setOtp}
                disabled={verifying}
                autoFocus
                ariaLabel="6-digit verification code"
              />

              <button type="submit" disabled={verifying || otp.length !== 6} className="auth-submit-btn">
                {verifying ? (
                  <span className="auth-spinner-row"><span className="auth-spinner" /> Verifying...</span>
                ) : 'Verify & Continue'}
              </button>
            </form>

            <div className="otp-footer-row">
              <button type="button" className="otp-back-btn" onClick={handleBackToForm}>← Back</button>
              <button
                type="button"
                className="otp-retry-btn"
                onClick={handleResendOtp}
                disabled={resendCooldown > 0 || resending}
              >
                {resending ? 'Sending...' : resendCooldown > 0 ? `Resend Code (${resendCooldown}s)` : 'Resend Code'}
              </button>
            </div>
          </div>
        </div>

        <style jsx>{`${sharedStyles}
          .otp-container { text-align: center; }
          .otp-container .auth-icon-circle { margin: 0 auto 24px; }
          .otp-container .auth-heading { text-align: center; }
          .otp-container .auth-subtext { text-align: center; }
          .otp-icon { width: 64px; height: 64px; }
          .otp-footer-row {
            display: flex; justify-content: space-between; align-items: center;
            margin-top: 24px; padding-top: 20px; border-top: 1px solid #E8E2D6;
            font-size: 13px;
          }
          .otp-back-btn {
            background: none; border: none; color: #77736A; font-weight: 600;
            cursor: pointer; font-family: var(--font-sans); font-size: 13px;
            transition: color 0.2s; padding: 0;
          }
          .otp-back-btn:hover { color: #191B1E; }
          .otp-retry-btn {
            background: none; border: 1px solid rgba(184,148,79,0.3);
            color: var(--gold-cta); font-weight: 600; cursor: pointer;
            font-family: var(--font-sans); font-size: 13px;
            transition: all 0.2s; padding: 8px 16px; border-radius: 8px;
          }
          .otp-retry-btn:hover:not(:disabled) { background: rgba(184,148,79,0.08); border-color: var(--gold-cta); }
          .otp-retry-btn:disabled { opacity: 0.5; cursor: not-allowed; color: #999; border-color: rgba(184,148,79,0.15); }
        `}</style>
      </div>
    );
  }

  // ─── Registration Form ───
  return (
    <div className="auth-page">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div className="auth-image-panel">
        <div className="auth-image-overlay" />
        <div className="auth-image-content">
          <div className="auth-brand">
            <svg
              width="38"
              height="32"
              viewBox="0 0 38 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ flexShrink: 0 }}
            >
              <rect x="2" y="8" width="34" height="22" rx="2" stroke="#FFFFFF" strokeWidth="2" fill="none" />
              <path d="M2 10L19 22L36 10" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinejoin="round" />
              <path d="M4 8L19 0L34 8" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinejoin="round" />
            </svg>
            <span className="auth-brand-fancy">Fancy</span>
            <span className="auth-brand-rsvp">RSVP</span>
          </div>
          <div className="auth-ornament">✦ ✦ ✦</div>
          <p className="auth-tagline">Create Beautiful Events</p>
          <div className="auth-shimmer" />
        </div>
      </div>

      <div className="auth-form-panel">
        <div className="auth-form-container">
          <div className="auth-mobile-logo">
            <svg
              width="30"
              height="25"
              viewBox="0 0 38 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ flexShrink: 0 }}
            >
              <rect x="2" y="8" width="34" height="22" rx="2" stroke="#B8944F" strokeWidth="2" fill="none" />
              <path d="M2 10L19 22L36 10" stroke="#B8944F" strokeWidth="2" fill="none" strokeLinejoin="round" />
              <path d="M4 8L19 0L34 8" stroke="#B8944F" strokeWidth="2" fill="none" strokeLinejoin="round" />
            </svg>
            <span className="auth-brand-fancy">Fancy</span>
            <span className="auth-brand-rsvp">RSVP</span>
          </div>

          {/* Icon */}
          <div className="auth-icon-circle">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#B8944F" strokeWidth="1.5">
              <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8.5" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="20" y1="8" x2="20" y2="14" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="23" y1="11" x2="17" y2="11" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <h1 className="auth-heading">Create Your Account</h1>
          {/* Names the offer at the point of the ask. The hero promised seven
              free days; a signup form that then says something vaguer reads
              as a bait-and-switch, and the second clause is the one that
              actually removes the hesitation — nobody wants to hand over a
              card to look at something.

              It said "every feature" until an audit caught it. White-labelling
              is excluded from trials and text messages are bought separately,
              so "every feature" was a promise two screens further in would
              have to walk back — which is a worse first impression than a
              smaller claim that survives contact with the product. */}
          <p className="auth-subtext">Your first event is free for 7 days — no card needed</p>

          {refCode && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 20,
              padding: '10px 14px', borderRadius: 10,
              background: 'rgba(184,148,79,0.08)', border: '1px solid rgba(184,148,79,0.2)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B8944F" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--gold-cta)', fontWeight: 600, minWidth: 0, lineHeight: 1.5 }}>
                You were referred by a friend — sign up and they&apos;ll earn a reward.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-field-grid">
              <div className="auth-field">
                <label htmlFor="firstName" className="auth-label">First Name</label>
                <input id="firstName" type="text" required autoComplete="given-name"
                  value={firstName} onChange={e => { setFirstName(e.target.value); if (fieldErrors.firstName) setFieldErrors(prev => ({ ...prev, firstName: undefined })); }}
                  placeholder="Julian" className="auth-input"
                  aria-invalid={!!fieldErrors.firstName} aria-describedby={fieldErrors.firstName ? 'firstName-error' : undefined}
                  style={fieldErrors.firstName ? { borderColor: '#DC2626' } : undefined} />
                {fieldErrors.firstName && <span id="firstName-error" role="alert" className="auth-field-error">{fieldErrors.firstName}</span>}
              </div>
              <div className="auth-field">
                <label htmlFor="lastName" className="auth-label">Last Name</label>
                <input id="lastName" type="text" required autoComplete="family-name"
                  value={lastName} onChange={e => { setLastName(e.target.value); if (fieldErrors.lastName) setFieldErrors(prev => ({ ...prev, lastName: undefined })); }}
                  placeholder="Vance" className="auth-input"
                  aria-invalid={!!fieldErrors.lastName} aria-describedby={fieldErrors.lastName ? 'lastName-error' : undefined}
                  style={fieldErrors.lastName ? { borderColor: '#DC2626' } : undefined} />
                {fieldErrors.lastName && <span id="lastName-error" role="alert" className="auth-field-error">{fieldErrors.lastName}</span>}
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="orgName" className="auth-label">Organization <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label>
              <input id="orgName" type="text"
                value={orgName} onChange={e => setOrgName(e.target.value)}
                placeholder="Wedding Suite" className="auth-input" />
            </div>

            <div className="auth-field">
              <label htmlFor="reg-email" className="auth-label">Email Address</label>
              <input id="reg-email" type="email" required autoComplete="email"
                value={email} onChange={e => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: undefined })); }}
                placeholder="host@example.com" className="auth-input"
                aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'reg-email-error' : undefined}
                style={fieldErrors.email ? { borderColor: '#DC2626' } : undefined} />
              {fieldErrors.email && <span id="reg-email-error" role="alert" className="auth-field-error">{fieldErrors.email}</span>}
            </div>

            <div className="auth-field">
              <label htmlFor="reg-password" className="auth-label">Password</label>
              <div className="auth-password-wrapper">
                <input id="reg-password" type={showPassword ? 'text' : 'password'} required
                  autoComplete="new-password"
                  value={password} onChange={e => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: undefined })); }}
                  placeholder="••••••••" className="auth-input"
                  aria-invalid={!!fieldErrors.password} aria-describedby="reg-password-hint"
                  style={fieldErrors.password ? { borderColor: '#DC2626' } : undefined} />
                <button type="button" className="auth-eye-btn" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  <EyeIcon show={showPassword} />
                </button>
              </div>
              <p id="reg-password-hint" className={fieldErrors.password ? 'auth-field-error' : 'auth-field-hint'}>{fieldErrors.password || PASSWORD_HINT}</p>
            </div>

            {turnstileEnabled && (
              <div style={{ margin: '4px 0 16px' }}>
                <TurnstileWidget
                  ref={turnstileRef}
                  onVerify={setCaptchaToken}
                  onExpire={() => setCaptchaToken(null)}
                  onError={() => setCaptchaToken(null)}
                />
              </div>
            )}

            <button type="submit" disabled={submitting} className="auth-submit-btn">
              {submitting ? (
                <span className="auth-spinner-row"><span className="auth-spinner" /> Creating account...</span>
              ) : 'Create Account'}
            </button>
          </form>

          {/* OR Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '24px 0' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(184, 148, 79, 0.2)' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted-stone)', textTransform: 'uppercase', letterSpacing: '1.5px' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(184, 148, 79, 0.2)' }} />
          </div>

          {/* Google Sign-Up — rendered natively by Google */}
          {googleLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
              <span className="auth-spinner-row"><span className="auth-spinner" /> Signing up with Google...</span>
            </div>
          )}
          <div ref={googleBtnRef} className="auth-google-container" style={{ display: googleLoading ? 'none' : 'flex' }} />

          <div className="auth-footer-divider" />
          <p className="auth-footer-text">
            Already hosting? <Link href="/login" className="auth-gold-link">Log In</Link>
          </p>
        </div>
      </div>

      <style jsx>{`${sharedStyles}
        .auth-field-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 639.98px) {
          .auth-field-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

// ─── Shared Styles (used by both registration and OTP views) ───
const sharedStyles = `
  .auth-page {
    display: flex;
    min-height: 100dvh;
    font-family: var(--font-sans), Lato, sans-serif;
  }
  .auth-image-panel {
    position: relative;
    width: 50%;
    min-height: 100dvh;
    background: url('/images/auth-bg.png') center/cover no-repeat;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .auth-image-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(135deg, rgba(25,27,30,0.75) 0%, rgba(25,27,30,0.45) 100%);
  }
  .auth-image-content {
    position: relative; z-index: 1; text-align: center;
    animation: authFadeIn 1s ease 0.2s both;
  }
  .auth-brand { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px; }
  .auth-brand-fancy { font-family: var(--font-script); font-size: 48px; font-weight: 400; color: #FFFFFF; line-height: 1; }
  .auth-brand-rsvp { font-family: var(--font-serif); font-size: 32px; font-weight: 600; color: #FFFFFF; letter-spacing: 4px; text-transform: uppercase; line-height: 1; }
  .auth-ornament { color: #D7BE80; font-size: 10px; letter-spacing: 8px; margin-bottom: 20px; }
  .auth-tagline { font-family: var(--font-serif); font-size: 18px; font-weight: 400; font-style: italic; color: rgba(255,255,255,0.7); max-width: 280px; margin: 0 auto 24px; line-height: 1.5; }
  .auth-shimmer { width: 60px; height: 1px; margin: 0 auto; background: linear-gradient(90deg, transparent, #D7BE80, #B8944F, #D7BE80, transparent); background-size: 200% 100%; animation: shimmer 3s linear infinite; }

  .auth-form-panel {
    width: 50%; min-height: 100dvh; background: #FFFFFF;
    display: flex; align-items: center; justify-content: center; padding: 48px 40px;
  }
  .auth-form-container {
    width: 100%; max-width: 420px;
    animation: authFadeInUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .auth-mobile-logo { display: none; align-items: center; justify-content: center; gap: 6px; margin-bottom: 32px; }
  .auth-icon-circle {
    width: 52px; height: 52px; border-radius: 50%;
    background: rgba(184,148,79,0.06); border: 1px solid rgba(184,148,79,0.1);
    display: flex; align-items: center; justify-content: center; margin-bottom: 24px;
  }
  .auth-heading { font-family: var(--font-serif); font-size: 28px; font-weight: 500; color: #191B1E; margin: 0 0 8px; letter-spacing: -0.01em; }
  .auth-subtext { font-size: 14px; font-weight: 400; color: #77736A; margin: 0 0 32px; }
  .auth-form { display: flex; flex-direction: column; gap: 20px; }
  .auth-label { display: block; font-size: 11px; font-weight: 700; color: #77736A; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; font-family: var(--font-sans); }
  .auth-input {
    width: 100%; padding: 14px 16px; border: 1.5px solid #E8E2D6; border-radius: 10px;
    background: #FAFAF8; color: #191B1E; font-size: 14px; font-family: var(--font-sans);
    outline: none; transition: all 0.3s ease; box-sizing: border-box;
  }
  .auth-input:focus { border-color: #B8944F; background: #FFFFFF; box-shadow: 0 0 0 3px rgba(184,148,79,0.08); }
  .auth-input::placeholder { color: #B5B0A7; }
  .auth-password-wrapper { position: relative; }
  .auth-password-wrapper .auth-input { padding-right: 48px; }
  .auth-eye-btn { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; opacity: 0.6; transition: opacity 0.2s; }
  .auth-eye-btn:hover { opacity: 1; }
  .auth-field-hint { font-size: 11.5px; color: var(--muted-stone); margin: 6px 0 0; line-height: 1.4; }
  .auth-field-error { display: block; font-size: 11.5px; color: #DC2626; margin: 6px 0 0; line-height: 1.4; }
  .auth-submit-btn {
    width: 100%; padding: 16px;
    background: linear-gradient(135deg, var(--gold-cta) 0%, var(--gold-cta-hover) 100%);
    color: #FFFFFF; border: none; border-radius: 10px;
    font-size: 14px; font-weight: 700; font-family: var(--font-sans);
    letter-spacing: 0.06em; cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); margin-top: 4px;
  }
  .auth-submit-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(184,148,79,0.3); }
  .auth-submit-btn:active:not(:disabled) { transform: translateY(0); }
  .auth-submit-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .auth-spinner-row { display: flex; align-items: center; justify-content: center; gap: 8px; }
  .auth-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #FFFFFF; border-radius: 50%; animation: authSpin 0.6s linear infinite; }
  .auth-google-container {
    width: 100%; display: flex; justify-content: center; min-height: 44px;
  }
  .auth-google-container:empty::after {
    content: 'Loading Google Sign-In...';
    font-size: 13px; color: var(--muted-stone); display: flex; align-items: center; justify-content: center;
    width: 100%; height: 44px; border: 1px dashed rgba(184, 148, 79, 0.3); border-radius: 10px;
  }
  .auth-footer-divider { width: 40px; height: 1px; background: #E8E2D6; margin: 28px auto 20px; }
  .auth-footer-text { text-align: center; font-size: 13px; color: #77736A; margin: 0; }
  .auth-gold-link { color: var(--gold-cta); font-weight: 700; text-decoration: none; transition: color 0.2s; }
  .auth-gold-link:hover { color: var(--gold-cta-hover); }

  @keyframes authFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes authFadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes authSpin { to { transform: rotate(360deg); } }

  @media (max-width: 767.98px) {
    .auth-page { flex-direction: column; }
    .auth-image-panel { display: none; }
    .auth-form-panel { width: 100%; min-height: 100dvh; background: linear-gradient(180deg, #F8F4EC 0%, #FFFFFF 40%); padding: 40px 24px; }
    .auth-mobile-logo { display: flex; }
    .auth-mobile-logo .auth-brand-fancy { color: #B8944F; font-size: 36px; }
    .auth-mobile-logo .auth-brand-rsvp { color: #191B1E; font-size: 24px; letter-spacing: 3px; }
    .auth-heading { font-size: 24px; }
    .auth-form-container { max-width: 100%; }
  }
`;

