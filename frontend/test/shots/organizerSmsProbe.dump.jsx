/* Stages the organizer's SMS opt-in panel so it can be LOOKED AT.
   Output lands in .visual/organizer-sms/.

     npx vitest run --config vitest.shots.config.mjs test/shots/organizerSmsProbe.dump.jsx

   Then photograph each frame (run from .visual/organizer-sms):

     chrome --headless=new --disable-gpu --hide-scrollbars \
       --allow-file-access-from-files --force-device-scale-factor=2 \
       --window-size=760,900 --virtual-time-budget=4000 \
       --screenshot=shot-390.png frame-390.html

   WHY THIS PROBE EXISTS. The panel is a compliance surface: the Twilio TFV
   submission quotes the consent sentence, and the rule that the independence
   notice sits OUTSIDE the checkbox label is a LAYOUT rule, not a code rule. A
   string assertion cannot tell whether the notice reads as part of what the
   organizer is ticking. Only looking can. */
import React from 'react';
import { describe, it } from 'vitest';
import { render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import OrganizerSmsPanel from '../../src/app/dashboard/campaigns/OrganizerSmsPanel';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'organizer-sms');
const GLOBALS = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');

/* The REAL typefaces. The panel heading is set in the serif the dashboard uses,
   and a probe that silently falls back to Times is not showing the design. */
function fontFaces() {
  const dir = path.join(ROOT, '.next/static/chunks');
  if (!fs.existsSync(dir)) throw new Error('No .next build. Run `npx next build` first.');
  const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const media = encodeURI(path.join(ROOT, '.next/static/media').split(path.sep).join('/'));
  const withFonts = css.replace(/url\(\.\.\/media\//g, `url(file:///${media}/`);
  const faces = withFonts.match(/@font-face\{[^}]*\}/g);
  if (!faces) throw new Error('No @font-face in the built CSS — the font pipeline moved.');
  return faces.join('\n');
}

const VARS = `
  :root {
    --font-heading: "Aboreto", "Aboreto Fallback";
    --font-body: "Google Sans";
    --font-sans: "Google Sans", system-ui, sans-serif;
    --font-serif: "Cormorant Garamond", "Cormorant Garamond Fallback", Georgia, serif;
  }
  html, body { margin: 0; padding: 0; background: #F3F4F1; }
  /* The dashboard content gutter, so the card is measured with the padding it
     actually has rather than edge to edge. */
  .stage { padding: 24px; }
`;

describe('organizer sms opt-in probe', () => {
  it('stages the panel in both states, at three widths', async () => {
    fs.mkdirSync(OUT, { recursive: true });

    /* Both states matter and they differ structurally, not just in colour:
       consented adds a second button ("Stop texting me") to the action row,
       which is the thing most likely to wrap badly on a phone. */
    const states = {
      empty: { consent: false, phone: '' },
      consented: { consent: true, phone: '+1 555 123 4567' },
    };

    for (const [name, organizerSms] of Object.entries(states)) {
      const r = render(
        <OrganizerSmsPanel
          apiUrl="https://example.invalid/api/v1"
          eventId="probe-event"
          organizerSms={organizerSms}
          onSaved={() => {}}
        />,
      );

      fs.writeFileSync(path.join(OUT, `${name}.html`),
        `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${fontFaces()}</style><style>${GLOBALS}</style><style>${VARS}</style></head>
<body><div class="stage">${r.container.innerHTML}</div></body></html>`, 'utf8');

      r.unmount();
    }

    /* Shot through an IFRAME: Chrome on Windows will not open a window under
       ~500px, so --window-size=390 lays out at 500 and crops. 390 is the phone
       the dashboard mobile pass targets; 1280 is the desktop column. */
    for (const w of [390, 768, 1280]) {
      for (const name of Object.keys(states)) {
        fs.writeFileSync(path.join(OUT, `frame-${name}-${w}.html`),
          `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#666;}
  iframe{display:block;width:${w}px;height:820px;border:0;background:#F3F4F1;}
</style></head><body><iframe src="${name}.html" scrolling="no"></iframe></body></html>`, 'utf8');
      }
    }

    // eslint-disable-next-line no-console
    console.log('STAGED', Object.keys(states).join(', '), '->', OUT);
  });
});
