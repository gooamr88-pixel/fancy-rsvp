// Maps each InvitationCard pattern to its own celebration + ambient identity
// — the confetti burst on "Yes"/success, AND the quiet drifting particles
// present throughout the whole guest journey, should feel like they belong
// to THIS invitation, not a generic one-size-fits-all party popper.
const FAMILIES = {
  // Warm / desert / Mediterranean — gilded stars and rounded confetti
  tuscany:    { colors: ['#B8863B', '#D9C9A0', '#6B7A4F', '#FBF6EC', '#E8C564'], shapes: ['star', 'circle'], ambient: 'circle', ambientColor: '#D9C9A0' },
  marrakesh:  { colors: ['#D9A94E', '#E8B75E', '#F3E7D3', '#B5502F'], shapes: ['star', 'circle'], ambient: 'circle', ambientColor: '#D9A94E' },
  clay:       { colors: ['#B5502F', '#E6D5B8', '#7A4A32', '#F0DAC4'], shapes: ['star', 'circle'], ambient: 'circle', ambientColor: '#E6D5B8' },
  havana:     { colors: ['#FF7A59', '#2EC4B6', '#FFE08A', '#FFF8ED'], shapes: ['circle', 'star'], ambient: 'circle', ambientColor: '#FFE08A' },
  estate:     { colors: ['#1B2A41', '#8B6F1F', '#F3EEE1', '#2F4538'], shapes: ['rect', 'circle'], ambient: 'circle', ambientColor: '#8B6F1F' },

  // Garden / romantic — falling petals
  floral:      { colors: ['#E88FAC', '#F3D1DC', '#8B4A6B', '#FFFFFF'], shapes: ['petal'], ambient: 'petal', ambientColor: '#E88FAC' },
  roseAtelier: { colors: ['#C98A93', '#E9D8C5', '#F3E2DC', '#FFFFFF'], shapes: ['petal'], ambient: 'petal', ambientColor: '#C98A93' },
  kyoto:       { colors: ['#B23A48', '#D98B92', '#F7EFEE', '#FFFFFF'], shapes: ['petal'], ambient: 'petal', ambientColor: '#D98B92' },
  organic:     { colors: ['#8B7355', '#D4C5A9', '#FAF6EE', '#6B4226'], shapes: ['petal', 'circle'], ambient: 'petal', ambientColor: '#D4C5A9' },

  // Cool / winter / coastal — soft rings, drifting circles, and gentle snow
  alpine:  { colors: ['#D9C9A3', '#F5F1E6', '#7A2E2E', '#FFFFFF'], shapes: ['ring', 'circle'], ambient: 'snow', ambientColor: '#F5F1E6' },
  nordic:  { colors: ['#33495D', '#9FB4C4', '#EFF3F5', '#FFFFFF'], shapes: ['ring', 'circle'], ambient: 'snow', ambientColor: '#EFF3F5' },
  coastal: { colors: ['#2B5F5A', '#C9B896', '#E8F3EF', '#FFFFFF'], shapes: ['ring', 'circle'], ambient: 'circle', ambientColor: '#C9B896' },

  // Jewel-toned luxury — gilded stars on dark
  luxury: { colors: ['#D7BE80', '#E8D5A3', '#FBF6E9', '#FFFFFF'], shapes: ['star'], ambient: 'circle', ambientColor: '#D7BE80' },
  orchid: { colors: ['#C9A24B', '#EADCF0', '#8E4FA3', '#FFFFFF'], shapes: ['star'], ambient: 'circle', ambientColor: '#C9A24B' },

  // Editorial / geometric — crisp confetti, minimal ambient
  geo:     { colors: ['#3B82F6', '#1F2937', '#FFFFFF', '#9CA3AF'], shapes: ['rect'], ambient: 'circle', ambientColor: '#3B82F6' },
  minimal: { colors: ['#1A1A1A', '#D5CFC5', '#FFFFFF'], shapes: ['rect'], ambient: 'circle', ambientColor: '#D5CFC5' },

  /* The cinematic templates. They had no entry, so all three fell to the
     generic gold-ribbon default — the one moment of the journey that is
     supposed to feel like THIS invitation, in the same colours the guest has
     been looking at for the last two minutes. Keyed to each template's own
     `colors` in cinematic/cinematicThemes.js. */
  ring:  { colors: ['#d4af6a', '#ffe9b0', '#8f3c52', '#FFFFFF'], shapes: ['star', 'petal'], ambient: 'petal', ambientColor: '#d4af6a' },
  bab:   { colors: ['#a97fc0', '#c9a45c', '#7d5694', '#FFFFFF'], shapes: ['petal'], ambient: 'petal', ambientColor: '#a97fc0' },
  swans: { colors: ['#6d6f4e', '#5c2331', '#a98a5c', '#f8f4e9'], shapes: ['petal', 'circle'], ambient: 'petal', ambientColor: '#e8dcc0' },
  // Blush paper, burgundy wax and gold — the three colours a Sealed Letter
  // guest has been looking at since the cover.
  letter: { colors: ['#c39a8e', '#8c1f2b', '#c2a05a', '#fbf6ec'], shapes: ['petal', 'circle'], ambient: 'petal', ambientColor: '#c39a8e' },
};

const DEFAULT_FAMILY = { colors: undefined, shapes: ['ribbon', 'circle'], ambient: 'circle', ambientColor: '#D7BE80' };

/** Returns { colors, shapes, ambient, ambientColor } keyed by template_type. */
export function getCelebrationPreset(pattern) {
  return FAMILIES[pattern] || DEFAULT_FAMILY;
}
