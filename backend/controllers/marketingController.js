const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { sendEmailViaBrevo } = require('../utils/notificationService');
const { escapeHtml } = require('../utils/emailTemplates');
const { normalizeToE164 } = require('../utils/phone');
const { SMS_CONSENT_TEXT_VERSION, CONSENT_METHOD_GUEST, logSmsConsentDecision } = require('../utils/smsConsent');

/**
 * Public marketing forms (footer newsletter signup, Contact page). Both were
 * previously pure client-side mockups — no backend call existed, so every
 * submission was silently discarded while the visitor saw a fake success
 * message. These persist the submission durably and best-effort notify the
 * team by email; the email failing never fails the request, since the DB
 * write is already the durable record.
 */

// One business identity everywhere (Twilio TFV 30482 / DMARC alignment): every
// business + contact address on the platform is info@fancyrsvp.com, the address
// published on /contact, /terms, /privacy and /sms-opt-in.
const NOTIFY_EMAIL = process.env.CONTACT_NOTIFY_EMAIL || 'info@fancyrsvp.com';

const NEWSLETTER_SOURCES = ['footer', 'blog'];

/** POST /api/v1/public/newsletter-subscribe  body: { email, source? } */
const subscribeNewsletter = async (req, res, next) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const source = NEWSLETTER_SOURCES.includes(req.body.source) ? req.body.source : 'footer';
  try {
    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({ email, source });

    // Already-subscribed is not an error from the visitor's point of view.
    if (error && error.code !== '23505') throw error;

    sendEmailViaBrevo(
      NOTIFY_EMAIL,
      'New newsletter subscriber',
      `<p>New newsletter signup: <strong>${escapeHtml(email)}</strong></p>`
    ).catch((err) => logger.warn({ err }, 'Newsletter notification email failed (non-fatal)'));

    return res.json({ success: true, message: 'Subscribed successfully.' });
  } catch (err) {
    next(err);
  }
};

/**
 * Give a standalone /sms-opt-in submission real effect on deliverability.
 *
 * ONE write, deliberately narrow, and one refusal.
 *
 *  GRANT CONSENT ON PARTIES THAT NEVER DECIDED. A party whose primary contact
 *  holds this number, and which has NO recorded decision (sms_consent_at IS
 *  NULL), becomes messageable. The IS-NULL guard is the same precedence rule the
 *  host attestation obeys: a guest who was shown our checkbox and declined has a
 *  stamped timestamp, and nothing here may write over their refusal.
 *
 *  NEVER LIFT A SUPPRESSION. See the note in the body — that write used to be
 *  here and was the one thing on this endpoint an anonymous visitor could do to
 *  somebody else's phone number.
 *
 * ── THE RESIDUAL RISK, STATED PLAINLY ─────────────────────────────────────
 *
 * This endpoint still takes a phone number from an unauthenticated form and,
 * for a number that has never opted out, treats the submission as that person's
 * consent. It is bounded — a rate limiter, a required checkbox, no effect on
 * anyone who has refused or replied STOP, and every send re-verifies consent at
 * dispatch time — but the form itself does not prove the submitter owns the
 * number.
 *
 * Closing that properly means a verification round trip: text a short code to
 * the number and require it back before any of this runs. That is a product
 * decision (it changes the page, and the code has to be sent outside the
 * per-event billing path, which is currently the only door to the carrier), so
 * it is named here rather than half-built.
 *
 * Best-effort: the consent record is already durably stored by the caller, so a
 * failure here degrades to "recorded but not yet applied" rather than losing the
 * opt-in or failing the request.
 */
async function applyStandaloneOptIn(phone) {
  try {
    const nowISO = new Date().toISOString();

    /**
     * ── A STOP IS NOT REVERSIBLE FROM AN ANONYMOUS WEB FORM ────────────────
     *
     * This used to stamp `opted_back_in_at` here, lifting the suppression for
     * whatever number was typed into a public, unauthenticated page. Nothing
     * established that the person filling the form owned the number, so any
     * visitor could put a stranger's mobile in the box and switch that
     * stranger's opt-out off, across every event on the platform.
     *
     * That contradicts the rule this whole subsystem is built on, stated once
     * in services/smsDispatch.js: a STOP "suppresses the number globally,
     * across every event, permanently, until they text START". The word that
     * matters is THEY. An opt-out belongs to the subscriber, and only the
     * subscriber can take it back.
     *
     * There is already a correct channel for that, and it proves ownership by
     * construction: replying START / UNSTOP / YES from the handset, which
     * campaignController's inbound webhook records. The carrier also honours it
     * network-side on toll-free. Nothing is lost by removing this; a route that
     * required no proof has simply stopped existing.
     *
     * A suppressed number therefore ends the function here — the submission is
     * still recorded by the caller (that is the audit trail the Toll-Free
     * Verification asks for), it just no longer grants anything.
     */
    const { data: suppressed, error: suppressedErr } = await supabase
      .from('sms_opt_outs')
      .select('phone')
      .eq('phone', phone)
      .is('opted_back_in_at', null)
      .limit(1);

    if (suppressedErr) {
      // FAIL CLOSED. Not being able to read the suppression list is not
      // permission to write around it — the whole point of the list is that it
      // outranks every other consent record.
      logger.warn({ err: suppressedErr }, 'sms opt-in: suppression check failed — not propagating consent');
      return;
    }
    if (suppressed && suppressed.length > 0) {
      logger.info({ phone }, 'sms opt-in recorded for a number that has replied STOP — consent NOT propagated; they must text START');
      return;
    }

    // Find undecided parties whose PRIMARY contact is this number. Only the
    // primary matters: SMS is addressed to the party's primary contact, so a
    // companion sharing the number would attach consent to the wrong person.
    const { data: matches, error: matchErr } = await supabase
      .from('guests')
      .select('party_id, event_id')
      .eq('phone', phone)
      .eq('is_primary_contact', true)
      .not('party_id', 'is', null);
    if (matchErr) {
      logger.warn({ err: matchErr }, 'sms opt-in: party lookup failed');
      return;
    }

    const partyIds = [...new Set((matches || []).map((m) => m.party_id).filter(Boolean))];
    if (partyIds.length === 0) return;

    const { data: updated, error: consentErr } = await supabase
      .from('rsvp_parties')
      .update({
        sms_consent: true,
        sms_consent_at: nowISO,
        sms_consent_source: 'sms_opt_in_page',
        sms_consent_method: CONSENT_METHOD_GUEST,
        sms_consent_text_version: SMS_CONSENT_TEXT_VERSION,
      })
      .in('id', partyIds)
      .is('sms_consent_at', null)   // never overwrite a decision already made
      .select('id, event_id');
    if (consentErr) {
      logger.warn({ err: consentErr }, 'sms opt-in: consent propagation failed');
      return;
    }

    for (const row of (updated || [])) {
      logSmsConsentDecision({
        eventId: row.event_id, partyId: row.id, phone,
        consent: true, source: 'sms_opt_in_page',
      });
    }
    if ((updated || []).length > 0) {
      logger.info({ phone, parties: updated.length }, 'sms opt-in applied to existing guest parties');
    }
  } catch (err) {
    logger.warn({ err }, 'sms opt-in: applying the opt-in threw (record is still stored)');
  }
}

/**
 * POST /api/v1/public/sms-opt-in  body: { fullName?, phone, consent }
 *
 * The live opt-in form on /sms-opt-in — the URL submitted with the Twilio
 * Toll-Free Verification. Persists a timestamped, versioned consent record
 * (phone + the exact consent-language version shown). The person receives
 * event texts only when a host invites them; this row documents the opt-in.
 */
const submitSmsOptIn = async (req, res, next) => {
  const fullName = (req.body.fullName || '').trim() || null;
  const phone = normalizeToE164(req.body.phone);

  if (!phone) {
    return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Enter a valid phone number in international format (e.g. +1 555 123 4567).' });
  }
  // Affirmative consent is the entire point of this endpoint — never record
  // without it. String 'true' tolerated for form-encoded clients.
  const consented = req.body.consent === true || req.body.consent === 'true';
  if (!consented) {
    return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Please check the consent box to opt in to text messages.' });
  }

  try {
    const { error } = await supabase
      .from('sms_optin_submissions')
      .insert({ full_name: fullName, phone, consent: true, consent_text_version: SMS_CONSENT_TEXT_VERSION, source: 'sms_opt_in_page', ip: req.ip || null });
    if (error) throw error;

    // Mirror the opt-in into the unified append-only consent log so every
    // consent decision — RSVP form or standalone opt-in page — is auditable
    // from one place (Twilio TFV 30475).
    logSmsConsentDecision({ phone, consent: true, source: 'sms_opt_in_page' });

    // ── Make the opt-in actually MEAN something ────────────────────────────────
    // Until now this endpoint wrote two audit rows and stopped. Every send path
    // reads rsvp_parties.sms_consent and sms_opt_outs — neither of which this
    // touched — so the page told visitors "you are opted in" while changing
    // nothing at all about whether they could be messaged. On the page Twilio
    // reviews as our opt-in URL, that gap is the whole point of the page.
    await applyStandaloneOptIn(phone);

    return res.json({ success: true, message: 'You are opted in. You will only receive texts about Fancy RSVP events you are invited to. Reply STOP to any message to opt out.' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/public/contact  body: { name, email, subject, message,
 *   segment?, company?, phone?, expectedGuests? }
 *
 * Shared by the generic Contact page (segment omitted -> 'general') and the
 * /solutions/* B2B inquiry forms (Planners / Venues / Corporate), which pass
 * `segment` plus the optional company/phone/expectedGuests fields so a
 * qualified sales lead is durably distinguishable from a routine support
 * question — not just another row indistinguishable from the rest.
 */
const submitContactForm = async (req, res, next) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim();
  const subject = (req.body.subject || '').trim();
  const message = (req.body.message || '').trim();
  // Defence in depth: the route validator already restricts this to the known
  // set, but never trust the body value verbatim into a CHECK-constrained column.
  const ALLOWED_SEGMENTS = ['general', 'planners', 'venues', 'corporate'];
  const segment = ALLOWED_SEGMENTS.includes(req.body.segment) ? req.body.segment : 'general';
  const company = (req.body.company || '').trim() || null;
  const phone = (req.body.phone || '').trim() || null;
  const expectedGuests = (req.body.expectedGuests || '').trim() || null;

  try {
    const { error } = await supabase
      .from('contact_submissions')
      .insert({ name, email, subject, message, segment, company, phone, expected_guests: expectedGuests, ip: req.ip || null });
    if (error) throw error;

    const segmentLabel = segment === 'general' ? null : segment.charAt(0).toUpperCase() + segment.slice(1);
    sendEmailViaBrevo(
      NOTIFY_EMAIL,
      segmentLabel ? `New ${segmentLabel} inquiry: ${subject}` : `New contact form message: ${subject}`,
      `${segmentLabel ? `<p><strong>Segment:</strong> ${escapeHtml(segmentLabel)}</p>` : ''}
       <p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p>
       ${company ? `<p><strong>Company:</strong> ${escapeHtml(company)}</p>` : ''}
       ${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ''}
       ${expectedGuests ? `<p><strong>Expected guests:</strong> ${escapeHtml(expectedGuests)}</p>` : ''}
       <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
       <p><strong>Message:</strong></p>
       <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
    ).catch((err) => logger.warn({ err }, 'Contact form notification email failed (non-fatal)'));

    return res.json({ success: true, message: 'Message sent successfully.' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/public/testimonials — published testimonials only, in display
 * order. The counterpart to admin/testimonialsController.js's full CRUD;
 * this is the ONLY read path the public landing page uses, so an
 * unpublished (draft, or since-retracted) testimonial can never leak.
 * Never exposes created_by/updated_by or timestamps — those are internal.
 */
const getPublicTestimonials = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .select('id, name, role, quote, photo_url, initials, rating, verify_url')
      .eq('is_published', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;

    res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.json({ success: true, testimonials: data || [] });
  } catch (err) {
    // A landing-page decoration must never 500 the page — degrade to an
    // empty list (the section hides itself client-side) rather than error,
    // mirroring the /public/landing-stats endpoint's own fallback.
    logger.warn({ err }, 'getPublicTestimonials: query failed, returning empty list');
    return res.status(200).json({ success: false, testimonials: [] });
  }
};

/**
 * GET /api/v1/public/press-mentions — published "As Seen In" press mentions
 * / trust badges only, in display order. The counterpart to
 * admin/pressMentionsController.js's full CRUD. Never exposes
 * created_by/updated_by or timestamps — those are internal.
 */
const getPublicPressMentions = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('press_mentions')
      .select('id, publication_name, logo_url, article_url, headline')
      .eq('is_published', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;

    res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.json({ success: true, pressMentions: data || [] });
  } catch (err) {
    // A landing-page decoration must never 500 the page — degrade to an
    // empty list (the section hides itself client-side) rather than error,
    // mirroring getPublicTestimonials.
    logger.warn({ err }, 'getPublicPressMentions: query failed, returning empty list');
    return res.status(200).json({ success: false, pressMentions: [] });
  }
};

/**
 * GET /api/v1/public/blog — published posts only, newest first. Optional
 * ?category= filter. The counterpart to admin/blogController.js's full CRUD.
 * Never exposes content/meta fields not needed for a list card — the full
 * body is only returned by getPublicBlogPostBySlug for the detail page.
 */
const getPublicBlogPosts = async (req, res) => {
  try {
    let query = supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, cover_image_url, category, author_name, published_at, read_time_minutes')
      .eq('is_published', true)
      .order('published_at', { ascending: false });

    const category = (req.query.category || '').toString().trim();
    if (category && category.toLowerCase() !== 'all') query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;

    res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.json({ success: true, posts: data || [] });
  } catch (err) {
    // A landing-page listing must never 500 the page — degrade to an empty
    // list, mirroring getPublicTestimonials / getPublicPressMentions.
    logger.warn({ err }, 'getPublicBlogPosts: query failed, returning empty list');
    return res.status(200).json({ success: false, posts: [] });
  }
};

/**
 * GET /api/v1/public/blog/:slug — a single published post's full content.
 * Unlike the decorative list/testimonials endpoints, a missing or unpublished
 * slug is a genuine 404 (the page itself doesn't exist), not a soft-degrade.
 */
const getPublicBlogPostBySlug = async (req, res, next) => {
  const slug = (req.params.slug || '').toString().trim();
  try {
    const { data, error } = await supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, content, cover_image_url, category, author_name, published_at, read_time_minutes, meta_title, meta_description')
      .eq('slug', slug)
      .eq('is_published', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'POST_NOT_FOUND', message: 'This article could not be found.' });

    res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.json({ success: true, post: data });
  } catch (err) {
    next(err);
  }
};

module.exports = { subscribeNewsletter, submitContactForm, submitSmsOptIn, getPublicTestimonials, getPublicPressMentions, getPublicBlogPosts, getPublicBlogPostBySlug };
