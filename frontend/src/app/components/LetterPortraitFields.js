'use client';

import React, { useCallback, useId, useRef, useState } from 'react';
import { LETTER_PANEL, LETTER_FOCUS, LETTER_FOCUS_DEFAULT } from './templates/cinematic/cinematicThemes';

/* ═══════════════════════════════════════════════════════════════
   SEALED LETTER — the organizer's side of the hero.

   Sealed Letter is the only template whose hero is different on every event:
   a carved ivory frame with a panel in it, and the couple's own photograph
   and words go in the panel. These are the three controls for that.

   ── Why this is ONE component used by two screens ────────────────────────
   The wizard's Stage 2 and the dashboard's Event Details both edit these
   fields — the organizer meets one when creating and the other when editing.
   Two copies would be two descriptions of one control, which is precisely how
   a feature earns a reputation for being unpredictable; it has happened in
   this codebase before (the adults-only notice, whose two copies had to be
   brought back into line by hand). There is one copy, here, and both screens
   render it.

   ── Why there is a live preview and not just a file input ────────────────
   The panel is 1:2. A landscape photograph loses most of its width, and which
   part survives is the difference between the couple's faces and their knees.
   An organizer cannot be asked to imagine that, so the preview is the real
   frame artwork at the real measured insets (LETTER_PANEL, shared with the
   hero's own CSS) with the real crop applied. What they see here is what a
   guest gets.
   ═══════════════════════════════════════════════════════════════ */

/* Same values as the two dashboard surfaces this mounts inside. Restated
   rather than imported because both of those declare their own private
   palette object and neither exports it — three copies of the brand colours
   is already one too many, but adding an import cycle between two 80KB
   screens to fix it here is the wrong trade. */
const C = {
  gold: '#B8944F', charcoal: '#191B1E', stone: '#77736A',
  border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8', faint: '#A09A91',
};

/* Budgets, not truncation. The caption is set in a display serif inside a
   panel roughly 240px wide on a phone, which is about 24 characters a line —
   so 48 is two comfortable lines and anything past it wraps to a third and
   starts crowding the photograph. The counter warns; the maxLength stops. */
const CAPTION_MAX = 48;
const CAPTION_SUB_MAX = 64;
const MAX_BYTES = 8 * 1024 * 1024;

/* The labels are this screen's; the POSITIONS are LETTER_FOCUS, imported from
   the same module the hero reads. They were briefly duplicated here, which is
   a preview that can silently start cropping differently from the page it is
   previewing — the one failure mode a preview must not have. */
const FOCUS_OPTIONS = [
  { key: 'top', label: 'Top', hint: 'Keeps heads and faces when the photo is wider than the panel' },
  { key: 'center', label: 'Centre', hint: 'The middle of the photo' },
  { key: 'bottom', label: 'Bottom', hint: 'Keeps a full-length pose or a dress' },
];

/* Two visually identical styles, deliberately used on two different elements.
   A <label> with no `for` and no control inside it labels nothing — it is
   invalid, and a screen reader announces the heading as if it were a field's
   name. The upload zone and the focal-point buttons are GROUPS, not inputs, so
   they get a plain heading tied to them with aria-labelledby; only the two
   real <input>s get a <label>. */
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: C.stone,
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
  fontFamily: 'var(--font-sans)',
};
const groupHeadingStyle = labelStyle;
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: C.white, border: `1px solid ${C.border}`,
  borderRadius: 8, padding: '10px 14px',
  fontSize: 14, color: C.charcoal, outline: 'none',
  fontFamily: 'var(--font-sans)',
};
const hintStyle = { fontSize: 'var(--fx-micro)', color: C.faint, display: 'block', marginTop: 4 };

/** The hero, at postage-stamp size, cropping exactly as the hero crops. */
function PortraitPreview({ photo, focus, caption, captionSub }) {
  return (
    <div
      data-testid="letter-portrait-preview"
      style={{
        position: 'relative',
        width: 156,
        aspectRatio: '780 / 1386',
        flex: 'none',
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: '0 8px 22px -10px rgba(0,0,0,0.4)',
        background: '#f6efe4 url("/templates/letter/frame.jpg") center / 100% 100% no-repeat',
      }}
    >
      {/* The measured panel, from the same constant the hero's stylesheet
          documents. If these ever disagree, the preview is worse than none. */}
      <div style={{
        position: 'absolute',
        insetInline: LETTER_PANEL.insetInline,
        top: LETTER_PANEL.top,
        bottom: LETTER_PANEL.bottom,
        overflow: 'hidden',
      }}>
        {photo && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo}
            alt=""
            style={{
              // Every one of these comes from LETTER_PANEL, which the hero's
              // stylesheet also reads. A preview that crops differently from
              // the page is worse than no preview: it is a confident answer to
              // the wrong question.
              position: 'absolute', insetInline: 0,
              top: LETTER_PANEL.photoTop, height: LETTER_PANEL.photoHeight,
              width: '100%',
              objectFit: 'cover',
              objectPosition: LETTER_FOCUS[focus] || LETTER_FOCUS[LETTER_FOCUS_DEFAULT],
              WebkitMaskImage: LETTER_PANEL.photoMask,
              maskImage: LETTER_PANEL.photoMask,
            }}
          />
        )}
        {(caption || captionSub) && (
          <div style={{
            position: 'absolute', insetInline: 0, bottom: 0, padding: '13% 8% 6%',
            textAlign: 'center',
            background: 'linear-gradient(180deg, rgba(248,242,233,0) 0%, rgba(248,242,233,0.42) 32%, rgba(248,242,233,0.82) 62%, rgba(248,242,233,0.96) 100%)',
          }}>
            {caption && (
              <span style={{ display: 'block', fontSize: 6.5, lineHeight: 1.5, color: '#5a3a32', fontFamily: 'var(--font-serif)' }}>
                {caption}
              </span>
            )}
            {captionSub && (
              <span style={{ display: 'block', fontSize: 5, lineHeight: 1.6, color: '#5f463f', marginTop: 1 }}>
                {captionSub}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LetterPortraitFields({
  /** The event's template_data. */
  value = {},
  /** Called with a partial patch to merge into template_data. */
  onChange,
  /** (File) => Promise<string|null> — the caller's existing uploader. */
  onUploadImage,
  /** Surfaced to the organizer; never thrown. */
  onError,
}) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  /* A ref as well as the state. `take` is a useCallback that must not depend
     on `busy` (re-creating it on every upload would re-run the effects of
     anything holding it), so it cannot read the state value without going
     stale — and a second drop mid-upload would start a parallel upload whose
     completion order decides which photograph wins. */
  const busyRef = useRef(false);
  /* Unique per instance. These ids were literals, which is a duplicate-id bug
     waiting for the first screen that renders this component twice — and a
     <label for> then points at whichever input the browser saw first. */
  const uid = useId();
  const captionId = `${uid}-caption`;
  const captionSubId = `${uid}-caption-sub`;
  const photoGroupId = `${uid}-photo-group`;
  const focusGroupId = `${uid}-focus-group`;

  const photo = value.letter_hero_photo || '';
  const focus = value.letter_hero_focus || LETTER_FOCUS_DEFAULT;
  const caption = value.letter_hero_caption || '';
  const captionSub = value.letter_hero_caption_sub || '';

  const take = useCallback(async (file) => {
    if (!file) return;
    // One upload at a time. Two drops in quick succession would otherwise race,
    // and the photograph the organizer ends up with is whichever request the
    // network happened to finish last — not the one they chose last.
    if (busyRef.current) return;
    if (!file.type?.startsWith('image/')) {
      onError?.('That file is not an image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      onError?.('File exceeds 8MB. Please use a smaller file.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const url = await onUploadImage?.(file);
      // A null return is the uploader having already told the organizer why.
      if (url) onChange?.({ letter_hero_photo: url });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [onUploadImage, onChange, onError]);

  const onPick = useCallback((e) => {
    take(e.target.files?.[0]);
    // Cleared so choosing the SAME file again still fires a change event —
    // which is exactly what someone does after re-cropping it.
    e.target.value = '';
  }, [take]);

  return (
    <div data-testid="letter-portrait-fields">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        {/* min-width: 0 so this column can actually shrink inside the flex
            row — without it a long filename or a wide input sizes the track to
            max-content and pushes the preview off the panel. */}
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <span id={photoGroupId} style={groupHeadingStyle}>The Photograph</span>

          <div
            role="button"
            aria-labelledby={photoGroupId}
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }}
            style={{
              padding: '18px 16px', borderRadius: 12, cursor: busy ? 'wait' : 'pointer',
              border: `2px dashed ${dragging ? C.gold : C.border}`,
              background: dragging ? 'rgba(184,148,79,0.04)' : C.softBg,
              textAlign: 'center', transition: 'border-color 0.25s, background 0.25s',
            }}
          >
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.stone, fontFamily: 'var(--font-sans)' }}>
              {busy ? 'Uploading…' : photo ? 'Drop a new photo, or click to replace' : 'Drop the photo here or click to browse'}
            </span>
            {/* NOT "a tall portrait works best" — that was written when the
                photograph filled the whole 1:2 panel, and it stopped being
                true when the type moved onto the plaster above it. The window
                is now about 250x290, so a square or a landscape photograph is
                the easy case and a very tall one is the awkward one. Telling
                organizers the opposite would have them cropping their photos
                the wrong way before they ever upload. */}
            <span style={hintStyle}>JPG, PNG, WebP • Max 8MB • Roughly square works best</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={onPick} disabled={busy} style={{ display: 'none' }} />

          {photo && (
            <button
              type="button"
              onClick={() => onChange?.({ letter_hero_photo: '' })}
              style={{
                marginTop: 8, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: C.white,
                fontSize: 12, color: C.stone, fontFamily: 'var(--font-sans)',
              }}
            >
              Remove photo
            </button>
          )}

          <div style={{ marginTop: 16 }}>
            <span id={focusGroupId} style={groupHeadingStyle}>What To Keep In Frame</span>
            {/* Plain buttons with aria-pressed, not role="radiogroup": a
                radiogroup promises arrow-key navigation, and promising
                keyboard behaviour a component does not implement is worse
                than not claiming the role at all. `role="group"` claims only
                what is true — these three belong together — and carries the
                heading above as its name. */}
            <div role="group" aria-labelledby={focusGroupId} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FOCUS_OPTIONS.map((opt) => {
                const active = focus === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    aria-pressed={active}
                    title={opt.hint}
                    data-testid={`letter-focus-${opt.key}`}
                    onClick={() => onChange?.({ letter_hero_focus: opt.key })}
                    style={{
                      padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${active ? C.gold : C.border}`,
                      background: active ? 'rgba(184,148,79,0.1)' : C.white,
                      color: active ? C.gold : C.stone,
                      fontSize: 12, fontWeight: active ? 700 : 500,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <span style={hintStyle}>
              Your photo fills the lower part of the frame&apos;s panel, under your
              names. A wide photo has to lose some height to fit — this chooses
              which part survives.
            </span>
          </div>
        </div>

        <PortraitPreview photo={photo} focus={focus} caption={caption} captionSub={captionSub} />
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={labelStyle} htmlFor={captionId}>Words On The Photograph</label>
        <input
          id={captionId}
          value={caption}
          maxLength={CAPTION_MAX}
          onChange={(e) => onChange?.({ letter_hero_caption: e.target.value })}
          placeholder="Where it all begins"
          style={inputStyle}
        />
        <span style={hintStyle}>
          Set across the foot of your photograph. {CAPTION_MAX - caption.length} characters left.
        </span>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={labelStyle} htmlFor={captionSubId}>A Second Line</label>
        <input
          id={captionSubId}
          value={captionSub}
          maxLength={CAPTION_SUB_MAX}
          onChange={(e) => onChange?.({ letter_hero_caption_sub: e.target.value })}
          placeholder="Optional — a date, a place, a line of a song"
          style={inputStyle}
        />
        <span style={hintStyle}>
          Smaller, under the first. Leave both empty and no caption appears at all.
          {' '}{CAPTION_SUB_MAX - captionSub.length} characters left.
        </span>
      </div>
    </div>
  );
}
