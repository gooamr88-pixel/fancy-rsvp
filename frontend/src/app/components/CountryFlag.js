'use client';

/* `React` is imported and it is NOT unused — vitest compiles this file with the
   classic JSX runtime. See SmsConsentText.js for the full note. */
import React from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * COUNTRY FLAGS, DRAWN AS SVG.
 *
 * ── WHY THIS EXISTS AT ALL: THE EMOJI FLAGS DID NOT WORK ──
 *
 * The guest phone field used emoji flags ("🇸🇦"). Those are regional-indicator
 * PAIRS, and **Windows does not have flag glyphs for them** — not in Chrome, not
 * in Edge, not in Firefox. On the single most common desktop OS a guest saw two
 * boxed letters, "S A", where a flag was supposed to be. It was never a styling
 * preference; the feature was simply absent for a large share of guests, and
 * silently, because it renders perfectly on the Mac it was written on.
 *
 * ── WHY DRAWN AND NOT DOWNLOADED ──
 *
 * The alternatives were a CDN sprite or an npm flag package. A CDN puts a
 * third-party request on the guest invitation page, which is the one surface
 * that has to be self-contained and fast on a phone at a venue. A package means
 * touching node_modules in an npm WORKSPACE, which has taken this deployment
 * down before.
 *
 * ── WHY SIMPLIFIED GEOMETRY IS THE RIGHT FIDELITY, NOT A COMPROMISE ──
 *
 * These render at 22×16 CSS pixels. At that size the eye resolves the COLOUR
 * ARRANGEMENT and the gross shape and nothing else — the eagle on Egypt's flag
 * or the 50 stars on the United States' occupy about two pixels and read as a
 * smudge either way. So each flag is built from the layout that actually
 * identifies it, in the correct official colours, and emblems are reduced to a
 * mark of the right colour in the right place. A crisp simplified vector is
 * more legible at 22px than a downscaled photograph of a flag, not less.
 *
 * Where a country's identity IS the emblem rather than the field (Saudi Arabia,
 * Iran, Iraq, Oman), the emblem gets a dedicated simplified glyph rather than
 * being dropped — a plain green rectangle is not Saudi Arabia's flag.
 *
 * ── ONE ASPECT RATIO FOR ALL OF THEM ──
 *
 * Real flags are 2:3, 1:2, 3:5, 5:8 and, for Nepal, not a rectangle at all.
 * Rendering each at its true ratio makes a row of them ragged and makes the
 * input jump as the guest types. Every flag here is drawn into the same 4:3 box
 * with a hairline border and a soft inner highlight, which is what every
 * well-made picker does and is why they look like a set.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* The canvas every spec is drawn into. 60×45 keeps the common thirds and
   quarters on integers, which keeps edges crisp at small sizes. */
const W = 60;
const H = 45;

/** Equal horizontal bands, top to bottom. */
const h = (...colors) => colors.map((fill, i) => (
  <rect key={`h${i}`} x="0" y={(H / colors.length) * i} width={W} height={H / colors.length} fill={fill} />
));

/** Equal vertical bands, hoist to fly. */
const v = (...colors) => colors.map((fill, i) => (
  <rect key={`v${i}`} x={(W / colors.length) * i} y="0" width={W / colors.length} height={H} fill={fill} />
));

/** Horizontal bands with explicit weights, e.g. hb([1,2,1], ['#a','#b','#c']). */
const hb = (weights, colors) => {
  const total = weights.reduce((a, b) => a + b, 0);
  let y = 0;
  return weights.map((wt, i) => {
    const height = (H * wt) / total;
    const el = <rect key={`hb${i}`} x="0" y={y} width={W} height={height} fill={colors[i]} />;
    y += height;
    return el;
  });
};

const rect = (x, y, w, ht, fill, key = 'r') => <rect key={key} x={x} y={y} width={w} height={ht} fill={fill} />;
const disc = (fill, cx = W / 2, cy = H / 2, r = 10, key = 'd') => <circle key={key} cx={cx} cy={cy} r={r} fill={fill} />;

/** A five-pointed star, pointing up. */
const star = (fill, cx, cy, r, key = 's') => {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.382;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return <polygon key={key} points={pts.join(' ')} fill={fill} />;
};

/** A crescent: a disc with a smaller disc punched out of it, offset toward the fly. */
const crescent = (fill, cx, cy, r, key = 'c') => (
  <path
    key={key}
    fill={fill}
    d={`M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} Z
        M ${cx + r * 0.55} ${cy} A ${r * 0.78} ${r * 0.78} 0 1 0 ${cx - r * 0.05} ${cy} A ${r * 0.78} ${r * 0.78} 0 1 0 ${cx + r * 0.55} ${cy} Z`}
    fillRule="evenodd"
  />
);

/** The Nordic cross — offset toward the hoist, as every one of them is. */
const nordic = (bg, cross) => [
  rect(0, 0, W, H, bg, 'nb'),
  rect(20, 0, 8, H, cross, 'nv'),
  rect(0, 18.5, W, 8, cross, 'nh'),
];

/** A triangle rising from the hoist edge. */
const triangle = (fill, width = 24, key = 't') => (
  <polygon key={key} points={`0,0 ${width},${H / 2} 0,${H}`} fill={fill} />
);

/**
 * THE SPEC TABLE, keyed by ISO 3166-1 alpha-2.
 *
 * Ordered by dial code to match countries.js, so the two can be read side by
 * side when adding a market.
 */
const FLAGS = {
  /* ── Americas ── */
  US: () => [
    ...hb([1, 1, 1, 1, 1, 1, 1], ['#B22234', '#FFF', '#B22234', '#FFF', '#B22234', '#FFF', '#B22234']),
    rect(0, 0, 26, 24, '#3C3B6E', 'c'),
    // A suggestion of the canton's stars. Fifty would be sub-pixel noise.
    ...[6, 13, 20].flatMap((x, i) => [5, 12, 19].map((y, j) => star('#FFF', x, y, 2.1, `s${i}${j}`))),
  ],
  MX: () => [...v('#006847', '#FFF', '#CE1126'), disc('#8B5A2B', W / 2, H / 2, 5)],
  BR: () => [
    rect(0, 0, W, H, '#009B3A', 'b'),
    <polygon key="d" points={`${W / 2},5 ${W - 6},${H / 2} ${W / 2},${H - 5} 6,${H / 2}`} fill="#FEDF00" />,
    disc('#002776', W / 2, H / 2, 9),
  ],
  AR: () => [...h('#74ACDF', '#FFF', '#74ACDF'), disc('#F6B40E', W / 2, H / 2, 4.5)],
  CL: () => [
    rect(0, 0, W, H / 2, '#FFF', 'w'), rect(0, H / 2, W, H / 2, '#D52B1E', 'r'),
    rect(0, 0, 22, H / 2, '#0039A6', 'c'), star('#FFF', 11, 11.25, 6),
  ],
  CO: () => hb([2, 1, 1], ['#FCD116', '#003893', '#CE1126']),
  PE: () => v('#D91023', '#FFF', '#D91023'),

  /* ── Europe ── */
  RU: () => h('#FFF', '#0039A6', '#D52B1E'),
  GR: () => [
    ...hb([1, 1, 1, 1, 1, 1, 1, 1, 1], ['#0D5EAF', '#FFF', '#0D5EAF', '#FFF', '#0D5EAF', '#FFF', '#0D5EAF', '#FFF', '#0D5EAF']),
    rect(0, 0, 25, 25, '#0D5EAF', 'c'),
    rect(10, 0, 5, 25, '#FFF', 'cv'), rect(0, 10, 25, 5, '#FFF', 'ch'),
  ],
  NL: () => h('#AE1C28', '#FFF', '#21468B'),
  BE: () => v('#000', '#FDDA24', '#EF3340'),
  FR: () => v('#002395', '#FFF', '#ED2939'),
  ES: () => hb([1, 2, 1], ['#AA151B', '#F1BF00', '#AA151B']),
  IT: () => v('#008C45', '#F4F5F0', '#CD212A'),
  RO: () => v('#002B7F', '#FCD116', '#CE1126'),
  CH: () => [rect(0, 0, W, H, '#D52B1E', 'b'), rect(25, 10, 10, 25, '#FFF', 'cv'), rect(17.5, 17.5, 25, 10, '#FFF', 'ch')],
  GB: () => [
    rect(0, 0, W, H, '#012169', 'b'),
    <path key="ds" d={`M0,0 L${W},${H} M${W},0 L0,${H}`} stroke="#FFF" strokeWidth="9" />,
    <path key="dr" d={`M0,0 L${W},${H} M${W},0 L0,${H}`} stroke="#C8102E" strokeWidth="5" />,
    rect(0, 16, W, 13, '#FFF', 'ch'), rect(23.5, 0, 13, H, '#FFF', 'cv'),
    rect(0, 18.5, W, 8, '#C8102E', 'rh'), rect(26, 0, 8, H, '#C8102E', 'rv'),
  ],
  DK: () => nordic('#C8102E', '#FFF'),
  SE: () => nordic('#006AA7', '#FECC00'),
  NO: () => [...nordic('#BA0C2F', '#FFF'), rect(22, 0, 4, H, '#00205B', 'iv'), rect(0, 20.5, W, 4, '#00205B', 'ih')],
  PL: () => h('#FFF', '#DC143C'),
  DE: () => h('#000', '#DD0000', '#FFCE00'),
  PT: () => [
    rect(0, 0, 24, H, '#006600', 'g'), rect(24, 0, W - 24, H, '#FF0000', 'r'),
    disc('#FFD700', 24, H / 2, 8), disc('#FFF', 24, H / 2, 4.5),
  ],
  LU: () => h('#ED2939', '#FFF', '#00A1DE'),
  IE: () => v('#169B62', '#FFF', '#FF883E'),
  FI: () => nordic('#FFF', '#003580'),
  BG: () => h('#FFF', '#00966E', '#D62612'),
  LT: () => h('#FDB913', '#006A44', '#C1272D'),
  LV: () => hb([2, 1, 2], ['#9E3039', '#FFF', '#9E3039']),
  EE: () => h('#0072CE', '#000', '#FFF'),
  UA: () => h('#0057B7', '#FFD700'),
  HR: () => [...h('#FF0000', '#FFF', '#171796'), rect(24, 12, 12, 14, '#FF0000', 'sh'), rect(24, 12, 12, 7, '#FFF', 'sw')],
  SI: () => [...h('#FFF', '#0000FF', '#FF0000'), rect(9, 8, 12, 14, '#0000FF', 'sh'), star('#FFD700', 15, 12, 3)],
  CZ: () => [...h('#FFF', '#D7141A'), triangle('#11457E', 26)],
  SK: () => [...h('#FFF', '#0B4EA2', '#EE1C25'), rect(13, 12, 14, 18, '#EE1C25', 'sh'), rect(13, 12, 14, 9, '#FFF', 'sw')],

  /* ── Africa ── */
  /**
   * South Africa is the one flag here whose identity is a SHAPE rather than a
   * stack of bands, and the first attempt got it wrong: bands plus a gold wedge,
   * which read as "a flag with a triangle" and dropped both the black hoist
   * triangle and the horizontal arm of the green pall.
   *
   * Drawn as the pall it actually is — green Y on white fimbriation, gold
   * border, black triangle at the hoist. Still simplified, but simplified into
   * the right silhouette instead of a different one.
   */
  ZA: () => [
    rect(0, 0, W, H / 2, '#E03C31', 'top'),
    rect(0, H / 2, W, H / 2, '#001489', 'bot'),
    // White fimbriation, then the green pall on top of it, then the gold, then
    // the black — each one narrower, which is what makes the Y read.
    <path key="wpall" d={`M0,-2 L26,${H / 2} L${W},${H / 2} M0,${H + 2} L26,${H / 2}`} stroke="#FFF" strokeWidth="17" fill="none" />,
    <path key="gpall" d={`M0,0 L23,${H / 2} L${W},${H / 2} M0,${H} L23,${H / 2}`} stroke="#007749" strokeWidth="9" fill="none" />,
    <polygon key="gold" points={`0,0 20,${H / 2} 0,${H}`} fill="#FFB81C" />,
    <polygon key="blk" points={`0,4 14,${H / 2} 0,41`} fill="#000" />,
  ],
  EG: () => [...h('#CE1126', '#FFF', '#000'), star('#C09300', W / 2, H / 2, 5)],
  SS: () => [
    ...hb([1, 1, 1, 1, 1], ['#000', '#FFF', '#DA121A', '#FFF', '#078930']),
    triangle('#0F47AF', 22), star('#FCDD09', 7, H / 2, 4),
  ],
  MA: () => [rect(0, 0, W, H, '#C1272D', 'b'), star('#006233', W / 2, H / 2, 11)],
  DZ: () => [
    rect(0, 0, W / 2, H, '#006233', 'g'), rect(W / 2, 0, W / 2, H, '#FFF', 'w'),
    crescent('#D21034', 28, H / 2, 9), star('#D21034', 36, H / 2, 4),
  ],
  TN: () => [rect(0, 0, W, H, '#E70013', 'b'), disc('#FFF', W / 2, H / 2, 12), crescent('#E70013', 29, H / 2, 7), star('#E70013', 33, H / 2, 3.4)],
  LY: () => [...hb([1, 2, 1], ['#E70013', '#000', '#239E46']), crescent('#FFF', 28, H / 2, 6), star('#FFF', 33, H / 2, 3)],
  GM: () => [...hb([3, 1, 3, 1, 3], ['#CE1126', '#FFF', '#0C1C8C', '#FFF', '#3A7728'])],
  SN: () => [...v('#00853F', '#FDEF42', '#E31B23'), star('#00853F', W / 2, H / 2, 5)],
  NG: () => v('#008751', '#FFF', '#008751'),
  KE: () => [
    ...hb([2, 1, 2], ['#000', '#FFF', '#006600']),
    rect(0, 19, W, 7, '#BB0000', 'r'),
    <ellipse key="sh" cx={W / 2} cy={H / 2} rx="5" ry="11" fill="#FFF" stroke="#000" strokeWidth="1" />,
  ],

  /* ── Middle East ── */
  TR: () => [rect(0, 0, W, H, '#E30A17', 'b'), crescent('#FFF', 24, H / 2, 9), star('#FFF', 34, H / 2, 4.2)],
  IR: () => [...h('#239F40', '#FFF', '#DA0000'), rect(24, 19, 12, 7, '#DA0000', 'e')],
  LB: () => [...hb([1, 2, 1], ['#EE161F', '#FFF', '#EE161F']), <polygon key="cedar" points={`${W / 2},15 ${W / 2 + 8},30 ${W / 2 - 8},30`} fill="#00A651" />],
  JO: () => [...h('#000', '#FFF', '#007A3D'), triangle('#CE1126', 24), star('#FFF', 8, H / 2, 3)],
  SY: () => [...h('#CE1126', '#FFF', '#000'), star('#007A3D', 22, H / 2, 4, 's1'), star('#007A3D', 38, H / 2, 4, 's2')],
  IQ: () => [
    ...h('#CE1126', '#FFF', '#000'),
    // The takbir, reduced to the green calligraphic band it reads as at this size.
    rect(18, 20.5, 24, 4, '#007A3D', 'tk'),
  ],
  KW: () => [
    ...h('#007A3D', '#FFF', '#CE1126'),
    <polygon key="tr" points={`0,0 15,${H / 3} 15,${(H / 3) * 2} 0,${H}`} fill="#000" />,
  ],
  SA: () => [
    rect(0, 0, W, H, '#006C35', 'b'),
    // The Shahada, then the sword beneath it. Reduced to two white marks in the
    // right places: a green rectangle alone is not this flag.
    rect(12, 15, 36, 4, '#FFF', 'sh'),
    rect(12, 26, 36, 2.4, '#FFF', 'sw'),
    <polygon key="tip" points="12,27.2 8,25.2 8,29.2" fill="#FFF" />,
  ],
  YE: () => h('#CE1126', '#FFF', '#000'),
  OM: () => [
    rect(0, 0, 18, H, '#DB161B', 'hoist'),
    rect(18, 0, W - 18, 15, '#FFF', 'w'),
    rect(18, 15, W - 18, 15, '#DB161B', 'r'),
    rect(18, 30, W - 18, 15, '#008000', 'g'),
    // Khanjar and crossed swords, as a white mark at the hoist.
    rect(7.5, 6, 3, 10, '#FFF', 'kh'),
  ],
  PS: () => [...h('#000', '#FFF', '#007A3D'), triangle('#CE1126', 24)],
  AE: () => [
    rect(0, 0, 15, H, '#FF0000', 'hoist'),
    rect(15, 0, W - 15, 15, '#00732F', 'g'),
    rect(15, 15, W - 15, 15, '#FFF', 'w'),
    rect(15, 30, W - 15, 15, '#000', 'k'),
  ],
  IL: () => [
    rect(0, 0, W, H, '#FFF', 'b'), rect(0, 6, W, 5, '#0038B8', 'top'), rect(0, 34, W, 5, '#0038B8', 'bot'),
    <path key="star" d={`M${W / 2},15 l6,10.4 -12,0 Z M${W / 2},30 l6,-10.4 -12,0 Z`} fill="none" stroke="#0038B8" strokeWidth="1.8" />,
  ],
  BH: () => [
    rect(0, 0, W, H, '#CE1126', 'b'),
    <polygon key="w" points={`0,0 16,0 22,4.5 16,9 22,13.5 16,18 22,22.5 16,27 22,31.5 16,36 22,40.5 16,45 0,45`} fill="#FFF" />,
  ],
  QA: () => [
    rect(0, 0, W, H, '#8D1B3D', 'b'),
    <polygon key="w" points={`0,0 16,0 22,3.75 16,7.5 22,11.25 16,15 22,18.75 16,22.5 22,26.25 16,30 22,33.75 16,37.5 22,41.25 16,45 0,45`} fill="#FFF" />,
  ],

  /* ── Asia & Oceania ── */
  MV: () => [rect(0, 0, W, H, '#D21034', 'b'), rect(9, 7, 42, 31, '#007E3A', 'g'), crescent('#FFF', 33, H / 2, 8)],
  AF: () => [...v('#000', '#BE0000', '#007A36'), disc('#FFF', W / 2, H / 2, 7)],
  PK: () => [
    rect(0, 0, 15, H, '#FFF', 'hoist'), rect(15, 0, W - 15, H, '#01411C', 'g'),
    crescent('#FFF', 36, H / 2, 9), star('#FFF', 44, 15, 3.4),
  ],
  LK: () => [
    rect(0, 0, W, H, '#FFB700', 'b'), rect(4, 4, 16, 37, '#00534E', 'g2'),
    rect(4, 4, 8, 37, '#FF5B00', 'o'), rect(22, 4, 34, 37, '#8D2029', 'm'),
  ],
  MM: () => [...h('#FECB00', '#34B233', '#EA2839'), star('#FFF', W / 2, H / 2, 10)],
  IN: () => [...h('#FF9933', '#FFF', '#138808'), disc('#000080', W / 2, H / 2, 5), disc('#FFF', W / 2, H / 2, 3.4)],
  NP: () => [
    // Not a rectangle in reality — the only such national flag. Drawn as the two
    // stacked pennants it is, on the shared canvas, rather than pretending.
    rect(0, 0, W, H, 'transparent', 'bg'),
    <polygon key="p1" points="10,3 44,20 10,20" fill="#DC143C" stroke="#003893" strokeWidth="2.5" />,
    <polygon key="p2" points="10,20 40,34 10,42" fill="#DC143C" stroke="#003893" strokeWidth="2.5" />,
  ],
  BT: () => [
    <polygon key="y" points={`0,0 ${W},0 0,${H}`} fill="#FFD520" />,
    <polygon key="o" points={`${W},0 ${W},${H} 0,${H}`} fill="#FF4E12" />,
    disc('#FFF', W / 2, H / 2, 8),
  ],
  MN: () => [...v('#C4272F', '#015197', '#C4272F'), rect(7, 14, 6, 17, '#F9CF02', 'soyombo')],
  MY: () => [
    ...hb([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], Array.from({ length: 14 }, (_, i) => (i % 2 ? '#FFF' : '#CC0001'))),
    rect(0, 0, 30, 25, '#010066', 'c'), crescent('#FFCC00', 13, 12.5, 6), star('#FFCC00', 22, 12.5, 4),
  ],
  AU: () => [
    rect(0, 0, W, H, '#00008B', 'b'),
    rect(0, 0, 30, 22, '#012169', 'c'),
    <path key="uk" d={`M0,0 L30,22 M30,0 L0,22`} stroke="#FFF" strokeWidth="4" />,
    rect(0, 8, 30, 6, '#FFF', 'ch'), rect(12, 0, 6, 22, '#FFF', 'cv'),
    rect(0, 9.5, 30, 3, '#C8102E', 'rh'), rect(13.5, 0, 3, 22, '#C8102E', 'rv'),
    star('#FFF', 15, 34, 4, 'cw'), star('#FFF', 44, 12, 3, 's1'), star('#FFF', 48, 24, 3, 's2'), star('#FFF', 42, 33, 3, 's3'),
  ],
  ID: () => h('#CE1126', '#FFF'),
  PH: () => [
    <polygon key="b" points={`0,0 ${W},0 ${W},${H / 2} 0,${H / 2}`} fill="#0038A8" />,
    <polygon key="r" points={`0,${H / 2} ${W},${H / 2} ${W},${H} 0,${H}`} fill="#CE1126" />,
    triangle('#FFF', 24), disc('#FCD116', 7, H / 2, 3.4),
  ],
  NZ: () => [
    rect(0, 0, W, H, '#00247D', 'b'), rect(0, 0, 30, 22, '#012169', 'c'),
    <path key="uk" d={`M0,0 L30,22 M30,0 L0,22`} stroke="#FFF" strokeWidth="4" />,
    rect(0, 8, 30, 6, '#FFF', 'ch'), rect(12, 0, 6, 22, '#FFF', 'cv'),
    rect(0, 9.5, 30, 3, '#C8102E', 'rh'), rect(13.5, 0, 3, 22, '#C8102E', 'rv'),
    star('#CC142B', 44, 12, 3, 's1'), star('#CC142B', 48, 24, 3, 's2'), star('#CC142B', 40, 30, 3, 's3'),
  ],
  SG: () => [
    ...h('#ED2939', '#FFF'), crescent('#FFF', 14, 11, 7),
    ...[0, 1, 2, 3, 4].map((i) => star('#FFF', 24 + 5 * Math.cos((i * 2 * Math.PI) / 5 - Math.PI / 2), 11 + 5 * Math.sin((i * 2 * Math.PI) / 5 - Math.PI / 2), 1.9, `st${i}`)),
  ],
  TH: () => hb([1, 1, 2, 1, 1], ['#A51931', '#F4F5F8', '#2D2A4A', '#F4F5F8', '#A51931']),
  JP: () => [rect(0, 0, W, H, '#FFF', 'b'), disc('#BC002D', W / 2, H / 2, 12)],
  KR: () => [
    rect(0, 0, W, H, '#FFF', 'b'),
    <path key="t" d={`M${W / 2 - 10},${H / 2} a10,10 0 0,1 20,0 a5,5 0 0,1 -10,0 a5,5 0 0,0 -10,0`} fill="#CD2E3A" />,
    <path key="b" d={`M${W / 2 - 10},${H / 2} a5,5 0 0,0 10,0 a5,5 0 0,1 10,0 a10,10 0 0,1 -20,0`} fill="#0047A0" />,
  ],
  CN: () => [
    rect(0, 0, W, H, '#DE2910', 'b'), star('#FFDE00', 12, 11, 6.5),
    star('#FFDE00', 23, 5, 2.4, 's1'), star('#FFDE00', 27, 10, 2.4, 's2'),
    star('#FFDE00', 27, 17, 2.4, 's3'), star('#FFDE00', 23, 22, 2.4, 's4'),
  ],
};

/* ── The second pass, matching the countries.js additions ─────────────────── */
Object.assign(FLAGS, {
  HU: () => h('#CE2939', '#FFF', '#477050'),
  AT: () => h('#ED2939', '#FFF', '#ED2939'),
  CU: () => [
    ...hb([1, 1, 1, 1, 1], ['#002A8F', '#FFF', '#002A8F', '#FFF', '#002A8F']),
    triangle('#CF142B', 24), star('#FFF', 8, H / 2, 4.5),
  ],
  VE: () => [...h('#FFCC00', '#00247D', '#CF142B'), ...[0, 1, 2, 3, 4].map((i) => star('#FFF', 22 + i * 4, 24 - Math.abs(i - 2) * 1.6, 1.7, `s${i}`))],
  VN: () => [rect(0, 0, W, H, '#DA251D', 'b'), star('#FFFF00', W / 2, H / 2, 11)],
  CI: () => v('#F77F00', '#FFF', '#009E60'),
  GH: () => [...h('#CE1126', '#FCD116', '#006B3F'), star('#000', W / 2, H / 2, 5)],
  CM: () => [...v('#007A5E', '#CE1126', '#FCD116'), star('#FCD116', W / 2, H / 2, 5)],
  CD: () => [
    rect(0, 0, W, H, '#007FFF', 'b'),
    <path key="d" d={`M0,${H} L${W},0`} stroke="#F7D618" strokeWidth="9" />,
    <path key="dr" d={`M0,${H} L${W},0`} stroke="#CE1021" strokeWidth="5" />,
    star('#F7D618', 9, 9, 5),
  ],
  SD: () => [...h('#D21034', '#FFF', '#000'), triangle('#007229', 22)],
  ET: () => [...h('#078930', '#FCDD09', '#DA121A'), disc('#0F47AF', W / 2, H / 2, 9), star('#FCDD09', W / 2, H / 2, 6)],
  TZ: () => [
    <polygon key="g" points={`0,0 ${W - 16},0 0,${H}`} fill="#1EB53A" />,
    <polygon key="b" points={`${W},0 ${W},${H} 16,${H}`} fill="#00A3DD" />,
    // Yellow fimbriation UNDER the black band, drawn as a wider stroke beneath
    // it. An `opacity="0"` copy of this line was left here by mistake in the
    // first pass — an invisible element that cost a paint and drew nothing.
    <path key="y" d={`M${W},0 L0,${H}`} stroke="#FCD116" strokeWidth="16" />,
    <path key="k" d={`M${W},0 L0,${H}`} stroke="#000" strokeWidth="11" />,
  ],
  UG: () => [
    ...hb([1, 1, 1, 1, 1, 1], ['#000', '#FCDC04', '#D90000', '#000', '#FCDC04', '#D90000']),
    disc('#FFF', W / 2, H / 2, 9),
  ],
  ZM: () => [
    rect(0, 0, W, H, '#198A00', 'b'),
    rect(38, 22, 6, 23, '#DE2010', 'r'), rect(44, 22, 6, 23, '#000', 'k'), rect(50, 22, 6, 23, '#EF7D00', 'o'),
  ],
  ZW: () => [
    ...hb([1, 1, 1, 1, 1, 1, 1], ['#006400', '#FFD200', '#D40000', '#000', '#D40000', '#FFD200', '#006400']),
    triangle('#FFF', 22), star('#D40000', 8, H / 2, 4.5),
  ],
  GL: () => [
    rect(0, 0, W, H / 2, '#FFF', 'w'), rect(0, H / 2, W, H / 2, '#D00C33', 'r'),
    <path key="d" d={`M22,${H / 2} a11,11 0 0,0 22,0 a11,11 0 0,0 -22,0`} fill="#D00C33" />,
    <path key="d2" d={`M22,${H / 2} a11,11 0 0,1 22,0`} fill="#FFF" transform={`rotate(180 33 ${H / 2})`} />,
  ],
  GI: () => [
    rect(0, 0, W, H * 0.66, '#FFF', 'w'), rect(0, H * 0.66, W, H * 0.34, '#DA000C', 'r'),
    rect(24, 8, 12, 18, '#DA000C', 'castle'),
  ],
  IS: () => [...nordic('#02529C', '#FFF'), rect(22, 0, 4, H, '#DC1E35', 'iv'), rect(0, 20.5, W, 4, '#DC1E35', 'ih')],
  AL: () => [rect(0, 0, W, H, '#E41E20', 'b'), <path key="e" d={`M20,14 h20 l-6,8 6,8 h-20 l6,-8 z`} fill="#000" />],
  MT: () => [rect(0, 0, W / 2, H, '#FFF', 'w'), rect(W / 2, 0, W / 2, H, '#CF142B', 'r')],
  CY: () => [rect(0, 0, W, H, '#FFF', 'b'), <path key="i" d="M22,16 l10,-3 8,4 -4,6 -9,2 -7,-4 z" fill="#D57800" />, <path key="o" d={`M24,30 q6,4 12,0`} stroke="#4E5B31" strokeWidth="2" fill="none" />],
  MD: () => [...v('#0046AE', '#FFD200', '#CC092F'), disc('#CC092F', W / 2, H / 2, 5)],
  BY: () => [
    rect(0, 0, W, H * 0.66, '#CE1720', 'r'), rect(0, H * 0.66, W, H * 0.34, '#4AA657', 'g'),
    rect(0, 0, 9, H, '#FFF', 'orn'),
    <path key="p" d="M2,4 l3,4 -3,4 M2,16 l3,4 -3,4 M2,28 l3,4 -3,4" stroke="#CE1720" strokeWidth="1.6" fill="none" />,
  ],
  AD: () => [...v('#10069F', '#FEDF00', '#D0103A'), disc('#C7B37F', W / 2, H / 2, 5)],
  MC: () => h('#CE1126', '#FFF'),
  SM: () => h('#FFF', '#5EB6E4'),
  RS: () => [...h('#C6363C', '#0C4076', '#FFF'), rect(14, 12, 12, 16, '#C6363C', 'sh'), rect(14, 12, 12, 8, '#FFF', 'sw')],
  ME: () => [rect(0, 0, W, H, '#C40308', 'b'), rect(3, 2.5, W - 6, H - 5, '#C40308', 'i'), <rect key="brd" x="1.5" y="1.5" width={W - 3} height={H - 3} fill="none" stroke="#D4AF3A" strokeWidth="3" />, disc('#D4AF3A', W / 2, H / 2, 7)],
  BA: () => [
    rect(0, 0, W, H, '#002F6C', 'b'),
    <polygon key="t" points={`18,2 ${W - 4},2 ${W - 4},${H - 2}`} fill="#FECB00" />,
    ...[0, 1, 2, 3].map((i) => star('#FFF', 14 + i * 11, 6 + i * 10, 2.6, `s${i}`)),
  ],
  MK: () => [rect(0, 0, W, H, '#D20000', 'b'), disc('#FFE600', W / 2, H / 2, 7), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
    <path key={`r${i}`} d={`M${W / 2},${H / 2} L${W / 2 + 40 * Math.cos((i * Math.PI) / 4)},${H / 2 + 40 * Math.sin((i * Math.PI) / 4)}`} stroke="#FFE600" strokeWidth="4" />
  ))],
  LI: () => [...h('#002B7F', '#CE1126'), disc('#FFD83D', 14, 9, 5)],
  HK: () => [rect(0, 0, W, H, '#DE2910', 'b'), ...[0, 1, 2, 3, 4].map((i) => (
    <ellipse key={`p${i}`} cx={W / 2 + 8 * Math.cos((i * 2 * Math.PI) / 5 - Math.PI / 2)} cy={H / 2 + 8 * Math.sin((i * 2 * Math.PI) / 5 - Math.PI / 2)} rx="3.6" ry="5.4" fill="#FFF" transform={`rotate(${(i * 360) / 5} ${W / 2} ${H / 2})`} />
  ))],
  MO: () => [rect(0, 0, W, H, '#00785E', 'b'), disc('#FFF', W / 2, 26, 8), star('#FFD100', W / 2, 11, 3.4)],
  KH: () => [...hb([1, 2, 1], ['#032EA1', '#E00025', '#032EA1']), rect(24, 17, 12, 11, '#FFF', 'temple')],
  LA: () => [...hb([1, 2, 1], ['#CE1126', '#002868', '#CE1126']), disc('#FFF', W / 2, H / 2, 8)],
  BD: () => [rect(0, 0, W, H, '#006A4E', 'b'), disc('#F42A41', 26, H / 2, 11)],
  TW: () => [
    rect(0, 0, W, H, '#FE0000', 'b'), rect(0, 0, 30, 22, '#000095', 'c'),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
      <path key={`r${i}`} d={`M15,11 L${15 + 11 * Math.cos((i * Math.PI) / 4)},${11 + 11 * Math.sin((i * Math.PI) / 4)}`} stroke="#FFF" strokeWidth="3" />
    )),
    disc('#FFF', 15, 11, 4.5),
  ],
  TJ: () => [...hb([1, 1.4, 1], ['#CC0000', '#FFF', '#006600']), star('#F8C300', W / 2, H / 2, 4)],
  TM: () => [rect(0, 0, W, H, '#00843D', 'b'), rect(9, 0, 9, H, '#D22630', 'stripe'), crescent('#FFF', 32, 13, 6), star('#FFF', 39, 13, 2.6)],
  AZ: () => [...h('#0092BC', '#E4002B', '#00AE65'), crescent('#FFF', 27, H / 2, 6), star('#FFF', 33, H / 2, 3)],
  GE: () => [
    rect(0, 0, W, H, '#FFF', 'b'),
    rect(24, 0, 12, H, '#FF0000', 'cv'), rect(0, 16.5, W, 12, '#FF0000', 'ch'),
    ...[[10, 8], [50, 8], [10, 37], [50, 37]].map(([x, y], i) => (
      <g key={`c${i}`}><rect x={x - 4} y={y - 1.4} width="8" height="2.8" fill="#FF0000" /><rect x={x - 1.4} y={y - 4} width="2.8" height="8" fill="#FF0000" /></g>
    )),
  ],
  KG: () => [rect(0, 0, W, H, '#E8112D', 'b'), disc('#FFEF00', W / 2, H / 2, 9), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
    <path key={`r${i}`} d={`M${W / 2},${H / 2} L${W / 2 + 13 * Math.cos((i * Math.PI) / 6)},${H / 2 + 13 * Math.sin((i * Math.PI) / 6)}`} stroke="#FFEF00" strokeWidth="2.4" />
  ))],
  UZ: () => [
    ...hb([1, 0.1, 1, 0.1, 1], ['#0099B5', '#CE1126', '#FFF', '#CE1126', '#1EB53A']),
    crescent('#FFF', 13, 8, 5), star('#FFF', 20, 6, 2.2),
  ],
});

/** ISO2 → renderer, with a neutral globe for anything unmapped. */
const UNKNOWN = () => [
  rect(0, 0, W, H, '#EFECE4', 'b'),
  <circle key="g" cx={W / 2} cy={H / 2} r="12" fill="none" stroke="#B0A99A" strokeWidth="2" />,
  <path key="m" d={`M${W / 2 - 12},${H / 2} h24 M${W / 2},${H / 2 - 12} a12,16 0 0,0 0,24 a12,16 0 0,0 0,-24`} fill="none" stroke="#B0A99A" strokeWidth="2" />,
];

/**
 * @param {object}  props
 * @param {string}  props.code    ISO 3166-1 alpha-2, e.g. "SA"
 * @param {number}  [props.size]  rendered WIDTH in px; height follows 4:3
 * @param {string}  [props.title] accessible name; omit to render decoratively
 */
export default function CountryFlag({ code, size = 22, title, style = {} }) {
  const draw = FLAGS[String(code || '').toUpperCase()] || UNKNOWN;
  const height = Math.round((size * H) / W);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={size}
      height={height}
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      style={{
        display: 'block', borderRadius: 3, flexShrink: 0,
        // The hairline is what stops a white flag (Japan) dissolving into a
        // white input, and what makes the set look like physical objects.
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.22), 0 1px 2px rgba(0,0,0,0.10)',
        ...style,
      }}
    >
      {title ? <title>{title}</title> : null}
      {draw()}
    </svg>
  );
}

export { FLAGS };
