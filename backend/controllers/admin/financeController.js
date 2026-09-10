const { supabase } = require('../../config/supabase');
const { CONFIG_ID } = require('../../utils/configCache');

/**
 * Financial Command Center (Master Plan §22). Reads the mv_daily_revenue rollup
 * (refreshed by the analytics job) to report gross / net / refunded / platform
 * profit over a date range, plus a simple linear forecast.
 */

/** GET /api/v1/admin/finance/summary?from=YYYY-MM-DD&to=YYYY-MM-DD */
const getFinancialSummary = async (req, res, next) => {
  try {
    /**
     * ── REFRESH WHEN SOMEBODY LOOKS, NOT EVERY FIFTEEN MINUTES ──
     *
     * `refresh_daily_revenue()` was the single heaviest statement on this
     * database: 568,576 ms across 7,435 calls in pg_stat_statements, roughly
     * double the heaviest application query. It was doing that to keep
     * mv_daily_revenue — ONE ROW, derived from ONE payment — current, on a
     * fifteen-minute timer, forever, for a dashboard nobody had open.
     *
     * The interval still exists as a floor (revenueRollup.js, now daily), but
     * the freshness that actually matters is "when an admin opens this page",
     * and that is here. Awaited rather than fired and forgotten so the numbers
     * on screen are the numbers in the database; a failure is swallowed because
     * a stale rollup is a much better outcome than a 500 on the finance page.
     */
    await require('../../services/revenueRollup').runOnce('finance-view').catch(() => {});

    // Default window: last 30 days. Ignore unparseable query dates rather than
    // letting `new Date('garbage').toISOString()` throw a RangeError → 500.
    const parseDate = (raw, fallback) => {
      if (!raw) return fallback;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? fallback : d;
    };
    const to = parseDate(req.query.to, new Date());
    const from = parseDate(req.query.from, new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const [{ data: rows, error }, { data: config }] = await Promise.all([
      supabase
        .from('mv_daily_revenue')
        .select('day, gross_cents, refunded_cents, net_cents, payment_count')
        .gte('day', fromStr)
        .lte('day', toStr)
        .order('day', { ascending: true }),
      supabase.from('super_admin_config').select('platform_commission_pct').eq('id', CONFIG_ID).maybeSingle(),
    ]);
    if (error) throw error;

    const series = rows || [];
    const totals = series.reduce(
      (acc, r) => {
        acc.grossCents += r.gross_cents || 0;
        acc.refundedCents += r.refunded_cents || 0;
        acc.netCents += r.net_cents || 0;
        acc.paymentCount += r.payment_count || 0;
        return acc;
      },
      { grossCents: 0, refundedCents: 0, netCents: 0, paymentCount: 0 }
    );

    const commissionPct = Number(config?.platform_commission_pct) || 0;
    const platformProfitCents = Math.round((totals.netCents * commissionPct) / 100);

    // Simple linear forecast: average daily net over the window, projected 30 days.
    // mv_daily_revenue only has a row for days that HAD a payment, so the average
    // must divide by the number of calendar days in the window — not series.length
    // (which only counts revenue days and would inflate the daily average/forecast).
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const windowDays = Math.max(1, Math.round((to - from) / MS_PER_DAY) + 1);
    const avgDailyNet = totals.netCents / windowDays;
    const forecastNext30Cents = Math.round(avgDailyNet * 30);

    return res.json({
      success: true,
      finance: {
        range: { from: fromStr, to: toStr },
        totals: { ...totals, platformProfitCents, commissionPct },
        series,
        forecast: { avgDailyNetCents: Math.round(avgDailyNet), next30DaysNetCents: forecastNext30Cents },
      },
    });
  } catch (err) {
    // A missing materialized view (migration not yet applied) yields a clear hint.
    if (err && (err.code === 'PGRST205' || /mv_daily_revenue/.test(err.message || ''))) {
      return res.status(503).json({
        success: false,
        error: 'ROLLUP_UNAVAILABLE',
        message: 'mv_daily_revenue is not available yet. Apply the overview/finance migration.',
      });
    }
    next(err);
  }
};

/**
 * SMS profit and loss.
 * GET /api/v1/admin/finance/sms?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Answers the one question nobody could answer before: is text messaging
 * actually making money?
 *
 * Revenue has always been recorded (sms_credit_ledger.amount_cents on purchase
 * rows). The carrier cost was not — it could only ever be estimated by
 * multiplying today's rate by historic volume, which is wrong the moment an
 * admin changes the rate, and wrong in the direction that flatters the result.
 * Cost is now captured per send (cost_cents), so this is measured rather than
 * inferred.
 *
 * A caveat is returned rather than hidden: sends that predate cost capture have
 * no cost recorded, so profit over a window spanning that point overstates. The
 * dashboard shows the caveat instead of quietly presenting an inflated number.
 */
const getSmsFinancials = async (req, res, next) => {
  try {
    const parseDate = (raw, fallback) => {
      if (!raw) return fallback;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? fallback : d;
    };
    const to = parseDate(req.query.to, new Date());
    const from = parseDate(req.query.from, new Date(Date.now() - 89 * 24 * 60 * 60 * 1000));

    const { data, error } = await supabase.rpc('sms_admin_analytics', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });

    if (error) {
      const undef = error.code === '42883' || error.code === 'PGRST202' ||
        /Could not find the function|does not exist/i.test(error.message || '');
      if (undef) {
        return res.status(503).json({
          success: false,
          error: 'ANALYTICS_UNAVAILABLE',
          message: 'SMS analytics are not available yet. Apply 20260820000000_sms_usage_and_limits.sql.',
        });
      }
      throw error;
    }

    const result = data || {};

    // How much of this window's volume has a real cost attached. Below 100% the
    // profit figure is an upper bound, and saying so is the difference between a
    // report and a guess.
    let costCoveragePct = 100;
    try {
      const { count: total } = await supabase
        .from('sms_credit_ledger').select('id', { count: 'exact', head: true })
        .eq('transaction_type', 'consumption')
        .gte('created_at', from.toISOString()).lte('created_at', to.toISOString());
      const { count: priced } = await supabase
        .from('sms_credit_ledger').select('id', { count: 'exact', head: true })
        .eq('transaction_type', 'consumption').not('cost_cents', 'is', null)
        .gte('created_at', from.toISOString()).lte('created_at', to.toISOString());
      if (total > 0) costCoveragePct = Math.round((priced / total) * 100);
    } catch { /* advisory */ }

    const revenue = Number(result.revenueCents) || 0;
    const cost = Number(result.costCents) || 0;

    return res.json({
      success: true,
      ...result,
      // Margin on revenue — the figure a finance reader expects. Markup-on-cost
      // for the same numbers reads far higher and flatters the result.
      marginPct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0,
      costCoveragePct,
      costCaveat: costCoveragePct < 100
        ? `${100 - costCoveragePct}% of messages in this period were sent before carrier costs were recorded, so profit is an upper bound.`
        : null,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getFinancialSummary, getSmsFinancials };
