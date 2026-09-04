/* Stages the admin finance page's "cash payments awaiting approval" panel so it
   can be LOOKED AT. Output lands in .visual/pending-cash/.

     npx vitest run --config vitest.shots.config.mjs test/shots/pendingCashProbe.dump.jsx

   Then, from .visual/pending-cash:

     chrome --headless=new --disable-gpu --hide-scrollbars \
       --allow-file-access-from-files --force-device-scale-factor=2 \
       --window-size=1000,900 --virtual-time-budget=3000 \
       --screenshot=shot-rows-960.png frame-rows-960.html

   WHY. This panel is a money surface — its button marks an event PAID — and it
   renders a table, which is the shape most likely to push a page sideways on a
   narrow window. Neither risk is visible to a string assertion. */
import React from 'react';
import { describe, it } from 'vitest';
import { render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import PendingCashPanel from '../../src/app/admin/(panel)/finance/PendingCashPanel';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'pending-cash');
const GLOBALS = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');

function fontFaces() {
  const dir = path.join(ROOT, '.next/static/chunks');
  if (!fs.existsSync(dir)) throw new Error('No .next build. Run `npx next build` first.');
  const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const media = encodeURI(path.join(ROOT, '.next/static/media').split(path.sep).join('/'));
  const faces = css.replace(/url\(\.\.\/media\//g, `url(file:///${media}/`).match(/@font-face\{[^}]*\}/g);
  if (!faces) throw new Error('No @font-face in the built CSS — the font pipeline moved.');
  return faces.join('\n');
}

/*
 * The ground comes from `--admin-bg`, NOT from a literal.
 *
 * This hard-coded `#F7F7F5` at first, and the capture was worthless in a way
 * that looked like a component bug: globals.css redefines every `--admin-*`
 * token inside `@media (prefers-color-scheme: dark)`, headless Chrome reports
 * dark, so the panel rendered its dark palette — light heading text — on a
 * forced light page. The heading came out invisible and the component was fine.
 *
 * Reading the token means the ground always matches whichever palette the tokens
 * resolved to, so the probe answers a real question in either scheme.
 */
const VARS = `
  :root {
    --font-sans: "Google Sans", system-ui, sans-serif;
    --font-serif: "Cormorant Garamond", "Cormorant Garamond Fallback", Georgia, serif;
  }
  html, body { margin: 0; padding: 0; background: var(--admin-bg); }
  .stage { padding: 24px; }
`;

/* The shape GET /admin/pending-payments actually returns — `event_payments.*`
   with a nested `events(id, title, organizations(name, email))`. Written from
   the controller's own select (paymentController.getPendingPayments) rather than
   invented: a fixture that does not match the real join renders every cell as
   an em dash and the probe photographs an empty table looking tidy. */
const ROWS = [
  {
    id: 'p1',
    amount_cents: 240000,
    created_at: '2026-08-28T17:20:00.000Z',
    events: {
      id: 'e1',
      title: 'Nadia & Karim — Wedding',
      organizations: { name: 'Bayt Al Nour Events', email: 'hello@baytalnour.example' },
    },
  },
  {
    id: 'p2',
    amount_cents: 75000,
    created_at: '2026-08-30T09:05:00.000Z',
    events: {
      id: 'e2',
      // Long on purpose: a real organizer name is longer than a designer's.
      title: 'The Al-Mansouri Family Reunion and Fiftieth Anniversary Celebration',
      organizations: {
        name: 'Coastline Weddings & Events of Greater San Diego',
        email: 'accounts@coastlineweddings.example',
      },
    },
  },
];

describe('pending cash panel probe', () => {
  it('stages the panel with rows, empty and erroring', async () => {
    fs.mkdirSync(OUT, { recursive: true });

    const states = {
      rows: { rows: ROWS, loading: false, error: null, approving: null },
      // The state an admin sees on a good day, and the one most likely to be
      // written carelessly — it must read as "nothing to do", not as a fault.
      empty: { rows: [], loading: false, error: null, approving: null },
      busy: { rows: ROWS, loading: false, error: null, approving: 'p1' },
      error: { rows: [], loading: false, error: 'Could not load cash payments.', approving: null },
    };

    for (const [name, props] of Object.entries(states)) {
      const r = render(
        <PendingCashPanel
          {...props}
          onApprove={() => {}}
          onRetry={() => {}}
        />,
      );
      fs.writeFileSync(path.join(OUT, `${name}.html`),
        `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${fontFaces()}</style><style>${GLOBALS}</style><style>${VARS}</style></head>
<body><div class="stage">${r.container.innerHTML}</div></body></html>`, 'utf8');
      r.unmount();
    }

    /* 390 is the phone the dashboard mobile pass targets; 960 is the admin
       panel's real content column. A table at 390 is the interesting one. */
    for (const w of [390, 960]) {
      for (const name of Object.keys(states)) {
        fs.writeFileSync(path.join(OUT, `frame-${name}-${w}.html`),
          `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#666;}
  iframe{display:block;width:${w}px;height:760px;border:0;background:#F7F7F5;}
</style></head><body><iframe src="${name}.html" scrolling="no"></iframe></body></html>`, 'utf8');
      }
    }

    // eslint-disable-next-line no-console
    console.log('STAGED', Object.keys(states).join(', '), '->', OUT);
  });
});
