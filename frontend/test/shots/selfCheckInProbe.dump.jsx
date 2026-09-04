/* Stages the guest's "I've arrived" control so it can be LOOKED AT.
   Output lands in .visual/self-checkin/.

     npx vitest run --config vitest.shots.config.mjs test/shots/selfCheckInProbe.dump.jsx

   Then, from a directory whose path has NO SPACES (Chrome's --screenshot
   silently writes nothing otherwise):

     chrome --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
       --allow-file-access-from-files --force-device-scale-factor=2 \
       --window-size=430,520 --virtual-time-budget=3000 \
       --screenshot=shot-idle-390.png frame-idle-390.html

   This is guest-facing and sits under a QR code someone is holding up at a
   door, so its three states have to be distinguishable at a glance in bad
   light: an action, a confirmation, and a refusal. */
import React from 'react';
import { describe, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

/* The three states are reached through the network, so the network decides
   which one is staged. No component prop exposes them — deliberately: a state
   the component can be TOLD to be in is not the state the guest will see. */
const outcomes = {
  idle: null,
  done: async () => ({ tableName: 'Table 12' }),
  already: async () => {
    const err = new Error('You are already checked in.');
    err.code = 'ALREADY_CHECKED_IN';
    err.meta = { tableName: 'Table 12' };
    throw err;
  },
  error: async () => {
    const err = new Error('Event is not active.');
    err.code = 'EVENT_INACTIVE';
    throw err;
  },
};

let current = null;
vi.mock('../../src/app/utils/publicApi', () => ({
  publicApiFetch: (...args) => (current ? current(...args) : Promise.resolve({})),
  PublicApiError: class extends Error {},
  API_URL: 'https://example.invalid/api/v1',
}));

import SelfCheckIn from '../../src/app/ticket/[token]/SelfCheckIn';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'self-checkin');
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

/* The ticket card's own surround, so the control is judged against the white
   pass it actually sits on rather than against a bare page. */
const VARS = `
  :root {
    --font-sans: "Google Sans", system-ui, sans-serif;
    --font-serif: "Cormorant Garamond", "Cormorant Garamond Fallback", Georgia, serif;
  }
  html, body { margin: 0; padding: 0;
    background: radial-gradient(120% 100% at 50% 0%, #EFE2C233 0%, #F8F4EC 45%, #EFE6D4 100%); }
  .stage { padding: 24px; }
  .pass { background:#fff; border-radius:20px; padding:26px 32px;
          box-shadow:0 36px 90px -24px rgba(110,74,34,.38); }
`;

describe('self check-in probe', () => {
  it('stages every state the guest can land in', async () => {
    fs.mkdirSync(OUT, { recursive: true });

    for (const [name, impl] of Object.entries(outcomes)) {
      current = impl;
      let r;
      await act(async () => {
        r = render(
          <SelfCheckIn slug="nadia-and-omar" partyId="p-1" guestName="Nadia Hassan" themeColor="#B8944F" />,
        );
      });

      // idle needs no click; the other three are reached by pressing the button.
      if (impl) {
        const btn = r.container.querySelector('button');
        await act(async () => { btn.click(); });
        await act(async () => { await new Promise((res) => setTimeout(res, 30)); });
      }

      fs.writeFileSync(path.join(OUT, `${name}.html`),
        `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${fontFaces()}</style><style>${GLOBALS}</style><style>${VARS}</style></head>
<body><div class="stage"><div class="pass">${r.container.innerHTML}</div></div></body></html>`, 'utf8');

      r.unmount();
    }

    /* Through an IFRAME: Chrome on Windows will not open a window under ~500px,
       so --window-size=390 lays out at 500 and crops. */
    for (const name of Object.keys(outcomes)) {
      fs.writeFileSync(path.join(OUT, `frame-${name}-390.html`),
        `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#666;}
  iframe{display:block;width:390px;height:340px;border:0;}
</style></head><body><iframe src="${name}.html" scrolling="no"></iframe></body></html>`, 'utf8');
    }

    // eslint-disable-next-line no-console
    console.log('STAGED', Object.keys(outcomes).join(', '), '->', OUT);
  });
});
