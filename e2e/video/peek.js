/* ═══════════════════════════════════════════════════════════════════════════
   PEEK — photograph one staged screen, on its own, in a second.

   Usage:
     node e2e/video/peek.js video/stage/organizer/register.html
     node e2e/video/peek.js video/stage/organizer/register.html 1120 860
     node e2e/video/peek.js video/stage/organizer/register.html 1120 860 --full

   Paths are relative to .visual/. Output lands in .visual/video/check/peek/.

   WHY THIS EXISTS

   Verifying a new screen by running the whole chapter (`record.js --verify`)
   costs three or four minutes and re-photographs forty frames that were
   already fine. Building a chapter means staging fifteen screens and checking
   each one, so the loop has to be cheap or the checking quietly stops
   happening — and a screen that rendered blank is invisible until someone
   watches the finished film.

   `--full` captures the entire scrollable height rather than one viewport,
   which is how you see whether a long page actually has content all the way
   down or just a tall empty body.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');

const REPO   = path.resolve(__dirname, '..', '..');
const VISUAL = path.join(REPO, '.visual');
const OUT    = path.join(VISUAL, 'video', 'check', 'peek');

async function main() {
  const [, , rel, wArg, hArg, ...flags] = process.argv;
  if (!rel) {
    console.error('usage: peek.js <path relative to .visual> [width] [height] [--full]');
    process.exit(1);
  }
  const full = flags.includes('--full');
  const width  = Number(wArg) || 1120;
  const height = Number(hArg) || 860;

  const abs = path.join(VISUAL, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Staged screen missing: ${rel}\n  looked in ${abs}\n`
      + '  Stage it first:  cd frontend && npx vitest run --config vitest.shots.config.mjs <probe>',
    );
  }

  fs.mkdirSync(OUT, { recursive: true });
  const name = rel.replace(/[\\/]/g, '_').replace(/\.html$/, '') + (full ? '-full' : '') + '.png';
  const dest = path.join(OUT, name);

  const browser = await chromium.launch({
    args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
           '--hide-scrollbars', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));

  await page.goto(pathToFileURL(abs).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);

  const box = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    // Rough "is there anything here" check: how much text the body carries.
    text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
  }));

  await page.screenshot({ path: dest, fullPage: full });
  await browser.close();

  console.log(`[peek] ${rel}`);
  console.log(`       ${width}x${height}${full ? ' (full page)' : ''}  page height ${box.scrollH}px  ${box.text} chars of text`);
  console.log(`       -> ${dest}`);
  if (box.text < 40) console.log('       ⚠ almost no text on this page — it probably rendered empty.');
  if (problems.length) {
    console.log('       page errors:');
    for (const p of problems) console.log('         ' + p);
  }
}

main().catch((e) => { console.error('[peek] FAILED\n' + e.stack); process.exit(1); });
