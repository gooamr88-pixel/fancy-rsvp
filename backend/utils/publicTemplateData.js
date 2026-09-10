/**
 * WHAT OF `events.template_data` A GUEST IS ALLOWED TO SEE.
 *
 * ── The leak this closes ──
 *
 * `template_data` is a free-form JSON column holding whatever the chosen
 * template needs: the couple's names, the love story, ceremony and reception
 * venues, gift-registry details, FAQ entries. Two public endpoints —
 * `getPublicEventBySlug` and `getRsvpInvite` — stripped `access_password` and
 * then spread the rest of the event row wholesale, `template_data` included.
 *
 * That column also carries `partner1_email` and `partner2_email`: the groom's
 * and bride's PERSONAL addresses, collected on the settings screen for one
 * reason only — so this platform can copy them on each RSVP notification
 * (rsvpController). No guest-facing surface has ever rendered them.
 *
 * So on a `public`-privacy event, anybody who could load the invitation could
 * read both addresses out of the JSON payload, with no authentication at all.
 *
 * ── Why this is a pattern and not a whitelist ──
 *
 * A whitelist is the usual advice and is wrong here. The key set is defined by
 * the TEMPLATES, grows every time one is added (`WEDDING_FIELD_KEYS`,
 * `HA_SECTION_FIELD_KEYS`, `CUSTOM_CATEGORY_FIELD_KEYS` in the wizard, and more
 * to come), and every one of those keys is content the guest page exists to
 * render. A whitelist would therefore have to be edited in lockstep with every
 * new template, and the failure when somebody forgot would be silent and
 * user-visible: a field the organizer filled in that simply never appears.
 *
 * The private keys, by contrast, are a small and stable category — ways to
 * CONTACT the hosts, kept beside the content rather than being content. So the
 * rule is expressed as what it is: anything that holds a contact detail is
 * stripped, matched by shape (`*_email`, `*_phone`) rather than by name, so a
 * `partner3_email` added next year is private the day it is created and nobody
 * has to remember this file exists.
 *
 * Erring toward stripping is also the safe direction: the worst case is a
 * missing line on a guest page, which is visible and reportable. The worst case
 * the other way is what this replaced.
 */

/**
 * Key shapes that never leave the server.
 *
 * `_email` and `_phone` cover the contact fields. `_iban` and `account` cover
 * the gift-transfer details, which ARE deliberately shown to guests today —
 * see the exception list below, which puts them back.
 */
const PRIVATE_KEY_PATTERNS = [
  /_email$/i,
  /_phone$/i,
];

/**
 * Keys that match a private pattern but are genuinely public.
 *
 * There are none today. The list exists so that the day one appears, it is
 * added HERE — named, in one place, with the reason beside it — rather than by
 * loosening a pattern and quietly widening the whole category.
 */
const PUBLIC_EXCEPTIONS = new Set([]);

/** True when this key must not reach a guest. */
function isPrivateTemplateKey(key) {
  if (PUBLIC_EXCEPTIONS.has(key)) return false;
  return PRIVATE_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * A copy of `template_data` safe to serve on a public endpoint.
 *
 * Shallow by design: every private key sits at the top level, and recursing
 * would mean walking organizer-authored arrays (FAQ entries, menu courses) on
 * the hottest endpoint in the product for no benefit.
 *
 * @param {object|null|undefined} templateData
 * @returns {object} always an object, never null — callers spread it
 */
function publicTemplateData(templateData) {
  if (!templateData || typeof templateData !== 'object' || Array.isArray(templateData)) return {};
  const out = {};
  for (const [key, value] of Object.entries(templateData)) {
    if (isPrivateTemplateKey(key)) continue;
    out[key] = value;
  }
  return out;
}

module.exports = {
  publicTemplateData,
  isPrivateTemplateKey,
  PRIVATE_KEY_PATTERNS,
  PUBLIC_EXCEPTIONS,
};
