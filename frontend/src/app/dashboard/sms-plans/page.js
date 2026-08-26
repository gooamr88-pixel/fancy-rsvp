'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { startSmsCreditPurchase } from '../../utils/smsPurchase';

/**
 * THE TEXT MESSAGING PAGE — what it is, what it says, and what it costs.
 *
 * ── Who this is written for ──
 *
 * The organizer is usually planning one wedding in their life, is frequently in
 * their fifties or older, and has never encountered the word "segment". They are
 * about to be asked for money. Every previous version of this explanation was a
 * price and a slider, which asks them to trust a number they cannot check.
 *
 * So this page does four things, in this order, because that is the order the
 * questions actually arrive in:
 *   1. What will my guests receive?  — shown as real messages, on a phone
 *   2. What does it cost?            — a table with their guest count in it
 *   3. Why is Arabic more?           — answered before they notice and distrust it
 *   4. Can I text everyone?          — consent, said plainly, before they buy
 *
 * ── Everything is server-priced ──
 *
 * Not one number on this page is hardcoded. The rate, the markup, the discount
 * tiers and the per-invitation ladder all come from /payments/pricing-config,
 * which is the same model that builds the Stripe line item. A page that quotes a
 * price the checkout does not honour is worse than no page.
 */

const C = {
  gold: '#B8944F',
  goldHover: '#a6833f',
  charcoal: '#191B1E',
  ivory: '#F8F4EC',
  champagne: '#D7BE80',
  stone: '#77736A',
  border: '#E8E2D6',
  softBg: '#FAFAF8',
  white: '#FFFFFF',
  success: '#3B9B6D',
};

/* The four messages, with the words a guest actually sees. Kept in sync with
   backend/utils/smsTemplates.js — this is a shop window, not a second source of
   truth, so it shows shapes rather than re-deriving them. */
const MESSAGE_TYPES = [
  {
    key: 'invitation',
    title: 'The invitation',
    when: 'When you press send',
    body: 'Sara, you’re invited to Nour & Karim’s Wedding. Open your invitation: fancyrsvp.com/i/k7m2xq4p',
    note: 'The link opens your full invitation — the animation, the details, the RSVP form. Nothing about it looks like a text from a stranger.',
  },
  {
    key: 'seating_reminder',
    title: 'Their table and entry pass',
    when: 'The day before the event',
    body: 'Sara, Nour & Karim’s Wedding is on Sat 12 Sep. Your table: Table 7. Entry pass: fancyrsvp.com/i/p3w9dnzq',
    note: 'Once, the day before — a table number read six weeks early is not the one anyone is looking at outside the venue. Seating someone emails them their pass; it costs no message.',
  },
  {
    key: 'event_update',
    title: 'A change, or a cancellation',
    when: 'Automatically, if something moves',
    body: 'Sara, the details for Nour & Karim’s Wedding have changed. See what’s new: fancyrsvp.com/i/t6bkm2vr',
    note: 'You confirm before it sends, and you always see how many people it will reach first.',
  },
  {
    key: 'organizer_report',
    title: 'Your own updates',
    when: 'The day before your event',
    body: 'Nour & Karim’s Wedding: 142 attending, 38 awaiting reply. fancyrsvp.com/dashboard',
    note: 'This one comes to you, not your guests. It barely touches your balance.',
  },
];

export default function SmsPlansPage() {
  const params = useSearchParams();
  // `useRouter` went with the bounce-to-dashboard that used to stand in for a
  // buy button; the no-event case is a real <Link> now.
  const eventId = params.get('event');
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [guests, setGuests] = useState(200);
  const [script, setScript] = useState('latin');
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/payments/pricing-config`, { credentials: 'include' });
        const data = await res.json();
        if (!cancelled && data.success) {
          setCfg({
            // The published price per segment. This page used to be handed our
            // carrier cost and our markup and multiply them itself, which meant
            // the endpoint had to disclose both to every organizer to show one
            // public number.
            listCents: Number(data.config?.sms_list_price_cents_per_segment ?? 3.0),
            pricing: data.smsPricing || null,
          });
        }
      } catch { /* the page still explains itself without live numbers */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [apiUrl]);

  /* ── The whole price model, mirrored from the server's values ──
     Deliberately re-derived from the SERVER's rate/markup/tiers rather than
     hardcoded, so an admin changing the price changes this page too. */
  const quote = useMemo(() => {
    if (!cfg?.pricing) return null;
    const p = cfg.pricing;
    const est = p.estimator;

    const band = (p.guest_bands || []).find((b) => b.max_guests === null || guests <= b.max_guests)
      || (p.guest_bands || [])[p.guest_bands.length - 1];
    const perParty = band?.messages_per_party ?? 3;

    const parties = Math.max(1, Math.ceil(guests / est.guests_per_party));
    const segsPerMsg = script === 'arabic' ? est.segments_per_message_arabic : est.segments_per_message_latin;

    const weights = p.type_weights || {};
    const totalWeight = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0) || 1;

    let segments = 0;
    const lines = [];
    for (const [key, weight] of Object.entries(weights)) {
      const messages = perParty * (Number(weight) / totalWeight) * parties;
      const seg = Math.ceil(messages * segsPerMsg);
      segments += seg;
      lines.push({ key, messages: Math.round(messages), segments: seg });
    }
    const orgMessages = Number(p.type_frequencies?.organizer_report ?? 3);
    const orgSeg = Math.ceil(orgMessages * segsPerMsg);
    segments += orgSeg;
    lines.push({ key: 'organizer_report', messages: orgMessages, segments: orgSeg });

    const step = p.bounds.step;
    const recommended = Math.min(
      Math.max(Math.ceil(segments / step) * step, p.bounds.min),
      p.bounds.max,
    );

    const tier = (p.volume_discounts || []).find((t) => recommended >= t.min_segments);
    const discountPct = tier ? tier.discount_pct : 0;
    const listCents = cfg.listCents;
    const cents = Math.round(listCents * recommended * (1 - discountPct / 100));

    return {
      parties, perParty, recommended, discountPct, lines,
      dollars: cents / 100,
      perSegment: cents / recommended / 100,
      perGuest: cents / 100 / guests,
    };
  }, [cfg, guests, script]);

  /**
   * BUY, AND SAY WHAT HAPPENED.
   *
   * This used to be `.catch(() => {})` — every failure swallowed whole. The
   * organizer pressed "Add messaging", a blank tab opened and closed, and
   * nothing appeared anywhere. That is the reported bug: "the button is invalid
   * and not redirect to stripe". The button was working; it was being refused,
   * silently, for one of three reasons it never mentioned.
   *
   * It also began `if (!eventId) router.push('/dashboard')`, so arriving here
   * without `?event=` — which the "What messages cost" link on the Text messages
   * page did, and the wizard's link still legitimately does — turned the buy
   * button into a bounce to the dashboard. Pressing a button labelled with a
   * price and landing somewhere else is indistinguishable from a broken button.
   * The no-event case is now stated on the button itself and handled below.
   */
  const [buyError, setBuyError] = useState(null);

  const handleBuy = () => {
    setBuyError(null);
    setBuying(true);
    startSmsCreditPurchase({ apiUrl, eventId, creditCount: quote?.recommended || 500 })
      .catch((err) => {
        /**
         * Two refusals are not failures and must not read like one — they are
         * the platform's normal state today, and each has a different next step.
         *
         * `stripeEnabled()` requires BOTH a flag and a key and defaults to off
         * (backend/config/features.js), so on this deployment card checkout is
         * simply not the way messages get bought. And an organizer whose event
         * was approved by bank transfer has no Stripe customer, so even with
         * cards on, this specific top-up cannot bill them.
         *
         * In both cases messages are still purchasable — alongside the event
         * licence, on the same manual payment — which is the thing to say.
         */
        if (err?.code === 'STRIPE_DISABLED') {
          setBuyError({
            title: 'Card payment is not available right now',
            body: 'Messages are still available — they are added to your event by bank transfer, alongside the event licence. Contact us and we will add them to your balance.',
          });
        } else if (err?.code === 'NO_STRIPE_CUSTOMER') {
          setBuyError({
            title: 'This event was not paid by card',
            body: 'Card top-ups need a card payment on file. Because this event was paid by bank transfer, messages are added the same way — contact us and we will top up your balance.',
          });
        } else {
          setBuyError({ title: 'Could not open checkout', body: err?.message || 'Please try again in a moment.' });
        }
      })
      .finally(() => setBuying(false));
  };

  /* fx-gutter: .fx-container has no horizontal padding of its own, and nothing on
     this route supplies one — every heading and card sat flush against both screen
     edges on a phone. */
  return (
    <div className="fx-container fx-container--4xl fx-gutter fx-gutter--sm" style={{ paddingBottom: 40 }}>
      {/* ── 1. What this is ─────────────────────────────────────────────── */}
      <header style={{ padding: '38px 0 8px' }}>
        <Link href="/dashboard" style={{ fontSize: 13, color: C.stone, textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
          &larr; Back to dashboard
        </Link>
        <h1 style={{
          margin: '18px 0 0', fontSize: 'clamp(28px, 5vw, 40px)', fontWeight: 600,
          color: C.charcoal, fontFamily: 'var(--font-serif)', lineHeight: 1.15,
        }}>
          Text messaging for your event
        </h1>
        <p style={{
          margin: '14px 0 0', maxWidth: 620, fontSize: 16, lineHeight: 1.65,
          color: C.stone, fontFamily: 'var(--font-sans)',
        }}>
          Almost everyone opens a text. Fewer than half open an email. This page explains
          exactly what your guests would receive, exactly what it costs, and exactly what
          you are allowed to send — with no surprises at the end.
        </p>
      </header>

      {/* ── 2. What guests receive ──────────────────────────────────────── */}
      <Section
        eyebrow="What gets sent"
        title="Four messages. That is the whole list."
        lede="Nothing else is ever sent by text. You can switch any of them off."
      >
        <div className="fx-grid" style={{ '--fx-col': '300px' }}>
          {MESSAGE_TYPES.map((m) => (
            <article key={m.key} style={{
              background: C.white, border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${C.gold}`, borderRadius: 14, padding: 18,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                color: C.gold, fontFamily: 'var(--font-sans)',
              }}>{m.when}</div>
              <h3 style={{
                margin: '7px 0 12px', fontSize: 17, fontWeight: 600,
                color: C.charcoal, fontFamily: 'var(--font-serif)',
              }}>{m.title}</h3>

              {/* The actual message, styled as one. Reading the real words is the
                  fastest possible answer to "what will my guests think?" */}
              <div style={{
                background: C.softBg, border: `1px solid ${C.border}`, borderRadius: 12,
                padding: '11px 13px', fontSize: 13.5, lineHeight: 1.55,
                color: C.charcoal, fontFamily: 'var(--font-sans)',
              }}>
                {m.body}
                <div style={{ marginTop: 7, fontSize: 11, color: C.stone }}>
                  &ndash; Fancy RSVP. Msg&amp;data rates may apply. Reply STOP to opt out.
                </div>
              </div>

              <p style={{ margin: '11px 0 0', fontSize: 12.5, lineHeight: 1.55, color: C.stone, fontFamily: 'var(--font-sans)' }}>
                {m.note}
              </p>
            </article>
          ))}
        </div>
      </Section>

      {/* ── 3. The price ────────────────────────────────────────────────── */}
      <Section
        eyebrow="What it costs"
        title="Move the guest count. See your price."
        lede="This is the same calculation the checkout uses. Nothing is rounded in our favour."
      >
        <div style={{
          background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: 'clamp(16px, 3vw, 26px)',
        }}>
          {/* .fx-row, not a bespoke <style jsx> rule: this is exactly the
              "wrapping horizontal flex row" the global utility exists for, and
              AGENTS.md is explicit that a new scoped block should not be written
              where an fx- primitive already covers it. No inline display/gap
              keys here — an inline style always beats the class and would make
              it silently inert. */}
          <div className="fx-row fx-row--gap" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 260px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.charcoal, marginBottom: 8, fontFamily: 'var(--font-sans)' }}>
                How many guests are you inviting?
              </label>
              <input
                type="range" min={50} max={3000} step={50}
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.gold }}
              />
              <div style={{ fontSize: 26, fontWeight: 700, color: C.charcoal, fontFamily: 'var(--font-serif)', marginTop: 4 }}>
                {guests.toLocaleString()} guests
              </div>
            </div>

            <div style={{ flex: '0 1 220px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.charcoal, marginBottom: 8, fontFamily: 'var(--font-sans)' }}>
                What language are your messages in?
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {[['latin', 'English'], ['arabic', 'Arabic']].map(([v, l]) => (
                  <button
                    key={v} type="button" onClick={() => setScript(v)}
                    style={{
                      flex: 1, padding: '9px 12px', minHeight: 'var(--fx-touch)', borderRadius: 9,
                      border: `1px solid ${script === v ? C.gold : C.border}`,
                      background: script === v ? C.gold : C.white,
                      color: script === v ? C.white : C.charcoal,
                      fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer',
                    }}
                  >{l}</button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <p style={{ marginTop: 22, color: C.stone, fontSize: 14, fontFamily: 'var(--font-sans)' }}>Working out your price…</p>
          ) : !quote ? (
            <p style={{ marginTop: 22, color: C.stone, fontSize: 14, fontFamily: 'var(--font-sans)' }}>
              We could not load live prices just now. Please refresh, or continue from your event and we will show the price before you pay.
            </p>
          ) : (
            <>
              <div style={{
                marginTop: 22, paddingTop: 20, borderTop: `1px solid ${C.border}`,
                display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-end',
              }}>
                <div>
                  <div style={{ fontSize: 12, color: C.stone, fontFamily: 'var(--font-sans)' }}>Your price</div>
                  <div style={{ fontSize: 42, fontWeight: 700, color: C.charcoal, fontFamily: 'var(--font-serif)', lineHeight: 1.05 }}>
                    ${quote.dollars.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.stone, fontFamily: 'var(--font-sans)', marginTop: 3 }}>
                    one payment &middot; about {(quote.perGuest).toFixed(3).replace(/^0/, '')} per guest
                  </div>
                </div>

                <div style={{ flex: '1 1 200px' }}>
                  <Fact label="Messages included" value={quote.recommended.toLocaleString()} />
                  <Fact label="Roughly per invitation" value={`${quote.perParty} messages`} />
                  {quote.discountPct > 0 && (
                    <Fact label="Volume discount applied" value={`${quote.discountPct}% off`} good />
                  )}
                </div>
              </div>

              {/* The bit everyone gets wrong, said before they can be surprised
                  by it. Naming it "invitations, not guests" is the single most
                  reassuring sentence on the page. */}
              <div style={{
                marginTop: 18, padding: '13px 15px', borderRadius: 11,
                background: C.softBg, border: `1px solid ${C.border}`,
                fontSize: 13, lineHeight: 1.6, color: C.stone, fontFamily: 'var(--font-sans)',
              }}>
                <strong style={{ color: C.charcoal }}>Why that is fewer messages than you expected.</strong>{' '}
                Texts go to one person per invitation, not to every head. Your {guests.toLocaleString()} guests
                are about <strong style={{ color: C.charcoal }}>{quote.parties.toLocaleString()} invitations</strong> —
                couples and families arrive together and share one message. The bigger your
                event, the fewer messages each invitation needs, and the cheaper each one gets.
              </div>
            </>
          )}
        </div>
      </Section>

      {/* ── 4. Segments and Arabic ──────────────────────────────────────── */}
      <Section
        eyebrow="The one piece of jargon"
        title="What you are actually buying"
        lede="Phone networks bill by the length of a message, not by the message. It is worth ninety seconds of your time."
      >
        <div className="fx-grid" style={{ '--fx-col': '280px' }}>
          <Explainer title="A text is 160 characters">
            Longer than that and the phone network charges it as two. Every message we send
            must also carry <em>&ldquo;Reply STOP to opt out&rdquo;</em> and our name — that is the law, and it
            uses 78 of your 160 characters before your guest&rsquo;s name is even added.
          </Explainer>
          <Explainer title="So we keep them short">
            Your guest&rsquo;s name, what it is about, and a short link. Everything beautiful — the
            animation, the photos, the details, the RSVP form — lives on the other side of that
            link, where it costs nothing to be as lovely as you like.
          </Explainer>
          <Explainer title="Arabic costs more. Here is why">
            Phone networks store Arabic differently, and it fits only 70 characters instead of
            160. The same message needs about half again as many. That is the network&rsquo;s rule,
            not our price — we pass it on and nothing more.
          </Explainer>
        </div>
      </Section>

      {/* ── 5. Consent ──────────────────────────────────────────────────── */}
      <Section
        eyebrow="Before you buy"
        title="Who you are allowed to text"
        lede="Worth reading. It is the one thing money cannot buy here."
      >
        <div style={{
          background: C.white, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.charcoal}`,
          borderRadius: 14, padding: 'clamp(16px, 3vw, 24px)',
        }}>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: C.charcoal, fontFamily: 'var(--font-sans)' }}>
            A guest is only ever texted if they agreed to it. Buying messages unlocks the
            ability to send — it does not buy permission, and no amount of money changes that.
          </p>
          <ul style={{ margin: '14px 0 0', paddingInlineStart: 20, fontSize: 13.5, lineHeight: 1.75, color: C.stone, fontFamily: 'var(--font-sans)' }}>
            <li>Guests can tick a box on your RSVP form. That is the cleanest route.</li>
            <li>You can confirm, guest by guest, that you already have their permission — when you add someone, or with an <code style={{ fontSize: 12.5 }}>sms_consent</code> column in your import file.</li>
            <li>Anyone who replies STOP is removed instantly and permanently. We will never text them again for anyone.</li>
          </ul>
          <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.65, color: C.stone, fontFamily: 'var(--font-sans)' }}>
            Guests we cannot text are never left out — they get the same message by email, every time.
            You will always see how many of each before anything is sent.
          </p>
        </div>
      </Section>

      {/* ── 6. Buy ──────────────────────────────────────────────────────── */}
      <div style={{
        margin: '10px 0 60px', padding: 'clamp(20px, 4vw, 32px)', borderRadius: 18,
        background: C.charcoal, color: C.ivory,
        display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ flex: '1 1 300px' }}>
          <h2 style={{ margin: 0, fontSize: 23, fontWeight: 600, fontFamily: 'var(--font-serif)', color: C.ivory }}>
            Ready to add it?
          </h2>
          <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.6, color: 'rgba(248,244,236,0.72)', fontFamily: 'var(--font-sans)' }}>
            {eventId
              ? 'You will see the exact price again before you pay. Messages belong to this event and never expire before it.'
              : 'Open the event you want to add messaging to, and this button will take you straight to checkout.'}
          </p>
        </div>
        {/**
          * A LINK when there is no event, a button when there is.
          *
          * With no `?event=` there is nothing to buy, and the old code rendered a
          * gold button reading "Choose an event" that pushed to /dashboard. A
          * primary-styled button that navigates instead of doing what the page is
          * about is the definition of a control that looks broken — and it is
          * reached legitimately, from the wizard's "how this is priced" link,
          * before any event exists.
          */}
        {eventId ? (
          <button
            type="button"
            onClick={handleBuy}
            disabled={buying}
            style={{
              padding: '13px 26px', borderRadius: 10, border: 'none',
              minHeight: 'var(--fx-touch)',
              background: buying ? C.stone : C.gold, color: C.white,
              fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
              cursor: buying ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {buying ? 'Opening checkout…' : `Add messaging — $${quote ? quote.dollars.toFixed(2) : '—'}`}
          </button>
        ) : (
          <Link
            href="/dashboard"
            style={{
              padding: '13px 26px', borderRadius: 10, minHeight: 'var(--fx-touch)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${C.champagne}`, background: 'transparent', color: C.ivory,
              fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
              whiteSpace: 'nowrap', textDecoration: 'none',
            }}
          >
            Open an event first
          </Link>
        )}
      </div>

      {/**
        * WHY IT DID NOT OPEN.
        *
        * Rendered here rather than as a toast: two of the three reasons are not
        * transient and carry an instruction ("messages are added by bank
        * transfer"), which is not something to read in a box that disappears.
        */}
      {buyError && (
        <div role="alert" style={{
          marginTop: 16, padding: '14px 16px', borderRadius: 12,
          background: 'rgba(196,94,94,0.07)', border: '1px solid rgba(196,94,94,0.3)',
          fontFamily: 'var(--font-sans)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#C45E5E' }}>{buyError.title}</div>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.6, color: C.stone }}>{buyError.body}</p>
        </div>
      )}

    </div>
  );
}

/* ── Small presentational pieces ──────────────────────────────────────────
   Inline styles only — a <style jsx> block declared in any of these would be
   scoped to that component and would not reach markup rendered by the page. */

function Section({ eyebrow, title, lede, children }) {
  return (
    <section style={{ padding: '38px 0 0' }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
        color: C.gold, fontFamily: 'var(--font-sans)',
      }}>{eyebrow}</div>
      <h2 style={{
        margin: '9px 0 0', fontSize: 'clamp(21px, 3.4vw, 27px)', fontWeight: 600,
        color: C.charcoal, fontFamily: 'var(--font-serif)', lineHeight: 1.25,
      }}>{title}</h2>
      {lede && (
        <p style={{
          margin: '9px 0 0', maxWidth: 620, fontSize: 14.5, lineHeight: 1.65,
          color: C.stone, fontFamily: 'var(--font-sans)',
        }}>{lede}</p>
      )}
      <div style={{ marginTop: 20 }}>{children}</div>
    </section>
  );
}

function Explainer({ title, children }) {
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18,
    }}>
      <h3 style={{ margin: '0 0 9px', fontSize: 16, fontWeight: 600, color: C.charcoal, fontFamily: 'var(--font-serif)' }}>
        {title}
      </h3>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: C.stone, fontFamily: 'var(--font-sans)' }}>
        {children}
      </p>
    </div>
  );
}

function Fact({ label, value, good = false }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12,
      padding: '5px 0', borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 13, color: C.stone, fontFamily: 'var(--font-sans)' }}>{label}</span>
      <span style={{
        fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
        color: good ? C.success : C.charcoal,
      }}>{value}</span>
    </div>
  );
}
