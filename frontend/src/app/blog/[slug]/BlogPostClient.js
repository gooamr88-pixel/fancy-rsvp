'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import BlogContent from '../BlogContent';
import { assetUrl, assetSrcSet } from '../../utils/assetUrl';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof window === 'undefined') return;
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1.5px solid #E8E2D6',
        background: '#FFFFFF', borderRadius: '8px', padding: '9px 16px', fontFamily: 'var(--font-sans)',
        fontSize: '13px', fontWeight: 700, color: copied ? '#3B9B6D' : '#191B1E', cursor: 'pointer',
      }}
    >
      {copied ? '✓ Link Copied' : 'Share Article'}
    </button>
  );
}

export default function BlogPostClient({ post }) {
  return (
    <main style={{ paddingTop: '78px' }}>
      <article
        className="post-article fx-container fx-container--lg fx-gutter"
        style={{
          '--fx-pad-x': 'clamp(16px, 0.333rem + 2.5vw, 24px)',
          paddingTop: 'clamp(32px, 1.667rem + 3.333vw, 64px)',
          paddingBottom: 'clamp(64px, 3.333rem + 3.75vw, 100px)',
        }}
      >
        <Link href="/blog" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700, color: '#B8944F', textDecoration: 'none', marginBottom: '32px' }}>
          ← Back to Blog
        </Link>

        {post.category && (
          <span style={{
            display: 'inline-block', background: 'rgba(184,148,79,0.1)', color: '#B8944F', fontFamily: 'var(--font-sans)',
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', padding: '5px 12px', borderRadius: '20px',
            textTransform: 'uppercase', marginBottom: '20px',
          }}>
            {post.category}
          </span>
        )}

        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(2rem, 4.5vw, 3rem)', fontWeight: 700, color: '#191B1E', lineHeight: 1.15, marginBottom: '24px', overflowWrap: 'break-word' }}>
          {post.title}
        </h1>

        <div className="post-meta" style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', paddingBottom: '32px', marginBottom: '40px', borderBottom: '1px solid #E8E2D6' }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 700, color: '#191B1E', overflowWrap: 'anywhere' }}>{post.author_name}</span>
          <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#D7BE80', flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: '#5E5A52' }}>{formatDate(post.published_at)}</span>
          {post.read_time_minutes && (
            <>
              <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#D7BE80', flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: '#5E5A52' }}>{post.read_time_minutes} min read</span>
            </>
          )}
          {/* marginLeft:auto only makes sense while this shares a line with the meta;
              once the row wraps on a phone it becomes its own full-width line. */}
          <span className="post-share">
            <CopyLinkButton />
          </span>
        </div>

        {post.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="post-cover"
            src={assetUrl(post.cover_image_url, 'hero')}
            srcSet={assetSrcSet(post.cover_image_url)}
            sizes="(max-width: 800px) 100vw, 760px"
            decoding="async"
            alt=""
            style={{ width: '100%', maxHeight: '440px', objectFit: 'cover', borderRadius: '16px', marginBottom: '48px' }}
          />
        )}

        <BlogContent content={post.content} />

        <div style={{ marginTop: '56px', paddingTop: '32px', borderTop: '1px solid #E8E2D6', textAlign: 'center' }}>
          <Link
            href="/blog"
            className="btn-gold"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 28px', fontSize: '14px', fontWeight: 700, borderRadius: '8px', textDecoration: 'none' }}
          >
            ← More Articles
          </Link>
        </div>
      </article>

      <style jsx>{`
        .post-share { margin-left: auto; }

        /* .post-article's two padding overrides (40px/20px at 640, 32px/16px
           at an off-scale 420) are gone — the padding is fluid on the element
           now, interpolating 16→24px horizontally and 32→64px on top across
           the same range, and .fx-gutter adds the landscape safe-area inset
           the !important shorthands were discarding. */
        @media (max-width: 639.98px) {
          .post-cover { max-height: 260px !important; margin-bottom: 32px !important; }
          .post-meta { padding-bottom: 24px !important; margin-bottom: 32px !important; gap: 10px !important; }
          /* Once the meta row wraps, a right-shoved share button reads as a stray
             orphan — give it its own full-width line instead. */
          .post-share { margin-left: 0 !important; width: 100%; margin-top: 6px; }
        }
      `}</style>
    </main>
  );
}
