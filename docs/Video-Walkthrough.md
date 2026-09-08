# The walkthrough video — how it is made

A silent, captioned, English-language walkthrough of the whole platform, built
as one MP4 per chapter plus a combined master. No narration; every explanation
is a caption card on screen.

Nothing here touches shipping code. Everything it generates lands in
`.visual/video/`, which is git-ignored.

---

## The three stages

```
  frontend/test/shots/video*.dump.jsx        Stage A — render the screens
        │  vitest + jsdom, real components, sample data
        ▼
  .visual/video/stage/<chapter>/*.html       self-contained, file:-loadable
        │
        │  e2e/video/record.js  →  composer.html + shots/<chapter>.js
        ▼                          Stage B — direct and film
  .visual/video/raw/<chapter>.webm
        │
        │  scripts/video/build.mjs           Stage C — encode
        ▼
  .visual/video/out/<chapter>.mp4
```

### Stage A — staging the screens

`frontend/test/shots/videoStage.js` holds the shared helpers; each chapter is a
`videoCh*.dump.jsx` beside it.

```bash
cd frontend
npx next build                                    # once — supplies the real CSS
npx vitest run --config vitest.shots.config.mjs test/shots/videoCh11Guest.dump.jsx
```

The probes render the **real shipping components** with sample data and write a
complete HTML document with the built stylesheet and the self-hosted fonts
inlined.

Two things `videoStage.js` does that are easy to get wrong:

- **The CSS comes from `.next/static/chunks/*.css`, all of them concatenated.**
  `globals.css` is useless alone (`@import "tailwindcss"` generates nothing
  outside a build), and the `.fx-*` primitives are not in the largest chunk. It
  asserts `.fx-grid` and the Aboreto `@font-face` are present and throws if not,
  so a stale build fails loudly instead of filming a page with no grid in the
  wrong typeface.
- **Font URLs are `encodeURI`d.** This repo lives under `C:/Users/yousef amr/`,
  and a raw space inside an unquoted CSS `url()` ends the token — the face falls
  back with no error anywhere.

Unlike the still probes, the video stager does **not** freeze animation. CSS
animation should play. What still has to be settled inside the probe is
JS-driven animation: framer-motion mounts at `opacity: 0` and animates up over
rAF, so `settle(act)` pumps it in 250ms slices. One long `await` inside a single
`act()` is not equivalent and settles worse — React needs a commit point between
slices.

Note the file naming: `vitest.shots.config.mjs` includes exactly
`test/shots/*.dump.jsx`, one level deep. A `video/` subfolder would be collected
by nothing and stage silently, so the chapters use a `video` prefix instead.

### Filming the RUNNING application — `--live`

```bash
cd frontend && npx next start -p 3111        # the existing production build
node e2e/video/record.js <chapter> --live --verify
node e2e/video/record.js <chapter> --live
VIDEO_TRACE=1 node e2e/video/record.js …     # log every intercepted call
```

Staged HTML is the real components, but React is not running in it: a click
cannot open a dialog. `--live` films the actual application instead, with no
database, and a shot list may mix `screen:` (staged file) and `app:` (a route
on the running app) freely. The new `tap` step moves the cursor, plays the
ripple, and then **really clicks** — tabs switch, menus open, modals appear.

Five things stand between "the app is running" and "the app is on film", and
each one fails in a way that looks like something else:

1. **`X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`** (next.config.mjs)
   — correct, and it must stay. The composer's iframe renders a blank white
   box. Stripped from document responses *on the recording machine only*; the
   header every real visitor gets is untouched.
2. **The auth middleware** checks only that `fancy_session` exists, has three
   parts and an unexpired `exp` — it does no signature verification and says so
   itself. A locally minted token gets past it.
3. **SameSite.** A `file:` composer framing `http://localhost` is *cross-site*,
   so a Lax cookie is withheld and every dashboard route bounces to `/login`.
   `None` is not the fix — Chromium drops `SameSite=None` without `Secure`, and
   this server is plain http. The fix is to serve the composer from the app's
   own origin (`/__composer`, fulfilled by a route), which also means the brand
   fonts must move from `file:` to a served `/__font/` path.
4. **CORS with credentials.** The API base is baked at build time, so calls are
   cross-origin and `apiFetch` sends them with `credentials: 'include'`. With
   credentials, `access-control-allow-origin: *` is rejected: echo the exact
   origin and set `allow-credentials`. Get it wrong and every fetch throws, the
   dashboard reads that as a dead session, and it redirects itself to `/login`
   while the server was happily returning 200.
5. **The app's own second gate.** `dashboard/page.js` redirects unless
   `localStorage.org_id` is set — the key the sign-in handler writes. Seeded
   with `addInitScript`. Without it the trace shows profile and events both
   fetched successfully, and then a navigation to `/login`.

Two more that only show up once the app is really running:

6. **A selector that is right when you dump it and wrong when you film it.**
   The sidebar links read `/dashboard?tab=guests` until an event is selected,
   and `/dashboard?event=evt-…&tab=guests` from then on. Match the stable part:
   `a[href*="tab=guests"]`. `boxIn` failures now print the frame URL, its size,
   the match count and the first links on the page, so this answers itself.
7. **`page.frames()` is the whole tree.** A live page carries frames of its own
   — the Google button mounts one on `/login` — so "the first non-blank frame"
   picked a nested one and every tap failed on a link that was plainly there.
   Take direct children of the composer only, last one wins.

Also: Playwright scrolls an element into view before clicking it, and that
scroll can walk the **composer** document — the stage slid up ninety pixels and
cropped its own browser chrome. `tap` resets it afterwards.

Fixtures live in `e2e/video/fixtures.js`, written to the shapes the
**controllers** actually return, wrapper included. Note that the guest list has
TWO shapes: `RSVPS` is what the UI components take as props (what the staged
probes feed them), and `RSVPS_API` is what the endpoint returns — name in
`label`, contacts on the party row with `is_primary_contact`, the table in
`seating_assignments`. Feeding the UI shape to the live app produced a list
with every aggregate correct and forty nameless cards reading "?" and
"NO NUMBER". Both are built from one source so they cannot drift.

### Stage B — directing and filming

```bash
node e2e/video/record.js <chapter> --verify   # a PNG per beat, no video
node e2e/video/record.js <chapter>            # the recording
```

`e2e/video/composer.html` is the 1920×1080 stage. It holds a **native-size**
iframe of the staged screen and paints the explanatory layer over it: cursor,
click ripple, highlight ring, caption card, chapter tag, title card. Playwright
drives it through `window.D`.

Playwright is used rather than `chrome --screenshot` because it is already
installed in `e2e/` with its browsers, and `e2e/` is **not** an npm workspace —
so using it cannot trigger the workspace-install trap. It also avoids all four
traps of the shell-Chrome route: the ~40s cold start per frame, Chrome's ~500px
minimum window on Windows, `--screenshot` silently writing nothing when the path
has a space in it, and a stale profile making later calls exit successfully
having written nothing.

**The iframe is never CSS-scaled.** A `transform: scale()` on an iframe makes it
paint only its own unscaled surface and the bottom half of the capture comes out
black. Screens are composed at true size instead: phone 390×844, browser
1440×900, both of which fit 1920×1080 with room for a device shell.

Steps available in a shot list (`e2e/video/shots/<chapter>.js`):

| step | what it does |
|---|---|
| `title` / `titleShow` / `titleHide` | full-frame chapter card |
| `tag` | the persistent corner chapter label |
| `show` | crossfade to a staged screen (`device: 'phone' \| 'browser'`) |
| `caption` | the explanation card; accepts `steps: []` for a numbered list |
| `move` / `click` | cursor to a selector, then a click ripple |
| `ring` / `unring` | gold highlight around a real element, clamped to the screen |
| `scroll` | hand-eased scroll of the staged page, by y or to a selector |
| `setClass` | toggle the component's **own** state class |
| `playVideo` | play a real `<video>` in the staged screen and wait for it |
| `wait`, `hideCaption`, `hideCursor` | |

`ring` and `move` **throw** when their selector is not found, naming the
selector and the step index. A ring that quietly does not draw would be
invisible until someone watched the whole thing.

### Stage C — encoding

```bash
node scripts/video/build.mjs <chapter>
node scripts/video/build.mjs --master ch01 ch02 …   # + timecodes.txt
```

H.264 / MP4 / `yuv420p`, silent, `+faststart`. WebM is fine to watch and awkward
to hand to anyone; MP4 is what plays everywhere without asking. The build refuses
to finish if the encode came out more than 1.5s shorter than expected, because a
silently truncated chapter is worse than a failed build.

---

## The visual language

The film wears the PRODUCT'S theme, read from `frontend/src/app/globals.css` —
not invented for the video:

| token | value | used for |
|---|---|---|
| `--background` | `#FFFFFF` | cards, device screens |
| `--warm-ivory` | `#F8F4EC` | the paper ground the whole film sits on |
| `--deep-charcoal` | `#191B1E` | headings and body ink |
| `--muted-stone` | `#5E5A52` | caption body |
| `--card-border` | `#E8E2D6` | every hairline |
| `--champagne-gold` / `--gold-cta` | `#B8944F` / `#8A6D34` | accents only |

Type is the product's own stack: **Aboreto** for titles and the corner tag,
**Google Sans** for body. `brandFontCss()` in `record.js` lifts every
`@font-face` the Next build wrote and asserts the four the composer depends on
are present.

Gold is an accent — a hairline on the caption card, the kicker rule, the focus
brackets, the progress bar — never a surface. The film should look like a page
of the site, not a different product wearing its logo.

- **The device is an object**: a pale bezel, a contact shadow, a side button.
  Without the contact shadow the phone floats.
- **The highlight is a focus, not a border**: on a light theme "dim everything
  else" is a *whitening wash*, not a shadow — a dark scrim would punch a hole in
  the paper. Four gold corner brackets set on the target.
- **Nothing ever travels across the screen.** No glare, no sheen, no light
  sweep. It would look expensive for one second and cost legibility for the
  rest, which is the entire point of the film.
- Both devices sit LEFT with the caption in the column beside them. The browser
  is 1120×860 — a real desktop width, the width the dashboard screens are
  already staged at, and it leaves a 592px column for the explanation. At
  1440×900 there was nowhere for the caption to go.

## Failure modes worth remembering

**1. The film opened on twenty seconds of white.** Playwright starts recording
the moment a page exists, so the file begins with `about:blank`, first paint and
the font load. Trimming that by the measured wall clock does not work — the video
pipeline itself takes seconds to come up, so the wall clock over-states the
offset and the trim eats the opening titles. The fix is to make the number small
rather than measure a big one accurately: `record.js` loads the composer in a
throwaway page first, so the filmed page reaches ready in under two seconds.
Every shot list also opens with a deliberate 2.5s black hold that absorbs the
residual error in both directions.

**2. A hole in the film while a screen loaded.** A `show` step spends real
seconds fetching a page, its artwork and (for the cinematic templates) a 680KB
MP4. Run in the open, that is a gap of empty backdrop. The title card is a
full-frame overlay, so load the first screen **behind** it: `titleShow` → `show`
→ `titleHide`. Every chapter should open this way.

**3. A half-applied state machine.** React is not running inside a staged page,
so a class it would have toggled has to be toggled by the recorder. Do the whole
sequence, not the interesting half. `WaxEnvelopeOpening` drives
`idle → arming → playing → revealed → done` and renders one of them at a time;
setting only `is-playing` left "touch to break the seal" printed across the
entire opening. The class names are the component's own and the CSS is the
shipped `cinematic.css` — what the recorder supplies is only the event.

**4. The opening title lost its heading and both rules.** Content was written
and the class that starts the entrance animations added in the same task, so the
very first card animated against a layout that had not resolved. Every later
card — by then warm — was perfect, which is what made it look like a fluke.
`titleShow` and `caption` now wait two animation frames between writing content
and starting: one rAF queues before style recalc, the second lands after it.

**5. The dimming scrim ate the caption.** The focus scrim darkens everything
outside the highlight; with the caption card beneath it, the paper turned grey
and the whole frame went muddy. The caption is the explanation OF the highlight,
so it sits ABOVE the scrim — `#caption` is z-index 30, `#focus` 28.

**6. The film ended on the wrong shot.** `title` dismisses its own card, and
`record.js` holds the recording open for another 900ms so a chapter never ends on
a hard cut — which handed the last second back to whatever screen was underneath.
Close a chapter with `titleShow` and a `wait`, not `title`.

**7. Every form on every screen rendered empty.** A controlled
`<select value>`, `<input value>` or `<input checked>` sets a DOM *property*,
and properties are not serialised by `innerHTML` — so a fully seated guest list
staged with every table assignment showing "No Table". It reads as DATA, not as
a bug: an event where nobody has been seated. `videoStage.js` now reflects live
form state back onto the markup as attributes, which is why `stageScreen` takes
the render **container** rather than a string.

**8. `React is not defined`.** vitest compiles JSX with the CLASSIC runtime, so
every component needs `React` in scope; Next uses the automatic runtime, so a
component that never touches the React namespace has no reason to import one.
Probes set `global.React = React` rather than switching the shared
`vitest.shots.config.mjs`, which every other probe already runs green under.

**9. The sign-up page's artwork was a grey box.** Several pages set their
imagery in a styled-jsx block rather than on an `<img>`, so rewriting only the
markup left `url('/images/auth-bg.png')` pointing at the filesystem root.
`relativise()` is applied to the injected CSS as well as the body.

**10. Three field names that are not negotiable**, each found by staging the
screen and reading it: `tableId` (camelCase — the snake_case `table_id` makes
every seated guest render "No Table"), `guests` as the party table with
`{ full_name, is_primary_contact }` rows (without `full_name` it prints
"Unnamed guest"), and `sms_consent` (without it every guest is badged "hasn't
agreed to texts" and the messaging chapter contradicts itself).

**11. The caption took the phone's geometry on a desktop screen** and hung
700px off the right edge with its text cut in half, because it defaulted to
`'phone'` when a shot list forgot `device: 'browser'`. The composer now
remembers the device from the last `show`.

**12. A page fetched its data and rendered an empty state.** The analytics page
unwraps defensively — `res?.events || res?.data || []` and `res?.analytics ||
null` — so a mock answering the bare array or bare payload left it on "No events
yet". Worse, the second attempt returned the right *shape* with the wrong *key
names* (`views` for `totalPageViews`, `responseRate` for `conversionRate`, a
funnel of `{label,value}` for `{step,count,dropOff}`) and every tile read 0.
Both failures look like a product with no analytics. Read the destructuring in
the page, do not infer the payload.

**13. `manualRef` is a payment reference STRING, not a React ref.**
`StagePayment` renders `{manualRef}` directly, so `{ current: null }` throws
"Objects are not valid as a React child".

**14. The film contradicted itself about who was getting married.**
`templateShots.dump.jsx` gives every template a different sample couple so the
marketing rows do not repeat a name — Swan Lake's is "Adam & Mira". Borrowing
its staged cover and hero put an envelope and an invitation reading *Adam &
Mira* three shots before an entry pass reading *Nadia & Omar*. A chapter stages
its own couple, from its own fixture. Related: `WaxEnvelopeOpening` renders
`{names}` straight out, so an ARRAY of two strings concatenates with no
separator — "NadiaOmar". It takes a string.

**15. A wedding pass that said 11:30 AM.** `event_date` is a real instant and
the pass renders it in the organizer's zone. With a venue in Alexandria and the
harness's `America/Los_Angeles` default, the data was true and the frame was
obviously wrong. The zone belongs with the venue.

Also: hide the caption **before** cutting to a new screen, or the previous
screen's explanation hangs over the new one for the length of the crossfade and
reads as the caption being wrong rather than late.

---

## What this is and is not

The screens are the real components rendering sample data — not a recording of a
live site, because the app cannot run on this machine (no server, no database).
A click therefore cannot really open a dialog: the cursor moves to the control,
a ripple plays, and the film cuts to the staged screen that shows the result.

CSS animation and the cinematic `<video>` openings play for real. JS-driven
motion (framer-motion transitions, React state) is shown as cuts between staged
states. Anything that genuinely needs a live server — Stripe checkout, QR camera
scanning — is shown as its screen with the flow explained in the caption, and the
caption says so.

---

## Chapters

| # | Chapter | Status |
|---|---|---|
| — | `pilot` | superseded by `guest`; kept only as the dark-theme reference |
| — | `journey` | **built LIVE** — 203s, the running application with real clicks on real links: landing → sign-up → sign-in → dashboard → events → guests → RSVP form → invitations → link & QR → seating → analytics → profile |
| — | `organizer` | built (staged HTML fallback, no server needed) — 200s: landing → sign-up → sign-in → template wizard → payment → dashboard → events → guests → invitations & texting → link & QR → seating → analytics → profile |
| — | `guest` | **built** — 85s: the link → the sealed envelope → the seal breaking (a real MP4) → the invitation → the reply → what "yes" opens → the entry pass |
| — | `fancy-full-walkthrough` | **built** — 4m 45s, the two chapters joined, with `timecodes.txt` |
| 00 | What Fancy is | |
| 01 | The public site & shop | |
| 02 | Account | |
| 03 | Create an event | |
| 04 | Event settings | |
| 05 | Guest list & RSVP form | |
| 06 | Invitations & replies | |
| 07 | Text messages | |
| 08 | Seating | |
| 09 | Check-in | |
| 10 | Analytics & referrals | |
| 11 | The guest journey | staged: `rsvp-choice` |

Out of scope by decision: the internal admin panel and the Android check-in app.
