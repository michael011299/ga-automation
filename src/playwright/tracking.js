/**
 * src/playwright/tracking.js
 *
 * Thin wrapper around the existing health.runners.js tracking engine.
 *
 * The full tracking health-check logic lives in health.runners.js
 * (trackingHealthCheckSite). This module provides a clean import path for the
 * orchestrator so it does not need to reach into health.runners.js directly.
 *
 * Exported function:
 *   runTrackingHealthCheck(website_url)
 *     → Runs the full GA4 / GTM beacon check against the live site.
 *     → Returns the health check result object from health.runners.js:
 *         { website_url, grade, health_status, health_reasons, events_tracked, ... }
 *     → grade is one of: "T1" | "T2" | "T3" | "Partial" | "FAIL"
 */

const { trackingHealthCheckSite } = require("../../health.runners");

/**
 * Run the GA4 tracking health check on a live website.
 *
 * Launches a Chromium browser internally (via health.runners.js) to:
 *   - Visit the homepage and check for GA4/GTM beacons
 *   - Click phone numbers (click_call events)
 *   - Click email links (click_emails events)
 *   - Submit the contact form (contact_form event)
 *
 * @param {string} website_url — the client site URL to test
 * @returns {Object} health check result from health.runners.js
 */
async function runTrackingHealthCheck(website_url) {
  console.log(`🔬 Running tracking health check: ${website_url}`);
  const result = await trackingHealthCheckSite(website_url);
  console.log(`✅ Tracking health check complete: grade=${result.grade} status=${result.health_status}`);
  return result;
}

module.exports = { runTrackingHealthCheck };
