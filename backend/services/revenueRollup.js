/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DAILY REVENUE ROLLUP REFRESHER (Financial Command Center §22)
 *
 * The Financial Command Center (GET /admin/finance/summary) reads the
 * mv_daily_revenue materialized view. A materialized view does not update on its
 * own — without a periodic REFRESH it stays frozen at creation time (empty on a
 * fresh database). This dependency-free interval refresher keeps it current.
 *
 * Safety / behaviour (mirrors smsCampaignWorker / emailScheduler):
 *   • ON by default — the refresh is read-only/idempotent and harmless. Set
 *     REVENUE_ROLLUP_ENABLED=false to disable.
 *   • Single-leader: in a pm2 cluster only instance 0 schedules.
 *   • Best-effort: a failed refresh logs a warning and never crashes the server.
 *   • Re-entrancy guarded so a slow refresh can't overlap itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

let running = false;

/** Refresh mv_daily_revenue once. Resolves regardless of success (best-effort). */
async function runOnce(trigger = 'interval') {
  if (running) {
    logger.info('[revenue-rollup] previous refresh still in progress — skipping');
    return { ok: false, skipped: true };
  }
  running = true;
  const t0 = Date.now();
  try {
    const { error } = await supabase.rpc('refresh_daily_revenue');
    if (error) throw error;
    logger.info({ ms: Date.now() - t0, trigger }, '[revenue-rollup] mv_daily_revenue refreshed');
    return { ok: true };
  } catch (err) {
    logger.warn({ err, trigger }, '[revenue-rollup] refresh failed (non-fatal)');
    return { ok: false, error: err };
  } finally {
    running = false;
  }
}

let timer = null;
function start() {
  if (process.env.REVENUE_ROLLUP_ENABLED === 'false') {
    logger.info('[revenue-rollup] disabled via REVENUE_ROLLUP_ENABLED=false');
    return;
  }
  // Single-leader in a pm2 cluster: only instance 0 schedules.
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') {
    logger.info(`[revenue-rollup] standby on instance ${instance} (leader is instance 0)`);
    return;
  }
  /**
   * DAILY, not every fifteen minutes.
   *
   * The old default made this the most expensive statement on the database —
   * 568,576 ms over 7,435 calls in pg_stat_statements, about twice the heaviest
   * query the product actually serves. What it was maintaining was a
   * materialized view holding ONE ROW, aggregated from ONE payment.
   *
   * `REFRESH MATERIALIZED VIEW CONCURRENTLY` costs roughly the same whether the
   * view has one row or a million: it rebuilds and diffs regardless. So the cost
   * was fixed, the benefit was nil, and it ran ninety-six times a day.
   *
   * Freshness now comes from the read path instead — getFinancialSummary
   * refreshes before it answers, so an admin opening the page always sees
   * current numbers. This timer is only the floor underneath that, so the view
   * is never wildly stale for anything else that reads it directly.
   *
   * The minimum is 60 rather than 1: a stray REVENUE_ROLLUP_INTERVAL_MIN=1 in an
   * env file would put this straight back to being the heaviest thing here.
   */
  const intervalMin = Math.max(60, parseInt(process.env.REVENUE_ROLLUP_INTERVAL_MIN, 10) || 1440);
  logger.info(`[revenue-rollup] enabled — refreshing mv_daily_revenue every ${intervalMin} min`);
  timer = setInterval(() => runOnce('interval').catch(() => {}), intervalMin * 60 * 1000);
  if (timer.unref) timer.unref();
  // Prime shortly after boot so the Financial Center is current without waiting a full interval.
  setTimeout(() => runOnce('startup').catch(() => {}), 20 * 1000).unref();
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, runOnce };
