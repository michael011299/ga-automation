/**
 * src/api/google-ads-api.js
 *
 * Google Ads API v17 — creates conversion actions for a client account.
 * All HTTP, no browser.
 *
 * Required env vars:
 *   GOOGLE_ADS_DEVELOPER_TOKEN   — developer token (4DkVyyBUvjMbEDOgbE9QBQ)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — MCC/manager account ID (7651196543)
 *
 * The OAuth2 access token is passed in at call time (obtained via getAdsAccessToken()
 * in src/lib/google-oauth.js).
 *
 * Exported function:
 *
 *   createConversionActions(accessToken, cid)
 *     → Creates AP Click Call, AP Click Email, AP Contact Form conversion actions
 *       on the customer account identified by cid.
 *     → No-op if cid is empty/null.
 *
 * Google Ads API docs:
 *   https://developers.google.com/google-ads/api/docs/conversion-tracking/conversion-actions
 */

const axios = require("axios");

const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com/v17";

// The three conversion actions created for every new client account.
const CONVERSION_ACTION_DEFINITIONS = [
  {
    name: "AP Click Call",
    type: "PHONE_CALL_LEAD",
    category: "DEFAULT",
    status: "ENABLED",
  },
  {
    name: "AP Click Email",
    type: "CONTACT",
    category: "DEFAULT",
    status: "ENABLED",
  },
  {
    name: "AP Contact Form",
    type: "SUBMIT_LEAD_FORM",
    category: "DEFAULT",
    status: "ENABLED",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the Google Ads API.
 *
 * @param {string} method       — HTTP method
 * @param {string} path         — path relative to GOOGLE_ADS_API_BASE
 * @param {string} accessToken  — OAuth2 access token
 * @param {Object} [body]       — request body
 * @param {string} customerId   — the customer account ID (no hyphens)
 * @returns {Object} response data
 */
async function adsRequest(method, path, accessToken, body, customerId) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

  if (!developerToken) throw new Error("Missing GOOGLE_ADS_DEVELOPER_TOKEN env var");
  if (!loginCustomerId) throw new Error("Missing GOOGLE_ADS_LOGIN_CUSTOMER_ID env var");

  const url = `${GOOGLE_ADS_API_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };

  // login-customer-id header is required when accessing a sub-account via MCC
  if (loginCustomerId && customerId && loginCustomerId !== customerId) {
    headers["login-customer-id"] = loginCustomerId;
  }

  try {
    const response = await axios({ method, url, headers, data: body });
    return response.data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Google Ads API ${method} ${path} failed: ${detail}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the AP tracking conversion actions on the given Google Ads account.
 *
 * Actions created:
 *   - AP Click Call    (PHONE_CALL_LEAD)
 *   - AP Click Email  (CONTACT)
 *   - AP Contact Form  (SUBMIT_LEAD_FORM)
 *
 * If cid is empty this function is a no-op (some cases don't have an Ads account).
 *
 * @param {string} accessToken — OAuth2 access token with Google Ads scope
 * @param {string|null} cid    — Google Ads customer ID (with or without hyphens)
 */
async function createConversionActions(accessToken, cid) {
  if (!cid) {
    console.log("ℹ️ No CID provided — skipping Google Ads conversion actions");
    return;
  }

  // Normalise CID: keep digits only
  const customerId = String(cid).replace(/\D/g, "");
  if (!customerId) {
    console.log("ℹ️ CID is blank after normalisation — skipping Google Ads conversion actions");
    return;
  }

  console.log(`💰 Creating Google Ads conversion actions for CID ${customerId}...`);

  // Use the mutate endpoint to create all three actions in one batch request.
  // Each operation is a CREATE on a ConversionAction resource.
  const operations = CONVERSION_ACTION_DEFINITIONS.map((action) => ({
    create: {
      name: action.name,
      type: action.type,
      category: action.category,
      status: action.status,
      // Use the same attribution model as account default
      attributionModelSettings: {
        attributionModel: "GOOGLE_ADS_LAST_CLICK",
      },
    },
  }));

  const body = {
    operations,
    partialFailure: true, // don't fail the whole batch if one already exists
  };

  const data = await adsRequest(
    "POST",
    `/customers/${customerId}/conversionActions:mutate`,
    accessToken,
    body,
    customerId
  );

  // Log individual results
  const results = data.results || [];
  for (let i = 0; i < results.length; i++) {
    const actionName = CONVERSION_ACTION_DEFINITIONS[i]?.name || `action[${i}]`;
    const resourceName = results[i]?.resourceName;
    console.log(`✅ ${actionName}: ${resourceName}`);
  }

  // Log any partial failures (e.g. duplicate names)
  if (data.partialFailureError) {
    const errors = data.partialFailureError.details || [];
    for (const err of errors) {
      console.log(`⚠️ Partial failure:`, JSON.stringify(err));
    }
  }

  console.log("✅ Google Ads conversion actions created");
}

module.exports = { createConversionActions };
