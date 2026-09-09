import React from "react";
import Link from "next/link";
import { C, T, SHADOW } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   THE MESSAGES THAT SEND THEMSELVES.

   ── WHERE THE NUMBERS AND THE WORDS ON THIS BAND COME FROM ───────────────

   All three marks are backend/services/emailScheduler.js, verbatim:

     T-24h   email   the table and the scannable entry pass   jobEventReminders
     T-6h    email   the final call                           jobSixHourReminders
     T-2h    SMS     the table and the pass link              jobSmsEventReminders

   and MESSAGE below is the literal output of the `seating_reminder` English
   template in backend/utils/smsTemplates.js, with the compliance footer
   smsDispatch.js appends to every outbound body.

   That last part is deliberate rather than pedantic. The footer is a CTIA
   requirement for the toll-free number this platform sends on, it is charged
   for in every segment estimate on the Messages page, and a marketing page
   that quietly crops it is showing a message this platform does not send.

   ── WHAT THE MOCKUP ASKED FOR AND THIS DOES NOT DO ───────────────────────

   The approved design drew an iOS lock-screen PUSH notification and a
   "custom reminders" row with an empty checkbox. Neither exists: there is no
   Fancy app on a guest's phone to push anything, and the schedule is not
   organizer-set — it is fixed to the three marks above, which is what makes
   it possible to promise the text arrives while somebody is deciding whether
   to leave the house. What an organizer CAN change is whether each type sends
   at all (events.sms_settings, four switches on the Messages page) and the
   wording of the body (events.sms_templates, the template studio). The band
   says that instead, because it is true and it is the better offer.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

const MARKS = [
  {
    at: "24 hours before",
    channel: "Email",
    title: "Their table, and the pass they are scanned with",
    body: "The chart has unlocked, so this is the first message that can name where they sit.",
  },
  {
    at: "6 hours before",
    channel: "Email",
    title: "The final call",
    body: "Short, to everyone who said yes, on the day they are re-reading the details.",
  },
  {
    at: "2 hours before",
    channel: "Text message",
    title: "The one that reaches them on the way",
    body: "Nobody opens email while they are getting ready. This lands with the table number in it.",
    highlight: true,
  },
];

/** The literal body — see the header. Split so the compliance footer can be
 *  set apart visually without being cropped out of the sentence. */
const MESSAGE = {
  body:
    "Hi Nadia! Nadia & Omar is on Saturday. Your table is 12. Show this at the door: fancyrsvp.com/i/k7m2xq4p",
  footer: " - Fancy RSVP. Msg&data rates may apply. Reply STOP to opt out, HELP for help.",
};

const CONTROLS = [
  "Four switches — invitation, table & pass, confirmation, changes",
  "Write the wording yourself, with merge tags for the name and table",
  "Every send costs a quoted number of credits, refunded if it fails",
];

export default function RemindersSection() {
  return (
    <section id="reminders" className="rem" aria-labelledby="rem-title">
      <div className="fx-container fx-container--5xl fx-gutter">
        <header className="rem-head">
          <span className="rem-kicker">
            Automated reminders
            <span aria-hidden="true" className="rem-kicker__rule" />
          </span>
          <span className="rem-numeral" aria-hidden="true">V</span>
          <h2 id="rem-title" className="rem-h2">
            Remind them before the night begins.
          </h2>
          <p className="rem-sub">
            Three messages go out on their own in the last day — two emails and
            one text — and every one of them carries that guest&rsquo;s own table
            and their own entry pass. You press nothing.
          </p>
        </header>

        <div className="rem-body">
          <ol className="rem-marks">
            {MARKS.map((m) => (
              <li key={m.at} className={m.highlight ? "rem-mark rem-mark--now" : "rem-mark"}>
                <span className="rem-mark__when">
                  <span className="rem-mark__at">{m.at}</span>
                  <span className="rem-mark__ch">{m.channel}</span>
                </span>
                <div className="rem-mark__copy">
                  <h3>{m.title}</h3>
                  <p>{m.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="rem-side">
            {/* THE MESSAGE, QUOTED. A <figure> holding a <blockquote>, not a
                drawing of a phone with invented chrome: what is worth showing
                here is the text itself, and a fake status bar and a fake
                battery icon around it would be the only untrue thing on the
                band. */}
            <figure className="rem-msg">
              <span className="rem-msg__from" aria-hidden="true">
                <span className="rem-msg__dot" />
                Fancy RSVP
              </span>
              <blockquote className="rem-msg__bubble">
                {MESSAGE.body}
                <span className="rem-msg__legal">{MESSAGE.footer}</span>
              </blockquote>
              <figcaption className="rem-msg__cap">
                The text, exactly as it is sent — footer and all
              </figcaption>
            </figure>

            <ul className="rem-controls">
              {CONTROLS.map((line) => (
                <li key={line}>
                  <svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden="true">
                    <path d="M1 5l3.6 3.5L12 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {line}
                </li>
              ))}
            </ul>

            <Link href="/features" className="rem-cta">
              See how the messaging works
              <svg width="16" height="9" viewBox="0 0 16 9" fill="none" aria-hidden="true">
                <path d="M0 4.5h14M11 1l3.5 3.5L11 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          above. Classes are prefixed "rem-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .rem {
          width: 100%;
          background: ${C.paper2};
          padding: 72px 0;
        }
        .rem-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 20px;
        }
        .rem-kicker {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-family: ${T.label};
          font-size: 10px;
          letter-spacing: 0.30em;
          text-transform: uppercase;
          color: ${C.goldInk};
          white-space: nowrap;
        }
        .rem-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .rem-numeral {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
        }
        .rem-h2 {
          grid-column: 1 / -1;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .rem-sub {
          grid-column: 1 / -1;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 52ch;
        }

        .rem-body {
          display: flex;
          flex-direction: column;
          gap: 38px;
          margin-top: 36px;
        }

        /* ── the three marks ────────────────────────────────────────────── */
        .rem-marks {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .rem-mark {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 10px;
          padding: 22px 0;
          border-top: 1px solid ${C.border};
          min-width: 0;
        }
        .rem-mark__when {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 4px 10px;
        }
        .rem-mark__at {
          font-family: ${T.display};
          font-size: 20px;
          font-weight: 400;
          line-height: 1.1;
          color: ${C.ink};
          white-space: nowrap;
        }
        .rem-mark__ch {
          font-family: ${T.body};
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.goldInk};
          white-space: nowrap;
        }
        .rem-mark__copy { min-width: 0; }
        .rem-mark__copy h3 {
          font-family: ${T.display};
          font-size: 19px;
          font-weight: 400;
          line-height: 1.28;
          color: ${C.ink};
          margin: 0;
        }
        .rem-mark__copy p {
          font-size: 13px;
          font-weight: 300;
          line-height: 1.72;
          color: ${C.inkSoft};
          margin: 7px 0 0;
        }
        /* The text is the one people remember, so it is the one with a mark
           beside it. A hairline in the gold, not a filled card: a highlighted
           box in a list of three says the other two are less true. */
        .rem-mark--now { border-top-color: ${C.gold}; }
        .rem-mark--now .rem-mark__at { color: ${C.goldInk}; }

        /* ── the message ────────────────────────────────────────────────── */
        .rem-side { min-width: 0; }
        .rem-msg {
          margin: 0;
          padding: 20px;
          background: ${C.paper};
          border: 1px solid ${C.border};
          box-shadow: ${SHADOW.card};
        }
        .rem-msg__from {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.inkSoft};
        }
        .rem-msg__dot {
          display: block;
          flex: none;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${C.gold};
        }
        .rem-msg__bubble {
          margin: 12px 0 0;
          padding: 15px 17px;
          background: ${C.paper2};
          border: 1px solid ${C.border};
          border-radius: 16px 16px 16px 4px;
          font-family: ${T.body};
          font-size: 14px;
          font-weight: 400;
          line-height: 1.62;
          color: ${C.ink};
          /* A URL is one unbreakable token. Without this the bubble sets the
             whole column's min-content width and the band scrolls sideways on
             a phone. */
          overflow-wrap: anywhere;
        }
        .rem-msg__legal {
          display: block;
          margin-top: 9px;
          font-size: 11.5px;
          line-height: 1.55;
          color: ${C.inkSoft};
          opacity: 0.85;
        }
        .rem-msg__cap {
          margin: 12px 0 0;
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.72;
        }

        .rem-controls {
          margin: 26px 0 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 11px;
        }
        .rem-controls li {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: start;
          gap: 11px;
          font-size: 13px;
          font-weight: 300;
          line-height: 1.55;
          color: ${C.ink};
        }
        .rem-controls svg { color: ${C.goldInk}; margin-top: 5px; }

        .rem-cta {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          margin-top: 26px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.ink};
          text-decoration: none;
          border-bottom: 1px solid ${C.gold};
          padding-bottom: 8px;
          transition: color 0.3s ease, border-color 0.3s ease;
        }
        .rem-cta:hover { color: ${C.goldInk}; border-color: ${C.goldInk}; }

        @media (min-width: 768px) {
          .rem { padding: 122px 0; }
          .rem-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .rem-kicker__rule { width: 44px; }
          .rem-numeral { font-size: 15px; }
          .rem-h2 { font-size: 54px; margin-top: 22px; }
          .rem-sub { font-size: 17px; margin-top: 18px; }
          .rem-body {
            display: grid;
            grid-template-columns: minmax(0, 1.06fr) minmax(0, 0.94fr);
            gap: 68px;
            align-items: start;
            margin-top: 54px;
          }
          /* The time and the copy sit side by side once there is room for
             both — the marks then read as a schedule rather than as a list. */
          /* 164px, not 150. ".rem-mark__at" is nowrap and "24 hours before"
             sets to about 132px of Cormorant at 21px — a fixed track with a
             nowrap child does not shrink it, it overflows it, so the track has
             to clear the longest label rather than the average one. */
          .rem-mark {
            grid-template-columns: 164px minmax(0, 1fr);
            gap: 26px;
            padding: 26px 0;
          }
          .rem-mark__when { display: block; }
          .rem-mark__at { font-size: 21px; }
          .rem-mark__ch { display: block; margin-top: 6px; }
          .rem-mark__copy h3 { font-size: 20px; }
          .rem-mark__copy p { font-size: 13.5px; }
          .rem-msg { padding: 26px; }
          .rem-msg__bubble { font-size: 15px; }
          .rem-controls li { font-size: 13.5px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .rem-cta { transition: none; }
        }
      `}</style>
    </section>
  );
}
