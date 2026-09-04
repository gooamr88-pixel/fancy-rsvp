'use client';
import React, { useEffect, useRef, useState } from 'react';
import CountryFlag from './CountryFlag';
import { lookupDialCode, countryName } from './countries';

const C = {
  charcoal: '#191B1E', stone: '#77736A', ink: '#4A4742',
  border: '#E8E2D6', white: '#FFFFFF', error: '#ef4444', gold: '#B8944F',
};

/* The dialling-code table used to be inline here as `COUNTRY_BY_CODE`, with an
   emoji flag per entry. It lives in ./countries.js now: replacing the emoji
   with drawn SVG gave it a second consumer that needs an ISO code rather than a
   glyph, and the Arabic surface gave it a fourth column. */

/**
 * Splits an existing "+<code><number>" value back into its two boxes.
 *
 * ── IT RESOLVES THE CODE, IT DOES NOT ASSUME IT ──
 *
 * This used to keep the code only when the digits happened to start with the
 * caller's `defaultCode`, and otherwise put the ENTIRE number — country code
 * included — in the local-number box with the code box left blank. So a Saudi
 * guest returning to a form defaulted to "1" saw an empty code box and
 * "966512345678" as their local number: no flag, and a number that re-submits
 * as "+966512345678" only by accident of the two boxes being concatenated.
 *
 * Longest-prefix lookup against the real table fixes it for every country in
 * the table, not just the default one.
 */
function splitInitialValue(value, defaultCode) {
  if (value && value.startsWith('+')) {
    const digits = value.slice(1);
    if (defaultCode && digits.startsWith(defaultCode)) {
      return { code: defaultCode, number: digits.slice(defaultCode.length) };
    }
    // Try the longest dialling code that this number actually starts with.
    for (let len = Math.min(4, digits.length); len >= 1; len -= 1) {
      const head = digits.slice(0, len);
      if (lookupDialCode(head)) return { code: head, number: digits.slice(len) };
    }
    /**
     * NOTHING MATCHED — still split, rather than dumping it all in one box.
     *
     * The fallback used to be `{ code: '', number: <everything> }`. The value
     * round-tripped correctly, but the field rendered an empty code box beside
     * a globe and one long undifferentiated number, and — worse — the
     * "unrecognised country code" hint is driven by `code`, so the one state
     * that most needs explaining was the one state that explained nothing.
     *
     * Three digits, because after the second pass over countries.js every
     * ASSIGNED one- and two-digit code is in the table. Reaching here at all
     * means the number is already outside the known set, and three is the modal
     * length. The emitted value is identical either way — the two boxes are
     * concatenated — so this is presentation, not data.
     */
    if (digits) return { code: digits.slice(0, 3), number: digits.slice(3) };
  }
  return { code: defaultCode, number: '' };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PHONE NUMBER — a numeric country-code box beside a numeric local-number box,
 * with a live flag and the country's NAME resolving as the guest types.
 *
 * Still no dropdown, by the original request: the flag is a read-only
 * confirmation of what was typed, not a picker. Composes both boxes into a
 * single "+<code><number>" string via onChange.
 *
 * ── WHAT CHANGED, AND WHY THE FLAG IS DRAWN NOW ──
 *
 * The flag was an emoji, and **Windows has no glyphs for regional-indicator
 * pairs** — every guest on Chrome, Edge or Firefox on Windows saw two boxed
 * letters where a flag belonged. It was not a rendering nicety that degraded;
 * the feature was absent for most desktop guests, invisibly, because it looks
 * perfect on a Mac. See components/CountryFlag.js.
 *
 * ── AND WHY THE COUNTRY IS NAMED IN WORDS ──
 *
 * A flag alone cannot confirm a match. Twenty-two countries share "+1", several
 * flags are near-identical at 22px (Ireland and Côte d'Ivoire, Chad and
 * Romania, Monaco and Indonesia), and a guest who mistypes "+21" for "+212"
 * gets a plausible-looking flag for a country they have never heard of. The
 * name under the field is what turns the flag from decoration into a
 * confirmation the guest can actually check — and it is what the request for
 * "a flag AND the country" was really asking for.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function CountryCodePhoneInput({
  value, onChange, placeholder, hasError = false, disabled = false, required = false,
  defaultCountryCode = '1', name, id, isRTL = false,
  'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy,
}) {
  const [{ code, number }, setParts] = useState(() => splitInitialValue(value, defaultCountryCode));
  // Tracks the value THIS component itself last emitted, so an external
  // change to `value` (a guest's saved phone number arriving asynchronously
  // after this input already mounted with it blank — the RSVP prefill/draft
  // effects in RsvpWizard.js and RsvpSection.js both do this) can still be
  // synced in, without fighting the guest's own typing (which also flows
  // back in through this same `value` prop via the parent's state).
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setParts(splitInitialValue(value, defaultCountryCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- external-value resync only; defaultCountryCode is static per caller
  }, [value]);

  const emit = (nextCode, nextNumber) => {
    const next = nextNumber ? `+${nextCode}${nextNumber}` : '';
    lastEmittedRef.current = next;
    onChange?.(next);
  };

  const handleCodeChange = (raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setParts({ code: digits, number });
    emit(digits, number);
  };

  const handleNumberChange = (raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, 14);
    setParts({ code, number: digits });
    emit(code, digits);
  };

  const country = lookupDialCode(code);
  const label = countryName(country, isRTL);
  const statusId = id ? `${id}-country` : undefined;

  return (
    <div className="cc-wrap">
      <div className={`cc-phone${hasError ? ' cc-phone--error' : ''}`}>
        <span className="cc-phone-prefix">
          {/* Decorative: the country is named in words below, and repeating it
              here would make a screen reader say it twice per keystroke. */}
          <CountryFlag code={country?.iso2} size={22} />
          <span className="cc-phone-plus" aria-hidden="true">+</span>
        </span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="tel-country-code"
          className="cc-phone-code"
          aria-label={country ? `Country code (${country.name})` : 'Country code'}
          aria-describedby={statusId}
          value={code}
          disabled={disabled}
          onChange={(e) => handleCodeChange(e.target.value)}
        />
        <input
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="tel-national"
          className="cc-phone-number"
          placeholder={placeholder || 'Phone number'}
          value={number}
          disabled={disabled}
          required={required}
          aria-invalid={ariaInvalid}
          aria-describedby={[ariaDescribedBy, statusId].filter(Boolean).join(' ') || undefined}
          onChange={(e) => handleNumberChange(e.target.value)}
        />
      </div>

      {/**
        * THE CONFIRMATION LINE.
        *
        * `aria-live="polite"` and not "assertive": it updates on a keystroke,
        * and an assertive region would interrupt the guest mid-word every time
        * they typed a digit. Polite queues it for the next pause, which is when
        * the information is actually wanted.
        *
        * The row is always in the DOM at a fixed height, even when empty. A line
        * that appears and disappears reflows the form under the guest's thumb
        * while they are typing into it — on the field the whole RSVP depends on.
        */}
      <div className="cc-phone-status" id={statusId} aria-live="polite">
        {code ? (
          label ? (
            <span className="cc-phone-country">{label}</span>
          ) : (
            <span className="cc-phone-unknown">
              {isRTL ? 'رمز دولة غير معروف' : 'Unrecognised country code'}
            </span>
          )
        ) : null}
      </div>

      <style jsx>{`
        .cc-wrap { width: 100%; }
        .cc-phone { display: flex; align-items: stretch; width: 100%; }
        .cc-phone-prefix {
          display: flex; align-items: center; gap: 7px; justify-content: center;
          padding: 0 8px 0 12px; background: ${C.white}; border: 1px solid ${C.border}; border-right: none;
          border-radius: 12px 0 0 12px;
        }
        .cc-phone-plus {
          color: ${C.stone}; font-size: 16px; font-family: var(--font-sans);
        }
        .cc-phone-code {
          width: 52px; flex-shrink: 0; text-align: center; box-sizing: border-box;
          padding: 14px 4px; background: ${C.white}; border: 1px solid ${C.border}; border-left: none; border-right: none;
          /* 16px, not 14px — below that iOS Safari auto-zooms on focus, and
             this is the phone number field, the single most-tapped input on
             the whole RSVP form. */
          font-size: 16px; color: ${C.charcoal}; font-family: var(--font-sans); outline: none;
          transition: border-color 0.25s ease, box-shadow 0.25s ease;
        }
        .cc-phone-number {
          flex: 1; min-width: 0; box-sizing: border-box; padding: 14px 16px;
          background: ${C.white}; border: 1px solid ${C.border}; border-radius: 0 12px 12px 0;
          font-size: 16px; color: ${C.charcoal}; font-family: var(--font-sans); outline: none;
          transition: border-color 0.25s ease, box-shadow 0.25s ease;
        }
        .cc-phone-code:focus, .cc-phone-number:focus {
          border-color: ${C.gold}; box-shadow: 0 0 0 3px rgba(184,148,79,0.12); position: relative; z-index: 1;
        }
        .cc-phone--error .cc-phone-prefix, .cc-phone--error .cc-phone-code, .cc-phone--error .cc-phone-number {
          border-color: ${C.error};
        }
        /* Reserved whether or not it has content — see the note above. */
        .cc-phone-status {
          min-height: 17px; margin-top: 5px; padding: 0 2px;
          font-family: var(--font-sans); font-size: 12px; line-height: 17px;
        }
        .cc-phone-country { color: ${C.ink}; font-weight: 600; }
        .cc-phone-unknown { color: ${C.stone}; }
      `}</style>
    </div>
  );
}
