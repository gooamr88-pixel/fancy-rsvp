'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import Icon from '../../components/icons/Icon';
import SeatingLegend from './SeatingLegend';
/* The world/element model is shared verbatim with the organizer seating map
   (dashboard/seating-map) — imported, never re-declared, because a local copy
   that fell behind drew the organizer's zones as round tables here without
   erroring. Read-only: this never shows who is seated where, only the room
   layout, with the current guest's own table highlighted. */
import {
  WORLD_W, WORLD_H, shapeMeta, isZone, elWidth, elHeight, pctToPx,
} from '../../utils/seatingGeometry';
/* And the LOOK is shared with SeatingMapFullscreen the same way, for the same
   reason — see the header of seatingPlanStyle.js. Nothing about how an element
   is painted, numbered or seated is decided in this file. */
import {
  planSurfaceStyle, floorGrainStyle, floorVignetteStyle,
  elementStyle, seatPositions, seatStyle,
  planNumeral, numeralStyle, numeralFits,
  spotlightStyle, markerStyle, zoneGlyphSize, ZONE_GLYPH_OPACITY,
  zoneLabel, zoneLabelStyle, zoneMarkStyle, labelObstacles, planLegend, seatsFit, markerFits,
} from '../../utils/seatingPlanStyle';

/**
 * `maxHeight` — how tall this preview is allowed to grow.
 *
 * A prop rather than the old hard-coded 320 because the two callers want
 * genuinely different things. Inside the RSVP flow the map IS the answer to
 * the question the guest just asked, so it takes the room. On the emailed
 * entry pass it is a thumbnail under the QR code: the guest opened that page
 * at a venue door to show a barcode, and a half-screen floor plan pushed the
 * one thing they came for off the top of the phone.
 */
export default function SeatingMiniMap({ tables, myTableId, maxHeight = 320, showLegend = true }) {
  const wrapRef = useRef(null);
  const [boxW, setBoxW] = useState(0);
  /* Named in the host's own words — "Champagne Bar", not the catalogue's
     "Bar". See planLegend. */
  const legend = useMemo(() => planLegend(tables), [tables]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (w) setBoxW(w);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const els = (tables || []).filter(Boolean);
  if (els.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#A09A91', fontSize: '13px', background: '#FAFAF8', border: '1px dashed #E8E2D6', borderRadius: '12px' }}>
        The seating chart hasn&apos;t been published yet.
      </div>
    );
  }

  // Bounding box of all elements (world px), so a sparse layout still fills the card.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  els.forEach(el => {
    const left = pctToPx(el.position_x, WORLD_W);
    const top = pctToPx(el.position_y, WORLD_H);
    const w = elWidth(el), h = elHeight(el);
    minX = Math.min(minX, left); minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + w); maxY = Math.max(maxY, top + h);
  });
  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const contentW = Math.max(maxX - minX, 1);
  const contentH = Math.max(maxY - minY, 1);

  const targetW = boxW || 320;
  const maxH = maxHeight;
  const scale = Math.min(targetW / contentW, maxH / contentH);
  const renderW = contentW * scale;
  const renderH = contentH * scale;

  /* Only worth pointing at something when there IS something to point at — with
     no assignment the room renders at full strength rather than uniformly
     dimmed, which just looks broken. */
  const hasMine = els.some((el) => !isZone(el) && el.id === myTableId);

  /**
   * Every element's drawn rectangle, worked out ONCE before anything renders.
   *
   * The layout used to be computed inside the render loop, which meant an
   * element knew where it was and nothing else knew where anything was. A zone
   * cannot decide where to put its name without knowing which tables are drawn
   * over it, so the pass is hoisted: positions first, then obstacles, then
   * paint. Screen pixels here — the geometry is scaled before layout in this
   * map, unlike the expanded one.
   */
  const placed = els.map((el) => ({
    el,
    x: (pctToPx(el.position_x, WORLD_W) - minX) * scale,
    y: (pctToPx(el.position_y, WORLD_H) - minY) * scale,
    w: elWidth(el) * scale,
    h: elHeight(el) * scale,
  }));
  const obstacles = labelObstacles(placed);

  return (
    <div ref={wrapRef} style={{ width: '100%', overflow: 'hidden' }}>
      <div style={{
        position: 'relative', width: renderW, height: renderH, margin: '0 auto',
        overflow: 'hidden', ...planSurfaceStyle(14),
      }}>
        {/* The ruled floor and its corner shading. Both are decorative and both
            sit under every element, so they are drawn first and marked hidden. */}
        <div aria-hidden style={floorGrainStyle(scale)} />
        <div aria-hidden style={floorVignetteStyle()} />

        {placed.map(({ el, x: left, y: top, w, h }) => {
          const zone = isZone(el);
          const meta = shapeMeta(el.shape);
          const rotation = Number(el.rotation) || 0;
          const mine = !zone && el.id === myTableId;
          const color = el.color || meta.color || '#B8944F';
          const numeral = zone || !numeralFits(h) ? null : planNumeral(el.table_name);
          // scale 1: this map lays elements out at their final screen size.
          const label = zone ? zoneLabel(el, { x: left, y: top, w, h }, 1, obstacles) : null;

          return (
            <React.Fragment key={el.id}>
              {/* The spotlight is a SIBLING of the table, not a child: a child
                  would be clipped by `border-radius: 50%` and would inherit the
                  table's rotation, turning a glow into a smear. */}
              {mine && <div aria-hidden style={spotlightStyle(left, top, w, h)} />}

              <div style={{
                ...elementStyle(el, { scale, mine, dimOthers: hasMine }),
                ...zoneMarkStyle(label),
                left, top, width: w, height: h,
                transform: `rotate(${rotation}deg)`, transformOrigin: 'center center',
              }}>
                {zone && meta.icon && (
                  <Icon
                    name={meta.icon}
                    size={zoneGlyphSize(w, h)}
                    color={color}
                    strokeWidth={1.6}
                    style={{ opacity: ZONE_GLYPH_OPACITY, flexShrink: 0 }}
                  />
                )}
                {/* A zone names itself when it is drawn big enough to be read —
                    measured in the pixels it actually occupies here, so the same
                    stage is labelled on a roomy preview and left to the legend on
                    a cramped one — and it sits in a band of the zone that no
                    table is covering. */}
                {label && <span style={zoneLabelStyle(label.size, rotation)}>{label.text}</span>}
                {numeral && <span style={numeralStyle(h, mine, rotation)}>{numeral}</span>}
                {!zone && seatsFit(h) && seatPositions(el).map((pos, i) => (
                  <span key={i} aria-hidden style={seatStyle(pos, scale, mine)} />
                ))}
                {/* A mark, not a word. The old "★ You're here" pill was 8px type
                    and wider than the 96px table it pointed at, so on a dense
                    plan it covered the two tables either side of the one it was
                    identifying. */}
                {mine && markerFits(h) && <span aria-hidden style={markerStyle(w)}>★</span>}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* THE KEY. This map had none — on the entry pass and at the end of the
          RSVP, which between them are the map most guests will ever see, the
          venue's zones were coloured boxes with a 9px glyph and no name
          anywhere on the screen. */}
      {showLegend && legend.length > 0 && (
        <SeatingLegend items={legend} compact style={{ margin: '10px auto 0', maxWidth: renderW, justifyContent: 'center' }} />
      )}
    </div>
  );
}
