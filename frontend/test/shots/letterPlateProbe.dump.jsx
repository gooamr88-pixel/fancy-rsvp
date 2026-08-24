/* ═══════════════════════════════════════════════════════════════════════════
   THE SEALED LETTER PLATE, on the homepage.

   Sealed Letter is the one template whose plate does not show its opened page
   — it opens onto the couple's own photograph, and any hero shot here would
   be a stock couple standing in for theirs. So it shows the sealed envelope,
   says the rest in words, and carries a small stand-in illustration. That
   composition — an inset overlapping the device's corner, with a line of
   prose clearing its overhang — is the part no unit test can see.

   ── Why this is not landingPageProbe ─────────────────────────────────────
   That one needs `.next/static/chunks` for the real compiled `.fx-*`
   primitives, and there is no build here. This band's own look is entirely in
   its private `tss-*` style block, and the only `.fx-*` it uses are the
   container and the grid — both trivially stubbed below, and both verified by
   arithmetic in templatesShowcase.test.jsx rather than by eye. What is
   photographed here is the plate, which is what changed.

   ── Running it ───────────────────────────────────────────────────────────
        npx vitest run --config vitest.shots.config.mjs test/shots/letterPlateProbe.dump.jsx
        chrome --headless=new ... --screenshot=plate.png .visual/letter/plate.html
   ═══════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { describe, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import TemplatesShowcaseSection from '../../src/app/components/landing/TemplatesShowcaseSection';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'letter');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

/* The two primitives this band borrows from globals.css, at their real
   desktop values: --fx-w-5xl is 1280 and --fx-pad-x clamps to 48 at that
   width. The grid mirrors .fx-grid's auto-fit template exactly, so the column
   count here is the column count in production. */
const FX_STUB = `
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  .fx-container { width:100%; min-width:0; max-width:1280px; margin-inline:auto; }
  .fx-gutter { padding-left:48px; padding-right:48px; }
  .fx-grid {
    display:grid; min-width:0;
    gap: var(--fx-gap, 32px);
    grid-template-columns: repeat(auto-fit, minmax(min(var(--fx-col, 280px), 100%), 1fr));
  }
  .fx-grid > * { min-width: 0; }
`;

beforeEach(() => {
  // The band fetches the studio's WhatsApp number; the commission strip is not
  // what is being photographed and must not depend on a network.
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ settings: { whatsapp_number: '+15555550123' } }),
  }));
});

describe('landing — the Sealed Letter plate', () => {
  it('stages the invitations band', async () => {
    /* Awaited BEFORE render, not inside act(). The band is an async Server
       Component, so `TemplatesShowcaseSection()` is a promise of JSX — and
       resolving it inside the act callback left the outer binding empty and
       staged a blank page that photographed as pure white. Same shape as
       templatesShowcase.test.jsx's own renderBand(). */
    const tree = await TemplatesShowcaseSection();
    const { container } = render(tree);
    await act(async () => {});
    const html = container.innerHTML;
    if (!html.includes('tss-plate')) throw new Error('the band staged empty');

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'plate.html'),
      `<!doctype html><html lang="en"><head><meta charset="utf-8">
<base href="file:///${PUBLIC}/">
<style>${FX_STUB}</style>
</head><body>${html.replace(/\/images\//g, 'images/')}</body></html>`, 'utf8');
  });
});
