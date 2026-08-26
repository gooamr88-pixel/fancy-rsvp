# Fancy RSVP — SMS System Reference

**Audience:** anyone who needs to understand how text messaging works here — support,
sales, finance, or a developer touching it for the first time. It assumes **no prior
knowledge of SMS**.

**Last updated:** 2026-08-10 (the four-type rebuild)

---

## 1. The one-paragraph version

An organizer creating an event can add **text messaging** as a paid extra, on any plan,
in the same checkout as their licence. The system works out how many messages they need
and quotes a price; they can adjust it freely. Buying it unlocks **four** kinds of
message and credits the event with a **message balance**. The organizer texts their
invitation by hand from the RSVPs tab; the other three send themselves. **A guest is
only ever texted if they personally agreed to it.** If the balance runs low the
organizer is warned in time to top up; if it runs out, everything continues by email.

---

## 2. Vocabulary

The product never shows a customer any of the left-hand column. This table is for
**internal readers only**.

| Internal term | What we show the customer | Why it matters |
|---|---|---|
| **Segment** | "message" | The billing unit. 160 plain-English characters. A 200-character text is **two** and costs twice as much. |
| **GSM-7** | — | The encoding that fits 160 characters per segment. |
| **UCS-2** | "Arabic messages use more" | Any Arabic, emoji or accent drops a segment to **70** characters. |
| **Credit / allowance / wallet** | "messages", "messages left" | Same thing. The database still says `credits`; the UI never does. |
| **E.164** | — | `+15551234567`. Carriers reject anything else; we normalize on input. |
| **Add-on** | "text messaging" | The paid extra. |
| **Toll-free number** | — | The `+1 8XX…` number we send from, *verified* with the carriers — which is why §9 is not optional. |
| **STOP** | "They replied STOP" | The universal opt-out word. Legally binding, immediate, permanent. |
| **TCPA** | — | US law on automated texts. Per-message statutory penalties. |

> **The most common misunderstanding:** "message" and "segment" are not the same. The
> balance is denominated in segments; we call them messages for clarity.

---

## 3. The four message types

Seven became four on 2026-08-22. Seven switches was not seven times the control — it was
one decision nobody made.

| # | Type | Goes to | When | Email too? |
|---|---|---|---|---|
| 1 | **Invitation** | Guest | **Manually**, when the organizer presses send | Yes — the email carries the envelope reveal |
| 2 | **Table & entry pass** | Guest (attending) | Automatically when seated, **and again 1–2 days before** | Yes — the email carries the scannable QR |
| 3 | **Change or cancellation** | Guest (yes/maybe) | Automatically, after the organizer confirms | Yes — both channels, always |
| 4 | **Your own alerts & reports** | **The organizer** | ~24h before | Yes — the email has the numbers |

Defined once in [`backend/config/smsMessageTypes.js`](../backend/config/smsMessageTypes.js).

**`replacesEmail` is `false` on all four, and that is structural.** `trySms` suppresses an
email only when the SMS was delivered *and* the type declares `replacesEmail: true`. With
all four false, an SMS can never silence an email — so "the guest always hears from us,
whatever happened to the text" is a property of the system rather than a rule someone has
to remember at each call site.

### What was retired, and why

| Retired | Why |
|---|---|
| `rsvp_confirmation` | Told the guest something they had just done themselves, and charged for it. Merged into #2. |
| `event_reminder`, `qr_ticket` | Both were "here is your table / your pass". Merged into #2. |
| `rsvp_reminder` | Chasing a non-responder converts poorly. The organizer can re-text the invitation by hand. |
| `decline_ack` | A charged message saying "thanks anyway" to someone who just declined. Email only now. |
| `campaign` | Free-text bulk send. Removed entirely — see §3.1. |

History is **kept**. `sms_log` rows for retired kinds still render (`labelForKind` names
them "no longer sent") and the resend endpoint **refuses** them — it deletes the log row
before re-dispatching, so without that guard a retry would destroy a compliance record and
then fail anyway.

### 3.1 Why free-text campaigns are gone

The composer was the most elaborate screen in the product and the least understood: it
asked someone planning a wedding to compose bulk marketing, pick an audience segment and
attest consent at launch.

It was also the compliance risk. Free-form text to a resolved segment is the pattern that
got our toll-free number rejected (Twilio TFV **30475**). A templated invitation to a guest
carrying a recorded consent record is exactly what the number is registered to carry — which
is why texting the invitation is now an ordinary button rather than a guarded workflow.

---

## 4. Who actually receives a text

**One person per invitation — the primary contact.** A family of six who RSVP'd together is
**one** party with **one** primary contact. Companions have no phone numbers in the system.

A guest is texted only when **all** of these hold:

1. The event bought text messaging
2. That message type is switched on
3. This exact message hasn't already been sent *(idempotency on `kind` + `ref`)*
4. The party has recorded consent
5. The primary contact has a phone number
6. That number hasn't replied STOP
7. The balance has enough left
8. The carrier is configured and reachable

Any failure and **the guest still hears from us by email**. The reason is recorded.

### The four ways consent is obtained

| Route | Who acts | Recorded as |
|---|---|---|
| RSVP form checkbox | The guest | `guest_optin` |
| Organizer confirms when adding a guest | The organizer | `host_attested` |
| **`sms_consent` column in an import file** | The organizer, per row | `host_attested` |
| Public `/sms-opt-in` page | The person themselves | `guest_optin` |

**Precedence:** a guest's own decision always outranks an organizer's claim — the attesting
UPDATE is guarded by `.is('sms_consent_at', null)`. Within an import, a **per-row `no`
beats a ticked whole-file checkbox**: the narrower statement wins.

**Consent is per event. STOP is global.** Editing a guest's phone number automatically
revokes consent — the new number's owner never agreed to anything.

---

## 5. Money

### 5.1 What a message really costs us

| | |
|---|---|
| Vonage US outbound | **$0.00809** per segment |
| US carrier pass-through fees | ~$0.002–0.003 per segment |
| **All-in cost** | **≈ 1.1¢ per segment** |

Stored in `super_admin_config.sms_rate_cents_per_credit`, which is **`NUMERIC(10,4)`**.

> **This column was `INTEGER` until 2026-08-22, and it was a real defect.** The admin form
> has always offered fractional input (`step`, `parseFloat`), so an admin typing the true
> `1.1` had it silently rounded to `1` on write. Every margin figure on the admin dashboard
> was therefore computed against a cost about 9% too low for the entire life of the feature.
> Fixing the column corrects historic margins **downward**.

### 5.2 What the organizer pays

```
list price = 1.1¢ × (1 + 172.73%) = 3.0¢ per segment
final      = list × (1 − best matching volume discount)
```

| Order size | Discount | Effective |
|---|---|---|
| < 500 | — | 3.00¢ |
| 500+ | 10% | 2.70¢ |
| 2,000+ | 18% | 2.46¢ |
| 5,000+ | 25% | 2.25¢ |
| 10,000+ | 30% | 2.10¢ |

Tiers are **never cumulative** — the single best tier applies. **Discounts are capped at
50%**, not 90%: break-even is a 63% discount, so a mistyped `65` would have saved without
complaint and lost money on exactly the large orders the tier exists to win.

### 5.3 How many messages an event needs

Two mechanisms, and they compound.

**The ladder** (`sms_pricing_config.guest_bands`) — messages budgeted **per invitation**,
falling as the guest list grows:

| Guests | Messages per invitation |
|---|---|
| ≤ 300 | 3 |
| 301 – 1,000 | 2.5 |
| 1,001 – 3,000 | 2 |
| 3,000+ | 1.5 |

That budget is split across the three guest types by **relative weight** — invitation 1.0,
table & pass 1.2, change 0.3. Only the ratios matter. Switching a type off **lowers** the
total rather than redistributing it: the denominator is every guest type's weight, not just
the enabled ones. Quoting for messages that can never send is overcharging.

The organizer's own reports are **absolute, per event** (3), never multiplied by guest count.

**Segments per message** — measured, not assumed:

| Script | Segments |
|---|---|
| Latin | **2.0** |
| Arabic | **3.0** |

> These were `1.4` and `2.6`, and both were **wrong from the day they were written**. A
> GSM-7 segment holds 160 characters; the mandatory compliance footer is 78 of them and a
> short link is another 32, leaving ~50 for a guest's name and the event title. Measured
> across a realistic spread of names and titles, **not one English message fits in a single
> segment**. The consequence was not academic: every allowance ever sold was quoted about
> 40% short, so organizers ran out partway through their own event while being told they had
> bought enough.

**Short links** are why Arabic is 3.0 rather than 4.0. The raw RSVP URL
(`/{slug}/rsvp?g={uuid}`) is ~89 characters; `fancyrsvp.com/i/k7m2xq4p` is 32. That is a
permanent **25% cut on every Arabic event**, and it stops a URL wrapping across four lines
in a message app looking like phishing.

### 5.4 The resulting prices

| Guests | Latin | Arabic | Per guest (Latin) | Margin |
|---|---|---|---|---|
| 100 | $9.00 | $13.50 | $0.090 | 63.3% |
| 200 | $16.20 | $22.95 | $0.081 | 59.3% |
| 300 | $22.95 | $33.75 | $0.076 | 59.3% |
| 500 | $31.05 | $47.25 | $0.062 | 59.3% |
| 1,000 | $56.58 | $84.87 | $0.057 | 55.3% |
| 2,000 | $89.79 | $123.75 | $0.045 | 55.3% |
| 3,000 | $123.75 | $184.50 | $0.041 | 51.1% |
| 5,000 | $154.13 | $215.25 | $0.031 | 47.6% |

Per-guest cost falls **66%** from 100 to 5,000 guests. Arabic is ~1.4–1.5× Latin — not the
2× the raw encoding implies, because the compliance footer is a fixed 78 characters in both
encodings and fixed overhead compresses the gap.

### 5.5 Spending, refunds, running out

**1 segment = 1 unit of balance**, deducted the moment the message is handed to the carrier,
in one atomic row-locked transaction with an idempotency key.

| Refund trigger | What happens |
|---|---|
| Carrier rejects it immediately | Balance refunded within milliseconds |
| Carrier reports `failed`/`undelivered` later | Webhook → refunded automatically |
| Organizer gets a Stripe refund | Purchased balance deducted |

At **20% remaining**: one email plus a banner. At **zero**: one more email confirming guests
are now reached by email instead. Each fires once per depletion; the stamps clear on top-up.

---

## 6. Sending limits for new accounts

| Delivered so far | Max per send |
|---|---|
| 0 – 199 | 50 |
| 200 – 999 | 500 |
| 1,000+ | unlimited |

Caps a **single send, never the total**. Keyed on delivered volume rather than account age
or payment history: age punishes the organizer whose wedding is next week while a patient
abuser waits; payment history caps every first-time customer on the one event they most need.

> The middleware reads **both** `partyIds` and `guestIds`. It only ever read `guestIds` — the
> campaign blaster's field name — so when that route was replaced this check fell through to
> `next()` on the only bulk path left: still mounted, still passing, enforcing nothing.

---

## 7. The organizer's dashboard, section by section

### Guests tab
Building the list. Add, import, assign tables.
- **SMS status banner** between the header and the stats: messages left, whether that covers
  the guest list *in invitations rather than segments*, and a top-up link. Four states —
  not purchased / healthy / won't cover / low or empty. Only the last two are loud.
- **Import** accepts an optional `sms_consent` column (`yes`/`no`, also `sms_ok`, `can_text`).
  When present it replaces the whole-file checkbox and reports "12 of 40 marked OK to text"
  *before* the import runs.
- The old **"Send Invitations"** button is gone. This tab builds the list; the RSVPs tab
  reaches it.

### RSVPs tab
Reaching the list. **This is where all sending lives.**
- The same SMS status banner.
- **Bulk:** tick guests → **Email invitation** / **Text invitation (74)**. The count is the
  number who can actually be texted, not the number selected.
- **Per guest:** send by email, send by text, resend confirmation, resend entry pass — four
  distinct actions, deliberately not merged. Identical on desktop rows and mobile cards.
- The text button is disabled with a reason when the guest has no consent, no number, or
  replied STOP.

### Text messages (`/dashboard/campaigns`)
Balance, history, switches. **1,546 lines became ~570** when the composer was deleted.
- **Balance card** — messages left, a meter, and coverage in invitations.
- **What sends automatically** — the four switches, plus a grouped "messages we could not
  send" summary. The organizer-alerts switch explains itself when their own number is missing.
- **Every message** — the delivery log: guest, message type (retired ones named as such),
  what happened, and a **Try again** button *only* on failures the organizer can fix.
- **Payments and usage** — the ledger.

### Texting & pricing (`/dashboard/sms-plans`)
The explanation, kept separate from the controls, because someone deciding *whether* to buy
has different questions from someone checking a balance. Real message examples rendered as
messages, a live price calculator, segments and Arabic explained in plain language, and
consent stated before the buy button. Every number is server-priced from the same model that
builds the Stripe line item.

### Event creation → payment stage
The SMS add-on card: the recommendation as a headline (not a slider default), the price, what
it covers, **"that is about 3 messages per invitation"**, and a link to the pricing page. Off
by default. Skipping it leaves every SMS control visible but **locked** with a badge — an
organizer who never sees the feature never buys it.

### Event settings → Danger Zone
**Cancel this event** now sits *above* Delete and is described first. Cancelling tells every
guest by email and text, closes the RSVP form, and keeps the records. Deleting tells nobody
and destroys everything — and now **refuses** a live event with guests unless forced.

---

## 8. The super admin's dashboard

**System Configuration → SMS Pricing.** Every value editable without a deploy.

| Control | |
|---|---|
| Carrier cost per message | `step="0.01"` — the real figure is 1.1 |
| Fancy markup % | 172.73 → a 3.0¢ list price |
| Volume discount tiers | Capped at 50%, with the break-even explained inline |
| Purchase min / max / step | Bounds on a single order |
| **Messages per invitation, by event size** | The ladder |
| **How the budget is split** | Relative weights, with each type's live share shown as a % |
| Guests per invitation, segments per message | The estimator assumptions |
| Sending limit bands | The ramp-up |
| Low-balance warning threshold | Default 20% |

Alongside them, computed **server-side by the same function that charges the customer**: a
margin header, a price table with rows either side of every discount threshold, and a
per-plan preview in both scripts. Any row that would sell **below cost is painted red** and
labelled — a loss is visible in the row that causes it, not in a monthly total three weeks later.

Bad input is **clamped, not rejected**, and what was adjusted is reported back. Rejecting the
save would leave an admin unable to fix a bad row through the UI.

**Admin → Finance → Text messaging** answers "is this a business?": revenue, carrier cost, net
profit, margin, and the heaviest events. Cost is recorded per send, so it is measured rather
than estimated.

---

## 9. Compliance — why the rules are strict

Our toll-free number is **verified** with the US carriers on the basis of specific promises.
Breaking them risks deregistration, which stops SMS for **every customer at once**.

1. **Consent is separate and optional.** Never required to RSVP, never bundled with Terms.
2. **The wording is fixed**, version-stamped on every record.
3. **Every message identifies us and carries opt-out instructions**, appended centrally:
   `- Fancy RSVP. Msg&data rates may apply. Reply STOP to opt out, HELP for help.`
4. **STOP works instantly, globally and permanently.**
5. **Every consent decision is logged append-only** — including refusals, because a dated
   refusal is evidence that consent was asked for separately and freely declined.

> Paying unlocks the *ability* to send. It does not buy permission.

---

## 10. Two behaviours worth knowing about

**Seating a guest sends NO text.** It used to: seating endpoints upserted into
`seating_notify_queue`, and a scheduler job swept rows still for 10 minutes and texted the
final table. The text was retired on request; the queue and the sweep remain and now send
only the QR **email**, which is free. So `seating_reminder` fires exactly once per guest —
from `jobEventReminders`, in the 24 hours before the event, under the `evday:` ref.

Two consequences worth holding on to. The **delay still matters** for the same reason it
always did: one drag-and-drop session on a 200-guest chart would otherwise mail a guest
moved four times four passes, three naming a table they are not sitting at. And the
**"your table has changed" wording is gone** from the templates — with a single send there
is nothing for it to contradict, and the email carries its own change wording.

**Cancellation bypasses `EMAIL_AUTOMATION_ENABLED`.** The change-notification path is gated
by that env var, which is right for an automatic broadcast nobody asked for. It is
catastrophically wrong for a cancellation: on a deployment with the flag unset, calling off
an event would tell precisely nobody, silently, while reporting success. The explicit
cancel path passes `force: true`. It is also **paginated** — the shared `LIMIT = 250` meant a
400-party event told 250 guests and left 150 never hearing anything.

---

## 11. Where things live

| Concern | File |
|---|---|
| Message type catalogue | `backend/config/smsMessageTypes.js` |
| Pricing model + validation | `backend/config/smsPricing.js` |
| Send logic (the only door) | `backend/services/smsDispatch.js` |
| Message wording | `backend/utils/smsTemplates.js` |
| Short links | `backend/utils/shortLinks.js` + `frontend/src/app/i/[code]/route.js` |
| Balance in customer terms | `backend/utils/smsUsage.js` |
| Allowance estimator | `backend/utils/smsEstimator.js` |
| Price maths | `backend/utils/pricing.js` |
| Access + send limits | `backend/middleware/smsAddonGate.js` |
| Scheduled jobs + seating sweep | `backend/services/emailScheduler.js` |
| Settings, log, resend, webhooks | `backend/controllers/campaignController.js` |
| Manual invitation send | `backend/services/invitationService.js` |
| Cancellation | `backend/controllers/eventController.js` |
| Organizer Messages page | `frontend/src/app/dashboard/campaigns/page.js` |
| Pricing explainer | `frontend/src/app/dashboard/sms-plans/page.js` |
| Admin pricing controls | `frontend/src/app/admin/(panel)/config/page.js` |

**Tables:** `sms_credit_wallets` · `sms_credit_ledger` · `sms_consent_log` · `sms_opt_outs` ·
`sms_log` · `seating_notify_queue` · `short_links` · `events.sms_settings` ·
`super_admin_config.sms_pricing_config`

**Retired but kept:** `sms_campaigns`, `sms_campaign_recipients` — read-only history.

---

## 12. Quick answers

**Can a guest be texted without agreeing?** No.

**Does a bigger plan include SMS?** No — separate purchase, available on every plan.

**Can messages move between events?** No.

**What if an organizer buys too few?** Warned at 20%, email takes over at zero, top up anytime.

**Does Arabic really cost more?** Yes, about 1.4–1.5× with short links. Carrier encoding, not
a Fancy charge.

**Do we make money on SMS?** Yes — 47–63% margin depending on order size. Never below cost.

**Can an organizer text people who never RSVP'd?** Only if they confirmed, per guest, that
they hold that person's permission — recorded, dated and attributed.

**What happens if we change the price?** Only future purchases. Existing balances are untouched.
