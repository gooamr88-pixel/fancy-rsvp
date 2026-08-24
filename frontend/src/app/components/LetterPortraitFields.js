'use client';

import React, { useCallback, useId, useRef, useState } from 'react';
import {
  LETTER_FOCUS, LETTER_FOCUS_DEFAULT,
  LETTER_TEXT_POS, LETTER_TEXT_POS_DEFAULT,
  LETTER_SCRIM,
} from './templates/cinematic/cinematicThemes';

/* ═══════════════════════════════════════════════════════════════
   SEALED LETTER — the organizer's side of the hero.

   Sealed Letter is the only template whose hero is different on every event:
   it ships no artwork of its own, so the couple's photograph IS the fold and
   their words sit on it. These are the four controls for that.

   ── Why this is ONE component used by two screens ────────────────────────
   The wizard's Stage 2 and the dashboard's Event Details both edit these
   fields — the organizer meets one when creating and the other when editing.
   Two copies would be two descriptions of one control, which is precisely how
   a feature earns a reputation for being unpredictable; it has happened in
   this codebase before (the adults-only notice, whose two copies had to be
   brought back into line by hand). There is one copy, here, and both screens
   render it.

   ── Why there is a live preview and not just a file input ────────────────
   A phone's fold is a tall portrait and most photographs are not, so a real
   crop happens — and which part survives is the difference between the
   couple's faces and their knees. On top of that the words can be anchored to
   any of three edges. Nobody can be asked to imagine the combination, so the
   preview is the actual composition at the actual aspect ratio, reading the
   same LETTER_FOCUS and LETTER_TEXT_POS constants the guest page does.
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

/* Budgets, not truncation, and they were RAISED when the photograph went full
   bleed. The measure was a 240px panel inside a carved frame — about 24
   characters a line, so 48 bought two lines. It is now the hero's own 340px
   at up to 24px, nearer 36 a line, and holding the old ceiling would have
   been the interface refusing room the design has. The counter warns; the
   maxLength stops. */
const CAPTION_MAX = 60;
const CAPTION_SUB_MAX = 80;
const MAX_BYTES = 8 * 1024 * 1024;

/* The labels are this screen's; the POSITIONS are LETTER_FOCUS, imported from
   the same module the hero reads. They were briefly duplicated here, which is
   a preview that can silently start cropping differently from the page it is
   previewing — the one failure mode a preview must not have. */
const FOCUS_OPTIONS = [
  { key: 'top', label: 'Top', hint: 'Keeps heads and faces when the photo is wider than the screen' },
  { key: 'center', label: 'Centre', hint: 'The middle of the photo' },
  { key: 'bottom', label: 'Bottom', hint: 'Keeps a full-length pose or a dress' },
];

/** Where the words sit ON the photograph. */
const TEXT_POS_OPTIONS = [
  { key: 'top', label: 'Top', hint: 'For a photo whose subject is low in the frame' },
  { key: 'center', label: 'Middle', hint: 'Across the centre of the picture' },
  { key: 'bottom', label: 'Bottom', hint: 'The default — a caption under the picture' },
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

/**
 * The hero at postage-stamp size — full bleed, cropped and anchored exactly
 * as the guest page does it.
 *
 * A phone's fold, not a square: the whole reason the focal point matters is
 * that a 4:3 photograph loses most of its width here, and a preview in the
 * wrong shape would hide precisely the decision it exists to inform.
 */
function PortraitPreview({ photo, focus, textPos, names, caption, captionSub }) {
  /* Centred with no photograph, mirroring `.cine-lhero`'s own base: the
     position control anchors words against a PICTURE, and the page ignores it
     until there is one. Applying it here regardless would have shown an
     organizer their names pinned low on a page that will centre them. */
  const align = photo
    ? (LETTER_TEXT_POS[textPos] || LETTER_TEXT_POS[LETTER_TEXT_POS_DEFAULT])
    : 'center';
  return (
    <div
      data-testid="letter-portrait-preview"
      style={{
        position: 'relative',
        width: 156,
        aspectRatio: '390 / 844',
        flex: 'none',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 8px 22px -10px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: align,
        // The bare state's paper, same as .cine-lhero's.
        background: 'radial-gradient(circle at 50% 0%, #fbf6ec, transparent 55%), #f6efe4',
      }}
    >
      {photo && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo}
            alt=""
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover',
              objectPosition: LETTER_FOCUS[focus] || LETTER_FOCUS[LETTER_FOCUS_DEFAULT],
            }}
          />
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: LETTER_SCRIM[textPos] || LETTER_SCRIM[LETTER_TEXT_POS_DEFAULT],
          }} />
        </>
      )}

      <div style={{ position: 'relative', padding: '10% 8%', textAlign: 'center' }}>
        <span style={{
          display: 'block', fontSize: 11, lineHeight: 1.25, fontFamily: 'var(--font-serif)',
          color: photo ? '#fdf8f0' : '#5a3a32',
          textShadow: photo ? '0 1px 4px rgba(40,16,12,0.7)' : 'none',
        }}>
          {names}
        </span>
        {caption && (
          <span style={{
            display: 'block', marginTop: 4, fontSize: 6.5, lineHeight: 1.45,
            fontFamily: 'var(--font-serif)',
            color: photo ? '#fdf8f0' : '#5a3a32',
            textShadow: photo ? '0 1px 4px rgba(40,16,12,0.7)' : 'none',
          }}>
            {caption}
          </span>
        )}
        {captionSub && (
          <span style={{
            display: 'block', marginTop: 1, fontSize: 5.5, lineHeight: 1.5,
            color: photo ? 'rgba(253,248,240,0.86)' : '#5f463f',
            textShadow: photo ? '0 1px 4px rgba(40,16,12,0.7)' : 'none',
          }}>
            {captionSub}
          </span>
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
  const textPosGroupId = `${uid}-textpos-group`;

  const photo = value.letter_hero_photo || '';
  const focus = value.letter_hero_focus || LETTER_FOCUS_DEFAULT;
  const textPos = value.letter_hero_text_pos || LETTER_TEXT_POS_DEFAULT;
  const caption = value.letter_hero_caption || '';
  const captionSub = value.letter_hero_caption_sub || '';
  /* Whatever the couple's names resolve to, so the preview is THEIR hero and
     not a generic one. `partner1/partner2` are the keys every full-page
     template stores a couple under. */
  const previewNames = [value.partner1, value.partner2].filter(Boolean).join(' & ')
    || value.custom_honoree
    || 'Your names';

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
            {/* The advice has to match the shape the photo is actually put
                in, and that shape has changed once already. It now fills the
                whole fold, which on a phone is a tall portrait — so a
                portrait-orientation photo is the easy case again. Getting
                this line wrong has organizers cropping their photographs the
                wrong way before they ever upload one. */}
            <span style={hintStyle}>JPG, PNG, WebP • Max 8MB • A tall portrait fills a phone best</span>
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
              Your photo fills the whole screen. A wide photo has to lose some
              width to fit a phone — this chooses which part survives.
            </span>
          </div>

          <div style={{ marginTop: 16 }}>
            <span id={textPosGroupId} style={groupHeadingStyle}>Where Your Words Sit</span>
            <div role="group" aria-labelledby={textPosGroupId} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TEXT_POS_OPTIONS.map((opt) => {
                const active = textPos === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    aria-pressed={active}
                    title={opt.hint}
                    data-testid={`letter-textpos-${opt.key}`}
                    onClick={() => onChange?.({ letter_hero_text_pos: opt.key })}
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
              Your names and your words move together, and the shading behind them
              follows — so they stay readable wherever you put them.
            </span>
          </div>
        </div>

        <PortraitPreview
          photo={photo} focus={focus} textPos={textPos}
          names={previewNames} caption={caption} captionSub={captionSub}
        />
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
          Written across your photograph, under your names. {CAPTION_MAX - caption.length} characters left.
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
