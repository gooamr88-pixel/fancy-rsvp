import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';

/* ═══════════════════════════════════════════════════════════════════════════
   THE "APPLY MY TIMEZONE TO MY EVENTS" PROPOSAL.

   `events.timezone` is frozen at creation so that correcting a misdetected
   account cannot silently move events whose invitations already went out. The
   organizer still needs a way to repair the events they already have, so the
   profile save REPORTS which ones are on a different clock and they apply it
   in one deliberate press.

   This mounts the real screen and drives that flow, because the proposal only
   exists as a rendered response to a save — no static check can see it, and
   eslint is inert on this project.
   ═══════════════════════════════════════════════════════════════════════════ */

const apiFetch = vi.fn();
vi.mock('../src/app/utils/apiClient', () => ({
  apiFetch: (...args) => apiFetch(...args),
  logout: vi.fn(),
}));
vi.mock('../src/app/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const PROFILE = {
  id: 'org-1', name: 'Yousef Amr', email: 'y@x.com', phone: '+1555',
  bio: '', website: '', logo_url: '', social_links: {},
  timezone: 'America/Los_Angeles', timezone_source: 'manual',
};

const PROPOSAL = {
  timezone: 'Africa/Cairo',
  count: 2,
  events: [
    { id: 'e1', title: 'Evan Angelina Engagement', currentTimezone: 'America/Los_Angeles', readsAs: 'Aug 30, 2026, 20:00', shiftHours: -10 },
    { id: 'e2', title: 'Layla & Omar', currentTimezone: null, readsAs: 'Sep 12, 2026, 18:30', shiftHours: -10 },
  ],
};

let OrganizerProfile;
beforeAll(async () => {
  global.React = React;
  OrganizerProfile = (await import('../src/app/dashboard/components/OrganizerProfile')).default;
});

afterEach(() => { cleanup(); apiFetch.mockReset(); });

function route(saveResponse) {
  apiFetch.mockImplementation((path, opts) => {
    if (path === '/auth/profile' && !opts) return Promise.resolve({ profile: PROFILE });
    if (path === '/auth/sessions') return Promise.resolve({ sessions: [] });
    if (path === '/auth/profile' && opts?.method === 'PATCH') return Promise.resolve(saveResponse);
    if (path === '/auth/profile/timezone/apply') {
      return Promise.resolve({ success: true, updated: 2, failed: 0, message: '2 events moved.' });
    }
    return Promise.resolve({});
  });
}

async function saveAndGet(saveResponse) {
  route(saveResponse);
  const utils = render(<OrganizerProfile />);
  await waitFor(() => expect(utils.container.querySelector('select')).toBeTruthy());

  const save = [...utils.container.querySelectorAll('button')]
    .find((b) => /save/i.test(b.textContent));
  expect(save, 'the profile screen must have a save button').toBeTruthy();
  fireEvent.click(save);
  return utils;
}

describe('the timezone propagation proposal', () => {
  it('appears after a save that found events on another clock', async () => {
    const utils = await saveAndGet({ profile: PROFILE, timezonePropagation: PROPOSAL });

    await waitFor(() => {
      expect(utils.getByText(/2 events are on a different clock/i)).toBeTruthy();
    });
    // The one thing the organizer is actually weighing: the hour their guests
    // see does not change, the reminder timing does.
    expect(utils.getByText(/keeps every/i)).toBeTruthy();
    expect(utils.getByText(/Evan Angelina Engagement/)).toBeTruthy();
    // getAllByText, not getByText: BOTH events shift by the same amount here,
    // and asserting the count is the stronger check anyway — it proves every
    // row rendered rather than just the first.
    expect(utils.getAllByText(/reminders shift 10h earlier/i)).toHaveLength(2);
  });

  it('stays hidden when nothing needs changing', async () => {
    const utils = await saveAndGet({ profile: PROFILE, timezonePropagation: null });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ method: 'PATCH' })));
    expect(utils.queryByText(/different clock/i)).toBeNull();
  });

  it('applying calls the confirm endpoint and dismisses the card', async () => {
    const utils = await saveAndGet({ profile: PROFILE, timezonePropagation: PROPOSAL });
    await waitFor(() => expect(utils.getByText(/different clock/i)).toBeTruthy());

    const apply = [...utils.container.querySelectorAll('button')]
      .find((b) => /apply to all events/i.test(b.textContent));
    expect(apply).toBeTruthy();
    fireEvent.click(apply);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/auth/profile/timezone/apply', { method: 'POST' });
    });
    await waitFor(() => expect(utils.queryByText(/different clock/i)).toBeNull());
  });

  it('declining dismisses it without calling the endpoint', async () => {
    const utils = await saveAndGet({ profile: PROFILE, timezonePropagation: PROPOSAL });
    await waitFor(() => expect(utils.getByText(/different clock/i)).toBeTruthy());

    const leave = [...utils.container.querySelectorAll('button')]
      .find((b) => /leave them as they are/i.test(b.textContent));
    fireEvent.click(leave);

    await waitFor(() => expect(utils.queryByText(/different clock/i)).toBeNull());
    expect(apiFetch).not.toHaveBeenCalledWith('/auth/profile/timezone/apply', expect.anything());
  });
});
