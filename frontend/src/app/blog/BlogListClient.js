'use client';
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import GoldDivider from '../components/GoldDivider';
import { assetUrl, assetSrcSet } from '../utils/assetUrl';

/* ═══════════════════════════════════════════════════════════
   Blog Listing — Fancy RSVP
   Real, admin-authored posts only (see admin/(panel)/cms).
   Hero + Featured article + Category filter + Grid + Newsletter
   ═══════════════════════════════════════════════════════════ */

const FALLBACK_CATEGORY_COLORS = [
  { bg: 'rgba(184,148,79,0.1)', text: '#B8944F' },
  { bg: 'rgba(94,90,82,0.08)', text: '#5E5A52' },
  { bg: 'rgba(25,27,30,0.06)', text: '#191B1E' },
  { bg: 'rgba(215,190,128,0.15)', text: '#a07f3f' },
];

function colorForCategory(category, allCategories) {
  const idx = Math.max(0, allCategories.indexOf(category));
  return FALLBACK_CATEGORY_COLORS[idx % FALLBACK_CATEGORY_COLORS.length];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function PlaceholderArt() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ opacity: 0.25 }}>
      <rect x="8" y="12" width="48" height="40" rx="4" stroke="#B8944F" strokeWidth="1.5" />
      <path d="M8 18L32 36L56 18" stroke="#B8944F" strokeWidth="1.5" />
      <line x1="8" y1="16" x2="56" y2="16" stroke="#E8E2D6" strokeWidth="1" />
    </svg>
  );
}

function ArticleCard({ article, colors }) {
  return (
    <div className="article-card" style={{ background: '#FFFFFF', borderRadius: '16px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Link href={`/blog/${article.slug}`} style={{ textDecoration: 'none' }} aria-label={article.title}>
        <div style={{
          height: '180px',
          background: article.cover_image_url ? undefined : `linear-gradient(135deg, #F8F4EC 0%, #FFFFFF 50%, ${colors.bg} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden',
        }}>
          {article.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={assetUrl(article.cover_image_url, 'card')}
              srcSet={assetSrcSet(article.cover_image_url, [400, 800])}
              sizes="(max-width: 700px) 92vw, 360px"
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <PlaceholderArt />
          )}
          {article.category && (
            <span style={{
              position: 'absolute', top: '16px', left: '16px', background: colors.bg, color: colors.text,
              fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px',
              padding: '5px 12px', borderRadius: '20px', textTransform: 'uppercase',
            }}>
              {article.category}
            </span>
          )}
        </div>
      </Link>

      <div style={{ padding: '28px 24px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* overflowWrap is inline (not in the scoped block) so an arbitrarily long
            admin-authored title/word can never blow out the card, regardless of
            styled-jsx scoping. */}
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '19px', fontWeight: 600, color: '#191B1E', lineHeight: 1.35, marginBottom: '12px', overflowWrap: 'break-word' }}>
          <Link href={`/blog/${article.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>{article.title}</Link>
        </h3>
        {article.excerpt && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: '#5E5A52', lineHeight: 1.7, marginBottom: '20px', flex: 1, overflowWrap: 'break-word' }}>
            {article.excerpt}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F0ECE4', paddingTop: '16px' }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: '#5E5A52' }}>{formatDate(article.published_at)}</span>
          {article.read_time_minutes && (
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 600, color: '#B8944F' }}>{article.read_time_minutes} min read</span>
          )}
        </div>
        <Link
          href={`/blog/${article.slug}`}
          aria-label={`Read full article: ${article.title}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700, color: '#B8944F', textDecoration: 'none', marginTop: '16px' }}
        >
          Read Full Article →
        </Link>
      </div>

      <style jsx>{`
        .article-card { border: 1px solid #E8E2D6; transition: all 0.35s ease; transform: translateY(0); box-shadow: 0 2px 12px rgba(0,0,0,0.03); }
        .article-card:hover, .article-card:focus-within { border-color: #D7BE80; transform: translateY(-6px); box-shadow: 0 16px 48px rgba(184,148,79,0.12); }
      `}</style>
    </div>
  );
}

export default function BlogListClient({ posts = [] }) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [emailValue, setEmailValue] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribeError, setSubscribeError] = useState('');

  const categories = useMemo(() => {
    const real = [...new Set(posts.map((p) => p.category).filter(Boolean))];
    return ['All', ...real];
  }, [posts]);

  const featured = activeCategory === 'All' ? posts[0] : null;
  const gridArticles = useMemo(() => {
    if (activeCategory === 'All') return posts.slice(1);
    return posts.filter((p) => p.category === activeCategory);
  }, [posts, activeCategory]);

  const handleSubscribe = async () => {
    if (subscribing || subscribed || !emailValue || !emailValue.includes('@')) return;
    setSubscribing(true);
    setSubscribeError('');
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
      const res = await fetch(`${apiUrl}/public/newsletter-subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue, source: 'blog' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Subscription failed. Please try again.');
      setSubscribed(true);
      setEmailValue('');
    } catch (err) {
      setSubscribeError(err.message || 'Subscription failed. Please try again.');
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <main style={{ paddingTop: '78px' }}>
      {/* ════════════ HERO ════════════ */}
      <section className="blog-hero fx-section fx-section--tight-bottom" style={{ background: 'linear-gradient(180deg, #F8F4EC 0%, #FFFFFF 100%)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-100px', left: '50%', transform: 'translateX(-50%)', width: '700px', height: '700px', borderRadius: '50%', border: '1px solid rgba(184,148,79,0.06)', pointerEvents: 'none' }} />
        <div className="fx-container fx-container--lg" style={{ position: 'relative', zIndex: 1 }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: '#B8944F', marginBottom: '20px' }}>
            Stories & Insights
          </p>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(2.4rem, 5vw, 3.8rem)', fontWeight: 700, color: '#191B1E', marginBottom: '20px', lineHeight: 1.1 }}>
            The Fancy Blog
          </h1>
          <p className="blog-hero-sub" style={{ fontFamily: 'var(--font-sans)', fontSize: '19px', color: '#5E5A52', lineHeight: 1.75 }}>
            Tips, trends, and inspiration for elegant events
          </p>
        </div>
      </section>

      {posts.length === 0 ? (
        <section className="blog-empty-section fx-section fx-section--xs" style={{ paddingBottom: 'var(--fx-pad-y-lg)', background: '#FFFFFF', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '16px', color: '#5E5A52' }}>
            No articles published yet. Check back soon!
          </p>
        </section>
      ) : (
        <>
          {/* ════════════ FEATURED ════════════ */}
          {featured && (
            <section className="blog-featured-section fx-section fx-section--xs" style={{ paddingBottom: 'var(--fx-pad-y-sm)', background: '#FFFFFF' }}>
              <div className="fx-container fx-container--5xl">
                <Link href={`/blog/${featured.slug}`} style={{ textDecoration: 'none' }}>
                  <div className="featured-grid" style={{ borderRadius: '20px', overflow: 'hidden', background: 'linear-gradient(135deg, #191B1E 0%, #2a2d32 60%, #3a3226 100%)', display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '400px', position: 'relative' }}>
                    {/* minHeight matters once this stacks on mobile: the cover <img>
                        is absolutely positioned and so contributes no height of its
                        own — without it the media cell would collapse to just its
                        padding (~96px) and crop the image to a sliver. */}
                    <div className="featured-media" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px', position: 'relative', minHeight: '220px' }}>
                      {featured.cover_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={assetUrl(featured.cover_image_url, 'hero')}
                          srcSet={assetSrcSet(featured.cover_image_url)}
                          sizes="(max-width: 900px) 100vw, 900px"
                          alt=""
                          decoding="async"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0, opacity: 0.5 }}
                        />
                      ) : (
                        <svg width="220" height="220" viewBox="0 0 220 220" fill="none">
                          <circle cx="110" cy="110" r="100" stroke="rgba(184,148,79,0.15)" strokeWidth="1" />
                          <circle cx="110" cy="110" r="70" stroke="rgba(184,148,79,0.1)" strokeWidth="1" />
                          <rect x="60" y="80" width="100" height="70" rx="6" stroke="#B8944F" strokeWidth="1.5" fill="none" opacity="0.6" />
                          <path d="M60 86L110 122L160 86" stroke="#B8944F" strokeWidth="1.5" fill="none" opacity="0.6" />
                          <text x="110" y="60" textAnchor="middle" fill="#D7BE80" fontSize="14" fontFamily="serif" fontWeight="600" letterSpacing="2" opacity="0.5">FEATURED</text>
                        </svg>
                      )}
                    </div>
                    <div className="featured-content" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '56px 56px 56px 0', position: 'relative', zIndex: 1 }}>
                      {featured.category && (
                        <span style={{ display: 'inline-block', background: 'rgba(184,148,79,0.15)', color: '#D7BE80', fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', padding: '5px 14px', borderRadius: '20px', textTransform: 'uppercase', marginBottom: '20px', alignSelf: 'flex-start' }}>
                          {featured.category}
                        </span>
                      )}
                      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(1.4rem, 2.5vw, 2rem)', fontWeight: 600, color: '#FFFFFF', lineHeight: 1.3, marginBottom: '16px', overflowWrap: 'break-word' }}>
                        {featured.title}
                      </h2>
                      {featured.excerpt && (
                        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '15px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, marginBottom: '28px', overflowWrap: 'break-word' }}>
                          {featured.excerpt}
                        </p>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'rgba(255,255,255,0.55)' }}>{formatDate(featured.published_at)}</span>
                        {featured.read_time_minutes && (
                          <>
                            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
                            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: '#D7BE80', fontWeight: 600 }}>{featured.read_time_minutes} min read</span>
                          </>
                        )}
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 700, color: '#B8944F', marginTop: '24px', padding: '12px 28px', borderRadius: '8px', border: '1.5px solid rgba(184,148,79,0.4)', alignSelf: 'flex-start' }}>
                        Read More →
                      </span>
                    </div>
                  </div>
                </Link>
              </div>
            </section>
          )}

          {/* ════════════ FILTERS + GRID ════════════ */}
          <section className="blog-grid-section fx-section fx-section--flush-top" style={{ background: '#FFFFFF' }}>
            <div className="fx-container fx-container--5xl">
              {categories.length > 1 && (
                <div style={{ display: 'flex', gap: '10px', marginBottom: '48px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      style={{
                        fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: activeCategory === cat ? 700 : 500,
                        color: activeCategory === cat ? '#FFFFFF' : '#5E5A52',
                        background: activeCategory === cat ? 'linear-gradient(135deg, #B8944F 0%, #D7BE80 100%)' : '#F8F4EC',
                        border: 'none', padding: '10px 22px', borderRadius: '24px', cursor: 'pointer', transition: 'all 0.25s ease', letterSpacing: '0.3px',
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {gridArticles.length > 0 ? (
                <div className="articles-grid fx-grid fx-grid--3" style={{ '--fx-gap': '28px' }}>
                  {gridArticles.map((article) => (
                    <ArticleCard key={article.id} article={article} colors={colorForCategory(article.category, categories)} />
                  ))}
                </div>
              ) : featured ? null : (
                // Only a genuinely empty result gets the empty state. With exactly ONE
                // published post, that post IS the featured hero above and the grid is
                // legitimately empty — showing "No articles..." underneath it would
                // flatly contradict the article the visitor is looking at.
                <div style={{ textAlign: 'center', padding: '80px 0' }}>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: '16px', color: '#5E5A52' }}>
                    No articles in this category yet. Check back soon!
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* ════════════ NEWSLETTER ════════════ */}
      <section className="blog-newsletter-section fx-section" style={{ background: 'linear-gradient(135deg, #F8F4EC 0%, #FFF 100%)' }}>
        <div className="fx-container fx-container--lg" style={{ textAlign: 'center' }}>
          <GoldDivider />
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', fontWeight: 600, color: '#191B1E', marginTop: '8px', marginBottom: '16px' }}>
            Stay Inspired
          </h2>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '17px', color: '#5E5A52', lineHeight: 1.7, marginBottom: '36px' }}>
            Get our best articles, event tips, and product updates delivered straight to your inbox. No spam, just inspiration.
          </p>
          {subscribed ? (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '15px', color: '#3B9B6D', fontWeight: 700 }}>✓ You&apos;re subscribed — thank you!</p>
          ) : (
            <>
              <div className="newsletter-form fx-container fx-container--xs" style={{ display: 'flex', gap: '12px' }}>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Enter your email"
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubscribe(); }}
                  style={{
                    flex: 1, minWidth: 0, padding: '15px 20px', borderRadius: '10px',
                    border: `1.5px solid ${emailFocused ? '#B8944F' : '#E8E2D6'}`, background: '#FFFFFF',
                    fontFamily: 'var(--font-sans)', fontSize: '15px', color: '#191B1E', outline: 'none', transition: 'border-color 0.25s ease',
                  }}
                />
                <button
                  className="btn-gold"
                  onClick={handleSubscribe}
                  disabled={subscribing}
                  style={{ padding: '15px 32px', fontSize: '14px', borderRadius: '10px', whiteSpace: 'nowrap', opacity: subscribing ? 0.7 : 1, cursor: subscribing ? 'default' : 'pointer' }}
                >
                  {subscribing ? 'Subscribing…' : 'Subscribe'}
                </button>
              </div>
              {subscribeError && (
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: '#C45E5E', marginTop: '12px' }}>{subscribeError}</p>
              )}
            </>
          )}
        </div>
      </section>

      <style jsx>{`
        /* The two hand-rolled padding tiers that used to be here — an
           off-scale 900px stage and a 480px one, ten !important overrides
           between them, all working around the same hard 48px side padding
           on five sections — are gone. .fx-section makes the gutter fluid
           (48px at 1280 down to 20px at 320) with no breakpoint at all, and
           adds the landscape safe-area inset those rules never had. The
           .articles-grid column queries go too: .fx-grid--3 steps 3→2→1
           on its own. */
        @media (max-width: 767.98px) {
          .featured-grid { grid-template-columns: 1fr !important; }
          .featured-media { padding: 32px !important; min-height: 200px !important; }
          .featured-content { padding: 32px 32px 40px 32px !important; }
        }
        @media (max-width: 639.98px) {
          .newsletter-form { flex-direction: column !important; }
          .blog-hero-sub { font-size: 16px !important; }
        }
        /* The five section paddings that were also in this block are gone
           for the same reason as the 900px tier above — left in place they
           would have won on !important below 480px and thrown away
           .fx-section's max(--fx-pad-x, --fx-safe-l), silently removing the
           landscape notch gutter while portrait looked perfect. Folded from
           480px onto the < sm step; only the featured card's own internal
           padding still needs a breakpoint. */
        @media (max-width: 639.98px) {
          .featured-media { padding: 24px !important; min-height: 170px !important; }
          .featured-content { padding: 24px 24px 32px 24px !important; }
        }
      `}</style>
    </main>
  );
}
