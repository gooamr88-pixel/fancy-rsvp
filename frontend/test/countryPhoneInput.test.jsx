import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import CountryFlag, { FLAGS } from '../src/app/components/CountryFlag';
import { COUNTRY_BY_CODE, lookupDialCode, countryName } from '../src/app/components/countries';
import CountryCodePhoneInput from '../src/app/components/CountryCodePhoneInput';

/* ═══════════════════════════════════════════════════════════════════════════
   THE GUEST PHONE FIELD.

   The flags here were emoji until 2026-09-04, and **Windows has no glyphs for
   regional-indicator pairs** — every guest on Chrome, Edge or Firefox on
   Windows saw two boxed letters instead of a flag. It looked perfect on the Mac
   it was written on, which is exactly why nothing caught it.

   These tests hold the replacement to the two properties that failure had:
   every mapped country must actually DRAW something, and the field must say
   which country it thinks the guest typed.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('country data', () => {
  it('every dialling code maps to a drawable flag', () => {
    /* A country in the table with no entry in FLAGS silently renders the globe
       — which is indistinguishable from "we do not know this code" and is the
       modern form of the emoji bug: a country that looks unsupported because a
       lookup quietly missed. */
    const missing = Object.entries(COUNTRY_BY_CODE)
      .filter(([, c]) => !FLAGS[c.iso2])
      .map(([dial, c]) => `+${dial} ${c.iso2}`);

    expect(missing, 'these countries fall back to the globe').toEqual([]);
  });

  it('every country carries an Arabic name', () => {
    // The guest surface is bilingual; a missing nameAr falls back to English
    // mid-sentence in an RTL paragraph, which reads as a bug.
    const missing = Object.entries(COUNTRY_BY_CODE)
      .filter(([, c]) => !c.nameAr || !c.iso2 || !c.name)
      .map(([dial]) => `+${dial}`);
    expect(missing).toEqual([]);
  });

  it('resolves a code only when it is complete', () => {
    /* Partial matching would make the flag flicker through countries as the
       guest types: "9" → somewhere, "96" → somewhere else, "966" → Saudi. A
       flag that changes country under their fingers is worse than one that
       waits. */
    expect(lookupDialCode('966')?.iso2).toBe('SA');
    expect(lookupDialCode('9')).toBe(null);
    expect(lookupDialCode('96')).toBe(null);
    expect(lookupDialCode('')).toBe(null);
    expect(lookupDialCode('99999')).toBe(null);
  });

  it('does not let a short code shadow a longer one', () => {
    // "+97" is unassigned while "+970".."+977" are real. A shortest-first scan
    // would answer +971 with whatever it found for a prefix of it.
    expect(lookupDialCode('971')?.iso2).toBe('AE');
    expect(lookupDialCode('970')?.iso2).toBe('PS');
    expect(lookupDialCode('97')).toBe(null);
  });

  it('names the country in the guest own language', () => {
    const sa = lookupDialCode('966');
    expect(countryName(sa, false)).toBe('Saudi Arabia');
    expect(countryName(sa, true)).toBe('السعودية');
    expect(countryName(null, false)).toBe(null);
  });
});

describe('CountryFlag', () => {
  it('draws an svg for a known country and a globe for an unknown one', () => {
    const known = render(<CountryFlag code="SA" size={22} />).container;
    expect(known.querySelector('svg')).toBeTruthy();
    expect(known.querySelectorAll('rect, circle, polygon, path').length).toBeGreaterThan(0);

    const unknown = render(<CountryFlag code="ZZ" size={22} />).container;
    expect(unknown.querySelector('svg'), 'an unmapped code must still render a placeholder').toBeTruthy();
  });

  it('is decorative unless given a title', () => {
    const plain = render(<CountryFlag code="EG" />).container.querySelector('svg');
    expect(plain.getAttribute('aria-hidden')).toBe('true');

    const named = render(<CountryFlag code="EG" title="Egypt" />).container.querySelector('svg');
    expect(named.getAttribute('aria-hidden')).toBe(null);
    expect(named.getAttribute('aria-label')).toBe('Egypt');
  });

  it('keeps one aspect ratio for every flag', () => {
    // Real flags are 2:3, 1:2, 3:5 and — for Nepal — not rectangular at all.
    // A ragged row makes the input jump as the guest types.
    for (const code of ['NP', 'CH', 'QA', 'US']) {
      const svg = render(<CountryFlag code={code} size={40} />).container.querySelector('svg');
      expect(svg.getAttribute('width')).toBe('40');
      expect(svg.getAttribute('height')).toBe('30');
    }
  });
});

describe('CountryCodePhoneInput', () => {
  const boxes = (container) => ({
    code: container.querySelector('.cc-phone-code'),
    number: container.querySelector('.cc-phone-number'),
  });

  it('splits a stored number on the real dialling code, not just the default', () => {
    /* The old split only recognised the caller's `defaultCountryCode`. A Saudi
       guest returning to a form defaulted to "1" got an EMPTY code box and
       "966512345678" spilled into the local-number box — no flag, and a number
       that only re-submitted correctly by accident of the two being
       concatenated. */
    const { container } = render(
      <CountryCodePhoneInput value="+966512345678" onChange={() => {}} defaultCountryCode="1" />,
    );
    const { code, number } = boxes(container);
    expect(code.value).toBe('966');
    expect(number.value).toBe('512345678');
  });

  it('names the country it resolved', () => {
    const { container } = render(<CountryCodePhoneInput value="+201012345678" onChange={() => {}} />);
    expect(container.querySelector('.cc-phone-country')?.textContent).toBe('Egypt');
  });

  it('names it in Arabic on an RTL surface', () => {
    const { container } = render(
      <CountryCodePhoneInput value="+971501234567" onChange={() => {}} isRTL />,
    );
    expect(container.querySelector('.cc-phone-country')?.textContent).toBe('الإمارات');
  });

  it('says so when it does not recognise the code', () => {
    /* Silence would be indistinguishable from "recognised, no name". A guest
       who typed +21 for +212 needs to be told the platform does not know it. */
    const { container } = render(<CountryCodePhoneInput value="+9991234567" onChange={() => {}} />);
    expect(container.querySelector('.cc-phone-unknown')).toBeTruthy();
    expect(container.querySelector('.cc-phone-country')).toBeFalsy();
  });

  it('reserves the status row so the form does not reflow while typing', () => {
    // An appearing/disappearing line shifts the layout under the guest's thumb
    // on the one field the whole RSVP depends on.
    const { container } = render(<CountryCodePhoneInput value="" onChange={() => {}} />);
    expect(container.querySelector('.cc-phone-status')).toBeTruthy();
  });

  /* fireEvent.change, NOT `el.value = x` + a manual input event. React installs
     its own value setter on the DOM node and tracks the last value it wrote;
     assigning directly bypasses that tracker, so React decides nothing changed
     and never fires onChange. The handler is genuinely wired — the test was
     not. */
  it('emits a single +E.164-shaped string', () => {
    let emitted = null;
    const { container } = render(
      <CountryCodePhoneInput value="" onChange={(v) => { emitted = v; }} defaultCountryCode="966" />,
    );
    fireEvent.change(boxes(container).number, { target: { value: '512345678' } });
    expect(emitted).toBe('+966512345678');
  });

  it('emits empty — not a bare country code — when the number is blank', () => {
    // Otherwise an untouched optional field submits "+1" and fails validation
    // for a guest who never typed anything.
    let emitted = 'unset';
    const { container } = render(
      <CountryCodePhoneInput value="+966512345678" onChange={(v) => { emitted = v; }} />,
    );
    fireEvent.change(boxes(container).number, { target: { value: '' } });
    expect(emitted).toBe('');
  });

  it('an unrecognised number is still split, so the warning can appear', () => {
    // The fallback used to leave the code box empty, which also suppressed the
    // hint — the one state most needing an explanation explained nothing.
    const { container } = render(<CountryCodePhoneInput value="+9991234567" onChange={() => {}} />);
    const { code, number } = boxes(container);
    expect(code.value).toBe('999');
    expect(number.value).toBe('1234567');
  });
});
