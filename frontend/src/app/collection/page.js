import React from 'react';
import Link from 'next/link';
import Navbar from '../components/landing/Navbar';
import FooterSection from '../components/landing/FooterSection';
import CollectionGallery from './CollectionGallery';
import { COLLECTION } from './collectionCatalogue';
import { safeJsonLdHtml } from '../utils/jsonLdSafe.mjs';
import { COMPANY_SITE } from '../utils/company';
import { C, T } from '../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   /collection — THE GALLERY.

   ── WHY THIS ROUTE IS /collection AND NOT /templates ─────────────────────

   There WAS a /templates page. It was retired, and next.config.mjs still
   carries `{ source: '/templates', destination: '/', permanent: true }` — a
   308. A page rebuilt at that path would never be reached: the redirect runs
   before routing, so every visit would bounce to the homepage and the only
   symptom would be a gallery nobody could open. The 308 stays (it is the
   correct signal for a page that is gone, and other sites still link it);
   this is a different page at a different address.

   ── WHAT THIS PAGE IS FOR ────────────────────────────────────────────────

   The four invitations are the most differentiated thing this product has,
   and until now there was nowhere to see them. The homepage showed them in a
   band and its own call to action pointed at /register with a comment saying
   the gallery did not exist. This is the gallery — and, one tap further in,
   the only place on the marketing site where a stranger can OPEN one.

   The pictures do the arguing. No specs, no price and no feature list on this
   page: somebody browsing invitations is choosing on how it looks and what
   the guest does with it, and everything else is on the template's own page.

   ── A SERVER COMPONENT AROUND A CLIENT ONE ───────────────────────────────

   Only the occasion chip is state, so only CollectionGallery is 'use client'.
   The heading, the closing strip, the metadata and the structured data are
   rendered here and ship no JavaScript. All four plates are in the server
   HTML — the chip re-orders and hides what is already there rather than
   fetching anything.
   ═══════════════════════════════════════════════════════════════════════════ */

const TITLE = 'The Collection — invitations your guests open | Fancy RSVP';
const DESCRIPTION =
  'Four cinematic invitations, each one filmed rather than drawn. Open any of them '
  + 'live, exactly as your guests would — break the seal, read it, and reply.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: 'The Collection — invitations made to be opened',
    description: DESCRIPTION,
    url: `${COMPANY_SITE}/collection`,
    siteName: 'Fancy RSVP',
    type: 'website',
    images: [{ url: `${COMPANY_SITE}/og-image.png`, width: 1200, height: 630, alt: 'The Fancy RSVP collection' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Collection — invitations made to be opened',
    description: DESCRIPTION,
    images: [`${COMPANY_SITE}/og-image.png`],
  },
  alternates: { canonical: `${COMPANY_SITE}/collection` },
};

/* An ItemList, built from the SAME array the gallery renders rather than
   typed out again. A hand-written copy of four names beside a rendered list
   of four names is two sources of truth for one catalogue, and structured
   data that disagrees with the visible page is the kind Google penalises
   rather than ignores — the same rule the homepage's FAQ schema follows. */
const collectionLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'The Fancy RSVP Collection',
  description: DESCRIPTION,
  url: `${COMPANY_SITE}/collection`,
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: COLLECTION.length,
    itemListElement: COLLECTION.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${COMPANY_SITE}/collection/${item.key}`,
      name: item.label,
    })),
  },
};

export default function CollectionPage() {
  return (
    <div style={{ minHeight: '100dvh', background: C.paper }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdHtml(collectionLd) }}
      />

      {/* Navbar renders its own 78px spacer, so <main> needs no top offset of
          its own. /features adds one anyway and sits 78px lower than every
          other page as a result. */}
      <Navbar />

      <main>
        <section className="colp">
          {/* --wide (1480), not --lg and not --5xl. .fx-container--lg is
              720px, a READING measure, and this is a gallery of photographs;
              --5xl (1280) is what the homepage bands use, and at that width
              the four plates land on three tracks with one orphaned below.
              See the arithmetic on the grid in CollectionGallery.
              The heading keeps its own reading measure via .colp-head. */}
          <div className="fx-container fx-container--wide fx-gutter">
            <header className="colp-head">
              <span className="colp-kicker">
                The collection
                <span aria-hidden="true" className="colp-kicker__rule" />
              </span>
              <h1 className="colp-title">Choose the way your guests will arrive.</h1>
              <p className="colp-sub">
                Every one of these is photographed, not drawn — and every one is
                yours to fill in, in English, Arabic, or both. Open any of them
                and you will see exactly what a guest sees.
              </p>
            </header>

            <CollectionGallery />

            {/* ── THE FIFTH TEMPLATE, NAMED RATHER THAN PLATED ──
                Custom Canvas has no photography by definition — it IS the
                organizer's own colours and type. A plate for it would be
                blank or would be a picture of something it is not, so it gets
                a sentence instead of a lie. */}
            <aside className="colp-blank">
              <span aria-hidden="true" className="colp-blank__frame" />
              <div className="colp-blank__copy">
                <h2 className="colp-blank__title">Or start from nothing at all.</h2>
                <p className="colp-blank__body">
                  Custom Canvas is a clean slate — your colours, your typography,
                  your cover image, built section by section from the same feature
                  set every invitation here shares.
                </p>
              </div>
              <Link href="/register" className="colp-blank__btn">Build your own</Link>
            </aside>
          </div>
        </section>
      </main>

      <FooterSection />

      {/* A plain <style> element. styled-jsx cannot be imported from a Server
          Component at all, and a scoped rule would never attach to the
          next/link above — styled-jsx stamps its hash class only onto
          lowercase intrinsic elements. Classes are prefixed "colp-".

          No backticks inside these CSS comments: one would terminate this
          template literal and produce a parse error rather than a style bug. */}
      <style>{`
        .colp {
          width: 100%;
          background: ${C.paper};
          padding: 54px 0 76px;
        }
        .colp-head { max-width: 640px; }
        .colp-kicker {
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
        .colp-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .colp-title {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 38px;
          line-height: 1.06;
          letter-spacing: -0.02em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .colp-sub {
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 16px 0 0;
          max-width: 54ch;
        }

        /* ── the blank canvas strip ──
           The engraved-plate vocabulary the homepage's commission strip and
           the shop's category tiles both use: paper, a double gold rule set
           in from the edge, display serif over the body sans. It reads as a
           card of the house rather than a banner bolted on the end. */
        .colp-blank {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 22px;
          margin-top: 64px;
          padding: 30px 24px;
          background: linear-gradient(158deg, ${C.paper2} 0%, #F6EFE2 100%);
          border: 1px solid #DED4C1;
        }
        .colp-blank__frame {
          position: absolute;
          inset: 7px;
          border: 1px solid rgba(169, 138, 78, 0.30);
          pointer-events: none;
        }
        .colp-blank__copy { position: relative; min-width: 0; }
        .colp-blank__title {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 25px;
          line-height: 1.16;
          letter-spacing: -0.012em;
          color: ${C.ink};
          margin: 0;
        }
        .colp-blank__body {
          font-size: 14px;
          font-weight: 300;
          line-height: 1.8;
          color: ${C.inkSoft};
          margin: 10px 0 0;
          max-width: 56ch;
        }
        .colp-blank__btn {
          position: relative;
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 52px;
          padding: 0 30px;
          background: ${C.ink};
          color: ${C.paper};
          border: 1px solid ${C.ink};
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .colp-blank__btn:hover { background: transparent; color: ${C.ink}; }

        @media (min-width: 768px) {
          .colp { padding: 76px 0 110px; }
          .colp-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .colp-kicker__rule { width: 44px; }
          .colp-title { font-size: 62px; margin-top: 22px; }
          .colp-sub { font-size: 17px; margin-top: 18px; }
          .colp-blank {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            gap: 44px;
            margin-top: 84px;
            padding: 34px 38px;
          }
          .colp-blank__title { font-size: 29px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .colp-blank__btn { transition: none; }
        }
      `}</style>
    </div>
  );
}
