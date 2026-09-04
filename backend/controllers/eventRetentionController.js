/**
 * THE TWO LINKS IN THE DATA-DELETION WARNING EMAIL.
 *
 * Both are reached from an inbox, so neither can use `requireAuth`: the
 * organizer clicking "download everything" at 2am on their phone is not going
 * to be carrying a session cookie, and a login wall on a 24-hour deadline is a
 * good way to make sure the archive never gets downloaded.
 *
 * Authorization is therefore the signed token itself, minted by
 * services/eventPurge and verified here against its own explicit purpose (see
 * services/tokenService — a token issued to download an archive cannot be
 * replayed to cancel a deletion, or the reverse). It expires with the grace
 * window, so both links die at the moment they stop meaning anything.
 *
 * ── WHY THE ARCHIVE IS BUILT ON DEMAND AND NOT ATTACHED TO THE EMAIL ──
 *
 * `notificationService.sendEmailViaBrevo` sends `{ sender, to, subject,
 * htmlContent }` and has no attachment support. Adding it would mean
 * base64-ing a whole guest list through the mail API, against Brevo's own
 * attachment ceiling, for an event whose spreadsheet can be several megabytes.
 *
 * Building it when the link is clicked also produces a BETTER archive: it is
 * generated from the data as it stands at download time rather than as it stood
 * when the sweep happened to run.
 */
const guestService = require('../services/guestService');
const tokenService = require('../services/tokenService');
const { generateExcelExport } = require('../utils/excelHelper');
/* The SAME escaper every email template uses. Imported rather than hand-rolled:
   this page interpolates an organizer-supplied event title into HTML, and the
   two places that do that must not disagree about what is safe. */
const { escapeHtml } = require('../utils/emailTemplates');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * A bare, self-contained HTML page for a link opened straight from an inbox.
 *
 * These two endpoints are the only ones in the API that answer a BROWSER rather
 * than the dashboard's fetch client, so a JSON envelope would render as a wall
 * of braces to somebody who just clicked a button in an email. Inline styles and
 * no assets, for the same reason the email templates use them: this has to
 * render correctly with nothing else loaded.
 */
const page = ({ title, body, tone = 'neutral' }) => {
  const accent = tone === 'danger' ? '#B23B3B' : tone === 'success' ? '#3B9B6D' : '#B8944F';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="margin:0; background:#F8F4EC; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif; color:#191B1E;">
  <div style="max-width:520px; margin:0 auto; padding:56px 24px;">
    <div style="background:#FFFFFF; border:1px solid #E8E2D6; border-radius:18px; padding:32px 28px;">
      <div style="width:44px; height:4px; border-radius:999px; background:${accent}; margin-bottom:22px;"></div>
      <h1 style="margin:0 0 14px; font-family:Georgia,'Times New Roman',serif; font-size:24px; line-height:1.3;">${title}</h1>
      <div style="font-size:15px; line-height:1.65; color:#4A4742;">${body}</div>
    </div>
  </div>
</body></html>`;
};

/**
 * GET /api/v1/events/archive?token=…
 * Streams the full event archive as a multi-sheet .xlsx.
 */
const downloadEventArchive = async (req, res) => {
  let eventId;
  try {
    ({ eventId } = tokenService.verifyEventArchive(req.query.token));
  } catch {
    return res.status(401).type('html').send(page({
      title: 'This link has expired',
      tone: 'danger',
      body: '<p>Download links stay valid until the deletion deadline in the email that carried them. If your event has not been deleted yet, sign in to your dashboard and export from there.</p>',
    }));
  }

  try {
    const { data: event } = await supabase
      .from('events')
      .select('id, title, slug, event_date, timezone')
      .eq('id', eventId)
      .maybeSingle();

    /**
     * The event is gone — which is the ordinary end state of this link, not an
     * error. A 410 with a sentence, rather than a 404 with a stack trace, is
     * the difference between "the thing you were warned about happened" and
     * "this product is broken".
     */
    if (!event) {
      return res.status(410).type('html').send(page({
        title: 'This event&rsquo;s data has been deleted',
        tone: 'danger',
        body: '<p>The 24-hour window in the email you received has passed, and everything for this event was permanently removed. We are not able to recover it.</p>',
      }));
    }

    /**
     * The SAME builder the organizer's own dashboard export uses, so the archive
     * is not a second, lesser format that only exists on this path — and so the
     * three silent-failure rules it encodes (the generateExcelExport row shape,
     * excluding undone check-ins, printing arrivals on the venue's clock) hold
     * here too.
     *
     * No `attendingOnly` and no `sort`: this is an archive of everything, which
     * is the whole promise the email makes.
     */
    const { guestRows, tables, checkins, timezone } = await guestService.buildEventExcelExport(eventId);
    const buffer = await generateExcelExport(guestRows, tables, checkins, timezone || event.timezone || null);

    const safeName = String(event.slug || event.title || 'event')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-archive.xlsx"`);
    // Never let a CDN or a shared proxy hold a copy of somebody's entire guest list.
    res.setHeader('Cache-Control', 'no-store, private');
    return res.send(Buffer.from(buffer));
  } catch (err) {
    logger.error({ err, eventId }, 'event archive build failed');
    return res.status(500).type('html').send(page({
      title: 'We could not build your archive',
      tone: 'danger',
      body: '<p>Something went wrong putting the file together. Please try the link again, or sign in and export from your dashboard — your data has not been deleted yet.</p>',
    }));
  }
};

/**
 * GET /api/v1/events/keep?token=…
 * Cancels the scheduled deletion for one event.
 */
const keepEventData = async (req, res) => {
  let eventId;
  try {
    ({ eventId } = tokenService.verifyEventKeep(req.query.token));
  } catch {
    return res.status(401).type('html').send(page({
      title: 'This link has expired',
      tone: 'danger',
      body: '<p>This link stays valid until the deletion deadline in the email that carried it.</p>',
    }));
  }

  try {
    const { data: event } = await supabase
      .from('events').select('id, title').eq('id', eventId).maybeSingle();

    if (!event) {
      return res.status(410).type('html').send(page({
        title: 'This event&rsquo;s data has been deleted',
        tone: 'danger',
        body: '<p>The deadline passed before this link was used, and everything for this event was permanently removed. We are not able to recover it.</p>',
      }));
    }

    /**
     * Clearing `purge_scheduled_at` as well as setting the flag.
     *
     * The flag alone would be enough today — the delete sweep filters on
     * `purge_opt_out = false`. Clearing the deadline too means the row does not
     * sit there carrying a date in the past that some future query, written by
     * somebody who has not read this file, might act on.
     *
     * `purge_warning_sent_at` is deliberately KEPT. It is the record that this
     * organizer was told, and clearing it would re-arm the warning email on the
     * next sweep — mailing them again about a deletion they just cancelled.
     */
    const { error } = await supabase
      .from('events')
      .update({ purge_opt_out: true, purge_scheduled_at: null })
      .eq('id', eventId);
    if (error) throw error;

    logger.info({ eventId }, '[event-purge] organizer opted out — deletion cancelled');

    return res.status(200).type('html').send(page({
      title: 'Your data is safe',
      tone: 'success',
      /* ESCAPED, not stripped. This was `.replace(/[<>&]/g, '')`, which is safe
         but destructive: it turned "Sara & Khalid" into "Sara  Khalid" on the
         one page confirming their data is being kept. escapeHtml renders the
         ampersand correctly AND neutralises markup. */
      body: `<p>Nothing will be deleted for <strong>${escapeHtml(event.title || 'your event')}</strong>. It stays on your account and in your dashboard as it is.</p>
             <p style="color:#77736A; font-size:13px;">You can still delete it yourself at any time from your dashboard.</p>`,
    }));
  } catch (err) {
    logger.error({ err, eventId }, 'event keep failed');
    return res.status(500).type('html').send(page({
      title: 'We could not save that',
      tone: 'danger',
      body: '<p>Please try the link again. If it keeps failing, sign in to your dashboard — your data has not been deleted yet.</p>',
    }));
  }
};

module.exports = { downloadEventArchive, keepEventData };
