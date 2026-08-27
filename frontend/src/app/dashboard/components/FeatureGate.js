'use client';

import React, { useState } from 'react';
import UpgradeModal from './UpgradeModal';

const COLORS = {
  gold: '#B8944F', white: '#FFFFFF',
};

/**
 * Gates a feature based on the event's resolved tier features.
 *
 * Props:
 *  - tierFeatures: string[] — feature keys the current tier grants (from event.tier_features)
 *  - feature: string | string[] — the feature key to check (e.g., 'seating_map',
 *    'add_guest_manual'). An ARRAY passes when the tier grants ANY of them, mirroring
 *    the server's `requireAnyFeature(...)`. Both forms exist because both gates exist:
 *    the table routes accept `seating_map` OR `table_management`, and a lock here that
 *    asked for only the first would draw a padlock over an endpoint that answers. UI and
 *    gate have to ask the identical question or the product lies in one direction or
 *    the other — a dead button, or a 403 at the click.
 *  - isPaid: boolean — whether the event is paid (used for upgrade modal messaging)
 *  - children: ReactNode — the content to show if the feature is available
 *  - onUpgrade: () => void — callback when user clicks upgrade
 *  - wrapperStyle: object — override the locked-state wrapper's inline style
 *    (defaults to a shrink-wrapped inline-flex; pass e.g. { display: 'flex', width: '100%' }
 *    for full-width children like block-level buttons)
 */
export default function FeatureGate({ tierFeatures, feature, isPaid, children, onUpgrade, wrapperStyle }) {
  const [showModal, setShowModal] = useState(false);

  // Check if the specific feature is included in the tier's granted features.
  const features = Array.isArray(tierFeatures) ? tierFeatures : [];
  const wanted = Array.isArray(feature) ? feature : [feature];
  const hasFeature = wanted.some((k) => features.includes(k));

  if (hasFeature) {
    return children;
  }

  return (
    <>
      <div
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setShowModal(true);
        }}
        style={{
          position: 'relative',
          display: 'inline-flex',
          cursor: 'pointer',
          opacity: 0.85,
          ...wrapperStyle,
        }}
      >
        {/* Lock badge */}
        <div style={{
          position: 'absolute',
          top: -4,
          right: -4,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: COLORS.gold,
          display: 'flex', flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
          boxShadow: '0 1px 4px rgba(184,148,79,0.35)',
        }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={COLORS.white} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>

        {/* Children with pointer events disabled */}
        <div style={{ pointerEvents: 'none' }}>
          {children}
        </div>
      </div>

      <UpgradeModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        // The FIRST key names the modal. UpgradeModal maps a key to a title, and
        // handing it an array would miss every entry and fall back to the generic
        // "Premium Feature" — so an any-of gate must nominate its primary key.
        feature={wanted[0]}
        isPaid={isPaid}
        onUpgrade={() => {
          setShowModal(false);
          if (onUpgrade) onUpgrade();
        }}
      />
    </>
  );
}
