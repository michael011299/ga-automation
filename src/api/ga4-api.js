/**
 * src/api/ga4-api.js
 *
 * GA4 Admin API calls — all HTTP, no browser.
 * Requires a valid OAuth2 access token for the Google account that owns the GA4 property.
 *
 * Functions:
 *
 *   createConversionEvents(accessToken, propertyId)
 *     → Registers click_call, click_email, contact_form as conversion events
 *
 *   linkGoogleAds(accessToken, propertyId, cid)
 *     → Links the GA4 property to a Google Ads customer account (CID)
 *     → No-op if cid is empty/null
 *
 * GA4 Admin API docs:
 *   https://developers.google.com/analytics/devguides/config/admin/v1
 */

const axios = require("axios");

const GA4_API_BASE = "https://analyticsadmin.googleapis.com/v1beta";

// The three conversion events registered on every new GA4 property.
const CONVERSION_EVENTS = ["click_call", "click_email", "contact_form"];

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the GA4 Admin API.
 *
 * @param {string} method — HTTP method
 * @param {string} path   — path relative to GA4_API_BASE
 * @param {string} token  — OAuth2 access token
 * @param {Object} [body] — request body
 * @returns {Object} response data
 */
async function ga4Request(method, path, token, body) {
  const url = `${GA4_API_BASE}${path}`;
  try {
    const response = await axios({
      method,
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: body,
    });
    return response.data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`GA4 API ${method} ${path} failed: ${detail}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Conversion events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register click_call, click_email, and contact_form as conversion events
 * on the GA4 property.
 *
 * GA4 deduplicates conversion events — if an event already exists it will
 * respond with a 409. We treat 409 as a success (already registered).
 *
 * @param {string} accessToken
 * @param {string} propertyId — numeric GA4 property ID (e.g. "123456789")
 */
async function createConversionEvents(accessToken, propertyId) {
  console.log(`📊 Registering GA4 conversion events on property ${propertyId}...`);

  for (const eventName of CONVERSION_EVENTS) {
    try {
      await ga4Request("POST", `/properties/${propertyId}/conversionEvents`, accessToken, {
        eventName,
      });
      console.log(`✅ Conversion event registered: ${eventName}`);
    } catch (err) {
      // 409 = already exists — safe to ignore
      if (err.message.includes("409") || err.message.toLowerCase().includes("already exists")) {
        console.log(`ℹ️ Conversion event already registered: ${eventName}`);
      } else {
        throw err;
      }
    }
  }

  console.log("✅ All conversion events registered");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Google Ads link
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Link the GA4 property to a Google Ads customer account.
 *
 * If cid is empty or null this function is a no-op (some cases do not have an
 * Ads account yet).
 *
 * @param {string} accessToken
 * @param {string} propertyId — numeric GA4 property ID
 * @param {string|null} cid   — Google Ads customer ID (10-digit, with or without hyphens)
 */
async function linkGoogleAds(accessToken, propertyId, cid) {
  if (!cid) {
    console.log("ℹ️ No CID provided — skipping Google Ads link");
    return;
  }

  // Normalise CID: strip hyphens, keep digits only
  const customerId = String(cid).replace(/\D/g, "");

  if (!customerId) {
    console.log("ℹ️ CID is blank after normalisation — skipping Google Ads link");
    return;
  }

  console.log(`🔗 Linking GA4 property ${propertyId} to Google Ads CID ${customerId}...`);

  try {
    await ga4Request("POST", `/properties/${propertyId}/googleAdsLinks`, accessToken, {
      customerId,
    });
    console.log("✅ GA4 linked to Google Ads");
  } catch (err) {
    // 409 = already linked — safe to ignore
    if (err.message.includes("409") || err.message.toLowerCase().includes("already exists")) {
      console.log("ℹ️ GA4 already linked to this Google Ads account");
    } else {
      throw err;
    }
  }
}

module.exports = {
  createConversionEvents,
  linkGoogleAds,
};
