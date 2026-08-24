import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import { buildPreviewEvent, SAVED_EVENT_KEYS } from '../src/app/dashboard/create-event/components/previewEvent';

/* ═══════════════════════════════════════════════════════════════════════════
   The organizer's preview.

   The defect these guard against is specific and was live: the wizard panel
   labelled "Live Guest Journey" drew its own invitation, so an organizer could
   fill in every field and still be shown a hardcoded "The Grand Ballroom ·
   Plaza Hotel, New York". These tests exist to make that class of lie fail
   loudly rather than ship quietly.
   ═══════════════════════════════════════════════════════════════════════════ */

const WIZARD_STATE = {
  templateType: 'wedding',
  slug: 'nadia-and-omar',
  title: 'Nadia & Omar',
  description: 'Please join us.',
  eventDate: '2027-05-14T18:30:00',
  // The organizer's own clock, as the wizard now threads it in from their
  // profile. Named explicitly rather than left to the fallback so these
  // assertions describe a decision instead of a default.
  timeZone: 'America/Los_Angeles',
  locationName: 'Beit Al Qamar',
  locationAddress: '12 Corniche Road, Alexandria',
  dressCode: 'Garden formal',
  customColors: { primary: '#7d5694', secondary: '#c9a45c', background: '#f6f1e4' },
  templateData: { groom_name: 'Omar', bride_name: 'Nadia', ha_meal_options: 'Beef, Fish, Vegan' },
  // The shape FormBuilder writes and RsvpSection reads — field_label /
  // field_type / is_required, not label / type / required.
  customFields: [{ id: 'f1', field_label: 'Song request', field_type: 'text', is_required: false, condition: 'always' }],
  galleryUrls: [],
  noKidsAllowed: true,
  allowGuestEdits: true,
};

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

describe('buildPreviewEvent', () => {
  it('carries the organizer\'s own details, not placeholder copy', () => {
    const e = buildPreviewEvent(WIZARD_STATE);
    expect(e.title).toBe('Nadia & Omar');
    expect(e.location_name).toBe('Beit Al Qamar');
    expect(e.location_address).toBe('12 Corniche Road, Alexandria');
    expect(e.dress_code).toBe('Garden formal');
    // Converted through the organizer's zone, not passed through and not
    // stamped UTC. The wizard's datetime-local value has no zone designator, so
    // it is not a moment until someone says whose clock it is on — and the
    // preview has to answer that the same way the server will on save, or it
    // shows the organizer a different page from the one their guests get.
    //
    // 18:30 in San Diego on 14 May is 01:30 UTC on the 15th (PDT, UTC-7).
    // This used to assert '2027-05-14T18:30:00Z', which was correct while
    // event dates were the typed digits filed as UTC. See toStoredIso.
    expect(e.event_date).toBe('2027-05-15T01:30:00.000Z');
    expect(e.timezone).toBe('America/Los_Angeles');

    // And the same digits on a different clock must produce a different
    // instant — otherwise the zone is being accepted and ignored.
    const cairo = buildPreviewEvent({ ...WIZARD_STATE, timeZone: 'Africa/Cairo' });
    expect(cairo.event_date).toBe('2027-05-14T15:30:00.000Z');
    expect(e.template_type).toBe('wedding');
    expect(e.custom_colors.primary).toBe('#7d5694');
    expect(e.no_kids_allowed).toBe(true);
  });

  it('emits every key the wizard PATCHes when saving', () => {
    // The two must not drift: a field added to the save payload and forgotten
    // here is a field the organizer configures and never sees previewed.
    const e = buildPreviewEvent(WIZARD_STATE);
    const missing = SAVED_EVENT_KEYS.filter((k) => !(k in e));
    expect(missing, `buildPreviewEvent is missing ${missing.join(', ')}`).toEqual([]);
  });

  it('puts custom questions where the RSVP form actually reads them', () => {
    // `custom_form_fields`, not `custom_fields`. Getting this wrong renders a
    // perfect form with none of the organizer's questions in it.
    const e = buildPreviewEvent(WIZARD_STATE);
    expect(e.custom_form_fields).toHaveLength(1);
    expect(e.custom_form_fields[0].field_label).toBe('Song request');
  });

  it('coerces meal options the same way the save path does', () => {
    const e = buildPreviewEvent(WIZARD_STATE);
    expect(e.template_data.ha_meal_options).toEqual(['Beef', 'Fish', 'Vegan']);
  });

  it('leaves a blank date null so empty sections hide instead of showing Invalid Date', () => {
    const e = buildPreviewEvent({ ...WIZARD_STATE, eventDate: '' });
    expect(e.event_date).toBeNull();
  });

  it('never carries background music — a wizard panel must not start playing audio', () => {
    const e = buildPreviewEvent(WIZARD_STATE);
    expect(e.background_music_url).toBeNull();
  });
});

describe('the preview renders the real page', () => {
  /* Imported once. The FIRST render pulls the entire guest renderer — every
     section, the RSVP form, framer-motion — and that cost lands inside
     whichever test triggers it, which is what made this file's first test time
     out against the 15s default. */
  let GuestExperiencePreview;
  /* 150s, not the config's 15s hook timeout. This single import pulls the whole
     guest renderer — every section, the RSVP form, ALL FOUR cinematic openings
     (the preview loads them statically on purpose: a cover that has to
     round-trip for a chunk before it appears defeats the point of previewing
     it), framer-motion — and transforming that graph exceeds 15s whenever the
     suite is sharing a machine.

     It was 60s and a fourth template pushed it past that too. The number is a
     machine-speed allowance, not a claim about the code: when it is exceeded
     the whole FILE reports as failed and its four tests as skipped, which
     reads like the preview is broken. Raised HERE rather than in
     vitest.config so the global ceiling stays tight and only the hook that
     genuinely needs the room gets it. */
  beforeAll(async () => {
    ({ default: GuestExperiencePreview } = await import('../src/app/components/templates/GuestExperiencePreview'));
  }, 150000);

  const renderPreview = async (state = WIZARD_STATE, props = {}) => {
    let result;
    await act(async () => {
      result = render(
        <GuestExperiencePreview
          event={buildPreviewEvent(state)}
          playOpening={false}
          invitationPattern="serif"
          {...props}
        />,
      );
    });
    return result;
  };

  it('shows the organizer\'s own venue, not placeholder copy', async () => {
    const { container } = await renderPreview();
    const text = container.textContent;

    expect(text).toContain('Beit Al Qamar');
    expect(text).toContain('Nadia');
    // The exact strings the retired fabrication printed for every event.
    expect(text).not.toContain('Plaza Hotel');
    expect(text).not.toContain('The Grand Ballroom');
  }, 40000);

  it('mounts the real RSVP section rather than a mock sheet', async () => {
    const { container } = await renderPreview();
    expect(container.querySelector('#ha-rsvp')).toBeTruthy();
  }, 30000);

  it('surfaces the organizer\'s own custom question once a guest answers', async () => {
    // Everything below the yes/no choice is revealed by that choice — for a
    // guest and therefore in the preview too. Driving it is the only way to
    // prove the organizer's form builder actually reaches the page.
    const { container } = await renderPreview();

    const yes = screen.getByRole('radio', { name: /Yes, I'll be there/i });
    await act(async () => { yes.click(); });

    expect(container.textContent).toContain('Song request');
  }, 30000);

  it('plays the template\'s own opening, not a generic one', async () => {
    await renderPreview({ ...WIZARD_STATE, templateType: 'bab' }, { playOpening: true });
    expect(screen.getByTestId('cine-opening')).toHaveAttribute('data-opening', 'knockDoor');
  }, 30000);
});

describe('the preview cannot write anything', () => {
  it('a submit in preview mode never reaches the network', async () => {
    const publicApi = await import('../src/app/utils/publicApi');
    const spy = vi.spyOn(publicApi, 'publicApiFetch');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('the preview must not call fetch');
    });

    const { default: GuestExperiencePreview } = await import('../src/app/components/templates/GuestExperiencePreview');
    const event = buildPreviewEvent(WIZARD_STATE);

    await act(async () => {
      render(<GuestExperiencePreview event={event} playOpening={false} invitationPattern="serif" />);
    });

    // Mounting alone must be inert — nothing in the RSVP section may fetch on
    // render. (Seating and claim-link both sit behind a completed submit.)
    expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the fabrication is gone and stays gone', () => {
  const SRC = path.join(process.cwd(), 'src');

  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
    });
  }

  /* Comments stripped before matching. Several of these files explain in prose
     what they replaced and name the very strings being banned — matching the
     explanation would fail the check the explanation describes. */
  const strip = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const code = (file) => strip(fs.readFileSync(file, 'utf8'));

  /* Read the tree ONCE for the whole block. Walking ~500 files and stripping
     each was being repeated per test and tipped over the 15s timeout whenever
     the suite shared a machine — a green check turning red because of load,
     which is the least useful kind of failure. */
  let sources;
  beforeAll(() => {
    sources = walk(SRC).map((file) => ({ file, text: code(file) }));
  }, 60000);

  it('no source file mentions the retired mock scene', () => {
    const banned = /RSVPBottomSheet|DETAILS_DEMO|getSceneStyles|SceneParticles|DEFAULT_DETAILS_DEMO/;
    const offenders = sources.filter((s) => banned.test(s.text));
    expect(offenders.map((s) => path.relative(process.cwd(), s.file))).toEqual([]);
  });

  it('the wizard preview never hardcodes a demo venue', () => {
    /* InvitationCard keeps its own placeholder copy — that is legitimate, it
       is what an unfilled card shows in the marketing showcase. What must not
       happen is the PREVIEW reaching it: GuestExperiencePreview builds the
       card through buildInvitationCardData, so a card beside the organizer's
       real venue can never advertise a different one. */
    const previewFiles = [
      'app/components/templates/GuestExperiencePreview.js',
      'app/components/templates/MobilePreview.js',
      'app/dashboard/create-event/components/PreviewModal.js',
      'app/dashboard/create-event/components/previewEvent.js',
    ].map((p) => path.join(SRC, p));
    const offenders = previewFiles.filter((f) => /Plaza Hotel|Grand Ballroom/.test(code(f)));
    expect(offenders.map((f) => path.basename(f))).toEqual([]);
  });

  it('the preview does not drag the whole guest route into the wizard bundle', () => {
    /* Importing one named export from [slug]/EventPageClient still evaluates
       the module, pulling GuestUI, GuestAnimations, LegacyChrome and the
       analytics hooks into every bundle that renders the preview — i.e. the
       create-event wizard. The shared builder in utils/invitationCardData.js
       exists precisely so this import is unnecessary. */
    const src = code(path.join(SRC, 'app/components/templates/GuestExperiencePreview.js'));
    expect(src).not.toMatch(/from ['"].*\[slug\]\/EventPageClient['"]/);
    expect(src).toContain('utils/invitationCardData');
  });

  it('the browser bar shows a real slug rather than a fixed fake one', () => {
    const src = code(path.join(SRC, 'app/components/templates/MobilePreview.js'));
    expect(src).not.toContain('invite/jamil');
    expect(src).toContain('slug ||');
  });
});

describe('the real page is embeddable', () => {
  it('SnapShell fills its frame when embedded, and the viewport otherwise', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/components/templates/heritageArch/SnapShell.js'), 'utf8',
    );
    // 100dvh inside a phone frame means the BROWSER viewport, so the page
    // would overflow the frame and never scroll within it.
    expect(src).toContain("embedded ? '100%' : '100dvh'");
  });

  it('the modal frame establishes a containing block for the page\'s fixed chrome', () => {
    // Language pill, music toggle, calendar button, progress bar and both
    // cinematic openings are all position:fixed. Without a transformed
    // ancestor they escape the frame and scatter across the modal.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/dashboard/create-event/components/PreviewModal.js'), 'utf8',
    );
    expect(src).toContain('translateZ(0)');
  });
});

describe('rewired preview modules still load', () => {
  it.each([
    ['GuestExperiencePreview', () => import('../src/app/components/templates/GuestExperiencePreview')],
    ['MobilePreview', () => import('../src/app/components/templates/MobilePreview')],
    ['PhoneSimulator', () => import('../src/app/dashboard/create-event/components/PhoneSimulator')],
    ['Stage1_TemplatesSimulator', () => import('../src/app/dashboard/create-event/components/Stage1_TemplatesSimulator')],
    ['Stage2_FormConfiguration', () => import('../src/app/dashboard/create-event/components/Stage2_FormConfiguration')],
    ['PreviewModal', () => import('../src/app/dashboard/create-event/components/PreviewModal')],
  ])('%s imports cleanly', async (_name, load) => {
    expect(await load()).toBeTruthy();
  });
});
