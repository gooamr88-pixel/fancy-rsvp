/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Fancy RSVP — Premium transactional email templates.
 *
 * Every email the platform sends is built here from ONE shared, email-safe shell
 * so the brand identity stays consistent and rendering is reliable across Gmail,
 * Apple Mail and Outlook:
 *   • Table-based layout, fully inline critical CSS (a small <style> block adds
 *     responsive + hover as progressive enhancement only).
 *   • Brand palette: Gold #B8944F · Champagne #D7BE80 · Charcoal #191B1E · Ivory #F8F4EC.
 *   • Text wordmark header ("Fancy RSVP" in gold) — no image, never blocked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Escapes HTML entities to prevent XSS / markup injection in email templates.
 */
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Table names set on the organizer's seating map are typically a bare number
 * (e.g. "5") — shown alone, especially in a large font, that reads
 * ambiguously (a quantity? a code?). Prefixing "Table" makes it unambiguous;
 * skipped when the organizer already gave the table a descriptive name
 * (e.g. "Rose Garden") since prefixing there would just be noise.
 */
const formatTableLabel = (tableName, lang) => {
  const trimmed = String(tableName || '').trim();
  if (!trimmed) return '';
  if (!/^\d+$/.test(trimmed)) return trimmed;
  return String(lang || '').toLowerCase().startsWith('ar') ? `طاولة ${trimmed}` : `Table ${trimmed}`;
};

/**
 * A tappable "Get Directions" link for the venue, so a guest can actually
 * navigate there instead of just reading an address. Prefers exact
 * coordinates (set when the organizer picked the venue from the address
 * autocomplete); falls back to a text search on the address/name for venues
 * saved before coordinates were captured.
 */
const buildMapsUrl = (event) => {
  if (event?.location_lat != null && event?.location_lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${event.location_lat},${event.location_lng}`;
  }
  const query = event?.location_address || event?.location_name;
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
};

// Shared bulletproof resolver (splits commas, repairs typos, first valid https origin).
const { getPublicBaseUrl, getBackendBaseUrl } = require('./publicUrl');
const { formatInZone, zoneAbbreviation } = require('./timezone');

/**
 * The three URLs a signed QR ticket resolves to. Built here rather than at each
 * call site so the inline image, the "save it" download and the web ticket can
 * never drift onto different tokens or different origins.
 *
 *  • qrImageUrl    — hot-linked <img> src. A real URL, not a data: URI: Gmail,
 *                    Outlook and Yahoo all strip data: images.
 *  • qrDownloadUrl — same code, served with Content-Disposition: attachment at
 *                    print resolution, so the guest can keep it offline.
 *  • ticketUrl     — the web pass (QR + table + venue), no login required.
 */
const buildTicketLinks = (token) => {
  const t = encodeURIComponent(token);
  const png = `${getBackendBaseUrl()}/api/v1/public/qr/${t}.png`;
  return { qrImageUrl: png, qrDownloadUrl: `${png}?download=1`, ticketUrl: `${getPublicBaseUrl()}/ticket/${t}` };
};

/**
 * Builds a guest's personal event link. When a partyId is supplied it is appended as
 * the per-guest invitation token (`?party_id=...`), which unlocks private events and
 * pre-fills that party's RSVP form. Route is `/{slug}` (no `/e/` prefix).
 */
const buildGuestEventUrl = (slug, partyId) => {
  const base = `${getPublicBaseUrl()}/${slug || ''}`;
  return partyId ? `${base}?party_id=${encodeURIComponent(partyId)}` : base;
};

/**
 * Builds a guest's DIRECT RSVP-form link: `/{slug}/rsvp?g={partyId}` (INV-3).
 *
 * Used for SMS so a tap lands straight on the form — no landing-page detour and no
 * `/events/rsvp/{id}` resolver redirect (that resolver remains only as a fallback for
 * any links already in the wild). The form treats `g` as the per-guest unlock token,
 * so this opens private events too (see the public RSVP page's event fetch).
 */
const buildGuestRsvpUrl = (slug, partyId) => {
  const base = `${getPublicBaseUrl()}/${slug || ''}/rsvp`;
  return partyId ? `${base}?g=${encodeURIComponent(partyId)}` : base;
};

/* ═══ Brand tokens ═══ */
/* WHO SENDS THIS EMAIL — the same identity the website publishes.
 *
 * Duplicated from frontend/src/app/utils/company.js rather than imported: a
 * Node process cannot import from the Next app. The two are pinned against
 * each other by frontend/test/companyIdentity.test.js, because a footer that
 * disagrees with the site is a CAN-SPAM/CASL problem, not a typo — every
 * commercial email must identify the sender, and "the sender" has to be one
 * answer.
 *
 * ⚠ NO STREET ADDRESS. One was not supplied at the 2026-08-22 rebrand, and
 * both CAN-SPAM and CASL expect a valid physical mailing address in a
 * commercial email footer. This prints the location only; a real street
 * address still needs to be added here. */
const COMPANY_NAME = 'Fancy RSVP';

/* MIRRORS frontend/src/app/utils/company.js — field for field, because a Node
 * process cannot import from the Next app. companyIdentity.test.js pins the
 * two together; if you change one, that test tells you about the other.
 *
 * ⚠ CAN-SPAM §7704(a)(5) and CASL both REQUIRE a valid physical mailing
 * address in every commercial email. Until `line1` and `postalCode` are filled
 * in, this footer prints the location only and is NOT compliant. A registered
 * agent's address or a PO box registered to the business both satisfy the rule
 * — it does not have to be a street anyone sits at. */
const COMPANY_ADDRESS = {
  line1: '',
  line2: '',
  locality: 'San Diego',
  region: 'CA',
  regionName: 'California',
  postalCode: '',
  countryName: 'United States',
};

const ADDRESS_CONFIGURED = Boolean(
  COMPANY_ADDRESS.line1.trim() && COMPANY_ADDRESS.postalCode.trim(),
);

const COMPANY_LOCATION = ADDRESS_CONFIGURED
  ? [
    COMPANY_ADDRESS.line1,
    COMPANY_ADDRESS.line2,
    `${COMPANY_ADDRESS.locality}, ${COMPANY_ADDRESS.region} ${COMPANY_ADDRESS.postalCode}`,
    COMPANY_ADDRESS.countryName,
  ].filter(Boolean).join(', ')
  : `${COMPANY_ADDRESS.locality}, ${COMPANY_ADDRESS.regionName}, ${COMPANY_ADDRESS.countryName}`;

const BRAND = {
  gold: '#B8944F',
  goldDark: '#9A7B3F',
  goldLight: '#EBD9A6',   // the logo gradient's top stop
  champagne: '#D7BE80',
  charcoal: '#191B1E',
  ivory: '#F8F4EC',
  white: '#FFFFFF',
  border: '#E8E2D6',
  softBg: '#FAF8F3',
  ink: '#4A4742',     // body copy
  stone: '#77736A',   // labels
  muted: '#A09A91',   // footnotes
  success: '#3B9B6D',
  successBg: '#ECF6F0',
  successBorder: '#BFE3CF',
  danger: '#C45E5E',
  dangerBg: '#FBF0F0',
  dangerBorder: '#EBC9C9',
};

/**
 * ONE font stack per role, covering Latin AND Arabic in a single declaration.
 *
 * Mail clients fall back per CHARACTER, not per string: Latin glyphs resolve to
 * Georgia/Segoe UI and Arabic glyphs fall through to the first stack entry that
 * actually has them. That is why the Arabic faces are appended here rather than
 * swapped in per language — it keeps every helper below language-agnostic (no
 * `lang` argument to thread through 25 templates) while still rendering Arabic
 * in a real Arabic face instead of a browser default.
 *
 * Tahoma is the workhorse: shipped on Windows + macOS + Outlook, and one of the
 * few web-safe faces with a genuinely well-drawn Arabic.
 */
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, 'Geeza Pro', Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', 'Amiri', 'Traditional Arabic', 'Al Bayan', serif";

/* ═══ Language ═══
 * Guest-facing mail is sent in the language the guest actually used on the RSVP
 * page; organizer/system mail stays English (the dashboard is English-only).
 * `lang` is always one of 'en' | 'ar' — normalize defensively since it arrives
 * from a request body.
 */
const normalizeLang = (lang) => (String(lang || '').toLowerCase().startsWith('ar') ? 'ar' : 'en');
const isRtl = (lang) => normalizeLang(lang) === 'ar';

/** Picks the right string from an { en, ar } pair. */
const pick = (lang, pair) => (pair && typeof pair === 'object' && !Array.isArray(pair))
  ? (pair[normalizeLang(lang)] ?? pair.en ?? '')
  : (pair ?? '');

/** Shared chrome — the wording that appears on EVERY email regardless of type. */
const CHROME = {
  tagline:      { en: 'Elegant RSVPs. Effortless planning.', ar: 'دعوات أنيقة. تنظيم بلا عناء.' },
  automated:    { en: 'This is an automated message — please do not reply to this email.',
                  ar: 'هذه رسالة آلية — برجاء عدم الرد على هذا البريد.' },
  linkFallback: { en: "If the button doesn't work, paste this link into your browser:",
                  ar: 'إذا لم يعمل الزر، انسخ هذا الرابط والصقه في المتصفح:' },
  dear:         { en: 'Dear', ar: 'عزيزنا' },
  there:        { en: 'there', ar: 'ضيفنا الكريم' },
};

/**
 * Long, friendly event-date string, or null when no/invalid date.
 *
 * `timeZone` is the EVENT's zone and is effectively required, despite being
 * the second argument. Omitting it falls back to the platform default, which
 * is right for a San Diego event and silently wrong for every other one.
 *
 * Before this took a zone, it formatted in the SERVER's zone — an accident of
 * where the process happens to run. That put every date in every email one
 * step out of agreement with the guest page, which was formatting the same
 * column under a different rule entirely. This is the fix for that: the email
 * and the invitation now read the same instant on the same clock.
 */
const formatEventDate = (d, timeZone) => formatInZone(d, timeZone, {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

/**
 * Date AND time, for the organizer-facing "when did this arrive" line.
 *
 * Still labelled with its zone, for exactly the reason it used to be labelled
 * "UTC": a host reconciling a late reply against an RSVP deadline has to know
 * which clock they are reading, and an unlabelled "3:40 PM" cannot tell them.
 *
 * What changed is WHICH clock. UTC was the honest answer while the platform
 * had no better one — it was at least a clock we could name, unlike the
 * server's own zone. Now the event has a real timezone, so the timestamp is
 * shown on the organizer's own clock and labelled with it. That is the same
 * principle applied to a better answer, not a reversal of it.
 */
const formatDateTime = (d, timeZone) => {
  const formatted = formatInZone(d, timeZone, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  if (!formatted) return null;
  const abbr = zoneAbbreviation(d, timeZone);
  return abbr ? `${formatted} ${abbr}` : formatted;
};

const money = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)} USD`;

/* ═══ Reusable, email-safe components ═══ */

const para = (html, opts = {}) =>
  `<p style="margin:0 0 ${opts.mb != null ? opts.mb : 16}px; font-family:${SANS}; font-size:${opts.size || 15}px; line-height:1.65; color:${opts.color || BRAND.ink};${opts.align ? ` text-align:${opts.align};` : ''}">${html}</p>`;

const greeting = (name, lang) => {
  const who = escapeHtml(name || pick(lang, CHROME.there));
  // Arabic uses its own comma (U+060C); a Latin one reads as a typo in RTL text.
  const comma = isRtl(lang) ? '،' : ',';
  return para(`${pick(lang, CHROME.dear)} <strong class="fr-ink" style="color:${BRAND.charcoal};">${who}</strong>${comma}`);
};

/**
 * Ornament under a heading — a hairline rule broken by the diamond from the
 * logo mark, the way engraved stationery closes a title.
 *
 * The rules are `border-top` on an empty cell, NOT a background-color block:
 * a 1px-high <td> with a background is not honoured as 1px (the cell grows to
 * its line box) and renders as a thick gold bar. Zeroing font-size/line-height
 * and using a border is the only construction that stays a hairline in Outlook.
 * It is left-aligned with the heading rather than centered — a centered rule
 * under a left-aligned title reads as a mistake.
 */
const ornament = (color = BRAND.champagne, lang) => `<table role="presentation" cellpadding="0" cellspacing="0" align="${isRtl(lang) ? 'right' : 'left'}" style="margin:16px 0 2px;">
  <tr>
    <td style="width:38px; border-top:1px solid ${color}; font-size:0; line-height:0;">&nbsp;</td>
    <td style="padding:0 9px; font-family:${SERIF}; font-size:9px; line-height:9px; color:${color};">&#9670;</td>
    <td style="width:38px; border-top:1px solid ${color}; font-size:0; line-height:0;">&nbsp;</td>
  </tr>
</table>`;

/** Centered pill button (bulletproof: bgcolor on the td for Outlook). */
const button = (href, label, opts = {}) => {
  const bg = opts.bg || BRAND.gold;
  const color = opts.color || BRAND.white;
  const border = opts.border || bg;
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 12px;">
    <tr><td align="center" bgcolor="${bg}" style="border-radius:10px; background-color:${bg};">
      <a class="fr-btn" href="${href}" target="_blank" rel="noopener" style="display:inline-block; font-family:${SANS}; font-size:14px; font-weight:bold; letter-spacing:0.4px; color:${color}; text-decoration:none; padding:14px 34px; border-radius:10px; border:1px solid ${border};">${label}</a>
    </td></tr>
  </table>`;
};

/**
 * Small centered pill that calls out one capability the email unlocks (e.g.
 * "this link opens the live seating map"). Deliberately a <table> rather than
 * an inline-block span — Outlook collapses padding/border-radius on spans, so
 * the pill would otherwise render as bare text in exactly the client most
 * corporate guests read mail in.
 */
const badge = (label, opts = {}) => {
  const bg = opts.bg || BRAND.ivory;
  const fg = opts.fg || BRAND.goldDark;
  const br = opts.border || 'rgba(184,148,79,0.45)';
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 10px;">
    <tr><td align="center" bgcolor="${bg}" style="background-color:${bg}; border:1px solid ${br}; border-radius:999px; padding:9px 18px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:1.2px; text-transform:uppercase; color:${fg};">${label}</td></tr>
  </table>`;
};

/**
 * Two-column label/value card. rows: [label, valueHtml, valueColor?][]
 *
 * `lang` only mirrors the value column's alignment — in RTL the label sits
 * right and the value left, otherwise the value collides with the label.
 * Letter-spacing is dropped for Arabic labels: it breaks the cursive joins
 * between letters and renders the word as disconnected glyphs.
 */
const dataTable = (rows, lang) => {
  const rtl = isRtl(lang);
  const labelSpacing = rtl ? '' : 'letter-spacing:1.2px; text-transform:uppercase;';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fr-panel" style="background-color:${BRAND.softBg}; border:1px solid ${BRAND.border}; border-radius:14px; margin:24px 0;">
  <tr><td style="padding:4px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${rows.map(([label, value, color], i) => {
        const line = i < rows.length - 1 ? `border-bottom:1px solid ${BRAND.border};` : '';
        return `<tr>
          <td class="fr-hr-b" style="padding:13px 0; ${line} font-family:${SANS}; font-size:${rtl ? '12' : '11'}px; font-weight:bold; ${labelSpacing} color:${BRAND.stone}; vertical-align:middle; text-align:${rtl ? 'right' : 'left'};">${escapeHtml(label)}</td>
          <td class="fr-hr-b fr-ink" dir="auto" style="padding:13px 0; ${line} font-family:${SANS}; font-size:15px; font-weight:600; color:${color || BRAND.charcoal}; text-align:${rtl ? 'left' : 'right'}; vertical-align:middle;">${value}</td>
        </tr>`;
      }).join('')}
    </table>
  </td></tr>
</table>`;
};

/** Large, beautifully highlighted one-time code. */
const codeBox = (code) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 18px;">
  <tr><td align="center" style="background-color:${BRAND.ivory}; border:1px dashed ${BRAND.gold}; border-radius:16px; padding:24px 16px;">
    <div style="font-family:${SANS}; font-size:10px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${BRAND.stone}; margin-bottom:10px;">Your Verification Code</div>
    <div class="fr-code" style="font-family:'Courier New', Courier, monospace; font-size:40px; font-weight:bold; letter-spacing:14px; color:${BRAND.charcoal}; text-indent:14px;">${escapeHtml(String(code))}</div>
  </td></tr>
</table>`;

/** Tinted callout box. tone: neutral | success | warn | danger */
const noticeBox = (html, tone = 'neutral') => {
  const map = {
    neutral: { bg: BRAND.softBg, br: BRAND.border, fg: BRAND.stone },
    success: { bg: BRAND.successBg, br: BRAND.successBorder, fg: BRAND.success },
    warn: { bg: '#FBF6EC', br: 'rgba(184,148,79,0.4)', fg: BRAND.goldDark },
    danger: { bg: BRAND.dangerBg, br: BRAND.dangerBorder, fg: BRAND.danger },
  };
  const c = map[tone] || map.neutral;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">
    <tr><td style="background-color:${c.bg}; border:1px solid ${c.br}; border-radius:12px; padding:14px 18px; font-family:${SANS}; font-size:13px; line-height:1.6; color:${c.fg};">${html}</td></tr>
  </table>`;
};

/** A row of headline number cards for organizer reports. items: {label,value,color?}[] */
const statGrid = (items) => {
  const cells = (items || []).map((it) => `<td align="center" valign="top" style="padding:6px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:${BRAND.softBg}; border:1px solid ${BRAND.border}; border-radius:12px;">
      <tr><td align="center" style="padding:16px 6px;">
        <div style="font-family:${SERIF}; font-size:26px; font-weight:bold; line-height:1; color:${it.color || BRAND.charcoal};">${it.value}</div>
        <div style="font-family:${SANS}; font-size:10px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:${BRAND.stone}; margin-top:6px;">${escapeHtml(it.label)}</div>
      </td></tr>
    </table>
  </td>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr>${cells}</tr></table>`;
};

/**
 * THE ENTRY PASS — the physical-feeling ticket object at the heart of every
 * check-in email. A foil-edged charcoal card carrying the guest's name, what
 * the pass admits, their table, and a tear-off stub holding the QR the door
 * scanner reads.
 *
 * Three constraints shape the markup, all of them Outlook:
 *  • Every dark surface is a <td> carrying BOTH a bgcolor attribute and an
 *    inline background-color. A <div> with a background loses it in Outlook,
 *    which would leave white text on white — an unreadable pass, not a plain
 *    one.
 *  • The pill and the QR frame are nested <table>s, never padded <span>s:
 *    Outlook drops padding and border-radius on inline elements.
 *  • The perforation is a `border-top` on a zero-height cell. A 1px <td> with
 *    a background renders as a thick bar there (same reason as ornament()).
 *
 * Rounded corners simply don't render in Outlook; the card degrades to a
 * square-cornered ticket, which is fine. What must never degrade is contrast,
 * hence the hard hexes (#3A3D42 for the perforation, #8E8A82 for labels)
 * instead of rgba() — Outlook ignores rgba borders entirely.
 */
const entryPass = ({ guestName, eventTitle, qrImageUrl, ticketUrl, tableValue, tableIsAssigned, admitsLabel, reference, lang }) => {
  const rtl = isRtl(lang);
  const start = rtl ? 'right' : 'left';
  const end = rtl ? 'left' : 'right';
  // Latin small-caps labels get tracking; Arabic loses its cursive joins under
  // letter-spacing and has no case, so it gets neither.
  const label = rtl
    ? `font-size:11px; font-weight:bold; color:#8E8A82;`
    : `font-size:10px; font-weight:bold; letter-spacing:2.4px; text-transform:uppercase; color:#8E8A82;`;
  const pillType = rtl
    ? 'font-size:11px; font-weight:bold;'
    : 'font-size:10px; font-weight:bold; letter-spacing:1.6px; text-transform:uppercase;';

  const qrImg = `<img src="${qrImageUrl}" width="200" height="200" alt="${pick(lang, { en: 'Your check-in QR code', ar: 'رمز تسجيل دخولك' })}" style="display:block; width:200px; height:200px; border:0;">`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 20px;">
  <tr><td>
    <!-- Foil edge -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td bgcolor="${BRAND.gold}" style="height:5px; line-height:5px; font-size:0; background-color:${BRAND.gold}; border-radius:18px 18px 0 0;">&nbsp;</td></tr>
    </table>
    <!-- Card body -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BRAND.charcoal}" style="background-color:${BRAND.charcoal}; border-radius:0 0 18px 18px;">
      <tr><td style="padding:26px 26px 20px;" dir="${rtl ? 'rtl' : 'ltr'}">

        <!-- Eyebrow + admits pill -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="${start}" style="font-family:${SANS}; ${label} vertical-align:middle;">${pick(lang, { en: 'Entry pass', ar: 'بطاقة الدخول' })}</td>
            <td align="${end}" style="vertical-align:middle;">
              <table role="presentation" cellpadding="0" cellspacing="0" align="${end}">
                <tr><td bgcolor="${BRAND.gold}" style="background-color:${BRAND.gold}; border-radius:999px; padding:6px 14px; font-family:${SANS}; ${pillType} color:${BRAND.charcoal};">${admitsLabel}</td></tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Guest -->
        <div style="font-family:${SERIF}; font-size:27px; font-weight:bold; line-height:1.25; color:#FFFFFF; margin:16px 0 6px;" dir="auto">${escapeHtml(guestName)}</div>
        <div style="font-family:${SANS}; font-size:13px; line-height:1.5; color:${BRAND.champagne};" dir="auto">${escapeHtml(eventTitle)}</div>

        <!-- Table strip -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;">
          <tr><td bgcolor="#212429" style="background-color:#212429; border-radius:12px; padding:14px 18px;">
            <div style="font-family:${SANS}; ${label} margin-bottom:5px;">${pick(lang, { en: 'Your table', ar: 'طاولتك' })}</div>
            <div style="font-family:${SERIF}; font-size:${tableIsAssigned ? '22' : '16'}px; font-weight:bold; color:${tableIsAssigned ? BRAND.goldLight : '#8E8A82'};" dir="auto">${escapeHtml(tableValue)}</div>
          </td></tr>
        </table>

        <!-- Perforation -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 20px;">
          <tr><td style="border-top:2px dashed #3A3D42; font-size:0; line-height:0;">&nbsp;</td></tr>
        </table>

        <!-- QR stub -->
        <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
          <tr><td bgcolor="${BRAND.white}" align="center" style="background-color:${BRAND.white}; border-radius:16px; padding:16px;">
            ${ticketUrl ? `<a href="${ticketUrl}" target="_blank" rel="noopener" style="display:block; text-decoration:none;">${qrImg}</a>` : qrImg}
          </td></tr>
        </table>
        <div align="center" style="font-family:${SANS}; ${label} text-align:center; margin-top:14px;">${pick(lang, { en: 'Scan at the entrance', ar: 'يُمسح عند المدخل' })}</div>
        ${reference ? `<div align="center" style="font-family:'Courier New', Courier, monospace; font-size:11px; letter-spacing:2px; color:#5C5F66; text-align:center; margin-top:6px;">${escapeHtml(reference)}</div>` : ''}

      </td></tr>
    </table>
  </td></tr>
</table>`;
};

/**
 * The brand lockup. A real logo (rasterized — SVG is unsupported in Outlook,
 * Gmail and Yahoo) served from the public site, retina-crisp by shipping the
 * @2x asset and pinning the display width.
 *
 * Every desktop Outlook and many corporate clients block remote images by
 * default, so the ALT text is styled to BE the fallback wordmark: with images
 * off the recipient still sees "Fancy RSVP" set in gold serif rather than a
 * broken-image icon. That is why alt text and inline font styling are on the
 * <img> itself — both are applied to alt text when the image doesn't load.
 */
/**
 * `logo-email.png` is a DEDICATED email lockup, not the site header logo.
 *
 * The site logo is a wide horizontal bar (envelope, then a large gap, then
 * "Fancy", then another gap, then "RSVP"): scaled down to fit a 600px email it
 * reads as three disconnected fragments with hairline strokes. This asset is
 * the stacked lockup — mark over wordmark over a rule — drawn at 3x (480px
 * wide, shown at 160px) so it stays crisp on HiDPI, on a transparent
 * background, with no "@" in the filename (some mail proxies parse it as an
 * address delimiter and break the URL).
 *
 * Regenerate with scratchpad/logo-export.html via headless Chrome — the script
 * face is a webfont, so it MUST be rasterized; no mail client will render it.
 */
const LOGO_WIDTH = 160;
const LOGO_HEIGHT = 118; // 480x354 source, scaled 1:3
const logoBlock = () => {
  const src = `${getPublicBaseUrl()}/logo-email.png`;
  return `<img src="${src}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="Fancy RSVP"
    style="display:block; width:${LOGO_WIDTH}px; height:${LOGO_HEIGHT}px; max-width:${LOGO_WIDTH}px; border:0; outline:none; text-decoration:none; font-family:${SERIF}; font-size:22px; font-style:italic; letter-spacing:1px; color:${BRAND.gold};">`;
};

/**
 * The shared shell every email is wrapped in.
 *
 * Beyond layout it carries three things worth knowing about:
 *  • `lang` flips the whole document to RTL (dir on <html>, <body> and the
 *    content cell) — not just text-align, so punctuation, list markers and
 *    mixed Latin/Arabic runs order correctly.
 *  • Dark mode: clients that honour prefers-color-scheme get a charcoal card
 *    instead of an inverted-white one. `[data-ogsc]` covers Outlook.com, which
 *    rewrites colours instead of supporting the media query.
 *  • The footer carries the legal entity + postal address. That is a CAN-SPAM
 *    requirement and a real inbox-placement signal, not decoration.
 */
/**
 * The masthead for a WHITE-LABELLED event email.
 *
 * The host's own name, set in the same gold serif the wordmark used, so the
 * email still opens with a masthead instead of a gap where a logo was. No image
 * at all: we have no asset for the host, and a missing <img> in Outlook is a
 * broken-image icon at the very top of the message.
 */
const hostWordmark = (name) => `<p style="margin:0; font-family:${SERIF}; font-size:22px; font-style:italic; letter-spacing:1px; color:${BRAND.gold};">${escapeHtml(name)}</p>`;

/**
 * The branding half of every GUEST-facing email, spread into its shell call.
 *
 * One helper rather than two properties written out eleven times: `whiteLabel`
 * without `brandName` is an email with a hole where the masthead was, and
 * `brandName` without `whiteLabel` is a Fancy logo above someone else's name.
 * Spreading a single object makes the pair impossible to half-apply.
 *
 * `tier_white_label` is snapshotted on the EVENT (migration 20260830000003), so
 * this works months after purchase, in a background job, with no session and no
 * pricing config lookup — and keeps working if the plan is later renamed or
 * deleted. A missing column reads as `false`: the mark stays until the
 * entitlement is certain.
 *
 * `backend/test/whiteLabelEmails.test.js` renders every builder listed in this
 * module's guest exports and fails if one of them leaks a Fancy mark — which is
 * what catches the twelfth guest template that someone adds without this line.
 */
const guestBrand = (event) => ({
  whiteLabel: !!event?.tier_white_label,
  brandName: event?.title || '',
});

/**
 * The shared shell every email is wrapped in.
 *
 * ── whiteLabel ──
 *
 * Strips every Fancy MARK a guest can see: the logo lockup, the gold wordmark in
 * the footer, and the tagline. `brandName` (the event's title) takes the
 * masthead's place.
 *
 * It deliberately does NOT strip the legal footer — the company name and postal
 * address. That is a CAN-SPAM disclosure about the SENDER, and the sender is
 * still us: this mail leaves our infrastructure, our domain and our IP
 * reputation. Removing it to look whiter would make the message unlawful and
 * damage deliverability for every customer sharing that reputation. It is set in
 * the smallest muted type in the document; it is disclosure, not marketing.
 *
 * Only GUEST-facing event mail passes this. Account mail — verification, password
 * reset, receipts — is genuinely from us to our own customer, and an unbranded
 * security email is how a password reset gets read as phishing.
 */
const emailShell = ({
  preheader = '', eyebrow = '', accent = BRAND.gold, heading = '',
  contentHtml = '', footerNote = '', lang = 'en',
  whiteLabel = false, brandName = '',
}) => {
  const rtl = isRtl(lang);
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  // Arabic loses its cursive joins under letter-spacing, and uppercase is a
  // no-op for a script with no case — so the eyebrow drops both in RTL.
  const eyebrowType = rtl
    ? 'font-size:12px; letter-spacing:0;'
    : 'font-size:11px; letter-spacing:2.5px; text-transform:uppercase;';

  return `<!DOCTYPE html>
<html lang="${normalizeLang(lang)}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${whiteLabel && brandName ? escapeHtml(brandName) : 'Fancy RSVP'}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>* { font-family: Arial, Helvetica, sans-serif !important; }</style>
  <![endif]-->
  <style>
    /* LIGHT ONLY — deliberately.
     * This layout is inline-styled (the only thing Outlook honours), and an
     * inline color: can't be overridden by a prefers-color-scheme block without
     * tagging every single text node. A partial inversion is what you get
     * otherwise: dark card, dark body text, white panels stranded inside it —
     * unreadable. Declaring light-only tells Apple Mail / Outlook / Gmail not to
     * auto-invert, so the design renders as designed everywhere.
     * Do NOT add a dark-mode block here without also inverting every helper. */
    :root { color-scheme: light; supported-color-schemes: light; }
    body { margin:0 !important; padding:0 !important; width:100% !important; background-color:${BRAND.ivory}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
    a { text-decoration:none; }
    .fr-btn:hover { opacity:0.92 !important; }
    @media only screen and (max-width:620px) {
      .fr-container { width:100% !important; }
      .fr-px { padding-left:26px !important; padding-right:26px !important; }
      .fr-h1 { font-size:24px !important; line-height:1.3 !important; }
      .fr-code { font-size:31px !important; letter-spacing:9px !important; }
      .fr-stat { display:block !important; width:100% !important; }
    }
  </style>
</head>
<body dir="${dir}" style="margin:0; padding:0; background-color:${BRAND.ivory};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapeHtml(preheader)}</div>
  <!-- Preheader padding: stops the client pulling body copy into the inbox preview. -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fr-bg" style="background-color:${BRAND.ivory};">
    <tr>
      <td align="center" style="padding:36px 16px 48px;">
        <table role="presentation" class="fr-container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding:2px 0 26px;">
              ${whiteLabel ? (brandName ? hostWordmark(brandName) : '') : logoBlock()}
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td class="fr-card" style="background-color:${BRAND.white}; border:1px solid ${BRAND.border}; border-radius:18px; overflow:hidden;">
              <!-- Foil edge: a solid accent bar over a champagne hairline. -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="height:4px; background-color:${accent}; line-height:4px; font-size:0;">&nbsp;</td></tr>
                <tr><td style="height:1px; background-color:${BRAND.champagne}; line-height:1px; font-size:0;">&nbsp;</td></tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}">
                <tr>
                  <td class="fr-px" align="${align}" style="padding:42px 42px 0; text-align:${align};">
                    ${eyebrow ? `<p style="margin:0 0 12px; font-family:${SANS}; font-weight:bold; ${eyebrowType} color:${accent};">${escapeHtml(eyebrow)}</p>` : ''}
                    ${heading ? `<h1 class="fr-h1 fr-ink" style="margin:0; font-family:${SERIF}; font-size:28px; font-weight:normal; line-height:1.3; color:${BRAND.charcoal};">${heading}</h1>` : ''}
                    ${heading ? ornament(accent === BRAND.gold ? BRAND.champagne : accent, lang) : ''}
                  </td>
                </tr>
                <tr>
                  <td class="fr-px fr-body" align="${align}" style="padding:14px 42px 42px; text-align:${align}; color:${BRAND.ink};">
                    ${contentHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 24px 6px; text-align:center;">
              ${whiteLabel ? '' : `<p style="margin:0 0 8px; font-family:${SERIF}; font-size:16px; font-style:italic; color:${BRAND.gold};">Fancy RSVP</p>`}
              <p class="fr-muted" style="margin:0 0 10px; font-family:${SANS}; font-size:11px; line-height:1.7; color:${BRAND.muted};">
                ${/* Our tagline and our "sent via Fancy RSVP" note both go. The
                     "do not reply" line STAYS: it is operational instruction to
                     the reader, and a guest replying into an unmonitored mailbox
                     is a support failure whoever's name is on the message. */''}
                ${whiteLabel ? '' : `${footerNote || pick(lang, CHROME.tagline)}<br>`}
                ${pick(lang, CHROME.automated)}
              </p>
              <p class="fr-muted" style="margin:0; font-family:${SANS}; font-size:10px; line-height:1.7; color:${BRAND.muted};" dir="ltr">
                ${COMPANY_NAME}<br>
                ${COMPANY_LOCATION}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const responseMeta = (response, lang) => {
  if (response === 'yes' || response === 'accepted') return { label: pick(lang, { en: 'Attending', ar: 'سيحضر' }), color: BRAND.success };
  if (response === 'maybe') return { label: pick(lang, { en: 'Maybe', ar: 'ربما' }), color: BRAND.goldDark };
  if (response === 'no' || response === 'declined') return { label: pick(lang, { en: 'Declined', ar: 'اعتذر' }), color: BRAND.danger };
  return { label: pick(lang, { en: 'Pending', ar: 'بانتظار الرد' }), color: BRAND.stone };
};

/**
 * Long, friendly event-date string in the recipient's language.
 *
 * `ar-EG-u-nu-latn` — Arabic month/weekday names with WESTERN digits. Plain
 * 'ar-EG' renders Arabic-Indic numerals (٢٠٢٦) while every other number in the
 * mail (party size, table number, times) stays Western, so the email ends up
 * mixing two numeral systems. Latin digits are also the norm in Egyptian and
 * Gulf digital products.
 */
const formatEventDateLang = (d, lang, timeZone) => formatInZone(d, timeZone, {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
}, isRtl(lang) ? 'ar-EG-u-nu-latn' : 'en-US');

/** Party-size phrase — Arabic needs real dual/plural forms, not "1 Guests". */
const guestCount = (n, lang) => {
  const size = Number(n) || 1;
  if (!isRtl(lang)) return `${size} ${size === 1 ? 'Guest' : 'Guests'}`;
  if (size === 1) return 'ضيف واحد';
  if (size === 2) return 'ضيفان';
  if (size <= 10) return `${size} ضيوف`;
  return `${size} ضيفًا`;
};

/* ═══════════════════════════════════════════════════════════════════════════
   AUTHENTICATION & ACCOUNT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Email-verification OTP sent on registration. */
const getEmailVerificationTemplate = (name, otp) => emailShell({
  preheader: 'Your Fancy RSVP verification code',
  eyebrow: 'Verify your email',
  heading: 'Welcome to Fancy RSVP',
  contentHtml: `
    ${greeting(name)}
    ${para('Thank you for creating your account. Enter the verification code below to confirm your email and activate your account.')}
    ${codeBox(otp)}
    ${noticeBox('This code expires in <strong>15 minutes</strong>.', 'warn')}
    ${para("If you didn't create a Fancy RSVP account, you can safely ignore this email.", { size: 13, color: BRAND.stone, mb: 0 })}
  `,
});

/** Password-reset OTP sent on forgot-password. */
const getPasswordResetTemplate = (name, otp) => emailShell({
  preheader: 'Your Fancy RSVP password reset code',
  eyebrow: 'Password recovery',
  heading: 'Reset your password',
  contentHtml: `
    ${greeting(name || 'Organizer')}
    ${para('We received a request to reset your password. Use the one-time code below to continue — it is valid for 15 minutes.')}
    ${codeBox(otp)}
    ${noticeBox('Never share this code with anyone. Our team will never ask you for it.', 'warn')}
    ${para("If you didn't request a password reset, your password is unchanged and you can safely ignore this email.", { size: 13, color: BRAND.stone, mb: 0 })}
  `,
});

/* ═══════════════════════════════════════════════════════════════════════════
   RSVP LIFECYCLE (guest-facing)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Guest INVITATION with one-click Accept / Maybe / Decline (signed per-guest links). */
const getInvitationTemplate = (rsvp, event, links, lang = 'en') => {
  const formattedDate = formatEventDateLang(event.event_date, lang, event.timezone);
  const where = event.location_name || event.location_address || null;
  const rows = [[pick(lang, { en: 'Event', ar: 'المناسبة' }), escapeHtml(event.title)]];
  if (formattedDate) rows.push([pick(lang, { en: 'Date', ar: 'التاريخ' }), escapeHtml(formattedDate)]);
  if (where) rows.push([pick(lang, { en: 'Where', ar: 'المكان' }), escapeHtml(where)]);

  return emailShell({
    ...guestBrand(event),
    lang,
    preheader: pick(lang, {
      en: `You're invited to ${event.title}`,
      ar: `أنت مدعو إلى ${event.title}`,
    }),
    eyebrow: pick(lang, { en: "You're invited", ar: 'دعوة خاصة' }),
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${para(pick(lang, {
        en: "You're warmly invited to join us. Open your invitation below to see the full details and let us know if you'll be able to attend.",
        ar: 'يسعدنا دعوتك للانضمام إلينا. افتح دعوتك بالأسفل لمشاهدة كل التفاصيل وإخبارنا إن كان بإمكانك الحضور.',
      }))}
      ${dataTable(rows, lang)}
      ${button(links.view, pick(lang, { en: 'View Invitation', ar: 'عرض الدعوة' }))}
      ${para(`${pick(lang, CHROME.linkFallback)}<br><a href="${links.view}" style="color:${BRAND.gold}; word-break:break-all;" dir="ltr">${links.view}</a>`, { size: 12, color: BRAND.muted, align: 'center', mb: 0 })}
    `,
    footerNote: pick(lang, {
      en: 'Sent via Fancy RSVP on behalf of the event organizer.',
      ar: 'أُرسلت عبر Fancy RSVP نيابةً عن منظّم المناسبة.',
    }),
  });
};

/**
 * RSVP confirmation (response recorded). Also used for a 'maybe' — the copy
 * adapts rather than promising a table to someone who hasn't committed yet.
 */
const getRSVPConfirmationTemplate = (rsvp, event, lang = 'en', links = null) => {
  const formattedDate = formatEventDateLang(event.event_date, lang, event.timezone);
  const r = responseMeta(rsvp.response, lang);
  const isMaybe = rsvp.response === 'maybe';
  // A confirmed guest gets their check-in pass HERE, in the one email they
  // reliably keep, instead of the old promise of "a separate email once seating
  // is finalized" — which never arrived for an event the organizer never seated.
  const showPass = !isMaybe && !!links?.qrImageUrl;
  const rows = [
    [pick(lang, { en: 'Response', ar: 'الرد' }), `<span style="color:${r.color};">${r.label}</span>`, r.color],
    [pick(lang, { en: 'Party Size', ar: 'عدد الأفراد' }), guestCount(rsvp.party_size, lang)],
  ];
  if (formattedDate) rows.push([pick(lang, { en: 'Date', ar: 'التاريخ' }), escapeHtml(formattedDate)]);

  return emailShell({
    ...guestBrand(event),
    lang,
    preheader: isMaybe
      ? pick(lang, { en: `We've noted your response for ${event.title}`, ar: `سجّلنا ردّك على ${event.title}` })
      : pick(lang, { en: `Your RSVP for ${event.title} is confirmed`, ar: `تم تأكيد حضورك في ${event.title}` }),
    eyebrow: isMaybe
      ? pick(lang, { en: 'Response received', ar: 'تم استلام ردّك' })
      : pick(lang, { en: 'RSVP confirmed', ar: 'تم تأكيد الحضور' }),
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${para(isMaybe
        ? pick(lang, {
            en: 'Thank you for letting us know. Your response has been recorded as tentative — here is what we have on file:',
            ar: 'شكرًا لإخبارنا. سُجّل ردّك مبدئيًا — وهذه البيانات المسجّلة لدينا:',
          })
        : pick(lang, {
            en: 'Your RSVP has been successfully recorded. Here are the details we have on file:',
            ar: 'تم تسجيل ردّك بنجاح. وهذه التفاصيل المسجّلة لدينا:',
          }))}
      ${dataTable(rows, lang)}
      ${isMaybe
        ? noticeBox(pick(lang, {
            en: "We'll hold your place for now. As soon as you know either way, just reopen your invitation and update your response — the host would love a final answer before the deadline.",
            ar: 'سنحتفظ لك بمكانك مبدئيًا. وبمجرد أن يتأكد لك الأمر، افتح دعوتك وحدّث ردّك — يسعد المضيف بمعرفة إجابتك النهائية قبل انتهاء الموعد.',
          }), 'warn')
        : showPass
          ? `
      ${para(pick(lang, {
        en: 'Your entry pass is below. The QR code is what our team scans at the door — keep this email, or download the code so you have it on the night even without a signal.',
        ar: 'بطاقة دخولك بالأسفل. رمز QR هو ما يمسحه فريقنا عند البوابة — احتفظ بهذه الرسالة، أو حمّل الرمز ليكون معك ليلة الحفل حتى بدون إنترنت.',
      }))}
      ${entryPass({
        guestName: rsvp.guest_name,
        eventTitle: event.title,
        qrImageUrl: links.qrImageUrl,
        ticketUrl: links.ticketUrl,
        tableIsAssigned: false,
        tableValue: pick(lang, { en: 'Assigned when you arrive', ar: 'يُحدَّد عند وصولك' }),
        admitsLabel: isRtl(lang) ? guestCount(rsvp.party_size, lang) : `Admits ${Number(rsvp.party_size) || 1}`,
        reference: `#${String(rsvp.id || '').replace(/-/g, '').slice(-6).toUpperCase()}`,
        lang,
      })}
      ${links.qrDownloadUrl ? button(links.qrDownloadUrl, pick(lang, { en: '&#11015; Download my QR code', ar: '&#11015; تحميل رمز الدخول' })) : ''}
      ${links.ticketUrl ? button(links.ticketUrl, pick(lang, { en: 'Open my pass online', ar: 'فتح بطاقتي أونلاين' }), { bg: BRAND.white, color: BRAND.goldDark, border: BRAND.gold }) : ''}
      ${para(pick(lang, {
        en: 'If the host assigns you a table, your online pass updates on its own — the same QR code keeps working.',
        ar: 'إذا خصّص لك المضيف طاولة، ستتحدّث بطاقتك أونلاين تلقائيًا — ويظل رمز QR نفسه صالحًا.',
      }), { size: 13, color: BRAND.stone, align: 'center', mb: 6 })}`
          : noticeBox(pick(lang, {
              en: "Your table placement is being coordinated. You'll receive a separate email with your QR check-in pass once seating is finalized.",
              ar: 'يجري الآن ترتيب طاولتك. وستصلك رسالة منفصلة تحتوي على رمز الدخول QR فور اعتماد توزيع الجلوس.',
            }), 'neutral')}
      ${para(isMaybe
        ? pick(lang, { en: 'We hope you can make it.', ar: 'نتمنى أن تتمكن من الحضور.' })
        : pick(lang, { en: 'We look forward to celebrating with you.', ar: 'نتطلع للاحتفال معك.' }), { mb: 0 })}
    `,
  });
};

/** Thank-you for a declined RSVP, with a one-click "change my RSVP" link. */
const getDeclineConfirmationTemplate = (rsvp, event, lang = 'en') => {
  const formattedDate = formatEventDateLang(event.event_date, lang, event.timezone);
  const eventPageUrl = buildGuestEventUrl(event.slug, rsvp.id);
  const declined = pick(lang, { en: 'Regretfully Declined', ar: 'اعتذر عن الحضور' });
  const rows = [[pick(lang, { en: 'Response', ar: 'الرد' }), `<span style="color:${BRAND.danger};">${declined}</span>`, BRAND.danger]];
  if (formattedDate) rows.push([pick(lang, { en: 'Date', ar: 'التاريخ' }), escapeHtml(formattedDate)]);

  const sorry = isRtl(lang)
    ? `يؤسفنا أنك لن تتمكن من الانضمام إلينا${formattedDate ? ` يوم <strong>${escapeHtml(formattedDate)}</strong>` : ''}. نتفهّم ذلك تمامًا، ونقدّر لك إبلاغنا.`
    : `We're sorry you won't be able to join us${formattedDate ? ` on <strong>${escapeHtml(formattedDate)}</strong>` : ''}. We completely understand, and we truly appreciate you taking the time to let us know.`;

  return emailShell({
    ...guestBrand(event),
    lang,
    preheader: pick(lang, {
      en: `Thank you for letting us know — ${event.title}`,
      ar: `شكرًا لإخبارنا — ${event.title}`,
    }),
    eyebrow: pick(lang, { en: 'Thank you for letting us know', ar: 'شكرًا لإخبارنا' }),
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${para(sorry)}
      ${dataTable(rows, lang)}
      ${para(pick(lang, {
        en: 'If your plans change, we would love to have you. You can update your RSVP any time before the deadline:',
        ar: 'إذا تغيّرت خططك، يسعدنا حضورك. يمكنك تعديل ردّك في أي وقت قبل انتهاء الموعد:',
      }))}
      ${button(eventPageUrl, pick(lang, { en: 'Change My RSVP', ar: 'تعديل ردّي' }))}
      ${para(pick(lang, {
        en: 'Wishing you all the best — we hope to see you at a future celebration.',
        ar: 'مع أطيب التمنيات — ونأمل أن نراك في مناسبة قادمة.',
      }), { size: 13, color: BRAND.stone, mb: 0 })}
    `,
  });
};

/** Email sent to a companion guest confirming they are attending with the primary guest. */
const getCompanionRSVPConfirmationTemplate = (companionName, mainGuestName, event, eventUrl, lang = 'en') => {
  const formattedDate = formatEventDateLang(event.event_date, lang, event.timezone);
  const where = event.location_name || event.location_address || null;
  const registered = pick(lang, { en: 'Registered as Guest', ar: 'مسجّل كضيف' });
  const rows = [
    [pick(lang, { en: 'Main Guest', ar: 'الضيف الأساسي' }), escapeHtml(mainGuestName)],
    [pick(lang, { en: 'Status', ar: 'الحالة' }), `<span style="color:${BRAND.success};">${registered}</span>`, BRAND.success],
  ];
  if (formattedDate) rows.push([pick(lang, { en: 'Date', ar: 'التاريخ' }), escapeHtml(formattedDate)]);
  if (where) rows.push([pick(lang, { en: 'Where', ar: 'المكان' }), escapeHtml(where)]);

  const named = `<strong class="fr-ink" style="color:${BRAND.charcoal};">${escapeHtml(mainGuestName)}</strong>`;

  return emailShell({
    ...guestBrand(event),
    lang,
    preheader: pick(lang, {
      en: `You're registered for ${event.title}`,
      ar: `تم تسجيلك في ${event.title}`,
    }),
    eyebrow: pick(lang, { en: 'Companion RSVP Confirmed', ar: 'تم تأكيد حضورك كمرافق' }),
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(companionName, lang)}
      ${para(isRtl(lang)
        ? `${named} أكّد حضوره وسجّلك كمرافق له في هذه المناسبة.`
        : `${named} has confirmed their attendance and registered you as their guest for the event.`)}
      ${dataTable(rows, lang)}
      ${para(pick(lang, { en: 'We look forward to celebrating with you.', ar: 'نتطلع للاحتفال معك.' }), { mb: 16 })}
      ${eventUrl ? button(eventUrl, pick(lang, { en: 'View Event Details', ar: 'عرض تفاصيل المناسبة' })) : ''}
    `,
  });
};

/**
 * "Update your RSVP" — the link that proves someone typing this address can
 * actually read its mail.
 *
 * Sent when a submission matches an address whose party has already answered.
 * The old flow let a single click merge into that party, so anyone who knew a
 * guest's address could overwrite their response. Now the only way through is a
 * link that lands in the owner's inbox.
 *
 * Deliberately terse and unexcited. Whoever receives it may not have asked for
 * it, so it has to read as something safe to ignore — no celebration, nothing
 * about the event beyond its title, and an explicit "if this wasn't you" line.
 */
const getRsvpClaimTemplate = (guestName, event, claimUrl, lang = 'en') => emailShell({
  ...guestBrand(event),
  lang,
  preheader: pick(lang, {
    en: `Your link to update your RSVP for ${event.title}`,
    ar: `رابط تعديل ردّك على ${event.title}`,
  }),
  eyebrow: pick(lang, { en: 'Update your RSVP', ar: 'تعديل ردّك' }),
  heading: escapeHtml(event.title),
  contentHtml: `
    ${greeting(guestName, lang)}
    ${para(pick(lang, {
      en: 'Someone asked to update the RSVP registered to this email address. If that was you, use the link below — it works for the next 30 minutes.',
      ar: 'وصلنا طلب لتعديل الرد المسجّل على هذا البريد. إذا كان هذا أنت، استخدم الرابط بالأسفل — صالح لمدة ٣٠ دقيقة.',
    }))}
    ${button(claimUrl, pick(lang, { en: 'Update my response', ar: 'تعديل ردّي' }))}
    ${noticeBox(pick(lang, {
      en: "If this wasn't you, ignore this email — nothing has changed, and your response stays exactly as it is.",
      ar: 'إذا لم تكن أنت، تجاهل هذه الرسالة — لم يتغيّر شيء، وردّك كما هو.',
    }), 'neutral')}
    ${para(pick(lang, CHROME.linkFallback), { size: 12, color: BRAND.stone, mb: 4 })}
    <p style="margin:0; font-family:${SANS}; font-size:11px; line-height:1.6; color:${BRAND.muted}; word-break:break-all;" dir="ltr">${escapeHtml(claimUrl)}</p>
  `,
});

/**
 * The venue block reused by every guest-facing pass: name, street address and a
 * tappable directions link.
 *
 * dir="auto" on the name/address: these are operator-entered free text that may
 * be Latin inside an RTL mail. Without it the client applies the mail's RTL
 * direction and a street number jumps to the wrong end of the line ("1089
 * Corniche El Nil" renders as "Corniche El Nil, Cairo 1089"). "auto" resolves
 * direction per value from its first strong character, so Latin and Arabic
 * addresses both read correctly.
 */
const venueValueHtml = (event, lang) => {
  const mapsUrl = buildMapsUrl(event);
  const name = event.location_name ? `<span dir="auto">${escapeHtml(event.location_name)}</span>` : '';
  const address = event.location_address
    ? `<br><span dir="auto" style="font-weight:400; font-size:13px; color:${BRAND.stone};">${escapeHtml(event.location_address)}</span>`
    : '';
  const directions = mapsUrl
    ? `<br><a href="${mapsUrl}" target="_blank" rel="noopener" style="font-size:12px; font-weight:bold; color:${BRAND.gold}; text-decoration:underline;">${pick(lang, { en: 'Get directions &rarr;', ar: 'الاتجاهات &larr;' })}</a>`
    : '';
  return `${name}${address}${directions}`;
};

/**
 * Entry pass — the QR the door scanner reads, plus the table and venue details
 * around it.
 *
 * Seating is OPTIONAL by design. The pass used to be gated on a table
 * assignment existing, which meant an organizer running an unseated event (a
 * reception, a standing party, anything not a plated dinner) could never send
 * their guests a check-in code at all. checkinController re-reads the live
 * table at scan time rather than trusting the token, so an unseated pass is
 * fully valid at the door — the table line just says so.
 */
const getQRTicketTemplate = (rsvp, event, { tableName = null, zoneName = null, links = {}, lang = 'en', changed = false } = {}) => {
  const { qrImageUrl, qrDownloadUrl, ticketUrl } = links;
  const formattedTable = formatTableLabel(tableName, lang);
  const formattedDate = formatEventDateLang(event.event_date, lang, event.timezone);
  const partySize = Number(rsvp.party_size) || 1;
  const rtl = isRtl(lang);

  const rows = [];
  if (formattedDate) rows.push([pick(lang, { en: 'Date', ar: 'التاريخ' }), escapeHtml(formattedDate)]);
  if (event.location_name || event.location_address) {
    rows.push([pick(lang, { en: 'Venue', ar: 'المكان' }), venueValueHtml(event, lang)]);
  }
  if (zoneName) rows.push([pick(lang, { en: 'Zone', ar: 'المنطقة' }), escapeHtml(zoneName)]);
  rows.push([pick(lang, { en: 'Admits', ar: 'عدد الأفراد' }), guestCount(partySize, lang)]);

  /**
   * THE SAME PASS, RE-ISSUED BECAUSE THE SEATING MOVED.
   *
   * A guest who was moved from table 7 to table 3 is holding an email that
   * says 7. Sending them the identical "here is your entry pass" mail a second
   * time does not correct that — it reads as a duplicate and gets ignored,
   * which is the failure this variant exists to prevent. The subject, the
   * eyebrow and the opening line all have to say the thing that changed.
   *
   * Everything below the intro is deliberately unchanged: the QR, the party
   * size and the venue are all still exactly right, and the door scanner
   * re-reads the live table at scan time regardless.
   */
  /* `changed` is honoured only when there is a table to name. Without one the
     notice below renders "Your table is now ." — a sentence with a hole in it.
     invitationService already refuses to derive a change for an unseated party;
     this is the same rule stated where the copy lives, so a future caller
     passing `changed: true` by hand cannot reintroduce it. */
  const announceChange = changed && !!formattedTable;

  const openingHtml = announceChange
    ? `${para(pick(lang, {
        en: 'Your host has moved your seating, so here is your pass again with the new details. Please use this email rather than the earlier one — the table on it has changed.',
        ar: 'قام مضيفك بتغيير مكان جلوسك، وهذه بطاقتك من جديد بالتفاصيل المحدَّثة. برجاء الاعتماد على هذه الرسالة بدلًا من السابقة — فقد تغيّرت الطاولة.',
      }))}
      ${noticeBox(pick(lang, {
        en: `<strong>Your table is now ${escapeHtml(formattedTable)}.</strong> Any earlier email or saved code showing a different table is out of date.`,
        ar: `<strong>طاولتك الآن ${escapeHtml(formattedTable)}.</strong> أي رسالة أو رمز محفوظ يعرض طاولة أخرى لم يعد صحيحًا.`,
      }), 'warn')}`
    : para(pick(lang, {
      en: 'Here is your personal entry pass. The QR code below is what our team scans at the door — keep this email, or download the code so you have it even without a signal on the night.',
      ar: 'هذه بطاقة دخولك الشخصية. رمز QR بالأسفل هو ما يمسحه فريقنا عند البوابة — احتفظ بهذه الرسالة، أو حمّل الرمز ليكون معك حتى بدون إنترنت ليلة الحفل.',
    }));

  return emailShell({
    ...guestBrand(event),
    lang,
    /* announceChange, NOT changed — the eyebrow and the preheader are the two
       lines a guest reads before opening anything, and keying them off the raw
       flag while the body used the guarded one would have shipped an email
       headed "Your table has changed" over a body that never says what to. */
    preheader: announceChange
      ? pick(lang, {
        en: `Your table for ${event.title} has changed`,
        ar: `تغيّرت طاولتك في ${event.title}`,
      })
      : pick(lang, {
        en: `Your check-in QR code for ${event.title} — save this email`,
        ar: `رمز دخولك إلى ${event.title} — احتفظ بهذه الرسالة`,
      }),
    eyebrow: announceChange
      ? pick(lang, { en: 'Your table has changed', ar: 'تغيّرت طاولتك' })
      : pick(lang, { en: 'Your entry pass', ar: 'بطاقة دخولك' }),
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${openingHtml}

      ${entryPass({
        guestName: rsvp.guest_name,
        eventTitle: event.title,
        qrImageUrl,
        ticketUrl,
        tableIsAssigned: !!formattedTable,
        tableValue: formattedTable || pick(lang, { en: 'Assigned when you arrive', ar: 'يُحدَّد عند وصولك' }),
        admitsLabel: rtl ? guestCount(partySize, lang) : `Admits ${partySize}`,
        reference: `#${String(rsvp.id || '').replace(/-/g, '').slice(-6).toUpperCase()}`,
        lang,
      })}

      ${qrDownloadUrl ? button(qrDownloadUrl, pick(lang, { en: '&#11015; Download my QR code', ar: '&#11015; تحميل رمز الدخول' })) : ''}
      ${ticketUrl ? button(ticketUrl, pick(lang, { en: 'Open my pass online', ar: 'فتح بطاقتي أونلاين' }), { bg: BRAND.white, color: BRAND.goldDark, border: BRAND.gold }) : ''}
      ${para(pick(lang, {
        en: "Saving the code puts it in your photos, so you can show it at the entrance without opening your email. The online pass always shows your latest table.",
        ar: 'تحميل الرمز يحفظه في صورك، فتعرضه عند المدخل دون فتح بريدك. أما البطاقة أونلاين فتعرض دائمًا آخر تحديث لطاولتك.',
      }), { size: 13, color: BRAND.stone, align: 'center', mb: 6 })}

      ${dataTable(rows, lang)}

      ${noticeBox(pick(lang, {
        en: 'This pass is personal and admits your party only. Please have it ready when you reach the entrance.',
        ar: 'هذه البطاقة شخصية وتخصّ مرافقيك وحدهم. برجاء تجهيزها عند وصولك إلى المدخل.',
      }), 'warn')}
    `,
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
   ORGANIZER NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

// Moved to utils/sideLabel.js so the dashboard export writes the SAME label
// these emails do (it used to dump the raw 'partner1'/'partner2' enum).
const { sideLabel } = require('./sideLabel');

/**
 * ── CAPS ON WHAT THE HOST'S EMAIL WILL PRINT ──
 *
 * Every value in the RSVP notification is typed by an unauthenticated stranger
 * on a public form. It is all escaped, so none of it is an injection risk — but
 * escaping does not bound SIZE, and this email is a REPORT rather than the
 * record. The record is the database; the dashboard renders it in full.
 *
 * Without these, one guest could put a 50,000-character note, a hundred
 * companion names and two hundred answers into the one message the host is
 * expected to read on a phone. Gmail silently clips a message past ~102KB —
 * so the failure mode is not a big email, it is the host seeing a truncated
 * one with "[Message clipped]" where the rest of their guest list should be.
 *
 * The caps are generous enough that no honest submission ever meets them.
 *
 * They are tighter than they look, because a dataTable ROW costs ~700 bytes of
 * inline-style markup before it holds any content at all — email HTML cannot
 * use a stylesheet, so every cell carries its own styling. A first pass at
 * these numbers (40 rows, 500-char values) measured 65KB on a legal worst-case
 * submission, most of it chrome. Quoted-printable then inflates non-ASCII by
 * roughly a third on the wire, so the raw budget has to sit well under Gmail's
 * ~102KB clip rather than merely below it.
 */
const EMAIL_VALUE_MAX = 300;   // one answer, meal name, or dietary line
const EMAIL_NOTE_MAX = 1500;   // the guest's message / decline reason
const EMAIL_LIST_MAX = 20;     // companions shown by name, meal-tally entries
const EMAIL_ANSWER_ROWS = 20;  // custom-question rows; the rest go to the dashboard

/** Trim to a cap, marking it so a truncated value never reads as the whole one. */
const clipValue = (s, max) => {
  const str = String(s);
  return str.length > max ? `${str.slice(0, max).trimEnd()}…` : str;
};

/**
 * One custom-form answer, as text.
 *
 * `answer_value` is jsonb, so it arrives as whatever the form put there: a
 * string for text and select, an ARRAY for multiselect, a boolean for a
 * checkbox, a number for number. Printing it with String() gave the organizer
 * "true" for a ticked box and "a,b" for a multiselect — which is the raw
 * storage format, not an answer to the question they wrote.
 *
 * An OBJECT is not any of those. No form control this product ships produces
 * one, so it can only arrive from a hand-rolled request, and `String({})` puts
 * the literal text "[object Object]" in the host's inbox. Dropped instead.
 */
const answerText = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    const parts = value
      .filter((v) => v !== null && v !== undefined && typeof v !== 'object')
      .map((v) => String(v).trim())
      .filter(Boolean)
      .slice(0, EMAIL_LIST_MAX);
    return parts.length ? clipValue(parts.join(', '), EMAIL_VALUE_MAX) : null;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return null;
  const s = String(value).trim();
  return s ? clipValue(s, EMAIL_VALUE_MAX) : null;
};

/** "Chicken × 2 · Vegetarian × 1" from { Chicken: 2, Vegetarian: 1 }. */
const mealTally = (counts) => {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const parts = Object.entries(counts)
    .filter(([, n]) => Number(n) > 0)
    .slice(0, EMAIL_LIST_MAX)
    .map(([meal, n]) => `${escapeHtml(clipValue(meal, 60))} &times; ${Number(n)}`);
  return parts.length ? parts.join(' &middot; ') : null;
};

/**
 * A block of prose the guest typed, quoted rather than squeezed into the
 * label/value panel.
 *
 * Notes are the one field with no length limit worth speaking of, and a
 * three-line answer in a right-aligned 15px value cell is unreadable. This
 * gives it a heading and room.
 */
const quotedNote = (label, text) => `
  <p style="margin:22px 0 6px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:1.2px; text-transform:uppercase; color:${BRAND.stone};">${escapeHtml(label)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td dir="auto" style="border-left:3px solid ${BRAND.champagne}; padding:2px 0 2px 14px; font-family:${SANS}; font-size:14px; line-height:1.7; color:${BRAND.ink}; white-space:pre-wrap;">${escapeHtml(clipValue(text, EMAIL_NOTE_MAX))}</td></tr>
  </table>`;

/**
 * Alerts the organizer that a guest just submitted an RSVP. Also sent, verbatim
 * except for the CTA/footer, to secondary recipients configured on the event
 * (e.g. groom/bride emails) via `recipientRole: 'partner'` — they don't have
 * dashboard access, so the CTA links to the public event page instead.
 *
 * ── 2026-08-22: IT CARRIES THE WHOLE SUBMISSION NOW ───────────────────────
 *
 * It used to print four rows — response, party size, email, side — out of a
 * form that can ask for a dozen things. The guest's phone number, their meal,
 * their allergy, the names of the four people they are bringing, the note they
 * wrote to the couple and every answer to every custom question the organizer
 * built were all collected, stored, and then left out of the one message the
 * host actually opens. The bride's father was told "Ahmed accepted, party of
 * 5" and had to log into a dashboard to find out who the five were.
 *
 * Everything below is OPTIONAL and omitted when absent, so an event with a
 * three-field form still sends a short, clean mail — the panel grows with the
 * form rather than printing a column of blanks.
 */
const getNewRsvpOrganizerTemplate = ({
  eventTitle, guestName, response, partySize, email, side, eventType,
  recipientRole = 'organizer', eventSlug, partner1Name, partner2Name,
  // Everything from here down is new, and every one of it is optional.
  phone = null, meal = null, dietaryNotes = null, companions = [],
  companionMealCounts = null, customAnswers = [], notes = null,
  declineReason = null, maybeConfirmBy = null, smsConsent = null,
  language = null, submittedAt = null, isUpdate = false,
  // The event's zone, so the "Submitted" stamp below reads on the
  // organizer's own clock instead of on UTC or on the server's.
  timeZone = null,
}) => {
  const r = responseMeta(response);
  const verb = response === 'yes' || response === 'accepted'
    ? 'accepted'
    : (response === 'no' || response === 'declined') ? 'declined' : 'responded to';
  const size = partySize || 1;
  const rows = [
    ['Response', `<span style="color:${r.color};">${r.label}</span>`, r.color],
    ['Party Size', `${size} ${size === 1 ? 'Guest' : 'Guests'}`],
  ];
  if (email) rows.push(['Email', escapeHtml(email)]);
  // A phone number is the field a host reaches for when something changes on
  // the day, and it was the single most conspicuous omission here.
  if (phone) rows.push(['Phone', `<a href="tel:${escapeHtml(phone)}" style="color:${BRAND.charcoal}; text-decoration:none;">${escapeHtml(phone)}</a>`]);
  const sLabel = sideLabel(side, eventType, partner1Name, partner2Name);
  if (sLabel) rows.push(['Side', escapeHtml(sLabel)]);

  if (meal) rows.push(['Meal', escapeHtml(clipValue(meal, EMAIL_VALUE_MAX))]);
  if (dietaryNotes) rows.push(['Dietary Notes', escapeHtml(clipValue(dietaryNotes, EMAIL_VALUE_MAX)), BRAND.goldDark]);

  /**
   * Companions are NAMES — that is the whole data model since the 2026-08-17
   * rebuild — so they are listed, not counted twice.
   *
   * A name that is not a string is dropped rather than coerced: `String({})`
   * is "[object Object]", and the party size row already tells the host how
   * many people are coming, so a junk entry costs nothing by being absent.
   * The count in the label is the REAL total, not the number shown, so a party
   * over the display cap still reports its true size.
   */
  const names = (companions || [])
    .map((g) => (typeof g === 'string' ? g : g?.fullName || g?.full_name))
    .filter((n) => typeof n === 'string')
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length > 0) {
    const shown = names.slice(0, EMAIL_LIST_MAX)
      .map((n) => `<span dir="auto">${escapeHtml(clipValue(n, 120))}</span>`);
    if (names.length > EMAIL_LIST_MAX) {
      shown.push(`<span style="color:${BRAND.stone};">+${names.length - EMAIL_LIST_MAX} more</span>`);
    }
    rows.push([
      names.length === 1 ? 'Bringing' : `Bringing (${names.length})`,
      shown.join('<br>'),
    ]);
  }

  const tally = mealTally(companionMealCounts);
  if (tally) rows.push(['Their Meals', tally]);

  /* The organizer wrote these questions; the answers are the reason they did.
     Row-capped: submit_rsvp_v2 accepts up to 200 answers, and 200 label/value
     rows is not a notification, it is a document. A form that long is read in
     the dashboard. */
  const answers = (customAnswers || []).slice(0, EMAIL_ANSWER_ROWS);
  for (const a of answers) {
    const label = (a?.label || '').toString().trim();
    const text = answerText(a?.value);
    if (label && text) {
      rows.push([clipValue(label, 120), `<span dir="auto">${escapeHtml(text)}</span>`]);
    }
  }
  if ((customAnswers || []).length > answers.length) {
    rows.push(['', `<span style="font-weight:400; color:${BRAND.stone};">+${customAnswers.length - answers.length} more answers — see the dashboard</span>`]);
  }

  if (maybeConfirmBy) rows.push(['Will Confirm By', escapeHtml(maybeConfirmBy), BRAND.goldDark]);

  // Only meaningful when a number was actually given — a guest who left the
  // phone field empty was never shown the consent checkbox at all, and
  // printing "Not opted in" for them reads as a refusal that never happened.
  if (phone && smsConsent !== null && smsConsent !== undefined) {
    rows.push([
      'SMS Updates',
      smsConsent ? 'Opted in' : 'Not opted in',
      smsConsent ? BRAND.success : BRAND.stone,
    ]);
  }
  // Worth saying only when it is not the default — it tells the host which
  // language this guest will be written to in every later message.
  if (language === 'ar') rows.push(['Replied In', 'Arabic']);
  if (submittedAt) {
    const when = formatDateTime(submittedAt, timeZone);
    if (when) rows.push(['Submitted', escapeHtml(when)]);
  }

  const isPartner = recipientRole === 'partner';
  const ctaUrl = isPartner ? buildGuestEventUrl(eventSlug) : `${getPublicBaseUrl()}/dashboard`;
  const ctaLabel = isPartner ? 'View Event Page' : 'View in Dashboard';
  const ctaCaption = isPartner
    ? null
    : para('Manage your guest list, seating and check-ins from your organizer dashboard.', { size: 13, color: BRAND.stone, align: 'center', mb: 0 });

  // The guest's own words, under the panel rather than inside it. Both are
  // free text with no practical length limit, and a paragraph crammed into a
  // right-aligned value cell is unreadable.
  const prose = [
    notes ? quotedNote('Message from the guest', notes) : '',
    declineReason ? quotedNote('Reason given', declineReason) : '',
  ].filter(Boolean).join('');

  // An edit is not a new RSVP, and telling a host "Ahmed accepted" for the
  // third time is how they stop reading these.
  const eyebrow = isUpdate ? 'RSVP updated' : 'New RSVP received';
  const lead = isUpdate
    ? `<strong style="color:${BRAND.charcoal};">${escapeHtml(guestName)}</strong> has updated their response — they have ${verb} your invitation.`
    : `<strong style="color:${BRAND.charcoal};">${escapeHtml(guestName)}</strong> has ${verb} your invitation.`;

  return emailShell({
    preheader: `${guestName} ${verb} — ${eventTitle}`,
    eyebrow,
    heading: escapeHtml(eventTitle),
    contentHtml: `
      ${para(lead)}
      ${dataTable(rows)}
      ${prose}
      ${button(ctaUrl, ctaLabel)}
      ${ctaCaption || ''}
    `,
    footerNote: isPartner
      ? "You're receiving this because you were added as a co-recipient for RSVP updates on this event."
      : 'You receive this because RSVP email alerts are enabled for this event.',
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
   PAYMENT & BILLING
   ═══════════════════════════════════════════════════════════════════════════ */

/** Receipt for an offline / cash payment that a Super Admin approved (event activated). */
const getCashPaymentApprovedTemplate = (orgName, eventTitle, refNumber, amountCents, tierName = null) => {
  // Mirrors getStripePaymentReceiptTemplate below — the cash-payment receipt
  // previously omitted the Plan row entirely, so a cash-paying organizer's
  // receipt email never showed which tier they'd bought (the equivalent card
  // receipt did).
  const rows = [['Event', escapeHtml(eventTitle)]];
  if (tierName) rows.push(['Plan', escapeHtml(tierName)]);
  rows.push(['Reference', `<span style="font-family:'Courier New', monospace;">${escapeHtml(refNumber)}</span>`]);
  rows.push(['Amount Paid', money(amountCents), BRAND.gold]);
  rows.push(['Status', 'Active · Online', BRAND.success]);

  return emailShell({
    preheader: `Payment approved — ${eventTitle} is now active`,
    eyebrow: 'Payment approved',
    accent: BRAND.success,
    heading: 'Your event is active',
    contentHtml: `
      ${greeting(orgName)}
      ${para('Your offline payment has been verified and approved. Your event page is now live and online.')}
      ${dataTable(rows)}
      ${button(`${getPublicBaseUrl()}/dashboard`, 'Go to Dashboard')}
      ${para('You can now manage guests, customize your form, set up tables and distribute invitation links.', { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
    `,
  });
};

/** Receipt for a successful Stripe (card) payment — event then enters review. */
const getStripePaymentReceiptTemplate = ({ orgName, eventTitle, amountCents, tierName, referenceNumber }) => {
  const rows = [['Event', escapeHtml(eventTitle)]];
  if (tierName) rows.push(['Plan', escapeHtml(tierName)]);
  rows.push(['Amount Paid', money(amountCents), BRAND.gold]);
  if (referenceNumber) rows.push(['Reference', `<span style="font-family:'Courier New', monospace; font-size:13px;">${escapeHtml(referenceNumber)}</span>`]);
  rows.push(['Status', 'Under Review', BRAND.goldDark]);

  return emailShell({
    preheader: `Payment received for ${eventTitle}`,
    eyebrow: 'Payment receipt',
    heading: 'Payment received — thank you',
    contentHtml: `
      ${greeting(orgName)}
      ${para('Thank you! Your card payment was processed successfully. Your event is now under review and will go live to guests as soon as it\'s approved — you can keep setting it up in the meantime.')}
      ${dataTable(rows)}
      ${button(`${getPublicBaseUrl()}/dashboard`, 'Go to Dashboard')}
      ${para('Please keep this email as your receipt.', { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
    `,
  });
};

/** Notifies the organizer that their event has been approved and is now live. */
const getEventLiveTemplate = ({ orgName, eventTitle, eventUrl }) => emailShell({
  preheader: `${eventTitle} is now live`,
  eyebrow: 'Your event is live',
  accent: BRAND.success,
  heading: "You're all set — it's live!",
  contentHtml: `
    ${greeting(orgName)}
    ${para(`Great news — <strong style="color:${BRAND.charcoal};">${escapeHtml(eventTitle)}</strong> has been approved and is now live. Guests can view the page and RSVP at your link below.`)}
    ${button(eventUrl, 'View Your Event', { bg: BRAND.success, border: BRAND.success })}
    ${noticeBox(`Share your event link:<br><a href="${eventUrl}" style="color:${BRAND.gold}; word-break:break-all;">${escapeHtml(eventUrl)}</a>`, 'neutral')}
    ${para('Open your dashboard to send invitations, manage seating and track responses in real time.', { size: 13, color: BRAND.stone, mb: 0 })}
  `,
});

/* ═══════════════════════════════════════════════════════════════════════════
   GUEST LIFECYCLE — reminders & post-event
   ═══════════════════════════════════════════════════════════════════════════ */

/** "You haven't responded yet" nudge as the RSVP deadline approaches. */
const getRsvpReminderTemplate = (rsvp, event, links, lang = 'en') => {
  const formattedDate = formatEventDateLang(event.event_date, lang, event.timezone);
  const deadline = formatEventDateLang(event.rsvp_deadline, lang, event.timezone);
  const rtl = isRtl(lang);
  const choice = (href, label, bg, color, border) =>
    `<td align="center" style="padding:5px 5px;"><a class="fr-btn" href="${href}" target="_blank" rel="noopener" style="display:inline-block; font-family:${SANS}; font-size:14px; font-weight:bold; color:${color}; background-color:${bg}; text-decoration:none; padding:13px 22px; border-radius:10px; border:1px solid ${border};">${label}</a></td>`;

  const ask = rtl
    ? `يسعدنا معرفة ما إذا كان بإمكانك الانضمام إلينا${formattedDate ? ` يوم <strong>${escapeHtml(formattedDate)}</strong>` : ''}. لم يصلنا ردّك بعد${deadline ? ` — وسيُغلق باب الردود يوم <strong>${escapeHtml(deadline)}</strong>` : ''}.`
    : `We'd love to know if you can join us${formattedDate ? ` on <strong>${escapeHtml(formattedDate)}</strong>` : ''}. We haven't received your response yet${deadline ? ` — RSVPs close on <strong>${escapeHtml(deadline)}</strong>` : ''}.`;

  return emailShell({
    ...guestBrand(event),
    lang,
    preheader: pick(lang, {
      en: `Reminder: please RSVP for ${event.title}`,
      ar: `تذكير: برجاء تأكيد حضورك في ${event.title}`,
    }),
    eyebrow: pick(lang, { en: 'A gentle reminder', ar: 'تذكير لطيف' }),
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${para(ask)}
      <p style="margin:8px 0 14px; font-family:${SANS}; font-size:${rtl ? '12' : '11'}px; font-weight:bold; ${rtl ? '' : 'letter-spacing:1.5px; text-transform:uppercase;'} color:${BRAND.stone}; text-align:center;">${pick(lang, { en: 'Will you attend?', ar: 'هل ستحضر؟' })}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 6px;"><tr>
        ${choice(links.accept, pick(lang, { en: '✓ Accept', ar: '✓ سأحضر' }), BRAND.success, BRAND.white, BRAND.success)}
        ${choice(links.decline, pick(lang, { en: '✕ Decline', ar: '✕ أعتذر' }), BRAND.danger, BRAND.white, BRAND.danger)}
      </tr></table>
      ${para(pick(lang, { en: 'It only takes a moment — thank you!', ar: 'لن يستغرق الأمر سوى لحظة — شكرًا لك!' }), { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
    `,
    footerNote: pick(lang, {
      en: 'Sent via Fancy RSVP on behalf of the event organizer.',
      ar: 'أُرسلت عبر Fancy RSVP نيابةً عن منظّم المناسبة.',
    }),
  });
};

/** "See you soon" sent to confirmed guests as the event nears (with table if revealed). */
/**
 * THE DAY-BEFORE REMINDER — and, since it is the last thing a guest reads
 * before they travel, the one that carries the pass.
 *
 * It used to promise one instead: "Your table assignment and QR check-in pass
 * will arrive in a separate email closer to the day." No scheduled job has ever
 * sent that email. `getQRTicketTemplate` is reachable only from the manual
 * "Resend QR ticket" button and from the moment an organizer first seats
 * someone — so a guest whose organizer never pressed that button, on an event
 * with no seating chart, was told to wait for something that never came.
 *
 * `opts.links` (from buildTicketLinks) is what closes that. When present the
 * scannable pass is embedded here directly, with the save-offline download
 * beneath it. When absent — a declined guest, an unsigned token — the email
 * degrades to exactly what it was: when, where, and the table if there is one.
 * Nothing here promises a follow-up any more, because there isn't one.
 */
const getEventReminderTemplate = (rsvp, event, opts = {}, lang = 'en') => {
  const formattedDate = formatEventDateLang(event.event_date, lang, event.timezone);
  const where = event.location_name || event.location_address || null;
  const { qrImageUrl, qrDownloadUrl, ticketUrl } = opts.links || {};
  const formattedTable = formatTableLabel(opts.tableName, lang);
  const partySize = Number(rsvp.party_size) || 1;
  const rtl = isRtl(lang);

  const rows = [];
  if (formattedDate) rows.push([pick(lang, { en: 'When', ar: 'الموعد' }), escapeHtml(formattedDate)]);
  if (where) rows.push([pick(lang, { en: 'Where', ar: 'المكان' }), venueValueHtml(event, lang)]);
  if (formattedTable) rows.push([pick(lang, { en: 'Your table', ar: 'طاولتك' }), escapeHtml(formattedTable), BRAND.gold]);

  return emailShell({
    ...guestBrand(event),
    lang,
    /**
     * NOT "tomorrow", and that is deliberate.
     *
     * jobEventReminders sweeps `now .. now + 24h`, so the guest this reaches is
     * usually a day out — but not always. A party that replies "yes" six hours
     * before the doors open, an event activated late, or the scheduler being
     * switched on the same afternoon all put the FIRST (and, because of the
     * dedupe ref, only) send a few hours before the event, where "tomorrow" is
     * simply a lie. Worse, `event_date` is UTC and "tomorrow" is a claim about
     * the reader's local calendar date, so even at T-23h it can be wrong for a
     * guest in another timezone.
     *
     * The exact date is already in the details table below in the guest's own
     * language. The eyebrow only has to convey urgency, which it can do without
     * naming a day it cannot verify.
     */
    preheader: pick(lang, {
      en: `${event.title} — your table and entry pass are in this email`,
      ar: `${event.title} — طاولتك وتذكرة دخولك في هذه الرسالة`,
    }),
    eyebrow: pick(lang, { en: 'Almost here', ar: 'اقترب الموعد' }),
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${para(pick(lang, {
        en: qrImageUrl
          ? 'See you very soon. Everything you need is below — where to go, where you are sitting, and the code we scan at the door.'
          : 'See you very soon. Here are the details for the day:',
        ar: qrImageUrl
          ? 'نراك قريبًا جدًا. كل ما تحتاجه بالأسفل — المكان، وأين ستجلس، والرمز الذي نمسحه عند الباب.'
          : 'نراك قريبًا جدًا. إليك تفاصيل اليوم:',
      }))}
      ${rows.length ? dataTable(rows, lang) : ''}
      ${qrImageUrl ? entryPass({
        guestName: rsvp.guest_name,
        eventTitle: event.title,
        qrImageUrl,
        ticketUrl,
        tableIsAssigned: !!formattedTable,
        tableValue: formattedTable || pick(lang, { en: 'Assigned when you arrive', ar: 'يُحدَّد عند وصولك' }),
        admitsLabel: rtl ? guestCount(partySize, lang) : `Admits ${partySize}`,
        reference: `#${String(rsvp.id || '').replace(/-/g, '').slice(-6).toUpperCase()}`,
        lang,
      }) : ''}
      ${qrDownloadUrl ? button(qrDownloadUrl, pick(lang, { en: '&#11015; Save my QR code', ar: '&#11015; احفظ رمز الدخول' })) : ''}
      ${ticketUrl ? button(ticketUrl, pick(lang, { en: 'Open my pass &amp; seating map', ar: 'افتح بطاقتي وخريطة الجلوس' }), { bg: BRAND.white, color: BRAND.goldDark, border: BRAND.gold }) : ''}
      ${qrImageUrl ? para(pick(lang, {
        en: 'Save the code to your photos so you can show it at the entrance even if there is no signal.',
        ar: 'احفظ الرمز في صورك لتعرضه عند المدخل حتى لو لم يكن هناك إنترنت.',
      }), { size: 13, color: BRAND.stone, align: 'center', mb: 6 }) : ''}
      ${para(pick(lang, { en: 'See you there!', ar: 'نراك هناك!' }), { mb: 0 })}
    `,
  });
};

/** Post-event thank-you to guests who attended. */
const getPostEventThankYouTemplate = (rsvp, event, lang = 'en') => {
  const named = `<strong class="fr-ink" style="color:${BRAND.charcoal};">${escapeHtml(event.title)}</strong>`;
  return emailShell({
    ...guestBrand(event),
    lang,
    preheader: pick(lang, {
      en: `Thank you for celebrating ${event.title}`,
      ar: `شكرًا لمشاركتنا الاحتفال بـ ${event.title}`,
    }),
    eyebrow: pick(lang, { en: 'Thank you', ar: 'شكرًا لك' }),
    heading: pick(lang, { en: 'Thank you for joining us', ar: 'شكرًا لانضمامك إلينا' }),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${para(isRtl(lang)
        ? `شكرًا لكونك جزءًا من ${named}. لم تكن المناسبة لتكتمل من دونك.`
        : `Thank you for being part of ${named}. It truly wouldn't have been the same without you.`)}
      ${para(pick(lang, {
        en: 'We hope you had a wonderful time, and we look forward to seeing you again at a future celebration.',
        ar: 'نتمنى أن تكون قد قضيت وقتًا رائعًا، ونتطلع لرؤيتك في مناسبة قادمة.',
      }))}
      ${para(pick(lang, {
        en: 'With gratitude,<br>The host &amp; the Fancy RSVP team',
        ar: 'مع خالص الامتنان،<br>المضيف وفريق Fancy RSVP',
      }), { color: BRAND.stone, mb: 0 })}
    `,
  });
};

/** Sent to attending guests when an organizer changes the date/time/venue. */
const getEventUpdatedTemplate = (rsvp, event, changes, eventUrl, lang = 'en') => {
  const rows = (changes || []).map((c) => [c.label, escapeHtml(c.value)]);
  return emailShell({
    ...guestBrand(event),
    lang,
    preheader: pick(lang, { en: `Update to ${event.title}`, ar: `تحديث بخصوص ${event.title}` }),
    eyebrow: pick(lang, { en: 'Event details updated', ar: 'تم تحديث تفاصيل المناسبة' }),
    accent: BRAND.goldDark,
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${para(pick(lang, {
        en: "There's been an update to an event you're attending. Please review the latest details:",
        ar: 'طرأ تحديث على مناسبة ستحضرها. يُرجى مراجعة أحدث التفاصيل:',
      }))}
      ${rows.length ? dataTable(rows, lang) : ''}
      ${button(eventUrl, pick(lang, { en: 'View Event Details', ar: 'عرض تفاصيل المناسبة' }))}
      ${para(pick(lang, {
        en: "We're sharing this so your plans stay accurate. See you there!",
        ar: 'أرسلنا لك هذا حتى تبقى خططك دقيقة. نراك هناك!',
      }), { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
    `,
  });
};

/**
 * Sent to attending guests when an organizer CANCELS the event.
 *
 * A separate template rather than a flag on the one above, because almost nothing
 * carries over. That one is built around "please review the latest details" and
 * signs off with "See you there!" — sentences that are actively cruel attached to
 * a cancellation, and the kind of thing a guest screenshots.
 *
 * Three deliberate choices:
 *   • The word "cancelled" is in the eyebrow, the heading area and the first
 *     sentence. A guest skim-reading on a lock screen must not come away thinking
 *     something merely moved.
 *   • No button. There is nothing to view and nothing to do; a gold call-to-action
 *     under this news reads as a product asking for engagement at a bad moment.
 *   • The organizer's own reason, when they gave one, is quoted verbatim and
 *     attributed. It is the only part of this message a guest actually wants, and
 *     it is not ours to paraphrase.
 */
const getEventCancelledTemplate = (rsvp, event, eventUrl, lang = 'en', reason = null) => {
  const when = event.event_date ? formatEventDate(event.event_date, event.timezone) : null;
  const rows = when ? [[pick(lang, { en: 'Was scheduled for', ar: 'كان مقررًا في' }), escapeHtml(when)]] : [];
  return emailShell({
    ...guestBrand(event),
    lang,
    preheader: pick(lang, {
      en: `${event.title} has been cancelled`,
      ar: `تم إلغاء ${event.title}`,
    }),
    eyebrow: pick(lang, { en: 'Event cancelled', ar: 'تم إلغاء المناسبة' }),
    // Not the gold accent. This is the one message in the system that should not
    // look celebratory.
    accent: BRAND.stone,
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(rsvp.guest_name, lang)}
      ${para(pick(lang, {
        en: `We're sorry to let you know that <strong>${escapeHtml(event.title)}</strong> has been cancelled. You do not need to do anything — your RSVP has been closed.`,
        ar: `يؤسفنا إبلاغك بأنه تم إلغاء <strong>${escapeHtml(event.title)}</strong>. لا حاجة لاتخاذ أي إجراء — تم إغلاق تسجيل حضورك.`,
      }))}
      ${rows.length ? dataTable(rows, lang) : ''}
      ${reason ? para(pick(lang, {
        en: `A message from the host:<br><em>${escapeHtml(reason)}</em>`,
        ar: `رسالة من المضيف:<br><em>${escapeHtml(reason)}</em>`,
      })) : ''}
      ${para(pick(lang, {
        en: 'If you have questions, please contact the host directly.',
        ar: 'إذا كان لديك أي استفسار، يُرجى التواصل مع المضيف مباشرةً.',
      }), { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
    `,
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
   ORGANIZER LIFECYCLE & REPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Onboarding welcome after the organizer verifies their email. */
const getOrganizerWelcomeTemplate = (name) => emailShell({
  preheader: 'Welcome to Fancy RSVP',
  eyebrow: 'Welcome aboard',
  heading: 'Welcome to Fancy RSVP',
  contentHtml: `
    ${greeting(name)}
    ${para('Your account is verified and ready. Fancy RSVP gives you everything to host beautifully — elegant invitations, real-time RSVP tracking, seating and QR check-in.')}
    ${dataTable([
      ['1 · Create', 'Design your event &amp; invitation'],
      ['2 · Invite', 'Send links by email, QR or SMS'],
      ['3 · Manage', 'Track RSVPs, seating &amp; check-ins live'],
    ])}
    ${button(`${getPublicBaseUrl()}/dashboard`, 'Create Your First Event')}
    ${para("We're thrilled to have you. If you ever need a hand, our team is here to help.", { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
  `,
});

/** Near-final headcount report the day before the event. */
const getFinalHeadcountReportTemplate = ({ orgName, event, stats }) => {
  const formattedDate = formatEventDate(event.event_date, event.timezone);
  return emailShell({
    preheader: `Final headcount for ${event.title}`,
    eyebrow: 'Final headcount',
    heading: escapeHtml(event.title),
    contentHtml: `
      ${greeting(orgName)}
      ${para(`Your event is coming up${formattedDate ? ` on <strong>${escapeHtml(formattedDate)}</strong>` : ''}. Here is your near-final headcount to confirm catering and seating:`)}
      ${statGrid([
        { label: 'Attending', value: stats.attending, color: BRAND.success },
        { label: 'Guests', value: stats.headcount, color: BRAND.gold },
        { label: 'Maybe', value: stats.maybe, color: BRAND.goldDark },
        { label: 'Pending', value: stats.pending, color: BRAND.stone },
      ])}
      ${dataTable([
        ['Confirmed Headcount', `${stats.headcount}`, BRAND.gold],
        ['Declined', `${stats.declined}`],
        ['Response Rate', `${stats.responseRate}%`],
      ])}
      ${button(`${getPublicBaseUrl()}/dashboard`, 'Open Dashboard')}
      ${para("Tip: you can still nudge guests who haven't responded from your dashboard.", { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
    `,
  });
};

/** Post-event recap report for the organizer. */
const getPostEventRecapTemplate = ({ orgName, event, stats }) => emailShell({
  preheader: `Recap for ${event.title}`,
  eyebrow: 'Event recap',
  accent: BRAND.success,
  heading: escapeHtml(event.title),
  contentHtml: `
    ${greeting(orgName)}
    ${para("Congratulations on a successful event! Here's a quick recap of how it went:")}
    ${statGrid([
      { label: 'Confirmed', value: stats.attending, color: BRAND.success },
      { label: 'Guests', value: stats.headcount, color: BRAND.gold },
      { label: 'Checked In', value: stats.checkedIn, color: BRAND.charcoal },
    ])}
    ${dataTable([
      ['Total RSVPs', `${stats.total}`],
      ['Attended (checked in)', `${stats.checkedIn}`, BRAND.success],
      ['Response Rate', `${stats.responseRate}%`],
    ])}
    ${para("Thank you for hosting with Fancy RSVP — we'd love to help you plan the next one.", { mb: 0 })}
  `,
});

/** Nudge to complete the platform fee for an unpaid draft event. */
const getPendingPaymentReminderTemplate = ({ orgName, event }) => emailShell({
  preheader: `Activate ${event.title}`,
  eyebrow: 'Almost there',
  accent: BRAND.goldDark,
  heading: 'Your event is ready to go live',
  contentHtml: `
    ${greeting(orgName)}
    ${para(`You created <strong style="color:${BRAND.charcoal};">${escapeHtml(event.title)}</strong> but haven't completed the platform fee yet. Your event stays a private draft until it's activated — finish in a minute to start collecting RSVPs.`)}
    ${button(`${getPublicBaseUrl()}/dashboard`, 'Activate My Event')}
    ${para('You can pay by card or arrange an offline transfer from your dashboard.', { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
  `,
});

/** Operational alert when an organizer's SMS balance is running low. */
const getLowCreditsWarningTemplate = ({ orgName, event, remaining }) => emailShell({
  preheader: 'Your SMS credits are running low',
  eyebrow: 'Heads up',
  accent: BRAND.goldDark,
  heading: 'Your SMS credits are running low',
  contentHtml: `
    ${greeting(orgName)}
    ${para(`Your SMS balance${event && event.title ? ` for <strong style="color:${BRAND.charcoal};">${escapeHtml(event.title)}</strong>` : ''} is down to <strong style="color:${BRAND.goldDark};">${Number(remaining) || 0}</strong> credits. Top up so your invitations and reminders keep going out.`)}
    ${button(`${getPublicBaseUrl()}/dashboard/campaigns`, 'Top Up Credits')}
    ${para("You'll only receive this once per low-balance period.", { size: 13, color: BRAND.stone, align: 'center', mb: 0 })}
  `,
});

/* ═══════════════════════════════════════════════════════════════════════════
   MARKETING & INQUIRIES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Admin reply to a public Contact page / /solutions/* B2B inquiry submission. */
const getContactInquiryReplyTemplate = ({ name, subject, originalMessage, replyMessage }) => emailShell({
  preheader: `Re: ${subject}`,
  eyebrow: 'Fancy RSVP Team',
  heading: `Re: ${escapeHtml(subject)}`,
  contentHtml: `
    ${greeting(name)}
    ${para(escapeHtml(replyMessage).replace(/\n/g, '<br>'))}
    ${noticeBox(`<strong>Your original message:</strong><br>${escapeHtml(originalMessage).replace(/\n/g, '<br>')}`, 'neutral')}
    ${para('Thanks for reaching out to Fancy RSVP.', { size: 13, color: BRAND.stone, mb: 0 })}
  `,
});

/* ═══════════════════════════════════════════════════════════════════════════
   SECURITY
   ═══════════════════════════════════════════════════════════════════════════ */

/** Confirmation that the account password was changed. */
const getPasswordChangedTemplate = (name) => emailShell({
  preheader: 'Your password was changed',
  eyebrow: 'Security',
  heading: 'Your password was changed',
  contentHtml: `
    ${greeting(name)}
    ${para('This confirms the password on your Fancy RSVP account was just changed. For your security, all other active sessions have been signed out.')}
    ${noticeBox('If you did <strong>not</strong> make this change, reset your password immediately and contact support — your account may be at risk.', 'danger')}
    ${para('If this was you, no further action is needed.', { size: 13, color: BRAND.stone, mb: 0 })}
  `,
});

/** Alert on a sign-in from a new device / location. */
const getNewSignInTemplate = (name, info = {}) => {
  const rows = [];
  if (info.device) rows.push(['Device', escapeHtml(info.device)]);
  if (info.ip) rows.push(['IP Address', escapeHtml(info.ip)]);
  if (info.when) rows.push(['When', escapeHtml(info.when)]);
  return emailShell({
    preheader: 'New sign-in to your Fancy RSVP account',
    eyebrow: 'Security',
    heading: 'New sign-in detected',
    contentHtml: `
      ${greeting(name)}
      ${para('We noticed a sign-in to your Fancy RSVP account from a new device or location:')}
      ${rows.length ? dataTable(rows) : ''}
      ${noticeBox('If this was you, you can ignore this email. If not, reset your password right away and review your active sessions.', 'warn')}
      ${para('We send these alerts to help keep your account secure.', { size: 13, color: BRAND.stone, mb: 0 })}
    `,
  });
};

module.exports = {
  escapeHtml,
  getPublicBaseUrl,
  buildGuestEventUrl,
  buildGuestRsvpUrl,
  buildTicketLinks,
  formatEventDate,
  // RSVP lifecycle
  getInvitationTemplate,
  getRSVPConfirmationTemplate,
  getCompanionRSVPConfirmationTemplate,
  getDeclineConfirmationTemplate,
  getRsvpClaimTemplate,
  getQRTicketTemplate,
  getRsvpReminderTemplate,
  getEventReminderTemplate,
  getPostEventThankYouTemplate,
  getEventUpdatedTemplate,
  getEventCancelledTemplate,
  // Organizer
  getNewRsvpOrganizerTemplate,
  getOrganizerWelcomeTemplate,
  getFinalHeadcountReportTemplate,
  getPostEventRecapTemplate,
  getPendingPaymentReminderTemplate,
  getLowCreditsWarningTemplate,
  // Marketing & inquiries
  getContactInquiryReplyTemplate,
  // Auth & security
  getEmailVerificationTemplate,
  getPasswordResetTemplate,
  getPasswordChangedTemplate,
  getNewSignInTemplate,
  // Payment & billing
  getCashPaymentApprovedTemplate,
  getStripePaymentReceiptTemplate,
  getEventLiveTemplate,
};
