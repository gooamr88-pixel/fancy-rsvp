import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import GuestSendMenu from '../src/app/dashboard/components/GuestSendMenu';

/* ═══════════════════════════════════════════════════════════════════════════
   THE SEND MENU HAS TO ESCAPE ITS ROW.

   It opened `position: absolute` inside the replies list, whose two wrappers
   both clip — `overflow: hidden` on the card and `overflow-x: auto` on the
   table (which the spec computes to `auto` on BOTH axes once y is visible). A
   292px panel opening from a row near the bottom was cut off, and on the last
   rows invisible. `z-index` never helped: clipping is not a stacking question.
   That is why it was broken on a desktop and on a phone with one cause.

   The fix portals the panel to document.body and positions it from the
   trigger's bounding rect. Portals are easy to get subtly wrong in ways that
   look fine until used — the outside-click handler in particular, since the
   panel stops being a descendant of the wrapper it used to be tested against.
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE = {
  guestName: 'Sara Mahmoud',
  busy: false,
  smsActive: true,
  reach: { reachable: true, label: 'Can be texted' },
  attending: true,
  onSend: () => {},
  onBuySms: () => {},
};

/** jsdom gives every element a zero rect; give the trigger a plausible one. */
function stubRect({ right = 900, bottom = 300, top = 260 } = {}) {
  Element.prototype.getBoundingClientRect = function rect() {
    return { right, bottom, top, left: right - 90, width: 90, height: 40, x: right - 90, y: top };
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubRect();
  window.innerWidth = 1280;
  window.innerHeight = 800;
});

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /send something to/i }));

describe('GuestSendMenu', () => {
  it('renders the panel outside the row that would clip it', () => {
    const { container } = render(<GuestSendMenu {...BASE} />);
    openMenu();

    const menu = screen.getByRole('menu');
    // The whole point: it is NOT inside the component's own subtree, so no
    // ancestor of the row can clip it.
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.style.position).toBe('fixed');
  });

  it('offers all four sends, grouped by channel with the cost stated once', () => {
    render(<GuestSendMenu {...BASE} />);
    openMenu();

    expect(screen.getByText('By email')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('By text message')).toBeInTheDocument();
    expect(screen.getByText('Uses your message balance')).toBeInTheDocument();
    // "The invitation" appears under both headings — one per channel.
    expect(screen.getAllByText('The invitation')).toHaveLength(2);
    expect(screen.getByText('Entry pass & table')).toBeInTheDocument();
    expect(screen.getByText('All their details')).toBeInTheDocument();
  });

  it('a click INSIDE the portalled panel does not close it', () => {
    // The regression this guards: the outside-click handler tested only the
    // wrapper ref. Once the panel is portalled it is no longer a descendant, so
    // every click in the menu read as "outside" and closed it before the button
    // it landed on could fire — the menu would have become unusable.
    const onSend = vi.fn();
    render(<GuestSendMenu {...BASE} onSend={onSend} />);
    openMenu();

    const menu = screen.getByRole('menu');
    fireEvent.mouseDown(menu);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Entry pass & table'));
    /* `{ channel, smsType }`, not a bare 'qr'. The menu grew items that share a
       channel and differ only by which text they send, so the channel string
       alone stopped identifying the action — the JSDoc had always documented an
       object here while the implementation passed a string. */
    expect(onSend).toHaveBeenCalledWith({ channel: 'qr', smsType: null });
  });

  it('a click on the page closes it', () => {
    render(<GuestSendMenu {...BASE} />);
    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes it', () => {
    render(<GuestSendMenu {...BASE} />);
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('never starts off the left edge of a narrow DESKTOP window', () => {
    // A desktop window dragged narrow still gets the anchored dropdown; the
    // clamp is what stops a right-aligned 292px panel starting off-screen.
    window.innerWidth = 900;
    stubRect({ right: 890, bottom: 300, top: 260 });
    render(<GuestSendMenu {...BASE} />);
    openMenu();

    const menu = screen.getByRole('menu');
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(12);
    expect(parseFloat(menu.style.width)).toBeLessThanOrEqual(900 - 24);
  });

  it('never forces a height taller than the room it has', () => {
    /**
     * The floor this guards was `Math.max(180, room)`, which is not a minimum
     * height but a promise to overflow: on a short viewport the real room is
     * under 180px and the panel would run off the screen — the same
     * "cannot reach the options" failure by another route.
     */
    window.innerHeight = 260;             // a landscape phone
    stubRect({ right: 900, bottom: 150, top: 110 });
    render(<GuestSendMenu {...BASE} />);
    openMenu();

    const menu = screen.getByRole('menu');
    expect(parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(260);
  });
});

describe('GuestSendMenu on a phone', () => {
  /**
   * Below md it stops being a dropdown. Anchored to a row, a ~300px panel on a
   * 667px screen lands wherever the row happens to be, flips direction with the
   * scroll position, and puts its options wherever the thumb is not. A sheet
   * from the bottom edge is what every mobile OS does instead.
   */
  const phone = () => { window.innerWidth = 390; window.innerHeight = 844; stubRect({ right: 370, bottom: 500, top: 460 }); };

  it('opens as a full-width sheet against the bottom edge', () => {
    phone();
    render(<GuestSendMenu {...BASE} />);
    openMenu();

    const menu = screen.getByRole('menu');
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.bottom).toBe('0px');
    expect(menu.style.left).toBe('0px');
    expect(menu.style.right).toBe('0px');
    // Not anchored to the row any more — no computed offset from the trigger.
    expect(menu.style.top).toBe('');
  });

  it('pays the home-indicator inset without risking the other three sides', () => {
    /**
     * Asserted as LONGHANDS on purpose. Written as the `padding` shorthand, a
     * parser that cannot read `env()` inside `max()` discards the entire
     * declaration and the sheet loses all of its padding — jsdom does exactly
     * that, which is how the fragility was noticed. The split means the worst
     * case is a slightly tight bottom edge rather than no padding anywhere.
     */
    phone();
    render(<GuestSendMenu {...BASE} />);
    openMenu();

    const menu = screen.getByRole('menu');
    expect(menu.style.paddingTop).toBe('6px');
    expect(menu.style.paddingLeft).toBe('6px');
    expect(menu.style.paddingRight).toBe('6px');
    // The bottom is the one jsdom may refuse to store; the point of the split is
    // that its failure cannot take the others with it.
    expect(menu.style.paddingTop).not.toBe('');
  });

  it('scrolls instead of growing past the screen', () => {
    phone();
    render(<GuestSendMenu {...BASE} />);
    openMenu();
    const menu = screen.getByRole('menu');
    expect(menu.style.maxHeight).toBe('85vh');
    expect(menu.style.overflowY).toBe('auto');
  });

  it('dims the page behind it, and tapping the dim closes it', () => {
    // On a phone there is no obvious "outside" to click once the sheet covers
    // the bottom of the screen, so the backdrop has to be the way out.
    phone();
    render(<GuestSendMenu {...BASE} />);
    openMenu();

    const backdrop = [...document.body.querySelectorAll('div')]
      .find((d) => d.style.position === 'fixed' && d.style.inset === '0px' && d.style.background.includes('rgba'));
    expect(backdrop).toBeTruthy();

    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows no backdrop on a desktop', () => {
    window.innerWidth = 1280;
    render(<GuestSendMenu {...BASE} />);
    openMenu();
    const backdrop = [...document.body.querySelectorAll('div')]
      .find((d) => d.style.position === 'fixed' && d.style.inset === '0px');
    expect(backdrop).toBeUndefined();
  });

  it('still sends from the sheet', () => {
    phone();
    const onSend = vi.fn();
    render(<GuestSendMenu {...BASE} onSend={onSend} />);
    openMenu();
    fireEvent.click(screen.getByText('All their details'));
    // `detail-sms` keeps its own channel string rather than becoming
    // { channel: 'sms', smsType: 'rsvp_confirmation' }: the dashboard keys its
    // per-guest spinner off the channel it sent and the API echoes back, so a
    // client mid-deploy that posts `detail-sms` has to keep getting it back.
    expect(onSend).toHaveBeenCalledWith({ channel: 'detail-sms', smsType: null });
  });

  it('the two newly manual texts are offered, and carry their type', () => {
    /* `seating_reminder` and `event_update` were send-on-a-schedule only. They
       are the reason onSend carries an object: all three of these items are
       channel 'sms' and are told apart by smsType alone. */
    const onSend = vi.fn();
    render(<GuestSendMenu {...BASE} onSend={onSend} />);
    openMenu();

    fireEvent.click(screen.getByText('Table & entry pass'));
    expect(onSend).toHaveBeenCalledWith({ channel: 'sms', smsType: 'seating_reminder' });

    openMenu();
    fireEvent.click(screen.getByText('Something has changed'));
    expect(onSend).toHaveBeenCalledWith({ channel: 'sms', smsType: 'event_update' });
  });

  it('opens upward when the trigger is near the bottom of the viewport', () => {
    // The last row of a list is exactly where "below" has no room, and exactly
    // where the old clipped panel disappeared entirely.
    stubRect({ right: 900, bottom: 780, top: 740 });
    render(<GuestSendMenu {...BASE} />);
    openMenu();

    const menu = screen.getByRole('menu');
    expect(menu.style.bottom).not.toBe('');
    expect(menu.style.top).toBe('');
  });

  it('is scrollable rather than taller than the screen', () => {
    render(<GuestSendMenu {...BASE} />);
    openMenu();
    const menu = screen.getByRole('menu');
    expect(menu.style.overflowY).toBe('auto');
    expect(parseFloat(menu.style.maxHeight)).toBeGreaterThan(0);
  });

  it('closes after choosing, so the next row is reachable', () => {
    render(<GuestSendMenu {...BASE} />);
    openMenu();
    fireEvent.click(screen.getAllByText('The invitation')[0]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
