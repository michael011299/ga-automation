/**
 * src/orchestrator/full-setup.js
 *
 * Full-setup orchestrator — core_variant = "full".
 *
 * Runs the complete 19-step onboarding sequence for a new client who has
 * no GA4 property and no GTM container yet.
 *
 * Called by entry.js after the Monday item is created and info_needed is false.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Sequence overview
 * ─────────────────────────────────────────────────────────────────────────────
 *  0.  Mark case "running" + Monday "In Progress"
 *  1.  Find GA4 account with capacity (try-next-on-full across 12 accounts)
 *  2.  Find GTM account with capacity (try-next-on-full across 12 accounts)
 *  3.  Create GA4 property (Playwright)
 *  4.  Fetch GA4 measurement_id + gtag snippet (Playwright)
 *  5.  Create GTM account + container (Playwright)
 *  6.  Fetch GTM head/body codes + numeric IDs (Playwright)
 *  7.  Create GTM workspace via API
 *  8.  Enable click built-in variables via API
 *  9.  Create GTM triggers via API
 * 10.  Create GTM tags via API
 * 11.  Publish GTM workspace (Playwright)
 * 12.  Install GTM codes on CMS (Playwright)
 * 13.  Register GA4 conversion events (API)
 * 14.  Link GA4 to Google Ads (API, if CID present)
 * 15.  Create Google Ads conversion actions (API, if CID present)
 * 16.  Add Search Console property (Playwright)
 * 17.  Run tracking health check
 * 18.  Mark case "done" + Monday "Done" + summary note
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Error handling:
 *   Each step is wrapped in a try/catch. A failure updates the case status to
 *   "error", posts a note to Monday, and re-throws so the caller can surface
 *   the error to n8n. Steps that are optional (Ads link, Search Console) catch
 *   their own errors and continue.
 *
 * Account selection — try-next-on-full:
 *   The orchestrator does not pre-check all 12 accounts. It attempts creation
 *   on the first account in account_index order. If checkGa4Capacity / checkGtmCapacity
 *   returns false, it moves to the next account. GA4 and GTM are selected
 *   independently — they may end up on different accounts.
 */

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

const { getAllGoogleAccounts, updateCase, getGoogleAccountByName, incrementAccountCount } = require("../lib/credentials");
const { getAccessToken, getAdsAccessToken } = require("../lib/google-oauth");
const { setItemStatus, addItemNote } = require("../lib/monday");

const { loginToGoogle }            = require("../playwright/google-login");
const { checkGa4Capacity, createGa4Account, fetchGa4Ids } = require("../playwright/ga4");
const { checkGtmCapacity, createGtmAccount, fetchGtmCodes, publishGtm } = require("../playwright/gtm");
const { installGtmCodes }          = require("../playwright/cms");
const { addSearchConsoleProperty } = require("../playwright/search-console");
const { runTrackingHealthCheck }   = require("../playwright/tracking");

const { createWorkspace, enableClickVariables, createTriggers, createTags } = require("../api/gtm-api");
const { createConversionEvents, linkGoogleAds }   = require("../api/ga4-api");
const { createConversionActions }                 = require("../api/google-ads-api");

// ─────────────────────────────────────────────────────────────────────────────
// Public
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full 19-step onboarding sequence.
 *
 * @param {string} caseId       — UUID of the automation_cases row
 * @param {Object} caseRow      — full case row (pre-loaded by entry.js)
 * @param {string|null} mondayItemId — Monday item ID (may be null if creation failed)
 * @returns {{ status: "done" | "error", case_id: string, ... }}
 */
async function runFullSetup(caseId, caseRow, mondayItemId) {
  console.log(`\n🏗️  runFullSetup: ${caseRow.case_name || caseRow.website_url}`);

  // ── Step 0: Mark as running ────────────────────────────────────────────────
  await updateCase(caseId, { status: "running" });
  await safeAddNote(mondayItemId, caseRow.product_type, "▶️ Automation started (full setup)");
  await safeSetStatus(mondayItemId, caseRow.product_type, "In Progress");

  // Collect outputs as we go — used in subsequent steps
  const outputs = {};

  // Tracks the current step name so errors include context
  let currentStep = "init";

  try {

    // ── Step 1: Find GA4 account with capacity ────────────────────────────────
    currentStep = "find_ga4_account";
    console.log("\n📍 Step 1: Find GA4 account with capacity");
    const accounts = await getAllGoogleAccounts();
    const ga4Account = await findAccountWithCapacity(accounts, "ga4", caseRow.website_url);

    await updateCase(caseId, { "GA4_Google_ account": ga4Account.account_name });
    console.log("✅ GA4 account:", ga4Account.account_name);
    outputs.ga4Account = ga4Account;

    // ── Step 2: Find GTM account with capacity ────────────────────────────────
    currentStep = "find_gtm_account";
    console.log("\n📍 Step 2: Find GTM account with capacity");
    const gtmAccount = await findAccountWithCapacity(accounts, "gtm", caseRow.website_url);

    await updateCase(caseId, { "GTM_Google _Account": gtmAccount.account_name });
    console.log("✅ GTM account:", gtmAccount.account_name);
    outputs.gtmAccount = gtmAccount;

    // ── Steps 3+4: Create GA4 property and fetch IDs (single browser session) ─
    currentStep = "create_ga4_property";
    console.log("\n📍 Steps 3+4: Create GA4 property and fetch IDs (single session)");
    const ga4PropertyName = caseRow.website_url || caseRow.case_name;
    const { ga4PropertyId, measurementId, ga4Gtag } = await runWithBrowser(ga4Account, async (page) => {
      const createResult = await createGa4Account(page, {
        account_name:  ga4Account.account_name,
        property_name: ga4PropertyName,
        website_url:   caseRow.website_url,
        website_name:  caseRow.case_name || caseRow.website_url,
      });
      currentStep = "fetch_ga4_ids";
      const idResult = await fetchGa4Ids(page, {
        account_name:  ga4Account.account_name,
        property_name: ga4PropertyName,
        website_url:   caseRow.website_url,
      });
      return {
        ga4PropertyId: createResult.ga4_property_id,
        measurementId: idResult.measurement_id,
        ga4Gtag:       idResult.gtag,
      };
    });

    await updateCase(caseId, {
      ga4_property_id:  ga4PropertyId,
      measurement_id:   measurementId,
      ga4_setup_status: "done",
    });
    await incrementAccountCount(ga4Account.id, "ga4_property_count");
    await safeAddNote(mondayItemId, caseRow.product_type,
      `✅ GA4 property created: ${ga4PropertyId} | Measurement ID: ${measurementId}`
    );
    outputs.ga4PropertyId = ga4PropertyId;
    outputs.measurementId = measurementId;
    outputs.gtag = ga4Gtag;
    console.log("✅ GA4 property ID:", ga4PropertyId);
    console.log("✅ Measurement ID:", measurementId);

    // ── Step 5: Create GTM account + container ────────────────────────────────
    currentStep = "create_gtm_container";
    console.log("\n📍 Step 5: Create GTM container");
    const gtmResult = await runWithBrowser(gtmAccount, async (page) => {
      return await createGtmAccount(page, {
        gtm_account_name: gtmAccount.account_name,
        container_name:   caseRow.website_url || caseRow.case_name,
      });
    });

    await updateCase(caseId, {
      gtm_container_id:          gtmResult.container_id,
      gtm_numeric_account_id:    gtmResult.numeric_account_id,
      gtm_numeric_container_id:  gtmResult.numeric_container_id,
      gtm_head_code:             gtmResult.head_code,
      gtm_body_code:             gtmResult.body_code,
      gtm_setup_status:          "done",
    });
    await incrementAccountCount(gtmAccount.id, "gtm_container_count");
    await safeAddNote(mondayItemId, caseRow.product_type, `✅ GTM container created: ${gtmResult.container_id}`);
    outputs.gtmContainerId       = gtmResult.container_id;
    outputs.gtmNumericAccountId  = gtmResult.numeric_account_id;
    outputs.gtmNumericContainerId = gtmResult.numeric_container_id;
    outputs.gtmHeadCode          = gtmResult.head_code;
    outputs.gtmBodyCode          = gtmResult.body_code;
    console.log("✅ GTM container ID:", gtmResult.container_id);

    // ── Step 6: GTM codes (already returned from creation) ───────────────────
    // head_code and body_code were captured in step 5; no extra browser session needed.
    console.log("\n📍 Step 6: GTM codes already captured in step 5 ✅");

    // ── Step 7: Create GTM workspace via API ──────────────────────────────────
    currentStep = "create_gtm_workspace";
    console.log("\n📍 Step 7: Create GTM workspace via API");
    const gtmAccessToken = await getAccessToken(gtmAccount.gtm_ga4_refresh_token);
    const workspaceId = await createWorkspace(gtmAccessToken, {
      numericAccountId:   outputs.gtmNumericAccountId,
      numericContainerId: outputs.gtmNumericContainerId,
    });

    await updateCase(caseId, { gtm_workspace_id: workspaceId });
    outputs.workspaceId = workspaceId;
    console.log("✅ Workspace ID:", workspaceId);

    // ── Step 8: Enable click built-in variables ───────────────────────────────
    currentStep = "enable_click_variables";
    console.log("\n📍 Step 8: Enable click built-in variables");
    await enableClickVariables(gtmAccessToken, {
      numericAccountId:   outputs.gtmNumericAccountId,
      numericContainerId: outputs.gtmNumericContainerId,
      workspaceId,
    });

    // ── Step 9: Create triggers ───────────────────────────────────────────────
    currentStep = "create_gtm_triggers";
    console.log("\n📍 Step 9: Create GTM triggers");
    const triggerIds = await createTriggers(gtmAccessToken, {
      numericAccountId:   outputs.gtmNumericAccountId,
      numericContainerId: outputs.gtmNumericContainerId,
      workspaceId,
    });
    outputs.triggerIds = triggerIds;

    // ── Step 10: Create tags ──────────────────────────────────────────────────
    currentStep = "create_gtm_tags";
    console.log("\n📍 Step 10: Create GTM tags");
    await createTags(gtmAccessToken, {
      numericAccountId:   outputs.gtmNumericAccountId,
      numericContainerId: outputs.gtmNumericContainerId,
      workspaceId,
      measurementId:      outputs.measurementId,
      callTriggerId:      triggerIds.callTriggerId,
      emailTriggerId:     triggerIds.emailTriggerId,
      formTriggerId:      triggerIds.formTriggerId,
    });

    await updateCase(caseId, { gtm_tags_status: "done" });
    await safeAddNote(mondayItemId, caseRow.product_type, "✅ GTM workspace, variables, triggers + tags configured");

    // ── Step 11: Publish GTM workspace ───────────────────────────────────────
    currentStep = "publish_gtm";
    console.log("\n📍 Step 11: Publish GTM workspace");
    await runWithBrowser(gtmAccount, async (page) => {
      await publishGtm(page, {
        numeric_account_id:   outputs.gtmNumericAccountId,
        numeric_container_id: outputs.gtmNumericContainerId,
        workspace_id:         workspaceId,
      });
    });

    await updateCase(caseId, { gtm_publish_status: "done", last_step_completed: "gtm_publish" });
    await safeAddNote(mondayItemId, caseRow.product_type, "✅ GTM workspace published");

    // ── Step 12: Install GTM codes on CMS ────────────────────────────────────
    // CMS credentials come from the cms_login_credentials JSON field.
    console.log("\n📍 Step 12: Install GTM codes on CMS");
    let formData = {};
    try {
      const cmsCreds = parseCmsCreds(caseRow.cms_login_credentials);
      const cmsInstallResult = await runWithFreshBrowser(async (page) => {
        return await installGtmCodes(page, {
          website_url:   caseRow.website_url,
          cms_type:      caseRow.cms_type || "wordpress",
          cms_username:  cmsCreds.username,
          cms_password:  cmsCreds.password,
          wp_admin_url:  caseRow.wp_admin_url || cmsCreds.wp_admin_url,
          gtm_head_code: outputs.gtmHeadCode,
          gtm_body_code: outputs.gtmBodyCode,
          gtag:          outputs.gtag,
        });
      });
      formData = cmsInstallResult;
      await updateCase(caseId, {
        codes_on_site:        true,
        cms_install_status:   "done",
        last_step_completed:  "cms_install",
        detected_form_type:   formData.detected_form_type,
        detected_form_selector: formData.detected_form_selector,
        detected_form_source_url: formData.detected_form_source_url,
      });
      await safeAddNote(mondayItemId, caseRow.product_type, `✅ GTM codes installed on CMS (${formData.cms_type})`);
    } catch (err) {
      console.error("⚠️ CMS install failed (non-fatal — continuing):", err.message);
      await updateCase(caseId, { cms_install_status: "error" });
      await safeAddNote(mondayItemId, caseRow.product_type, `⚠️ CMS install failed: ${err.message}`);
    }

    // ── Step 13: GA4 conversion events ───────────────────────────────────────
    currentStep = "create_conversion_events";
    console.log("\n📍 Step 13: Register GA4 conversion events");
    const ga4AccessToken = await getAccessToken(ga4Account.gtm_ga4_refresh_token);
    await createConversionEvents(ga4AccessToken, outputs.ga4PropertyId);
    await updateCase(caseId, { conversion_events_status: "done", last_step_completed: "conversion_events" });

    // ── Step 14: Link GA4 to Google Ads ──────────────────────────────────────
    console.log("\n📍 Step 14: Link GA4 to Google Ads");
    try {
      await linkGoogleAds(ga4AccessToken, outputs.ga4PropertyId, caseRow.cid);
      if (caseRow.cid) {
        await updateCase(caseId, { ads_link_status: "done" });
      }
    } catch (err) {
      console.error("⚠️ GA4 → Ads link failed (non-fatal):", err.message);
      await updateCase(caseId, { ads_link_status: "error" });
    }

    // ── Step 15: Google Ads conversion actions ────────────────────────────────
    console.log("\n📍 Step 15: Create Google Ads conversion actions");
    try {
      const adsToken = await getAdsAccessToken();
      await createConversionActions(adsToken, caseRow.cid);
      if (caseRow.cid) {
        await safeAddNote(mondayItemId, caseRow.product_type, "✅ GA4 conversion events + Ads conversion actions created");
      }
    } catch (err) {
      console.error("⚠️ Ads conversion actions failed (non-fatal):", err.message);
    }

    // ── Step 16: Search Console ───────────────────────────────────────────────
    console.log("\n📍 Step 16: Add Search Console property");
    try {
      const scResult = await runWithBrowser(ga4Account, async (page) => {
        return await addSearchConsoleProperty(page, { website_url: caseRow.website_url });
      });
      const scStatus = scResult.verified ? "done" : "pending_verify";
      await updateCase(caseId, { search_console_status: scStatus, last_step_completed: "search_console" });
      await safeAddNote(mondayItemId, caseRow.product_type,
        scResult.verified
          ? `✅ Search Console property verified (${scResult.method})`
          : "⚠️ Search Console property added — verification pending"
      );
    } catch (err) {
      console.error("⚠️ Search Console failed (non-fatal):", err.message);
      await updateCase(caseId, { search_console_status: "error" });
    }

    // ── Step 17: Tracking health check ────────────────────────────────────────
    console.log("\n📍 Step 17: Run tracking health check");
    try {
      const healthResult = await runTrackingHealthCheck(caseRow.website_url);
      await updateCase(caseId, {
        tracking_test_status: healthResult.grade,
        last_step_completed:  "tracking_test",
      });
      await safeAddNote(mondayItemId, caseRow.product_type,
        `🔬 Tracking health check: ${healthResult.grade} (${healthResult.health_status})`
      );
    } catch (err) {
      console.error("⚠️ Tracking health check failed (non-fatal):", err.message);
      await updateCase(caseId, { tracking_test_status: "error" });
    }

    // ── Step 18: Mark done ────────────────────────────────────────────────────
    console.log("\n📍 Step 18: Mark case done");
    await updateCase(caseId, { status: "done", last_step_completed: "done" });
    await safeSetStatus(mondayItemId, caseRow.product_type, "Done");
    await safeAddNote(mondayItemId, caseRow.product_type,
      `✅ Full setup complete for ${caseRow.website_url}\n` +
      `   GA4: ${outputs.ga4PropertyId} (${ga4Account.account_name})\n` +
      `   GTM: ${outputs.gtmContainerId} (${gtmAccount.account_name})\n` +
      `   Measurement ID: ${outputs.measurementId}`
    );

    console.log("\n✅ runFullSetup complete");
    return {
      status:            "done",
      case_id:           caseId,
      ga4_account_name:  outputs.ga4Account.account_name,
      ga4_property_name: ga4PropertyName,
      ga4_property_id:   outputs.ga4PropertyId,
      measurement_id:    outputs.measurementId,
      gtm_container_id:  outputs.gtmContainerId,
      gtm_account_name:  outputs.gtmAccount.account_name,
    };

  } catch (err) {
    console.error("\n❌ runFullSetup fatal error:", err.message);
    await updateCase(caseId, { status: "error", error_message: err.message });
    await safeSetStatus(mondayItemId, caseRow.product_type, "Error");
    await safeAddNote(mondayItemId, caseRow.product_type, `❌ Fatal error at step "${currentStep}": ${err.message}`);
    return {
      status:     "error",
      case_id:    caseId,
      failed_at:  currentStep,
      error:      err.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Account selection — try-next-on-full
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk through the 12 Google accounts in order and return the first one that
 * has available capacity for GA4 or GTM creation.
 *
 * The capacity check opens a real browser session and attempts to open the
 * "Create Account" dialog. If the dialog is blocked or a limit message appears,
 * the account is considered full and we try the next one.
 *
 * @param {Array}  accounts    — all 12 rows from google_accounts (ordered by account_index)
 * @param {"ga4"|"gtm"} type  — which capacity to check
 * @param {string} websiteUrl — used for logging only
 * @returns {Object} the chosen google_accounts row
 * @throws if no account with capacity is found
 */
async function findAccountWithCapacity(accounts, type, websiteUrl) {
  console.log(`🔍 Looking for ${type.toUpperCase()} account with capacity...`);

  for (const account of accounts) {
    console.log(`  Checking ${account.account_name}...`);

    let hasCapacity = false;
    try {
      hasCapacity = await runWithBrowser(account, async (page) => {
        if (type === "ga4") {
          return await checkGa4Capacity(page);
        } else {
          return await checkGtmCapacity(page);
        }
      });
    } catch (err) {
      console.log(`  ⚠️ Capacity check failed for ${account.account_name}: ${err.message}`);
      hasCapacity = false;
    }

    if (hasCapacity) {
      console.log(`  ✅ ${account.account_name} has ${type.toUpperCase()} capacity`);
      return account;
    }

    console.log(`  ❌ ${account.account_name} is full — trying next`);
  }

  throw new Error(
    `No ${type.toUpperCase()} account with available capacity found across ${accounts.length} accounts`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a headless Chromium browser, log into Google with the given account,
 * run the callback with the page, then close the browser.
 *
 * @param {Object}   account  — google_accounts row (has google_email, google_password, etc.)
 * @param {Function} callback — async (page) => result
 * @returns the value returned by callback
 */
async function runWithBrowser(account, callback) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    await loginToGoogle(page, {
      google_email:    account.google_email,
      google_password: account.google_password,
      sso_username:    account.sso_username,
      sso_password:    account.sso_password,
    });
    return await callback(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Same as runWithBrowser but without a Google login step.
 * Used for CMS installs which log into the CMS directly (not Google).
 *
 * @param {Function} callback — async (page) => result
 */
async function runWithFreshBrowser(callback) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    return await callback(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Monday helpers (best-effort — never throw)
// ─────────────────────────────────────────────────────────────────────────────

async function safeSetStatus(mondayItemId, productType, label) {
  if (!mondayItemId) return;
  try {
    await setItemStatus(mondayItemId, productType, label);
  } catch (err) {
    console.error(`[monday] setItemStatus failed (non-fatal): ${err.message}`);
  }
}

async function safeAddNote(mondayItemId, productType, message) {
  if (!mondayItemId) return;
  try {
    await addItemNote(mondayItemId, message);
  } catch (err) {
    console.error(`[monday] addItemNote failed (non-fatal): ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CMS credentials helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse cms_login_credentials which may be a JSON string or a plain object.
 *
 * Expected format: { "username": "...", "password": "...", "wp_admin_url": "..." }
 *
 * @param {string|Object|null} raw
 * @returns {{ username: string, password: string, wp_admin_url?: string }}
 */
function parseCmsCreds(raw) {
  if (!raw) return { username: "", password: "" };
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { username: "", password: "" };
  }
}

module.exports = { runFullSetup };
