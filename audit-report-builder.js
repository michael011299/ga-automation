/**
 * audit-report-builder.js
 *
 * Builds a complete Google Docs batchUpdate request from a CTA audit result.
 * Returns { title, requests[] } ready to POST to:
 *   POST https://docs.googleapis.com/v1/documents/{documentId}:batchUpdate
 *
 * Document structure:
 *   - Add People header (title, divider, prepared-by line)
 *   - Executive summary (score, grade, SayHello viability)
 *   - CTA Quality sections (phone, email, above-fold, forms, booking journey)
 *   - GTM Setup Required (tags to create, fixes needed)
 *   - SayHello Viability Checklist
 *   - Per-page breakdown
 *
 * No em dashes. No emojis. Clean plain-English text throughout.
 */

"use strict";

// ---------------------------------------------------------------------------
// Colour palette (hex without #, for Google Docs RGB)
// ---------------------------------------------------------------------------
const COLOUR = {
  apBlue:       { red: 0.047, green: 0.157, blue: 0.596 }, // #0C2898
  apGrey:       { red: 0.4,   green: 0.4,   blue: 0.4   },
  black:        { red: 0,     green: 0,     blue: 0      },
  white:        { red: 1,     green: 1,     blue: 1      },
  lightBlue:    { red: 0.878, green: 0.91,  blue: 0.973 }, // header bg tint
  green:        { red: 0.133, green: 0.545, blue: 0.133 },
  red:          { red: 0.8,   green: 0.1,   blue: 0.1   },
  amber:        { red: 0.8,   green: 0.5,   blue: 0.0   },
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
// High-level section builders — each returns { text, requests[] }
// ---------------------------------------------------------------------------

/**
 * Build the full document text first, then generate formatting requests.
 * Google Docs requires all insertText calls with correct indices AFTER we
 * know the cumulative character positions — so we build text first, then
 * compute indices and add style requests in a second pass.
 *
 * Simpler approach used here: build a list of {text, style, paragraphStyle}
 * blocks, then compute cumulative indices and emit the full request array.
 */

const HEADING_1 = {
  namedStyleType: 'HEADING_1',
};
const HEADING_2 = {
  namedStyleType: 'HEADING_2',
};
const NORMAL = {
  namedStyleType: 'NORMAL_TEXT',
};

/**
 * @typedef {{ text: string, paragraphNamedStyle?: string, bold?: boolean, colour?: object, fontSize?: number, indent?: boolean }} Block
 */

/**
 * Convert a list of text blocks into a Google Docs batchUpdate request array.
 * All text is inserted at index 1 (after the document's mandatory empty
 * paragraph). Requests are ordered: all insertText first (in reverse order
 * to preserve indices), then all formatting second.
 *
 * @param {Block[]} blocks
 * @returns {{ requests: object[], documentLength: number }}
 */
function blocksToRequests(blocks) {
  // Step 1: build the full text and record where each block starts/ends
  let cursor = 1; // Google Docs body starts at index 1
  const positioned = blocks.map(block => {
    const text   = block.text.endsWith('\n') ? block.text : block.text + '\n';
    const start  = cursor;
    const end    = cursor + text.length;
    cursor       = end;
    return { ...block, text, start, end };
  });

  // Step 2: insertText requests — insert in REVERSE order so earlier indices
  // remain valid (each insert shifts everything after it).
  const insertRequests = [...positioned].reverse().map(b =>
    insertText(b.text, 1)
  );

  // Step 3: formatting requests (paragraph style + text style)
  // These run AFTER all text has been inserted, so indices are now stable.
  const styleRequests = [];
  positioned.forEach(b => {
    const paraStyle = b.paragraphNamedStyle
      ? applyParagraphStyle(b.start, b.end, { namedStyleType: b.paragraphNamedStyle })
      : null;
    if (paraStyle) styleRequests.push(paraStyle);

    const ts = {};
    if (b.bold)    ts.bold = true;
    if (b.colour)  ts.foregroundColor = { color: { rgbColor: b.colour } };
    if (b.fontSize) ts.fontSize = { magnitude: b.fontSize, unit: 'PT' };
    if (Object.keys(ts).length) {
      styleRequests.push(applyTextStyle(b.start, b.end - 1, ts)); // -1: exclude trailing \n
    }
  });

  return { requests: [...insertRequests, ...styleRequests], documentLength: cursor };
}

// ---------------------------------------------------------------------------
// Helpers — clean output text
// ---------------------------------------------------------------------------

function clean(str) {
  if (!str) return '';
  // Remove emojis (broad Unicode ranges used in JS)
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')  // emoticons / misc symbols
    .replace(/[\u{2600}-\u{27BF}]/gu, '')     // misc symbols & dingbats
    .replace(/\uFE0F/g, '')                    // variation selector
    .replace(/\u200D/g, '')                    // zero-width joiner
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
  if (g === 'A') return COLOUR.green;
  if (g === 'B') return COLOUR.green;
  if (g === 'C') return COLOUR.amber;
  return COLOUR.red;
}

function passFailColour(pass) {
  return pass ? COLOUR.green : COLOUR.red;
}

// ---------------------------------------------------------------------------
// Document title (used when creating the doc via Docs API)
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
 * Build the full Google Docs batchUpdate requests array from an audit result.
 *
 * @param {Object} audit      - result from ctaAuditSite()
 * @param {string} [clientName] - optional client/business name for the header
 * @returns {{ title: string, requests: object[] }}
 */
function buildAuditReport(audit, clientName) {
  const websiteUrl  = audit.website_url || '';
  const ranAt       = audit.ran_at      || new Date().toISOString();
  const quality     = audit.cta_quality || {};
  const gtmSummary  = audit.gtm_summary || {};
  const sayHello    = audit.sayhello_viability || null;

  const d = new Date(ranAt);
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  let domain = websiteUrl;
  try { domain = new URL(websiteUrl).hostname.replace(/^www\./, ''); } catch {}

  const displayClient = clientName || domain || 'Client';

  /** @type {Block[]} */
  const blocks = [];

  // ── Document Header ───────────────────────────────────────────────────────
  blocks.push({ text: 'Add People', paragraphNamedStyle: 'HEADING_1', bold: true, colour: COLOUR.apBlue, fontSize: 22 });
  blocks.push({ text: 'CTA and Tracking Audit Report', paragraphNamedStyle: 'HEADING_2', bold: true, colour: COLOUR.black, fontSize: 16 });
  blocks.push({ text: `Client: ${displayClient}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: `Website: ${websiteUrl}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: `Date of Audit: ${dateStr}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: `Pages Audited: ${(audit.pages_crawled || []).join(', ') || 'n/a'}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Section 1: Overall Score ──────────────────────────────────────────────
  blocks.push({ text: 'Section 1: Overall CTA Health Score', paragraphNamedStyle: 'HEADING_2', bold: true });
  blocks.push({ text: 'This score reflects how well the website is set up to capture and track leads across all contact methods.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });

  const score = quality.overall_score ?? 'n/a';
  const grade = quality.grade ?? 'n/a';
  blocks.push({
    text:  `Score: ${score} / 100     Grade: ${grade}`,
    bold:  true,
    colour: gradeColour(grade),
    paragraphNamedStyle: 'NORMAL_TEXT',
  });
  blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Section 2: SayHello Viability (top-level summary) ────────────────────
  if (sayHello) {
    blocks.push({ text: 'Section 2: SayHello Viability', paragraphNamedStyle: 'HEADING_2', bold: true });
    blocks.push({ text: 'Whether this client meets all criteria to be onboarded onto the SayHello platform.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
    blocks.push({
      text:   sayHello.verdict,
      bold:   true,
      colour: sayHello.viable ? COLOUR.green : COLOUR.red,
      paragraphNamedStyle: 'NORMAL_TEXT',
    });
    if (!sayHello.viable && sayHello.fail_reasons.length > 0) {
      sayHello.fail_reasons.forEach(reason => {
        blocks.push({ text: `  - ${clean(reason)}`, paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.red });
      });
    }
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  // ── Section 3: What is Working Well ──────────────────────────────────────
  if ((quality.strengths || []).length > 0) {
    blocks.push({ text: 'Section 3: What is Working Well', paragraphNamedStyle: 'HEADING_2', bold: true });
    blocks.push({ text: 'Positive signals found during the audit that support lead capture and tracking.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
    quality.strengths.forEach(s => {
      blocks.push({ text: `  + ${clean(s)}`, colour: COLOUR.green, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  // ── Section 4: Issues That Need Attention ────────────────────────────────
  if ((quality.issues || []).length > 0) {
    const sectionNum = (quality.strengths || []).length > 0 ? 4 : 3;
    blocks.push({ text: `Section ${sectionNum}: Issues That Need Attention`, paragraphNamedStyle: 'HEADING_2', bold: true });
    blocks.push({ text: 'Problems found on the website that are preventing accurate tracking or reducing conversions.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
    quality.issues.forEach(i => {
      blocks.push({ text: `  - ${clean(i)}`, colour: COLOUR.red, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  // ── Section 5: Recommended Actions ───────────────────────────────────────
  if ((quality.recommendations || []).length > 0) {
    blocks.push({ text: 'Section 5: Recommended Actions', paragraphNamedStyle: 'HEADING_2', bold: true });
    blocks.push({ text: 'Changes that should be made to the website or tracking setup to improve performance.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
    quality.recommendations.forEach((r, i) => {
      blocks.push({ text: `  ${i + 1}. ${clean(r)}`, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  // ── Section 6: Phone Number Analysis ─────────────────────────────────────
  const pq = quality.phone_quality || {};
  blocks.push({ text: 'Section 6: Phone Number Analysis', paragraphNamedStyle: 'HEADING_2', bold: true });
  blocks.push({ text: 'Whether phone numbers on the site are clickable (trackable in GA4 and tappable on mobile).', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
  blocks.push({ text: `Clickable tel: links found: ${pq.unique_clickable ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: `Plain-text numbers (not clickable or trackable): ${pq.unique_plain_text ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  if ((pq.shared_with_whatsapp || []).length > 0) {
    blocks.push({ text: `Numbers shared with WhatsApp (dual-purpose CTAs): ${pq.shared_with_whatsapp.join(', ')}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  }
  blocks.push({
    text:   `Overall verdict: ${pq.verdict ?? 'none'}`,
    bold:   true,
    colour: verdictColour(pq.verdict),
    paragraphNamedStyle: 'NORMAL_TEXT',
  });
  blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Section 7: Email Address Analysis ────────────────────────────────────
  const eq = quality.email_quality || {};
  blocks.push({ text: 'Section 7: Email Address Analysis', paragraphNamedStyle: 'HEADING_2', bold: true });
  blocks.push({ text: 'Whether email addresses are set up as clickable mailto: links so they can be tracked in GA4.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
  blocks.push({ text: `Clickable mailto: links found: ${eq.clickable_count ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: `Plain-text emails (not clickable or trackable): ${eq.plain_text_count ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({
    text:   `Overall verdict: ${eq.verdict ?? 'none'}`,
    bold:   true,
    colour: verdictColour(eq.verdict),
    paragraphNamedStyle: 'NORMAL_TEXT',
  });
  blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Section 8: CTAs Visible Above the Fold ───────────────────────────────
  const af = quality.above_fold || {};
  blocks.push({ text: 'Section 8: CTAs Visible Above the Fold (Without Scrolling)', paragraphNamedStyle: 'HEADING_2', bold: true });
  blocks.push({ text: 'Which contact and booking options a visitor can see immediately when they land on the page, before scrolling.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
  blocks.push({ text: `Phone number visible above fold: ${af.has_phone ? 'Yes' : 'No'}`, paragraphNamedStyle: 'NORMAL_TEXT', colour: af.has_phone ? COLOUR.green : COLOUR.red });
  blocks.push({ text: `Email address visible above fold: ${af.has_email ? 'Yes' : 'No'}`, paragraphNamedStyle: 'NORMAL_TEXT', colour: af.has_email ? COLOUR.green : COLOUR.apGrey });
  blocks.push({ text: `WhatsApp link visible above fold: ${af.has_whatsapp ? 'Yes' : 'No'}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: `Booking CTA button visible above fold: ${af.has_cta_button ? 'Yes' : 'No'}`, paragraphNamedStyle: 'NORMAL_TEXT', colour: af.has_cta_button ? COLOUR.green : COLOUR.amber });

  if ((af.by_page || []).length > 0) {
    blocks.push({ text: 'Breakdown by page:', bold: true, paragraphNamedStyle: 'NORMAL_TEXT' });
    af.by_page.forEach(p => {
      const label = `${p.label.charAt(0).toUpperCase() + p.label.slice(1)} page (${p.page})`;
      const parts = [];
      if (p.has_phone)      parts.push('Phone');
      if (p.has_email)      parts.push('Email');
      if (p.has_whatsapp)   parts.push('WhatsApp');
      if (p.has_cta_button) parts.push('Booking CTA');
      const summary = parts.length > 0 ? parts.join(', ') : 'None detected';
      blocks.push({ text: `  ${label}: ${summary}`, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
  }
  blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Section 9: Contact Form Analysis ─────────────────────────────────────
  const ff = quality.form_friction || {};
  blocks.push({ text: 'Section 9: Contact Form Analysis', paragraphNamedStyle: 'HEADING_2', bold: true });
  blocks.push({ text: 'Whether contact forms on the site are concise enough to convert well, and how they behave on submission.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
  blocks.push({ text: `Contact forms detected: ${ff.forms_found ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  if ((ff.forms_found ?? 0) > 0) {
    blocks.push({ text: `Average number of fields per form: ${ff.avg_field_count ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
    blocks.push({ text: `Forms with more than 6 fields (high friction): ${ff.high_friction_forms ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
    blocks.push({
      text:   `Friction level: ${ff.verdict ?? 'n/a'}`,
      bold:   true,
      colour: verdictColour(ff.verdict),
      paragraphNamedStyle: 'NORMAL_TEXT',
    });
  }
  blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Section 10: Booking Journey Analysis ─────────────────────────────────
  const bj = quality.booking_journey || {};
  blocks.push({ text: 'Section 10: Booking Journey Analysis', paragraphNamedStyle: 'HEADING_2', bold: true });
  blocks.push({ text: 'How easy it is for a visitor to go from landing on the site to completing a booking.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
  blocks.push({ text: `Booking CTAs detected across all pages: ${bj.ctas_found ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  if ((bj.ctas_found ?? 0) > 0) {
    blocks.push({ text: `Minimum number of clicks to reach a booking from a CTA: ${bj.min_clicks_to_book ?? 'Could not determine'}`, paragraphNamedStyle: 'NORMAL_TEXT' });
    blocks.push({ text: `CTAs that link directly to a booking platform: ${bj.direct_to_platform ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
    blocks.push({ text: `CTAs that pass through multiple redirects before reaching the destination: ${bj.high_hop_ctas ?? 0}`, paragraphNamedStyle: 'NORMAL_TEXT' });
  }
  blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Section 11: Google Maps Locations ────────────────────────────────────
  const locationLinks = gtmSummary.location_links || [];
  if (locationLinks.length > 0) {
    blocks.push({ text: 'Section 11: Google Maps Locations Detected', paragraphNamedStyle: 'HEADING_2', bold: true });
    blocks.push({ text: 'Each location listed below will need its own GTM trigger and GA4 event tag so clicks can be tracked individually.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
    locationLinks.forEach((loc, i) => {
      blocks.push({ text: `  ${i + 1}. ${loc.location_name}`, bold: true, paragraphNamedStyle: 'NORMAL_TEXT' });
      blocks.push({ text: `     Link: ${loc.href}`, colour: COLOUR.apGrey, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  // ── Section 12: GTM Tags to Create ───────────────────────────────────────
  const tagsToCreate = gtmSummary.tags_to_create || [];
  const fixesNeeded  = gtmSummary.fixes_needed   || [];
  const warnings     = gtmSummary.warnings       || [];

  if (tagsToCreate.length > 0) {
    const sNum = locationLinks.length > 0 ? 12 : 11;
    blocks.push({ text: `Section ${sNum}: GTM Tags to Create`, paragraphNamedStyle: 'HEADING_2', bold: true });
    blocks.push({ text: 'The following GA4 event tags and triggers should be created in Google Tag Manager to track each contact method on this site.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
    tagsToCreate.forEach((tag, i) => {
      blocks.push({ text: `  ${i + 1}. ${clean(tag)}`, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  if (fixesNeeded.length > 0) {
    blocks.push({ text: 'Website Fixes Required Before GTM Can Be Set Up', paragraphNamedStyle: 'HEADING_2', bold: true, colour: COLOUR.red });
    blocks.push({ text: 'These issues must be resolved on the website before the GTM tracking setup can be completed accurately.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
    fixesNeeded.forEach((fix, i) => {
      blocks.push({ text: `  ${i + 1}. ${clean(fix)}`, colour: COLOUR.red, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  if (warnings.length > 0) {
    blocks.push({ text: 'Additional Notes', paragraphNamedStyle: 'HEADING_2', bold: true });
    warnings.forEach(w => {
      blocks.push({ text: `  * ${clean(w)}`, colour: COLOUR.amber, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  // ── SayHello Viability Full Checklist ─────────────────────────────────────
  if (sayHello) {
    blocks.push({ text: 'SayHello Viability: Full Criteria Breakdown', paragraphNamedStyle: 'HEADING_2', bold: true });
    blocks.push({ text: 'Each condition must pass for the client to be eligible for SayHello onboarding.', paragraphNamedStyle: 'NORMAL_TEXT', colour: COLOUR.apGrey });
    Object.values(sayHello.checks || {}).forEach(check => {
      const indicator = check.pass ? 'PASS' : 'FAIL';
      const colour    = passFailColour(check.pass);
      blocks.push({ text: `${indicator}   ${check.label}`, bold: true, colour, paragraphNamedStyle: 'NORMAL_TEXT' });
      blocks.push({ text: `        ${clean(check.detail)}`, colour: COLOUR.apGrey, paragraphNamedStyle: 'NORMAL_TEXT' });
    });
    blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  blocks.push({ text: ' ', paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: 'Report prepared by Add People', bold: true, colour: COLOUR.apBlue, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: `Audit run: ${dateStr}`, colour: COLOUR.apGrey, paragraphNamedStyle: 'NORMAL_TEXT' });
  blocks.push({ text: 'addpeople.co.uk', colour: COLOUR.apGrey, paragraphNamedStyle: 'NORMAL_TEXT' });

  // ── Convert to batchUpdate requests ──────────────────────────────────────
  const { requests } = blocksToRequests(blocks);

  return {
    title:    buildDocTitle(websiteUrl, ranAt),
    requests,
  };
}

module.exports = { buildAuditReport, buildDocTitle };
