/**
 * Mock Supabase client for controller/service unit tests.
 *
 * The real client (config/supabase) exposes a chainable, thenable query builder:
 *   supabase.from(t).select(c,{count}).eq(a,b).order().range().  -> awaited (list)
 *   supabase.from(t).insert(row).select().single()               -> { data, error }
 *   supabase.from(t).update(obj).eq().eq()                        -> awaited
 *   supabase.rpc(fn, params)                                      -> { data, error }
 *
 * This mock reproduces that surface. A single `resolver(state)` callback decides
 * what every terminal operation returns, so each test scripts only the tables it
 * cares about. Every terminal call is recorded in `calls` for assertions.
 *
 * `state` shape passed to the resolver:
 *   { table, op, cols, count, payload, upsertOpts, filters, fn, params, terminal }
 *   - op:      'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
 *   - filters: { eq:[[col,val]], neq, gt, gte, lt, lte, in, ilike, like, is, not, or, match }
 *   - terminal:'single' | 'maybeSingle' | 'list'
 *
 * The resolver returns { data, error, count }. Returning undefined => empty result
 * (safe for fire-and-forget inserts like activity_logs).
 */
function createMockSupabase() {
  const calls = [];
  const channels = [];
  let resolver = () => ({});

  function makeBuilder(table) {
    const state = { table, op: 'select', filters: {}, _mutated: false };

    const finalize = async (terminal) => {
      state.terminal = terminal;
      const res = (await resolver({ ...state, filters: state.filters })) || {};
      calls.push({
        table: state.table,
        op: state.op,
        payload: state.payload,
        filters: state.filters,
        terminal,
      });
      return { data: res.data ?? null, error: res.error ?? null, count: res.count };
    };

    const pushFilter = (k, ...v) => {
      (state.filters[k] || (state.filters[k] = [])).push(v.length === 1 ? v[0] : v);
      return builder;
    };

    const builder = {
      // ── operation setters ──
      select(cols, opts) {
        if (!state._mutated) state.op = 'select';
        state.cols = cols;
        if (opts && opts.count) state.count = opts.count;
        return builder;
      },
      insert(payload) { state.op = 'insert'; state._mutated = true; state.payload = payload; return builder; },
      update(payload) { state.op = 'update'; state._mutated = true; state.payload = payload; return builder; },
      upsert(payload, opts) { state.op = 'upsert'; state._mutated = true; state.payload = payload; state.upsertOpts = opts; return builder; },
      delete() { state.op = 'delete'; state._mutated = true; return builder; },

      // ── filters / modifiers (all chainable, no-op storage) ──
      eq(c, v) { return pushFilter('eq', c, v); },
      neq(c, v) { return pushFilter('neq', c, v); },
      in(c, v) { return pushFilter('in', c, v); },
      ilike(c, v) { return pushFilter('ilike', c, v); },
      like(c, v) { return pushFilter('like', c, v); },
      is(c, v) { return pushFilter('is', c, v); },
      not(c, op, v) { return pushFilter('not', c, op, v); },
      or(s) { return pushFilter('or', s); },
      match(o) { state.filters.match = o; return builder; },
      /* RANGE FILTERS ARE RECORDED, not swallowed.
         These were chainable no-ops, which meant no test could assert that a
         query is bounded by a date at all — so a dropped `.gte('event_date',
         …)` was invisible to the whole suite. Date bounds are exactly where
         this codebase keeps getting hurt (the reminder window, the seating
         quiet period, upcoming-only sweeps), so they are the last thing that
         should be untestable. Recorded in the same shape as eq/neq. */
      gt(c, v) { return pushFilter('gt', c, v); },
      gte(c, v) { return pushFilter('gte', c, v); },
      lt(c, v) { return pushFilter('lt', c, v); },
      lte(c, v) { return pushFilter('lte', c, v); },
      contains() { return builder; },
      order() { return builder; },
      /*
       * RECORDED, not ignored. Chunked reads (checkinSyncService.readAll) page
       * with .range() and stop on a short page, so a resolver that hands back
       * the same full array for every call never terminates — the loop only
       * ends at its hard cap, and the test sees tens of thousands of rows.
       *
       * Resolvers that return a set larger than one chunk must slice on this.
       */
      range(from, to) { state.range = [from, to]; return builder; },
      limit() { return builder; },

      // ── terminals ──
      single() { return finalize('single'); },
      maybeSingle() { return finalize('maybeSingle'); },
      then(onF, onR) { return finalize('list').then(onF, onR); },
      catch(onR) { return finalize('list').catch(onR); },
      finally(fn) { return finalize('list').finally(fn); },
    };
    return builder;
  }

  const supabase = {
    from(table) { return makeBuilder(table); },
    async rpc(fn, params) {
      const res = (await resolver({ op: 'rpc', fn, params, filters: {} })) || {};
      calls.push({ op: 'rpc', fn, params });
      return { data: res.data ?? null, error: res.error ?? null };
    },
    channel(name) {
      const ch = { name, async send(msg) { channels.push({ name, msg }); return { status: 'ok' }; } };
      return ch;
    },
    removeChannel() { /* no-op */ },
  };

  return {
    supabase,
    calls,
    channels,
    setResolver(fn) { resolver = fn; },
    reset() { calls.length = 0; channels.length = 0; resolver = () => ({}); },
  };
}

/** First value of an `eq(col, val)` filter for a given column, else undefined. */
function eqVal(filters, col) {
  const pair = (filters.eq || []).find(([c]) => c === col);
  return pair ? pair[1] : undefined;
}

module.exports = { createMockSupabase, eqVal };
