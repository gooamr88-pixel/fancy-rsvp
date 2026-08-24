import { getCinematicTemplate } from '../components/templates/cinematic/cinematicThemes';

/* ═══════════════════════════════════════════════════════════════════════════
   What a guest actually opens.

   Five templates, five different arrivals — and three of them are an
   envelope, only one of which is the editable one:

     Velvet Ring   a velvet box on a dark stage; the guest touches it
     Door of Joy   a carved door; the guest knocks three times
     Swan Lake     an olive envelope whose ivory wax seal breaks on film —
                   photography, not the drawn seal, so still hasSeal: false
     Sealed Letter a blush envelope whose wax seal gilds and opens — a sprite
                   sheet rather than film, and again not the drawn seal
     everything    a wax-sealed envelope (InvitationReveal)

   The organizer's Design tab used to describe all of them as the third. It
   offered a "Seal Name / Monogram" field and a "Wax & paper tone" picker —
   both read ONLY by InvitationReveal, so both were dead on two of the three
   templates — under the heading "Invitation Seal & Stationery", with a button
   labelled "Preview the envelope" that mounted an envelope no Velvet Ring or
   Door of Joy guest will ever see. An organizer designing a wax seal for a
   template that opens on a velvet box is being confidently misinformed by the
   product about its own behaviour.

   `reveal_enabled` and `reveal_replay` are the two settings that genuinely
   apply to all three (see EventPageClient's showReveal / revealSessionKey —
   the same gate mounts whichever opening the template owns), which is exactly
   why their labels have to name the right thing.

   One resolver, so the settings screen, the preview modal and anything added
   later cannot disagree about which arrival an event has.
   ═══════════════════════════════════════════════════════════════════════════ */

const ENVELOPE = {
  key: 'envelope',
  /** Section heading in the Design tab. */
  title: 'Invitation Envelope',
  /** What the guest does, for the enable toggle. */
  toggleLabel: 'Open with the sealed envelope',
  toggleHint: 'On by default. Turn this off and guests land straight on the invitation, with no envelope to unseal.',
  replayLabel: 'Show the envelope again on every visit',
  previewLabel: 'Preview the envelope',
  intro: 'Guests arrive at a wax-sealed envelope addressed to them, and break the seal to open the invitation.',
  /** Whether seal_text and reveal_tone reach anything. Only here. */
  hasSeal: true,
};

const CINEMATIC_COPY = {
  velvetBox: {
    key: 'velvetBox',
    title: 'Invitation Opening',
    toggleLabel: 'Open with the velvet box',
    toggleHint: 'On by default. Turn this off and guests land straight on the invitation, with no box to open.',
    replayLabel: 'Play the opening again on every visit',
    previewLabel: 'Preview the opening',
    intro: 'Guests arrive at a velvet ring box on a darkened stage. They touch it, the lid opens on film, and your invitation dissolves out of the light.',
    hasSeal: false,
  },
  knockDoor: {
    key: 'knockDoor',
    title: 'Invitation Opening',
    toggleLabel: 'Open with the carved door',
    toggleHint: 'On by default. Turn this off and guests land straight on the invitation, with no door to knock on.',
    replayLabel: 'Play the opening again on every visit',
    previewLabel: 'Preview the opening',
    intro: 'Guests arrive at a carved door and knock three times. It answers, swings open on the light beyond, and doves lift from the garden gate behind your names.',
    hasSeal: false,
  },
  waxEnvelope: {
    key: 'waxEnvelope',
    title: 'Invitation Opening',
    toggleLabel: 'Open with the sealed envelope',
    toggleHint: 'On by default. Turn this off and guests land straight on the invitation, with no envelope to unseal.',
    replayLabel: 'Play the opening again on every visit',
    previewLabel: 'Preview the opening',
    /* Says the seal is filmed, on purpose. This is the one opening with a wax
       seal that is NOT the editable one — an organizer who reads "wax seal"
       and finds no monogram field would reasonably think the control is
       missing, when in fact the seal is part of the footage. */
    intro: 'Guests arrive at an olive envelope closed with an ivory wax seal of two swans. They touch it, the seal breaks on film, the flaps fall open, and the card rises out — then its engraving fills with colour. The seal is part of the film, so there is nothing to letter here.',
    hasSeal: false,
  },
  sealedLetter: {
    key: 'sealedLetter',
    title: 'Invitation Opening',
    toggleLabel: 'Open with the sealed letter',
    toggleHint: 'On by default. Turn this off and guests land straight on the invitation, with no letter to open.',
    replayLabel: 'Play the opening again on every visit',
    previewLabel: 'Preview the opening',
    /* Says the seal is part of the artwork, for the same reason Swan Lake's
       does: an organizer who reads "wax seal" and finds no monogram field
       would reasonably conclude the control is missing. */
    intro: 'Guests arrive at a blush envelope closed with a burgundy wax seal. They touch it, the seal catches the light and gilds, and both flaps fall open onto your invitation. The seal is part of the artwork, so there is nothing to letter here.',
    hasSeal: false,
  },
};

/**
 * The arrival this template gives a guest.
 *
 * @param {string} templateType
 * @returns {{key: string, title: string, toggleLabel: string, toggleHint: string,
 *            replayLabel: string, previewLabel: string, intro: string,
 *            hasSeal: boolean, cinematic: object|null}}
 */
export function getTemplateOpening(templateType) {
  const cinematic = getCinematicTemplate(templateType);
  if (!cinematic) return { ...ENVELOPE, cinematic: null };
  return { ...CINEMATIC_COPY[cinematic.opening], cinematic };
}
