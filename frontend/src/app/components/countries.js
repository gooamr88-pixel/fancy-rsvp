/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DIALLING CODES → COUNTRY.
 *
 * Split out of CountryCodePhoneInput when the emoji flags were replaced with
 * drawn SVG ones, because the table then had three consumers rather than one:
 * the input, the flag renderer (which needs the ISO code, not the emoji) and
 * the Arabic guest surface (which needs the country's name in Arabic).
 *
 * ── AMBIGUOUS CODES ──
 *
 * A dialling code is not a country. "+1" is the United States, Canada and
 * twenty Caribbean nations; "+7" is Russia and Kazakhstan. There is no correct
 * answer from the digits alone, so each ambiguous code resolves to the country
 * that dominates it, and the UI says the name out loud rather than only showing
 * a flag — a Canadian guest typing +1 sees "United States" and knows the
 * platform simply groups the North American plan, instead of wondering why a
 * flag they do not recognise appeared.
 *
 * ── WEIGHTING ──
 *
 * Deliberately dense on the Arab world and the Gulf, which is this platform's
 * primary market, plus every major global market. It is not exhaustive and does
 * not need to be: an unmapped code still validates, still submits, and shows a
 * neutral globe rather than a wrong flag.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** @type {Record<string, { iso2: string, name: string, nameAr: string }>} */
export const COUNTRY_BY_CODE = {
  1: { iso2: 'US', name: 'United States', nameAr: 'الولايات المتحدة' },
  7: { iso2: 'RU', name: 'Russia', nameAr: 'روسيا' },
  20: { iso2: 'EG', name: 'Egypt', nameAr: 'مصر' },
  27: { iso2: 'ZA', name: 'South Africa', nameAr: 'جنوب أفريقيا' },
  30: { iso2: 'GR', name: 'Greece', nameAr: 'اليونان' },
  31: { iso2: 'NL', name: 'Netherlands', nameAr: 'هولندا' },
  32: { iso2: 'BE', name: 'Belgium', nameAr: 'بلجيكا' },
  33: { iso2: 'FR', name: 'France', nameAr: 'فرنسا' },
  34: { iso2: 'ES', name: 'Spain', nameAr: 'إسبانيا' },
  39: { iso2: 'IT', name: 'Italy', nameAr: 'إيطاليا' },
  40: { iso2: 'RO', name: 'Romania', nameAr: 'رومانيا' },
  41: { iso2: 'CH', name: 'Switzerland', nameAr: 'سويسرا' },
  44: { iso2: 'GB', name: 'United Kingdom', nameAr: 'المملكة المتحدة' },
  45: { iso2: 'DK', name: 'Denmark', nameAr: 'الدنمارك' },
  46: { iso2: 'SE', name: 'Sweden', nameAr: 'السويد' },
  47: { iso2: 'NO', name: 'Norway', nameAr: 'النرويج' },
  48: { iso2: 'PL', name: 'Poland', nameAr: 'بولندا' },
  49: { iso2: 'DE', name: 'Germany', nameAr: 'ألمانيا' },
  51: { iso2: 'PE', name: 'Peru', nameAr: 'بيرو' },
  52: { iso2: 'MX', name: 'Mexico', nameAr: 'المكسيك' },
  54: { iso2: 'AR', name: 'Argentina', nameAr: 'الأرجنتين' },
  55: { iso2: 'BR', name: 'Brazil', nameAr: 'البرازيل' },
  56: { iso2: 'CL', name: 'Chile', nameAr: 'تشيلي' },
  57: { iso2: 'CO', name: 'Colombia', nameAr: 'كولومبيا' },
  60: { iso2: 'MY', name: 'Malaysia', nameAr: 'ماليزيا' },
  61: { iso2: 'AU', name: 'Australia', nameAr: 'أستراليا' },
  62: { iso2: 'ID', name: 'Indonesia', nameAr: 'إندونيسيا' },
  63: { iso2: 'PH', name: 'Philippines', nameAr: 'الفلبين' },
  64: { iso2: 'NZ', name: 'New Zealand', nameAr: 'نيوزيلندا' },
  65: { iso2: 'SG', name: 'Singapore', nameAr: 'سنغافورة' },
  66: { iso2: 'TH', name: 'Thailand', nameAr: 'تايلاند' },
  81: { iso2: 'JP', name: 'Japan', nameAr: 'اليابان' },
  82: { iso2: 'KR', name: 'South Korea', nameAr: 'كوريا الجنوبية' },
  86: { iso2: 'CN', name: 'China', nameAr: 'الصين' },
  90: { iso2: 'TR', name: 'Turkey', nameAr: 'تركيا' },
  91: { iso2: 'IN', name: 'India', nameAr: 'الهند' },
  92: { iso2: 'PK', name: 'Pakistan', nameAr: 'باكستان' },
  93: { iso2: 'AF', name: 'Afghanistan', nameAr: 'أفغانستان' },
  94: { iso2: 'LK', name: 'Sri Lanka', nameAr: 'سريلانكا' },
  95: { iso2: 'MM', name: 'Myanmar', nameAr: 'ميانمار' },
  98: { iso2: 'IR', name: 'Iran', nameAr: 'إيران' },
  211: { iso2: 'SS', name: 'South Sudan', nameAr: 'جنوب السودان' },
  212: { iso2: 'MA', name: 'Morocco', nameAr: 'المغرب' },
  213: { iso2: 'DZ', name: 'Algeria', nameAr: 'الجزائر' },
  216: { iso2: 'TN', name: 'Tunisia', nameAr: 'تونس' },
  218: { iso2: 'LY', name: 'Libya', nameAr: 'ليبيا' },
  220: { iso2: 'GM', name: 'Gambia', nameAr: 'غامبيا' },
  221: { iso2: 'SN', name: 'Senegal', nameAr: 'السنغال' },
  234: { iso2: 'NG', name: 'Nigeria', nameAr: 'نيجيريا' },
  254: { iso2: 'KE', name: 'Kenya', nameAr: 'كينيا' },
  351: { iso2: 'PT', name: 'Portugal', nameAr: 'البرتغال' },
  352: { iso2: 'LU', name: 'Luxembourg', nameAr: 'لوكسمبورغ' },
  353: { iso2: 'IE', name: 'Ireland', nameAr: 'أيرلندا' },
  358: { iso2: 'FI', name: 'Finland', nameAr: 'فنلندا' },
  359: { iso2: 'BG', name: 'Bulgaria', nameAr: 'بلغاريا' },
  370: { iso2: 'LT', name: 'Lithuania', nameAr: 'ليتوانيا' },
  371: { iso2: 'LV', name: 'Latvia', nameAr: 'لاتفيا' },
  372: { iso2: 'EE', name: 'Estonia', nameAr: 'إستونيا' },
  380: { iso2: 'UA', name: 'Ukraine', nameAr: 'أوكرانيا' },
  385: { iso2: 'HR', name: 'Croatia', nameAr: 'كرواتيا' },
  386: { iso2: 'SI', name: 'Slovenia', nameAr: 'سلوفينيا' },
  420: { iso2: 'CZ', name: 'Czech Republic', nameAr: 'التشيك' },
  421: { iso2: 'SK', name: 'Slovakia', nameAr: 'سلوفاكيا' },
  960: { iso2: 'MV', name: 'Maldives', nameAr: 'المالديف' },
  961: { iso2: 'LB', name: 'Lebanon', nameAr: 'لبنان' },
  962: { iso2: 'JO', name: 'Jordan', nameAr: 'الأردن' },
  963: { iso2: 'SY', name: 'Syria', nameAr: 'سوريا' },
  964: { iso2: 'IQ', name: 'Iraq', nameAr: 'العراق' },
  965: { iso2: 'KW', name: 'Kuwait', nameAr: 'الكويت' },
  966: { iso2: 'SA', name: 'Saudi Arabia', nameAr: 'السعودية' },
  967: { iso2: 'YE', name: 'Yemen', nameAr: 'اليمن' },
  968: { iso2: 'OM', name: 'Oman', nameAr: 'عُمان' },
  970: { iso2: 'PS', name: 'Palestine', nameAr: 'فلسطين' },
  971: { iso2: 'AE', name: 'United Arab Emirates', nameAr: 'الإمارات' },
  972: { iso2: 'IL', name: 'Israel', nameAr: 'إسرائيل' },
  973: { iso2: 'BH', name: 'Bahrain', nameAr: 'البحرين' },
  974: { iso2: 'QA', name: 'Qatar', nameAr: 'قطر' },
  975: { iso2: 'BT', name: 'Bhutan', nameAr: 'بوتان' },
  976: { iso2: 'MN', name: 'Mongolia', nameAr: 'منغوليا' },
  977: { iso2: 'NP', name: 'Nepal', nameAr: 'نيبال' },

  /* ── The second pass ────────────────────────────────────────────────────
   *
   * Added after seeing the field render "+299" as an EMPTY code box with
   * "299123456" spilled into the local-number box. splitInitialValue can only
   * find where a dialling code ends if the code is in this table, so every gap
   * here is a guest whose number displays as one undifferentiated string.
   *
   * The value still round-trips correctly in that state — nothing is lost — but
   * it looks broken, and "looks broken" on the phone field is the last thing an
   * RSVP needs. Coverage IS the fix; a length heuristic is not, because 2-digit
   * (36, 43, 58, 84) and 3-digit codes are indistinguishable from the digits
   * alone.
   */
  36: { iso2: 'HU', name: 'Hungary', nameAr: 'المجر' },
  43: { iso2: 'AT', name: 'Austria', nameAr: 'النمسا' },
  53: { iso2: 'CU', name: 'Cuba', nameAr: 'كوبا' },
  58: { iso2: 'VE', name: 'Venezuela', nameAr: 'فنزويلا' },
  84: { iso2: 'VN', name: 'Vietnam', nameAr: 'فيتنام' },
  225: { iso2: 'CI', name: "Côte d'Ivoire", nameAr: 'ساحل العاج' },
  233: { iso2: 'GH', name: 'Ghana', nameAr: 'غانا' },
  237: { iso2: 'CM', name: 'Cameroon', nameAr: 'الكاميرون' },
  243: { iso2: 'CD', name: 'DR Congo', nameAr: 'الكونغو الديمقراطية' },
  249: { iso2: 'SD', name: 'Sudan', nameAr: 'السودان' },
  251: { iso2: 'ET', name: 'Ethiopia', nameAr: 'إثيوبيا' },
  255: { iso2: 'TZ', name: 'Tanzania', nameAr: 'تنزانيا' },
  256: { iso2: 'UG', name: 'Uganda', nameAr: 'أوغندا' },
  260: { iso2: 'ZM', name: 'Zambia', nameAr: 'زامبيا' },
  263: { iso2: 'ZW', name: 'Zimbabwe', nameAr: 'زيمبابوي' },
  299: { iso2: 'GL', name: 'Greenland', nameAr: 'غرينلاند' },
  350: { iso2: 'GI', name: 'Gibraltar', nameAr: 'جبل طارق' },
  354: { iso2: 'IS', name: 'Iceland', nameAr: 'آيسلندا' },
  355: { iso2: 'AL', name: 'Albania', nameAr: 'ألبانيا' },
  356: { iso2: 'MT', name: 'Malta', nameAr: 'مالطا' },
  357: { iso2: 'CY', name: 'Cyprus', nameAr: 'قبرص' },
  373: { iso2: 'MD', name: 'Moldova', nameAr: 'مولدوفا' },
  375: { iso2: 'BY', name: 'Belarus', nameAr: 'بيلاروسيا' },
  376: { iso2: 'AD', name: 'Andorra', nameAr: 'أندورا' },
  377: { iso2: 'MC', name: 'Monaco', nameAr: 'موناكو' },
  378: { iso2: 'SM', name: 'San Marino', nameAr: 'سان مارينو' },
  381: { iso2: 'RS', name: 'Serbia', nameAr: 'صربيا' },
  382: { iso2: 'ME', name: 'Montenegro', nameAr: 'الجبل الأسود' },
  387: { iso2: 'BA', name: 'Bosnia & Herzegovina', nameAr: 'البوسنة والهرسك' },
  389: { iso2: 'MK', name: 'North Macedonia', nameAr: 'مقدونيا الشمالية' },
  423: { iso2: 'LI', name: 'Liechtenstein', nameAr: 'ليختنشتاين' },
  852: { iso2: 'HK', name: 'Hong Kong', nameAr: 'هونغ كونغ' },
  853: { iso2: 'MO', name: 'Macau', nameAr: 'ماكاو' },
  855: { iso2: 'KH', name: 'Cambodia', nameAr: 'كمبوديا' },
  856: { iso2: 'LA', name: 'Laos', nameAr: 'لاوس' },
  880: { iso2: 'BD', name: 'Bangladesh', nameAr: 'بنغلاديش' },
  886: { iso2: 'TW', name: 'Taiwan', nameAr: 'تايوان' },
  992: { iso2: 'TJ', name: 'Tajikistan', nameAr: 'طاجيكستان' },
  993: { iso2: 'TM', name: 'Turkmenistan', nameAr: 'تركمانستان' },
  994: { iso2: 'AZ', name: 'Azerbaijan', nameAr: 'أذربيجان' },
  995: { iso2: 'GE', name: 'Georgia', nameAr: 'جورجيا' },
  996: { iso2: 'KG', name: 'Kyrgyzstan', nameAr: 'قيرغيزستان' },
  998: { iso2: 'UZ', name: 'Uzbekistan', nameAr: 'أوزبكستان' },
};

/**
 * The country for a typed dialling code, resolved LONGEST-PREFIX-FIRST.
 *
 * The old lookup was a bare `COUNTRY_BY_CODE[code]`, which only ever matched a
 * complete code — so a guest typing "9", "96", "966" saw a globe, a globe, and
 * then Saudi Arabia. Matching on the longest known prefix means the flag
 * resolves as soon as the digits are unambiguous and stays resolved, which is
 * what makes it feel like the field is reading along rather than waiting.
 *
 * Longest first is required, not incidental: "97" is unassigned here while
 * "970"..."977" are real, and a shortest-first scan would answer "+971" with
 * whatever it found for "9".
 */
export function lookupDialCode(code) {
  const digits = String(code || '').replace(/\D/g, '');
  if (!digits) return null;
  for (let len = Math.min(4, digits.length); len >= 1; len -= 1) {
    const hit = COUNTRY_BY_CODE[digits.slice(0, len)];
    // Only an EXACT match counts as resolved. A partial "96" must not report
    // Saudi Arabia — the guest has not finished typing, and a flag that appears
    // and then changes country under their fingers is worse than one that waits.
    if (hit && digits.length === len) return hit;
  }
  return null;
}

/** The country's name in the guest's own language. */
export function countryName(country, isRTL) {
  if (!country) return null;
  return isRTL ? (country.nameAr || country.name) : country.name;
}
