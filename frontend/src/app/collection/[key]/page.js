import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Navbar from '../../components/landing/Navbar';
import FooterSection from '../../components/landing/FooterSection';
import LiveInvitation from './LiveInvitation';
import { COLLECTION, COLLECTION_KEYS, collectionItem } from '../collectionCatalogue';
import { preloadCinematicAssets } from '../../components/templates/cinematic/cinematicThemes';
import { safeJsonLdHtml } from '../../utils/jsonLdSafe.mjs';
import { COMPANY_SITE } from '../../utils/company';
import { C, T } from '../../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   /collection/[key] — ONE INVITATION, OPEN.

   This is the page the whole gallery exists to lead to, and it is where this
   product stops resembling a template shop. A template shop's detail page
   shows you a bigger picture and a price. This one hands you the thing: the
   real guest page, the real opening, the real sections, in a phone you can
   scroll — and then a way to go and reply to it as a guest.

   ── THE KEY IS AN ALLOWLIST, STRUCTURALLY ────────────────────────────────

   `[key]` is a URL segment written by a stranger, and it ends up as
   `template_type` on an event object that a renderer reads. That is the one
   genuinely security-relevant thing on this route, so it is closed twice and
   neither check is a line somebody can forget to write:

     · `generateStaticParams` enumerates the catalogue, so these four paths
       are prerendered and are the only ones that exist at build time;
     · `dynamicParams = false` makes anything else a 404 outright rather than
       rendering on demand.

   `notFound()` stays as well for the development server, where dynamic
   params are still resolved. Three guards for one segment is not paranoia
   here: `template_type` is free text with no CHECK constraint anywhere in the
   schema, so nothing downstream will refuse a key that gets this far.

   ── THE ASSETS ARE PRELOADED FROM THE SERVER ─────────────────────────────

   `preloadCinematicAssets` calls react-dom's `preload` during render, which
   only emits a <link rel=preload> into the document if it happens in a render
   pass — an effect is far too late. This is a Server Component, so the
   poster is already being fetched while the rest of the HTML is still
   arriving, and the still paints without a flash.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The four paths, from the catalogue. THE ALLOWLIST — see the header. */
export function generateStaticParams() {
  return COLLECTION_KEYS.map((key) => ({ key }));
}

/* Anything not returned above is a 404, not an on-demand render. Without
   this, `/collection/<anything>` would be rendered at request time and the
   only thing standing between an arbitrary string and a template renderer
   would be the notFound() call below. */
export const dynamicParams = false;

export async function generateMetadata({ params }) {
  const { key } = await params;
  // Same accessor as the page body, for the same reason — a bare index would
  // hand this an inherited function and it would describe the page with it.
  const item = collectionItem(key);
  if (!item) return {};

  const title = `${item.label} — ${item.tagline} | Fancy RSVP`;
  const description = `${item.arrival} ${item.desc}`;

  return {
    title,
    description,
    openGraph: {
      title: `${item.label} — an invitation your guests open`,
      description,
      url: `${COMPANY_SITE}/collection/${item.key}`,
      siteName: 'Fancy RSVP',
      type: 'article',
      /* The template's own plate, not the site's generic card. A shared
         invitation link that previews as a logo wastes the one thing this
         page has going for it. */
      images: [{ url: `${COMPANY_SITE}${item.art}`, width: 468, height: 1013, alt: `The ${item.label} invitation` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${item.label} — an invitation your guests open`,
      description,
      images: [`${COMPANY_SITE}${item.art}`],
    },
    alternates: { canonical: `${COMPANY_SITE}/collection/${item.key}` },
  };
}

/** Where "next" goes. The catalogue's own order, wrapping at the end, so
 *  every template is reachable from every other one without a dead end.
 *
 *  THE GUARD IS NOT THEORETICAL ARITHMETIC. A modulus wrap over a short list
 *  points at the page it is on: with one template both neighbours ARE that
 *  template, so Swan Lake would offer "Previous: Swan Lake / Next: Swan Lake";
 *  with two, prev and next are the same other template printed twice under
 *  different words. Templates get retired here — two were in 2026-08-16 — so
 *  a two-entry catalogue is a state this has to survive, not a hypothetical. */
function neighbours(key) {
  const n = COLLECTION.length;
  const i = COLLECTION.findIndex((c) => c.key === key);
  if (i < 0 || n < 2) return { prev: null, next: null };
  const next = COLLECTION[(i + 1) % n];
  // With exactly two, prev and next resolve to the same entry; offer it once.
  const prev = n > 2 ? COLLECTION[(i - 1 + n) % n] : null;
  return { prev, next };
}

export default async function CollectionTemplatePage({ params }) {
  const { key } = await params;
  /* collectionItem, not COLLECTION_BY_KEY[key] — a bare index returns
     Object.prototype.constructor for "constructor" and this 404 would not
     fire. See the accessor's own note. */
  const item = collectionItem(key);
  if (!item) notFound();

  /* During render, not in an effect — see the header. */
  preloadCinematicAssets(item.key);

  const { prev, next } = neighbours(item.key);

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'The Collection', item: `${COMPANY_SITE}/collection` },
      { '@type': 'ListItem', position: 2, name: item.label, item: `${COMPANY_SITE}/collection/${item.key}` },
    ],
  };

  return (
    <div style={{ minHeight: '100dvh', background: C.paper }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdHtml(breadcrumbLd) }}
      />

      <Navbar />

      <main>
        <section className="ctp">
          <div className="fx-container fx-container--5xl fx-gutter">
            <nav aria-label="Breadcrumb" className="ctp-crumbs">
              <Link href="/collection" className="ctp-crumbs__link">The Collection</Link>
              <span aria-hidden="true" className="ctp-crumbs__sep">/</span>
              <span aria-current="page" className="ctp-crumbs__here">{item.label}</span>
            </nav>

            {/* The invitation and the words about it, side by side on a
                desktop and stacked on a phone with the PICTURE FIRST — a
                visitor who followed a plate here came for the object, and
                making them read a paragraph to reach it wastes the click. */}
            <div className="ctp-grid">
              <div className="ctp-copy">
                <span className="ctp-tagline">{item.tagline}</span>
                <h1 className="ctp-title">{item.label}</h1>
                <p className="ctp-arrival">{item.arrival}</p>
                <p className="ctp-desc">{item.desc}</p>

                {/* The badge and its reason together. A bare "Engagement"
                    chip looks like a restriction somebody forgot to explain;
                    `note` is the sentence the wizard's own picker shows for
                    the same policy, so the two cannot disagree. */}
                <div className={`ctp-occ${item.locked ? ' ctp-occ--locked' : ''}`}>
                  <span className="ctp-occ__badge">{item.badge}</span>
                  <span className="ctp-occ__note">{item.note}</span>
                </div>

                {item.specs.length > 0 && (
                  <ul className="ctp-specs">
                    {item.specs.map((s) => (
                      <li key={s} className="ctp-spec">{s}</li>
                    ))}
                  </ul>
                )}

                <div className="ctp-acts">
                  <Link href="/register" className="ctp-btn ctp-btn--ink">
                    <span className="ctp-btn__do">Use this invitation</span>
                    <span className="ctp-btn__price">Free for 7 days</span>
                  </Link>
                  {/* NOT "See all four". The number was typed into this
                      sentence, which is precisely the drift the invitations
                      band already had to fix — it counted its templates in
                      two places and shipping a fourth left the homepage
                      saying "three" twice. A fifth template would have left
                      this button offering four. */}
                  <Link href="/collection" className="ctp-btn ctp-btn--ghost">See the collection</Link>
                </div>
              </div>

              <div className="ctp-live">
                <LiveInvitation
                  /* KEYED, AND THE PREV/NEXT RAIL BELOW IS WHY.
                     Those two links move between /collection/swans and
                     /collection/ring — the SAME dynamic route. React
                     reconciles the element at the same position to the same
                     component instance, so the state inside it survives:
                     `event` is lazy initial state and an initializer runs
                     once, so page two would render page one's invitation, and
                     an already-opened live view would stay open showing the
                     wrong template. The key makes a different template a
                     different element, which is what it actually is. */
                  key={item.key}
                  templateKey={item.key}
                  label={item.label}
                  poster={item.poster}
                  arrival={item.arrival}
                  occasion={item.occasion}
                  livePhoto={item.livePhoto}
                />
              </div>
            </div>

            {/* ── on to the next one ──
                A gallery whose detail pages are dead ends sends every visitor
                back through the index to see the second thing. */}
            <nav aria-label="More invitations" className="ctp-more">
              {prev && (
                <Link href={`/collection/${prev.key}`} className="ctp-more__link ctp-more__link--prev">
                  <span className="ctp-more__dir">Previous</span>
                  <span className="ctp-more__name">{prev.label}</span>
                </Link>
              )}
              {next && (
                <Link href={`/collection/${next.key}`} className="ctp-more__link ctp-more__link--next">
                  <span className="ctp-more__dir">Next</span>
                  <span className="ctp-more__name">{next.label}</span>
                </Link>
              )}
            </nav>
          </div>
        </section>
      </main>

      <FooterSection />

      {/* A plain <style> element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          elements above. Classes are prefixed "ctp-".

          No backticks inside these CSS comments: one would terminate this
          template literal and produce a parse error. */}
      <style>{`
        .ctp {
          width: 100%;
          background: ${C.paper};
          padding: 26px 0 76px;
        }

        .ctp-crumbs {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: ${T.body};
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .ctp-crumbs__link { color: ${C.goldInk}; text-decoration: none; }
        .ctp-crumbs__link:hover { text-decoration: underline; }
        .ctp-crumbs__sep { color: ${C.border}; }
        .ctp-crumbs__here { color: ${C.inkSoft}; opacity: 0.8; }

        /* Column on a phone, and the PICTURE comes first there — see the note
           in the JSX. The "order" property does that without moving the
           heading out of document order, so the h1 is still the first thing
           announced. */
        .ctp-grid {
          display: flex;
          flex-direction: column;
          gap: 44px;
          margin-top: 26px;
        }
        .ctp-copy { min-width: 0; order: 2; }
        .ctp-live { min-width: 0; order: 1; }

        .ctp-tagline {
          display: block;
          font-family: ${T.body};
          font-size: 10px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        .ctp-title {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 44px;
          line-height: 1.02;
          letter-spacing: -0.02em;
          color: ${C.ink};
          margin: 14px 0 0;
        }
        .ctp-arrival {
          font-family: ${T.display};
          font-size: 21px;
          font-style: italic;
          line-height: 1.4;
          color: ${C.goldInk};
          margin: 16px 0 0;
        }
        .ctp-desc {
          font-size: 15px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 16px 0 0;
          max-width: 52ch;
        }

        .ctp-occ {
          display: flex;
          flex-direction: column;
          gap: 7px;
          margin-top: 26px;
          padding: 15px 17px;
          background: ${C.paper2};
          border-left: 2px solid ${C.border};
        }
        .ctp-occ--locked { border-left-color: ${C.gold}; }
        .ctp-occ__badge {
          font-family: ${T.body};
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        .ctp-occ__note {
          font-size: 13px;
          font-weight: 300;
          line-height: 1.7;
          color: ${C.inkSoft};
        }

        .ctp-specs {
          margin: 26px 0 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .ctp-spec {
          padding: 7px 13px;
          border: 1px solid ${C.border};
          font-family: ${T.body};
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: ${C.inkSoft};
        }

        .ctp-acts {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 32px;
        }
        .ctp-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 56px;
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          /* nowrap, so a two-line label can never read as a mistake. The
             primary carries its price on a SECOND SPAN rather than in one
             long string for exactly that reason: at 0.18em tracking the
             combined label does not fit 280px, and nowrap means it would
             overflow rather than wrap. */
          white-space: nowrap;
          text-decoration: none;
          transition: background 0.35s ease, color 0.35s ease, border-color 0.35s ease;
        }
        .ctp-btn--ink {
          flex-direction: column;
          background: ${C.ink};
          color: ${C.paper};
          border: 1px solid ${C.ink};
          padding: 10px 34px;
        }
        .ctp-btn--ink:hover { background: transparent; color: ${C.ink}; }
        .ctp-btn__do { display: block; }
        .ctp-btn__price {
          display: block;
          margin-top: 3px;
          font-size: 9.5px;
          font-weight: 500;
          letter-spacing: 0.16em;
          opacity: 0.7;
        }
        .ctp-btn--ghost {
          background: transparent;
          color: ${C.ink};
          border: 1px solid ${C.border};
          padding: 0 34px;
        }
        .ctp-btn--ghost:hover { background: ${C.ink}; border-color: ${C.ink}; color: ${C.paper}; }

        .ctp-more {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          margin-top: 64px;
          padding-top: 26px;
          border-top: 1px solid ${C.border};
        }
        .ctp-more__link {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
          text-decoration: none;
        }
        .ctp-more__link--next { text-align: right; margin-left: auto; }
        .ctp-more__dir {
          font-family: ${T.body};
          font-size: 9px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.7;
        }
        .ctp-more__name {
          font-family: ${T.display};
          font-size: 21px;
          font-weight: 400;
          color: ${C.ink};
        }
        .ctp-more__link:hover .ctp-more__name { color: ${C.goldInk}; }

        @media (min-width: 768px) {
          .ctp { padding: 34px 0 110px; }
          .ctp-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 0.86fr);
            gap: 72px;
            align-items: center;
            margin-top: 34px;
          }
          /* Side by side, and the words lead again — the picture is already
             beside them rather than below, so nothing is buried. */
          .ctp-copy { order: 1; }
          .ctp-live { order: 2; }
          .ctp-title { font-size: 68px; margin-top: 16px; }
          .ctp-arrival { font-size: 24px; }
          .ctp-desc { font-size: 16px; }
          .ctp-acts { flex-direction: row; margin-top: 38px; }
          .ctp-more { margin-top: 92px; }
          .ctp-more__name { font-size: 25px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .ctp-btn { transition: none; }
        }
      `}</style>
    </div>
  );
}
