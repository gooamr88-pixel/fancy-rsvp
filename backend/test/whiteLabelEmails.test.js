/**
 * WHITE LABEL — the guest never learns which company built this.
 *
 * `white_label` was a pricing-page bullet with nothing behind it for the whole
 * life of the registry. It is real now, and the way it fails is by being
 * ALMOST complete: ten guest emails carry the host's name and the eleventh
 * still opens with our logo, or the invitation is clean and the reminder that
 * goes out at T-24h is not. Nobody proofreads eleven templates in two languages
 * before a wedding, so this does it on every commit.
 *
 * The check is deliberately not "did the shell get the flag" — it renders each
 * template and greps the OUTPUT for our marks. A twelfth guest template added
 * without the branding line fails here, which is the only way to catch the one
 * mistake that matters: a template that is fine in review and wrong in an inbox.
 *
 * ── What is allowed to remain, and why ──
 *
 * The legal footer. Company name and postal address are a CAN-SPAM disclosure
 * about the SENDER, and the sender is us — the mail leaves our infrastructure,
 * our domain and our IP reputation. Stripping it to look whiter would make the
 * message unlawful and damage deliverability for every customer sharing that
 * reputation. So the test asserts the MARKS are gone and the DISCLOSURE stays;
 * asserting the string "Fancy" never appears at all would be asserting the
 * wrong thing, and would be "fixed" one day by deleting a legal requirement.
 */
require('./helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const T = require('../utils/emailTemplates');

const BASE_EVENT = {
  id: 'evt-1',
  title: 'Evan & Angelina',
  slug: 'evan-and-angelina',
  event_date: '2026-09-19T18:30:00Z',
  timezone: 'America/Los_Angeles',
  location_name: 'The Grand Ballroom',
  location_address: '100 Front St W, San Diego',
};

const WHITE_LABEL_EVENT = { ...BASE_EVENT, tier_white_label: true };

const PARTY = {
  id: 'party-1', label: 'Evan Vance', guest_name: 'Evan Vance',
  email: 'evan@example.com', response: 'yes', party_size: 2,
  public_id: 'abc123', token: 'tok-1',
};

const LINKS = {
  view: 'https://fancyrsvp.com/e/evan-and-angelina',
  rsvp: 'https://fancyrsvp.com/e/evan-and-angelina/rsvp',
  qrImageUrl: 'https://fancyrsvp.com/qr/abc123.png',
  ticket: 'https://fancyrsvp.com/t/abc123',
};

/**
 * Every guest-facing builder, with the arguments each one takes.
 *
 * A guest email is one a GUEST receives. Organizer mail (their new-RSVP alert,
 * reports, receipts) and account mail (verification, password reset) are
 * deliberately absent: those are genuinely from us to our own customer, and an
 * unbranded password-reset email is how a security message reads as phishing.
 */
const GUEST_TEMPLATES = [
  ['getInvitationTemplate', (ev, lang) => T.getInvitationTemplate(PARTY, ev, LINKS, lang)],
  ['getRSVPConfirmationTemplate', (ev, lang) => T.getRSVPConfirmationTemplate(PARTY, ev, lang, LINKS)],
  ['getDeclineConfirmationTemplate', (ev, lang) => T.getDeclineConfirmationTemplate(PARTY, ev, lang)],
  ['getCompanionRSVPConfirmationTemplate', (ev, lang) => T.getCompanionRSVPConfirmationTemplate('Mira', 'Evan Vance', ev, LINKS.view, lang)],
  ['getRsvpClaimTemplate', (ev, lang) => T.getRsvpClaimTemplate('Evan Vance', ev, LINKS.rsvp, lang)],
  ['getQRTicketTemplate', (ev, lang) => T.getQRTicketTemplate(PARTY, ev, { tableName: '5', links: LINKS, lang })],
  ['getRsvpReminderTemplate', (ev, lang) => T.getRsvpReminderTemplate(PARTY, ev, LINKS, lang)],
  ['getEventReminderTemplate', (ev, lang) => T.getEventReminderTemplate(PARTY, ev, { tableName: '5', links: LINKS }, lang)],
  ['getPostEventThankYouTemplate', (ev, lang) => T.getPostEventThankYouTemplate(PARTY, ev, lang)],
  ['getEventUpdatedTemplate', (ev, lang) => T.getEventUpdatedTemplate(PARTY, ev, [{ label: 'Time', from: '6:30 PM', to: '7:00 PM' }], LINKS.view, lang)],
  ['getEventCancelledTemplate', (ev, lang) => T.getEventCancelledTemplate(PARTY, ev, LINKS.view, lang, 'A family emergency')],
];

/**
 * The marks a white-labelled guest email must not contain.
 *
 * The wordmark pattern is pinned to the ITALIC serif styling on purpose. A
 * looser `>Fancy RSVP<` also matches the legal footer two elements below it —
 * which this feature deliberately keeps — so the loose version fails a correct
 * implementation and gets "fixed" by deleting a CAN-SPAM disclosure.
 */
const BRAND_MARKS = [
  { name: 'the gold "Fancy RSVP" wordmark', re: /font-style:italic;[^>]*>Fancy RSVP</ },
  { name: 'the logo image', re: /logo-email\.png/ },
  { name: 'the "sent via" line (EN)', re: /Sent via Fancy RSVP/i },
  { name: 'the "sent via" line (AR)', re: /أُرسلت عبر Fancy RSVP/ },
  { name: 'the tagline (EN)', re: /Elegant RSVPs/i },
  { name: 'the tagline (AR)', re: /دعوات أنيقة/ },
];

describe('a white-labelled event email', () => {
  for (const [name, render] of GUEST_TEMPLATES) {
    for (const lang of ['en', 'ar']) {
      it(`${name} (${lang}) carries no Fancy mark`, () => {
        const html = render(WHITE_LABEL_EVENT, lang);

        for (const mark of BRAND_MARKS) {
          assert.ok(
            !mark.re.test(html),
            `${name} still shows ${mark.name} on a white-label plan. Every guest-facing `
            + 'builder must spread ...guestBrand(event) into its emailShell call.',
          );
        }
      });

      it(`${name} (${lang}) shows the host's name instead`, () => {
        const html = render(WHITE_LABEL_EVENT, lang);
        // Escaped, because the masthead escapes it — this fixture's ampersand is
        // there precisely so a template that interpolated the title raw would
        // show up here as an injection risk rather than passing quietly.
        assert.ok(
          html.includes(T.escapeHtml(BASE_EVENT.title)),
          `${name} dropped our masthead without putting the host's in its place — `
          + 'a white-label email must not simply open with a gap.',
        );
      });
    }
  }

  it('keeps the legal sender disclosure', () => {
    // CAN-SPAM is about the sender, and the sender is still us. Removing this to
    // look whiter makes the mail unlawful and hurts deliverability for every
    // customer on the shared sending reputation.
    const html = T.getInvitationTemplate(PARTY, WHITE_LABEL_EVENT, LINKS, 'en');
    assert.ok(/Fancy/.test(html), 'the legal footer must survive white-labelling');
  });

  it('keeps the do-not-reply instruction', () => {
    const html = T.getInvitationTemplate(PARTY, WHITE_LABEL_EVENT, LINKS, 'en');
    assert.ok(
      /automated message/i.test(html),
      'that line is operational instruction to the reader, not our branding — a guest '
      + 'replying into an unmonitored mailbox is a support failure whoever is named on it',
    );
  });
});

describe('an ordinary event email', () => {
  it('still carries the full branding', () => {
    // The other half of the guarantee: it would be very easy to "fix" the tests
    // above by stripping the branding from everyone.
    const html = T.getInvitationTemplate(PARTY, BASE_EVENT, LINKS, 'en');

    assert.ok(/logo-email\.png/.test(html), 'the logo lockup is gone from NON white-label mail');
    assert.ok(/Sent via Fancy RSVP/i.test(html), 'the "sent via" line is gone from NON white-label mail');
  });

  it('treats a missing column as not white-labelled', () => {
    // A deployment that has not applied 20260830000003 yet reads undefined here.
    // The mark must stay on until the entitlement is certain.
    const { tier_white_label: _omitted, ...noColumn } = WHITE_LABEL_EVENT;
    const html = T.getInvitationTemplate(PARTY, noColumn, LINKS, 'en');

    assert.ok(/logo-email\.png/.test(html), 'an unknown entitlement must not strip branding');
  });
});

describe('organizer and account email', () => {
  it('is never white-labelled, even for a white-label customer', () => {
    // These are from us to our own customer. An unbranded security email is how
    // a password reset gets read as phishing.
    const verify = T.getEmailVerificationTemplate('Evan', '123456');
    const reset = T.getPasswordResetTemplate('Evan', '123456');

    for (const html of [verify, reset]) {
      assert.ok(/logo-email\.png/.test(html), 'account mail must keep our identity');
    }
  });
});
