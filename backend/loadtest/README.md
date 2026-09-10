# Load Testing — Fancy RSVP

Measures how the API copes with **100 / 500 / 1000 / 5000** simultaneous users,
finds the breaking point, and pinpoints what to fix before launch.

> ## ⚠️ READ THIS BEFORE YOUR FIRST RUN (updated 2026-09-10)
>
> This harness was written 2026-06-19 and **had never been executed** — `results/`
> contained only `TEMPLATE.md`. Two things had drifted underneath it since, and
> both have now been repaired in `lib/`:
>
> 1. **`smsConsent` became mandatory** (2026-09-04). Without it every attending
>    RSVP is rejected with `400 SMS_CONSENT_REQUIRED` before the request reaches
>    the database — you would have measured a validation branch.
> 2. **Every guest sent the same phone number.** `guests` is unique on
>    `(event_id, phone) WHERE is_primary_contact`, so from the second submission
>    onward `submit_rsvp_v2` answered `PHONE_ALREADY_REGISTERED` → 409 — which
>    the journey counted as an expected duplicate and forgave. **The run would
>    have gone green having written one row**, never reaching the advisory lock,
>    the cascade deletes or the guest-cap count. A new `rsvp_written` rate with a
>    `rate>0.95` threshold now makes that failure impossible to mistake for a pass.
>
> Numbers below are only meaningful if **`rsvp_written` is ≥ 0.95** in the summary.
> If it is low, you measured rejections, not throughput — fix the cause and rerun.
>
> **Phone numbers repeat between runs.** Either clear the load-test rows or pass
> a fresh `-e PHONE_SALT=<n>` each time:
>
> ```sql
> -- Removes only rows this harness created, from the demo event.
> DELETE FROM rsvp_parties p
>  USING events e, guests g
>  WHERE e.slug = 'demo' AND p.event_id = e.id
>    AND g.party_id = p.id AND g.email LIKE 'lt\_%@loadtest.example';
> ```
>
> **Already fixed since this file's "bottlenecks" list was written** — do not go
> chasing these: #2 (per-write Realtime channel → now REST broadcast in
> `utils/realtime.js`), #4 (`instances: 'max'`, `max_memory_restart: 1G`), #8
> (`compression()` is mounted in `app.js`). #1 is partly done — the RSVP write is
> one `submit_rsvp_v2` RPC now, though the handler still makes a few surrounding
> round trips. #5, #6 and #7 are still open and are the ones worth reading.

## Tool choice: **k6** (recommended)

| | k6 ✅ | Locust | Artillery |
|---|---|---|---|
| Script language | **JavaScript** (matches your stack) | Python | YAML/JS |
| Engine / footprint | Go — one process drives **thousands** of VUs | Python — needs many workers for 5k | Node — heavier per VU |
| p95/p99 + pass/fail thresholds | **native** | add-ons | partial |
| CI fit | first-class (`--summary-export`, exit codes) | ok | ok |

Your team already writes JS, so k6 scripts are maintainable in-house, and a single k6 box reaches 5000 VUs (Locust would need a worker fleet).

---

## 0. Prerequisites (do these or your numbers will be wrong)

1. **Install k6** — `winget install k6` / `choco install k6` (Win), `brew install k6` (mac), or apt (Linux). Docs: <https://k6.io/docs/get-started/installation/>.
2. **Test against a STAGING instance that mirrors prod** (same DB plan, `NODE_ENV=production`). Never load test prod or against real Stripe/Twilio/Brevo.
3. **⚠️ Disable the rate limiter for the load box** — [app.js](../app.js) caps **1000 req / 15 min per IP** globally and **15 / 15 min** on auth. A single k6 box is one IP, so it would be throttled (429s) within seconds and you'd measure the limiter, not the app. This is now built in: start the API with **`DISABLE_RATE_LIMIT=true`** for the load environment (never in production). For multi-instance prod, set **`REDIS_URL`** so the limit is shared across workers (`npm i ioredis rate-limit-redis`).
4. **Seed a public, live `demo` event.** The guest journey targets slug `demo`, which bypasses the payment/review gate in `submitPublicRSVP`. Ensure it's `privacy_mode='public'` (or pass a password). For organizer/checkout runs, create a load-test organizer account and pass `ORG_EMAIL/ORG_PASSWORD/EVENT_ID`.
5. **Start the server-side monitors** before each level (below).

---

## 1. Smoke first (always)

```bash
cd backend/loadtest
k6 run -e BASE_URL=http://STAGING:5000 -e SLUG=demo scripts/smoke.js
```
All checks should pass. If RSVP returns 402/403, the demo event isn't live/public.

## 2. Run the four concurrency levels

Guest path (the critical high-volume one). Repeat for each level, capturing a summary file:

```bash
# 100
k6 run -e BASE_URL=http://STAGING:5000 -e SLUG=demo -e LEVEL=100 \
  --summary-export results/guest-100.json scripts/guest-journey.js

# 500
k6 run -e BASE_URL=http://STAGING:5000 -e SLUG=demo -e LEVEL=500 \
  --summary-export results/guest-500.json scripts/guest-journey.js

# 1000
k6 run -e BASE_URL=http://STAGING:5000 -e SLUG=demo -e LEVEL=1000 \
  --summary-export results/guest-1000.json scripts/guest-journey.js

# 5000  (see "Generating 5000 VUs" below)
k6 run -e BASE_URL=http://STAGING:5000 -e SLUG=demo -e LEVEL=5000 \
  --summary-export results/guest-5000.json scripts/guest-journey.js
```

Mixed realistic traffic (guests + a small organizer population):

```bash
k6 run -e BASE_URL=http://STAGING:5000 -e SLUG=demo -e LEVEL=1000 \
  -e ORG_EMAIL=loadtest@you.com -e ORG_PASSWORD='Secret123!' -e EVENT_ID=<uuid> \
  --summary-export results/mixed-1000.json scripts/mixed-load.js
```

Auth-focused (find where PBKDF2 logins melt CPU):

```bash
k6 run -e BASE_URL=http://STAGING:5000 -e LEVEL=200 \
  -e ORG_EMAIL=loadtest@you.com -e ORG_PASSWORD='Secret123!' \
  scripts/organizer-journey.js
```

Each run prints `t_browse`, `t_rsvp_submit`, `t_login`, … trends with `avg/p95/p99`,
plus `http_req_failed`. Threshold breaches make k6 exit non-zero (good for CI gates).

### Generating 5000 VUs
- 5000 VUs needs RAM/FDs on the **generator**: `ulimit -n 250000`, ~4+ vCPU / 8 GB.
- If one box can't, shard it: run the same script on N machines at `LEVEL=5000/N`, or use **k6 Cloud** / Grafana Cloud k6 for distributed execution.
- Watch the generator's own CPU — if k6 is saturated, latencies are inflated by the *client*, not your API.

## 3. While each level runs — capture server + DB

Server CPU/mem (on the API host):
```bash
INTERVAL=1000 OUT=results/sys-1000.csv node monitor/sampler.js
pm2 monit            # per-process CPU/mem + restart count
```
Database (against the DB):
```bash
psql "$DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
psql "$DB_URL" -c "SELECT pg_stat_statements_reset();"   # right before the steady window
psql "$DB_URL" -f monitor/db_monitor.sql                 # snapshot; or wrap a query in \watch 2
```

## 4. Record results
Copy [results/TEMPLATE.md](results/TEMPLATE.md) to `results/run-<date>.md` and fill the matrices.
`k6` JSON summaries (`results/*.json`) hold the exact `avg/p95/p99/count` per metric.

---

## What you'll most likely find — bottlenecks (specific to this codebase)

Ordered by expected impact. File references are real.

### 🔴 1. Every query is an HTTP round-trip to PostgREST + the Supavisor pooler
The backend uses the **Supabase JS client with the service-role key** ([config/supabase.js](../config/supabase.js)); each `.from()/.rpc()` is an HTTPS call through the connection pooler — not a local pooled PG socket. The hot write path `submitPublicRSVP` ([rsvpController.js](../controllers/rsvpController.js)) makes **~8–12 sequential round-trips** per RSVP (event fetch → meal field → duplicate check → insert rsvp → insert guests → custom answers → activity log → realtime → org fetch → emails). Latency = sum of all of them, and concurrency multiplies pooler connections.
**Fixes:** (a) collapse the multi-step write into **one `submit_rsvp()` plpgsql RPC** (atomic + a single round-trip); (b) `Promise.all` the genuinely independent reads; (c) ensure Supavisor is in **transaction** mode with an adequately sized pool; (d) for the hottest endpoints, consider a direct `pg` pool.

### 🔴 2. A Realtime channel is opened **per write**
`submitPublicRSVP`, `addGuestManually`, check-in, and all seating handlers do `supabase.channel('event-'+id').send(...)` then `removeChannel(...)` on **every** request. Standing up a broadcast connection per request is slow and churns sockets under load.
**Fixes:** use the **REST broadcast** endpoint (`POST /realtime/v1/api/broadcast`) instead of opening a channel; or maintain a small pool of long-lived channels; or drop server-side broadcast and let clients subscribe to Postgres changes directly.

### 🟠 3. PBKDF2 600k iterations on the libuv threadpool
`hashPassword/verifyPassword` ([authController.js](../controllers/authController.js)) run PBKDF2-SHA512 ×600k (~80–150 ms CPU each). `crypto.pbkdf2` uses the libuv threadpool (**default size 4**), so the 5th+ concurrent login **queues**. A burst of logins serializes and `t_login` p99 explodes.
**Fixes:** set **`UV_THREADPOOL_SIZE`** (e.g. 8–16) to match cores; consider **argon2id** with tuned memory/time; the existing auth rate-limit already caps abuse. Logins aren't the high-volume path, but spikes hurt — keep it off the guest hot path (it already is).

### 🟠 4. pm2 `max_memory_restart: 500M`, `instances: 2`
[ecosystem.config.js](../../ecosystem.config.js) restarts a worker at **500 MB** — under load (10k-row exports via exceljs in `exportGuestsExcel`, 5 MB JSON body limit, large RSVP lists) a worker can cross 500 MB and **restart mid-test**, dropping in-flight requests (shows as a 502 burst + RPS dip).
**Fixes:** raise the ceiling (e.g. 1–1.5 GB), set **`instances: 'max'`** (one per vCPU) for real horizontal capacity, and **stream** exports instead of buffering 10k rows.

### 🟠 5. In-memory rate limiter across a cluster
`express-rate-limit` defaults to **MemoryStore**, which is **per-worker** — with `instances: 2` the limit is effectively doubled and inconsistent, and resets on restart.
**Fixes:** back it with **Redis** (`rate-limit-redis`) so the limit is global and survives restarts; tune per-route.

### 🟡 6. Full-table reads + in-Node aggregation on dashboards
`getEventStats` ([eventController.js](../controllers/eventController.js)) fetches `rsvps` **twice** and aggregates in JS; `getRSVPs` ([rsvpController.js](../controllers/rsvpController.js)) pulls a page then **post-filters** seated/meal/custom in Node and runs a **3-query fallback chain**; exports pull up to **10 000 rows** into memory.
**Fixes:** push aggregation into SQL (an RPC like the existing `get_seating_summary`); drop the fallback chain on the hot path once the schema is settled; paginate/stream exports.

### 🟡 7. `super_admin_config` re-read on every payment/SMS op
`createCheckoutSession`, `purchaseSMSCredits`, `initiateManualPayment` ([paymentController.js](../controllers/paymentController.js)) each read the singleton config row.
**Fix:** cache it in-process with a short TTL (mirror the pattern in [services/rbacService.js](../services/rbacService.js)); invalidate on `updatePricingConfig`.

### 🟡 8. No response compression / keep-alive tuning
No `compression` middleware in [app.js](../app.js); large JSON (event lists, RSVP lists) ships uncompressed.
**Fix:** add `compression()` (watch CPU trade-off) and confirm keep-alive on the proxy/LB.

---

## Expected shape & launch guidance
- **Reads (browse/search)** scale well — expect ✅ at 100/500, ⚠️ around 1000 depending on DB plan.
- **RSVP submit** is the first to bend because of #1/#2 (many round-trips + a channel open each). This is the most likely **breaking point between 500 and 1000** concurrent submitters on a modest instance.
- Implementing **#1 (single submit RPC)** and **#2 (REST broadcast)** typically moves the breaking point up several-fold and flattens p99 — do those two before launch, then re-run this suite to confirm the matrix improved.

> CI: thresholds in [lib/common.js](lib/common.js) make k6 exit non-zero on breach, so you can wire a nightly `LEVEL=500` guest run as a performance regression gate.
