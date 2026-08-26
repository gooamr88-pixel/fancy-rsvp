import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

import BoundaryError from '../src/app/components/BoundaryError';
import ErrorBoundary from '../src/app/components/ErrorBoundary';
import DashboardError from '../src/app/dashboard/error';
import RootError from '../src/app/error';

/* ═══════════════════════════════════════════════════════════════════════════
   THE ERROR SCREENS MUST THEMSELVES RENDER.

   This is the one component in the app with no fallback behind it. When a
   boundary's own UI throws, React has nothing left to show — the page goes
   blank or the browser reports an unrecoverable error, and the original
   exception is lost with it.

   That is not hypothetical here. The seating map's print preview shipped dead
   for months because a nested component read a variable from a scope it was
   not in, and NOTHING objected: `next build` does not scope-analyse and eslint
   exits 0 on this project without checking anything. The full suite was green
   the whole time, because no test ever rendered that component.

   So these tests do the one thing no static check can: they actually mount all
   three boundaries.
   ═══════════════════════════════════════════════════════════════════════════ */

beforeAll(() => {
  // vitest transforms .js with the CLASSIC jsx runtime, so files relying on
  // Next's automatic runtime resolve a bare `React` through the scope chain to
  // global. Next itself is unaffected; this is a harness gap.
  global.React = React;
});

afterEach(cleanup);

function Boom() { throw new Error('boom'); }

describe('the boundary error screen', () => {
  it('renders its heading, message and actions', () => {
    const { container, getByRole, getByText } = render(
      <BoundaryError
        title="Something went wrong"
        message="A sentence."
        actions={<button type="button" className="fx-errstate-btn fx-errstate-btn--primary">Try again</button>}
      />,
    );
    expect(getByRole('heading', { level: 2 }).textContent).toBe('Something went wrong');
    expect(getByText('A sentence.')).toBeTruthy();
    expect(container.querySelector('.fx-errstate-btn--primary')).toBeTruthy();
  });

  it('draws the broken seal with unique ids per instance', () => {
    // SVG ids are document-global and url(#id) takes the FIRST match, so two
    // boundaries on one page sharing ids would both paint with the first one's
    // clip paths — the fracture would land in the wrong place on the second.
    const { container } = render(
      <div>
        <BoundaryError title="A" message="a" />
        <BoundaryError title="B" message="b" />
      </div>,
    );
    const gradients = [...container.querySelectorAll('radialGradient')].map((g) => g.id);
    expect(gradients).toHaveLength(2);
    expect(new Set(gradients).size).toBe(2);
    expect(gradients.every((id) => id && /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);

    // Each half must actually reference ITS OWN clip path.
    const clipped = [...container.querySelectorAll('[clip-path]')].map((n) => n.getAttribute('clip-path'));
    expect(clipped).toHaveLength(4);
    expect(new Set(clipped).size).toBe(4);
  });

  it('marks the seal decorative rather than announcing it', () => {
    const { container } = render(<BoundaryError title="A" message="a" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    // role="img" alongside aria-hidden contradicts itself.
    expect(svg.getAttribute('role')).toBeNull();
  });

  it('exposes the heading to a forwarded ref so focus can be moved to it', () => {
    // Every boundary moves focus here — a client-side navigation into an error
    // state announces nothing on its own.
    const ref = React.createRef();
    render(<BoundaryError ref={ref} title="A" message="a" />);
    expect(ref.current).toBeTruthy();
    expect(ref.current.tagName).toBe('H2');
    expect(ref.current.getAttribute('tabindex')).toBe('-1');
  });

  it('drops the full-viewport treatment when inline', () => {
    const { container } = render(<BoundaryError inline title="A" message="a" />);
    expect(container.querySelector('.fx-errstate--inline')).toBeTruthy();
  });
});

describe('the three boundaries that use it', () => {
  it('the root boundary renders without throwing', () => {
    const { getByRole } = render(<RootError error={new Error('x')} reset={() => {}} />);
    expect(getByRole('heading', { level: 2 })).toBeTruthy();
  });

  it('the dashboard boundary renders without throwing', () => {
    const { getByRole } = render(<DashboardError error={new Error('x')} reset={() => {}} />);
    expect(getByRole('heading', { level: 2 })).toBeTruthy();
  });

  it('the section boundary catches a thrown child and renders inline', () => {
    const { container, getByRole } = render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(getByRole('heading', { level: 2 })).toBeTruthy();
    expect(container.querySelector('.fx-errstate--inline')).toBeTruthy();
  });

  it('never puts the raw exception message on screen', () => {
    // A caught render exception is a developer detail and can leak internals.
    const { container } = render(
      <ErrorBoundary><Boom /></ErrorBoundary>,
    );
    // The dev-only <details> block is allowed to carry it; the prose must not.
    const prose = container.querySelector('.fx-errstate__body');
    expect(prose.textContent).not.toContain('boom');
  });
});
