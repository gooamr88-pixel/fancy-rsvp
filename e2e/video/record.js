/* ═══════════════════════════════════════════════════════════════════════════
   THE RECORDER.

   Opens composer.html in a real Chromium at 1920x1080, walks a shot list, and
   writes one .webm per chapter to .visual/video/raw/.

   Usage:
     node e2e/video/record.js pilot            # record the pilot chapter
     node e2e/video/record.js pilot --verify   # no video; screenshot each beat

   WHY PLAYWRIGHT AND NOT `chrome --screenshot`

   The rest of this repo photographs staged HTML by shelling out to Chrome once
   per frame. That works for stills and is miserable for video: a cold start is
   ~40s, Chrome on Windows will not open a window under ~500px, `--screenshot`
   silently writes NOTHING when the working directory has a space in it (this
   repo lives under "C:/Users/yousef amr/"), and a second Chrome holding the
   default profile makes every later call exit successfully having written
   nothing.

   Playwright is already installed in e2e/ WITH its browsers, and e2e/ is not
   an npm workspace — so using it here cannot trigger the workspace-install
   trap that has taken production down before. One launch covers a whole
   chapter, and none of the four traps above exist.

   FAIL LOUDLY

   Every `ring`/`move` step names a selector inside the staged page. If it is
   not found the run STOPS with the selector and the shot index. A highlight
   ring that quietly does not draw, or a cursor that eases to the middle of
   nowhere, is precisely the kind of silent wrong that this pipeline exists to
   prevent — it would be invisible until someone watched all 30 minutes.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');
const fixtures = require('./fixtures');

/* ── LIVE MODE ───────────────────────────────────────────────────────────
   `--live` films the REAL application instead of staged HTML.

   Three things make it possible without a database:

     1. `next start` serves the existing production build.
     2. The auth middleware (frontend/src/middleware.ts) checks only that a
        `fancy_session` cookie EXISTS, has three dot-separated parts, and
        carries an unexpired `exp` — it does no signature verification, which
        it says so itself ("without full signature verification in Edge
        Runtime"). A locally minted token gets past it.
     3. Every /api/v1/** call is intercepted and answered from fixtures.js, so
        the app never needs a backend.

   What that buys is the thing staged HTML cannot give: React is actually
   running. Tabs switch, modals open, menus expand, and the film records the
   product behaving rather than a photograph of it. */
const LIVE_ORIGIN = process.env.VIDEO_APP_ORIGIN || 'http://localhost:3111';

/** A structurally valid, unexpired session token. Never leaves this machine. */
function demoSessionCookie() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const token = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ sub: 'demo-organizer', email: 'host@fancyrsvp.com', exp }),
    'demo-signature-not-verified',
  ].join('.');
  const { hostname, port } = new URL(LIVE_ORIGIN);
  /* Lax works because the composer is served FROM the app's own origin in
     live mode (see serveComposer below), so the iframe navigation is
     same-site. Framing it from a file: document instead makes the request
     cross-site, Lax withholds the cookie, and the middleware bounces every
     dashboard route to /login — which is what the first live take filmed,
     three times in a row. `None` is not the fix: Chromium drops
     SameSite=None without Secure, and this server is plain http.

     The token is minted on this machine, for a local server, and never
     leaves either. */
  return { name: 'fancy_session', value: token, domain: hostname, path: '/',
           httpOnly: true, sameSite: 'Lax', expires: exp };
}

const E2E    = __dirname;                             // <repo>/e2e/video
const REPO   = path.resolve(E2E, '..', '..');         // <repo>
const VISUAL = path.join(REPO, '.visual');
const OUT    = path.join(VISUAL, 'video');
const FRONT  = path.join(REPO, 'frontend');

const W = 1920, H = 1080;

/* ── The brand faces ─────────────────────────────────────────────────────
   next/font self-hosts every face into .next/static/media under a content
   hash, so no filename is stable across builds and none can be hardcoded.
   Lift the @font-face rules the build itself wrote, and rewrite each
   `url(../media/…)` — which is relative to the chunks folder and resolves to
   nothing here — into an absolute file: URL.

   URL-ENCODED, and that is load-bearing: this repo lives under
   "C:/Users/yousef amr/", and a raw space inside an unquoted CSS url() ends
   the token. The rule then parses as garbage and the face falls back to
   Georgia with no error anywhere — the product judged in a typeface it does
   not use. */
function brandFontCss(liveMode) {
  const chunks = path.join(FRONT, '.next/static/chunks');
  if (!fs.existsSync(chunks)) {
    throw new Error('No .next build found. Run `npx next build` in frontend/ first.');
  }
  const media = encodeURI(path.join(FRONT, '.next/static/media').split(path.sep).join('/'));

  const faces = [];
  for (const f of fs.readdirSync(chunks).filter((n) => n.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(chunks, f), 'utf8');
    for (const m of css.matchAll(/@font-face\{[^}]*\}/g)) faces.push(m[0]);
  }
  /* In live mode the composer is served over http, where a file: subresource
     is blocked outright — the brand faces would silently fall back to Georgia.
     They are re-pointed at /__font/, which record.js serves from the same
     .next/static/media directory. */
  const base = liveMode ? 'url(/__font/' : 'url(file:///' + media + '/';
  const out = [...new Set(faces)].join('\n')
    .replace(/url\(\.\.\/media\//g, base);

  // The composer's whole type hierarchy rests on these four. A missing face
  // is invisible in a screenshot, which is exactly how it would ship.
  for (const family of ['Aboreto', 'Cormorant Garamond', 'Google Sans', 'Montserrat']) {
    if (!out.includes(`font-family:${family};`)) {
      throw new Error(`No @font-face for ${family} in the built CSS — the font pipeline moved.`);
    }
  }
  return out;
}

/** A .visual-relative path -> a file: URL that survives the space in the repo path. */
function screenUrl(rel) {
  const abs = path.join(VISUAL, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Staged screen missing: ${rel}\n`
      + `  looked in ${abs}\n`
      + '  Stage it first:  cd frontend && npx vitest run --config vitest.shots.config.mjs',
    );
  }
  return pathToFileURL(abs).href;
}

/** Write the composer with the font path baked in; return its file: URL. */
function buildComposer(liveMode) {
  fs.mkdirSync(OUT, { recursive: true });
  const src = fs.readFileSync(path.join(E2E, 'composer.html'), 'utf8');
  const gen = path.join(OUT, 'composer.gen.html');
  fs.writeFileSync(gen, src.replace('__FONTS__', brandFontCss(liveMode)), 'utf8');
  return pathToFileURL(gen).href;
}

/* ── Measuring inside the screen ─────────────────────────
   In live mode the iframe holds the running app on another origin, so the
   composer's own `locate()` (which reads contentDocument) returns null.
   Playwright is not bound by that: it drives the browser rather than running
   inside the page. Everything below goes through it, so ONE code path serves
   both a staged file: screen and the live application. */

/** The iframe currently on stage. `show` clears the retired shell, so there is
    exactly one once a screen has settled. */
function screenFrame(page) {
  /* DIRECT children of the composer only.
     `page.frames()` is the whole tree, and a live app page carries frames of
     its own — the Google sign-in button mounts one on /login, and it is
     nested inside the screen. Taking the first non-blank frame in the tree
     picked that one, and the next `tap` failed with "selector not found on
     screen" for a link that was plainly there.

     The LAST such child wins: during a crossfade both shells briefly hold an
     iframe, and the new screen is the one being talked about. */
  const kids = page.frames().filter(
    (f) => f.parentFrame() === page.mainFrame() && f.url() && f.url() !== 'about:blank',
  );
  return kids.length ? kids[kids.length - 1] : null;
}

/** Bounding box of `sel` inside the screen, in 1920x1080 stage coordinates. */
async function boxIn(page, sel) {
  const frame = screenFrame(page);
  if (!frame) return null;
  try {
    const el = frame.locator(sel).first();
    await el.waitFor({ state: 'attached', timeout: 4000 });
    return await el.boundingBox();
  } catch (e) { return null; }
}

/**
 * Why a selector was not found, in the words of the page itself.
 *
 * "selector not found" is a dead end when the screen is a live app: is the
 * frame wrong, the route wrong, the element behind a media query, or simply
 * not rendered yet? This answers that in the error message rather than in a
 * debugging session.
 */
async function whyNotFound(page, sel) {
  const frame = screenFrame(page);
  if (!frame) return 'no screen frame on stage at all';
  try {
    const info = await frame.evaluate((s) => ({
      url: location.href,
      w: window.innerWidth,
      h: window.innerHeight,
      matches: document.querySelectorAll(s).length,
      links: [...document.querySelectorAll('a[href]')].slice(0, 14).map((a) => a.getAttribute('href')),
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    }), sel);
    return `frame ${info.url} at ${info.w}x${info.h}
`
      + `  querySelectorAll matched ${info.matches}
`
      + `  first links on the page: ${JSON.stringify(info.links)}
`
      + `  first text: ${info.text}`;
  } catch (e) { return `could not inspect the frame: ${e.message}`; }
}

/** Hand-eased scroll inside the screen. easeInOutCubic: a hand on a trackpad,
    not a jump. */
async function smoothScroll(frame, to, ms) {
  await frame.evaluate(async ([target, dur]) => {
    const from = window.scrollY || document.documentElement.scrollTop || 0;
    const dist = target - from;
    const t0 = performance.now();
    await new Promise((res) => {
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        window.scrollTo(0, from + dist * e);
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }, [to, ms]);
}

/* ── The step runner ────────────────────────────────────────────────────── */

async function runStep(page, step, i, onBeat) {
  const D = (fn, ...args) => page.evaluate(
    ([f, a]) => window.D[f](...a), [fn, args],
  );

  switch (step.t) {
    case 'title':
      if (onBeat) {
        // Verify mode: hold the card up, let the caller photograph it, then
        // dismiss. Recording mode plays it straight through.
        await D('titleShow', step.kicker || '', step.heading || '', step.sub || '');
        await onBeat(step, i);
        await D('titleHide');
        return;
      }
      await D('title', step.kicker || '', step.heading || '', step.sub || '', step.hold ?? 2600);
      break;

    /* The halves of `title`, so a chapter can load its first screen behind the
       card instead of leaving a hole in the film while it fetches. */
    case 'titleShow':
      await D('titleShow', step.kicker || '', step.heading || '', step.sub || '');
      break;

    case 'titleHide':
      await D('titleHide');
      break;

    case 'tag':
      await D('tag', step.text || '');
      break;

    case 'show': {
      /* `app:` is a route on the running application; `screen:` is a staged
         file. A shot list may mix them freely. */
      const showUrl = step.app ? LIVE_ORIGIN + step.app : screenUrl(step.screen);
      await page.evaluate(
        ([u, opts]) => window.D.show(u, opts),
        [showUrl, {
          device: step.device || 'phone',
          width: step.width, height: step.height,
          left: step.left, top: step.top,
          url: step.url, scroll: step.scroll, settle: step.settle,
        }],
      );
      break;
    }

    case 'caption':
      await D('caption', {
        eyebrow: step.eyebrow, title: step.title, body: step.body,
        steps: step.steps, device: step.device,   // undefined = follow the screen
      });
      break;

    case 'hideCaption': await D('hideCaption'); break;
    case 'hideCursor':  await D('hideCursor');  break;
    case 'unring':      await D('unring');      break;

    case 'move': {
      if (step.sel) {
        const box = await boxIn(page, step.sel);
        if (!box) throw new Error(`step ${i} (move): selector not found on screen -> ${step.sel}
  ${await whyNotFound(page, step.sel)}`);
        await D('moveTo', box.x + box.width / 2 + (step.dx ?? 0),
                          box.y + box.height / 2 + (step.dy ?? 0), step.ms ?? 900);
      } else {
        await D('moveTo', step.x, step.y, step.ms ?? 900);
      }
      break;
    }

    case 'click': await D('click'); break;

    case 'ring': {
      const box = await boxIn(page, step.sel);
      if (!box) throw new Error(`step ${i} (ring): selector not found on screen -> ${step.sel}
  ${await whyNotFound(page, step.sel)}`);
      await D('ringAt', box.x, box.y, box.width, box.height, step.pad ?? 8);
      break;
    }

    case 'scrollTour': {
      const frame = screenFrame(page);
      if (!frame) throw new Error(`step ${i} (scrollTour): no screen on stage`);
      const bottom = await frame.evaluate(
        () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      );
      await smoothScroll(frame, bottom, step.ms ?? 9000);
      break;
    }

    case 'progress': await D('progress', step.frac ?? 0); break;

    case 'scroll': {
      const frame = screenFrame(page);
      if (!frame) throw new Error(`step ${i} (scroll): no screen on stage`);
      let target = step.y ?? 0;
      if (step.sel) {
        const box = await boxIn(page, step.sel);
        if (!box) throw new Error(`step ${i} (scroll): selector not found -> ${step.sel}`);
        target = await frame.evaluate(([sel, frac]) => {
          const el = document.querySelector(sel);
          const top = el.getBoundingClientRect().top + window.scrollY;
          return Math.max(0, top - window.innerHeight * frac);
        }, [step.sel, step.frac ?? 0.34]);
      }
      await smoothScroll(frame, target, step.ms ?? 1800);
      break;
    }

    case 'setClass': {
      const frame = screenFrame(page);
      if (!frame) throw new Error(`step ${i} (setClass): no screen on stage`);
      const ok = await frame.evaluate(([sel, cls, on]) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.classList[on ? 'add' : 'remove'](cls);
        return true;
      }, [step.sel, step.cls, step.on !== false]);
      if (!ok) throw new Error(`step ${i} (setClass): selector not found -> ${step.sel}`);
      break;
    }

    case 'playVideo': {
      const frame = screenFrame(page);
      if (!frame) throw new Error(`step ${i} (playVideo): no screen on stage`);
      const ok = await frame.evaluate(async ([sel, maxMs]) => {
        const v = document.querySelector(sel);
        if (!v || typeof v.play !== 'function') return false;
        v.muted = true; v.currentTime = 0;
        try { await v.play(); } catch (e) { return false; }
        await new Promise((res) => {
          v.addEventListener('ended', res, { once: true });
          setTimeout(res, maxMs);          // a stalled decode must not hang it
        });
        return true;
      }, [step.sel, step.maxMs ?? 12000]);
      if (!ok) throw new Error(`step ${i} (playVideo): no playable <video> at -> ${step.sel}`);
      break;
    }

    /* A REAL click, delivered to the running app: the cursor travels there,
       the ripple plays, and then the element is actually clicked. Menus open,
       tabs switch, modals appear. This is the step that only exists because
       the film is of the product rather than of photographs of it. */
    case 'tap': {
      const box = await boxIn(page, step.sel);
      if (!box) throw new Error(`step ${i} (tap): selector not found on screen -> ${step.sel}
  ${await whyNotFound(page, step.sel)}`);
      await D('moveTo', box.x + box.width / 2, box.y + box.height / 2, step.ms ?? 800);
      await D('click');
      const frame = screenFrame(page);
      await frame.locator(step.sel).first().click({ timeout: 5000 }).catch(() => {});
      /* Playwright scrolls an element into view before clicking it, and that
         scroll can walk the COMPOSER document itself — the 1920x1080 stage
         slid up by ninety pixels and cropped its own browser chrome. Put it
         back. */
      await page.evaluate(() => window.scrollTo(0, 0));
      await D('wait', step.settle ?? 900);
      break;
    }

    case 'wait': await D('wait', step.ms ?? 800); break;

    default:
      throw new Error(`step ${i}: unknown step type "${step.t}"`);
  }

  if (onBeat && step.shot !== false) await onBeat(step, i);
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  const [, , chapterArg, ...flags] = process.argv;
  const chapter = chapterArg || 'pilot';
  const verify = flags.includes('--verify');
  /* Films the RUNNING application rather than staged HTML. See the LIVE MODE
     note at the top for why this needs no database. */
  const live = flags.includes('--live');

  const listPath = path.join(E2E, 'shots', `${chapter}.js`);
  if (!fs.existsSync(listPath)) throw new Error(`No shot list at ${listPath}`);
  const shots = require(listPath);

  const rawDir   = path.join(OUT, 'raw');
  const checkDir = path.join(OUT, 'check', chapter);
  fs.mkdirSync(rawDir, { recursive: true });
  if (verify) fs.mkdirSync(checkDir, { recursive: true });

  buildComposer(live);                       // always writes composer.gen.html
  const composer = live ? `${LIVE_ORIGIN}/__composer` : buildComposer(live);

  const browser = await chromium.launch({
    args: [
      // The staged pages are file: URLs that iframe other file: URLs and load
      // fonts and artwork by absolute file path. Without this every screen
      // renders as an empty white box.
      '--allow-file-access-from-files',
      // The cinematic openings are <video>. Muted or not, a recording has no
      // gesture to offer them.
      '--autoplay-policy=no-user-gesture-required',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    ...(verify ? {} : { recordVideo: { dir: rawDir, size: { width: W, height: H } } }),
  });

  if (live) {
    /* Past the middleware, and no backend needed beyond this point. */
    await context.addCookies([demoSessionCookie()]);

    /* ── What the cookie alone does NOT buy ─────────────────────────────
       The middleware is only the outer gate. dashboard/page.js has its own:

           const orgId = isClient ? localStorage.getItem('org_id') : null;
           useEffect(() => { if (isClient && !orgId) router.push('/login'); });

       So with a valid cookie the SERVER returns /dashboard 200 and the app
       then redirects ITSELF to /login a moment later — which is what the
       trace showed: profile and events both fetched successfully, then a
       navigation to /login. These are the two keys the sign-in handler
       writes on success ((auth)/login/page.js:62). */
    await context.addInitScript(([orgId, role]) => {
      try {
        localStorage.setItem('org_id', orgId);
        localStorage.setItem('user_role', role);
      } catch (e) { /* a sandboxed context can refuse storage */ }
    }, ['demo-organization', 'organizer']);

    /* ── Letting the app be framed ──────────────────────────────────────
       The production build sends `X-Frame-Options: DENY` and a CSP with
       `frame-ancestors 'none'` (frontend/next.config.mjs). That is correct and
       should stay — it is what stops the real site being clickjacked — but it
       also means the composer's iframe renders a blank white box, which is
       exactly what the first live take produced.

       Stripped HERE, on the recording machine, for document responses only.
       Nothing about the application changes; the header it serves to every
       real visitor is untouched.

       Registered BEFORE the API route on purpose: Playwright uses the LAST
       matching handler, so the API interception below still wins for /api/v1. */
    await context.route(`${LIVE_ORIGIN}/**`, async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const res = await route.fetch();
      const headers = { ...res.headers() };
      delete headers['x-frame-options'];
      if (headers['content-security-policy']) {
        headers['content-security-policy'] =
          headers['content-security-policy'].replace(/frame-ancestors[^;]*;?/i, '');
      }
      await route.fulfill({ response: res, headers });
    });

    /* ── The composer, served FROM the app's origin ──────────────────────
       A file: parent framing http://localhost is cross-site, so the session
       cookie is withheld and the middleware bounces to /login. Serving the
       composer at `${LIVE_ORIGIN}/__composer` makes parent and frame
       same-site, and the cookie flows. Nothing is written to the app; the
       route exists only inside this browser. */
    await context.route(`${LIVE_ORIGIN}/__composer`, async (route) => {
      await route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8',
        body: fs.readFileSync(path.join(OUT, 'composer.gen.html'), 'utf8'),
      });
    });

    /* The brand faces, which cannot be file: URLs on an http page. */
    await context.route(`${LIVE_ORIGIN}/__font/*`, async (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
      const file = path.join(FRONT, '.next/static/media', name);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      await route.fulfill({
        status: 200, contentType: 'font/woff2', body: fs.readFileSync(file),
        headers: { 'cache-control': 'public, max-age=3600' },
      });
    });

    /* ── The API, answered from fixtures ────────────────────────────────
       CORS is load-bearing here, and getting it wrong looks exactly like an
       auth failure. The app's API base is baked at build time
       (NEXT_PUBLIC_API_URL, default http://localhost:5000/api/v1), so every
       call is cross-origin from the page, and apiFetch sends it with
       `credentials: 'include'`.

       With credentials, `access-control-allow-origin: *` is REJECTED by the
       browser — the response must echo the exact origin and set
       allow-credentials. Answering `*` made every fetch throw, the dashboard
       read that as a dead session and redirected itself to /login, and the
       film recorded the sign-in page while the server had happily returned
       200 for /dashboard. */
    const cors = (origin) => ({
      'access-control-allow-origin': origin || LIVE_ORIGIN,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    });

    await context.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const origin = req.headers().origin;
      if (req.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: cors(origin), body: '' });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: cors(origin),
        body: JSON.stringify(fixtures.answerFor(req.url())),
      }).then(() => { if (process.env.VIDEO_TRACE) console.log('      [api]', req.method(), req.url().replace(/^https?:\/\/[^/]+/, ''));
      });
    });
    console.log(`[record] live mode: ${LIVE_ORIGIN}, API answered from fixtures.js`);
  }

  /* ── Why there is a throwaway page here ──────────────────────────────
     Playwright starts recording the moment a page exists, so a recording
     opens with about:blank, then first paint, then the font load. Cold, that
     was fifteen to twenty seconds of nothing before the first title card.

     Trimming it by the measured wall clock does NOT work: the video pipeline
     itself takes a few seconds to come up, so the wall clock over-states the
     offset and the trim eats into the opening titles.

     So instead of measuring a big number accurately, make the number small.
     This page loads the composer and the fonts, is thrown away, and leaves
     both in the browser's cache; the page that actually gets filmed then
     reaches `ready` in well under a second, and the residual error is
     absorbed by the deliberate hold every shot list opens with.

     It is created AFTER the live routes above, not before — those routes are
     what serve /__composer at all, and a warm-up that 404s takes the whole
     run down with a `waitForFunction` timeout. */
  const warm = await context.newPage();
  await warm.goto(composer);
  await warm.waitForFunction(() => window.__composerReady === true, { timeout: 20000 });
  await warm.evaluate(() => document.fonts.ready);
  await warm.close();

  const t0 = Date.now();
  const page = await context.newPage();

  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto(composer);
  await page.waitForFunction(() => window.__composerReady === true, { timeout: 15000 });
  // Let the display face actually arrive before the first title card; a title
  // set in the fallback serif is the kind of miss a still never shows you.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const trimStart = (Date.now() - t0) / 1000;

  let beat = 0;
  const onBeat = verify
    ? async (step, i) => {
        beat += 1;
        const name = `${String(beat).padStart(3, '0')}-${step.t}${step.sel ? '-' + step.sel.replace(/[^a-z0-9]+/gi, '_').slice(0, 28) : ''}.png`;
        await page.screenshot({ path: path.join(checkDir, name) });
      }
    : null;

  if (live && process.env.VIDEO_TRACE) {
    page.on('console', (m) => { if (m.type() === 'error') console.log('      [console]', m.text().slice(0, 160)); });
    page.on('requestfailed', (r) => console.log('      [failed]', r.url().slice(0, 120), r.failure() && r.failure().errorText));
  }
  if (live) {
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame()) console.log(`      [frame] ${f.url()}`);
    });
  }
  console.log(`[record] ${chapter}: ${shots.length} steps, mode=${verify ? 'verify' : 'video'}`);
  for (let i = 0; i < shots.length; i += 1) {
    const s = shots[i];
    process.stdout.write(`  ${String(i + 1).padStart(3, ' ')}/${shots.length} ${s.t}${s.sel ? ' ' + s.sel : ''}\n`);
    await runStep(page, s, i, onBeat);
  }

  await page.waitForTimeout(900);           // never end on a hard cut

  /* Ask the page for ITS video rather than picking the newest file on disk.
     The warm-up page above writes a webm too, and "newest wins" would be a
     coin flip between them. */
  const video = verify ? null : page.video();
  await context.close();                    // flushes the video file
  await browser.close();

  if (!verify) {
    if (!video) throw new Error('Playwright recorded no video for the filmed page.');
    const src = await video.path();
    const dest = path.join(rawDir, `${chapter}.webm`);
    if (fs.existsSync(dest)) fs.rmSync(dest);
    fs.renameSync(src, dest);

    /* Err on the side of leaving a little startup in rather than cutting into
       the first title card: the black hold that opens every shot list makes a
       short over-run invisible, while an over-trim removes content. */
    const trim = Math.max(0, trimStart - 0.4);
    fs.writeFileSync(
      path.join(rawDir, `${chapter}.json`),
      JSON.stringify({ trimStart: +trim.toFixed(2), measured: +trimStart.toFixed(2) }, null, 2),
      'utf8',
    );
    console.log(`[record] wrote ${dest}  (startup ${trimStart.toFixed(2)}s, trimming ${trim.toFixed(2)}s)`);
  } else {
    console.log(`[record] wrote ${beat} check frames to ${checkDir}`);
  }

  if (problems.length) {
    console.log('\n[record] page errors seen while recording:');
    for (const p of problems) console.log('  ' + p);
  }
}

main().catch((e) => { console.error('\n[record] FAILED\n' + e.stack); process.exit(1); });
