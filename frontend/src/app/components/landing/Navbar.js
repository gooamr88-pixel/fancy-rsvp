"use client";

import React, { useState, useEffect } from "react";
import LogoutModal from '../LogoutModal';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { useModalA11y } from "../../hooks/useModalA11y";
import { SHOP_LABEL, SHOP_PATH } from "../../utils/shopLinks";

/* ═══════════════════════════════════════════════════════════
   Navbar — Fancy RSVP (Page 09 Brand Guide)
   
   Layout from mockup:
   ┌──────────────────────────────────────────────────────────┐
   │  [Logo: Envelope + "Fancy RSVP"]   Features  Pricing    │
   │                                    About  Log In  [Get]  │
   └──────────────────────────────────────────────────────────┘
   
   - White background, very subtle bottom border
   - Logo on left: envelope icon + "Fancy" in script + "RSVP" in serif
   - Nav links centered-right: Home, Features, Templates, Pricing, About, Contact, Log In
   - CTA button "Get Started" in Champagne Gold with rounded corners
   ═══════════════════════════════════════════════════════════ */

/* Primary navigation links — shared by desktop nav + mobile menu.

   SIX, down from nine. The bar carried Home, Features, Door App, Pricing,
   Printed Cards, Solutions, Blog, About and Contact, plus Log In and a gold
   Get Started button: eleven targets competing at 14px, which is not a
   navigation bar, it is a list. Nine of them also had to fit beside the
   logo before the mobile menu takes over, which is why they were set so
   small in the first place.

   What went, and where it went instead:
     • "About" — in the footer's Company column.

   HOME IS BACK (2026-08-21, at the owner's direction). The argument for
   dropping it was that the logo to its left already links there — true, and
   still true. It is also a convention people do not all know: a visitor deep
   in /shop/wedding-cards looking for the way back scans the MENU, and the
   logo-as-home is learned behaviour rather than a labelled affordance. The
   duplication is the point of it.

   CONTACT IS BACK, AND BLOG IS OUT (2026-08-21, at the owner's direction).
   The argument below for keeping Blog was that it was real content behind a
   URL nobody was given; the argument for dropping Contact was that the FAQ
   band already links it. Weighed against each other, a visitor who wants to
   TALK TO SOMEONE should not have to read to the bottom of the page or find
   the right band first — that intention arrives at any scroll position, and
   the menu is the only thing on screen at all of them. The blog is still
   linked from the footer.

   What stayed, and why each earns a slot:
     • Features and Pricing — the two questions every visitor has.
     • Printed Cards — a SECOND PRODUCT LINE, not a support page. Nothing in
       the app leads to it; if it is not here it is only discoverable from
       the homepage teaser, which itself disappears when the catalogue is
       empty (see utils/shopLinks.js).
     • Door App — the hardware story, and the one feature with a page of its
       own.
     • Solutions — the segment pages (planners / venues / corporate).
     • Contact — the one item that is not about reading more, but about
       reaching a person. */
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  // Was "Printed Cards" → /printed-invitations. The catalogue now sells
  // screens, scanners and signage too, and nobody hunting for a door scanner
  // opens a menu item that promises cards.
  { label: SHOP_LABEL, href: SHOP_PATH },
  { label: "Door App", href: "/checkin-app" },
  { label: "Solutions", href: "/solutions" },
  { label: "Contact Us", href: "/contact" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isLoggedIn, loading, logout } = useAuth();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Focus trap, initial focus, Escape-to-close, and body-scroll lock for the
  // full-screen mobile menu overlay — it previously had none of these.
  const mobileMenuRef = useModalA11y(mobileMenuOpen, { onClose: () => setMobileMenuOpen(false) });

  return (
    <>
      <header
        id="main-navbar"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          background: scrolled ? "rgba(255, 255, 255, 0.97)" : "#FCFBF8",
          backdropFilter: scrolled ? "blur(12px)" : "none",
          borderBottom: scrolled ? "1px solid #E3DBCB" : "1px solid transparent",
          transition: "all 0.35s ease",
          boxShadow: scrolled ? "0 1px 20px rgba(0,0,0,0.04)" : "none",
        }}
      >
        {/* .fx-gutter as well as .fx-container because this bar is not inside
            an .fx-section — nothing else supplies its horizontal padding. It
            replaces a hardcoded `padding: "0 48px"` that never reduced: on a
            320px iPhone SE that left 224px for a ~183px logo plus a 44px
            minimum hamburger, i.e. it did not fit. The gutter is now 20px
            there, and clears the sensor housing in landscape. */}
        <div
          className="fx-container fx-gutter"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "78px",
          }}
        >
          {/* ─── Logo ─── */}
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              textDecoration: "none",
              cursor: "pointer",
            }}
            id="navbar-logo"
          >
            {/* Envelope Icon */}
            <div
              style={{
                width: "42px",
                height: "42px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="38"
                height="32"
                viewBox="0 0 38 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Envelope body */}
                <rect
                  x="2"
                  y="8"
                  width="34"
                  height="22"
                  rx="2"
                  stroke="#A98A4E"
                  strokeWidth="1.5"
                  fill="none"
                />
                {/* Envelope flap */}
                <path
                  d="M2 10L19 22L36 10"
                  stroke="#A98A4E"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinejoin="round"
                />
                {/* Flap top triangle */}
                <path
                  d="M4 8L19 0L34 8"
                  stroke="#A98A4E"
                  strokeWidth="1.2"
                  fill="none"
                  strokeLinejoin="round"
                />
                {/* RSVP text inside */}
                <text
                  x="19"
                  y="21"
                  textAnchor="middle"
                  fill="#A98A4E"
                  fontSize="6.5"
                  fontFamily="serif"
                  fontWeight="600"
                  letterSpacing="1"
                >
                  RSVP
                </text>
                {/* Small decorative diamond on flap */}
                <path
                  d="M19 3L20.5 5L19 7L17.5 5Z"
                  fill="#8A6D34"
                  opacity="0.7"
                />
              </svg>
            </div>

            {/* Brand Name */}
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
              <span
                style={{
                  fontFamily: "var(--font-script)",
                  fontSize: "28px",
                  fontWeight: 400,
                  color: "#A98A4E",
                  lineHeight: 1,
                  letterSpacing: "-0.5px",
                }}
              >
                Fancy
              </span>
              <span
                style={{
                  fontFamily: "var(--font-cormorant), Georgia, serif",
                  fontSize: "22px",
                  fontWeight: 600,
                  color: "#191815",
                  letterSpacing: "3px",
                  textTransform: "uppercase",
                  lineHeight: 1,
                }}
              >
                RSVP
              </span>
            </div>
          </Link>

          {/* ─── Desktop Navigation ─── */}
          {/* `gap` deliberately lives in the <style jsx> block below rather
              than here: it has to be fluid, and an inline style cannot hold
              a clamp that a media query could also touch. Leaving it inline
              would make the CSS rule inert. */}
          <nav
            style={{
              display: "flex",
              alignItems: "center",
            }}
            className="desktop-nav"
          >
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`desktop-nav-link${pathname === item.href ? " desktop-nav-link-active" : ""}`}
                aria-current={pathname === item.href ? "page" : undefined}
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "15px",
                  fontWeight: 700,
                  textDecoration: "none",
                  cursor: "pointer",
                  padding: "4px 0",
                  letterSpacing: "0.2px",
                  whiteSpace: "nowrap",
                }}
                id={`nav-link-${item.href === "/" ? "home" : item.href.slice(1)}`}
              >
                {item.label}
              </Link>
            ))}

            {/* ── The demo sits with the ACTIONS, not with NAV_LINKS ──
                Two reasons, and the second one is the point. The list is
                capped at seven by a test, and it is already at seven — a
                cap that exists because eleven targets beside a logo is not a
                navigation bar. And this is not a section of the site to be
                browsed to; it is the thing the page is asking you to do,
                which is what the right-hand cluster is for. */}
            <Link
              href="/demo/invitation"
              className="desktop-nav-link"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "15px",
                fontWeight: 600,
                textDecoration: "none",
                cursor: "pointer",
              }}
              id="nav-link-demo"
            >
              Try it
            </Link>

            {!loading && !isLoggedIn && (
              <Link
                href="/login"
                className="desktop-nav-link"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "15px",
                  fontWeight: 600,
                  textDecoration: "none",
                  cursor: "pointer",
                }}
                id="nav-link-login"
              >
                Log In
              </Link>
            )}
            {!loading && isLoggedIn && (
              <button
                onClick={() => setShowLogoutModal(true)}
                className="desktop-nav-link"
                style={{
                  background: "none",
                  border: "none",
                  fontFamily: "var(--font-sans)",
                  fontSize: "15px",
                  fontWeight: 600,
                  textDecoration: "none",
                  cursor: "pointer",
                }}
                id="nav-link-logout"
              >
                Log Out
              </button>
            )}

            {!loading && !isLoggedIn && (
              <Link
                href="/register"
                className="btn-gold"
                style={{
                  padding: "11px 28px",
                  fontSize: "14px",
                  fontWeight: 700,
                  borderRadius: "6px",
                  letterSpacing: "0.3px",
                }}
                id="nav-cta-get-started"
              >
                Get Started
              </Link>
            )}
            {!loading && isLoggedIn && (
              <Link
                href="/dashboard"
                className="btn-gold"
                style={{
                  padding: "11px 28px",
                  fontSize: "14px",
                  fontWeight: 700,
                  borderRadius: "6px",
                  letterSpacing: "0.3px",
                }}
                id="nav-cta-dashboard"
              >
                Dashboard
              </Link>
            )}
          </nav>

          {/* ─── Mobile Hamburger ─── */}
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              display: "none",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "8px",
              zIndex: 1001,
            }}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            id="mobile-menu-toggle"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#191815"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {mobileMenuOpen ? (
                <>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* ─── Mobile Menu Overlay ─── */}
      {mobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          tabIndex={-1}
          className="mobile-menu-overlay fx-safe-scroll-b"
          style={{
            position: "fixed",
            top: "78px",
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(255,255,255,0.98)",
            zIndex: 999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: "48px",
            gap: "28px",
            animation: "fadeIn 0.25s ease",
            outline: "none",
            // This menu is ~460px tall (6 links at 18px sans + Log In + the
            // CTA, with 28px gaps). A phone in LANDSCAPE has roughly 297px
            // below the 78px header — and useModalA11y locks body scroll,
            // so without this the bottom of the list was simply unreachable.
            // "Get Started", the primary conversion CTA, was the last item.
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            // Keeps the scroll gesture from chaining to the locked body.
            overscrollBehavior: "contain",
            // --fx-scroll-pad feeds .fx-safe-scroll-b: at least 32px of
            // breathing room under the CTA, more on a device with a home
            // indicator so the last item clears it.
            "--fx-scroll-pad": "32px",
          }}
        >
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              onClick={() => setMobileMenuOpen(false)}
              style={{
                // THE PLATFORM SANS, like the desktop bar directly above and
                // like "Log In" directly below. These were Cormorant at 24px
                // with 1px of tracking — the display serif, used for
                // navigation, in the one place the two treatments sit three
                // lines apart from each other. A menu is interface, not
                // editorial: it takes the interface face.
                fontFamily: "var(--font-sans)",
                fontSize: "18px",
                fontWeight: 600,
                color: pathname === item.href ? "#A98A4E" : "#191815",
                textDecoration: "none",
                cursor: "pointer",
                letterSpacing: "0.2px",
              }}
            >
              {item.label}
            </Link>
          ))}
          {/* Same placement as the desktop bar: with the actions, below the
              seven links, so both menus offer the same thing in the same
              order. */}
          <Link
            href="/demo/invitation"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "16px",
              fontWeight: 600,
              color: "#5C574E",
              textDecoration: "none",
            }}
          >
            Try it
          </Link>
          {!loading && !isLoggedIn && (
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "16px",
                fontWeight: 600,
                color: "#5C574E",
                textDecoration: "none",
              }}
            >
              Log In
            </Link>
          )}
          {!loading && isLoggedIn && (
            <button
              onClick={() => { setMobileMenuOpen(false); setShowLogoutModal(true); }}
              style={{
                background: "none",
                border: "none",
                fontFamily: "var(--font-sans)",
                fontSize: "16px",
                fontWeight: 600,
                color: "#5C574E",
                cursor: "pointer",
              }}
            >
              Log Out
            </button>
          )}
          {!loading && !isLoggedIn && (
            <Link
              href="/register"
              className="btn-gold"
              style={{ padding: "14px 48px", fontSize: "15px" }}
              onClick={() => setMobileMenuOpen(false)}
            >
              Get Started
            </Link>
          )}
          {!loading && isLoggedIn && (
            <Link
              href="/dashboard"
              className="btn-gold"
              style={{ padding: "14px 48px", fontSize: "15px" }}
              onClick={() => setMobileMenuOpen(false)}
            >
              Dashboard
            </Link>
          )}
        </div>
      )}

      {/* ─── Spacer for fixed header ─── */}
      <div style={{ height: "78px" }} />

      <style jsx>{`
        :global(.desktop-nav-link) {
          color: #191815;
          transition: color 0.25s ease;
        }
        .desktop-nav-link:hover,
        .desktop-nav-link:focus-visible,
        :global(.desktop-nav-link-active) {
          color: #A98A4E;
        }

        /* Fluid link spacing: 16px at 1024px, 28px at 1280px and above.
           This is what makes the lg swap below actually safe. The desktop
           nav cannot shrink — every link is whiteSpace:nowrap — so its
           width is the sum of its parts, and the gaps are the only part
           that can give. Budget at a 1024px viewport, the tightest case
           where this nav still renders:
             gutters      2 × 40.5 = 81   → 943px available
             7 links      ~373 (15px sans @700, 44 chars — bold runs
                           measurably wider than regular; ~10% padded onto
                           the previous regular-weight estimate below)
             8 gaps       8 × 16   = 128
             Log In       ~50 (15px sans @600)
             Get Started  ~141 (11 chars @14px bold + 56px padding —
                           already bold before this pass, unaffected)
             logo         ~183 (42 icon + 10 + 59 script + 6 + 66 serif)
             ────────────────────────────────────────────────────────
             total        ~916 ≤ 943 ✓  (27px, ~2.9% headroom)
           The floor dropped from 20px to 16px specifically to buy back
           room for the links moving from regular to bold (this file's own
           earlier note on the OLD flat-28px regression — a tablet width
           overflowing with only ~11px of true margin — is exactly the
           failure mode a thin headroom number like this one risks; the
           10% bold-width figure is a font-metrics estimate, not a
           measured one, so treat this margin as tighter than it looks and
           re-check on an actual 1024px viewport before trusting it blind). */
        .desktop-nav {
          gap: clamp(16px, 4.6875vw - 32px, 28px);
        }

        /* Was 768px, then 1024px, now 1150px — each time for the same reason:
           the desktop nav cannot shrink (every link is whiteSpace:nowrap), so
           the breakpoint has to track how wide it actually is, and it got
           wider when a link was added.

           768 → 1024 fixed iPad Air portrait (820), iPad Pro 11" portrait
           (834) and iPad landscape (1024), which all rendered it and
           overflowed.

           1024 → 1150 is the "Printed Cards" link. MEASURED, not estimated,
           with test/shots/navbarWidthProbe.dump.jsx rendering the real
           component at real widths (logged out — the widest case, since it
           shows "Log In" AND "Get Started" where a signed-in visitor gets
           only "Dashboard"):

             1024px → overflowed by 53px
             1100px → overflowed by 15px
             1120px → clean
             1280px → clean

           and the overflow CLIPS rather than scrolls, so the symptom was the
           "Get Started" CTA — the primary conversion button on the marketing
           site — simply not being visible between roughly 1024 and 1115px.
           1150 is the first clean measurement plus real headroom, because the
           arithmetic budget above this rule was wrong by exactly the amount
           that matters: it was written for 7 links and there are now 9.

           If you add another link, re-run that probe. Do not re-derive this
           number from the character-count budget above — that is what failed. */
        @media (max-width: 1149.98px) {
          .desktop-nav {
            display: none !important;
          }
          .mobile-menu-btn {
            display: block !important;
          }
        }
      `}</style>
      <LogoutModal isOpen={showLogoutModal} onClose={() => setShowLogoutModal(false)} onConfirm={logout} />
    </>
  );
}
