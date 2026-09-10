'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { S, ST, SHADOW, artFor, markFor, ALL_MARK, ART_VIEWBOX } from './shopTheme';
import { formatPrice, unitFor, SHOP_MIN_ORDER_QTY } from '../utils/shopLinks';
import { assetUrl, assetSrcSet } from '../utils/assetUrl';

/* ═══════════════════════════════════════════════════════════════════════════
   THE SHOP — browse.

   One component renders both surfaces, because they are the same page with a
   different filter applied:

     /shop                → every piece, with the category shelves on top
     /shop/<category>     → one shelf

   Rendering them from one source is the point: the old catalogue had a single
   flat list and a separate hand-written hero, and the two drifted — the hero
   advertised "printed invitations" while the list had grown scanners in it.

   ── WHAT THE FILTERS ARE BUILT FROM ───────────────────────────────────────

   Only from columns that exist. The approved mockup showed Material, Finish
   and Stock filters, and there are no such columns on shop_products — building
   them would mean either inventing data or parsing it out of prose, and a
   filter that silently matches nothing is worse than no filter. What is real:
   category, admin-defined filterable badges, price, and availability.

   Material/finish filtering is a schema change (a `facets jsonb` column, or a
   shop_product_facets table) and is deliberately left out rather than faked.

   ── MOBILE FIRST ──────────────────────────────────────────────────────────

   The base rules are the phone: two cards per row, filters behind a button
   rather than stacked above the grid where they push every product below the
   fold. The single media query steps up at 768.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Fixed steps rather than a slider bound to the data's own min/max: a
 *  catalogue holding a $0.35 belly band and a $1,150 display has a range no
 *  slider can express usefully, and named bands are what people actually
 *  reach for. */
const PRICE_BANDS = [
  { key: 'u1', label: 'Under $1', test: (c) => c !== null && c < 100 },
  { key: '1-3', label: '$1 – $3', test: (c) => c !== null && c >= 100 && c <= 300 },
  { key: '3-25', label: '$3 – $25', test: (c) => c !== null && c > 300 && c <= 2500 },
  { key: '25+', label: '$25 and up', test: (c) => c !== null && c > 2500 },
  { key: 'quote', label: 'Price on request', test: (c) => c === null },
];

const SORTS = [
  { key: 'featured', label: 'Featured' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'name', label: 'Name (A–Z)' },
];

/**
 * Keeps "price on request" at the bottom of either price sort.
 *
 * Returns a comparator result when at least one side has no price, and `null`
 * when both are priced so the caller can do the real comparison. Two quoted
 * pieces tie (0) rather than producing NaN.
 */
function quotedLast(a, b) {
  const aq = a.price_cents == null;
  const bq = b.price_cents == null;
  if (aq && bq) return 0;
  if (aq) return 1;
  if (bq) return -1;
  return null;
}

function PlaceholderArt({ slug }) {
  return (
    <span className="sp-art" aria-hidden="true">
      <svg viewBox={ART_VIEWBOX} fill="none" stroke={S.gold} strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.65"
        dangerouslySetInnerHTML={{ __html: artFor(slug) }} />
    </span>
  );
}

/**
 * The square plate one category gets on the shop home.
 *
 * Two faces, ONE frame. With a photograph it is the photograph under a scrim;
 * without one it is the drawing on paper — and in both the double gold rule,
 * the index numeral and the name sit in exactly the same place, so a shelf
 * that has been photographed and one that has not still read as one set.
 * (The old row of text bars had neither face: a 36px grey square and a name.)
 */
function CategoryPlate({ category, index, count, cover }) {
  return (
    <Link
      href={`/shop/${category.slug}`}
      className={`plate${cover ? ' plate--photo' : ''}`}
    >
      {cover && (
        <>
          {/* alt defaults to "" deliberately: the shelf name is printed in the
              plate right beside the picture, so an alt that repeats it is read
              twice. An admin who writes one is describing the PHOTOGRAPH. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="plate__img" src={assetUrl(cover.url, 'card')} srcSet={assetSrcSet(cover.url, [400, 800])} sizes="(max-width: 700px) 46vw, 320px" alt={cover.alt || ''} loading="lazy" decoding="async" />
          <span className="plate__scrim" aria-hidden="true" />
        </>
      )}
      <span className="plate__frame" aria-hidden="true" />
      <span className="plate__ix" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <span className="plate__art" aria-hidden="true">
        {!cover && (
          <svg viewBox={ART_VIEWBOX} fill="none" stroke={S.goldInk} strokeWidth="1.3"
            strokeLinecap="round" strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: artFor(category.slug) }} />
        )}
      </span>
      <span className="plate__rule" aria-hidden="true" />
      <span className="plate__name">{category.name}</span>
      <span className="plate__count">{count} {count === 1 ? 'piece' : 'pieces'}</span>
    </Link>
  );
}

function ProductCard({ product, categorySlug, href }) {
  const img = product.images?.[0];
  const price = formatPrice(product.price_cents, product.currency);
  const was = formatPrice(product.compare_at_cents, product.currency);
  const badge = product.badges?.[0];
  const moq = product.min_order_qty || SHOP_MIN_ORDER_QTY;

  return (
    <article className="sp">
      <Link href={href} className="sp-media">
        {badge && (
          <span className="sp-badge" style={{ background: badge.bg_color || S.ivory, color: badge.text_color || S.goldInk }}>
            {badge.label}
          </span>
        )}
        {product.is_sold_out && <span className="sp-badge sp-badge--out">Sold out</span>}
        {/* `url`/`alt`, not `image_url`/`alt_text`: the row columns are the
            latter, but attachRelations() in the public controller maps them on
            the way out, and the API shape is what this component receives. */}
        {img
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img className="sp-img" src={assetUrl(img.url, 'card')} srcSet={assetSrcSet(img.url, [400, 800])} sizes="(max-width: 700px) 46vw, 320px" alt={img.alt || product.title} loading="lazy" decoding="async" />
          : <PlaceholderArt slug={categorySlug} />}
      </Link>

      <div className="sp-body">
        <Link href={href} className="sp-title">{product.title}</Link>
        {product.tagline && <span className="sp-spec">{product.tagline}</span>}

        <span className="sp-price">
          {price
            ? <><span className="sp-amount">{price}</span>
              {/* No "/" any more. It was hardcoded here and nowhere else, so
                  the same piece read "$780.00 / unit" in the grid and
                  "$780.00 unit" on its own page. The unit is a PHRASE and it
                  is always printed — see unitFor(). */}
              <span className="sp-unit"> {unitFor(product)}</span></>
            : <span className="sp-amount sp-amount--quote">Price on request</span>}
          {was && <span className="sp-was">{was}</span>}
        </span>

        <span className="sp-meta">
          <span className="sp-moq">Min. {moq}</span>
          {product.lead_time_text && <span className="sp-lead">{product.lead_time_text}</span>}
        </span>
      </div>
    </article>
  );
}

export default function ShopBrowse({ products, categories, badges, settings, category }) {
  const [openFilters, setOpenFilters] = useState(false);
  const [activeBadges, setActiveBadges] = useState(() => new Set());
  const [activeBands, setActiveBands] = useState(() => new Set());
  const [hideSoldOut, setHideSoldOut] = useState(false);
  const [sort, setSort] = useState('featured');

  const catBySlug = useMemo(
    () => new Map((categories || []).map((c) => [c.slug, c])),
    [categories],
  );
  const catById = useMemo(
    () => new Map((categories || []).map((c) => [c.id, c])),
    [categories],
  );

  /** The shelf being shown, or null on the shop home. */
  const shelf = category ? catBySlug.get(category) : null;

  const inShelf = useMemo(
    () => (shelf ? (products || []).filter((p) => p.category_id === shelf.id) : (products || [])),
    [products, shelf],
  );

  const filterable = useMemo(
    () => (badges || []).filter((b) => b.is_filterable),
    [badges],
  );

  /** How many pieces sit on each shelf. Computed once against the WHOLE
   *  catalogue, not against `inShelf` — the plates and the index name every
   *  shelf, including the ones the current filter or category excludes. */
  const countByCategory = useMemo(() => {
    const counts = new Map();
    for (const p of products || []) {
      if (!p.category_id) continue;
      counts.set(p.category_id, (counts.get(p.category_id) || 0) + 1);
    }
    return counts;
  }, [products]);

  /**
   * The collection's cover photograph, as an admin chose it.
   *
   * THIS USED TO BE DERIVED FROM A PRODUCT, and that was the wrong picture.
   * `coverByCategory` walked each shelf's pieces and took the featured one's
   * first photograph, else the first by sort order. Three things were wrong
   * with it: a product shot is lit and cropped to sell one object rather than
   * to stand for a shelf; nobody ever chose the image; and which product won
   * changed on its own whenever the catalogue was re-ordered or a different
   * piece was ticked as featured.
   *
   * `shop_categories.cover_image_url` is now a real column, set in
   * Admin → Shop → Collections (migration 20260827000000). There is no
   * fallback to a product photograph — a shelf with no cover shows the drawn
   * plate, which is a designed face rather than a hole, and an accidental
   * borrowed photo is exactly what this replaced.
   */
  const coverFor = useCallback(
    (c) => (c?.cover_image_url ? { url: c.cover_image_url, alt: c.cover_image_alt || '' } : null),
    [],
  );

  const shown = useMemo(() => {
    let list = inShelf;

    if (activeBadges.size) {
      list = list.filter((p) => (p.badges || []).some((b) => activeBadges.has(b.id)));
    }
    if (activeBands.size) {
      const tests = PRICE_BANDS.filter((b) => activeBands.has(b.key));
      list = list.filter((p) => tests.some((b) => b.test(p.price_cents)));
    }
    if (hideSoldOut) list = list.filter((p) => !p.is_sold_out);

    const by = {
      // `sort_order` first, then newest — the admin's own arrangement, which
      // is what "featured" means here rather than a popularity metric nothing
      // in this system records.
      featured: (a, b) => (b.is_featured - a.is_featured)
        || (a.sort_order - b.sort_order)
        || String(a.title).localeCompare(String(b.title)),
      // Nulls are "price on request" and sort LAST in BOTH directions: they
      // are not free, and putting them at the top of "low to high" would say
      // they were.
      //
      // Quoted pieces are partitioned out rather than mapped to ±Infinity.
      // The arithmetic version returned `Infinity - Infinity` — NaN — whenever
      // two quoted pieces were compared, and a comparator that returns NaN has
      // no defined behaviour: the order it produces is whatever the engine's
      // sort happens to do with it.
      'price-asc': (a, b) => quotedLast(a, b) ?? (a.price_cents - b.price_cents),
      'price-desc': (a, b) => quotedLast(a, b) ?? (b.price_cents - a.price_cents),
      name: (a, b) => String(a.title).localeCompare(String(b.title)),
    }[sort];

    return [...list].sort(by);
  }, [inShelf, activeBadges, activeBands, hideSoldOut, sort]);

  /** Counts are computed against the shelf, not against the filtered result —
   *  a count that changes as you tick things tells you nothing about what
   *  ticking the NEXT box would do. */
  const badgeCount = (id) => inShelf.filter((p) => (p.badges || []).some((b) => b.id === id)).length;
  const bandCount = (band) => inShelf.filter((p) => band.test(p.price_cents)).length;

  const appliedCount = activeBadges.size + activeBands.size + (hideSoldOut ? 1 : 0);

  /* THE INDEX HAS TO OPEN ON THE SHELF YOU ARE READING.
   *
   * It is a horizontal scroll port that starts at scrollLeft 0, so on a phone
   * anyone deep in the list — Envelopes & extras is sixth — landed on a strip
   * showing the first two shelves with nothing marked, on the one control that
   * exists to say where you are and what else there is.
   *
   * scrollLeft is set directly rather than with scrollIntoView(): that also
   * scrolls the nearest VERTICAL ancestor, so arriving on a category page
   * would jump you past the heading you just clicked. It is also unimplemented
   * in jsdom, which would make this untestable.
   */
  const activeShelfRef = useRef(null);
  useEffect(() => {
    const link = activeShelfRef.current;
    const port = link?.closest('.shop-index__list');
    if (!link || !port) return;
    const centred = link.offsetLeft - (port.clientWidth - link.offsetWidth) / 2;
    port.scrollLeft = Math.max(0, centred);
  }, [shelf?.id]);

  const toggle = (setter) => (value) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
  const toggleBadge = toggle(setActiveBadges);
  const toggleBand = toggle(setActiveBands);

  const clearAll = () => {
    setActiveBadges(new Set());
    setActiveBands(new Set());
    setHideSoldOut(false);
  };

  const hrefFor = (p) => {
    const slug = catById.get(p.category_id)?.slug;
    return slug ? `/shop/${slug}/${p.slug}` : `/shop/all/${p.slug}`;
  };

  const title = shelf ? shelf.name : (settings?.hero_title || 'Shop');
  const blurb = shelf
    ? shelf.description
    : (settings?.hero_subtitle
      || 'Cards, envelopes, signage, screens and the door hardware — priced per unit in US dollars, made to the same artwork as your digital invitation.');

  const filterPanel = (
    <div className="sf">
      <div className="sf-head">
        <span className="sf-title">Refine</span>
        {appliedCount > 0 && (
          <button type="button" className="sf-clear" onClick={clearAll}>Clear all</button>
        )}
      </div>

      {/* ── Collections ──────────────────────────────────────────────────
          The one group in this panel that is NOT a checkbox, because a
          collection is a ROUTE (/shop/<slug>) rather than a client-side
          filter — it has its own page, its own title and its own metadata.
          Rendering it as a tick box would either lie about that or quietly
          create a second, conflicting way to narrow the same list.

          It carries the collection's cover photograph for the same reason
          the plates and the index strip do: the picture is how a shelf is
          recognised, and the panel was the one surface that named the
          collections without ever showing them. */}
      {categories?.length > 0 && (
        <div className="sf-group">
          <span className="sf-legend">Collections</span>
          <ul className="sf-cats">
            <li>
              <Link href="/shop" className={`sf-cat${!shelf ? ' is-on' : ''}`} aria-current={!shelf ? 'page' : undefined}>
                <span className="sf-cat__art sf-cat__art--all" aria-hidden="true">
                  <svg viewBox={ART_VIEWBOX} fill="none" stroke={S.gold} strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round"
                    dangerouslySetInnerHTML={{ __html: ALL_MARK }} />
                </span>
                <span className="sf-cat__name">All pieces</span>
                <span className="sf-cat__count">{(products || []).length}</span>
              </Link>
            </li>
            {categories.map((c) => {
              const on = shelf?.id === c.id;
              const art = coverFor(c);
              return (
                <li key={c.id}>
                  <Link
                    href={`/shop/${c.slug}`}
                    className={`sf-cat${on ? ' is-on' : ''}`}
                    aria-current={on ? 'page' : undefined}
                  >
                    <span className={`sf-cat__art${art ? ' sf-cat__art--photo' : ''}`} aria-hidden="true">
                      {art
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={assetUrl(art.url, 'thumb')} alt="" loading="lazy" decoding="async" />
                        : (
                          <svg viewBox={ART_VIEWBOX} fill="none" stroke={S.gold} strokeWidth="1.7"
                            strokeLinecap="round" strokeLinejoin="round"
                            dangerouslySetInnerHTML={{ __html: markFor(c.slug) }} />
                        )}
                    </span>
                    <span className="sf-cat__name">{c.name}</span>
                    <span className="sf-cat__count">{countByCategory.get(c.id) || 0}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {filterable.length > 0 && (
        <div className="sf-group">
          <span className="sf-legend">Labels</span>
          {filterable.map((b) => {
            const n = badgeCount(b.id);
            return (
              <label key={b.id} className={`sf-row${n === 0 ? ' sf-row--empty' : ''}`}>
                <input
                  type="checkbox"
                  checked={activeBadges.has(b.id)}
                  onChange={() => toggleBadge(b.id)}
                  disabled={n === 0}
                />
                <span className="sf-box" aria-hidden="true" />
                <span className="sf-label">{b.label}</span>
                <span className="sf-count">{n}</span>
              </label>
            );
          })}
        </div>
      )}

      <div className="sf-group">
        <span className="sf-legend">Price</span>
        {PRICE_BANDS.map((band) => {
          const n = bandCount(band);
          return (
            <label key={band.key} className={`sf-row${n === 0 ? ' sf-row--empty' : ''}`}>
              <input
                type="checkbox"
                checked={activeBands.has(band.key)}
                onChange={() => toggleBand(band.key)}
                disabled={n === 0}
              />
              <span className="sf-box" aria-hidden="true" />
              <span className="sf-label">{band.label}</span>
              <span className="sf-count">{n}</span>
            </label>
          );
        })}
      </div>

      <div className="sf-group">
        <span className="sf-legend">Availability</span>
        <label className="sf-row">
          <input type="checkbox" checked={hideSoldOut} onChange={() => setHideSoldOut((v) => !v)} />
          <span className="sf-box" aria-hidden="true" />
          <span className="sf-label">Hide sold out</span>
          <span className="sf-count">{inShelf.filter((p) => p.is_sold_out).length}</span>
        </label>
      </div>
    </div>
  );

  return (
    <main className="shop">
      {/* ── the head ── */}
      <section className="shop-head">
        <div className="fx-container fx-container--5xl fx-gutter">
          <nav className="shop-crumb" aria-label="Breadcrumb">
            <Link href="/shop">Shop</Link>
            {shelf && <><span aria-hidden="true"> / </span><span>{shelf.name}</span></>}
          </nav>
          <h1 className="shop-h1">{title}</h1>
          {blurb && <p className="shop-blurb">{blurb}</p>}
        </div>
      </section>

      {/* ── the shelves, on the shop home ──
          A swipeable strip of plates under 1024 and a single row of six above
          it. The strip is what fixes the phone: the old stacked bars took
          about 400px of screen before a single product appeared. */}
      {!shelf && categories?.length > 0 && (
        <section className="shop-cats">
          <div className="fx-container fx-container--5xl fx-gutter">
            <span className="shop-kicker">Browse by category
              <span aria-hidden="true" className="shop-kicker__rule" /></span>
          </div>
          {/* The gutter is on the LIST, not on a wrapper: it is also the scroll
              port, so the padding keeps the first plate aligned with the
              heading while the rest still run off the edge of the screen.
              No `padding: 0` reset here — that would beat .fx-gutter, since
              this style element comes after globals.css in the document. */}
          <ul className="shop-plates fx-container fx-container--5xl fx-gutter">
            {categories.map((c, i) => (
              <li key={c.id}>
                <CategoryPlate
                  category={c}
                  index={i}
                  count={countByCategory.get(c.id) || 0}
                  cover={coverFor(c)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── the shelf index, inside a shelf ──
          Opening a category used to remove every other category from the page:
          the only ways on were the breadcrumb and the back button, and there
          was no way ACROSS at all. This strip stays put, names every shelf
          with its count, and marks the one being read. */}
      {/* >= 1, not > 1: with a single shelf the index is still the only way
          back out to the whole catalogue that is not the breadcrumb. */}
      {shelf && categories?.length >= 1 && (
        <nav className="shop-index" aria-label="Shop categories">
          <ul className="shop-index__list fx-container fx-container--5xl fx-gutter">
            <li>
              <Link href="/shop" className="shelf">
                <span className="shelf__mark shelf__mark--art" aria-hidden="true">
                  <svg viewBox={ART_VIEWBOX} fill="none" stroke={S.gold} strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round" opacity="0.75"
                    dangerouslySetInnerHTML={{ __html: ALL_MARK }} />
                </span>
                <span className="shelf__name">All pieces</span>
                <span className="shelf__count">{(products || []).length}</span>
              </Link>
            </li>
            {categories.map((c) => {
              const on = c.id === shelf.id;
              const art = coverFor(c);
              return (
                <li key={c.id}>
                  <Link
                    href={`/shop/${c.slug}`}
                    className={`shelf${on ? ' shelf--on' : ''}`}
                    aria-current={on ? 'page' : undefined}
                    ref={on ? activeShelfRef : undefined}
                  >
                    {/* THE PICTURE STAYS, SELECTED OR NOT.
                        A collection with a cover shows that cover here at every
                        state — the mark is the same object the plate on /shop
                        was, just smaller. Only a collection with NO cover falls
                        back to the line drawing, and it keeps that drawing when
                        selected too. Nothing swaps one face for another on
                        click, which is what made the strip feel like it lost
                        the shelf you had just chosen. */}
                    <span className={`shelf__mark${art ? ' shelf__mark--photo' : ' shelf__mark--art'}`} aria-hidden="true">
                      {art
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={assetUrl(art.url, 'thumb')} alt="" loading="lazy" decoding="async" />
                        : (
                          <svg viewBox={ART_VIEWBOX} fill="none" stroke={on ? S.goldInk : S.gold}
                            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
                            opacity={on ? 1 : 0.75}
                            dangerouslySetInnerHTML={{ __html: markFor(c.slug) }} />
                        )}
                    </span>
                    <span className="shelf__name">{c.name}</span>
                    <span className="shelf__count">{countByCategory.get(c.id) || 0}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* ── the grid ── */}
      <section className="shop-body">
        <div className="fx-container fx-container--5xl fx-gutter shop-split">
          <aside className={`shop-aside${openFilters ? ' is-open' : ''}`}>{filterPanel}</aside>

          <div className="shop-main">
            <div className="shop-bar">
              <button
                type="button"
                className="shop-filterbtn"
                onClick={() => setOpenFilters((v) => !v)}
                aria-expanded={openFilters}
              >
                Filter{appliedCount > 0 && <span className="shop-pill">{appliedCount}</span>}
              </button>

              <span className="shop-count">
                <strong>{shown.length}</strong>
                {shown.length !== inShelf.length && <> of {inShelf.length}</>}
                {' '}{inShelf.length === 1 ? 'piece' : 'pieces'}
              </span>

              <label className="shop-sort">
                <span className="shop-sort__label">Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            </div>

            {/* Two different nothings.
                An empty SHELF and an over-tight FILTER look identical in the
                grid and need opposite responses — offering "clear your
                filters" to someone who has set none reads as a broken page,
                and it was what this said when the catalogue was empty or the
                backend was unreachable. */}
            {shown.length === 0 ? (
              inShelf.length === 0 ? (
                <p className="shop-empty">
                  {shelf
                    ? `Nothing is listed under ${shelf.name} yet.`
                    : 'The catalogue is being photographed. Nothing is listed yet.'}
                </p>
              ) : (
                <p className="shop-empty">
                  Nothing matches those filters yet.{' '}
                  <button type="button" onClick={clearAll} className="shop-empty__clear">Clear them</button>
                </p>
              )
            ) : (
              // --fx-col lives in the style block below, NOT inline. An inline
              // custom property is still an inline declaration, so the desktop
              // rule that shrinks these cards could never have reached it —
              // the exact trap test/inlineStyleTraps.test.js exists to catch.
              <ul className="shop-grid fx-grid">
                {shown.map((p) => (
                  <li key={p.id}>
                    <ProductCard
                      product={p}
                      categorySlug={catById.get(p.category_id)?.slug}
                      href={hrefFor(p)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* A PLAIN style element. styled-jsx stamps its hash only onto lowercase
          intrinsic elements, so every rule aimed at a class on a next/link
          here would compile to .sp-title.jsx-hash and match nothing — the bug
          that made this platform's alerts invisible in production. Classes are
          prefixed "shop-", "sp-" and "sf-" instead.

          No backticks inside these CSS comments: one would terminate the
          template literal and produce a parse error. */}
      <style>{`
        .shop { background: ${S.paper}; }

        .shop-head { padding: 26px 0 0; }
        .shop-crumb { font-size: 11px; letter-spacing: 0.08em; color: ${S.inkSoft}; }
        .shop-crumb a { color: ${S.inkSoft}; text-decoration: none; opacity: 0.8; }
        .shop-crumb a:hover { color: ${S.ink}; }
        .shop-h1 {
          font-family: ${ST.display};
          font-weight: 300;
          font-size: 32px;
          line-height: 1.06;
          letter-spacing: -0.018em;
          color: ${S.ink};
          margin: 12px 0 0;
        }
        .shop-blurb {
          font-size: 14.5px;
          font-weight: 300;
          line-height: 1.78;
          color: ${S.inkSoft};
          margin: 10px 0 0;
          max-width: 56ch;
        }

        .shop-kicker {
          display: inline-flex;
          align-items: center;
          gap: 11px;
          font-family: ${ST.label};
          font-size: 9.5px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: ${S.goldInk};
          white-space: nowrap;
        }
        .shop-kicker__rule { display: block; flex: none; width: 24px; height: 1px; background: ${S.gold}; opacity: 0.55; }

        .shop-cats { padding: 30px 0 0; }

        /* ── the plates ──
           Under 1024 this list IS a scroll port: a strip of fixed-width
           squares that runs off the edge of the screen. min-width on the port
           is inherited from .fx-container (0), which is what lets it scroll
           instead of widening the page. */
        .shop-plates {
          list-style: none;
          margin: 14px auto 0;
          display: flex;
          gap: 10px;
          overflow-x: auto;
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
          scroll-snap-type: x proximity;
          /* The snapport otherwise starts at the scroll box's PADDING EDGE,
             so the browser snap-scrolls plate 01 to x=0 on load and eats the
             gutter: the strip sat a full gutter left of the heading above it,
             with no scrolling and nothing in the CSS to explain it. */
          scroll-padding-inline-start: max(var(--fx-pad-x), var(--fx-safe-l));
          scrollbar-width: none;
        }
        .shop-plates::-webkit-scrollbar { display: none; }
        .shop-plates > li { flex: 0 0 auto; scroll-snap-align: start; min-width: 0; }

        .plate {
          position: relative;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          width: 152px;
          aspect-ratio: 1 / 1;
          padding: 15px;
          overflow: hidden;
          text-decoration: none;
          background: linear-gradient(158deg, #FCF8F0 0%, #F2E9D7 55%, #E9DECA 100%);
          border: 1px solid #DED4C1;
          transition: border-color 0.25s ease, box-shadow 0.3s ease;
        }
        .plate:hover { border-color: ${S.borderLift}; box-shadow: ${SHADOW.cardHover}; }
        /* The double rule is a real element, not .plate::before, because the
           photograph has to paint UNDER it: a parent's ::before is painted as
           its first child, which would put the rule behind the image. This
           span sits after the image in the markup, so it lands on top. */
        .plate__frame {
          position: absolute;
          inset: 7px;
          border: 1px solid rgba(169, 138, 78, 0.32);
          pointer-events: none;
          transition: border-color 0.25s ease;
        }
        .plate__frame::after {
          content: "";
          position: absolute;
          inset: 3px;
          border: 1px solid rgba(169, 138, 78, 0.11);
        }
        .plate:hover .plate__frame { border-color: rgba(169, 138, 78, 0.6); }
        .plate__img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center 42%;
          transition: transform 0.6s cubic-bezier(0.2, 0.7, 0.3, 1);
        }
        .plate:hover .plate__img { transform: scale(1.06); }
        .plate__scrim {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 66%;
          background: linear-gradient(180deg, rgba(20, 18, 15, 0) 0%, rgba(20, 18, 15, 0.55) 62%, rgba(20, 18, 15, 0.8) 100%);
          pointer-events: none;
        }
        .plate__ix {
          position: relative;
          font-family: ${ST.label};
          font-size: 7.5px;
          letter-spacing: 0.24em;
          color: #B49A63;
        }
        .plate__art {
          position: relative;
          /* min-height: 0 is what lets the DRAWING give way when a long shelf
             name wraps. Without it the flex item floors at the svg's own
             height, the column grows past the square, and overflow:hidden
             cuts the count off the bottom — which is what every plate did at
             1024 before this line. */
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2px 0 6px;
        }
        .plate__art svg {
          width: 58%;
          max-width: 88px;
          max-height: 100%;
          transition: transform 0.3s ease;
        }
        .plate:hover .plate__art svg { transform: scale(1.07); }
        .plate__rule {
          position: relative;
          display: block;
          height: 1px;
          margin-bottom: 6px;
          background: rgba(169, 138, 78, 0.45);
          transition: background 0.25s ease;
        }
        .plate:hover .plate__rule { background: ${S.gold}; }
        /* Two lines, hard. An admin can name a shelf anything, and a third
           line has nowhere to go inside a square. */
        .plate__name {
          position: relative;
          font-family: ${ST.display};
          font-size: 15px;
          line-height: 1.14;
          color: ${S.ink};
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .plate__count {
          position: relative;
          display: block;
          margin-top: 3px;
          font-family: ${ST.label};
          font-size: 7px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: ${S.goldInk};
        }
        /* The photographed face. Same frame, same places, inverted ink. */
        .plate--photo { background: ${S.paper3}; border-color: #C9BCA4; }
        .plate--photo .plate__frame { border-color: rgba(246, 242, 233, 0.32); }
        .plate--photo .plate__frame::after { border-color: rgba(246, 242, 233, 0.12); }
        .plate--photo:hover .plate__frame { border-color: rgba(246, 242, 233, 0.6); }
        .plate--photo .plate__ix { color: rgba(246, 242, 233, 0.7); }
        .plate--photo .plate__rule { background: rgba(216, 190, 134, 0.75); }
        .plate--photo:hover .plate__rule { background: #D8BE86; }
        .plate--photo .plate__name { color: ${S.ivory}; }
        .plate--photo .plate__count { color: #DCC391; }

        /* ── the shelf index ── */
        .shop-index { margin-top: 26px; border-top: 1px solid ${S.border}; border-bottom: 1px solid ${S.border}; }
        .shop-index__list {
          list-style: none;
          margin: 0 auto;
          display: flex;
          align-items: center;
          overflow-x: auto;
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .shop-index__list::-webkit-scrollbar { display: none; }
        .shop-index__list > li { flex: 0 0 auto; position: relative; }
        /* A short hairline between entries, not a full-height divider — a
           border-left on the item would draw the whole 48px. */
        .shop-index__list > li + li::before {
          content: "";
          position: absolute;
          left: 0;
          top: 50%;
          width: 1px;
          height: 17px;
          margin-top: -8px;
          background: ${S.border};
        }
        .shelf {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          /* 48, not 34: this is the only navigation on a category page and it
             is used with a thumb. */
          min-height: 48px;
          padding: 0 14px;
          white-space: nowrap;
          text-decoration: none;
        }
        /* THE MARK HOLDS EITHER FACE, AT ONE SIZE AND ONE POSITION.
           A collection with a cover shows the cover; one without keeps its
           line drawing. Nothing swaps between the two on selection — the
           strip used to redraw the chosen shelf as a different shape, which
           read as losing the thing you had just clicked.
           22px for the photograph and 16 for the drawing: a 16px crop of a
           photograph is mud, while the drawings were designed at that size
           (see markFor in shopTheme.js) and grow blunt any larger. */
        .shelf__mark { flex: none; display: flex; align-items: center; justify-content: center; }
        .shelf__mark--art { width: 16px; height: 16px; }
        .shelf__mark--art svg { width: 100%; height: 100%; }
        .shelf__mark--photo {
          width: 22px;
          height: 22px;
          overflow: hidden;
          border-radius: 2px;
          box-shadow: 0 0 0 1px ${S.border};
        }
        .shelf__mark--photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
        /* The selected shelf's picture gains the gold hairline the rest of the
           strip only has in type. It stays a photograph either way. */
        .shelf--on .shelf__mark--photo { box-shadow: 0 0 0 1px ${S.gold}; }
        .shelf__name { font-family: ${ST.display}; font-size: 15px; color: ${S.inkSoft}; }
        .shelf__count {
          align-self: flex-start;
          margin-top: 13px;
          font-family: ${ST.label};
          font-size: 7.5px;
          letter-spacing: 0.14em;
          color: ${S.gold};
        }
        .shelf:hover .shelf__name { color: ${S.ink}; }
        .shelf--on .shelf__name { color: ${S.ink}; }
        .shelf--on .shelf__count { color: ${S.goldInk}; }
        .shelf--on::after {
          content: "";
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 0;
          height: 2px;
          background: ${S.gold};
        }

        .shop-body { padding: 26px 0 60px; }
        .shop-split { display: block; }

        /* ── the bar ── */
        .shop-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          padding-bottom: 12px;
          border-bottom: 1px solid ${S.border};
        }
        .shop-filterbtn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-height: 44px;
          padding: 0 16px;
          background: ${S.paper};
          border: 1px solid ${S.ink};
          color: ${S.ink};
          font-family: ${ST.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .shop-pill {
          background: ${S.ink};
          color: ${S.paper};
          border-radius: 999px;
          padding: 1px 6px;
          font-size: 10px;
        }
        .shop-count { font-size: 11.5px; color: ${S.inkSoft}; }
        .shop-count strong { color: ${S.ink}; font-weight: 600; }
        .shop-sort { display: inline-flex; align-items: center; gap: 7px; margin-left: auto; }
        .shop-sort__label {
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: ${S.inkSoft};
        }
        .shop-sort select {
          min-height: 44px;
          /* 16px: iOS zooms the whole page in on focus for anything smaller,
             and it never zooms back out. */
          font-size: 16px;
          font-family: ${ST.body};
          color: ${S.ink};
          background: ${S.paper};
          border: 1px solid ${S.border};
          padding: 0 8px;
          border-radius: 0;
        }

        /* ── filters ──────────────────────────────────────────────────────
           Rebuilt 2026-08-21. It was a heading and three stacks of native
           checkboxes: functional, and indistinguishable from a form. Three
           things changed, and only the first is decoration.

           1. THE COLLECTIONS ARE IN IT. The panel named the ways to narrow a
              list and omitted the main one, which lives one strip away at the
              top of the page. It carries each collection's cover photograph,
              so a shelf is recognised the same way here as on its plate.
           2. A DRAWN TICK BOX. accent-color paints a native box in the brand
              gold and leaves its SHAPE and metrics to the platform, so the
              panel looked like macOS on macOS and like Windows on Windows.
              The input is still the input — it is visually hidden, not
              replaced, so the label, the keyboard and the focus ring are the
              browser's.
           3. ROWS THAT ANSWER. Hover, checked and empty are three distinct
              states; before, an unavailable row differed only by opacity. */
        .shop-aside { display: none; }
        .shop-aside.is-open { display: block; margin: 16px 0 4px; }
        .sf {
          border: 1px solid ${S.border};
          background: ${S.paper};
          padding: 16px 16px 6px;
        }
        .sf-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          padding-bottom: 12px;
          border-bottom: 1px solid ${S.ink};
        }
        .sf-title {
          font-family: ${ST.display};
          font-size: 20px;
          letter-spacing: -0.01em;
          color: ${S.ink};
        }
        .sf-clear {
          background: none;
          border: 0;
          border-bottom: 1px solid ${S.gold};
          padding: 0 0 3px;
          cursor: pointer;
          font-family: ${ST.body};
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: ${S.goldInk};
        }
        .sf-clear:hover { color: ${S.ink}; border-bottom-color: ${S.ink}; }

        .sf-group { padding: 15px 0 13px; border-top: 1px solid ${S.border}; }
        .sf-group:first-of-type { border-top: 0; }
        .sf-legend {
          display: flex;
          align-items: center;
          gap: 9px;
          font-family: ${ST.label};
          font-size: 9px;
          letter-spacing: 0.26em;
          text-transform: uppercase;
          color: ${S.goldInk};
          margin-bottom: 9px;
        }
        .sf-legend::after {
          content: "";
          flex: 1 1 auto;
          height: 1px;
          background: ${S.border};
        }

        /* ── collections: links, not tick boxes ── */
        .sf-cats { list-style: none; margin: 0; padding: 0; }
        .sf-cat {
          display: flex;
          align-items: center;
          gap: 11px;
          /* 44: this is a navigation control on a phone. */
          min-height: 46px;
          padding: 5px 8px 5px 6px;
          margin-inline: -6px;
          text-decoration: none;
          border: 1px solid transparent;
          transition: background 0.2s ease, border-color 0.2s ease;
        }
        .sf-cat:hover { background: ${S.paper2}; }
        .sf-cat.is-on { background: ${S.paper2}; border-color: ${S.border}; }
        .sf-cat__art {
          flex: none;
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: ${S.paper2};
          box-shadow: 0 0 0 1px ${S.border};
        }
        .sf-cat__art img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .sf-cat__art svg { width: 19px; height: 19px; opacity: 0.75; }
        .sf-cat__art--all { background: ${S.paper}; }
        .sf-cat.is-on .sf-cat__art { box-shadow: 0 0 0 1px ${S.gold}; }
        .sf-cat__name {
          flex: 1 1 auto;
          min-width: 0;
          font-family: ${ST.display};
          font-size: 15px;
          line-height: 1.25;
          color: ${S.inkSoft};
          /* WRAPS TO TWO LINES RATHER THAN TRUNCATING TO ONE.
             The sidebar is ~180px of usable width and these names are real
             ones an admin types: measured at 1280, "Screens & displays",
             "Scanners & door kit", "Printed materials" and "Envelopes &
             extras" ALL ellipsised — four of six collections identified by a
             fragment. A truncated name is not a name, and this is the panel
             where somebody is deciding which shelf to open. */
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .sf-cat:hover .sf-cat__name,
        .sf-cat.is-on .sf-cat__name { color: ${S.ink}; }
        .sf-cat__count {
          flex: none;
          font-family: ${ST.label};
          font-size: 9px;
          letter-spacing: 0.14em;
          color: ${S.gold};
        }
        .sf-cat.is-on .sf-cat__count { color: ${S.goldInk}; }

        /* ── tick rows ── */
        .sf-row {
          display: flex;
          align-items: center;
          gap: 11px;
          min-height: 38px;
          padding-inline: 6px;
          margin-inline: -6px;
          cursor: pointer;
          transition: background 0.2s ease;
        }
        .sf-row:hover { background: ${S.paper2}; }
        .sf-row--empty { opacity: 0.38; cursor: default; }
        .sf-row--empty:hover { background: transparent; }
        /* VISUALLY HIDDEN, NOT display:none and not replaced. The input keeps
           the label association, the space bar, and the focus ring; only its
           painted box is swapped for .sf-box below. */
        .sf-row input {
          position: absolute;
          width: 1px;
          height: 1px;
          opacity: 0;
          /* NO pointer-events: none. It is tempting on a 1px invisible box and
             it is wrong twice: the input is inside its own <label>, so a click
             anywhere on the row already reaches it, and switching pointer
             events off makes the control unclickable to anything driving the
             element directly — assistive tooling and the test suite included.
             Hiding a control must not disable it. */
        }
        .sf-box {
          flex: none;
          position: relative;
          width: 15px;
          height: 15px;
          border: 1px solid ${S.border};
          background: ${S.paper};
          transition: border-color 0.18s ease, background 0.18s ease;
        }
        .sf-row:hover .sf-box { border-color: ${S.gold}; }
        .sf-box::after {
          content: "";
          position: absolute;
          left: 4px;
          top: 1px;
          width: 4px;
          height: 8px;
          border: solid ${S.paper};
          border-width: 0 1.5px 1.5px 0;
          transform: rotate(45deg) scale(0.5);
          opacity: 0;
          transition: opacity 0.18s ease, transform 0.18s ease;
        }
        .sf-row input:checked ~ .sf-box {
          background: ${S.goldInk};
          border-color: ${S.goldInk};
        }
        .sf-row input:checked ~ .sf-box::after { opacity: 1; transform: rotate(45deg) scale(1); }
        /* The ring the hidden input can no longer show for itself. :focus-visible
           so it appears for the keyboard and not on a tap. */
        .sf-row input:focus-visible ~ .sf-box {
          outline: 2px solid ${S.gold};
          outline-offset: 2px;
        }
        .sf-label {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 12.5px;
          color: ${S.ink};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sf-count {
          flex: none;
          font-size: 11px;
          color: ${S.inkSoft};
          opacity: 0.7;
          /* Lining figures so a column of counts lines up rather than
             jittering by digit. */
          font-variant-numeric: tabular-nums;
        }

        /* ── the grid ──
           --fx-col is declared HERE and never inline, so the desktop step
           below can actually reach it. Two cards across a 390px phone at
           150px, unchanged; the 1024 rule is what shrinks the desktop card. */
        .shop-grid {
          list-style: none;
          margin: 16px 0 0;
          padding: 0;
          --fx-col: 150px;
          --fx-gap: 12px;
        }
        .shop-empty { margin: 26px 0 0; font-size: 14px; color: ${S.inkSoft}; }
        .shop-empty__clear {
          background: none;
          border: 0;
          border-bottom: 1px solid ${S.gold};
          padding: 0 0 2px;
          cursor: pointer;
          font: inherit;
          color: ${S.ink};
        }

        /* ── one card ── */
        .sp {
          display: flex;
          flex-direction: column;
          min-width: 0;
          height: 100%;
          background: ${S.paper};
          border: 1px solid ${S.border};
          transition: border-color 0.25s ease, box-shadow 0.25s ease;
        }
        .sp:hover { border-color: ${S.borderLift}; box-shadow: ${SHADOW.cardHover}; }
        .sp-media { position: relative; display: block; overflow: hidden; }
        .sp-img, .sp-art {
          display: block;
          width: 100%;
          aspect-ratio: 1 / 1;
          object-fit: cover;
          object-position: center 18%;
          transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.3, 1);
        }
        .sp:hover .sp-img { transform: scale(1.04); }
        .sp-art {
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${S.paper3};
        }
        .sp-art svg { width: 52%; }
        .sp-badge {
          position: absolute;
          top: 7px;
          left: 7px;
          z-index: 2;
          border: 1px solid ${S.border};
          padding: 3px 7px;
          font-size: 8px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .sp-badge--out { left: auto; right: 7px; background: ${S.ink}; color: ${S.ivory}; border-color: ${S.ink}; }

        .sp-body {
          display: flex;
          flex-direction: column;
          gap: 5px;
          padding: 10px;
          border-top: 1px solid ${S.border};
          flex: 1 1 auto;
        }
        /* Two lines, with a floor, so a wrapping title cannot make its card
           taller than its neighbours and knock the row's prices out of line. */
        .sp-title {
          font-family: ${ST.display};
          font-size: 15px;
          line-height: 1.22;
          color: ${S.ink};
          text-decoration: none;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: 37px;
        }
        .sp-title:hover { color: ${S.goldInk}; }
        .sp-spec {
          font-size: 9.5px;
          color: ${S.inkSoft};
          opacity: 0.8;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sp-price { display: flex; align-items: baseline; gap: 7px; margin-top: auto; padding-top: 4px; }
        .sp-amount { font-family: ${ST.display}; font-size: 19px; color: ${S.ink}; }
        .sp-amount--quote { font-size: 15px; }
        .sp-unit { font-size: 11px; color: ${S.inkSoft}; }
        .sp-was { font-size: 11px; color: ${S.inkSoft}; opacity: 0.65; text-decoration: line-through; }
        .sp-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding-top: 7px;
          border-top: 1px solid ${S.border};
        }
        .sp-moq {
          font-size: 9.5px;
          color: ${S.ink};
          background: ${S.paper2};
          border: 1px solid ${S.border};
          padding: 2px 6px;
          white-space: nowrap;
        }
        .sp-lead {
          font-size: 9.5px;
          color: ${S.inkSoft};
          opacity: 0.7;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* ── 768 and up ── */
        @media (min-width: 768px) {
          .shop-head { padding-top: 34px; }
          .shop-h1 { font-size: 46px; margin-top: 14px; }
          .shop-blurb { font-size: 16px; margin-top: 12px; }
          .shop-kicker { font-size: 10.5px; letter-spacing: 0.34em; gap: 14px; }
          .shop-kicker__rule { width: 38px; }
          .shop-cats { padding-top: 40px; }
          .shop-plates { margin-top: 18px; gap: 12px; }
          .plate { width: 168px; padding: 17px; }
          .plate__name { font-size: 16px; }
          .shop-index { margin-top: 30px; }
          .shelf { min-height: 52px; padding: 0 18px; }
          .shelf--on::after { left: 18px; right: 18px; }
          .shelf__name { font-size: 16px; }
          .shelf__mark { width: 17px; height: 17px; }
          .shelf__count { font-size: 8px; margin-top: 15px; }

          .shop-body { padding: 34px 0 84px; }
          .shop-split {
            display: grid;
            /* 200/32, down from 216/40: the 48px it frees is a sixth column
               in the grid beside it. */
            grid-template-columns: 200px minmax(0, 1fr);
            gap: 32px;
            align-items: start;
          }
          /* The panel is always visible beside the grid at this width, so the
             button that toggles it has nothing to do. */
          .shop-aside { display: block; }
          .shop-filterbtn { display: none; }
          .shop-grid { margin-top: 20px; --fx-col: 140px; --fx-gap: 14px; }
        }

        /* ── 1024 and up ──
           The plates stop scrolling and become the row. 140px is chosen so
           six of them fit from 1024 all the way up: at 1024 the container
           offers ~943px, which is 6 x 143 + 5 gaps, and at 1280 it offers
           1184, which is 6 x 184. A wider minimum would drop to five and
           leave the sixth shelf alone on a second row, which is what the old
           band did at every desktop width. */
        @media (min-width: 1024px) {
          .shop-plates {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
            gap: 16px;
            overflow: visible;
          }
          /* Fluid rather than a third breakpoint: a plate is 143px wide at
             1024 and 184px at 1280, and a name set for the wide end wraps to
             two lines at the narrow one. The clamps land on 14px/14px of
             padding at 1024 and 17px/18px at 1280, which keeps every shelf
             name in this catalogue on one line at both ends. */
          .plate { width: auto; padding: clamp(14px, 1.4vw, 19px); }
          .plate__ix { font-size: 8px; }
          .plate__name { font-size: clamp(14px, 1.32vw, 17px); }
          .plate__count { font-size: 8px; letter-spacing: 0.2em; }
        }

        @media (prefers-reduced-motion: reduce) {
          .sp, .sp-img, .plate, .plate__img, .plate__art svg, .plate__rule, .plate__frame { transition: none; }
          .plate:hover .plate__img, .plate:hover .plate__art svg { transform: none; }
        }
      `}</style>
    </main>
  );
}
