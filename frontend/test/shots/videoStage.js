/* ═══════════════════════════════════════════════════════════════════════════
   STAGING FOR THE WALKTHROUGH VIDEO.

   The three functions every *.dump.jsx in this folder had grown its own copy
   of — appCss(), injectedStyles(), stage() — extracted once so the eleven
   video chapters cannot drift apart. Behaviour is identical to the copy in
   landingShots.dump.jsx, with ONE deliberate difference, called out below.

   ── The difference from the still probes ──

   The still probes end their stage with:

       *, *::before, *::after { animation-duration: 1ms !important; … }

   because a still cannot photograph a shutter-timed frame. This one does NOT.
   The video is filmed in a real browser, so shimmer sweeps, gold-dust drift,
   entrance staggers and the cinematic <video> openings should genuinely play.
   Freezing them here would throw away the only real motion the product has.

   ── What still has to be pumped in the probe ──

   CSS animation plays in Chrome later. JS-driven animation does not: React is
   not running inside a staged page. framer-motion mounts its subjects at
   `opacity: 0` as an INLINE style and animates them up over rAF, so a probe
   that renders and immediately serialises captures every animated element at
   zero — a page of blank space that looks like a data problem.

   Pump it before staging, in SLICES:

       for (let i = 0; i < 16; i += 1)
         await act(async () => { await new Promise((r) => setTimeout(r, 250)); });

   One long await inside a single act() is not equivalent and is not
   monotonic — 6000ms in one go settles WORSE than 3200ms in slices, because
   React needs a commit point between them. That is measured, not theoretical.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();                                  // <repo>/frontend
export const VIDEO_OUT = path.join(ROOT, '..', '.visual', 'video', 'stage');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

/**
 * The app's REAL compiled CSS, concatenated from every build chunk.
 *
 * src/app/globals.css is useless on its own: `@import "tailwindcss"` generates
 * nothing outside a build, and `theme()` inside a media condition is a parse
 * error in a browser. The built stylesheet is also SPLIT across chunks and the
 * .fx-* primitives are NOT in the biggest one, so picking a file by name or
 * size yields a page with no grid — which looks like a broken layout rather
 * than a broken harness. Hence the assertions: fail loudly instead of filming
 * a lie.
 */
let cachedCss = null;
export function appCss() {
  if (cachedCss) return cachedCss;

  const dir = path.join(ROOT, '.next/static/chunks');
  if (!fs.existsSync(dir)) {
    throw new Error('No .next build found. Run `npx next build` in frontend/ before staging.');
  }
  const css = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
  if (!css.includes('.fx-grid')) {
    throw new Error('The built CSS has no .fx-grid — the build is stale or the chunks moved.');
  }

  /* next/font self-hosts every face into .next/static/media and writes each
     @font-face src as `url(../media/…)`, relative to the chunks folder. Under
     our <base href=".../public/"> that resolves to nothing and every capture
     silently falls back to Georgia — the product judged in a typeface it does
     not use.

     URL-ENCODED, and that is load-bearing: this repo lives under
     "C:/Users/yousef amr/", and a raw space inside an unquoted CSS url() ends
     the token, so the rule parses as garbage and the face falls back with no
     error anywhere. */
  const media = encodeURI(path.join(ROOT, '.next/static/media').split(path.sep).join('/'));
  const out = css.replace(/url\(\.\.\/media\//g, 'url(file:///' + media + '/');
  if (!/@font-face\{font-family:Aboreto;/.test(out)) {
    throw new Error('No Aboreto @font-face in the built CSS — the font pipeline moved.');
  }
  cachedCss = out;
  return out;
}

/** Local stand-ins for the faces next/font cannot serve to a bare document. */
export const FONT_VARS = `
  *,*::before,*::after { box-sizing: border-box; }
  :root {
    --font-heading:'Aboreto','Aboreto Fallback',Georgia,serif;
    --font-body:'Google Sans','Segoe UI',system-ui,sans-serif;
    --font-sans:'Segoe UI',system-ui,sans-serif;
    --font-serif:Georgia,'Times New Roman',serif;
    --font-script:'Segoe Script','Brush Script MT',cursive;
    --font-playfair:Georgia,serif; --font-cormorant:Georgia,serif;
    --font-montserrat:'Segoe UI',sans-serif; --font-great-vibes:'Segoe Script',cursive;
    --font-aref:'Traditional Arabic','Amiri',serif; --font-amiri:'Traditional Arabic','Amiri',serif;
    --font-messiri:'Segoe UI'; --font-reem:'Segoe UI'; --font-tajawal:'Segoe UI';
  }
  html,body { margin:0; padding:0; }
`;

/**
 * Styles the components inject into document.head at runtime.
 *
 * Several components build a <style> element inside an effect and append it
 * rather than shipping it in their markup. None of that is in
 * container.innerHTML, and without it every entrance animation stays at its
 * `opacity: 0` start frame — a page of blank cards.
 */
export function injectedStyles() {
  return [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n');
}

/**
 * Write every live form value back onto the markup as an ATTRIBUTE.
 *
 * ── Why this is not optional ──
 *
 * A controlled `<select value={…}>`, `<input value={…}>` or `<input checked>`
 * sets a DOM *property*. Properties are not serialised by `innerHTML`, so the
 * staged copy of a fully seated guest list came back with every table
 * assignment showing "No Table" — the select falling back to its first option
 * the moment the page was reloaded in the browser.
 *
 * That failure is silent and it looks like DATA: a viewer reads it as an
 * event where nobody has been seated, not as a staging bug. Every form screen
 * in the film — the event wizard, settings, the RSVP form — depends on this.
 */
function reflectFormState(root) {
  for (const el of root.querySelectorAll('select')) {
    for (const opt of el.options) {
      if (opt.selected) opt.setAttribute('selected', '');
      else opt.removeAttribute('selected');
    }
  }
  for (const el of root.querySelectorAll('input')) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) el.setAttribute('checked', '');
      else el.removeAttribute('checked');
    } else if (el.value != null && el.value !== '') {
      el.setAttribute('value', el.value);
    }
  }
  for (const el of root.querySelectorAll('textarea')) {
    if (el.value) el.textContent = el.value;
  }
}

/**
 * Absolute asset paths ignore <base href>, so an untouched `/images/x.png`
 * resolves against the filesystem root and silently renders nothing.
 *
 * Handles every form the app actually writes: an `src` attribute, a CSS
 * `url()` bare or single- or double-quoted, and the `/templates/` tree the
 * cinematic openings load their artwork and video from.
 */
function relativise(s) {
  return s
    .replace(/(src|href|poster)="\/(images|templates)\//g, '$1="$2/')
    .replace(/url\((['"]?)\/(images|templates)\//g, 'url($1$2/')
    .replace(/\/templates\//g, 'templates/');
}

/**
 * Write a staged screen.
 *
 * @param {string} chapter  e.g. 'ch11' — becomes a folder under .visual/video/stage
 * @param {string} name     file name without extension
 * @param {string} html     container.innerHTML from a settled render
 * @param {object} opts
 *   extraCss   – appended last, so it wins
 *   background – page background behind the component
 *   bare       – skip the built app CSS (for components with their own
 *                standalone stylesheet, e.g. the cinematic templates)
 */
export function stageScreen(chapter, name, html, opts = {}) {
  const dir = path.join(VIDEO_OUT, chapter);
  fs.mkdirSync(dir, { recursive: true });

  /* Accepts the render container itself, which is what lets the form state be
     reflected before serialising. A plain string still works for callers that
     have already serialised, they simply do not get that fix. */
  let markup = html;
  if (html && typeof html !== 'string' && typeof html.querySelectorAll === 'function') {
    reflectFormState(html);
    markup = html.innerHTML;
  }
  const body = relativise(markup);

  const css = [
    FONT_VARS,
    opts.bare ? '' : appCss(),
    /* Relativised too, and that is not optional: several pages set their
       artwork in a styled-jsx block rather than on an <img>, so rewriting only
       the markup left `url('/images/auth-bg.png')` pointing at the filesystem
       root. The sign-up page's whole left panel came back a flat grey box —
       which reads as a design choice, not a broken path. */
    relativise(injectedStyles()),
    `html,body{background:${opts.background || '#FDFCF9'};}`,
    relativise(opts.extraCss || ''),
  ].filter(Boolean).map((c) => `<style>${c}</style>`).join('\n');

  const file = path.join(dir, `${name}.html`);
  fs.writeFileSync(
    file,
    `<!doctype html><html lang="${opts.lang || 'en'}" dir="${opts.dir || 'ltr'}"><head>`
    + `<meta charset="utf-8"><base href="file:///${PUBLIC}/">\n${css}\n`
    + `</head><body>${body}</body></html>`,
    'utf8',
  );
  return file;
}

/** The slice-pumping settle described in the header. Call before staging. */
export async function settle(act, slices = 16, ms = 250) {
  for (let i = 0; i < slices; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  }
}
