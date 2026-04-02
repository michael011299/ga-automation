/**
 * src/lib/google-oauth.js
 *
 * Fetches a short-lived Google OAuth2 access token from a stored refresh token.
 *
 * n8n previously handled OAuth token refresh automatically. Now that API calls
 * (GTM, GA4, Google Ads) run server-side, we refresh tokens ourselves.
 *
 * Flow:
 *   stored refresh_token (in google_accounts table)
 *     → POST https://oauth2.googleapis.com/token
 *     → access_token (valid ~1 hour)
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID      — OAuth client ID from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET  — OAuth client secret from Google Cloud Console
 *
 * How to get refresh tokens:
 *   Option A: n8n CLI
 *     n8n export:credentials --decrypted --output=creds.json
 *     Look for data.oauthTokenData.refresh_token for each "Leadgen N" credential
 *   Option B: Google OAuth Playground (oauth2.googleapis.com/tokeninfo)
 */

const axios = require("axios");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Exchange a refresh token for a fresh access token.
 * Each call makes one HTTP request to Google. Tokens expire in ~3600 seconds.
 *
 * @param {string} refreshToken — the stored refresh_token for a google_accounts row
 * @returns {string} a valid access_token to use in Authorization: Bearer headers
 */
async function getAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error("getAccessToken called with empty refreshToken");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables"
    );
  }

  const response = await axios.post(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const { access_token, error, error_description } = response.data;

  if (error) {
    throw new Error(`Google OAuth token refresh failed: ${error} — ${error_description}`);
  }

  return access_token;
}

/**
 * Get an access token for the shared Google Ads credential.
 * Uses GOOGLE_ADS_REFRESH_TOKEN env var rather than a per-account token.
 *
 * @returns {string} access_token for Google Ads API calls
 */
async function getAdsAccessToken() {
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("Missing GOOGLE_ADS_REFRESH_TOKEN environment variable");
  }
  return getAccessToken(refreshToken);
}

module.exports = { getAccessToken, getAdsAccessToken };
