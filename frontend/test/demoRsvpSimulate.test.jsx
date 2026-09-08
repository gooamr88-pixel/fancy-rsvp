import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import RsvpSection from '../src/app/components/templates/heritageArch/sections/RsvpSection';
import { buildDemoEvent, DEMO_SLUG } from '../src/app/demo/fixtures/demoEvent.mjs';

/* ═══════════════════════════════════════════════════════════════════════════
   TWO MODES THAT MUST NOT COLLAPSE INTO ONE.

   The RSVP form is now reached by three kinds of caller, and the difference
   between the last two is the whole point of this file:

     a guest      validates, then POSTs.
     readOnly     validates, then STOPS. The organizer's wizard preview, whose
                  event has no row on the server yet — a submit would 404, and
                  a preview that appeared to record a response would be lying
                  about the one thing it exists to demonstrate.
     simulate     validates, then COMPLETES locally. The marketing demo, where
                  a stranger has to reach the confirmation screen and their
                  own entry pass.

   Both assertions live in one file on purpose. The tempting shortcut is to
   let `readOnly` submit — and the day somebody takes it, a test that only
   proved simulate reaches confirmation would still pass, while every wizard
   preview in the product started posting into a 404.

   Neither mode may touch the network, and that is asserted in both.
   ═══════════════════════════════════════════════════════════════════════════ */

const baseProps = {
  event: buildDemoEvent(),
  slug: DEMO_SLUG,
  guestRsvp: null,
  hasResponded: false,
  responseStatus: null,
  allowGuestEdits: true,
  effectiveRsvpId: null,
  isRTL: false,
  trackEvent: () => {},
};

/** Decline rather than accept: the shortest legal submission this form has.
 *  A "yes" additionally requires a phone in E.164, an email and an explicit
 *  SMS consent, none of which this file is about. */
async function declineAndSubmit(user) {
  await user.click(screen.getByRole('radio', { name: /Sadly, can't make it/i }));
  await user.type(screen.getByPlaceholderText('Your name'), 'Nour Haddad');
  await user.click(screen.getByRole('button', { name: /Send my reply/i }));
}

describe('the RSVP form in its two non-writing modes', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => { throw new Error('the demo must never reach the network'); });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('simulate: reaches the confirmation screen without a single request', async () => {
    const user = userEvent.setup();
    render(<RsvpSection {...baseProps} simulate />);

    await declineAndSubmit(user);

    /* The form is REPLACED by the confirmation, so the submit button going
       away is the assertion — it is the same signal a guest gets. The wait
       is real: the hook holds the pending state briefly on purpose, because
       a submit that resolves in the same frame never shows the spinner a
       real guest sees. */
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /Send my reply/i })).toBeNull(),
      { timeout: 5000 },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('readOnly: still stops at validation and says so', async () => {
    const user = userEvent.setup();
    render(<RsvpSection {...baseProps} readOnly />);

    await declineAndSubmit(user);

    // The notice, and the form still standing behind it.
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send my reply/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('readOnly still VALIDATES — it does not just refuse', async () => {
    /* The mode stops AFTER validation, not before. An organizer who could
       submit an empty form in preview would ship a form whose validation
       they had never seen fire. */
    const user = userEvent.setup();
    render(<RsvpSection {...baseProps} readOnly />);

    await user.click(screen.getByRole('radio', { name: /Sadly, can't make it/i }));
    await user.click(screen.getByRole('button', { name: /Send my reply/i }));

    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('simulate validates too, so the demo shows a form that behaves', async () => {
    const user = userEvent.setup();
    render(<RsvpSection {...baseProps} simulate />);

    await user.click(screen.getByRole('radio', { name: /Sadly, can't make it/i }));
    await user.click(screen.getByRole('button', { name: /Send my reply/i }));

    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send my reply/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
