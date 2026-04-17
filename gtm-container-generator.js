/**
 * gtm-container-generator.js
 *
 * Generates a complete, importable GTM container export JSON from a CTA audit
 * result.  The output is identical in structure to the JSON produced by
 * GTM Admin → Export Container, so the user can import it directly via
 * GTM Admin → Import Container (or push it programmatically via the API).
 *
 * Included tags / triggers:
 *   - AP G-TAG           (Google tag, fires All Pages — always)
 *   - AP Cookie Banner   (Custom HTML, paused — always; fill in manually)
 *   - AP Make Contact Details Clickable (Custom HTML, fires All Pages — when phones/emails present)
 *   - AP Click Call      (LINK trigger + GA4 event — when clickable tel: links found)
 *   - AP Click Emails    (LINK trigger + GA4 event — when clickable mailto: links found)
 *   - AP Contact Form    (FORM_SUBMISSION trigger + GA4 event — when forms found)
 *   - AP Click WhatsApp  (LINK trigger + GA4 event — when WhatsApp links found)
 *   - AP Click {Social}  (LINK trigger + GA4 event — per social platform found)
 *   - AP Click Book      (LINK trigger + GA4 event — per deduplicated booking CTA)
 */

"use strict";

const ALL_PAGES_TRIGGER_ID = "2147479553"; // GTM built-in — always exists

const SOCIAL_TRIGGER_DOMAINS = {
  "Facebook":    "facebook.com",
  "Instagram":   "instagram.com",
  "X (Twitter)": "twitter.com",
  "LinkedIn":    "linkedin.com",
  "YouTube":     "youtube.com",
  "TikTok":      "tiktok.com",
  "Pinterest":   "pinterest.com",
  "Snapchat":    "snapchat.com",
  "Threads":     "threads.net",
  "Trustpilot":  "trustpilot.com",
};

// ---------------------------------------------------------------------------
// HTML tag templates
// ---------------------------------------------------------------------------

/** Cookie consent banner placeholder — user fills in their own implementation. */
const COOKIE_BANNER_HTML = `<!-- AP Cookie Banner: replace this comment with your cookie consent banner HTML/JS -->
<script>
  // TODO: insert your cookie consent solution here
</script>`;

/**
 * Build the "Make Contact Details Clickable" custom HTML tag body.
 * Injects a script that walks the page text nodes and wraps each phone number
 * (and standalone email address) in a clickable <a> link.
 *
 * @param {string[]} phoneNumbers  — normalised phone strings e.g. ["+441234567890","01234567890"]
 * @param {string[]} emailAddresses — raw email strings e.g. ["info@example.com"]
 */
function buildMakeClickableHTML(phoneNumbers, emailAddresses) {
  const phonesJson  = JSON.stringify(phoneNumbers.map(n => n.replace(/\D/g, "")));
  const emailsJson  = JSON.stringify(emailAddresses);

  return `<script>
(function () {
  /* AP — Make Contact Details Clickable */
  var phones = ${phonesJson}; // digit strings only, e.g. ["441234567890","01234567890"]
  var emails = ${emailsJson};

  /* Build phone regex: matches each known number in various display formats */
  var phonePatterns = phones.map(function (digits) {
    // Strip leading country code 44 → replace with optional (0|+44|0044)
    var local = digits.replace(/^44/, '0');
    // Build a loose regex that allows spaces, dashes, brackets
    var escaped = local.split('').join('[\\\\s\\\\-.]?');
    return new RegExp('(?:\\\\+44[\\\\s\\\\-.]?|0044[\\\\s\\\\-.]?|0)' + escaped.slice(1), 'g');
  });

  /* Walk text nodes and wrap matches */
  function wrapInLink(node) {
    var text = node.nodeValue;
    if (!text || !text.trim()) return;

    // Phones
    phonePatterns.forEach(function (re, i) {
      text = text.replace(re, function (match) {
        var href = 'tel:+44' + phones[i].replace(/^0+44|^0+/, '');
        return '<a href="' + href + '" class="ap-clickable-phone">' + match + '</a>';
      });
    });

    // Emails (simple heuristic — already-linked emails are inside <a> so won't appear as text nodes)
    emails.forEach(function (email) {
      var safeEmail = email.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      text = text.replace(new RegExp(safeEmail, 'gi'), function (match) {
        return '<a href="mailto:' + email + '" class="ap-clickable-email">' + match + '</a>';
      });
    });

    if (text !== node.nodeValue) {
      var span = document.createElement('span');
      span.innerHTML = text;
      node.parentNode.replaceChild(span, node);
    }
  }

  var skipTags = { SCRIPT:1, STYLE:1, NOSCRIPT:1, A:1, INPUT:1, TEXTAREA:1, SELECT:1 };
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      if (!node.parentElement) return NodeFilter.FILTER_SKIP;
      if (skipTags[node.parentElement.tagName]) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    }
  }, false);

  var nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(wrapInLink);
})();
</script>`;
}

// ---------------------------------------------------------------------------
// ID counter helpers
// ---------------------------------------------------------------------------

function makeIdCounter(start) {
  let n = start;
  return () => String(n++);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a complete GTM container export JSON from a CTA audit result.
 *
 * @param {Object} audit          — result from ctaAuditSite() / POST /health/audit
 * @param {string} measurementId  — GA4 measurement ID, e.g. "G-XXXXXXXXXX"
 * @param {string} containerName  — display name for the container (used in export metadata)
 * @param {string} [accountId]    — GTM account ID (cosmetic in export; defaults to "0")
 * @param {string} [containerId]  — GTM container ID (cosmetic in export; defaults to "0")
 * @returns {Object}              — GTM container export JSON (pass to JSON.stringify for download)
 */
function generateGTMContainerExport(audit, measurementId, containerName, accountId = "0", containerId = "0") {
  const pages = audit.pages || [];

  // ── Aggregate audit findings ──────────────────────────────────────────────
  const hasClickablePhone = pages.some(p => p.phones?.clickable?.length > 0);
  const hasClickableEmail = pages.some(p => p.emails?.clickable?.length > 0);
  const hasForms          = pages.some(p => p.forms?.length > 0);
  const hasWhatsApp       = pages.some(p => p.whatsapp?.links?.length > 0);

  const socialPlatforms = [
    ...new Set(pages.flatMap(p => (p.social_links || []).map(s => s.platform)))
  ].filter(p => SOCIAL_TRIGGER_DOMAINS[p]);

  // Unique plain-text phone numbers for "Make Clickable" tag
  const allClickablePhones = [
    ...new Set(pages.flatMap(p => (p.phones?.clickable || []).map(ph => ph.number || ph.href?.replace("tel:", "") || "")))
  ].filter(Boolean);
  const allPlainTextPhones = [
    ...new Set(pages.flatMap(p => (p.phones?.plainText || []).map(ph => ph.digits || ph.number || "")))
  ].filter(n => n && !allClickablePhones.some(c => c.replace(/\D/g, "") === n.replace(/\D/g, "")));
  const allPhoneNumbers = [...allClickablePhones, ...allPlainTextPhones];

  const allEmails = [
    ...new Set(pages.flatMap(p => [
      ...(p.emails?.clickable || []).map(e => e.email || e.href?.replace("mailto:", "") || ""),
      ...(p.emails?.plainText || []).map(e => e.email || ""),
    ]))
  ].filter(Boolean);

  // Deduplicated booking CTAs
  const bookingCTAs = pages.flatMap(p => p.booking_ctas || []).filter(c => c.destination_type !== "error" && c.final_url);
  const seenBookingKeys = new Set();
  const dedupedBookingCTAs = bookingCTAs.filter(cta => {
    try {
      const key = cta.destination_type === "booking_platform"
        ? new URL(cta.final_url).hostname
        : new URL(cta.final_url).pathname;
      if (seenBookingKeys.has(key)) return false;
      seenBookingKeys.add(key);
      return true;
    } catch { return false; }
  });

  // ── ID allocators ─────────────────────────────────────────────────────────
  const nextTriggerId = makeIdCounter(10);
  const nextTagId     = makeIdCounter(100);

  const triggers         = [];
  const tags             = [];
  const skipped          = [];

  // Helper — meta object shared across tags/triggers (cosmetic, GTM ignores on import)
  const meta = { accountId, containerId };

  // ── Built-in variables ────────────────────────────────────────────────────
  const builtInVariables = [
    { accountId, containerId, type: "CLICK_URL",     name: "Click URL"     },
    { accountId, containerId, type: "CLICK_ELEMENT",  name: "Click Element" },
    { accountId, containerId, type: "CLICK_CLASSES",  name: "Click Classes" },
    { accountId, containerId, type: "CLICK_ID",       name: "Click ID"      },
    { accountId, containerId, type: "CLICK_TEXT",     name: "Click Text"    },
    { accountId, containerId, type: "CLICK_TARGET",   name: "Click Target"  },
    { accountId, containerId, type: "FORM_ELEMENT",   name: "Form Element"  },
    { accountId, containerId, type: "FORM_CLASSES",   name: "Form Classes"  },
    { accountId, containerId, type: "FORM_ID",        name: "Form ID"       },
    { accountId, containerId, type: "FORM_TARGET",    name: "Form Target"   },
    { accountId, containerId, type: "FORM_TEXT",      name: "Form Text"     },
    { accountId, containerId, type: "FORM_URL",       name: "Form URL"      },
  ];

  // ── Helper: add LINK trigger ───────────────────────────────────────────────
  function addLinkTrigger(name, urlContains) {
    const triggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId,
      name,
      type: "LINK",
      filter: [{
        type: "CONTAINS",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
          { type: "TEMPLATE", key: "arg1", value: urlContains     },
        ],
      }],
      waitForTags:        { type: "BOOLEAN",  value: "false" },
      checkValidation:    { type: "BOOLEAN",  value: "false" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000"  },
    });
    return triggerId;
  }

  // ── Helper: add GA4 event tag ─────────────────────────────────────────────
  function addGA4EventTag(name, eventName, firingTriggerIds) {
    const tagId = nextTagId();
    tags.push({
      ...meta,
      tagId,
      name,
      type: "gaawe",
      parameter: [
        { type: "TEMPLATE", key: "eventName",           value: eventName    },
        { type: "TEMPLATE", key: "measurementIdOverride", value: measurementId },
      ],
      firingTriggerId: firingTriggerIds,
    });
    return tagId;
  }

  // ── Helper: add LINK trigger + GA4 event tag pair ─────────────────────────
  function addLinkTriggerAndTag(triggerName, urlContains, tagName, eventName) {
    const triggerId = addLinkTrigger(triggerName, urlContains);
    addGA4EventTag(tagName, eventName, [triggerId]);
  }

  // ── AP G-TAG (always) ─────────────────────────────────────────────────────
  tags.push({
    ...meta,
    tagId: nextTagId(),
    name: "AP G-TAG",
    type: "googtag",
    parameter: [
      { type: "TEMPLATE", key: "tagId",               value: measurementId },
      { type: "TEMPLATE", key: "configSettingsTable",  value: ""           },
    ],
    firingTriggerId: [ALL_PAGES_TRIGGER_ID],
  });

  // ── AP Cookie Banner (always, paused) ────────────────────────────────────
  tags.push({
    ...meta,
    tagId: nextTagId(),
    name: "AP Cookie Banner",
    type: "html",
    parameter: [
      { type: "TEMPLATE", key: "html",           value: COOKIE_BANNER_HTML },
      { type: "BOOLEAN",  key: "supportDocumentWrite", value: "false"      },
    ],
    firingTriggerId: [ALL_PAGES_TRIGGER_ID],
    paused: true,
  });

  // ── AP Make Contact Details Clickable (when phones or emails exist) ───────
  if (allPhoneNumbers.length > 0 || allEmails.length > 0) {
    tags.push({
      ...meta,
      tagId: nextTagId(),
      name: "AP Make Contact Details Clickable",
      type: "html",
      parameter: [
        { type: "TEMPLATE", key: "html",               value: buildMakeClickableHTML(allPhoneNumbers, allEmails) },
        { type: "BOOLEAN",  key: "supportDocumentWrite", value: "false"                                          },
      ],
      firingTriggerId: [ALL_PAGES_TRIGGER_ID],
    });
  }

  // ── Click to Call ─────────────────────────────────────────────────────────
  if (hasClickablePhone) {
    addLinkTriggerAndTag("AP Click to Call", "tel:", "AP Click Call", "click_call");
  } else {
    skipped.push("click_call — no clickable tel: links found on site");
  }

  // ── Click to Email ────────────────────────────────────────────────────────
  if (hasClickableEmail) {
    addLinkTriggerAndTag("AP Click to Email", "mailto:", "AP Click Emails", "click_emails");
  } else {
    skipped.push("click_emails — no clickable mailto: links found on site");
  }

  // ── Contact Form ──────────────────────────────────────────────────────────
  if (hasForms) {
    const triggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId,
      name: "AP Contact Form",
      type: "FORM_SUBMISSION",
      waitForTags:        { type: "BOOLEAN",  value: "false" },
      checkValidation:    { type: "BOOLEAN",  value: "false" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000"  },
    });
    addGA4EventTag("AP Contact Form", "contact_form", [triggerId]);
  } else {
    skipped.push("contact_form — no contact forms found on site");
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (hasWhatsApp) {
    // Trigger covers all common WhatsApp URL patterns
    const triggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId,
      name: "AP Click WhatsApp",
      type: "LINK",
      filter: [{
        type: "MATCHES_CSS_SELECTOR",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
          { type: "TEMPLATE", key: "arg1", value: "wa.me|api.whatsapp.com|whatsapp://" },
        ],
      }, {
        // Fallback: CONTAINS filter matching the most common domain
        type: "CONTAINS",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
          { type: "TEMPLATE", key: "arg1", value: "wa.me"         },
        ],
      }],
      waitForTags:        { type: "BOOLEAN",  value: "false" },
      checkValidation:    { type: "BOOLEAN",  value: "false" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000"  },
    });
    addGA4EventTag("AP Click WhatsApp", "click_whatsapp", [triggerId]);
  } else {
    skipped.push("click_whatsapp — no WhatsApp links found on site");
  }

  // ── Social platforms ──────────────────────────────────────────────────────
  if (socialPlatforms.length === 0) {
    skipped.push("click_social — no social platform links found on site");
  } else {
    socialPlatforms.forEach(platform => {
      const domain    = SOCIAL_TRIGGER_DOMAINS[platform];
      const safeName  = platform.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      addLinkTriggerAndTag(
        `AP Click ${platform}`, domain,
        `AP Click ${platform}`, `click_social_${safeName}`,
      );
    });
  }

  // ── Booking CTAs ──────────────────────────────────────────────────────────
  if (dedupedBookingCTAs.length === 0) {
    skipped.push("click_book_cta — no booking CTAs found on site");
  } else {
    dedupedBookingCTAs.forEach((cta, i) => {
      try {
        if (cta.destination_type === "booking_platform") {
          const hostname  = new URL(cta.final_url).hostname;
          const safePlatform = (cta.platform || hostname).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
          addLinkTriggerAndTag(
            `AP Book CTA - ${cta.platform || hostname}`, hostname,
            `AP Click Book - ${cta.platform || hostname}`, `click_booking_${safePlatform}`,
          );
        } else {
          const path = new URL(cta.final_url).pathname;
          addLinkTriggerAndTag(
            `AP Book CTA - ${path}`, path,
            "AP Click Book CTA", "click_book_cta",
          );
        }
      } catch (e) {
        skipped.push(`booking CTA "${cta.link_text}" — ${e.message}`);
      }
    });
  }

  // ── Assemble export JSON ──────────────────────────────────────────────────
  const exportTime = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  const containerExport = {
    exportFormatVersion: 2,
    exportTime,
    containerVersion: {
      path:               `accounts/${accountId}/containers/${containerId}/versions/0`,
      accountId,
      containerId,
      containerVersionId: "0",
      name:               containerName || "AP Tracking Setup",
      description:        `Generated by AP automation — measurement ID: ${measurementId}`,
      container: {
        path:         `accounts/${accountId}/containers/${containerId}`,
        accountId,
        containerId,
        name:         containerName || "AP Tracking Setup",
        usageContext: ["WEB"],
      },
      tag:             tags,
      trigger:         triggers,
      builtInVariable: builtInVariables,
      fingerprint:     String(Date.now()),
    },
  };

  return {
    export:  containerExport,
    summary: {
      measurement_id:  measurementId,
      tags_count:      tags.length,
      triggers_count:  triggers.length,
      skipped,
      phones_included: allPhoneNumbers,
      emails_included: allEmails,
    },
  };
}

module.exports = { generateGTMContainerExport };
