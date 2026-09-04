'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setDocDirection } from '../../utils/frameDocument';

/* ═══════════════════════════════════════════════════════════════════════════
   A real viewport for the preview.

   THE PROBLEM THIS EXISTS TO SOLVE

   The guest page is responsive against the VIEWPORT: `clamp(38px, 7.2vw,
   66px)` for the couple's names, `min(84vw, 322px)` for the invitation card,
   `minHeight: 100dvh` per section, and every `@media (max-width: 767.98px)`
   rule in globals.css and in the sections' own styled-jsx.

   Rendering that page into a 390px-wide <div> on a 1440px desktop does not
   make any of it think it is on a phone. `7.2vw` is 104px, so the names clamp
   to their 66px DESKTOP maximum instead of the 38px a phone gets. The card
   asks for 322px inside a 376px box and crowds it. `100dvh` is the desktop
   window's height, so one section is taller than the whole frame. And not one
   mobile media query matches, so the organizer's "Phone" preview showed them
   the desktop layout squeezed into a phone-shaped hole — and then the wizard
   told them that was what their guests would see.

   No amount of styling the wrapper fixes this: the units are anchored to the
   window, and a `transform: scale()` shrinks the picture without changing the
   number of CSS pixels the page believes it has.

   An iframe has its own viewport. Inside it, 390px wide IS 390px: `vw`, `dvh`,
   `@media`, `env(safe-area-inset-*)`, `position: fixed` and `100%` heights all
   resolve against the frame, so the preview is the mobile layout rather than a
   picture of the desktop one. The page inside is the same React tree, portalled
   across — not a re-render, not an iframe `src`, so no second data fetch, no
   second auth context, and the organizer's unsaved state flows straight in.

   HOW THE STYLES GET THERE

   A fresh iframe document has no stylesheets. Everything the page needs lives
   in the parent's <head>: the Tailwind/globals bundle, and — critically —
   styled-jsx's <style> tags, which are injected AT RUNTIME as components
   mount and are REWRITTEN in place when a dynamic value changes. So this
   mirrors the parent's <head> continuously rather than copying it once; a
   one-shot copy renders the first paint correctly and then goes stale the
   moment a section mounts.

   The next/font faces are declared as CSS custom properties on <html> (see
   layout.js), so the iframe's <html> takes the parent's className too —
   without it every `var(--font-serif)` resolves to nothing and the whole page
   falls back to Times New Roman.

   IF IT CANNOT INITIALISE

   Same-origin iframe access is available everywhere this runs, but a blank
   preview is a much worse failure than an imperfectly-scaled one. If the
   document never becomes reachable, `children` render inline exactly as they
   did before — degraded, not gone.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Anything in the parent <head> that carries CSS. */
const STYLE_SOURCES = 'style, link[rel="stylesheet"]';

/* Applied INSIDE the frame, last in the cascade.

   `height: 100%` on both html and body is what makes the guest page's own
   `height: 100%` chain resolve — SnapShell scrolls its own container, and a
   percentage height against an auto-height body collapses to nothing.

   `overflow: hidden` on the body: the page scrolls in SnapShell's container,
   so a second scrollbar on the frame itself is always spurious. */
const FRAME_RESET = `
  html, body { margin: 0; padding: 0; height: 100%; }
  body { overflow: hidden; background: transparent; }
`;

/**
 * Mirror every stylesheet in `document.head` into `targetDoc.head`, and keep
 * mirroring as styled-jsx adds, rewrites and removes them.
 *
 * @returns {() => void} teardown
 */
function mirrorStyles(targetDoc) {
  /** source node in the parent → its clone in the frame */
  const clones = new Map();

  // Always re-appended last so the reset above cannot be overridden by a
  // stylesheet that happens to arrive after it.
  const reset = targetDoc.createElement('style');
  reset.dataset.previewFrameReset = 'true';
  reset.textContent = FRAME_RESET;

  const sync = () => {
    const sources = new Set(document.querySelectorAll(STYLE_SOURCES));

    clones.forEach((clone, source) => {
      if (sources.has(source)) return;
      clone.remove();
      clones.delete(source);
    });

    sources.forEach((source) => {
      const existing = clones.get(source);
      if (!existing) {
        const clone = source.cloneNode(true);
        clones.set(source, clone);
        targetDoc.head.appendChild(clone);
        return;
      }
      /* styled-jsx mutates a <style> element's text rather than replacing the
         element when a dynamic value changes, so a childList-only mirror would
         hold the first render's CSS forever. */
      if (source.tagName === 'STYLE' && existing.textContent !== source.textContent) {
        existing.textContent = source.textContent;
      }
    });

    targetDoc.head.appendChild(reset);
  };

  sync();

  /* subtree + characterData, not just childList on <head>: the mutation that
     matters most is text changing inside a <style> that is already there. */
  const observer = new MutationObserver(sync);
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });

  return () => {
    observer.disconnect();
    clones.forEach((clone) => clone.remove());
    clones.clear();
    reset.remove();
  };
}

export default function PreviewFrame({
  children,
  /** Announced to assistive tech; every iframe needs one. */
  title = 'Invitation preview',
  /** Inherited by the frame document, so the page inside lays out RTL for AR. */
  dir = 'ltr',
  /* Bound to the FRAME's document. A key pressed while focus is inside the
     frame fires on the frame's document and never reaches the host window, so
     a modal's Escape-to-close stops working the moment the user clicks the
     preview — which is the first thing they do. */
  onDocumentKeyDown,
  style,
  className,
}) {
  const iframeRef = useRef(null);
  const [mountNode, setMountNode] = useState(null);
  /* Distinguishes "not ready yet" (first paint, mount the fallback for one
     frame at most) from "will never be ready" (render inline forever). */
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    let teardownStyles = () => {};

    const attach = () => {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) { setUnavailable(true); return; }

      // next/font declares every --font-* custom property on <html>.
      doc.documentElement.className = document.documentElement.className;
      doc.documentElement.lang = document.documentElement.lang || 'en';

      teardownStyles();
      teardownStyles = mirrorStyles(doc);
      setUnavailable(false);
      setMountNode(doc.body);
    };

    attach();
    /* Some browsers fire `load` for the initial about:blank AFTER mount and
       replace the document, discarding everything written above — so the setup
       has to be re-runnable and re-run. */
    iframe.addEventListener('load', attach);
    return () => {
      iframe.removeEventListener('load', attach);
      teardownStyles();
    };
  }, []);

  /* Resolved from `mountNode` (which IS the frame document's body, published
     by the effect above) rather than from `iframeRef`: the ref can hand back a
     document the `load` handler is about to discard, whereas `mountNode` only
     ever names one that has already been set up — and it is the dependency
     this effect was already declaring. The effect below does the same. */
  useEffect(() => {
    setDocDirection(mountNode, dir);
  }, [dir, mountNode]);

  useEffect(() => {
    const doc = mountNode?.ownerDocument;
    if (!doc || !onDocumentKeyDown) return undefined;
    doc.addEventListener('keydown', onDocumentKeyDown);
    return () => doc.removeEventListener('keydown', onDocumentKeyDown);
  }, [mountNode, onDocumentKeyDown]);

  if (unavailable) {
    return <div className={className} style={style}>{children}</div>;
  }

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <iframe
        ref={iframeRef}
        title={title}
        // No `src`. The document is created empty and the React tree is
        // portalled in; pointing it at a URL would render the guest page a
        // SECOND time, from the server, without the organizer's unsaved state.
        style={{ display: 'block', width: '100%', height: '100%', border: 0, background: 'transparent' }}
      />
      {mountNode && createPortal(children, mountNode)}
    </div>
  );
}
