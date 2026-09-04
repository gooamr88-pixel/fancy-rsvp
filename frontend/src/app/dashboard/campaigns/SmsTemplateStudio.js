'use client';

/* `React` is imported and it is NOT unused — vitest compiles this file with the
   classic JSX runtime. See SmsConsentText.js for the full note. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../../utils/toast';
import { computeSmsSegments, renderTemplate } from '../../utils/smsSegments';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MESSAGE EDITOR — organizer-authored SMS bodies.
 *
 * Every text this platform sends used to be ours: an organizer could switch a
 * type on or off and nothing else. This lets them write their own words, in
 * English and Arabic, for each of the five types.
 *
 * ── The design problem, and what it turns on ──
 *
 * A text message is priced per SEGMENT, and the organizer cannot see segments.
 * They see a sentence. So the entire job of this screen is to make an invisible
 * cost visible while they are creating it, rather than on an invoice afterwards:
 *
 *   • the price is quoted at the WORST case, never at the sample. A body
 *     previewed against "Sara" is one segment and bills three for a guest
 *     called Abdulrahman Al-Otaibi. Every figure here comes from the server,
 *     measured with every tag at its clip ceiling.
 *   • the compliance footer is rendered INSIDE the preview bubble, greyed,
 *     because it is 78 characters the organizer is paying for on every message
 *     and cannot remove. Hiding it would make every body look shorter than it
 *     is billed.
 *   • Arabic is shown as its own editor with its own count, because it forces
 *     UCS-2 — 67 units per segment against GSM-7's 153 — and a body that is
 *     comfortable in English is routinely double in Arabic.
 *
 * ── Why there is no <style jsx> here ──
 *
 * styled-jsx scopes rules to the component that declares them, and this file
 * has several nested components; a scoped block inside one of those does not
 * reliably compile in this build. Inline styles and the global .fx-* utilities
 * only (frontend/AGENTS.md).
 *
 * ── Layout ──
 *
 * Editor and preview sit side by side on a desktop and stack on a phone, via
 * `.fx-grid` — NOT `repeat(2, 1fr)`, which per AGENTS.md cannot fit 320px.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const C = {
  gold: '#B8944F',
  goldDark: '#9A7B3F',
  charcoal: '#191B1E',
  ivory: '#F8F4EC',
  ink: '#4A4742',
  stone: '#77736A',
  border: '#E8E2D6',
  softBg: '#FAFAF8',
  white: '#FFFFFF',
  success: '#3B9B6D',
  error: '#C45E5E',
  amber: '#B8894F',
};

const LANGS = [
  { key: 'en', label: 'English', dir: 'ltr' },
  { key: 'ar', label: 'العربية', dir: 'rtl' },
];

/**
 * Segment cost bar.
 *
 * Reports the SERVER's measurement when it has one (`measured`), and falls back
 * to a local estimate while the organizer is mid-keystroke. The two can differ
 * by a segment, and the difference is the point: the local number measures what
 * is on screen, the server's measures the worst case. The label says which.
 */
function CostMeter({ measured, live, limit }) {
  const segments = measured?.segments ?? live.segments;
  const encoding = measured?.encoding ?? live.encoding;
  const over = segments > limit;

  const tone = over ? C.error : segments > Math.max(1, limit - 2) ? C.amber : C.stone;

  return (
    <div
      className="fx-row"
      style={{
        gap: 10, alignItems: 'center', justifyContent: 'space-between',
        marginTop: 8, fontFamily: 'var(--font-sans)', fontSize: 12, color: tone,
      }}
    >
      <span>
        <strong style={{ color: over ? C.error : C.charcoal }}>
          {segments} {segments === 1 ? 'text' : 'texts'}
        </strong>
        {' '}per guest{measured ? ' at longest' : ' as written'}
      </span>
      <span
        // The encoding is the single most surprising cost driver here: one
        // Arabic character, or one curly quote, drops a message from 153 units
        // per segment to 67. Naming it turns "why did this get expensive?"
        // into something the organizer can act on.
        title={encoding === 'GSM-7'
          ? 'Standard characters — 153 per text'
          : 'Arabic or special characters — only 67 per text'}
        style={{
          // var(--fx-micro), not a literal 10.5px: the dashboard's reading-floor
          // tokens resolve LARGER as the viewport narrows, and this pill is read
          // on a phone by somebody deciding whether a message is affordable.
          padding: '2px 8px', borderRadius: 999, fontSize: 'var(--fx-micro)', fontWeight: 700,
          letterSpacing: '0.06em', background: C.softBg, border: `1px solid ${C.border}`,
          color: encoding === 'GSM-7' ? C.stone : C.amber, whiteSpace: 'nowrap',
        }}
      >
        {encoding}
      </span>
    </div>
  );
}

/** The phone-shaped preview. The footer is rendered but visibly not the organizer's. */
function Preview({ body, footer, dir }) {
  return (
    <div style={{
      background: C.charcoal, borderRadius: 18, padding: '18px 14px',
      minHeight: 150, display: 'flex', alignItems: 'flex-start',
    }}>
      <div
        dir={dir}
        className="fx-break"
        style={{
          background: '#2C2F34', color: '#F3F1EC',
          borderRadius: 16, padding: '11px 14px',
          fontFamily: 'var(--font-sans)', fontSize: 13.5, lineHeight: 1.55,
          maxWidth: '92%', whiteSpace: 'pre-wrap',
        }}
      >
        {body || <span style={{ opacity: 0.4 }}>Your message will appear here.</span>}
        {/* Dimmed, not hidden. It is 78 characters the organizer pays for on
            every single message and is not allowed to remove, so it has to be
            in the bubble they are judging the length of. */}
        <span style={{ opacity: 0.45 }}>{footer}</span>
      </div>
    </div>
  );
}

/** One clickable merge tag. Inserts at the caret rather than appending. */
function TagChip({ tag, onInsert }) {
  return (
    <button
      type="button"
      onClick={() => onInsert(`{${tag.tag}}`)}
      title={`${tag.label} — e.g. ${tag.sample}`}
      style={{
        padding: '4px 9px', borderRadius: 7, cursor: 'pointer',
        background: C.white, border: `1px solid ${C.border}`,
        fontFamily: "'Courier New', Courier, monospace", fontSize: 11.5,
        color: C.goldDark, whiteSpace: 'nowrap',
      }}
    >
      {`{${tag.tag}}`}
    </button>
  );
}

/**
 * One (type, language) editor.
 *
 * Local draft state, so typing never round-trips. The saved value only moves
 * back in when the server confirms it — an editor that snaps back to the stored
 * value mid-sentence is the classic way to lose somebody's work.
 */
function LanguageEditor({ type, lang, saving, onSave, footer, limit }) {
  const stored = type.languages[lang.key];
  const [draft, setDraft] = useState(stored.custom ?? '');
  const [dirty, setDirty] = useState(false);
  const areaRef = useRef(null);

  /* THERE IS NO RE-SEEDING EFFECT HERE, AND THERE MUST NOT BE.
   *
   * There was one — `useEffect(() => { if (!dirty) setDraft(stored.custom ?? '') })`
   * — to follow the server value after a save. It was two things at once: a
   * `react-hooks/set-state-in-effect` violation (a setState directly in an
   * effect body, which this repo treats as an error), and redundant.
   *
   * Redundant because every transition that changes the stored value already
   * sets the draft explicitly through `save`'s `done` callback: saving leaves
   * the draft equal to what was saved, and "Use our wording" clears it. Nothing
   * else writes `stored.custom` while this page is open, so the effect could
   * only ever re-apply a value the component had just set — costing a render
   * and, if a refetch ever landed mid-keystroke, silently discarding typing. */

  const usingDefault = !draft.trim();
  const template = usingDefault ? stored.default : draft;

  /**
   * TWO VALUE MAPS, AND THEY ARE DELIBERATELY DIFFERENT.
   *
   * The panel used to render the raw template, so "On their phone" showed
   * `Hi {name}! ... table {table}` — braces and all. That is not a preview of
   * anything; a guest never sees a brace. And measuring that string was wrong in
   * both directions at once: `{pass_link}` is 11 characters where a real short
   * link is 23, while `{name}` is 6 where a long name is 24.
   *
   *   readable → each tag's own sample. What the message actually reads like.
   *   costing  → each sample padded to the tag's clip ceiling. What it BILLS at,
   *              matching the server's worst-case figure so the number does not
   *              jump the moment they press Save.
   */
  const readable = useMemo(() => {
    const v = {};
    for (const t of type.tags) v[t.tag] = t.sample;
    return v;
  }, [type.tags]);

  const costing = useMemo(() => {
    const v = {};
    for (const t of type.tags) {
      if (/^https?:\/\//.test(t.sample)) {
        // A link is ALREADY at its real shortened length. Padding it would quote
        // a URL longer than shortLinks can produce, i.e. a price nobody pays.
        v[t.tag] = t.sample;
      } else if (t.sample.length >= t.max) {
        v[t.tag] = t.sample.slice(0, t.max);
      } else {
        // 'x' is single-width in both GSM-7 and UCS-2, so padding changes the
        // length without changing the encoding the message would land in.
        v[t.tag] = t.sample + 'x'.repeat(t.max - t.sample.length);
      }
    }
    return v;
  }, [type.tags]);

  const shown = renderTemplate(template, readable);
  const live = computeSmsSegments(`${renderTemplate(template, costing)}${footer}`);
  const measured = usingDefault ? stored.defaultMeasured : (dirty ? null : stored.customMeasured);

  const insert = useCallback((token) => {
    const el = areaRef.current;
    if (!el) { setDraft((d) => d + token); setDirty(true); return; }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    // Seed from the default when the box is empty, so clicking a tag on an
    // untouched editor starts from our copy rather than from a bare "{name}".
    const base = draft || stored.default || '';
    const next = `${base.slice(0, start)}${token}${base.slice(end)}`;
    setDraft(next);
    setDirty(true);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }, [draft, stored.default]);

  return (
    <div style={{ marginTop: 14 }}>
      {/* `--3`, not `--2`, and the number is a COLUMN WIDTH not a column count.
          fx-grid is auto-fit: `--2` asks for 560px tracks, which needs ~1140px
          to fit two — so inside the dashboard's content column it collapsed to
          one and the preview sat below the editor at every width, which is the
          one thing this layout exists not to do. `--3` (340px tracks) puts them
          side by side from ~700px up and still stacks on a phone. */}
      <div className="fx-grid fx-grid--3 fx-grid--gap-sm">
        {/* ── Editor ── */}
        <div className="fx-min0">
          <label
            htmlFor={`tpl-${type.key}-${lang.key}`}
            style={{
              display: 'block', marginBottom: 6,
              fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase', color: C.stone,
            }}
          >
            {lang.label}
            {usingDefault && (
              <span style={{ marginInlineStart: 8, letterSpacing: 0, textTransform: 'none', fontWeight: 500, color: C.gold }}>
                using our wording
              </span>
            )}
          </label>

          <textarea
            id={`tpl-${type.key}-${lang.key}`}
            ref={areaRef}
            dir={lang.dir}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
            placeholder={stored.default}
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              padding: '10px 12px', borderRadius: 10,
              border: `1px solid ${live.segments > limit ? C.error : C.border}`,
              background: C.white, color: C.charcoal,
              fontFamily: 'var(--font-sans)',
              // 16px: anything smaller makes iOS Safari zoom the page on focus,
              // which the dashboard mobile pass fixed across 264 inputs.
              fontSize: 16, lineHeight: 1.55,
            }}
          />

          <CostMeter measured={measured} live={live} limit={limit} />

          <div className="fx-row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {type.tags.map((tag) => <TagChip key={tag.tag} tag={tag} onInsert={insert} />)}
          </div>

          <div className="fx-row" style={{ gap: 8, marginTop: 12 }}>
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => onSave(lang.key, draft, () => setDirty(false))}
              style={{
                padding: '8px 16px', borderRadius: 999, border: 'none',
                background: dirty ? C.gold : C.border,
                color: dirty ? C.white : C.stone,
                cursor: saving || !dirty ? 'default' : 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {(stored.custom || dirty) && (
              <button
                type="button"
                disabled={saving}
                onClick={() => onSave(lang.key, '', () => { setDirty(false); setDraft(''); })}
                style={{
                  padding: '8px 14px', borderRadius: 999,
                  background: C.white, border: `1px solid ${C.border}`, color: C.ink,
                  cursor: saving ? 'default' : 'pointer',
                  fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
                }}
              >
                Use our wording
              </button>
            )}
          </div>
        </div>

        {/* ── Preview ── */}
        <div className="fx-min0">
          <div style={{
            marginBottom: 6, fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase', color: C.stone,
          }}>
            On their phone
          </div>
          <Preview body={shown} footer={footer} dir={lang.dir} />
          <p style={{
            margin: '8px 2px 0', fontFamily: 'var(--font-sans)',
            fontSize: 11.5, lineHeight: 1.6, color: C.stone,
          }}>
            The greyed part is added to every message and cannot be removed — it is what
            lets guests reply STOP.
          </p>
        </div>
      </div>
    </div>
  );
}

/** One message type: its name, what it is for, and the two editors. */
function TypeCard({ type, footer, limit, savingKey, onSave }) {
  const [open, setOpen] = useState(false);
  const customised = LANGS.some((l) => type.languages[l.key].custom);

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 14,
      background: C.white, padding: '14px 16px', marginBottom: 10,
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'start',
        }}
      >
        <div className="fx-min0" style={{ flex: 1 }}>
          <div className="fx-row" style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: C.charcoal }}>
              {type.label}
            </span>
            {customised && (
              <span style={{
                padding: '2px 8px', borderRadius: 999, fontSize: 'var(--fx-micro)', fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                background: C.ivory, border: `1px solid ${C.border}`, color: C.goldDark,
              }}>
                Your wording
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-sans)', fontSize: 12.5, lineHeight: 1.6, color: C.stone }}>
            {type.description}
          </p>
        </div>
        <span aria-hidden="true" style={{ color: C.stone, fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
          {open ? '−' : '+'}
        </span>
      </button>

      {open && LANGS.map((lang) => (
        <LanguageEditor
          key={lang.key}
          type={type}
          lang={lang}
          footer={footer}
          limit={limit}
          saving={savingKey === `${type.key}:${lang.key}`}
          onSave={(langKey, value, done) => onSave(type.key, langKey, value, done)}
        />
      ))}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.apiUrl
 * @param {string} props.eventId
 */
export default function SmsTemplateStudio({ apiUrl, eventId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/templates`, { credentials: 'include' });
      const j = await res.json();
      if (j?.success) setData(j);
    } catch {
      // A failed load leaves the section absent rather than throwing into the
      // page — the balance and the log above it are still useful.
    } finally {
      setLoading(false);
    }
  }, [apiUrl, eventId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (typeKey, langKey, value, done) => {
    setSavingKey(`${typeKey}:${langKey}`);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/templates`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Only the one editor is sent. The server MERGES, so this cannot wipe
        // the other language or another type.
        body: JSON.stringify({ templates: { [typeKey]: { [langKey]: value === '' ? null : value } } }),
      });
      const j = await res.json();
      if (!j?.success) {
        // The server's sentence, not a generic one: it names the tag, the limit
        // and the cost, which is the whole reason the endpoint returns it.
        toast.error(j?.message || 'That message could not be saved.');
        return;
      }
      toast.success(value === '' ? 'Back to our wording.' : 'Message saved.');
      if (done) done();
      await load();
    } catch {
      toast.error('That message could not be saved.');
    } finally {
      setSavingKey(null);
    }
  }, [apiUrl, eventId, load]);

  if (loading || !data) return null;

  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{
        margin: '0 0 4px', fontFamily: 'var(--font-serif)',
        fontSize: 19, fontWeight: 700, color: C.charcoal,
      }}>
        Write your own messages
      </h2>
      <p style={{
        margin: '0 0 14px', fontFamily: 'var(--font-sans)',
        fontSize: 13, lineHeight: 1.65, color: C.stone, maxWidth: 620,
      }}>
        Every message below is written for you already. Change any of them if you would rather
        use your own words — the tags fill in each guest&rsquo;s own details, and the cost
        updates as you type.
      </p>

      {data.types.map((type) => (
        <TypeCard
          key={type.key}
          type={type}
          footer={data.complianceFooter}
          limit={data.limits.maxSegments}
          savingKey={savingKey}
          onSave={save}
        />
      ))}
    </section>
  );
}
