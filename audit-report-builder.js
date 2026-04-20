/**
 * audit-report-builder.js
 *
 * Builds a complete Google Docs batchUpdate request from a CTA audit result.
 * Returns { title, requests[] } ready to POST to:
 *   POST https://docs.googleapis.com/v1/documents/{documentId}:batchUpdate
 *
 * Sections (skipped automatically when no data):
 *   Header: Add People branding, client, date, pages audited
 *   1. Audit Overview (score, grade, SayHello verdict)
 *   2. What is Working Well  (only if strengths exist)
 *   3. Issues and Recommended Actions  (only if issues exist)
 *   4. Contact Methods  (phones, emails, WhatsApp, above fold)
 *   5. Contact Forms  (only if forms detected)
 *   6. Booking Journey  (only if booking CTAs detected)
 *   7. Google Maps Locations  (only if location links detected)
 *   8+. GTM Tags to Create
 *   Website Fixes Required  (only if fixes needed)
 *   Additional Notes  (only if warnings exist)
 *   SayHello Viability: Full Checklist
 *   Footer
 *
 * No em dashes. No emojis. Clean plain-English text throughout.
 */

"use strict";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
const COLOUR = {
  apBlue:    { red: 0.047, green: 0.157, blue: 0.596 },
  apGrey:    { red: 0.4,   green: 0.4,   blue: 0.4   },
  black:     { red: 0,     green: 0,     blue: 0      },
  white:     { red: 1,     green: 1,     blue: 1      },
  green:     { red: 0.133, green: 0.545, blue: 0.133  },
  red:       { red: 0.8,   green: 0.1,   blue: 0.1    },
  amber:     { red: 0.8,   green: 0.5,   blue: 0.0    },
};

// ---------------------------------------------------------------------------
// Low-level request builders
// ---------------------------------------------------------------------------

function insertText(text, index) {
  return { insertText: { text, location: { index } } };
}

function applyTextStyle(startIndex, endIndex, style) {
  return {
    updateTextStyle: {
      range: { startIndex, endIndex },
      textStyle: style,
      fields: Object.keys(style).join(','),
    },
  };
}

function applyParagraphStyle(startIndex, endIndex, style) {
  return {
    updateParagraphStyle: {
      range: { startIndex, endIndex },
      paragraphStyle: style,
      fields: Object.keys(style).join(','),
    },
  };
}

// ---------------------------------------------------------------------------
// Block-to-request converter
// ---------------------------------------------------------------------------

/**
 * Convert a list of text blocks into a Google Docs batchUpdate request array.
 * All text is inserted at index 1 in reverse order (so the first block ends
 * up first), then formatting requests are applied with the stable final indices.
 *
 * @param {{ text: string, paragraphNamedStyle?: string, bold?: boolean, colour?: object, fontSize?: number }[]} blocks
 */
function blocksToRequests(blocks) {
  let cursor = 1;
  const positioned = blocks.map(block => {
    const text  = block.text.endsWith('\n') ? block.text : block.text + '\n';
    const start = cursor;
    const end   = cursor + text.length;
    cursor      = end;
    return { ...block, text, start, end };
  });

  // Insert in reverse order — each insert at index 1 pushes prior content forward,
  // so reverse insertion reconstructs the correct sequential order.
  const insertRequests = [...positioned].reverse().map(b => insertText(b.text, 1));

  const styleRequests = [];
  positioned.forEach(b => {
    if (b.paragraphNamedStyle) {
      styleRequests.push(
        applyParagraphStyle(b.start, b.end, { namedStyleType: b.paragraphNamedStyle })
      );
    }

    const ts = {};
    if (b.bold)     ts.bold = true;
    if (b.colour)   ts.foregroundColor = { color: { rgbColor: b.colour } };
    if (b.fontSize) ts.fontSize = { magnitude: b.fontSize, unit: 'PT' };
    if (Object.keys(ts).length) {
      styleRequests.push(applyTextStyle(b.start, b.end - 1, ts));
    }
  });

  return { requests: [...insertRequests, ...styleRequests], documentLength: cursor };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(str) {
  if (!str) return '';
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\u200D/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function verdictColour(verdict) {
  if (!verdict) return COLOUR.apGrey;
  const v = verdict.toLowerCase();
  if (v === 'good' || v === 'viable' || v === 'pass' || v === 'low') return COLOUR.green;
  if (v === 'partial' || v === 'medium') return COLOUR.amber;
  return COLOUR.red;
}

function gradeColour(grade) {
  if (!grade) return COLOUR.apGrey;
  const g = grade.toUpperCase();
  if (g === 'A' || g === 'B') return COLOUR.green;
  if (g === 'C') return COLOUR.amber;
  return COLOUR.red;
}

function passFailColour(pass) {
  return pass ? COLOUR.green : COLOUR.red;
}

// ---------------------------------------------------------------------------
// Document title
// ---------------------------------------------------------------------------

function buildDocTitle(websiteUrl, date) {
  const d = date ? new Date(date) : new Date();
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let domain = websiteUrl || '';
  try { domain = new URL(websiteUrl).hostname.replace(/^www\./, ''); } catch {}
  return `CTA Audit Report - ${domain} - ${dateStr}`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * @param {Object} audit       - result from ctaAuditSite()
 * @param {string} [clientName]
 * @returns {{ title: string, requests: object[] }}
 */
function buildAuditReport(audit, clientName) {
  const websiteUrl = audit.website_url || '';
  const ranAt      = audit.ran_at      || new Date().toISOString();
  const quality    = audit.cta_quality || {};
  const gtmSummary = audit.gtm_summary || {};
  const sayHello   = audit.sayhello_viability || null;
  const pages      = audit.pages || [];

  const d = new Date(ranAt);
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  let domain = websiteUrl;
  try { domain = new URL(websiteUrl).hostname.replace(/^www\./, ''); } catch {}

  const displayClient = clientName || domain || 'Client';

  const blocks = [];

  // Running section counter — sections are only emitted when they have content,
  // so the counter increments only when a section is actually written.
  let sectionNum = 0;
  const sectionTitle = (title) => {
    sectionNum++;
    return `Section ${sectionNum}: ${title}`;
  };

  // Helper for h2 section headers
  const h2 = (title, colour) => blocks.push({
    text: title,
    paragraphNamedStyle: 'HEADING_2',
    bold: true,
    ...(colour ? { colour } : {}),
  });

  const sub = (text) => blocks.push({
    text: clean(text),
    paragraphNamedStyle: 'NORMAL_TEXT',
    colour: COLOUR.apGrey,
  });

  const line = (text, opts = {}) => blocks.push({
    text: clean(text),
    paragraphNamedStyle: 'NORMAL_TEXT',
    ...opts,
  });

  const spacer = () => blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Document Header ───────────────────────────────────────────────────────
  blocks.push({
    text: 'Add People',
    paragraphNamedStyle: 'HEADING_1',
    bold: true,
    colour: COLOUR.apBlue,
    fontSize: 22,
  });
  blocks.push({
    text: 'CTA and Tracking Audit Report',
    paragraphNamedStyle: 'HEADING_2',
    bold: true,
    colour: COLOUR.black,
    fontSize: 16,
  });
  line(`Client: ${displayClient}`);
  line(`Website: ${websiteUrl}`);
  line(`Date of Audit: ${dateStr}`);
  line(`Pages Audited: ${(audit.pages_crawled || []).length} page(s) - ${(audit.pages_crawled || []).join(', ') || 'n/a'}`);
  spacer();

  // ── Section 1: Audit Overview ─────────────────────────────────────────────
  h2(sectionTitle('Audit Overview'));
  sub('Overall score reflecting how well this website is set up to capture and track leads.');

  const score = quality.overall_score ?? 'n/a';
  const grade = quality.grade ?? 'n/a';
  blocks.push({
    text: `Score: ${score} / 100     Grade: ${grade}`,
    bold: true,
    colour: gradeColour(grade),
    paragraphNamedStyle: 'NORMAL_TEXT',
  });

  if (sayHello) {
    blocks.push({
      text: `SayHello: ${sayHello.verdict}`,
      bold: true,
      colour: sayHello.viable ? COLOUR.green : COLOUR.red,
      paragraphNamedStyle: 'NORMAL_TEXT',
    });
    if (!sayHello.viable && (sayHello.fail_reasons || []).length > 0) {
      sayHello.fail_reasons.forEach(reason => {
        line(`  - ${clean(reason)}`, { colour: COLOUR.red });
      });
    }
  }
  spacer();

  // ── Section 2: What is Working Well (only if strengths exist) ────────────
  if ((quality.strengths || []).length > 0) {
    h2(sectionTitle('What is Working Well'));
    sub('Positive signals found during the audit that support lead capture and tracking.');
    quality.strengths.forEach(s => {
      line(`  + ${clean(s)}`, { colour: COLOUR.green });
    });
    spacer();
  }

  // ── Section 3: Issues and Recommended Actions (only if issues exist) ──────
  const hasIssues   = (quality.issues || []).length > 0;
  const hasRecs     = (quality.recommendations || []).length > 0;
  if (hasIssues || hasRecs) {
    h2(sectionTitle('Issues and Recommended Actions'));
    sub('Problems found on the website that are reducing conversions or preventing accurate tracking, with the recommended fix for each.');

    if (hasIssues) {
      quality.issues.forEach(i => {
        line(`  - ${clean(i)}`, { colour: COLOUR.red });
      });
    }

    if (hasRecs) {
      spacer();
      line('Actions:', { bold: true });
      quality.recommendations.forEach((r, i) => {
        line(`  ${i + 1}. ${clean(r)}`);
      });
    }
    spacer();
  }

  // ── Section 4: Contact Methods ───────────────────────────────────────────
  // Combines phone, email, WhatsApp, and above-fold visibility into one section.
  const pq = quality.phone_quality || {};
  const eq = quality.email_quality || {};
  const af = quality.above_fold    || {};

  // Aggregate WhatsApp across all pages
  const totalWaLinks     = pages.reduce((n, p) => n + (p.whatsapp?.links?.length || 0), 0);
  const floatingWaLinks  = pages.reduce((n, p) => n + (p.whatsapp?.links || []).filter(w => w.is_floating).length, 0);

  const hasAnyContact = (pq.unique_clickable || 0) > 0 || (pq.unique_plain_text || 0) > 0 ||
                        (eq.clickable_count  || 0) > 0 || (eq.plain_text_count  || 0) > 0 ||
                        totalWaLinks > 0;

  h2(sectionTitle('Contact Methods'));
  sub('Summary of all clickable contact methods detected across the site and their visibility on page load.');

  // Phones
  const totalPhones = (pq.unique_clickable || 0) + (pq.unique_plain_text || 0);
  if (totalPhones === 0) {
    line('Phone numbers: None detected on the site.');
  } else {
    const phoneVerdict = pq.verdict || 'none';
    let phoneSummary = `Phone numbers: ${pq.unique_clickable || 0} clickable tel: link(s)`;
    if ((pq.unique_plain_text || 0) > 0) phoneSummary += `, ${pq.unique_plain_text} plain-text (not trackable)`;
    if ((pq.shared_with_whatsapp || []).length > 0) phoneSummary += ` | ${pq.shared_with_whatsapp.length} also used as WhatsApp number`;
    blocks.push({
      text: phoneSummary,
      paragraphNamedStyle: 'NORMAL_TEXT',
      bold: true,
      colour: verdictColour(phoneVerdict),
    });
  }

  // Emails
  const totalEmails = (eq.clickable_count || 0) + (eq.plain_text_count || 0);
  if (totalEmails === 0) {
    line('Email addresses: None detected on the site.');
  } else {
    const emailVerdict = eq.verdict || 'none';
    let emailSummary = `Email addresses: ${eq.clickable_count || 0} clickable mailto: link(s)`;
    if ((eq.plain_text_count || 0) > 0) emailSummary += `, ${eq.plain_text_count} plain-text (not trackable)`;
    blocks.push({
      text: emailSummary,
      paragraphNamedStyle: 'NORMAL_TEXT',
      bold: true,
      colour: verdictColour(emailVerdict),
    });
  }

  // WhatsApp
  if (totalWaLinks > 0) {
    let waSummary = `WhatsApp: ${totalWaLinks} link(s) detected`;
    if (floatingWaLinks > 0) waSummary += ` | ${floatingWaLinks} floating button(s)`;
    line(waSummary);
  } else {
    line('WhatsApp: Not detected on the site.');
  }

  // Above the fold
  const afParts = [];
  if (af.has_phone)      afParts.push('Phone: Yes');
  if (af.has_email)      afParts.push('Email: Yes');
  if (af.has_whatsapp)   afParts.push('WhatsApp: Yes');
  if (af.has_cta_button) afParts.push('Booking CTA: Yes');
  const afMissing = [];
  if (!af.has_phone)      afMissing.push('Phone');
  if (!af.has_cta_button) afMissing.push('Booking CTA');

  line(`Above the fold (homepage): ${afParts.length > 0 ? afParts.join(' | ') : 'No contact CTAs visible above the fold'}`,
    afParts.length > 0 ? { colour: COLOUR.green } : { colour: COLOUR.red });

  spacer();

  // ── Section 5: Contact Forms (only if forms detected) ────────────────────
  const ff = quality.form_friction || {};
  const allForms = pages.flatMap((p) => (p.forms || []).map((f) => ({ ...f, _page: p.label || p.page_url })));
  if ((ff.forms_found || 0) > 0) {
    h2(sectionTitle('Contact Forms'));
    sub('Whether contact forms are concise enough to convert well and how submission is handled.');
    line(`Forms detected: ${ff.forms_found}`);
    line(`Average fields per form: ${ff.avg_field_count || 0}`);
    if ((ff.high_friction_forms || 0) > 0) {
      line(`Forms with more than 6 fields (high friction): ${ff.high_friction_forms}`, { colour: COLOUR.red });
    }
    blocks.push({
      text: `Form friction level: ${ff.verdict || 'n/a'}`,
      bold: true,
      colour: verdictColour(ff.verdict),
      paragraphNamedStyle: 'NORMAL_TEXT',
    });
    // Per-form position breakdown
    allForms.forEach((f, i) => {
      const posLabel = f.position_label ? f.position_label.replace(/_/g, ' ') : 'unknown';
      const frictionColour = f.friction_level === 'high' ? COLOUR.red : f.friction_level === 'medium' ? COLOUR.amber : COLOUR.green;
      line(`  Form ${i + 1} (${f._page}): ${f.field_count} fields — friction: ${f.friction_level} — position: ${posLabel} (${f.position_percent ?? '?'}% down page)`, { colour: frictionColour });
    });
    spacer();
  }

  // ── Dead social links (only if any found) ────────────────────────────────
  const deadLinks = pages.flatMap((p) =>
    (p.social_links || []).filter((s) => s.is_dead).map((s) => ({ ...s, _page: p.label || p.page_url }))
  );
  if (deadLinks.length > 0) {
    h2(sectionTitle('Dead or Invalid Social Links'));
    sub('These social links were found on the site but do not appear to point to a real profile. They should be updated or removed.');
    deadLinks.forEach((s) => {
      line(`  ${s.platform} on ${s._page}`, { bold: true, colour: COLOUR.red });
      line(`     URL: ${s.href}`, { colour: COLOUR.apGrey });
      line(`     Reason: ${s.dead_reason}`, { colour: COLOUR.red });
    });
    spacer();
  }

  // ── Section 6: Booking Journey (only if booking CTAs detected) ───────────
  const bj = quality.booking_journey || {};
  if ((bj.ctas_found || 0) > 0) {
    h2(sectionTitle('Booking Journey'));
    sub('How easy it is for a visitor to go from landing on the site to completing a booking.');
    line(`Booking CTAs detected: ${bj.ctas_found}`);
    line(`Clicks to reach a booking from the shortest CTA path: ${bj.min_clicks_to_book ?? 'Could not determine'}`);
    line(`CTAs linking directly to a booking platform: ${bj.direct_to_platform || 0}`);
    if ((bj.high_hop_ctas || 0) > 0) {
      line(`CTAs passing through multiple redirects: ${bj.high_hop_ctas}`, { colour: COLOUR.amber });
    }
    spacer();
  }

  // ── Section 7: Google Maps Locations (only if locations detected) ─────────
  const locationLinks = gtmSummary.location_links || [];
  if (locationLinks.length > 0) {
    h2(sectionTitle('Google Maps Locations'));
    sub('Each location below will have its own GTM trigger and GA4 event tag so map clicks are tracked per location.');
    locationLinks.forEach((loc, i) => {
      line(`  ${i + 1}. ${loc.location_name}`, { bold: true });
      line(`     ${loc.href}`, { colour: COLOUR.apGrey });
    });
    spacer();
  }

  // ── Section 8+: GTM Tags to Create ───────────────────────────────────────
  const tagsToCreate = gtmSummary.tags_to_create || [];
  const fixesNeeded  = gtmSummary.fixes_needed   || [];
  const warnings     = gtmSummary.warnings       || [];

  if (tagsToCreate.length > 0) {
    h2(sectionTitle('GTM Tags to Create'));
    sub('The following GA4 event tags and triggers should be set up in Google Tag Manager for this site.');
    tagsToCreate.forEach((tag, i) => {
      line(`  ${i + 1}. ${clean(tag)}`);
    });
    spacer();
  }

  if (fixesNeeded.length > 0) {
    h2('Website Fixes Required Before GTM Setup', COLOUR.red);
    sub('These issues must be resolved on the website before the GTM tracking setup can be completed accurately.');
    fixesNeeded.forEach((fix, i) => {
      line(`  ${i + 1}. ${clean(fix)}`, { colour: COLOUR.red });
    });
    spacer();
  }

  if (warnings.length > 0) {
    h2('Additional Notes');
    warnings.forEach(w => {
      line(`  * ${clean(w)}`, { colour: COLOUR.amber });
    });
    spacer();
  }

  // ── SayHello Viability: Full Checklist ────────────────────────────────────
  if (sayHello) {
    h2('SayHello Viability: Full Criteria Breakdown');
    sub('Each condition must pass for the client to be eligible for SayHello onboarding.');
    Object.values(sayHello.checks || {}).forEach(check => {
      const indicator = check.pass ? 'PASS' : 'FAIL';
      blocks.push({
        text: `${indicator}   ${check.label}`,
        bold: true,
        colour: passFailColour(check.pass),
        paragraphNamedStyle: 'NORMAL_TEXT',
      });
      line(`        ${clean(check.detail)}`, { colour: COLOUR.apGrey });
    });
    spacer();
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  spacer();
  line('Report prepared by Add People', { bold: true, colour: COLOUR.apBlue });
  line(`Audit run: ${dateStr}`, { colour: COLOUR.apGrey });
  line('addpeople.co.uk', { colour: COLOUR.apGrey });

  const { requests } = blocksToRequests(blocks);

  return {
    title:    buildDocTitle(websiteUrl, ranAt),
    requests,
  };
}

module.exports = { buildAuditReport, buildDocTitle };
