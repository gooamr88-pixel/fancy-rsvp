'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { formatTableLabel } from '../../utils/tableLabel';
import Icon from '../../components/icons/Icon';
import {
  WORLD_W, WORLD_H, shapeMeta, isZone, elWidth, elHeight, pctToPx, elCenterX, elCenterY,
} from '../../utils/seatingGeometry';
/* The look is shared with SeatingMiniMap — see the header of
   seatingPlanStyle.js. This file decides how the plan MOVES; that one decides
   how it is drawn. */
import {
  planSurfaceStyle, floorGrainStyle, floorVignetteStyle,
  elementStyle, seatPositions, seatStyle,
  planNumeral, numeralStyle, numeralFits,
  spotlightStyle, markerStyle, zoneGlyphSize, ZONE_GLYPH_OPACITY,
  planLegend, zoneLabel, zoneLabelStyle, zoneMarkStyle, labelObstacles, seatsFit, markerFits,
} from '../../utils/seatingPlanStyle';
import SeatingLegend from './SeatingLegend';

/**
 * Fullscreen, pannable + zoomable viewer for the guest's seating chart.
 * Uses the same world-coordinate model as SeatingMiniMap (and the organizer
 * editor) — imported from utils/seatingGeometry rather than re-declared, so
 * the layout the host drew is mirrored exactly. We just lift it into a wrapper
 * transform so the guest can pinch/scroll/drag it around. The host's table is
 * highlighted with a gold ring + "you" badge so it's obvious at a glance among
 * dozens of tables.
 */
const GOLD = '#B8944F';
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* `hostName` is gone from the props. It only ever fed the "Sara — your table"
   pill above the guest's table, and that pill has been replaced by a gold star:
   the guest's own name on their own table is the one label on the plan that told
   them nothing they did not already know, and it was wide enough to cover the
   two tables either side of it. The header above still names the table. */
export default function SeatingMapFullscreen({ tables, myTableId, myTableName, isRTL, onClose }) {
  const els = useMemo(() => (tables || []).filter(Boolean), [tables]);
  /* What the zone glyphs mean, named once, off the plan itself — this is what
     makes removing the zone names cost the guest nothing. */
  const legend = useMemo(() => planLegend(els), [els]);
  const hasMine = useMemo(() => els.some((el) => !isZone(el) && el.id === myTableId), [els, myTableId]);
  /* Every element's drawn rectangle in WORLD px — this map puts the whole plan
     inside one scaled layer, so layout is world-space here. A zone needs these
     to know which tables are sitting on it before it decides where to put its
     name; see zoneLabel. */
  const placed = useMemo(() => els.map((el) => ({
    el,
    x: pctToPx(el.position_x, WORLD_W),
    y: pctToPx(el.position_y, WORLD_H),
    w: elWidth(el),
    h: elHeight(el),
  })), [els]);
  const obstacles = useMemo(() => labelObstacles(placed), [placed]);
  const containerRef = useRef(null);
  const [view, setView] = useState({ scale: 0.4, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ active: false, startX: 0, startY: 0, origTx: 0, origTy: 0 });
  const pinch = useRef({ active: false, startDist: 0, startScale: 1, midX: 0, midY: 0 });

  // Element bounding box (world coords) — used both for initial fit and "center on my table".
  const bounds = useMemo(() => {
    if (els.length === 0) return { minX: 0, minY: 0, maxX: WORLD_W, maxY: WORLD_H };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    els.forEach((el) => {
      const left = pctToPx(el.position_x, WORLD_W);
      const top = pctToPx(el.position_y, WORLD_H);
      minX = Math.min(minX, left); minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + elWidth(el)); maxY = Math.max(maxY, top + elHeight(el));
    });
    const pad = 80;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [els]);

  const fitToScreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    const contentW = bounds.maxX - bounds.minX;
    const contentH = bounds.maxY - bounds.minY;
    const scale = clamp(Math.min(w / contentW, h / contentH), MIN_SCALE, MAX_SCALE);
    const tx = (w - contentW * scale) / 2 - bounds.minX * scale;
    const ty = (h - contentH * scale) / 2 - bounds.minY * scale;
    setView({ scale, tx, ty });
  }, [bounds]);

  const centerOnMyTable = useCallback(() => {
    const c = containerRef.current;
    if (!c || !myTableId) return;
    const el = els.find((e) => e.id === myTableId);
    if (!el) return;
    const cx = elCenterX(el);
    const cy = elCenterY(el);
    const scale = clamp(0.85, MIN_SCALE, MAX_SCALE);
    const tx = c.clientWidth / 2 - cx * scale;
    const ty = c.clientHeight / 2 - cy * scale;
    setView({ scale, tx, ty });
  }, [els, myTableId]);

  // Fit-to-screen (or center on the guest's own table) once on open. Scroll
  // lock, focus trap, initial focus, and Escape-to-close are handled by the
  // shared useModalA11y hook below.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (myTableId) centerOnMyTable();
      else fitToScreen();
    });
    return () => cancelAnimationFrame(id);
    // We deliberately only run this on mount — the callbacks close over the
    // initial bounds, which is what we want for the open animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dialogRef = useModalA11y(true, { onClose });

  // Zoom-at-cursor on wheel (non-passive listener attached manually to allow preventDefault).
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => {
        const next = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
        const ratio = next / v.scale;
        return { scale: next, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio };
      });
    };
    c.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      c.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Pan with mouse + single-touch.
  const onPointerDown = (e) => {
    const tl = e.touches;
    if (tl && tl.length === 2) {
      const dx = tl[0].clientX - tl[1].clientX;
      const dy = tl[0].clientY - tl[1].clientY;
      pinch.current = {
        active: true,
        startDist: Math.hypot(dx, dy),
        startScale: view.scale,
        midX: (tl[0].clientX + tl[1].clientX) / 2,
        midY: (tl[0].clientY + tl[1].clientY) / 2,
      };
      return;
    }
    const point = tl ? tl[0] : e;
    drag.current = { active: true, startX: point.clientX, startY: point.clientY, origTx: view.tx, origTy: view.ty };
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (pinch.current.active && e.touches?.length === 2) {
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const px = pinch.current.midX - rect.left;
      const py = pinch.current.midY - rect.top;
      setView((v) => {
        const next = clamp(pinch.current.startScale * (dist / pinch.current.startDist), MIN_SCALE, MAX_SCALE);
        const ratio = next / v.scale;
        return { scale: next, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio };
      });
      return;
    }
    if (!drag.current.active) return;
    const point = e.touches ? e.touches[0] : e;
    setView((v) => ({ ...v, tx: drag.current.origTx + (point.clientX - drag.current.startX), ty: drag.current.origTy + (point.clientY - drag.current.startY) }));
  };

  const onPointerUp = () => {
    drag.current.active = false;
    pinch.current.active = false;
    setDragging(false);
  };

  const zoom = (factor) => {
    const c = containerRef.current;
    if (!c) return;
    const px = c.clientWidth / 2;
    const py = c.clientHeight / 2;
    setView((v) => {
      const next = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = next / v.scale;
      return { scale: next, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio };
    });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={isRTL ? 'خريطة الجلوس' : 'Seating chart'}
      tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: '#FAFAF8',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-sans)',
        outline: 'none',
      }}
    >
      {/* Header — same light ivory/gold letterhead language as the rest of
          the guest experience, so expanding the map reads as a zoom, not a
          jump into an unrelated dark screen. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', paddingTop: 'max(14px, calc(env(safe-area-inset-top) + 8px))', gap: '12px',
        background: '#FFFFFF', borderBottom: '1px solid #E8E2D6',
        boxShadow: '0 2px 10px rgba(25,27,30,0.04)',
      }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, fontWeight: 700 }}>
            {isRTL ? 'خريطة الجلوس' : 'Seating Chart'}
          </span>
          <strong style={{ display: 'block', fontSize: '16px', fontFamily: 'var(--font-serif)', fontWeight: 600, color: '#191B1E' }}>
            {myTableName ? (isRTL ? `طاولتك: ${formatTableLabel(myTableName, isRTL)}` : `Your table: ${formatTableLabel(myTableName, isRTL)}`) : (isRTL ? 'حدد طاولتك من الخريطة' : 'Find your table')}
          </strong>
        </div>
        <button
          onClick={onClose}
          aria-label={isRTL ? 'إغلاق' : 'Close'}
          style={{
            background: '#FFFFFF', border: '1px solid #E8E2D6',
            color: '#3A3631', borderRadius: '999px',
            width: '44px', height: '44px', cursor: 'pointer', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(25,27,30,0.06)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Canvas — the plan is drawn as a sheet of drafting paper floating on a
          plain ground, so panning reads as moving a printed plan around rather
          than scrolling a webpage. The paper, its ruling and every element on it
          come from seatingPlanStyle. */}
      <div
        ref={containerRef}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
        style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          cursor: dragging ? 'grabbing' : 'grab',
          // A quiet warm ground, not white: the plan is a sheet of paper resting
          // on it, and a white sheet on a white ground has no edge.
          background: '#EDE9E0',
          touchAction: 'none',
        }}
      >
        <div style={{
          position: 'absolute', left: 0, top: 0, width: WORLD_W, height: WORLD_H,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: '0 0', willChange: 'transform',
          ...planSurfaceStyle(28),
        }}>
          {/* The ruled floor + corner shading. `scale` is 1 here on purpose: this
              layer lives INSIDE the transformed world, so the module is already
              in world px and the browser scales it with everything else. */}
          {/* 1 because this layer is already in world px, and view.scale so the
              ruling knows how big it will actually come out on screen. */}
          <div aria-hidden style={floorGrainStyle(1, view.scale)} />
          <div aria-hidden style={floorVignetteStyle()} />

          {els.map((el) => {
            const zone = isZone(el);
            const meta = shapeMeta(el.shape);
            const left = pctToPx(el.position_x, WORLD_W);
            const top = pctToPx(el.position_y, WORLD_H);
            const w = elWidth(el), h = elHeight(el);
            const rotation = Number(el.rotation) || 0;
            const mine = !zone && el.id === myTableId;
            const color = el.color || meta.color || GOLD;
            // view.scale, because `h` is world px and this layer is scaled: at a
            // zoomed-out fit a 96px table is drawn at fourteen, and asking the
            // question about the world size answered it for a table nobody can
            // see. The plan simplifies as it shrinks and fills back in as the
            // guest zooms, which is what a map does.
            const numeral = zone || !numeralFits(h, view.scale) ? null : planNumeral(el.table_name);
            const showSeats = !zone && seatsFit(h, view.scale);
            // view.scale, because everything here is drawn in world px inside
            // one scaled layer — see the note on zoneLabel. It also means the
            // names hold their size as the guest zooms.
            const label = zone ? zoneLabel(el, { x: left, y: top, w, h }, view.scale, obstacles) : null;

            return (
              <React.Fragment key={el.id}>
                {mine && <div aria-hidden style={spotlightStyle(left, top, w, h)} />}

                <div style={{
                  // scale 1 because this layer is world px; screenScale so the
                  // outlines stay one real pixel however far the guest zooms out.
                  ...elementStyle(el, { scale: 1, mine, dimOthers: hasMine, screenScale: view.scale }),
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
                  {/* Named on the plan itself. Here the zones are drawn in world
                      px inside the transformed layer, so they are at their full
                      size and almost every one of them earns its name — which is
                      the whole point of the expanded map. */}
                  {label && <span style={zoneLabelStyle(label.size, rotation)}>{label.text}</span>}
                  {numeral && <span style={numeralStyle(h, mine, rotation)}>{numeral}</span>}
                  {showSeats && seatPositions(el).map((pos, i) => (
                    <span key={i} aria-hidden style={seatStyle(pos, 1, mine)} />
                  ))}
                  {mine && markerFits(h, view.scale) && (
                    <>
                      <span aria-hidden style={markerStyle(w)}>★</span>
                      {/**
                        * Pulsing ring — what makes "your table" findable at a
                        * glance in a room of forty identical circles.
                        *
                        * The keyframe lives in globals.css, UNSCOPED. It used to
                        * sit in a <style jsx> block at the bottom of this file,
                        * where styled-jsx renamed it to
                        * `fancySeatPulse-jsx-<hash>` — a name it cannot rewrite
                        * inside an inline style object, so the animation
                        * resolved against a keyframe that did not exist and the
                        * ring simply sat there. Same trap the ticket page
                        * documents for its spinner.
                        */}
                      <span aria-hidden style={{
                        position: 'absolute', inset: -14,
                        borderRadius: meta.round ? '50%' : '18px',
                        border: `2px solid ${GOLD}`,
                        animation: 'fancySeatPulse 1.8s ease-out infinite',
                        pointerEvents: 'none',
                      }} />
                    </>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/**
          * ── ONE CONTROL CLUSTER, NOT FOUR THINGS FLOATING ──
          *
          * This was three separate 44px white circles stacked down the right
          * edge, a gold pill under them, and a bordered hint card in the
          * opposite corner: five objects with five outlines and five shadows,
          * scattered over the drawing they were supposed to serve. The gold
          * pill also sat exactly where the top-right of the plan is, so on this
          * very room it covered the cake table.
          *
          * The zoom controls are one segmented card now — the way a map's
          * controls are grouped — and the seat button sits under it as the one
          * coloured thing in the chrome. Both are anchored to the bottom, out
          * of the plan's own corner.
          */}
        <div style={{
          position: 'absolute', bottom: 'max(18px, calc(env(safe-area-inset-bottom) + 10px))',
          ...(isRTL ? { left: '16px' } : { right: '16px' }),
          display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '10px',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column',
            background: 'rgba(255,255,255,0.94)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(31,26,18,0.10)',
            borderRadius: '14px',
            boxShadow: '0 10px 30px -12px rgba(31,26,18,0.35)',
            overflow: 'hidden',
          }}>
            <CircleBtn aria-label={isRTL ? 'تكبير' : 'Zoom in'} onClick={() => zoom(1.25)}>+</CircleBtn>
            <span aria-hidden style={{ height: '1px', background: 'rgba(31,26,18,0.08)' }} />
            <CircleBtn aria-label={isRTL ? 'تصغير' : 'Zoom out'} onClick={() => zoom(0.8)}>−</CircleBtn>
            <span aria-hidden style={{ height: '1px', background: 'rgba(31,26,18,0.08)' }} />
            <CircleBtn aria-label={isRTL ? 'ملء الشاشة' : 'Fit to screen'} onClick={fitToScreen}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 4 20 10 20" /><polyline points="20 10 20 4 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </CircleBtn>
          </div>
          {myTableId && (
            <button
              onClick={centerOnMyTable}
              style={{
                padding: '12px 16px', borderRadius: '14px',
                background: 'linear-gradient(150deg, #C9A85C, #A8873F)', color: '#FFFFFF',
                border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: '12.5px', fontWeight: 700,
                letterSpacing: '0.02em',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                minHeight: '44px', whiteSpace: 'nowrap',
                boxShadow: '0 10px 26px -10px rgba(138,109,52,0.65)',
              }}
            >
              ★ {isRTL ? 'مكاني' : 'My seat'}
            </button>
          )}
        </div>

        {/* The gesture hint, set as a caption on the ground rather than as a
            bordered card. It is an aside, and a card with its own outline and
            shadow claimed the authority of a control. */}
        <div style={{
          position: 'absolute', bottom: 'max(22px, calc(env(safe-area-inset-bottom) + 12px))',
          left: '50%', transform: 'translateX(-50%)',
          fontSize: '11px', color: 'rgba(31,26,18,0.42)',
          fontFamily: 'var(--font-sans)', letterSpacing: '0.02em',
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          {isRTL ? 'اسحب للتحريك • قرّب بإصبعين' : 'Drag to pan · pinch to zoom'}
        </div>
      </div>

      {/**
        * THE LEGEND — and the reason the plan can be clean.
        *
        * The zones on the plan carry a glyph and a colour and no text, which is
        * what a printed floor plan does and what stops fourteen labels competing
        * with the one table that matters. That only works if "what is the purple
        * square" is answered SOMEWHERE, so it is answered here, once, under the
        * plan, at a size that can actually be read.
        *
        * Built from the elements actually present, so a small venue gets three
        * entries rather than a catalogue of fourteen.
        */}
      {legend.length > 0 && (
        <SeatingLegend
          items={legend}
          style={{
            padding: '12px 20px',
            paddingBottom: 'max(12px, calc(env(safe-area-inset-bottom) + 6px))',
            background: '#FDFBF6',
            borderTop: '1px solid #EFE7D6',
          }}
        />
      )}

      {/* No <style jsx> here on purpose — fancySeatPulse is defined in
          globals.css. A scoped keyframe gets renamed by styled-jsx and can
          never be referenced from an inline style object; see the ring above. */}
    </div>
  );
}

/**
 * One cell of the control cluster. It carries no border, no radius and no
 * shadow of its own any more — the card around it owns all three, which is what
 * turns three floating pucks into a single object.
 */
function CircleBtn({ children, onClick, ...rest }) {
  return (
    <button
      onClick={onClick}
      {...rest}
      style={{
        width: '46px', height: '46px',
        background: 'transparent', border: 'none',
        color: 'rgba(31,26,18,0.72)', cursor: 'pointer', fontSize: '19px', fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-sans)', lineHeight: 1,
      }}
    >{children}</button>
  );
}
