const express = require("express");
const { chromium } = require("playwright");
const { trackingHealthCheckSite, runBatchHealthCheck, getBatchJob } = require("./health.runners");
const { ctaAuditSite, getBrowser } = require("./cta-audit.runners");
const { loginToGoogle } = require("./src/playwright/google-login");
const crypto = require("crypto");
const router = express.Router();

router.post("/run", async (req, res) => {
  const { action, url, expected } = req.body || {};

  if (action !== "tracking_health_check_site") {
    return res.status(400).json({ ok: false, error: "Unknown action" });
  }

  if (!url) {
    return res.status(400).json({ ok: false, error: "URL is required" });
  }

  try {
    console.log(`Received health check request for: ${url}`);

    // Call the health runner function
    const results = await trackingHealthCheckSite(url);

    // Return results
    return res.json({
      ok: true,
      ...results,
      expected: expected ?? null,
    });
  } catch (error) {
    console.error("Health check error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
      url,
    });
  }
});

// Batch health check endpoint
// Accepts either:
//   { clients: [{url, client_name, supabase_id, cid, order_number, ...}], callback_url? }
//   { urls: ["https://..."], callback_url? }  (legacy — plain URL strings)
router.post("/batch", async (req, res) => {
  const { clients, urls, callback_url } = req.body || {};

  // Support both `clients` (objects) and legacy `urls` (strings)
  const input = clients || urls;

  if (!input || !Array.isArray(input)) {
    return res.status(400).json({
      ok: false,
      error: 'Provide either a "clients" array of objects or a "urls" array of strings',
    });
  }

  if (input.length === 0) {
    return res.status(400).json({ ok: false, error: "clients/urls array cannot be empty" });
  }

  if (input.length > 2000) {
    return res.status(400).json({ ok: false, error: "Maximum 2000 clients per batch" });
  }

  // Each entry must be a string URL or an object with a url field
  const invalid = input.find((c) => typeof c !== "string" && (typeof c !== "object" || !c.url));
  if (invalid) {
    return res.status(400).json({
      ok: false,
      error: 'Each entry must be a string URL or an object with a "url" field',
    });
  }

  try {
    const jobId = crypto.randomUUID();
    console.log(`Batch job ${jobId} started — ${input.length} clients`);

    // Fire-and-forget; results accumulate in the job store
    runBatchHealthCheck(jobId, input, callback_url).catch((err) => {
      console.error(`Batch job ${jobId} fatal error:`, err);
    });

    return res.status(202).json({
      ok: true,
      job_id: jobId,
      queued: input.length,
      status_url: `/health/batch/${jobId}`,
      message: "Batch job started",
    });
  } catch (error) {
    console.error("Batch health check error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Get batch job status
router.get("/batch/:job_id", (req, res) => {
  const { job_id } = req.params;

  const job = getBatchJob(job_id);

  if (!job) {
    return res.status(404).json({
      ok: false,
      error: "Job not found",
    });
  }

  return res.json({
    ok: true,
    job_id,
    status: job.status,
    total: job.total,
    completed: job.completed,
    results: job.results,
    startedAt: job.startedAt,
    completedAt: job.status === "complete" ? new Date().toISOString() : null,
  });
});

router.post("/audit", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: "URL is required" });
  try {
    const result = await ctaAuditSite(url);
    return res.json({ ok: true, ...result });
  } catch (e) {
    console.error("CTA audit error:", e);
    return res.status(500).json({ ok: false, error: e.message, url });
  }
});

// GET /health/scrape?url=https://example.com
// Returns the fully-rendered HTML of the given page via Playwright.
router.get("/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: "url query parameter is required" });

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const html = await page.content();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    console.error("Scrape error:", e);
    return res.status(500).json({ ok: false, error: e.message, url });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// POST /health/offboard-ga4
// Body: { email, sso_username, sso_password, account_id, property_id }
//   account_id  — e.g. "283675043" or "accounts/283675043"
//   property_id — e.g. "456789012" or "properties/456789012"
router.post("/offboard-ga4", async (req, res) => {
  const { email, sso_username, sso_password, account_id, property_id } = req.body || {};

  if (!email) return res.status(400).json({ ok: false, error: "email is required" });
  if (!account_id) return res.status(400).json({ ok: false, error: "account_id is required" });
  if (!property_id) return res.status(400).json({ ok: false, error: "property_id is required" });

  const numericAccountId = String(account_id).replace(/^accounts\//, "");
  const numericPropertyId = String(property_id).replace(/^properties\//, "");

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // Step 1: Log in
    await loginToGoogle(page, {
      google_email: email,
      google_password: "",
      sso_username: sso_username || email,
      sso_password: sso_password || "",
    });

    // Step 2: Navigate directly to Account Access Management
    const accessMgmtUrl = `https://analytics.google.com/analytics/web/#/a${numericAccountId}p${numericPropertyId}/admin/suiteusermanagement/account`;
    console.log(`Navigating to Account Access Management: ${accessMgmtUrl}`);
    await page.goto(accessMgmtUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Dismiss any blocking overlay.
    // GA4 may show a "Missing permissions" alert dialog OR auto-open a side-panel
    // (e.g. "Manage user permissions for ...") that blocks other interactions.
    // Escape reliably closes CDK side-panels and overlays without risk of clicking
    // the wrong button. For proper alert dialogs we look inside mat-dialog-container.
    const alertDialog = page.locator('mat-dialog-container').first();
    if (await alertDialog.isVisible().catch(() => false)) {
      console.log('Alert dialog detected — looking for dismiss button...');
      const dismissBtn = alertDialog.locator('button').filter({ hasText: /^(OK|Got it|Close|Dismiss)$/i }).first();
      if (await dismissBtn.isVisible().catch(() => false)) {
        await dismissBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(1500);
      await page.goto(accessMgmtUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    // Close any open CDK side-panel (e.g. "Manage user permissions" panel that
    // GA4 may open automatically when the page loads with a user pre-selected).
    const cdkPane = page.locator('.cdk-overlay-pane').first();
    if (await cdkPane.isVisible().catch(() => false)) {
      console.log('CDK overlay pane open — dismissing with Escape...');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    // Step 5: Click "Remove myself"
    const removeMyselfBtn = page.locator('button:has-text("Remove myself"), a:has-text("Remove myself")').first();
    const btnVisible = await removeMyselfBtn.isVisible().catch(() => false) ||
      await removeMyselfBtn.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);

    if (!btnVisible) {
      console.log(`ℹ️ "Remove myself" not found — already offboarded from GA4 account ${account_id}`);
      return res.json({ ok: true, account_id, property_id, email, message: "Already removed from GA4 account" });
    }

    console.log('Clicking "Remove myself"...');
    await removeMyselfBtn.click();

    // Step 6: Confirm in the modal
    const confirmBtn = page
      .locator('button:has-text("Remove"):not(:has-text("myself")), [mat-button]:has-text("Remove")')
      .last();
    await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
    console.log("Confirming removal...");
    await confirmBtn.click();
    await page.waitForTimeout(1000);

    console.log(`✅ Removed ${email} from GA4 account ${account_id}`);
    return res.json({ ok: true, account_id, property_id, email, message: "Successfully removed from GA4 account" });
  } catch (e) {
    console.error("Offboard GA4 error:", e);
    return res.status(500).json({ ok: false, error: e.message, account_id, email });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

module.exports = router;
