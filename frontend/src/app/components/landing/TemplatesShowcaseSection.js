import React from "react";
import Link from "next/link";
import { TEMPLATES } from "../../utils/curatedTemplates";
import { CINEMATIC_KEYS } from "../templates/cinematic/cinematicThemes";
import { occasionPolicyFor } from "../../utils/eventOccasion";
import { buildWhatsappUrl } from "../../utils/shopLinks";
import { C, T, SHADOW, BEZEL } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   THE INVITATIONS.

   The most differentiated thing this product has, and the old homepage showed
   it nowhere at all. Every picture is a real screenshot of the shipping
   template, produced by test/shots — never an artist's impression.

   The occasion badge is read from `occasionPolicyFor`, the same function the
   wizard and the guest page use, so the homepage cannot advertise a template
   for an occasion the product would refuse.

   ── 2026-08-20: three changes ─────────────────────────────────────────────

   1. IT KEPT ITS OWN PALETTE. There was a private `const C = { ivory, gold,
      goldLight }` at the top of this file — the third copy of the brand
      colours in the tree, and the exact drift landingTokens.js exists to
      prevent. It now imports the shared one.

   2. THE BAND IS NO LONGER DARK. Two full-dark bands were competing with the
      photography they existed to show; on paper, the invitations are the only
      saturated thing in view and they carry the whole section.

   3. ALTERNATING ROWS BECAME THREE PLATES. The flip-flop layout read well but
      ran ~2,400px tall for three items. As a three-up grid they read as plates
      in a catalogue, each numbered and closed with a hairline, in about a
      third of the height.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The opened hero shot per template. The cover (sealed) art is used by the
 *  hero band, not here — three sealed envelopes in a row say less than three
 *  opened invitations do. */
const SHOTS = {
  ring: "/images/landing/hero-ring.webp",
  bab: "/images/landing/hero-bab.webp",
  swans: "/images/landing/hero-swans.webp",
  /* The SEALED envelope, not the opened page — the one exception, and a
     deliberate one. The other three open onto photography we supply, so their
     opened page is the thing to show. Sealed Letter opens onto the couple's
     OWN photograph, and there is no honest picture of that: any hero shot
     here would be a stock couple standing in for theirs, which is exactly the
     impression this template exists to avoid giving. So the plate shows what
     we actually ship — the envelope — and says in words what goes behind it,
     with the inset below standing in at a size that cannot be mistaken for a
     promise. */
  letter: "/images/landing/cover-letter.webp",
};

/** Templates whose plate carries the "your own photo goes here" note. */
const OWN_PHOTO = {
  letter: {
    /* Lifted from the template's own former hero artwork — the illustration
       that used to be printed into it, now retired from the product and kept
       only at this size. */
    illustration: "/images/landing/couple-illustration.webp",
    line: "And behind it, your own photograph — full screen, with your names and your words across it.",
  },
};

/** What a guest actually does to open each one — the thing worth showing. */
const ARRIVAL = {
  ring: "They touch the box. It opens on film.",
  bab: "They knock three times. It answers.",
  swans: "They break the seal. The card rises out.",
  /* Short, like the other three. The "your own photograph" claim lives in the
     note below it — saying it here as well made the plate state the same
     thing three times over, in the arrival, the note and the description. */
  letter: "They touch the wax. Both flaps fall open.",
};

/** Lowercase roman, to pair with the section numeral without competing. */
const PLATE_NUMERAL = ["i", "ii", "iii", "iv", "v"];

/* The band's own headline and its commission strip both COUNT the templates,
   and both had the number typed into the sentence — so shipping a fourth
   template left the page saying "three" twice, in the two places a visitor
   reads first. Spelled from the list that is actually being rendered. */
const COUNT_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven"];
const countWord = (n) => COUNT_WORD[n] || String(n);
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function TemplatePlate({ template, index }) {
  const policy = occasionPolicyFor(template.key);
  const shot = SHOTS[template.key];
  const own = OWN_PHOTO[template.key];

  return (
    <li className="tss-plate">
      <div className="tss-device">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shot}
          alt={`The ${template.label} invitation as a guest sees it: ${template.tagline}`}
          width={468}
          height={1013}
          loading="lazy"
        />

      </div>

      <div className="tss-namerow">
        <h3 className="tss-name">{template.label}</h3>
        <span className="tss-numeral" aria-hidden="true">
          {PLATE_NUMERAL[index] || index + 1}
        </span>
      </div>

      <p className="tss-arrival">{ARRIVAL[template.key]}</p>

      {/* An annotated note, sitting in the flow AFTER the name — not an inset
          floated over the artwork. Overlapping the device covered the couple's
          names printed on the envelope, and placing it above the title broke
          the rhythm every other plate keeps (picture, name, arrival,
          description). Beside its own illustration it reads as a margin note
          about what is inside, which is exactly what it is. */}
      {own && (
        <figure className="tss-own">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="tss-own__fig"
            src={own.illustration}
            alt="An illustration of a couple, standing in for the photograph you upload"
            width={285}
            height={338}
            loading="lazy"
          />
          <figcaption className="tss-own__line">{own.line}</figcaption>
        </figure>
      )}

      <p className="tss-desc">{template.desc}</p>
      <span className="tss-badge">{policy.label}</span>
    </li>
  );
}

/* THE STUDIO'S NUMBER, FROM THE ONE PLACE THAT OWNS IT.

   Same endpoint and same revalidate as PrintedInvitationsSection, so Next
   dedupes the two into ONE request per render rather than fetching the
   catalogue twice for one page. The number lives in
   super_admin_config.shop_settings and is served through the public
   allowlist — there is no second place to put a WhatsApp number, and adding
   one is how a business ends up answering two. */
const API_URL = process.env.INTERNAL_API_URL
  || process.env.NEXT_PUBLIC_API_URL
  || 'http://localhost:5000/api/v1';

async function fetchShopSettings() {
  try {
    const res = await fetch(`${API_URL}/public/shop`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.settings || null;
  } catch {
    // The band must render with or without it — the three invitations are the
    // point, and the commission strip simply does not appear.
    return null;
  }
}

/** Pre-typed so whoever answers is not starting from "hi". */
const COMMISSION_MESSAGE = 'Hello! I would like to talk about a custom invitation design for my event.';

export default async function TemplatesShowcaseSection() {
  // The cinematic ones only. Custom Canvas has no photography by definition —
  // it is the organizer's own colours — so it has nothing to show here.
  const shown = TEMPLATES.filter((t) => CINEMATIC_KEYS.includes(t.key));

  /* Gated on a real NUMBER, not on whether the shop is switched on: the shop
     switch is about selling printed goods, and commissioning an invitation is
     a different conversation on the same phone. No number, no strip — a CTA
     that opens "wa.me/" and nothing else is worse than no CTA. */
  const settings = await fetchShopSettings();
  const commissionHref = buildWhatsappUrl({ settings, message: COMMISSION_MESSAGE });

  return (
    <section id="invitations" className="tss" aria-labelledby="tss-title">
      {/* --5xl, not --lg. .fx-container--lg is 720px, a READING measure, and
          this is a three-column gallery of photographs. */}
      <div className="fx-container fx-container--5xl fx-gutter">
        <header className="tss-head">
          <span className="tss-kicker">
            The invitations
            <span aria-hidden="true" className="tss-kicker__rule" />
          </span>
          <span className="tss-secnum" aria-hidden="true">I</span>
          <h2 id="tss-title" className="tss-title">{titleCase(countWord(shown.length))} ways to open a door.</h2>
          <p className="tss-sub">
            {/* "Filmed, not animated" was true of three and is not true of the
                fourth — Sealed Letter is a sprite sheet, which is why it opens
                instantly on a handset that cannot stream video. The claim that
                covers all four is that they are photographed rather than
                drawn, which is the one a visitor actually cares about. */}
            Each one is photographed, not drawn — and every one of them is yours
            to fill in, in any language, for any occasion.
          </p>
        </header>

        {/* .fx-grid walks 3 → 2 → 1 from --fx-col with no breakpoints of its
            own. A fixed three-column grid could not fit a phone — see
            AGENTS.md on min-content width. */}
        {/* 250px, not 290. .fx-grid is auto-fit, so the track count is
            floor((container + gap) / (--fx-col + gap)) — at 290px a 1184px
            container fits exactly THREE, which was right for three templates
            and leaves the fourth stranded alone on a second row. 250 fits
            four (4 x 250 + 3 x 44 = 1132 <= 1184) and still falls to two on a
            tablet and one on a phone with no breakpoint of its own. The
            plate's own max-width keeps the picture the size it was. */}
        <ul className="tss-plates fx-grid" style={{ "--fx-col": "250px", "--fx-gap": "clamp(44px, 3vw, 40px)" }}>
          {shown.map((t, i) => (
            <TemplatePlate key={t.key} template={t} index={i} />
          ))}
        </ul>

        {/* ── THE COMMISSION ──
            Three invitations on a page read as a menu, and a visitor whose
            event is not on that menu concludes the product cannot do it. It
            can: the studio designs one. This says so where the assumption is
            formed, rather than in a FAQ four bands down. */}
        {commissionHref && (
          <aside className="tss-comm" aria-labelledby="tss-comm-title">
            <span className="tss-comm__frame" aria-hidden="true" />
            <div className="tss-comm__copy">
              <span className="tss-comm__kicker">
                Commissions
                <span aria-hidden="true" className="tss-comm__rule" />
              </span>
              <h3 id="tss-comm-title" className="tss-comm__title">
                These {countWord(shown.length)} are where we start, not where we stop.
              </h3>
              <p className="tss-comm__body">
                If what you are imagining is not here — your own artwork, another
                language, a ritual that belongs to your family — the studio designs
                it with you and builds it into the platform as your own.
              </p>
            </div>

            <div className="tss-comm__act">
              {/* rel="noopener": a target=_blank link hands the opened page a
                  window.opener reference to this one without it. */}
              <a
                className="tss-comm__btn"
                href={commissionHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* BOTH paths. The outer bubble alone is a generic speech
                    bubble, not the WhatsApp mark — the handset inside it is
                    what makes it recognisable at 16px. Same two paths as the
                    shop's WhatsappGlyph, copied rather than imported: that
                    lives in shop/piStyles.js, a 'use client' module whose
                    other exports are a whole stylesheet the landing page has
                    no business pulling in. */}
                <svg className="tss-comm__wa" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23a8.24 8.24 0 0 1 0 16.46z" />
                </svg>
                Design my VIP invitation
              </a>
              <span className="tss-comm__note">Opens a WhatsApp chat with the studio</span>
            </div>
          </aside>
        )}

        <div className="tss-cta">
          {/* /templates does not exist. The place a visitor actually sees and
              picks these is step one of the wizard. */}
          <Link href="/register" className="tss-btn tss-btn--ghost">See them in your own event</Link>
        </div>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          above. Classes are prefixed "tss-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .tss {
          width: 100%;
          background: ${C.paper2};
          padding: 60px 0;
        }
        .tss-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 20px;
        }
        .tss-kicker {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-family: ${T.label};
          font-size: 10px;
          letter-spacing: 0.30em;
          text-transform: uppercase;
          color: ${C.goldInk};
          white-space: nowrap;
        }
        .tss-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .tss-secnum {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
        }
        .tss-title {
          grid-column: 1 / -1;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .tss-sub {
          grid-column: 1 / -1;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 52ch;
        }

        .tss-plates {
          margin: 40px 0 0;
          padding: 0;
          list-style: none;
        }
        /* CAPPED, and this is the whole point of the 2026-08-21 pass.
           .fx-grid is auto-fit, so three items in a 1184px container stretch
           to ~372px tracks whatever --fx-col says — and the shot is a whole
           phone screen at 468x1013, so each plate rendered about 365 wide and
           790 TALL. Three of those is most of a desktop screen for one band,
           and on a phone it was ~2,400px of scrolling past three enormous
           handsets.
           The cap sits on the PLATE, not on the image, so the name, the rule
           under it and the description all narrow with the picture instead of
           running out past it. The tracks stay where they are, so plate one
           still lines up with the heading above. */
        /* Centred while there is ONE per row, left-aligned once there are
           three. A capped plate in a full-width phone track sits against the
           left edge with 86px of nothing beside it, which reads as a layout
           fault; three capped plates across a desktop row do not, because the
           first still lines up with the heading. */
        .tss-plate { min-width: 0; max-width: 244px; margin-inline: auto; }

        /* The invitation as an object: a dark bezel, a long shadow, and a faint
           edge so it does not read as a pasted rectangle. */
        .tss-device {
          border-radius: 22px;
          padding: 5px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
        }
        .tss-device img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 17px;
        }

        /* ── "and behind it, your own photograph" ──
           A margin note: the stand-in illustration beside the sentence it
           illustrates. Small on purpose — it is standing in for something we
           do not have, and at 54px it can never be mistaken for a picture the
           template ships. In the FLOW, not floated over the device: as an
           overlay it covered the couple's names printed on the envelope. */
        .tss-own {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin: 12px 0 0;
          padding: 10px 12px;
          background: ${C.paper};
          border: 1px solid #DED4C1;
        }
        /* 64px, not 54. At 54 the two figures had merged into one grey shape
           and the note illustrated nothing; at 64 the dress and the suit read
           as a couple, which is the entire job. Still far too small to be
           taken for a picture the template ships. */
        .tss-own__fig {
          flex: none;
          width: 64px;
          height: auto;
          display: block;
          border: 1px solid #E6DCCB;
        }
        .tss-own__line {
          margin: 0;
          min-width: 0;
          font-family: ${T.display};
          font-size: 13.5px;
          font-style: italic;
          line-height: 1.5;
          color: ${C.goldInk};
        }

        .tss-namerow {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 14px;
          margin-top: 22px;
          padding-bottom: 12px;
          border-bottom: 1px solid ${C.border};
        }
        .tss-name {
          font-family: ${T.display};
          font-size: 24px;
          font-weight: 400;
          line-height: 1.12;
          letter-spacing: -0.01em;
          color: ${C.ink};
          margin: 0;
          min-width: 0;
        }
        .tss-numeral {
          flex: none;
          font-family: ${T.display};
          font-style: italic;
          font-size: 14px;
          color: ${C.goldInk};
          opacity: 0.8;
        }
        .tss-arrival {
          font-family: ${T.display};
          font-size: 16.5px;
          font-style: italic;
          line-height: 1.4;
          color: ${C.goldInk};
          margin: 12px 0 0;
        }
        .tss-desc {
          font-size: 13px;
          font-weight: 300;
          line-height: 1.72;
          color: ${C.inkSoft};
          margin: 9px 0 0;
        }
        .tss-badge {
          display: inline-block;
          margin-top: 14px;
          font-size: 9px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.7;
        }

        /* ── the commission strip ──
           The engraved-plate vocabulary the shop's category tiles use: paper,
           a double gold rule set in from the edge, display serif over a
           tracked micro-label. It reads as a card of the house rather than as
           a banner bolted onto the band. */
        .tss-comm {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 22px;
          margin-top: 44px;
          padding: 30px 24px;
          background: linear-gradient(158deg, ${C.paper} 0%, #F6EFE2 100%);
          border: 1px solid #DED4C1;
        }
        .tss-comm__frame {
          position: absolute;
          inset: 7px;
          border: 1px solid rgba(169, 138, 78, 0.30);
          pointer-events: none;
        }
        .tss-comm__frame::after {
          content: "";
          position: absolute;
          inset: 3px;
          border: 1px solid rgba(169, 138, 78, 0.10);
        }
        .tss-comm__copy { position: relative; min-width: 0; }
        .tss-comm__kicker {
          display: inline-flex;
          align-items: center;
          gap: 11px;
          font-family: ${T.label};
          font-size: 9.5px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: ${C.goldInk};
          white-space: nowrap;
        }
        .tss-comm__rule {
          display: block;
          flex: none;
          width: 26px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .tss-comm__title {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 24px;
          line-height: 1.18;
          letter-spacing: -0.012em;
          color: ${C.ink};
          margin: 12px 0 0;
        }
        .tss-comm__body {
          font-size: 14px;
          font-weight: 300;
          line-height: 1.8;
          color: ${C.inkSoft};
          margin: 10px 0 0;
          max-width: 54ch;
        }
        .tss-comm__act {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 9px;
          flex: none;
        }
        .tss-comm__btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 52px;
          padding: 0 26px;
          background: ${C.ink};
          color: ${C.paper};
          border: 1px solid ${C.ink};
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .tss-comm__btn:hover { background: ${C.goldInk}; border-color: ${C.goldInk}; color: ${C.paper}; }
        .tss-comm__wa { width: 16px; height: 16px; flex: none; }
        .tss-comm__note {
          font-size: 10.5px;
          letter-spacing: 0.04em;
          color: ${C.inkSoft};
          opacity: 0.75;
        }

        .tss-cta {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 40px;
        }
        .tss-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 56px;
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          border-radius: 0;
          transition: background 0.35s ease, color 0.35s ease, border-color 0.35s ease;
        }
        .tss-btn--ghost {
          background: ${C.paper};
          color: ${C.ink};
          border: 1px solid ${C.border};
        }
        .tss-btn--ghost:hover { background: ${C.ink}; border-color: ${C.ink}; color: ${C.paper}; }

        @media (min-width: 768px) {
          .tss { padding: 92px 0; }
          .tss-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .tss-kicker__rule { width: 44px; }
          .tss-secnum { font-size: 15px; }
          .tss-title { font-size: 48px; margin-top: 20px; }
          .tss-sub { font-size: 17px; margin-top: 16px; }
          .tss-plates { margin-top: 48px; }
          .tss-plate { max-width: 260px; margin-inline: 0; }
          .tss-device { border-radius: 24px; padding: 6px; }
          .tss-device img { border-radius: 19px; }
          .tss-namerow { margin-top: 22px; padding-bottom: 12px; }
          .tss-name { font-size: 26px; }
          .tss-numeral { font-size: 14px; }
          .tss-arrival { font-size: 17.5px; margin-top: 13px; }
          .tss-desc { font-size: 13.5px; }
          .tss-badge { margin-top: 14px; }
          .tss-cta { flex-direction: row; margin-top: 48px; }
          .tss-btn { min-height: 56px; padding: 0 40px; }

          /* Copy and action side by side, with the action holding its own
             width — a nowrap button in a shrinking track is the second-largest
             source of overflow in this codebase. */
          .tss-comm {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            gap: 44px;
            padding: 34px 38px;
            margin-top: 52px;
          }
          .tss-comm__act { align-items: flex-end; }
          .tss-comm__title { font-size: 27px; }
          .tss-comm__body { font-size: 14.5px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .tss-btn, .tss-comm__btn { transition: none; }
        }
      `}</style>
    </section>
  );
}
