/**
 * gtm-payload-generator.js
 *
 * Generates an ordered list of Google Tag Manager API v2 calls needed to build
 * a complete workspace from a CTA audit result.
 *
 * Each step contains:
 *   - method  : HTTP method to use
 *   - url     : full GTM API URL ({{workspace_id}} etc. are placeholders)
 *   - headers : exact headers to send (substitute {{access_token}} yourself)
 *   - body    : exact JSON body to POST (or null for parameterless POSTs)
 *   - save_as           : variable name to store from the response (null = nothing to save)
 *   - save_from_response: dot-path to the field in the response to save (e.g. "workspaceId")
 *
 * In n8n: execute steps in order. After any step with save_as, use a Set Variable
 * or Code node to capture response[save_from_response] into a workflow variable,
 * then substitute it into subsequent {{placeholder}} URLs/bodies.
 */

const GTM_API_BASE = "https://tagmanager.googleapis.com/tagmanager/v2";

const safeEventName = (name) => name.slice(0, 25);
const ALL_PAGES_TRIGGER_ID = "2147479553"; // GTM built-in — always exists, never needs creating

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

/**
 * Build the full ordered GTM API call sequence from a CTA audit result.
 *
 * @param {Object} audit          — result from ctaAuditSite() / POST /health/audit
 * @param {string} measurementId  — GA4 measurement ID, e.g. "G-XXXXXXXXXX"
 * @param {string} accountId      — GTM numeric account ID
 * @param {string} containerId    — GTM numeric container ID
 * @returns {Object}              — { summary, steps[] }
 */
function generateGTMPayload(audit, measurementId, accountId, containerId) {
  const pages   = audit.pages || [];
  const base    = `${GTM_API_BASE}/accounts/${accountId}/containers/${containerId}`;
  const wsBase  = `${base}/workspaces/{{workspace_id}}`;

  // ── Aggregate audit findings ─────────────────────────────────────────────
  const hasClickablePhone = pages.some(p => p.phones?.clickable?.length > 0);
  const hasClickableEmail = pages.some(p => p.emails?.clickable?.length > 0);
  const hasForms          = pages.some(p => p.forms?.length > 0);
  const hasWhatsApp       = pages.some(p => p.whatsapp?.links?.length > 0);

  const socialPlatforms = [
    ...new Set(pages.flatMap(p => (p.social_links || []).map(s => s.platform)))
  ].filter(p => SOCIAL_TRIGGER_DOMAINS[p]);

  // Deduplicate booking CTAs by destination key
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

  // ── Build step list ───────────────────────────────────────────────────────
  const steps   = [];
  const skipped = [];
  let   stepNum = 1;

  const authHeader = {
    "Authorization": "Bearer {{access_token}}",
    "Content-Type": "application/json",
  };

  // Helper — push a trigger step + a tag step as a matched pair
  const addLinkTriggerAndTag = (triggerName, urlFilter, tagName, eventName, saveAs) => {
    steps.push({
      step: stepNum++,
      description: `Create trigger: ${triggerName}`,
      method: "POST",
      url: `${wsBase}/triggers`,
      headers: authHeader,
      body: {
        name: triggerName,
        type: "LINK",
        filter: [{
          type: "CONTAINS",
          parameter: [
            { type: "TEMPLATE", key: "arg0", value: "{{Click URL}}" },
            { type: "TEMPLATE", key: "arg1", value: urlFilter },
          ],
        }],
        waitForTags:        { type: "BOOLEAN",  value: "false" },
        checkValidation:    { type: "BOOLEAN",  value: "false" },
        waitForTagsTimeout: { type: "TEMPLATE", value: "2000"  },
      },
      save_as: saveAs,
      save_from_response: "triggerId",
    });

    steps.push({
      step: stepNum++,
      description: `Create tag: ${tagName} → GA4 event "${eventName}"`,
      method: "POST",
      url: `${wsBase}/tags`,
      headers: authHeader,
      body: {
        name: tagName,
        type: "gaawe",
        parameter: [
          { type: "TEMPLATE", key: "eventName",     value: eventName     },
          { type: "TEMPLATE", key: "measurementId", value: measurementId },
        ],
        firingTriggerId: [`{{${saveAs}}}`],
      },
      save_as: null,
      save_from_response: null,
    });
  };

  // ── Step 1: Create workspace ──────────────────────────────────────────────
  steps.push({
    step: stepNum++,
    description: "Create workspace 'AP Tracking Setup'",
    method: "POST",
    url: `${base}/workspaces`,
    headers: authHeader,
    body: {
      name: "AP Tracking Setup",
      description: "Workspace created by AP automation",
    },
    save_as: "workspace_id",
    save_from_response: "workspaceId",
  });

  // ── Step 2: Enable click built-in variables ───────────────────────────────
  const clickVarTypes = ["CLICK_URL", "CLICK_ELEMENT", "CLICK_CLASSES", "CLICK_ID", "CLICK_TEXT", "CLICK_TARGET"];
  steps.push({
    step: stepNum++,
    description: "Enable click built-in variables (CLICK_URL, CLICK_ELEMENT, CLICK_CLASSES, CLICK_ID, CLICK_TEXT, CLICK_TARGET)",
    method: "POST",
    url: `${wsBase}/built_in_variables?${clickVarTypes.map(t => `type=${t}`).join("&")}`,
    headers: authHeader,
    body: null,
    save_as: null,
    save_from_response: null,
  });

  // ── Step 3: AP G-TAG (always) ─────────────────────────────────────────────
  steps.push({
    step: stepNum++,
    description: `Create AP G-TAG (Google tag, measurement ID: ${measurementId}, fires on All Pages)`,
    method: "POST",
    url: `${wsBase}/tags`,
    headers: authHeader,
    body: {
      name: "AP G-TAG",
      type: "googtag",
      parameter: [
        { type: "TEMPLATE", key: "tagId",              value: measurementId },
        { type: "TEMPLATE", key: "configSettingsTable", value: ""           },
      ],
      firingTriggerId: [ALL_PAGES_TRIGGER_ID],
    },
    save_as: null,
    save_from_response: null,
  });

  // ── Click to Call ─────────────────────────────────────────────────────────
  if (hasClickablePhone) {
    addLinkTriggerAndTag("AP Click to Call", "tel:", "AP Click Call", "click_call", "call_trigger_id");
  } else {
    skipped.push("click_call — no clickable tel: links found on site");
  }

  // ── Click to Email ────────────────────────────────────────────────────────
  if (hasClickableEmail) {
    addLinkTriggerAndTag("AP Click to Email", "mailto:", "AP Click Email", "click_email", "email_trigger_id");
  } else {
    skipped.push("click_email — no clickable mailto: links found on site");
  }

  // ── Contact Form ──────────────────────────────────────────────────────────
  if (hasForms) {
    steps.push({
      step: stepNum++,
      description: "Create trigger: AP Contact Form (fires on any form submission)",
      method: "POST",
      url: `${wsBase}/triggers`,
      headers: authHeader,
      body: {
        name: "AP Contact Form",
        type: "FORM_SUBMISSION",
        waitForTags:        { type: "BOOLEAN",  value: "false" },
        checkValidation:    { type: "BOOLEAN",  value: "false" },
        waitForTagsTimeout: { type: "TEMPLATE", value: "2000"  },
      },
      save_as: "form_trigger_id",
      save_from_response: "triggerId",
    });

    steps.push({
      step: stepNum++,
      description: 'Create tag: AP Contact Form → GA4 event "contact_form"',
      method: "POST",
      url: `${wsBase}/tags`,
      headers: authHeader,
      body: {
        name: "AP Contact Form",
        type: "gaawe",
        parameter: [
          { type: "TEMPLATE", key: "eventName",     value: "contact_form" },
          { type: "TEMPLATE", key: "measurementId", value: measurementId  },
        ],
        firingTriggerId: ["{{form_trigger_id}}"],
      },
      save_as: null,
      save_from_response: null,
    });
  } else {
    skipped.push("contact_form — no contact forms found on site");
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (hasWhatsApp) {
    addLinkTriggerAndTag("AP Click WhatsApp", "wa.me", "AP Click WhatsApp", "click_whatsapp", "whatsapp_trigger_id");
  } else {
    skipped.push("click_whatsapp — no WhatsApp links found on site");
  }

  // ── Social platforms ──────────────────────────────────────────────────────
  socialPlatforms.forEach((platform, i) => {
    const domain    = SOCIAL_TRIGGER_DOMAINS[platform];
    const eventName = platform === "X (Twitter)"
      ? "click_social_x_twitter"
      : safeEventName(`click_social_${platform.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`);
    addLinkTriggerAndTag(
      `AP Click ${platform}`, domain,
      `AP Click ${platform}`, eventName,
      `social_trigger_${i}`,
    );
  });

  // ── Booking CTAs ──────────────────────────────────────────────────────────
  if (dedupedBookingCTAs.length === 0) {
    skipped.push("click_book_cta — no booking CTAs found on site");
  } else {
    dedupedBookingCTAs.forEach((cta, i) => {
      try {
        if (cta.destination_type === "booking_platform") {
          const hostname  = new URL(cta.final_url).hostname;
          const eventName = safeEventName(`click_booking_${(cta.platform || hostname).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`);
          addLinkTriggerAndTag(
            `AP Book CTA - ${cta.platform}`, hostname,
            `AP Click Book - ${cta.platform}`, eventName,
            `booking_trigger_${i}`,
          );
        } else {
          const path     = new URL(cta.final_url).pathname;
          const safePath = path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "") || "root";
          addLinkTriggerAndTag(
            `AP Book CTA - ${path}`, path,
            `AP Click Book CTA - ${safePath}`, `click_book_cta_${safePath}`,
            `booking_trigger_${i}`,
          );
        }
      } catch (e) {
        skipped.push(`booking CTA "${cta.link_text}" — ${e.message}`);
      }
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const triggerSteps = steps.filter(s => s.url.includes("/triggers"));
  const tagSteps     = steps.filter(s => s.url.includes("/tags"));

  return {
    measurement_id: measurementId,
    account_id:     accountId,
    container_id:   containerId,
    total_steps:    steps.length,
    triggers_count: triggerSteps.length,
    tags_count:     tagSteps.length,
    skipped,
    instructions: {
      overview: [
        "Execute each step in order using HTTP Request nodes in n8n (or any HTTP client).",
        "After Step 1, save the 'workspaceId' field from the response — every subsequent URL contains {{workspace_id}}.",
        "After each step with save_as set, save response[save_from_response] into that variable name.",
        "Replace {{placeholders}} in URLs and body firingTriggerId arrays with the saved values.",
        "Replace {{access_token}} with a valid OAuth2 access token for the Google account that owns this container.",
        "All steps use Content-Type: application/json. Body is null for the built-in variables step — send an empty POST.",
      ],
      n8n_tip: "Use a 'Code' node after each trigger creation step to extract triggerId from the response, store it in $vars or $workflow.vars, then reference it in the next HTTP Request body using an expression.",
    },
    steps,
  };
}

module.exports = { generateGTMPayload };
