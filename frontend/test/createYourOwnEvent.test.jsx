import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';

import CreateYourOwnEvent from '../src/app/components/guest/CreateYourOwnEvent';

/* ═══════════════════════════════════════════════════════════════════════════
   THE ONLY MARKETING A GUEST EVER SEES, AND THE ONE RULE THAT GOVERNS IT.

   This block sits at the bottom of somebody's wedding invitation. Two things
   about it are not style choices and are therefore tested rather than reviewed:

     1. It DISAPPEARS for a white-labelled event. That is a paid entitlement —
        an organizer bought the removal of our branding, and finding our
        call-to-action on their guest page is the feature visibly not working.
     2. It takes the EVENT's colour. A gold block on a maroon invitation reads
        as an advertisement pasted underneath somebody's wedding; the same block
        in their own colour reads as the closing note of their page. That is the
        entire difference between this being acceptable and not.
   ═══════════════════════════════════════════════════════════════════════════ */

beforeAll(() => {
  /* framer-motion's useReducedMotion subscribes to matchMedia at module init,
     and jsdom has no matchMedia at all — without this the hook throws. Reporting
     "reduce" also takes the plain-div branch, so these assertions read the
     resting DOM rather than an animation's opening frame. */
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: /prefers-reduced-motion/.test(query),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
});

describe('Create your own event', () => {
  it('renders nothing at all for a white-labelled event', () => {
    const { container } = render(
      <CreateYourOwnEvent event={{ id: 'e1', tier_white_label: true }} themeColor="#B8944F" />,
    );
    expect(
      container.innerHTML,
      'a customer who paid to remove our branding must not find our marketing on their guest page',
    ).toBe('');
  });

  it('renders for an ordinary event', () => {
    const { getByText } = render(<CreateYourOwnEvent event={{ id: 'e2' }} themeColor="#B8944F" />);
    expect(getByText('Create your own')).toBeTruthy();
  });

  it('treats a missing entitlement as NOT white-labelled', () => {
    // Fails safe in the direction that shows the block, matching isWhiteLabel's
    // own contract: the mark stays on until the entitlement is certain.
    for (const event of [{ id: 'e3' }, { id: 'e4', tier_white_label: null }, {}]) {
      const { container } = render(<CreateYourOwnEvent event={event} themeColor="#B8944F" />);
      expect(container.innerHTML).not.toBe('');
    }
  });

  it('takes the event colour, and does not smuggle the brand gold in beside it', () => {
    const { container } = render(<CreateYourOwnEvent event={{ id: 'e5' }} themeColor="#7B2D3B" />);
    const html = container.innerHTML;

    // 123,45,59 is #7B2D3B — the component emits rgba() through its own alpha().
    expect(html, 'the block must be themed to the event').toContain('123, 45, 59');
    expect(html, 'the default gold must not appear on a maroon invitation')
      .not.toContain('184, 148, 79');
  });

  it('falls back to the brand gold only when given no colour at all', () => {
    const { container } = render(<CreateYourOwnEvent event={{ id: 'e6' }} />);
    expect(container.innerHTML).toContain('184, 148, 79');
  });

  it('sends cold traffic to the landing page, not to a signup form', () => {
    /* A guest here has never heard of this product; a bare /register asks them
       to commit before anything has explained what to. The landing page does
       that explaining and carries its own signup CTA. */
    const { container } = render(<CreateYourOwnEvent event={{ id: 'e7' }} themeColor="#B8944F" />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/?ref=invite');
    expect(hrefs, 'the signup form is the wrong first stop for cold traffic').not.toContain('/register');
    expect(hrefs.every((h) => h.includes('ref=invite')),
      'every link must carry attribution or this surface cannot be measured').toBe(true);

    // The mini invitation says nothing a screen reader needs; the headline and
    // the button carry the whole message.
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('stays silent on a memorial, in either language', () => {
    /* The platform hosts 25+ occasion types and they are not all celebrations.
       "Create your own" under a celebration-of-life invitation is indefensible
       at any level of craft — there is no wording that rescues it, so the block
       does not render at all. */
    for (const event of [
      { id: 'm1', template_data: { occasion: 'memorial' } },
      { id: 'm2', event_type: 'memorial' },
      { id: 'm3', template_data: { occasion: 'Celebration of Life — Memorial' } },
      { id: 'm4', template_data: { occasion: 'تأبين' } },
    ]) {
      const { container } = render(<CreateYourOwnEvent event={event} themeColor="#B8944F" />);
      expect(container.innerHTML, `should render nothing for ${JSON.stringify(event)}`).toBe('');
    }

    // …and still renders for an ordinary occasion, so the guard is not a blanket.
    const { container } = render(
      <CreateYourOwnEvent event={{ id: 'w1', template_data: { occasion: 'wedding' } }} themeColor="#B8944F" />,
    );
    expect(container.innerHTML).not.toBe('');
  });

  it('names the breadth of occasions rather than one of them', () => {
    // "for all types of events" — the guest reading this is planning something,
    // and it is usually not what they just attended.
    const { getByText } = render(<CreateYourOwnEvent event={{ id: 'b1' }} themeColor="#B8944F" />);
    expect(getByText(/Weddings, birthdays, graduations, corporate/)).toBeTruthy();
  });

  it('renders Arabic with RTL direction', () => {
    const { container, getByText } = render(
      <CreateYourOwnEvent event={{ id: 'e8' }} themeColor="#B8944F" isRTL />,
    );
    expect(getByText('اصنع دعوتك أنت')).toBeTruthy();
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
  });
});
