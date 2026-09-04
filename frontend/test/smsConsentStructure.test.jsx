import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import SmsConsentText, {
  SmsConsentIndependence,
  OrganizerSmsConsentText,
  SMS_CONSENT_TEXT_VERSION,
  ORGANIZER_SMS_CONSENT_TEXT_VERSION,
} from '../src/app/components/guest/SmsConsentText';
import OrganizerSmsPanel from '../src/app/dashboard/campaigns/OrganizerSmsPanel';

/* ═══════════════════════════════════════════════════════════════════════════
   THE CONSENT LAYOUT IS A COMPLIANCE REQUIREMENT, SO IT IS TESTED AS ONE.

   Twilio rejected this account once already (review 30475, "Consent for
   Messaging Cannot Be Part of Other Agreements") because the Privacy and Terms
   links sat INSIDE the checkbox label — which reads as "ticking this box also
   accepts our Terms". The fix was structural: the sentence the person agrees to
   goes inside the label, and the independence notice with the policy links goes
   outside it, below.

   That is a DOM-shape rule. No string assertion can see it: the same words in
   the same order pass a text check whether they are inside the label or not.
   Until this file, nothing rendered these components at all — which is how the
   module reached today missing the React import that vitest's classic JSX
   runtime needs, i.e. it could not have been rendered by a test even in
   principle.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SMS consent — the structure Twilio reviews', () => {
  it('the organizer panel keeps the policy links OUT of the checkbox label', () => {
    const { container } = render(
      <OrganizerSmsPanel apiUrl="https://example.invalid" eventId="e1" organizerSms={{}} />,
    );

    const label = container.querySelector('label:has(input[type="checkbox"])');
    expect(label, 'the consent checkbox must sit in a label').toBeTruthy();

    expect(
      label.querySelectorAll('a').length,
      'a link inside the label is the exact construction review 30475 refused',
    ).toBe(0);

    // The notice itself is present, and it is a sibling of the label rather
    // than a descendant of it.
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/privacy');
    expect(links).toContain('/terms');
    for (const a of container.querySelectorAll('a')) {
      expect(label.contains(a), 'every policy link must live outside the label').toBe(false);
    }
  });

  it('the organizer sentence carries every element the guest one does', () => {
    const { container } = render(<OrganizerSmsConsentText />);
    const text = container.textContent;

    // Each of these is required by CTIA/TFV and each has been lost from a
    // consent sentence somewhere before.
    expect(text).toMatch(/FancyRSVP/);              // brand
    expect(text).toMatch(/headcount summary/i);      // what they will receive
    expect(text).toMatch(/frequency varies/i);       // frequency
    expect(text).toMatch(/rates may apply/i);        // rates
    expect(text).toMatch(/\bSTOP\b/);                // opt-out keyword
    expect(text).toMatch(/\bHELP\b/);                // help keyword
  });

  it('the organizer sentence does not describe messages an organizer never gets', () => {
    const organizer = render(<OrganizerSmsConsentText />).container.textContent;
    const guest = render(<SmsConsentText />).container.textContent;

    expect(organizer).not.toBe(guest);
    // The guest sentence promises invitation links and RSVP confirmations. An
    // organizer receives one type only: a headcount summary before their event.
    expect(organizer).not.toMatch(/invitation links/i);
    expect(organizer).not.toMatch(/RSVP confirmations/i);
  });

  it('the two wordings are versioned apart', () => {
    expect(ORGANIZER_SMS_CONSENT_TEXT_VERSION).toBeTruthy();
    expect(
      ORGANIZER_SMS_CONSENT_TEXT_VERSION,
      'sharing a stamp means editing the guest sentence re-dates every organizer consent',
    ).not.toBe(SMS_CONSENT_TEXT_VERSION);
  });

  it('the disclosure notice states the three things it has to', () => {
    /* THIS TEST WAS INVERTED ON 2026-09-04, AND THAT IS THE POINT OF THE NOTE.
     *
     * It used to require the words "voluntary" and "not required". Those came
     * from the sentence filed with Twilio against review 30475 — "SMS consent
     * is voluntary and is not required to register, RSVP, attend an event, or
     * use FancyRSVP" — and that sentence became FALSE when the checkbox was
     * made a condition of submitting an RSVP.
     *
     * A test that still demanded those words would have forced the page to keep
     * a claim the product contradicts, which is worse than having no test: it
     * would actively defend a false statement in the exact screenshot a
     * reviewer takes.
     *
     * What the notice must carry NOW is the honest equivalent, and all three
     * are load-bearing:
     *   why the number is needed  — a required field with no stated purpose is
     *                               what people abandon a form over
     *   how to stop               — with the box required, STOP is the only
     *                               exit a guest has
     *   independence              — ticking this is still not an acceptance of
     *                               the Terms or the Privacy Policy, which is
     *                               what 30475 was actually about
     *
     * See SmsConsentText.js for the full rationale and the required re-filing.
     */
    const { container } = render(<SmsConsentIndependence />);
    const text = container.textContent;

    expect(text, 'the notice must say why the number is needed').toMatch(/table number|entry pass/i);
    expect(text, 'STOP is now the guest\'s only exit and must be stated here').toMatch(/\bSTOP\b/);
    expect(text, 'consent must still be independent of the other agreements').toMatch(/independent/i);

    // And it must NOT claim to be optional any more, because it is not.
    expect(
      text,
      'the checkbox blocks submission — a notice calling it voluntary is a false statement on the page',
    ).not.toMatch(/voluntary|not required to (register|RSVP)/i);
  });

  it('the policy links stay OUT of the guest label too', () => {
    /* The structural rule 30475 is actually about, asserted on the guest
       surface as well as the organizer one. Making the box required changed
       WHETHER consent is optional; it did not change what the box is allowed to
       collect, and this is what proves that. */
    const { container } = render(<SmsConsentText />);
    expect(container.querySelectorAll('a').length,
      'the guest consent sentence must contain no links at all').toBe(0);
  });
});
