/**
 * src/api/gtm-api.js
 *
 * GTM Tag Manager API v2 calls — all HTTP, no browser.
 * Requires a valid OAuth2 access token for the account that owns the container.
 *
 * Functions (all accept an accessToken param):
 *
 *   createWorkspace(accessToken, { numericAccountId, numericContainerId })
 *     → Creates "AP Tracking Setup" workspace
 *     → Returns workspace_id (numeric string)
 *
 *   enableClickVariables(accessToken, { numericAccountId, numericContainerId, workspaceId })
 *     → Enables CLICK_URL, CLICK_ELEMENT, CLICK_CLASSES, CLICK_ID, CLICK_TEXT, CLICK_TARGET
 *
 *   createTriggers(accessToken, { numericAccountId, numericContainerId, workspaceId })
 *     → Creates "AP Click to Call", "AP Click to Email", "AP Contact Form" triggers
 *     → Returns { callTriggerId, emailTriggerId, formTriggerId }
 *
 *   createTags(accessToken, { numericAccountId, numericContainerId, workspaceId,
 *                              measurementId, callTriggerId, emailTriggerId, formTriggerId })
 *     → Creates AP G-TAG (googtag), AP Click Call, AP Click Email, AP Contact Form tags
 *
 * Google Tag Manager API docs:
 *   https://developers.google.com/tag-platform/tag-manager/api/v2
 */

const axios = require("axios");

const GTM_API_BASE = "https://tagmanager.googleapis.com/tagmanager/v2";

const safeEventName = (name) => name.slice(0, 25);

// The GTM built-in "All Pages" trigger always has this ID — no need to create it.
const ALL_PAGES_TRIGGER_ID = "2147479553";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the GTM API.
 *
 * @param {string} method  — HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path    — path relative to GTM_API_BASE (e.g. "/accounts/123/containers/456/workspaces")
 * @param {string} token   — OAuth2 access token
 * @param {Object} [body]  — request body (omit for GET/DELETE)
 * @returns {Object} response data
 */
async function gtmRequest(method, path, token, body) {
  const url = `${GTM_API_BASE}${path}`;
  const config = {
    method,
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: body,
  };

  try {
    const response = await axios(config);
    return response.data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`GTM API ${method} ${path} failed: ${detail}`);
  }
}

/** Build the base path prefix for a specific workspace. */
function workspacePath(numericAccountId, numericContainerId, workspaceId) {
  return `/accounts/${numericAccountId}/containers/${numericContainerId}/workspaces/${workspaceId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Workspace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the "AP Tracking Setup" workspace in the given container.
 *
 * @param {string} accessToken
 * @param {{ numericAccountId: string, numericContainerId: string }} params
 * @returns {string} workspaceId (numeric string like "3")
 */
async function createWorkspace(accessToken, { numericAccountId, numericContainerId }) {
  console.log("🏗️ Creating GTM workspace: AP Tracking Setup");

  const path = `/accounts/${numericAccountId}/containers/${numericContainerId}/workspaces`;
  const data = await gtmRequest("POST", path, accessToken, {
    name: "AP Tracking Setup",
    description: "Workspace created by AP automation",
  });

  const workspaceId = data.workspaceId;
  if (!workspaceId) throw new Error("GTM createWorkspace: API did not return a workspaceId");

  console.log("✅ Workspace created, ID:", workspaceId);
  return String(workspaceId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Built-in variables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enable the click-related built-in variables needed for the click triggers.
 *
 * Variables enabled: CLICK_URL, CLICK_ELEMENT, CLICK_CLASSES, CLICK_ID,
 *                    CLICK_TEXT, CLICK_TARGET
 *
 * @param {string} accessToken
 * @param {{ numericAccountId: string, numericContainerId: string, workspaceId: string }} params
 */
async function enableClickVariables(accessToken, { numericAccountId, numericContainerId, workspaceId }) {
  console.log("🔧 Enabling click built-in variables...");

  const types = ["CLICK_URL", "CLICK_ELEMENT", "CLICK_CLASSES", "CLICK_ID", "CLICK_TEXT", "CLICK_TARGET"];
  const query = types.map((t) => `type=${t}`).join("&");
  const path = `${workspacePath(numericAccountId, numericContainerId, workspaceId)}/built_in_variables?${query}`;

  await gtmRequest("POST", path, accessToken);
  console.log("✅ Click variables enabled:", types.join(", "));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Triggers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the three AP tracking triggers:
 *   - "AP Click to Call"  — fires on clicks where CLICK_URL contains "tel:"
 *   - "AP Click to Email" — fires on clicks where CLICK_URL contains "mailto:"
 *   - "AP Contact Form"   — fires on all form submissions
 *
 * @param {string} accessToken
 * @param {{ numericAccountId: string, numericContainerId: string, workspaceId: string }} params
 * @returns {{ callTriggerId: string, emailTriggerId: string, formTriggerId: string }}
 */
async function createTriggers(accessToken, { numericAccountId, numericContainerId, workspaceId }) {
  console.log("⚡ Creating GTM triggers...");

  const basePath = `${workspacePath(numericAccountId, numericContainerId, workspaceId)}/triggers`;

  // AP Click to Call — link click where CLICK_URL starts with "tel:"
  const callTrigger = await gtmRequest("POST", basePath, accessToken, {
    name: "AP Click to Call",
    type: "LINK",
    filter: [
      {
        type: "CONTAINS",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
          { type: "TEMPLATE", key: "arg1", value: "tel:" },
        ],
      },
    ],
    waitForTags: { type: "BOOLEAN", value: "false" },
    checkValidation: { type: "BOOLEAN", value: "false" },
    waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
  });
  const callTriggerId = String(callTrigger.triggerId);
  console.log("✅ AP Click to Call trigger ID:", callTriggerId);

  // AP Click to Email — link click where CLICK_URL starts with "mailto:"
  const emailTrigger = await gtmRequest("POST", basePath, accessToken, {
    name: "AP Click to Email",
    type: "LINK",
    filter: [
      {
        type: "CONTAINS",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
          { type: "TEMPLATE", key: "arg1", value: "mailto:" },
        ],
      },
    ],
    waitForTags: { type: "BOOLEAN", value: "false" },
    checkValidation: { type: "BOOLEAN", value: "false" },
    waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
  });
  const emailTriggerId = String(emailTrigger.triggerId);
  console.log("✅ AP Click to Email trigger ID:", emailTriggerId);

  // AP Contact Form — fires on any form submission
  const formTrigger = await gtmRequest("POST", basePath, accessToken, {
    name: "AP Contact Form",
    type: "FORM_SUBMISSION",
    waitForTags: { type: "BOOLEAN", value: "false" },
    checkValidation: { type: "BOOLEAN", value: "false" },
    waitForTagsTimeout: { type: "TEMPLATE", value: "2000" },
  });
  const formTriggerId = String(formTrigger.triggerId);
  console.log("✅ AP Contact Form trigger ID:", formTriggerId);

  return { callTriggerId, emailTriggerId, formTriggerId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Tags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the four AP tracking tags:
 *   - "AP G-TAG"         — Google tag (googtag), fires on All Pages
 *   - "AP Click Call"    — GA4 event (click_call), fires on call trigger
 *   - "AP Click Email"  — GA4 event (click_email), fires on email trigger
 *   - "AP Contact Form"  — GA4 event (contact_form), fires on form trigger
 *
 * @param {string} accessToken
 * @param {{
 *   numericAccountId: string,
 *   numericContainerId: string,
 *   workspaceId: string,
 *   measurementId: string,    — GA4 measurement ID (G-XXXXXXXX)
 *   callTriggerId: string,
 *   emailTriggerId: string,
 *   formTriggerId: string,
 * }} params
 */
async function createTags(accessToken, {
  numericAccountId,
  numericContainerId,
  workspaceId,
  measurementId,
  callTriggerId,
  emailTriggerId,
  formTriggerId,
}) {
  console.log("🏷️ Creating GTM tags...");

  const basePath = `${workspacePath(numericAccountId, numericContainerId, workspaceId)}/tags`;

  // ── AP G-TAG — Google tag, fires on All Pages ─────────────────────────────
  await gtmRequest("POST", basePath, accessToken, {
    name: "AP G-TAG",
    type: "googtag",
    parameter: [
      { type: "TEMPLATE", key: "tagId",    value: measurementId },
      { type: "TEMPLATE", key: "configSettingsTable", value: "" },
    ],
    firingTriggerId: [ALL_PAGES_TRIGGER_ID],
  });
  console.log("✅ AP G-TAG created (fires on All Pages)");

  // ── AP Click Call — GA4 event: click_call ─────────────────────────────────
  await gtmRequest("POST", basePath, accessToken, {
    name: "AP Click Call",
    type: "gaawe",
    parameter: [
      { type: "TEMPLATE", key: "eventName",    value: "click_call" },
      { type: "TEMPLATE", key: "measurementId", value: measurementId },
    ],
    firingTriggerId: [callTriggerId],
  });
  console.log("✅ AP Click Call tag created");

  // ── AP Click Email — GA4 event: click_email ─────────────────────────────
  await gtmRequest("POST", basePath, accessToken, {
    name: "AP Click Email",
    type: "gaawe",
    parameter: [
      { type: "TEMPLATE", key: "eventName",    value: "click_email" },
      { type: "TEMPLATE", key: "measurementId", value: measurementId },
    ],
    firingTriggerId: [emailTriggerId],
  });
  console.log("✅ AP Click Email tag created");

  // ── AP Contact Form — GA4 event: contact_form ─────────────────────────────
  await gtmRequest("POST", basePath, accessToken, {
    name: "AP Contact Form",
    type: "gaawe",
    parameter: [
      { type: "TEMPLATE", key: "eventName",    value: "contact_form" },
      { type: "TEMPLATE", key: "measurementId", value: measurementId },
    ],
    firingTriggerId: [formTriggerId],
  });
  console.log("✅ AP Contact Form tag created");

  console.log("✅ All GTM tags created");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Audit-driven container builder
// ─────────────────────────────────────────────────────────────────────────────

/** Map of social platform names → domain fragments used in Click URL filters */
const SOCIAL_TRIGGER_DOMAINS = {
  "Facebook":     "facebook.com",
  "Instagram":    "instagram.com",
  "X (Twitter)":  "twitter.com",
  "LinkedIn":     "linkedin.com",
  "YouTube":      "youtube.com",
  "TikTok":       "tiktok.com",
  "Pinterest":    "pinterest.com",
  "Snapchat":     "snapchat.com",
  "Threads":      "threads.net",
  "Trustpilot":   "trustpilot.com",
  // Google Maps omitted — not a meaningful conversion CTA
};

/**
 * Helper — create one LINK trigger + one GA4 event tag as a matched pair.
 *
 * @param {string} accessToken
 * @param {string} triggersPath   — full API path to the workspace triggers collection
 * @param {string} tagsPath       — full API path to the workspace tags collection
 * @param {string} triggerName    — display name for the trigger
 * @param {string} clickUrlFilter — substring that {{Click URL}} must contain
 * @param {string} tagName        — display name for the tag
 * @param {string} eventName      — GA4 event name (e.g. "click_call")
 * @param {string} measurementId  — GA4 measurement ID
 * @returns {{ triggerName, tagName }}
 */
async function createLinkTriggerAndTag(
  accessToken, triggersPath, tagsPath,
  triggerName, clickUrlFilter,
  tagName, eventName, measurementId,
) {
  const trigger = await gtmRequest("POST", triggersPath, accessToken, {
    name: triggerName,
    type: "LINK",
    filter: [{
      type: "CONTAINS",
      parameter: [
        { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
        { type: "TEMPLATE", key: "arg1", value: clickUrlFilter },
      ],
    }],
    waitForTags:         { type: "BOOLEAN",  value: "false" },
    checkValidation:     { type: "BOOLEAN",  value: "false" },
    waitForTagsTimeout:  { type: "TEMPLATE", value: "2000"  },
  });

  await gtmRequest("POST", tagsPath, accessToken, {
    name: tagName,
    type: "gaawe",
    parameter: [
      { type: "TEMPLATE", key: "eventName",    value: eventName    },
      { type: "TEMPLATE", key: "measurementId", value: measurementId },
    ],
    firingTriggerId: [String(trigger.triggerId)],
  });

  console.log(`✅ Created trigger "${triggerName}" → tag "${tagName}" (${eventName})`);
  return { triggerName, tagName };
}

/**
 * Dynamically build a GTM workspace with only the triggers and tags that are
 * relevant to what the CTA audit found on the site.
 *
 * Always created:
 *   - "AP Tracking Setup" workspace
 *   - Click built-in variables (CLICK_URL, CLICK_ELEMENT, …)
 *   - AP G-TAG (Google tag, fires on All Pages)
 *
 * Created only if the audit found them:
 *   - click_call        — if clickable tel: links exist
 *   - click_email      — if clickable mailto: links exist
 *   - contact_form      — if contact forms exist
 *   - click_whatsapp    — if WhatsApp links exist
 *   - click_social_X    — one per social platform found (Facebook, Instagram, …)
 *   - click_book_cta    — per unique booking CTA destination path / platform domain
 *
 * @param {string} accessToken
 * @param {{
 *   numericAccountId:   string,
 *   numericContainerId: string,
 *   measurementId:      string,  — GA4 measurement ID e.g. "G-XXXXXXXXXX"
 *   audit:              Object,  — full result from ctaAuditSite()
 * }} params
 * @returns {{ workspace_id, triggers: string[], tags: string[], skipped: string[] }}
 */
async function buildContainerFromAudit(accessToken, {
  numericAccountId,
  numericContainerId,
  measurementId,
  audit,
}) {
  const pages = audit.pages || [];

  // ── Aggregate findings across all crawled pages ───────────────────────────
  const hasClickablePhone   = pages.some(p => p.phones?.clickable?.length > 0);
  const hasClickableEmail   = pages.some(p => p.emails?.clickable?.length > 0);
  const hasForms            = pages.some(p => p.forms?.length > 0);
  const hasWhatsApp         = pages.some(p => p.whatsapp?.links?.length > 0);

  // Unique social platforms (only those in our trigger domain map)
  const socialPlatforms = [
    ...new Set(pages.flatMap(p => (p.social_links || []).map(s => s.platform)))
  ].filter(p => SOCIAL_TRIGGER_DOMAINS[p]);

  // Booking CTAs — deduplicate by destination key (hostname for platforms, pathname for same-site)
  const bookingCTAs = pages.flatMap(p => p.booking_ctas || []).filter(c => c.destination_type !== "error");
  const bookingDestinationsSeen = new Set();
  const dedupedBookingCTAs = bookingCTAs.filter(cta => {
    try {
      const key = cta.destination_type === "booking_platform"
        ? new URL(cta.final_url).hostname
        : new URL(cta.final_url).pathname;
      if (bookingDestinationsSeen.has(key)) return false;
      bookingDestinationsSeen.add(key);
      return true;
    } catch { return false; }
  });

  const created  = { workspace_id: null, triggers: [], tags: [], skipped: [] };

  // ── 1. Workspace ──────────────────────────────────────────────────────────
  const workspaceId = await createWorkspace(accessToken, { numericAccountId, numericContainerId });
  created.workspace_id = workspaceId;

  // ── 2. Click built-in variables ───────────────────────────────────────────
  await enableClickVariables(accessToken, { numericAccountId, numericContainerId, workspaceId });

  const basePath     = workspacePath(numericAccountId, numericContainerId, workspaceId);
  const triggersPath = `${basePath}/triggers`;
  const tagsPath     = `${basePath}/tags`;

  // ── 3. AP G-TAG (always) ──────────────────────────────────────────────────
  await gtmRequest("POST", tagsPath, accessToken, {
    name: "AP G-TAG",
    type: "googtag",
    parameter: [
      { type: "TEMPLATE", key: "tagId",               value: measurementId },
      { type: "TEMPLATE", key: "configSettingsTable",  value: ""           },
    ],
    firingTriggerId: [ALL_PAGES_TRIGGER_ID],
  });
  created.tags.push("AP G-TAG");
  console.log("✅ AP G-TAG created");

  // ── 4. Click to Call ──────────────────────────────────────────────────────
  if (hasClickablePhone) {
    const r = await createLinkTriggerAndTag(
      accessToken, triggersPath, tagsPath,
      "AP Click to Call", "tel:",
      "AP Click Call", "click_call", measurementId,
    );
    created.triggers.push(r.triggerName);
    created.tags.push(r.tagName);
  } else {
    created.skipped.push("click_call (no clickable tel: links found)");
  }

  // ── 5. Click to Email ─────────────────────────────────────────────────────
  if (hasClickableEmail) {
    const r = await createLinkTriggerAndTag(
      accessToken, triggersPath, tagsPath,
      "AP Click to Email", "mailto:",
      "AP Click Email", "click_email", measurementId,
    );
    created.triggers.push(r.triggerName);
    created.tags.push(r.tagName);
  } else {
    created.skipped.push("click_email (no clickable mailto: links found)");
  }

  // ── 6. Contact Form ───────────────────────────────────────────────────────
  if (hasForms) {
    const formTrigger = await gtmRequest("POST", triggersPath, accessToken, {
      name: "AP Contact Form",
      type: "FORM_SUBMISSION",
      waitForTags:        { type: "BOOLEAN",  value: "false" },
      checkValidation:    { type: "BOOLEAN",  value: "false" },
      waitForTagsTimeout: { type: "TEMPLATE", value: "2000"  },
    });
    created.triggers.push("AP Contact Form");

    await gtmRequest("POST", tagsPath, accessToken, {
      name: "AP Contact Form",
      type: "gaawe",
      parameter: [
        { type: "TEMPLATE", key: "eventName",     value: "contact_form"  },
        { type: "TEMPLATE", key: "measurementId",  value: measurementId  },
      ],
      firingTriggerId: [String(formTrigger.triggerId)],
    });
    created.tags.push("AP Contact Form");
    console.log("✅ Created trigger \"AP Contact Form\" → tag \"AP Contact Form\" (contact_form)");
  } else {
    created.skipped.push("contact_form (no contact forms found)");
  }

  // ── 7. WhatsApp ───────────────────────────────────────────────────────────
  if (hasWhatsApp) {
    const r = await createLinkTriggerAndTag(
      accessToken, triggersPath, tagsPath,
      "AP Click WhatsApp", "wa.me",
      "AP Click WhatsApp", "click_whatsapp", measurementId,
    );
    created.triggers.push(r.triggerName);
    created.tags.push(r.tagName);
  } else {
    created.skipped.push("click_whatsapp (no WhatsApp links found)");
  }

  // ── 8. Social platforms ───────────────────────────────────────────────────
  for (const platform of socialPlatforms) {
    const domain    = SOCIAL_TRIGGER_DOMAINS[platform];
    const eventName = platform === "X (Twitter)"
      ? "click_social_x_twitter"
      : safeEventName(`click_social_${platform.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`);

    const r = await createLinkTriggerAndTag(
      accessToken, triggersPath, tagsPath,
      `AP Click ${platform}`, domain,
      `AP Click ${platform}`, eventName, measurementId,
    );
    created.triggers.push(r.triggerName);
    created.tags.push(r.tagName);
  }

  // ── 9. Booking CTAs ───────────────────────────────────────────────────────
  for (const cta of dedupedBookingCTAs) {
    try {
      if (cta.destination_type === "booking_platform") {
        const hostname  = new URL(cta.final_url).hostname;
        const safePlat  = (cta.platform || hostname).replace(/[^a-zA-Z0-9]/g, "_");
        const eventName = safeEventName(`click_booking_${safePlat.toLowerCase()}`);
        const r = await createLinkTriggerAndTag(
          accessToken, triggersPath, tagsPath,
          `AP Book CTA - ${cta.platform}`, hostname,
          `AP Click Book - ${cta.platform}`, eventName, measurementId,
        );
        created.triggers.push(r.triggerName);
        created.tags.push(r.tagName);
      } else {
        // same_site_page or same_site_form — trigger on the destination path
        const path     = new URL(cta.final_url).pathname;
        const safePath = path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "") || "root";
        const r = await createLinkTriggerAndTag(
          accessToken, triggersPath, tagsPath,
          `AP Book CTA - ${path}`, path,
          `AP Click Book CTA - ${safePath}`, `click_book_cta_${safePath}`, measurementId,
        );
        created.triggers.push(r.triggerName);
        created.tags.push(r.tagName);
      }
    } catch (err) {
      console.warn(`⚠️ Skipping booking CTA "${cta.link_text}": ${err.message}`);
      created.skipped.push(`booking CTA "${cta.link_text}" — ${err.message}`);
    }
  }

  if (dedupedBookingCTAs.length === 0) {
    created.skipped.push("click_book_cta (no booking CTAs found)");
  }

  console.log(`✅ buildContainerFromAudit complete — ${created.tags.length} tags, ${created.triggers.length} triggers`);
  return created;
}

module.exports = {
  createWorkspace,
  enableClickVariables,
  createTriggers,
  createTags,
  buildContainerFromAudit,
};
