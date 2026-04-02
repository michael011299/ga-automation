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
 *     → Creates AP G-TAG (googtag), AP Click Call, AP Click Emails, AP Contact Form tags
 *
 * Google Tag Manager API docs:
 *   https://developers.google.com/tag-platform/tag-manager/api/v2
 */

const axios = require("axios");

const GTM_API_BASE = "https://tagmanager.googleapis.com/tagmanager/v2";

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
 *   - "AP Click Emails"  — GA4 event (click_emails), fires on email trigger
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

  // ── AP Click Emails — GA4 event: click_emails ─────────────────────────────
  await gtmRequest("POST", basePath, accessToken, {
    name: "AP Click Emails",
    type: "gaawe",
    parameter: [
      { type: "TEMPLATE", key: "eventName",    value: "click_emails" },
      { type: "TEMPLATE", key: "measurementId", value: measurementId },
    ],
    firingTriggerId: [emailTriggerId],
  });
  console.log("✅ AP Click Emails tag created");

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

module.exports = {
  createWorkspace,
  enableClickVariables,
  createTriggers,
  createTags,
};
