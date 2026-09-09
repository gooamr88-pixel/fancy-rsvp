import React from "react";
import FeatureBand from "./FeatureBand";
import { C, T, SHADOW } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   THE MESSAGES THAT SEND THEMSELVES.

   One screen: the text a guest gets, and the three moments it goes out.

   ── WHERE THE WORDS ON THIS BAND COME FROM ───────────────────────────────

   All three marks are backend/services/emailScheduler.js, verbatim:

     T-24h   email   the table and the scannable entry pass   jobEventReminders
     T-6h    email   the final call                           jobSixHourReminders
     T-2h    SMS     the table and the pass link              jobSmsEventReminders

   and MESSAGE below is the literal output of the `seating_reminder` English
   template in backend/utils/smsTemplates.js, with the compliance footer
   smsDispatch.js appends to every outbound body. That footer is a CTIA
   requirement for the toll-free number this platform sends on and is charged
   for in every segment estimate; a marketing page that quietly crops it is
   showing a message this platform does not send.

   ── WHAT THE MOCKUP ASKED FOR AND THIS DOES NOT DO ───────────────────────

   The approved design drew an iOS lock-screen PUSH notification and a
   "custom reminders" row with an empty checkbox. Neither exists: there is no
   Fancy app on a guest's phone to push anything, and the schedule is not
   organizer-set — it is fixed to the three marks above, which is exactly what
   lets the page promise the text arrives while somebody is deciding whether to
   leave the house. The band keeps the mockup's SHAPE — an artefact, then three
   ticked rows — and puts the true thing inside it.

   The three rows used to carry a two-line paragraph each. They are one line
   now, for the reason in SeatingSection.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

const MARKS = [
  { at: "24 hours before", what: "Email — their table and their entry pass" },
  { at: "6 hours before", what: "Email — the final call" },
  { at: "2 hours before", what: "Text — the table number, on their phone", now: true },
];

/** The literal body — see the header. Split so the compliance footer can be
 *  set apart visually without being cropped out of the sentence. */
const MESSAGE = {
  body:
    "Hi Nadia! Nadia & Omar is on Saturday. Your table is 12. Show this at the door: fancyrsvp.com/i/k7m2xq4p",
  footer: " - Fancy RSVP. Msg&data rates may apply. Reply STOP to opt out, HELP for help.",
};

export default function RemindersSection() {
  return (
    <FeatureBand
      id="reminders"
      tone="warm"
      kicker="Automated reminders"
      title="Remind them before the night begins."
      sub="Three messages go out on their own in the last day — two emails and one text — each carrying that guest's own table. You press nothing."
      cta={{ href: "/features", label: "See how it works" }}
    >
      <div className="rem-stack">
        {/* THE MESSAGE, QUOTED. A figure holding a blockquote, not a drawing of
            a phone with invented chrome: what is worth showing is the text
            itself, and a fake status bar and a fake battery around it would be
            the only untrue thing on the band. */}
        <figure className="rem-msg">
          <span className="rem-msg__from" aria-hidden="true">
            <span className="rem-msg__dot" />
            Fancy RSVP
          </span>
          <blockquote className="rem-msg__bubble">
            {MESSAGE.body}
            <span className="rem-msg__legal">{MESSAGE.footer}</span>
          </blockquote>
        </figure>

        <ol className="rem-marks">
          {MARKS.map((m) => (
            <li key={m.at} className={m.now ? "rem-mark rem-mark--now" : "rem-mark"}>
              <span className="rem-mark__tick" aria-hidden="true">
                <svg width="11" height="9" viewBox="0 0 13 10" fill="none">
                  <path d="M1 5l3.6 3.5L12 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="rem-mark__at">{m.at}</span>
              <span className="rem-mark__what">{m.what}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component. Classes are prefixed "rem-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .rem-stack {
          max-width: 560px;
          margin: 0 auto;
        }

        /* ── the message ────────────────────────────────────────────────── */
        .rem-msg {
          margin: 0;
          padding: 20px;
          background: ${C.paper};
          border: 1px solid ${C.border};
          border-radius: 16px;
          box-shadow: ${SHADOW.card};
          text-align: left;
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
          border-radius: 16px 16px 16px 4px;
          font-family: ${T.body};
          font-size: 14px;
          line-height: 1.6;
          color: ${C.ink};
          /* A URL is one unbreakable token. Without this the bubble sets the
             column's min-content width and the band scrolls sideways. */
          overflow-wrap: anywhere;
        }
        .rem-msg__legal {
          display: block;
          margin-top: 9px;
          font-size: 11px;
          line-height: 1.5;
          color: ${C.inkSoft};
          opacity: 0.85;
        }

        /* ── the three marks ────────────────────────────────────────────────
           One line each, in the mockup's shape: a tick, a time, and what goes
           out. They carried a two-line paragraph each until 2026-09-09, which
           is 90 words on a screen whose subject is a picture. */
        .rem-marks {
          margin: 14px 0 0;
          padding: 0;
          list-style: none;
        }
        .rem-mark {
          display: grid;
          grid-template-columns: auto auto minmax(0, 1fr);
          align-items: center;
          gap: 12px;
          padding: 15px 18px;
          margin-top: 8px;
          background: ${C.paper};
          border: 1px solid ${C.border};
          border-radius: 12px;
          text-align: left;
        }
        .rem-mark__tick {
          display: grid;
          place-items: center;
          width: 21px;
          height: 21px;
          border-radius: 50%;
          background: ${C.paper2};
          border: 1px solid ${C.border};
          color: ${C.goldInk};
        }
        .rem-mark__at {
          font-family: ${T.display};
          font-size: 17px;
          line-height: 1.1;
          color: ${C.ink};
          white-space: nowrap;
        }
        .rem-mark__what {
          min-width: 0;
          font-size: 12.5px;
          font-weight: 300;
          line-height: 1.45;
          color: ${C.inkSoft};
        }
        /* The text is the one people remember, so it is the one marked. */
        .rem-mark--now { border-color: ${C.gold}; }
        .rem-mark--now .rem-mark__tick {
          background: ${C.goldInk};
          border-color: ${C.goldInk};
          color: ${C.paper};
        }

        @media (min-width: 768px) {
          .rem-stack { max-width: 620px; }
          .rem-msg { padding: 26px; }
          .rem-msg__bubble { font-size: 15px; }
          .rem-marks { margin-top: 18px; }
          .rem-mark { padding: 16px 22px; margin-top: 10px; }
          .rem-mark__at { font-size: 18px; }
          .rem-mark__what { font-size: 13px; }
        }
      `}</style>
    </FeatureBand>
  );
}
