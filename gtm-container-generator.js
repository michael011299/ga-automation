/**
 * gtm-container-generator.js
 *
 * Generates a complete, importable GTM container export JSON from a CTA audit
 * result.  The output is structurally identical to a real GTM Admin → Export
 * Container JSON (exportFormatVersion 2), so the user can import it directly
 * via GTM Admin → Import Container.
 *
 * Included tags / triggers:
 *   - AP G-TAG           (Google tag, fires All Pages — always)
 *   - AP Cookie Banner   (Custom HTML, paused — always; consent mode v2 default)
 *   - AP Make Contact Details Clickable (Custom HTML, fires Window Loaded)
 *   - AP Click Call      (LINK_CLICK trigger + GA4 event — when clickable tel: links found)
 *   - AP Click Emails    (LINK_CLICK trigger + GA4 event — when clickable mailto: links found)
 *   - AP Contact Form    (FORM_SUBMISSION trigger + GA4 event — when forms found)
 *   - AP Click WhatsApp  (LINK_CLICK trigger + GA4 event — when WhatsApp links found)
 *   - AP Click {Social}  (LINK_CLICK trigger + GA4 event — per social platform found)
 *   - AP Click Book      (LINK_CLICK trigger + GA4 event — per deduplicated booking CTA)
 */

"use strict";

const ALL_PAGES_TRIGGER_ID  = "2147479553"; // GTM built-in — Page View / All Pages
const WINDOW_LOADED_TRIGGER_ID = "2147479573"; // GTM built-in — Window Loaded

const SOCIAL_TRIGGER_DOMAINS = {
  Facebook:    "facebook.com",
  Instagram:   "instagram.com",
  "X (Twitter)": "twitter.com",
  LinkedIn:    "linkedin.com",
  YouTube:     "youtube.com",
  TikTok:      "tiktok.com",
  Pinterest:   "pinterest.com",
  Snapchat:    "snapchat.com",
  Threads:     "threads.net",
  Trustpilot:  "trustpilot.com",
};

// ---------------------------------------------------------------------------
// HTML tag templates
// ---------------------------------------------------------------------------

/**
 * Cookie consent banner with Consent Mode v2 defaults (denied until user accepts).
 * Paused in GTM — client configures their CMP then unpauses.
 */
const COOKIE_BANNER_HTML = `<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}

  // Consent Mode v2 — default all denied until user accepts
  gtag('consent', 'default', {
    'ad_storage':            'denied',
    'ad_user_data':          'denied',
    'ad_personalization':    'denied',
    'analytics_storage':     'denied',
    'functionality_storage': 'denied',
    'personalization_storage': 'denied',
    'security_storage':      'granted',
    'wait_for_update':       500
  });

  // TODO: Replace the block below with your CMP's consent update logic.
  // Call gtag('consent', 'update', {...}) once the user grants/denies consent.
  // Example (Cookiebot):
  //   window.addEventListener('CookiebotOnAccept', function () {
  //     gtag('consent', 'update', {
  //       'ad_storage':         'granted',
  //       'ad_user_data':       'granted',
  //       'ad_personalization': 'granted',
  //       'analytics_storage':  'granted'
  //     });
  //   });
</script>`;

/**
 * Build the "Make Contact Details Clickable" custom HTML tag body.
 */
function buildMakeClickableHTML(phoneNumbers, emailAddresses) {
  const phonesJson = JSON.stringify(phoneNumbers.map((n) => n.replace(/\D/g, "")));
  const emailsJson = JSON.stringify(emailAddresses);

  return `<script>
(function () {
  /* AP — Make Contact Details Clickable */
  var phones = ${phonesJson};
  var emails = ${emailsJson};

  var phonePatterns = phones.map(function (digits) {
    var local = digits.replace(/^44/, '0');
    var escaped = local.split('').join('[\\\\s\\\\-.]?');
    return new RegExp('(?:\\\\+44[\\\\s\\\\-.]?|0044[\\\\s\\\\-.]?|0)' + escaped.slice(1), 'g');
  });

  function wrapInLink(node) {
    var text = node.nodeValue;
    if (!text || !text.trim()) return;

    phonePatterns.forEach(function (re, i) {
      text = text.replace(re, function (match) {
        var href = 'tel:+44' + phones[i].replace(/^0+44|^0+/, '');
        return '<a href="' + href + '" class="ap-clickable-phone">' + match + '</a>';
      });
    });

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
 * @param {string} containerName  — display name for the container
 * @param {string} [accountId]    — GTM account ID (cosmetic; defaults to "0")
 * @param {string} [containerId]  — GTM container ID (cosmetic; defaults to "0")
 * @returns {Object}              — GTM container export JSON
 */
function generateGTMContainerExport(audit, measurementId, containerName, accountId = "0", containerId = "0") {
  const pages = audit.pages || [];

  // ── Aggregate audit findings ──────────────────────────────────────────────
  const hasClickablePhone      = pages.some((p) => p.phones?.clickable?.length > 0);
  const hasClickableEmail      = pages.some((p) => p.emails?.clickable?.length > 0);
  const hasForms               = pages.some((p) => p.forms?.length > 0);
  const hasHighFrictionForms   = pages.some((p) => p.forms?.some((f) => f.friction_level === "high"));
  const hasNewsletter          = pages.some((p) => p.newsletter?.length > 0);
  const hasWhatsApp            = pages.some((p) => p.whatsapp?.links?.length > 0);

  const socialPlatforms = [
    ...new Set(pages.flatMap((p) => (p.social_links || []).map((s) => s.platform))),
  ].filter((p) => SOCIAL_TRIGGER_DOMAINS[p]);

  const allClickablePhones = [
    ...new Set(
      pages.flatMap((p) => (p.phones?.clickable || []).map((ph) => ph.number || ph.href?.replace("tel:", "") || "")),
    ),
  ].filter(Boolean);
  const allPlainTextPhones = [
    ...new Set(pages.flatMap((p) => (p.phones?.plainText || []).map((ph) => ph.digits || ph.number || ""))),
  ].filter((n) => n && !allClickablePhones.some((c) => c.replace(/\D/g, "") === n.replace(/\D/g, "")));
  const allPhoneNumbers = [...allClickablePhones, ...allPlainTextPhones];

  const allEmails = [
    ...new Set(
      pages.flatMap((p) => [
        ...(p.emails?.clickable || []).map((e) => e.address || e.email || e.href?.replace("mailto:", "") || ""),
        ...(p.emails?.plainText || []).map((e) => e.address || e.email || ""),
      ]),
    ),
  ].filter(Boolean);

  const locationLinks = pages
    .flatMap((p) => p.location_links || [])
    .filter((loc, i, arr) => arr.findIndex((l) => l.href === loc.href) === i);

  const bookingCTAs = pages
    .flatMap((p) => p.booking_ctas || [])
    .filter((c) => c.destination_type !== "error" && c.final_url);
  const seenBookingKeys = new Set();
  const dedupedBookingCTAs = bookingCTAs.filter((cta) => {
    try {
      const key =
        cta.destination_type === "booking_platform"
          ? new URL(cta.final_url).hostname
          : new URL(cta.final_url).pathname;
      if (seenBookingKeys.has(key)) return false;
      seenBookingKeys.add(key);
      return true;
    } catch {
      return false;
    }
  });

  // ── ID allocators ─────────────────────────────────────────────────────────
  const nextTriggerId = makeIdCounter(10);
  const nextTagId     = makeIdCounter(100);
  const baseTs        = Date.now();
  let   fpOffset      = 0;
  const nextFp        = () => String(baseTs + fpOffset++);

  const triggers = [];
  const tags     = [];
  const skipped  = [];

  const meta = { accountId, containerId };

  // ── Built-in variables ────────────────────────────────────────────────────
  const builtInVariables = [
    { accountId, containerId, type: "PAGE_URL",      name: "Page URL" },
    { accountId, containerId, type: "PAGE_HOSTNAME", name: "Page Hostname" },
    { accountId, containerId, type: "PAGE_PATH",     name: "Page Path" },
    { accountId, containerId, type: "REFERRER",      name: "Referrer" },
    { accountId, containerId, type: "EVENT",         name: "Event" },
    { accountId, containerId, type: "CLICK_URL",     name: "Click URL" },
  ];

  // ── Helper: LINK_CLICK trigger ────────────────────────────────────────────
  function addLinkTrigger(name, urlContains) {
    const triggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId,
      name,
      type: "LINK_CLICK",
      filter: [
        {
          type: "CONTAINS",
          parameter: [
            { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
            { type: "TEMPLATE", key: "arg1", value: urlContains },
          ],
        },
      ],
      uniqueTriggerId:      { type: "TEMPLATE" },
      waitForTags:          { type: "TEMPLATE" },
      checkValidation:      { type: "TEMPLATE" },
      waitForTagsTimeout:   { type: "TEMPLATE", value: "2000" },
      fingerprint:          nextFp(),
    });
    return triggerId;
  }

  // ── Helper: GA4 event tag ─────────────────────────────────────────────────
  function addGA4EventTag(name, eventName, firingTriggerIds) {
    const tagId = nextTagId();
    tags.push({
      ...meta,
      tagId,
      name,
      type: "gaawe",
      parameter: [
        { type: "TEMPLATE", key: "eventName",            value: eventName },
        { type: "TEMPLATE", key: "measurementIdOverride", value: measurementId },
        { type: "BOOLEAN",  key: "sendEcommerceData",    value: "false" },
      ],
      firingTriggerId: firingTriggerIds,
      tagFiringOption: "ONCE_PER_LOAD",
      fingerprint:     nextFp(),
    });
    return tagId;
  }

  // ── Helper: LINK_CLICK trigger + GA4 event tag pair ───────────────────────
  function addLinkTriggerAndTag(triggerName, urlContains, tagName, eventName) {
    const triggerId = addLinkTrigger(triggerName, urlContains);
    addGA4EventTag(tagName, eventName, [triggerId]);
  }

  // ── AP G-TAG (always) ─────────────────────────────────────────────────────
  tags.push({
    ...meta,
    tagId:   nextTagId(),
    name:    "AP G-TAG",
    type:    "googtag",
    parameter: [
      { type: "TEMPLATE", key: "tagId",                value: measurementId },
      { type: "TEMPLATE", key: "configSettingsTable",  value: "" },
    ],
    firingTriggerId: [ALL_PAGES_TRIGGER_ID],
    tagFiringOption: "ONCE_PER_EVENT",
    fingerprint:     nextFp(),
  });

  // ── AP Cookie Banner (always, paused) ─────────────────────────────────────
  tags.push({
    ...meta,
    tagId:   nextTagId(),
    name:    "AP Cookie Banner",
    type:    "html",
    parameter: [
      { type: "TEMPLATE", key: "html",                 value: COOKIE_BANNER_HTML },
      { type: "BOOLEAN",  key: "supportDocumentWrite", value: "false" },
    ],
    firingTriggerId: [ALL_PAGES_TRIGGER_ID],
    tagFiringOption: "ONCE_PER_EVENT",
    paused:          true,
    fingerprint:     nextFp(),
  });

  // ── AP Make Contact Details Clickable (Window Loaded) ─────────────────────
  if (allPhoneNumbers.length > 0 || allEmails.length > 0) {
    tags.push({
      ...meta,
      tagId:   nextTagId(),
      name:    "AP Make Contact Details Clickable",
      type:    "html",
      parameter: [
        { type: "TEMPLATE", key: "html",                 value: buildMakeClickableHTML(allPhoneNumbers, allEmails) },
        { type: "BOOLEAN",  key: "supportDocumentWrite", value: "false" },
      ],
      firingTriggerId: [WINDOW_LOADED_TRIGGER_ID],
      tagFiringOption: "ONCE_PER_LOAD",
      fingerprint:     nextFp(),
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
      name:             "AP Contact Form",
      type:             "FORM_SUBMISSION",
      uniqueTriggerId:  { type: "TEMPLATE" },
      waitForTags:      { type: "TEMPLATE" },
      checkValidation:  { type: "TEMPLATE" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
      fingerprint:      nextFp(),
    });
    addGA4EventTag("AP Contact Form", "contact_form", [triggerId]);
  } else {
    skipped.push("contact_form — no contact forms found on site");
  }

  // ── High-Friction Form Abandonment ───────────────────────────────────────
  if (hasHighFrictionForms) {
    const visibilityTriggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId:          visibilityTriggerId,
      name:               "AP Form Visible (High Friction)",
      type:               "ELEMENT_VISIBILITY",
      visibilitySelector: { type: "TEMPLATE", value: "form" },
      visibleRatioType:   { type: "INTEGER",  value: "50" },
      visibleRatioMin:    { type: "INTEGER",  value: "50" },
      uniqueTriggerId:    { type: "TEMPLATE" },
      waitForTags:        { type: "TEMPLATE" },
      checkValidation:    { type: "TEMPLATE" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
      fingerprint:        nextFp(),
    });
    addGA4EventTag("AP Form Start (High Friction)", "form_start", [visibilityTriggerId]);

    const submitTriggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId:          submitTriggerId,
      name:               "AP Form Submit (High Friction)",
      type:               "FORM_SUBMISSION",
      uniqueTriggerId:    { type: "TEMPLATE" },
      waitForTags:        { type: "TEMPLATE" },
      checkValidation:    { type: "TEMPLATE" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
      fingerprint:        nextFp(),
    });
    addGA4EventTag("AP Form Submit (High Friction)", "form_submit_high_friction", [submitTriggerId]);
  } else {
    skipped.push("form_start / form_submit_high_friction — no high-friction forms (5+ fields) found on site");
  }

  // ── Newsletter Form ────────────────────────────────────────────────────────
  if (hasNewsletter) {
    const triggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId,
      name:               "AP Newsletter Form",
      type:               "FORM_SUBMISSION",
      uniqueTriggerId:    { type: "TEMPLATE" },
      waitForTags:        { type: "TEMPLATE" },
      checkValidation:    { type: "TEMPLATE" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
      fingerprint:        nextFp(),
    });
    addGA4EventTag("AP Newsletter Form", "newsletter_signup", [triggerId]);
  } else {
    skipped.push("newsletter_signup — no newsletter forms found on site");
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (hasWhatsApp) {
    const triggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId,
      name:  "AP Click WhatsApp",
      type:  "LINK_CLICK",
      filter: [
        {
          type: "CONTAINS",
          parameter: [
            { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
            { type: "TEMPLATE", key: "arg1", value: "wa.me" },
          ],
        },
      ],
      uniqueTriggerId:    { type: "TEMPLATE" },
      waitForTags:        { type: "TEMPLATE" },
      checkValidation:    { type: "TEMPLATE" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
      fingerprint:        nextFp(),
    });
    addGA4EventTag("AP Click WhatsApp", "click_whatsapp", [triggerId]);
  } else {
    skipped.push("click_whatsapp — no WhatsApp links found on site");
  }

  // ── Social platforms ──────────────────────────────────────────────────────
  if (socialPlatforms.length === 0) {
    skipped.push("click_social — no social platform links found on site");
  } else {
    socialPlatforms.forEach((platform) => {
      const safeName = platform.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

      if (platform === "X (Twitter)") {
        const tTriggerId = addLinkTrigger("AP Click X - twitter.com", "twitter.com");
        const xTriggerId = addLinkTrigger("AP Click X - x.com", "x.com");
        addGA4EventTag("AP Click X (Twitter)", "click_social_x_twitter", [tTriggerId, xTriggerId]);
      } else {
        const domain = SOCIAL_TRIGGER_DOMAINS[platform];
        addLinkTriggerAndTag(`AP Click ${platform}`, domain, `AP Click ${platform}`, `click_social_${safeName}`);
      }
    });
  }

  // ── Booking CTAs ──────────────────────────────────────────────────────────
  if (dedupedBookingCTAs.length === 0) {
    skipped.push("click_book_cta — no booking CTAs found on site");
  } else {
    dedupedBookingCTAs.forEach((cta) => {
      try {
        if (cta.destination_type === "booking_platform") {
          const hostname    = new URL(cta.final_url).hostname;
          const safePlatform = (cta.platform || hostname).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
          addLinkTriggerAndTag(
            `AP Book CTA - ${cta.platform || hostname}`,
            hostname,
            `AP Click Book - ${cta.platform || hostname}`,
            `click_booking_${safePlatform}`,
          );
        } else {
          const path = new URL(cta.final_url).pathname;
          addLinkTriggerAndTag(`AP Book CTA - ${path}`, path, "AP Click Book CTA", "click_book_cta");
        }
      } catch (e) {
        skipped.push(`booking CTA "${cta.link_text}" — ${e.message}`);
      }
    });
  }

  // ── Google Maps Location Links ─────────────────────────────────────────────
  if (locationLinks.length === 0) {
    skipped.push("click_location — no Google Maps location links found on site");
  } else {
    locationLinks.forEach((loc) => {
      const safeName = loc.location_name
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .toLowerCase();
      const urlFilter = loc.href.replace(/^https?:\/\//, "");
      addLinkTriggerAndTag(
        `AP Click Location - ${loc.location_name}`,
        urlFilter,
        `AP Click Location - ${loc.location_name}`,
        `click_location_${safeName}`,
      );
    });
  }

  // ── Assemble export JSON ──────────────────────────────────────────────────
  const exportTime = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");

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
        features: {
          supportUserPermissions:      true,
          supportEnvironments:         true,
          supportWorkspaces:           true,
          supportGtagConfigs:          true,
          supportBuiltInVariables:     true,
          supportClients:              false,
          supportFolders:              true,
          supportTags:                 true,
          supportTemplates:            true,
          supportTriggers:             true,
          supportVariables:            true,
          supportVersions:             true,
          supportZones:                true,
          supportTransformations:      true,
        },
      },
      tag:              tags,
      trigger:          triggers,
      builtInVariable:  builtInVariables,
      fingerprint:      String(Date.now()),
    },
  };

  return {
    export: containerExport,
    summary: {
      measurement_id:    measurementId,
      tags_count:        tags.length,
      triggers_count:    triggers.length,
      skipped,
      phones_included:   allPhoneNumbers,
      emails_included:   allEmails,
    },
  };
}

module.exports = { generateGTMContainerExport };
