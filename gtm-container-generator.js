/**
 * gtm-container-generator.js
 *
 * Generates a GTM container export JSON structurally identical to a real
 * GTM Admin → Export Container file (exportFormatVersion 2).
 * Import via GTM Admin → Import Container → save the top-level "container"
 * field from the API response as a .json file.
 */

"use strict";

// Built-in GTM trigger IDs (these always exist in every container)
const DOM_READY_TRIGGER_ID     = "2147479572";
const WINDOW_LOADED_TRIGGER_ID = "2147479573";

const SOCIAL_TRIGGER_DOMAINS = {
  Facebook:      "facebook.com",
  Instagram:     "instagram.com",
  "X (Twitter)": "twitter.com",
  LinkedIn:      "linkedin.com",
  YouTube:       "youtube.com",
  TikTok:        "tiktok.com",
  Pinterest:     "pinterest.com",
  Snapchat:      "snapchat.com",
  Threads:       "threads.net",
  Trustpilot:    "trustpilot.com",
};

// ---------------------------------------------------------------------------
// Cookie banner HTML — full Consent Mode v2 implementation (matches reference)
// ---------------------------------------------------------------------------
const COOKIE_BANNER_HTML = `<div id="consent-banner" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: white; padding: 30px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 1000; border-radius: 10px; width: 90%; max-width: 400px;">
  <p>We use cookies to improve your experience. By clicking "Accept", you consent to the use of all cookies.</p>
  <button id="accept-button" style="background-color: #4CAF50; color: white; border: none; padding: 10px 20px; cursor: pointer; border-radius: 5px; margin-right: 10px;">Accept</button>
  <button id="reject-button" style="background-color: #F44336; color: white; border: none; padding: 10px 20px; cursor: pointer; border-radius: 5px;">Reject</button>
</div>

<!-- Overlay -->
<div id="consent-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); z-index: 999;"></div>

<!-- Reopen Cookie Settings Button -->
<button id="reopen-banner-button" style="position: fixed; bottom: 20px; left: 20px; background-color: #555; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; display: none; z-index: 1001;">
  Cookie Settings
</button>


<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}

  // Set default consent to 'denied'
  gtag('consent', 'default', {
    'ad_storage': 'denied',
    'ad_user_data': 'denied',
    'ad_personalization': 'denied',
    'analytics_storage': 'denied',
    'functionality_storage': 'denied',
    'personalization_storage': 'denied',
    'security_storage': 'denied'
  });

  // Grant consent
  function grantConsent() {
    gtag('consent', 'update', {
      'ad_storage': 'granted',
      'ad_user_data': 'granted',
      'ad_personalization': 'granted',
      'analytics_storage': 'granted',
      'functionality_storage': 'granted',
      'personalization_storage': 'granted',
      'security_storage': 'granted'
    });

    // Save cookies
    var oneYear = "; path=/; max-age=31536000";
    document.cookie = "ad_storage=granted" + oneYear;
    document.cookie = "ad_user_data=granted" + oneYear;
    document.cookie = "ad_personalization=granted" + oneYear;
    document.cookie = "analytics_storage=granted" + oneYear;
    document.cookie = "functionality_storage=granted" + oneYear;
    document.cookie = "personalization_storage=granted" + oneYear;
    document.cookie = "security_storage=granted" + oneYear;

    // Push custom event to dataLayer
    window.dataLayer.push({
      event: 'all_required_consents_granted'
    });
  }

  // Deny consent
  function denyConsent() {
    gtag('consent', 'update', {
      'ad_storage': 'denied',
      'ad_user_data': 'denied',
      'ad_personalization': 'denied',
      'analytics_storage': 'denied',
      'functionality_storage': 'denied',
      'personalization_storage': 'denied',
      'security_storage': 'denied'
    });

    // Save cookies as denied
    var oneYear = "; path=/; max-age=31536000";
    document.cookie = "ad_storage=denied" + oneYear;
    document.cookie = "ad_user_data=denied" + oneYear;
    document.cookie = "ad_personalization=denied" + oneYear;
    document.cookie = "analytics_storage=denied" + oneYear;
    document.cookie = "functionality_storage=denied" + oneYear;
    document.cookie = "personalization_storage=denied" + oneYear;
    document.cookie = "security_storage=denied" + oneYear;
  }

  // Check if all consents are granted
  function allConsentsGranted() {
    var consents = [
      'ad_storage',
      'ad_user_data',
      'ad_personalization',
      'analytics_storage',
      'functionality_storage',
      'personalization_storage',
      'security_storage'
    ];
    return consents.every(function(consent) {
      return document.cookie.split(';').some(function(item) {
        return item.trim().indexOf(consent + '=granted') === 0;
      });
    });
  }

  // Accept button click
  document.getElementById('accept-button').addEventListener('click', function() {
    grantConsent();
    document.getElementById('consent-banner').style.display = 'none';
    document.getElementById('consent-overlay').style.display = 'none';
    document.getElementById('reopen-banner-button').style.display = 'block';
    window.dataLayer.push({
    event: 'consent_updated',
    ad_storage: 'granted'
    });
  });

  // Reject button click
  document.getElementById('reject-button').addEventListener('click', function() {
    denyConsent();
    document.getElementById('consent-banner').style.display = 'none';
    document.getElementById('consent-overlay').style.display = 'none';
    document.getElementById('reopen-banner-button').style.display = 'block';
    window.dataLayer.push({
    event: 'consent_updated',
    ad_storage: 'denied'
    });
  });

  // Reopen button click
  document.getElementById('reopen-banner-button').addEventListener('click', function() {
    document.getElementById('consent-banner').style.display = 'block';
    document.getElementById('consent-overlay').style.display = 'block';
    document.getElementById('reopen-banner-button').style.display = 'none';
  });

  // Auto-accept if cookies exist
  if (allConsentsGranted()) {
    grantConsent();
    document.getElementById('consent-banner').style.display = 'none';
    document.getElementById('consent-overlay').style.display = 'none';
    document.getElementById('reopen-banner-button').style.display = 'block';
  } else {
    document.getElementById('consent-banner').style.display = 'block';
    document.getElementById('consent-overlay').style.display = 'block';
    document.getElementById('reopen-banner-button').style.display = 'none';
  }
</script>

`;

// ---------------------------------------------------------------------------
// Make Contact Details Clickable HTML
// ---------------------------------------------------------------------------
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
        return '<a href="' + href + '" style="text-decoration: inherit; color: inherit;">' + match + '</a>';
      });
    });

    emails.forEach(function (email) {
      var safeEmail = email.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      text = text.replace(new RegExp(safeEmail, 'gi'), function (match) {
        return '<a href="mailto:' + email + '" style="text-decoration: inherit; color: inherit;">' + match + '</a>';
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
// ID counter
// ---------------------------------------------------------------------------
function makeIdCounter(start) {
  let n = start;
  return () => String(n++);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * @param {Object} audit          — result from ctaAuditSite()
 * @param {string} measurementId  — GA4 measurement ID e.g. "G-XXXXXXXXXX"
 * @param {string} containerName  — display name for the container
 * @param {string} [accountId]    — GTM account ID (cosmetic; defaults to "0")
 * @param {string} [containerId]  — GTM container ID (cosmetic; defaults to "0")
 * @returns {Object}
 */
function generateGTMContainerExport(audit, measurementId, containerName, accountId = "0", containerId = "0") {
  const pages = audit.pages || [];

  // ── Aggregate audit findings ──────────────────────────────────────────────
  const hasClickablePhone    = pages.some((p) => p.phones?.clickable?.length > 0);
  const hasClickableEmail    = pages.some((p) => p.emails?.clickable?.length > 0);
  const hasForms             = pages.some((p) => p.forms?.length > 0);
  const hasHighFrictionForms = pages.some((p) => p.forms?.some((f) => f.friction_level === "high"));
  // Regular forms = forms that are NOT high-friction (high-friction forms get their own dedicated tag)
  const hasRegularForms      = pages.some((p) => p.forms?.some((f) => f.friction_level !== "high"));
  const hasNewsletter        = pages.some((p) => p.newsletter?.length > 0);
  const hasWhatsApp          = pages.some((p) => p.whatsapp?.links?.length > 0);

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

  // Standard fields appended to every tag
  const tagMeta = () => ({
    fingerprint:       nextFp(),
    tagFiringOption:   "ONCE_PER_LOAD",
    monitoringMetadata: { type: "MAP" },
    consentSettings:   { consentStatus: "NOT_SET" },
  });

  // ── Built-in variables (matches reference exactly) ────────────────────────
  const builtInVariables = [
    { accountId, containerId, type: "PAGE_URL",      name: "Page URL" },
    { accountId, containerId, type: "PAGE_HOSTNAME", name: "Page Hostname" },
    { accountId, containerId, type: "PAGE_PATH",     name: "Page Path" },
    { accountId, containerId, type: "REFERRER",      name: "Referrer" },
    { accountId, containerId, type: "EVENT",         name: "Event" },
    { accountId, containerId, type: "CLICK_URL",     name: "Click URL" },
  ];

  // ── Helper: LINK_CLICK trigger ────────────────────────────────────────────
  // Reference: BOOLEAN false for waitForTags/checkValidation, TEMPLATE (no value) for uniqueTriggerId
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
      waitForTags:        { type: "BOOLEAN",  value: "false" },
      checkValidation:    { type: "BOOLEAN",  value: "false" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
      uniqueTriggerId:    { type: "TEMPLATE" },
      fingerprint:        nextFp(),
    });
    return triggerId;
  }

  // ── Helper: FORM_SUBMISSION trigger ───────────────────────────────────────
  // Reference: TEMPLATE (no value) for waitForTags, checkValidation, uniqueTriggerId
  function addFormTrigger(name) {
    const triggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId,
      name,
      type:               "FORM_SUBMISSION",
      waitForTags:        { type: "TEMPLATE" },
      checkValidation:    { type: "TEMPLATE" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
      uniqueTriggerId:    { type: "TEMPLATE" },
      fingerprint:        nextFp(),
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
        { type: "BOOLEAN",  key: "sendEcommerceData",     value: "false" },
        { type: "TEMPLATE", key: "eventName",             value: eventName },
        { type: "TEMPLATE", key: "measurementIdOverride", value: measurementId },
      ],
      firingTriggerId: firingTriggerIds,
      ...tagMeta(),
    });
    return tagId;
  }

  // ── Helper: LINK_CLICK trigger + GA4 event tag pair ───────────────────────
  function addLinkTriggerAndTag(triggerName, urlContains, tagName, eventName) {
    const triggerId = addLinkTrigger(triggerName, urlContains);
    addGA4EventTag(tagName, eventName, [triggerId]);
  }

  // ── AP G-TAG (fires on Window Loaded — matches reference) ─────────────────
  tags.push({
    ...meta,
    tagId: nextTagId(),
    name:  "AP G-TAG",
    type:  "googtag",
    parameter: [
      { type: "TEMPLATE", key: "tagId", value: measurementId },
    ],
    firingTriggerId: [WINDOW_LOADED_TRIGGER_ID],
    ...tagMeta(),
    tagFiringOption: "ONCE_PER_EVENT",
  });

  // ── AP Cookie Banner (fires on DOM Ready — matches reference, paused) ──────
  tags.push({
    ...meta,
    tagId: nextTagId(),
    name:  "AP Cookie Banner",
    type:  "html",
    parameter: [
      { type: "TEMPLATE", key: "html",                 value: COOKIE_BANNER_HTML },
      { type: "BOOLEAN",  key: "supportDocumentWrite", value: "false" },
    ],
    firingTriggerId: [DOM_READY_TRIGGER_ID],
    paused: true,
    ...tagMeta(),
    tagFiringOption: "ONCE_PER_EVENT",
  });

  // ── AP Make Contact Details Clickable (custom Window Loaded trigger) ───────
  if (allPhoneNumbers.length > 0 || allEmails.length > 0) {
    // Create a custom Window Loaded trigger — matches reference structure
    const windowLoadedTriggerId = nextTriggerId();
    triggers.push({
      ...meta,
      triggerId:   windowLoadedTriggerId,
      name:        "Window Loaded",
      type:        "WINDOW_LOADED",
      fingerprint: nextFp(),
    });

    tags.push({
      ...meta,
      tagId: nextTagId(),
      name:  "AP Make Contact Details Clickable",
      type:  "html",
      priority: { type: "INTEGER", value: "3" },
      parameter: [
        { type: "TEMPLATE", key: "html",                 value: buildMakeClickableHTML(allPhoneNumbers, allEmails) },
        { type: "BOOLEAN",  key: "supportDocumentWrite", value: "false" },
      ],
      firingTriggerId: [windowLoadedTriggerId],
      ...tagMeta(),
      tagFiringOption: "UNLIMITED",
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
    addLinkTriggerAndTag("AP Click to Email", "mailto:", "AP Click Email", "click_email");
  } else {
    skipped.push("click_email — no clickable mailto: links found on site");
  }

  // ── Contact Form ──────────────────────────────────────────────────────────
  // Only create for regular (non-high-friction) forms. High-friction forms are
  // tracked via form_submit_high_friction to avoid the same submission firing
  // two separate form conversion events into GA4.
  if (hasRegularForms) {
    addGA4EventTag("AP Contact Form", "contact_form", [addFormTrigger("AP Contact Form")]);
  } else if (!hasForms) {
    skipped.push("contact_form — no contact forms found on site");
  } else {
    skipped.push("contact_form — all forms are high-friction (tracked via form_submit_high_friction)");
  }

  // ── High-Friction Form Tracking ───────────────────────────────────────────
  if (hasHighFrictionForms) {
    // form_view fires when the form scrolls 50% into the viewport — this is a
    // scroll/visibility event and is intentionally distinct from GA4's native
    // form_start (which fires on first field interaction via Enhanced Measurement).
    // Naming it form_view avoids any conflict with the native form_start event.
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
    addGA4EventTag("AP Form View (High Friction)", "form_view", [visibilityTriggerId]);
    addGA4EventTag("AP Form Submit (High Friction)", "form_submit_high_friction", [addFormTrigger("AP Form Submit (High Friction)")]);
  } else {
    skipped.push("form_view / form_submit_high_friction — no high-friction forms (5+ fields) found on site");
  }

  // ── Newsletter Form ────────────────────────────────────────────────────────
  if (hasNewsletter) {
    addGA4EventTag("AP Newsletter Form", "newsletter_signup", [addFormTrigger("AP Newsletter Form")]);
  } else {
    skipped.push("newsletter_signup — no newsletter forms found on site");
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (hasWhatsApp) {
    addLinkTriggerAndTag("AP Click WhatsApp", "wa.me", "AP Click WhatsApp", "click_whatsapp");
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
          const hostname     = new URL(cta.final_url).hostname;
          const safePlatform = (cta.platform || hostname).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
          addLinkTriggerAndTag(
            `AP Book CTA - ${cta.platform || hostname}`,
            hostname,
            `AP Click Book - ${cta.platform || hostname}`,
            `click_booking_${safePlatform}`,
          );
        } else {
          const path = new URL(cta.final_url).pathname;
          const safePath = path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "") || "root";
          addLinkTriggerAndTag(
            `AP Book CTA - ${path}`,
            path,
            `AP Click Book CTA - ${safePath}`,
            `click_book_cta_${safePath}`,
          );
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

  // ── Deduplicate tag/trigger names (GTM rejects duplicates) ───────────────
  const dedup = (items, key) => {
    const seen = new Map();
    items.forEach(item => {
      const base = item[key];
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      if (count > 0) item[key] = `${base} (${count})`;
    });
  };
  dedup(tags, "name");
  dedup(triggers, "name");

  // ── Assemble export JSON ──────────────────────────────────────────────────
  const exportTime = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");

  const containerPath    = `accounts/${accountId}/containers/${containerId}`;
  const containerVerPath = `${containerPath}/versions/0`;

  const containerExport = {
    exportFormatVersion: 2,
    exportTime,
    containerVersion: {
      path:               containerVerPath,
      accountId,
      containerId,
      containerVersionId: "0",
      container: {
        path:         containerPath,
        accountId,
        containerId,
        name:         containerName || "AP Tracking Setup",
        usageContext: ["WEB"],
        fingerprint:  nextFp(),
        tagManagerUrl: `https://tagmanager.google.com/#/container/${containerPath}/workspaces?apiLink=container`,
        features: {
          supportUserPermissions:  true,
          supportEnvironments:     true,
          supportWorkspaces:       true,
          supportGtagConfigs:      false,
          supportBuiltInVariables: true,
          supportClients:          false,
          supportFolders:          true,
          supportTags:             true,
          supportTemplates:        true,
          supportTriggers:         true,
          supportVariables:        true,
          supportVersions:         true,
          supportZones:            true,
          supportTransformations:  false,
        },
      },
      tag:             tags,
      trigger:         triggers,
      builtInVariable: builtInVariables,
      fingerprint:     nextFp(),
      tagManagerUrl:   `https://tagmanager.google.com/#/versions/${containerVerPath}?apiLink=version`,
    },
  };

  return {
    export: containerExport,
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
