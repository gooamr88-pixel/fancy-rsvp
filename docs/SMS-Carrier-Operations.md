# Running two carriers, and moving between them

Text messaging can be delivered by **Twilio** or by **Vonage**. One setting decides
which. Everything the business depends on — who consented, who said STOP, what was
charged, what gets refunded — is identical either way and does not know which
carrier is live.

Companion to [`SMS-System-Reference.md`](./SMS-System-Reference.md) (what the whole
SMS system does) and [`SMS-Provider-Setup.md`](./SMS-Provider-Setup.md) (the
dashboard click-path). This document is the operational one: how to run each, how
to move between them without losing money or dropping a STOP, and what to deploy.

Status at time of writing: 720/720 backend tests pass. The Vonage code is **not yet
committed** and has **never run against the live API**.

---

## The short answer

| Question | Answer | |
|---|---|---|
| How do I switch carrier? | `SMS_PROVIDER=vonage`, then restart the API | No code change |
| Does switching need a frontend rebuild? | **No** | The carrier is invisible to the website |
| Does the new SMS system need one? | **Yes — once** | It changed the website itself |
| Can I flip it whenever I like? | **Not mid-flight** | See [§4](#4-switching-between-them-safely) |

---

## 1. Setting up each carrier

> **In plain words.** A carrier is the company that actually puts the text on the
> phone network. We are set up to use either of two. Each needs its own account
> details in the server's settings file. Filling in one does not disturb the other —
> both sets can sit there permanently, and the switch decides which gets used.

### Twilio — incumbent, default, compliance-reviewed

| | |
|---|---|
| `SMS_PROVIDER` | `twilio` — also the default if the setting is missing entirely |
| Credentials | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Number | The toll-free number from the Toll-Free Verification submission |
| Webhooks | Set `SMS_STATUS_CALLBACK_URL` and `SMS_INBOUND_WEBHOOK_URL` **explicitly** — behind nginx the auto-derived address is `http://` and the signature check fails against it |
| Signing | Always on. Nothing to configure. |
| Status | Verification still pending with Twilio |

### Vonage — new, SMS API, number applied for

| | |
|---|---|
| `SMS_PROVIDER` | `vonage` |
| Credentials | `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_FROM` |
| Number | Must list the **SMS** capability. A voice-only number accepts configuration and never delivers. |
| Webhooks | Set both in **Settings → SMS**, both **POST**, pointing at the same two URLs Twilio uses |
| Signing | **Opt-in — and required.** `VONAGE_SIGNATURE_SECRET` + `VONAGE_SIGNATURE_METHOD` |
| Account mode | Must stay on the **SMS API**, not the Messages API |

### The two webhook addresses — identical for both carriers

```
# Delivery receipts — the carrier telling us whether a message landed
https://fancyrsvp.com/api/v1/public/sms/status

# Inbound messages — this is how a guest's STOP reply reaches us
https://fancyrsvp.com/api/v1/public/sms/inbound
```

### ⚠ Vonage only — signing is not optional

Vonage leaves webhook signing **off** until you switch it on. The delivery-receipt
address triggers **automatic refunds** — a receipt saying "failed" credits the
event's balance back. Left unsigned, anyone who learns the address can post forged
failures and mint credit for free.

So the system **refuses every delivery receipt** until `VONAGE_SIGNATURE_SECRET` is
set. It fails closed, deliberately. *If failures stop being refunded after go-live,
this is almost certainly why.*

Inbound STOP behaves the **opposite** way on purpose: accepted even unsigned, with a
warning in the log. A forged inbound can only silence a number — a nuisance.
Dropping a real STOP is a legal violation. **Receipts fail closed; STOP fails safe.**

### Full settings block

```bash
# ── which carrier is live ─────────────────────────
SMS_ENABLED=true
SMS_PROVIDER=twilio            # twilio | vonage

# ── Twilio ────────────────────────────────────────
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+18XXXXXXXXX

# ── Vonage (ignored unless SMS_PROVIDER=vonage) ───
VONAGE_API_KEY=
VONAGE_API_SECRET=
VONAGE_FROM=+1XXXXXXXXXX
VONAGE_SIGNATURE_SECRET=
VONAGE_SIGNATURE_METHOD=sha256   # must match the dashboard

# ── shared by both ────────────────────────────────
SMS_STATUS_CALLBACK_URL=https://fancyrsvp.com/api/v1/public/sms/status
SMS_INBOUND_WEBHOOK_URL=https://fancyrsvp.com/api/v1/public/sms/inbound
```

**A useful safety property.** A half-configured carrier reports SMS as **disabled**
rather than half-working. If `SMS_PROVIDER=vonage` but a Vonage credential is blank,
the system does not quietly fall back to Twilio and does not accept sends it cannot
deliver — it says SMS is off. Nothing is charged in that state.

---

## 2. One message, end to end

> **In plain words.** Before any text is sent it passes a series of checks — is this
> event allowed to send, did the organizer switch this kind of message on, did this
> guest agree, did they ever reply STOP, is there a carrier available, is there
> balance. Only after all of those does money move and the message go out. The
> carrier is involved in *one* of these steps. Everything else is ours and never
> changes.

The gate chain lives in `sendTransactionalSms`
([`backend/services/smsDispatch.js`](../backend/services/smsDispatch.js)):

1. **Entitlement** — has this event bought messaging at all? *(gate ①)*
2. **The organizer's own switch** — each of the seven message types has a toggle. A
   confirmation can be on while reminders are off. *(gate ②)*
3. **Have we already sent this?** — schedulers re-run over the same rows every few
   minutes. An idempotency key makes the second pass a no-op, not a second text and
   a second charge. *(gate ③)*
4. **Who receives it, and did they agree?** — guest messages require the guest's
   consent; organizer reports go to the organizer's own number and require theirs.
   *(gate ④)*
5. **Did they ever say STOP?** — a STOP reply outranks every consent record, however
   recent, across every event. *(gate ⑤)*
6. **Write the message and count it honestly** — length is measured **after** the
   compliance footer is added, so the count charged is the count sent. Arabic costs
   more per message than English; the same measurement decides both the price and,
   on Vonage, the encoding flag. *(gate ⑥)*
7. **Carrier check → charge → send → record** — the carrier is checked **before** the
   balance is debited. *(gate ⑦)*
8. **Later — the delivery receipt.** The carrier calls back with the outcome.
   Delivered is recorded; failed refunds the balance automatically. Repeat receipts
   are harmless — the refund removes the row, so the second finds nothing.

> **Step 7's ordering is load-bearing.** Reversed, a missing carrier bills the
> organizer for a message nobody received — and it looks like success on every
> screen. Do not "simplify" it.

**Where the carrier actually appears:** only inside step 7's send and step 8's
receipt. Steps 1–6 and every rule about money, consent and suppression are
carrier-blind. That is why switching is a settings change rather than a migration —
and why a mistake in carrier code degrades to *"cannot send"* rather than *"sends
wrongly"*.

---

## 3. Where the two genuinely differ

Each of these is already handled. They are listed because when something looks
strange after a switch, the cause is usually on this list.

| | Twilio | Vonage | How it is handled |
|---|---|---|---|
| Arabic text | Detected automatically | **Must be flagged manually**, or it arrives as question marks | The flag is derived from the same measurement that bills the message, so the two can never disagree |
| A refused message | Raises an error | Returns **success** with the refusal buried inside | Every entry in the reply is inspected; a refused message is never recorded as sent or billed |
| A long message | One tracking id | **One id per part**, one receipt per part | Tracking rides on our own reference, which both carriers echo back; duplicate receipts are no-ops |
| Real cost | Not reported when sending | **Reports the actual price** | On Vonage the admin profit screen becomes measured rather than estimated |
| Webhook signing | Always on | **Off until you enable it** | Receipts are refused entirely until the secret is set — see §1 |
| Replying **STOP** | Network-level; carrier confirms it | **Network-level; carrier confirms it** | Identical. Neither carrier needs us to reply, and we never do — a second reply would double-message the guest |
| Replying **HELP** | Carrier answers it | **Not confirmed on toll-free** | We send the HELP reply ourselves on Vonage. See below |
| A number blocked after STOP | error `21610` | error `9` | Either code records an opt-out on our side too, so we stop paying to retry a number the network already blocks |
| WhatsApp alerts | Supported | **Not available** | WhatsApp is a Twilio product, outside this system |

### Why HELP is handled differently from STOP

Both are legally mandatory. They are handled differently because the carriers do.

**STOP** is enforced by the US networks on toll-free numbers. The carrier intercepts
it, blocks the number, and sends its own confirmation (*"NETWORK MSG: You replied
with the word 'stop'…"*). This is true on **both** carriers, so Fancy records the
opt-out and deliberately stays silent — replying too would send the guest two
messages for one STOP.

**HELP** is not so clear on Vonage. Vonage's keyword service (*Opt-Out Assist*) is
documented for 10DLC and short codes, is opt-in, and does not list toll-free. So
Fancy sends the HELP reply itself on Vonage, and stays silent on Twilio, whose
numbers answer HELP from their own configured response.

The asymmetry is deliberate: replying when the carrier also replies costs one
duplicate message, while not replying when nobody does is a compliance violation.
If you confirm with Vonage that they answer HELP on your number, set
`VONAGE_CARRIER_HELP=true` and Fancy will stop replying.

The HELP reply is **never billed** — it does not consume the event's messages,
does not require the paid add-on, and is sent even on a zero balance. A legally
required response cannot be something a customer can run out of.

**The one thing that does not move with the switch.** The organizer's optional
"new RSVP" **WhatsApp** alert is a Twilio product and is not part of the carrier
abstraction. It keeps reading the Twilio credentials no matter what `SMS_PROVIDER`
says. On a Vonage-only account, organizers who chose WhatsApp silently get nothing —
logged as skipped, and no guest messaging is affected. Steer them to the email or
SMS preference instead.

---

## 4. Switching between them safely

> **In plain words.** Flipping the switch is instant, and messages already in the
> air are handled correctly. Both carriers are understood **at the same time**, so a
> delivery report or a STOP reply that arrives after the switch is still read
> properly — it is matched to the carrier that actually sent it, not to whichever
> one is configured at that moment.

### How that works, and why it matters

Delivery reports and STOP replies arrive minutes to hours after a message goes out,
and a carrier retries a failed callback for hours more. Each incoming report is
identified by its **own shape** and verified against **that** carrier's credentials
(`resolveWebhookProvider` in
[`services/smsProviders/index.js`](../backend/services/smsProviders/index.js)).
Twilio and Vonage share no webhook field names, so the two are unambiguous.

Without this, flipping the switch would lose money and break the law: an old-carrier
failure report would be rejected, so the organizer would never be credited back for
a message that never arrived — and an old-carrier STOP would arrive in an
unrecognised shape and be silently discarded.

> **Identifying a report never trusts it.** Routing decides *which* signature check
> runs; it never skips one. A report shaped like a carrier whose credentials are not
> configured is **refused**, not accepted — otherwise anyone who learned the URL
> could forge a failure and mint credit.

### The switch sequence

- [ ] **Confirm the new carrier is fully configured first** — all three credentials
      plus the signature secret. A blank one means SMS reports as disabled the
      moment you flip.
- [ ] **Flip the setting and restart the API.** The change takes effect immediately
      on restart — the setting is read fresh on every send, not cached at boot.
- [ ] **Keep the old carrier's credentials in place.** They are what let its late
      delivery reports and STOP replies keep being verified. Removing them turns
      those into refusals.
- [ ] **Keep the old number alive and receiving for a while.** Do not release it the
      same day; guests with the old number saved may still reply STOP to it.
- [ ] **Update the Privacy Policy** if the set of carriers changed. It names the SMS
      providers to customers — a legal statement, not a label. See §6.
- [ ] **Run the four go-live checks** (§7), especially the refund one, which is what
      proves signing is configured.

**Rolling back.** `SMS_PROVIDER=twilio` + restart reverts instantly, with no code and
no database change. The same drain caution applies in reverse.

---

## 5. The database work

> **In plain words.** The database needs new tables and columns before any of this
> works. They are bundled into a single script you paste into the Supabase SQL
> editor, plus a second script that checks the first one worked. Running them twice
> is harmless. **None of this is carrier-specific** — the same database serves both.

```
# The SMS schema now lives ONLY in the migration chain. Apply it the same way
# as any other migration — the bundled APPLY_SMS_SCHEMA.sql was deleted on
# 2026-09-10 because it was generated verbatim from those same files, and a
# second copy of the same DDL is a second thing to keep in step.
supabase/migrations/20260809000000_sms_compliance.sql   … onwards

# Then paste this and confirm every row says "ok":
supabase/checks/check_sms_schema.sql      # 25 objects verified
```

| Step | Migration | What it adds |
|---|---|---|
| 1 | `20260809 sms_compliance` | The STOP suppression list |
| 2 | `20260810 sms_optin_submissions` | Records from the public opt-in form |
| 3 | `20260811 sms_consent_log` | Audit trail of who agreed, when, and how |
| 4 | `20260812 host_sms_consent_attestation` | The organizer confirming they obtained permission |
| 5 | `20260818 sms_addon` | Message log, per-event settings, the paid add-on |
| 6 | `20260819 sms_pricing_config` | Admin-controlled pricing, margin, volume discounts |
| 7 | `20260820 sms_usage_and_limits` | Real cost tracking, balance alerts, send limits, analytics |
| 8 | `20260821 organizer_optin_and_perf` | Organizer opt-in provenance, guest language, bank-transfer messages, fast skip counts |
| 9 | Backfill | Fills in pricing keys added after an earlier apply |

### ⚠ Do not skip step 8

Step 8 adds a column the payment system writes on **every manual (bank transfer)
payment** — not just SMS ones
([`paymentController.js:1687`](../backend/controllers/paymentController.js#L1687)).
An installation missing it does not merely lose SMS features: **bank-transfer
checkout fails outright.** Since bank transfer is the only payment route while card
payments are switched off, this is the highest-impact item in the list.

The bundled script had drifted out of sync and was missing exactly this column. It
has been corrected, and the verification script now checks all of step 8 rather than
stopping at step 7.

---

## 6. Rebuild and deploy

> **In plain words.** There are two separate questions hiding in "do I need to
> rebuild". Changing carrier does not touch the website, so no. Publishing the new
> SMS system *does* change the website, so yes — once. Mixing these up is why a
> deploy can appear to have done nothing.

| What you are doing | Database | API restart | Frontend build |
|---|---|---|---|
| Switching carrier | No | **Yes** | **No** |
| Publishing the new SMS system | **Yes** — §5 | **Yes** | **Yes** |
| Correcting the Privacy Policy after a switch | No | No | **Yes** |

**Why the carrier switch needs no build.** The website contains no reference to
`SMS_PROVIDER`, and none of the carrier settings are published to the browser. The
carrier is entirely server-side, so restarting the API is the whole operation.

**The trap that makes a deploy look like it did nothing.** The website is served
from a **pre-built** copy. Pulling the code and restarting the process does **not**
update it — the build step produces what visitors actually see. A frontend change
without a build is invisible, with no error anywhere to explain why.

### Publishing the SMS system

```bash
# 1 · database — Supabase SQL editor
apply the SMS migrations from supabase/migrations/, then paste
supabase/checks/check_sms_schema.sql and confirm every row says "ok"

# 2 · code
git pull

# 3 · frontend — the step that is easy to forget
cd frontend && npm run build

# 4 · restart both processes
pm2 restart all
```

### ⚠ Legal text names the carrier — check before switching

Three customer-facing places name Twilio explicitly, two of them in the **Privacy
Policy**, which states that the only parties receiving mobile numbers are the event
host and *"our SMS delivery infrastructure provider (currently Twilio, Inc.)"*.
Switching to Vonage makes that statement factually untrue about who processes
customer phone numbers.

- `frontend/src/app/privacy/page.js` (lines 48, 61)
- `frontend/src/app/sms-opt-in/page.js` (line 293)

Update them and rebuild the frontend. Two admin-only labels also say "Twilio cost"
and are merely cosmetic.

---

## 7. Proving it actually works

Four checks, in this order. **The third is the important one** — it is the only
thing that proves signing is configured, and signing is what protects the money.

- [ ] **Send one message to a consenting guest.** The message log shows *Delivered*,
      and the balance drops by the right number.
- [ ] **Reply STOP from that handset.** The number joins the suppression list, and a
      second send is skipped with "They replied STOP".
- [ ] **Send to an invalid number.** It shows as not delivered and the balance is
      **refunded automatically**. If not, the signature secret is missing or the hash
      does not match the dashboard.
- [ ] **Send one Arabic message.** It arrives readable, not as question marks. This
      catches a missing encoding flag on Vonage.

### If something is wrong

| Symptom | Cause |
|---|---|
| Nothing sends; log says transport unavailable | A credential for the *selected* carrier is missing. Nothing is charged in this state. |
| Messages send, but failures never refund | Delivery receipts are being refused. Set `VONAGE_SIGNATURE_SECRET`, or the hash does not match `VONAGE_SIGNATURE_METHOD`. |
| STOP replies are ignored | The inbound webhook is not configured, or is set to GET instead of POST. |
| Arabic arrives as `???` | The Vonage account was switched to the Messages API. It must stay on the SMS API. |
| Bank transfer checkout errors | Migration step 8 was not applied. See §5. |
| A frontend change is invisible | No frontend build was run. See §6. |

---

## 8. What this makes possible next

The point of separating the carrier from everything else was never Vonage
specifically. It was to stop the business logic depending on any one supplier.

### Available now, as a consequence

- **Commercial leverage.** Two live accounts means pricing can be negotiated against
  a credible alternative, and a carrier outage or a rejected verification stops
  being an existential problem for the product.
- **Measured profit instead of estimated.** Vonage reports what each message
  actually cost, so the admin profit screen stops assuming a rate.
- **A third carrier is one file.** Adding another supplier means implementing the
  same small set of functions — send, verify, read a receipt, read an inbound.
  Nothing above it changes.

### Possible, but deliberately not built

Stated plainly so nobody assumes they exist:

- **Automatic failover.** If a carrier goes down, someone changes the setting and
  restarts. There is no automatic retry on the other carrier.
- **Per-country routing.** One carrier serves everyone. Choosing the cheaper carrier
  per destination is achievable on this structure but is not implemented.
- **Running both at once.** The setting is single-valued by design.
- **WhatsApp on Vonage.** WhatsApp remains Twilio-only.

---

## Known limits of this work

Stated directly, because a handover document that only lists strengths is not useful.

- **Vonage has never spoken to Vonage.** Its 23 tests simulate the network and check
  that the requests we build match the published specification. That catches a wrong
  field name; it cannot catch a wrong assumption about the real service. The four
  checks in §7 are the genuine verification.
- **The frontend has not been compiled.** No build toolchain is installed locally, so
  the website code has been verified by reading and targeted checks, not a compiler.
- **The Vonage code is not yet committed.** It exists in the working directory only.
- **Currency is not normalised.** Carriers report cost in their own account currency.
  If the two accounts bill in different currencies, profit figures are not directly
  comparable across a switch.
- **Twilio verification is still pending**, which is the situation that prompted all
  of this.
