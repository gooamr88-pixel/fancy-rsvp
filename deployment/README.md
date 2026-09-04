# Hostinger VPS Production Deployment Guide

This guide details the step-by-step process to deploy the **Fancy RSVP** platform on your Hostinger Linux VPS (Ubuntu server) with domain `fancyrsvp.com`.

---

## 🔁 Deploying a Code Update (do this every time, not just on first setup)

`git pull` + `pm2 restart` is **not enough** for frontend changes. The frontend
runs via `next start`, which serves a pre-built `.next/` folder — it does not
compile source on the fly. `pm2 restart` only restarts the Node process
against whatever `.next/` build already exists; skipping the build step means
your frontend changes never actually go live, no matter how many times you
redeploy. (The backend has no build step, so `git pull` + `pm2 restart
fancy-rsvp-backend` alone is fine for backend-only changes.)

From the project root on the server:
```bash
git pull
npm install
npm run build --workspace=frontend
pm2 restart ecosystem.config.js
```

Or simply run the script that does exactly this:
```bash
bash deployment/redeploy.sh
```

---

## 🛠️ Step 1: Install Server Prerequisites

Connect to your Hostinger VPS via SSH and run the following commands to install Node.js, PM2, Nginx, and Certbot:

```bash
# 1. Update system package index
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js (Version 22 LTS — matches the version CI runs and tests against)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Verify installations
node -v  # Should show v22.x.x
npm -v   # Should show v10.x.x

# 4. Install PM2 globally (Process Manager)
sudo npm install pm2 -g

# 5. Install Nginx (Web Server)
sudo apt install nginx -y

# 6. Install Certbot for free SSL certificates (Let's Encrypt)
sudo apt install certbot python3-certbot-nginx -y
```

---

## 💾 Step 2: Set Up Production Supabase Database

1. Go to your **Supabase Dashboard** and create a new project.
2. **Do NOT run `schema.sql` directly** — the migrations contain the complete schema with hardened RLS policies.

> **Migrations go BEFORE the app is restarted, not after.** On an existing
> install, apply any new migration first, then `git pull` + rebuild + restart.
> `20260818000000_tier_identity.sql` is the current example: it must be applied
> **before** anyone renames a pricing plan, because its backfill matches events
> to plans by display name one last time — after a rename that information is
> gone and those events cannot be reattached automatically. (The app tolerates
> the columns being absent and falls back to the old name matching, so a
> mis-ordered deploy is not an outage — but the backfill window closes for good
> the first time a plan is renamed.)
3. Apply the migration files (found in `supabase/migrations/` folder) by copy-pasting their SQL code into the SQL Editor, in chronological order, to ensure the production schema is fully up to date. This list must be regenerated from `ls supabase/migrations/ | sort` before every deploy — it silently fell ~39 files behind the repo once before, so treat "matches `ls supabase/migrations/`" as the actual source of truth, not this file:
   - `20260607000000_init_schema.sql`
   - `20260607100000_schema_completion.sql`
   - `20260607100001_rls_hardening.sql`
   - `20260607100002_qa_stress_test_fixes.sql`
   - `20260609000000_sms_ledger_idempotency.sql`
   - `20260610000000_auth_otp.sql`
   - `20260610100000_security_hardening.sql`
   - `20260610200000_performance_indexes.sql`
   - `20260610300000_cleanup_stored_functions.sql`
   - `20260611000000_rls_security_fix.sql`
   - `20260611000001_missing_rpc_functions.sql`
   - `20260611100000_search_path_hardening.sql`
   - `20260611200000_audit_fixes.sql`
   - `20260611300000_registration_otp.sql`
   - `20260612_add_template_data.sql`
   - `20260614000000_update_unassign_seat.sql`
   - `20260615000000_prd_updates.sql`
   - `20260615100000_notification_preferences.sql`
   - `20260615200000_event_qr_persistence.sql`
   - `20260615300000_seating_force_override.sql`
   - `20260615400000_rls_pii_lockdown.sql`
   - `20260616000000_seating_elements_scale.sql`
   - `20260616100000_atomic_sms_purchase.sql`
   - `20260616200000_party_size_bound.sql`
   - `20260616300000_manual_payment_methods.sql`
   - `20260617000000_field_type_expansion.sql`
   - `20260618000000_event_review_gate.sql`
   - `20260618100000_rsvp_email_invitations.sql`
   - `20260619000000_rbac_foundation.sql`
   - `20260619010000_sessions_security.sql`
   - `20260619020000_admin_audit.sql`
   - `20260619040000_subscriptions.sql`
   - `20260619050000_credit_packages.sql`
   - `20260619120000_payment_refunds.sql`
   - `20260619130000_overview_finance.sql`
   - `20260620000000_submit_rsvp_rpc.sql`
   - `20260624000000_event_plan_tier.sql`
   - `20260625000000_email_automation.sql`
   - `20260626000000_sms_multi_credit.sql`
   - `20260627000000_sms_campaign_jobs.sql`
   - `20260628000000_sms_delivery_reconcile.sql`
   - `20260629000000_submit_rsvp_reject_resubmit.sql`
   - `20260701000000_submit_rsvp_caps_limits.sql`
   - `20260702000000_feature_payment_gate.sql`
   - `20260703000000_finance_rollup_fix.sql`
   - `20260704000000_submit_rsvp_phone_dedupe.sql`
   - `20260705000000_guest_experience_rebuild.sql`
   - `20260706000000_submit_rsvp_auto_merge.sql`
   - `20260707000000_profile_branding.sql`
   - `20260708000000_event_comp_reason.sql`
   - `20260708000001_landing_stats.sql`
   - `20260709000000_submit_rsvp_concurrency_fix.sql`
   - `20260709000001_lockdown_super_admin_config_rls.sql`
   - `20260710000000_submit_rsvp_custom_answer_validation.sql`
   - `20260711000000_companion_detail_fields.sql`
   - `20260712000000_tier_watermark_and_limits.sql`
   - `20260713000000_get_event_parties_rpc.sql`
   - `20260714000000_guest_side_tagging.sql`
   - `20260715000000_remove_companion_detail_fields.sql`
   - `20260716000000_update_party_response_guest_cap.sql`
   - `20260717000000_admin_revenue_consistency_fix.sql`
   - `20260718000000_rsvp_sms_consent.sql`
   - `20260719000000_marketing_forms.sql`
   - `20260720000000_seating_party_lock_fix.sql`

---

## 📂 Step 3: Deploy Project Files & Environment Configurations

1. Copy or clone your repository to the server, for example in `/var/www/fancy-rsvp`.
2. Configure your Express backend environment variables:
   - Create the file `/var/www/fancy-rsvp/backend/.env`:
     ```env
     PORT=5000
     NODE_ENV=production
     FRONTEND_URL=https://fancyrsvp.com
     JWT_SECRET=your_strong_jwt_signing_key_here
     QR_JWT_SECRET=your_strong_qr_signing_key_here

     # Remote Supabase Credentials
     SUPABASE_URL=https://your-supabase-project.supabase.co
     SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

     # Stripe Credentials (Live or Test)
     STRIPE_SECRET_KEY=sk_live_...
     STRIPE_WEBHOOK_SECRET=whsec_...

     # Twilio Credentials (SMS)
     TWILIO_ACCOUNT_SID=AC...
     TWILIO_AUTH_TOKEN=...
     TWILIO_PHONE_NUMBER=...

     # Email Credentials (Brevo)
     BREVO_API_KEY=xkeysib-...
     BREVO_FROM_EMAIL=info@fancyrsvp.com
     BREVO_FROM_NAME="Fancy RSVP"

     # Lifecycle messaging — REQUIRED for guests to be reminded at all.
     # Master switch for every automatic message: the day-before reminder
     # (table + venue + QR entry pass, by email AND SMS), RSVP chasers, the
     # organizer's final headcount, post-event thank-yous, and change notices.
     # Unset, the scheduler no-ops silently — nothing errors, nothing retries,
     # and the first symptom is a guest arriving without their table.
     EMAIL_AUTOMATION_ENABLED=true
     ```

   > **Check this one after every deploy.** It was missing from this template
   > for a long time, so an install that followed these steps had lifecycle
   > messaging off. To confirm it is on:
   > ```bash
   > pm2 logs fancy-rsvp-backend --lines 200 | grep email-scheduler
   > # want: "[email-scheduler] enabled — full sweep every 15 min"
   > # bad:  "[email-scheduler] DISABLED — no automatic guest messages…"
   > ```

   > ### ⚠️ `EVENT_PURGE_ENABLED` — leave it OFF unless you mean it
   >
   > This one **permanently deletes customer data**. With it on, every event is
   > wiped 24 hours after it finishes: guests, RSVPs, seating, check-in records,
   > message history and the public guest page. There is no undo and no backup
   > we can restore from. The organizer is emailed a warning with a spreadsheet
   > download link first, and the 24-hour clock starts when that email goes out.
   >
   > It is opt-in for that reason — unlike `DRAFT_CLEANUP_ENABLED`, which only
   > removes never-launched placeholder rows. Add it **only** when the retention
   > policy has actually been decided:
   > ```env
   > EVENT_PURGE_ENABLED=true
   > # PURGE_GRACE_HOURS=24              hours between the warning and the delete
   > # PURGE_ASSUMED_DURATION_HOURS=6    used when an event has no end time set
   > # PURGE_ALLOW_OPT_OUT=true          offer a "keep my data" link in the email
   > ```
   > To confirm which state you are in:
   > ```bash
   > pm2 logs fancy-rsvp-backend --lines 200 | grep event-purge
   > # off:  "[event-purge] disabled — no event data will be deleted."
   > # on:   "[event-purge] ENABLED — … ALL of its data is permanently deleted 24h later."
   > ```
3. Configure your Next.js frontend environment variables:
   - Create the file `/var/www/fancy-rsvp/frontend/.env.production`:
     ```env
     NEXT_PUBLIC_API_URL=https://fancyrsvp.com/api/v1
     ```

---

## 🏗️ Step 4: Install Dependencies & Build Frontend

From the root project folder `/var/www/fancy-rsvp`, execute:

```bash
# 1. Install all backend and frontend node modules
npm install

# 2. Build the Next.js optimized production package
npm run build --workspace=frontend
```

---

## 🚀 Step 5: Start Applications with PM2 Process Manager

Use the root `ecosystem.config.js` to spawn and manage frontend and backend processes daemonized in the background:

```bash
# 1. Start both servers
pm2 start ecosystem.config.js

# 2. Verify both processes are online
pm2 status

# 3. Set up PM2 to automatically restart processes on server reboots
pm2 startup
# (Copy and paste the command output by PM2 startup to finalize system integration)

# 4. Save current PM2 configuration list
pm2 save
```

*To check logs in real-time, you can run:*
```bash
pm2 logs
```

---

## 🌐 Step 6: Configure Nginx & Let's Encrypt SSL

1. Create a server configuration file for Nginx:
   ```bash
   sudo nano /etc/nginx/sites-available/fancy-rsvp
   ```
2. Paste the configuration from the local file `deployment/nginx.conf` (replacing `fancyrsvp.com` with your active domain details). Save and exit.
3. Enable the configuration by symlinking:
   ```bash
   sudo ln -s /etc/nginx/sites-available/fancy-rsvp /etc/nginx/sites-enabled/
   ```
4. Test and reload Nginx:
   ```bash
   sudo nginx -t # Ensure configuration syntax is ok
   sudo systemctl restart nginx
   ```
5. Install SSL certificates via Certbot:
   ```bash
   sudo certbot --nginx -d fancyrsvp.com -d www.fancyrsvp.com
   ```
   *Certbot will automatically verify ownership, generate the SSL certificate, set up auto-renewal cron tasks, and modify your Nginx file to handle HTTP -> HTTPS redirects.*

---

## 🔒 Step 7: Configure Stripe Webhook Endpoint

Now that your production server is live on `https://fancyrsvp.com`, configure the Stripe Webhook:
1. Go to your **Stripe Dashboard** -> **Developers** -> **Webhooks**.
2. Click **Add endpoint** and enter:
   `https://fancyrsvp.com/api/v1/payments/webhook`
3. Listen for **exactly these 5 events** — the only types the handler acts on (see `docs/Stripe-Live-Migration.md` §2.3 for the full rationale). Subscribing to `payment_intent.succeeded` instead of/alongside these is a no-op for this app and omitting the dispute events silently drops refund-dispute handling in production:
   - `checkout.session.completed`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`
4. Copy the webhook secret (`whsec_...`) and update the `STRIPE_WEBHOOK_SECRET` variable in `/var/www/fancy-rsvp/backend/.env`.
5. Restart your backend PM2 process to apply the new secret:
   ```bash
   pm2 restart fancy-rsvp-backend
   ```

## 📱 Step 8: Configure Twilio Webhooks (SMS compliance)

Both webhooks are signature-verified server-side and safe to expose publicly.
In the **Twilio Console → Phone Numbers → your toll-free number → Messaging configuration**:

1. **A message comes in** (inbound webhook — records STOP/UNSUBSCRIBE/CANCEL/END/QUIT
   opt-outs into the `sms_opt_outs` suppression table, which every send path enforces):
   `https://fancyrsvp.com/api/v1/public/sms/inbound`   (HTTP POST)
2. **Status callback URL** (delivery receipts — auto-refunds undelivered credits). Also set
   `SMS_STATUS_CALLBACK_URL` in `backend/.env` to the same value:
   `https://fancyrsvp.com/api/v1/public/sms/status`   (HTTP POST)
3. Toll-free **STOP/UNSTOP handling is network-level and cannot be disabled or
   customized** — the carrier sends the mandated STOP confirmation itself, and the
   app deliberately never auto-replies (avoids double-messaging). Twilio still
   forwards the STOP message to the inbound webhook above, which records it.
   HELP receives Twilio's default auto-response and is NOT forwarded to the
   webhook. Do **not** create a Messaging Service to customize HELP text — this
   codebase sends directly from the number and uses no Messaging Service.
4. The migration `20260809000000_sms_compliance.sql` must be applied before these
   webhooks can record anything (see Step 2's migration order note).
5. TFV note: the opt-in URL for Toll-Free Verification submissions is
   `https://fancyrsvp.com/sms-opt-in`, and `TWILIO_PHONE_NUMBER` in `backend/.env`
   must be the verified **toll-free** number.
