/**
 * src/playwright/gtm.js
 *
 * All GTM-related Playwright automation steps extracted from runners.js.
 *
 * Exported functions (called from the orchestrator with an already-logged-in page):
 *
 *   checkGtmCapacity(page)
 *     → Opens the "Create Account" dialog and tests whether the account name
 *       field is interactable. Returns true if there is space, false if the
 *       account is at its limit.
 *
 *   createGtmAccount(page, { gtm_account_name, container_name, website_url })
 *     → Runs the full GTM account + container creation wizard.
 *       Returns { container_id, head_code, body_code,
 *                 numeric_account_id, numeric_container_id }
 *
 *   fetchGtmCodes(page, { gtm_container_id })
 *     → Navigates to an existing container and extracts the head/body install
 *       codes via Admin → Install Google Tag Manager.
 *       Returns { container_id, head_code, body_code,
 *                 numeric_account_id, numeric_container_id }
 *
 *   publishGtm(page, { numeric_account_id, numeric_container_id, workspace_id })
 *     → Navigates directly to the workspace URL and clicks Submit → Publish.
 *
 * All functions assume the page is already logged into the correct Google account
 * (via loginToGoogle in google-login.js). Browser management (open/close) is the
 * caller's responsibility.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public — Capacity check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a GTM account still has space for a new container account.
 *
 * Strategy: navigate to GTM, open "Create Account", try to type in the
 * account name field. If the field is interactive, there is capacity.
 * If a limit message appears before the form loads, or the field is blocked,
 * the account is full.
 *
 * @param {import('playwright').Page} page — already on tagmanager.google.com
 * @returns {boolean} true = has space, false = account full
 */
async function checkGtmCapacity(page) {
  console.log("🔍 Checking GTM account capacity...");

  await navigateToGTM(page);
  await page.waitForTimeout(1500);

  // Open the Create Account dialog
  const createAccountBtn = page
    .locator(
      'button:has-text("Create Account"), ' +
        'button:has-text("Create account"), ' +
        '[aria-label*="Create Account"], ' +
        '[aria-label*="Create account"]'
    )
    .first();

  await createAccountBtn.waitFor({ timeout: 30000 });
  await createAccountBtn.click({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Check for limit messages that may appear before the form
  const limitIndicators = [
    "text=/reached\\s+the\\s+limit/i",
    "text=/limit\\s+reached/i",
    "text=/maximum\\s+number/i",
    "text=/cannot\\s+create/i",
    "text=/too\\s+many/i",
  ];

  for (const indicator of limitIndicators) {
    if (await page.locator(indicator).first().isVisible().catch(() => false)) {
      console.log("❌ GTM account limit message detected");
      return false;
    }
  }

  // Try interacting with the account name field — if it accepts input, we have capacity
  try {
    const accountNameInput = page
      .locator(
        'input[name="form.account.properties.displayName"], ' +
          'input[placeholder*="My Company"], ' +
          'input[name*="account"][name*="displayName"]'
      )
      .first();

    await accountNameInput.waitFor({ timeout: 5000 });
    await accountNameInput.fill("probe");

    const value = await accountNameInput.inputValue();
    if (value && value.length > 0) {
      console.log("✅ GTM has capacity (account name field is interactive)");
      return true;
    }
  } catch (err) {
    console.log("⚠️ Could not interact with account name field:", err.message);
  }

  console.log("❌ GTM capacity check inconclusive — treating as full");
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Create account + container
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full GTM account + container creation wizard.
 *
 * Steps performed:
 *   1. Navigate to tagmanager.google.com
 *   2. Click "Create Account"
 *   3. Fill account name + container name
 *   4. Select "Web" platform
 *   5. Click "Create"
 *   6. Accept the terms of service dialog
 *   7. Check for the "account limit" snackbar — throw if detected
 *   8. Extract container ID and head/body install codes from the post-creation modal
 *   9. Extract numeric account / container IDs from the URL
 *
 * @param {import('playwright').Page} page — already logged in
 * @param {{ gtm_account_name: string, container_name: string }} params
 *   gtm_account_name — GTM account display name (e.g. "AP Leadgen 1")
 *   container_name   — container display name / URL (e.g. "example.com")
 * @returns {{ container_id: string, head_code: string, body_code: string,
 *             numeric_account_id: string, numeric_container_id: string }}
 * @throws if the account limit snackbar appears (detected within 6 s of creation)
 */
async function createGtmAccount(page, { gtm_account_name, container_name }) {
  console.log(`🆕 Creating GTM account: ${gtm_account_name} / ${container_name}`);

  await navigateToGTM(page);
  await page.waitForTimeout(1500);

  // Click "Create Account"
  const createAccountBtn = page
    .locator('button:has-text("Create Account"), button:has-text("Create account")')
    .first();
  await createAccountBtn.waitFor({ timeout: 30000 });
  await createAccountBtn.click({ timeout: 15000 });
  await page.waitForTimeout(1500);

  // Fill the form
  await fillGTMAccountForm(page, { accountName: gtm_account_name, containerName: container_name });

  // Select "Web" platform
  await selectWebPlatform(page);

  // Click the bottom "Create" button
  console.log("🆕 Clicking Create...");
  await clickBottomCreate(page);

  // Accept terms of service
  console.log("📋 Accepting terms modal...");
  await acceptGTMTerms(page);

  // ── Check for account limit snackbar ────────────────────────────────────────
  // GTM shows a snackbar immediately after the create attempt if the account is full.
  // Poll for 6 seconds to catch it.
  console.log("⏳ Checking for account-limit snackbar...");
  const limitSnack = page
    .locator("text=/You have reached the maximum number of accounts allowed/i")
    .first();

  const start = Date.now();
  let isAtLimit = false;
  while (Date.now() - start < 6000) {
    if (await limitSnack.isVisible().catch(() => false)) {
      isAtLimit = true;
      break;
    }
    await page.waitForTimeout(300);
  }

  if (isAtLimit) {
    throw new Error("GTM account limit reached — no space on this account");
  }

  // ── Extract codes and IDs from the post-creation modal ──────────────────────
  console.log("✅ Account created — extracting codes...");
  await page.waitForTimeout(2000);

  const codes = await extractGTMCodes(page);

  // Extract numeric account/container IDs from the URL
  const gtmUrl = page.url();
  console.log("📍 GTM URL after creation:", gtmUrl);
  const gtmUrlMatch = gtmUrl.match(/accounts\/(\d+)\/containers\/(\d+)/);

  let numericAccountId = null;
  let numericContainerId = null;

  if (gtmUrlMatch) {
    numericAccountId = gtmUrlMatch[1];
    numericContainerId = gtmUrlMatch[2];
    console.log("✅ Numeric Account ID:", numericAccountId);
    console.log("✅ Numeric Container ID:", numericContainerId);
  } else {
    console.log("⚠️ Could not extract numeric IDs from URL:", gtmUrl);
  }

  return {
    container_id:         codes.containerId,
    head_code:            codes.gtmHeadCode,
    body_code:            codes.gtmBodyCode,
    numeric_account_id:   numericAccountId,
    numeric_container_id: numericContainerId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Fetch codes from existing container
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Navigate to an existing GTM container and extract the head/body install codes.
 *
 * Used when GTM was created in an earlier step and codes need to be retrieved
 * separately (e.g. if the post-creation modal was missed).
 *
 * Steps:
 *   1. Navigate to tagmanager.google.com
 *   2. Find and open the container by its GTM-XXXXXX ID
 *   3. Go to Admin → Install Google Tag Manager
 *   4. Extract codes
 *   5. Extract numeric account/container IDs from URL
 *
 * @param {import('playwright').Page} page — already logged in
 * @param {{ gtm_container_id: string }} params
 * @returns {{ container_id: string, head_code: string, body_code: string,
 *             numeric_account_id: string|null, numeric_container_id: string|null }}
 */
async function fetchGtmCodes(page, { gtm_container_id }) {
  console.log("🔍 Fetching GTM codes for container:", gtm_container_id);

  await page.goto("https://tagmanager.google.com", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3000);

  // Find and open the container
  await openContainerFromHomeList(page, gtm_container_id);

  // Extract numeric IDs from URL (now inside workspace)
  const gtmUrl = page.url();
  console.log("📍 GTM URL after workspace entry:", gtmUrl);
  const gtmUrlMatch = gtmUrl.match(/accounts\/(\d+)\/containers\/(\d+)/);

  let numericAccountId = null;
  let numericContainerId = null;
  if (gtmUrlMatch) {
    numericAccountId = gtmUrlMatch[1];
    numericContainerId = gtmUrlMatch[2];
    console.log("✅ Numeric Account ID:", numericAccountId);
    console.log("✅ Numeric Container ID:", numericContainerId);
  } else {
    console.log("⚠️ Could not extract numeric IDs from URL:", gtmUrl);
  }

  // Navigate directly to the Admin/Install page for this specific container
  // using the numeric IDs from the URL — guarantees we always read the correct
  // container's snippets rather than relying on UI click navigation.
  if (numericAccountId && numericContainerId) {
    const installUrl =
      `https://tagmanager.google.com/#/admin/install` +
      `?accountId=${numericAccountId}&containerId=${numericContainerId}`;
    console.log("🔗 Navigating to install page:", installUrl);
    await page.goto(installUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  } else {
    // Fallback: click through Admin UI if numeric IDs not available
    console.log("⚙️ Clicking Admin tab...");
    const adminTab = page.locator('a:has-text("Admin"), [role="link"]:has-text("Admin")').first();
    await adminTab.waitFor({ state: "visible", timeout: 30000 });
    await adminTab.click();
    await page.waitForTimeout(2000);
    const installLink = page
      .locator(
        'a:has-text("Install Google Tag Manager"), ' +
          '[role="link"]:has-text("Install Google Tag Manager")'
      )
      .first();
    await installLink.waitFor({ state: "visible", timeout: 30000 });
    await installLink.click();
    await page.waitForTimeout(2000);
  }

  // Extract codes
  const codes = await extractGTMCodes(page);

  return {
    container_id:         codes.containerId,
    head_code:            codes.gtmHeadCode,
    body_code:            codes.gtmBodyCode,
    numeric_account_id:   numericAccountId,
    numeric_container_id: numericContainerId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — Publish workspace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Publish the "AP Tracking Setup" GTM workspace.
 *
 * Navigates directly to the workspace URL using the numeric IDs, then clicks:
 *   Submit → (optional Continue / Skip) → Publish
 *
 * @param {import('playwright').Page} page — already logged in
 * @param {{ numeric_account_id: string, numeric_container_id: string, workspace_id: string }} params
 */
async function publishGtm(page, { numeric_account_id, numeric_container_id, workspace_id }) {
  console.log("🚀 Publishing GTM workspace (AP Tracking Setup)...");

  if (!numeric_account_id || !numeric_container_id || !workspace_id) {
    throw new Error("publishGtm: missing numeric_account_id, numeric_container_id or workspace_id");
  }

  const workspaceUrl =
    `https://tagmanager.google.com/#/container/accounts/${numeric_account_id}` +
    `/containers/${numeric_container_id}/workspaces/${workspace_id}`;

  console.log("🧭 Navigating to workspace:", workspaceUrl);
  await page.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  console.log("✅ On workspace page:", page.url());

  // Dismiss any open menus/tooltips before clicking Submit
  await page.mouse.move(0, 0).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);

  // Submit
  console.log("📤 Clicking Submit...");
  const submitBtn = page.locator('button:has-text("Submit"), [aria-label*="Submit"]').first();
  await submitBtn.waitFor({ state: "visible", timeout: 30000 });
  await submitBtn.click({ force: true, timeout: 15000 });
  console.log("✅ Clicked Submit");
  await page.waitForTimeout(3000);

  // Skip the optional "describe your changes" step if it appears
  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Skip")').first();
  if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await continueBtn.click({ timeout: 10000 });
    await page.waitForTimeout(2000);
  }

  // Publish
  console.log("📢 Clicking Publish...");
  const publishBtn = page.locator('button:has-text("Publish"), [aria-label*="Publish"]').first();
  await publishBtn.waitFor({ state: "visible", timeout: 30000 });
  await publishBtn.click({ timeout: 15000 });
  console.log("✅ Clicked Publish");
  await page.waitForTimeout(5000);

  console.log("✅ GTM workspace published successfully");
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Navigate to the GTM home page. */
async function navigateToGTM(page) {
  console.log("🌐 Navigating to Google Tag Manager...");
  await page.goto("https://tagmanager.google.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
}

/** Fill the account name and container name fields in the Create Account dialog. */
async function fillGTMAccountForm(page, { accountName, containerName }) {
  console.log("📝 Filling GTM account form...");

  const accountNameInput = page
    .locator(
      'input[name="form.account.properties.displayName"], ' +
        'input[placeholder*="My Company"], ' +
        'input[name*="account"][name*="displayName"]'
    )
    .first();
  await accountNameInput.waitFor({ timeout: 30000 });
  await accountNameInput.fill(accountName);
  console.log(`✅ Account Name: ${accountName}`);
  await page.waitForTimeout(500);

  const containerNameInput = page
    .locator(
      'input[name="form.container.properties.displayName"], ' +
        'input[placeholder*="www.mysite.com"], ' +
        'input[name*="container"][name*="displayName"]'
    )
    .first();
  await containerNameInput.waitFor({ timeout: 30000 });
  await containerNameInput.fill(containerName);
  console.log(`✅ Container Name: ${containerName}`);
  await page.waitForTimeout(500);
}

/** Click the "Web" platform card in the Create Account form. */
async function selectWebPlatform(page) {
  console.log("🌐 Selecting Web platform...");
  await page.waitForTimeout(1000);
  const webElement = page.locator("text=Web").first();
  await webElement.waitFor({ timeout: 30000 });
  await webElement.click({ timeout: 15000 });
  console.log("✅ Web platform selected");
  await page.waitForTimeout(500);
}

/** Click the bottom "Create" button in the GTM creation form. */
async function clickBottomCreate(page) {
  const createBtn = page.getByRole("button", { name: /^Create$/ }).first();
  await createBtn.waitFor({ state: "visible", timeout: 30000 });
  await createBtn.scrollIntoViewIfNeeded().catch(() => {});
  await createBtn.click({ timeout: 15000, force: true }).catch(async () => {
    // One retry on click failure
    await page.waitForTimeout(500);
    await createBtn.click({ timeout: 15000, force: true });
  });
  await page.waitForTimeout(500);
}

/**
 * Accept the GTM Terms of Service dialog.
 *
 * The dialog has one or more checkboxes that must be checked before the
 * "Yes" button becomes enabled. We check them via JavaScript events first
 * (to handle Angular's change detection) then force-click as a fallback.
 */
async function acceptGTMTerms(page) {
  console.log("📋 Accepting GTM terms...");

  const yesBtn = page.getByRole("button", { name: /^Yes$/ }).first();

  // Wait for the terms dialog to appear
  const startWait = Date.now();
  while (Date.now() - startWait < 30000) {
    if (await yesBtn.isVisible().catch(() => false)) break;
    await page.waitForTimeout(200);
  }

  const hasYes = await yesBtn.isVisible().catch(() => false);
  if (!hasYes) {
    console.log("ℹ️ Terms dialog not detected — continuing without accepting");
    return;
  }

  await page.waitForTimeout(1000);

  // Check every checkbox in the dialog
  const allCheckboxes = await page.locator('[role="checkbox"], input[type="checkbox"]').all();
  console.log(`📊 Found ${allCheckboxes.length} checkbox(es) in terms dialog`);

  for (let i = 0; i < allCheckboxes.length; i++) {
    const checkbox = allCheckboxes[i];
    if (!(await checkbox.isVisible().catch(() => false))) continue;

    const isChecked = await checkbox
      .evaluate((el) => {
        if (el.tagName === "INPUT") return el.checked;
        return el.getAttribute("aria-checked") === "true";
      })
      .catch(() => false);

    if (!isChecked) {
      // Dispatch native events first (Angular/Material needs these)
      await checkbox
        .evaluate((el) => {
          if (el.tagName === "INPUT") {
            el.checked = true;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("click", { bubbles: true }));
          } else if (el.getAttribute("role") === "checkbox") {
            el.setAttribute("aria-checked", "true");
            el.dispatchEvent(new Event("click", { bubbles: true }));
          }
        })
        .catch(() => {});
      await page.waitForTimeout(300);
      await checkbox.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      console.log(`✅ Checkbox ${i + 1} checked`);
    }
  }

  await page.waitForTimeout(500);

  // Force-enable the Yes button (GTM sometimes leaves it disabled even after checkboxes)
  await yesBtn
    .evaluate((el) => {
      el.disabled = false;
      el.removeAttribute("disabled");
      el.setAttribute("aria-disabled", "false");
    })
    .catch(() => {});
  await page.waitForTimeout(500);

  // Wait for the button to become enabled
  const startEnable = Date.now();
  while (Date.now() - startEnable < 15000) {
    if (await yesBtn.isEnabled().catch(() => false)) break;
    await yesBtn
      .evaluate((el) => {
        el.disabled = false;
        el.removeAttribute("disabled");
      })
      .catch(() => {});
    await page.waitForTimeout(200);
  }

  // Click Yes (evaluate first so Angular intercepts it, then Playwright click as backup)
  await yesBtn.evaluate((el) => el.click()).catch(() => {});
  await page.waitForTimeout(300);
  await yesBtn.click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  console.log("✅ GTM terms accepted");
}

/**
 * Find a container by its GTM-XXXXXX ID in the GTM home list and open its
 * default/AP Tracking Setup workspace.
 *
 * Scrolls through the list until the container row is found, then waits for
 * the workspaces page to load.
 *
 * @param {import('playwright').Page} page
 * @param {string} containerId — e.g. "GTM-ABC1234"
 */
async function openContainerFromHomeList(page, containerId) {
  console.log(`🔎 Opening container: ${containerId}...`);

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(2000);

  // Attempt Method 1: search button
  const searchBtn = page
    .locator(
      'button[aria-label*="Search"], button[aria-label*="search"], ' +
        '[aria-label*="Search container"]'
    )
    .first();

  if (await searchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await searchBtn.click();
    await page.waitForTimeout(500);
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill(containerId);
      await page.waitForTimeout(1000);
    }
  }

  // Scroll and click the container row
  const scrollTarget = await page
    .$(".gtm-container-list, [class*=\"container-list\"], .accounts-list, md-list, main, .content-area")
    .catch(() => null);

  let found = false;
  for (let i = 0; i < 30; i++) {
    const match = page.getByText(containerId, { exact: true }).first();
    if (await match.isVisible().catch(() => false)) {
      console.log("✅ Found container:", containerId);
      const row = page
        .locator(`tr:has-text("${containerId}"), [role="row"]:has-text("${containerId}")`)
        .first();
      const link = row.locator("a, td").first();
      await link.click();
      found = true;
      break;
    }

    if (scrollTarget) {
      await scrollTarget.evaluate((el) => el.scrollBy(0, 300));
    } else {
      await page.evaluate(() => window.scrollBy(0, 300));
    }
    await page.waitForTimeout(400);
  }

  if (!found) throw new Error(`Container ${containerId} not found in GTM home list`);

  // Wait for workspaces page
  console.log("⏳ Waiting for workspaces page...");
  await page.waitForURL("**/workspaces/**", { timeout: 15000 });
  await page.waitForTimeout(1000);

  // If a workspace selection modal appears, pick "AP Tracking Setup"
  const workspaceModal = page.locator('.column-name:has-text("AP Tracking Setup")').first();
  if (await workspaceModal.isVisible().catch(() => false)) {
    console.log("📋 Workspace modal — clicking AP Tracking Setup...");
    await workspaceModal.click();
    await page.waitForTimeout(2000);
  }

  // Confirm we are inside the workspace
  await page.waitForSelector('a:has-text("Tags")', { timeout: 30000 });
  console.log("✅ Inside workspace for:", containerId);
}

/**
 * Extract GTM head/body install codes and container ID from the current page.
 *
 * Searches <code>, <pre>, <textarea>, and other code-block elements.
 * If both codes cannot be scraped, constructs them from the container ID
 * as a fallback (the snippets are deterministic).
 *
 * @param {import('playwright').Page} page
 * @returns {{ containerId: string, gtmHeadCode: string, gtmBodyCode: string }}
 */
async function extractGTMCodes(page) {
  console.log("📋 Extracting GTM codes...");
  await page.waitForTimeout(3000);

  let gtmHeadCode = null;
  let gtmBodyCode = null;
  let containerId = null;

  // ── Step 1: Find container ID via text patterns ────────────────────────────
  for (const pattern of ["text=/GTM-[A-Z0-9]{7,}/", "text=/Container ID.*GTM-[A-Z0-9]+/i"]) {
    const el = page.locator(pattern).first();
    if ((await el.count()) > 0) {
      const text = await el.textContent().catch(() => "");
      const match = text.match(/GTM-[A-Z0-9]+/);
      if (match) {
        containerId = match[0];
        console.log("✅ Container ID:", containerId);
        break;
      }
    }
  }

  // Fallback: scan full page HTML
  if (!containerId) {
    const html = await page.content();
    const match = html.match(/GTM-[A-Z0-9]{7,}/);
    if (match) {
      containerId = match[0];
      console.log("✅ Container ID (from page HTML):", containerId);
    }
  }

  // ── Step 2: Scan code blocks for head/body snippets ────────────────────────
  const codeSelectors = ["code", "pre", "textarea", '[class*="code"]', '[class*="snippet"]', 'div[role="textbox"]'];

  for (const selector of codeSelectors) {
    const blocks = page.locator(selector);
    const count = await blocks.count();

    for (let i = 0; i < count; i++) {
      const text = await blocks.nth(i).textContent().catch(() => "");

      // If both head and body are in one element, split them
      if (text.includes("googletagmanager.com/gtm.js") && text.includes("noscript")) {
        const headMatch = text.match(/<!-- Google Tag Manager -->[\s\S]*?<!-- End Google Tag Manager -->/);
        const bodyMatch = text.match(
          /<!-- Google Tag Manager \(noscript\) -->[\s\S]*?<!-- End Google Tag Manager \(noscript\) -->/
        );
        if (headMatch && !gtmHeadCode) {
          gtmHeadCode = headMatch[0].trim();
          console.log("✅ Head code (combined block)");
        }
        if (bodyMatch && !gtmBodyCode) {
          gtmBodyCode = bodyMatch[0].trim();
          console.log("✅ Body code (combined block)");
        }
      }

      if (text.includes("googletagmanager.com/gtm.js") && !gtmHeadCode) {
        gtmHeadCode = text.trim();
        if (!containerId) {
          const m = text.match(/GTM-[A-Z0-9]+/);
          if (m) containerId = m[0];
        }
        console.log("✅ Head code found");
      }

      if (text.includes("noscript") && text.includes("googletagmanager.com") && !gtmBodyCode) {
        gtmBodyCode = text.trim();
        console.log("✅ Body code found");
      }
    }

    if (gtmHeadCode && gtmBodyCode) break;
  }

  // ── Step 3: Construct codes from container ID if scraping failed ──────────
  if (containerId && (!gtmHeadCode || !gtmBodyCode)) {
    console.log("🔨 Constructing missing codes from container ID:", containerId);

    if (!gtmHeadCode) {
      gtmHeadCode =
        `<!-- Google Tag Manager -->\n` +
        `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\n` +
        `new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\n` +
        `j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n` +
        `'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n` +
        `})(window,document,'script','dataLayer','${containerId}');</script>\n` +
        `<!-- End Google Tag Manager -->`;
    }

    if (!gtmBodyCode) {
      gtmBodyCode =
        `<!-- Google Tag Manager (noscript) -->\n` +
        `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${containerId}"\n` +
        `height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n` +
        `<!-- End Google Tag Manager (noscript) -->`;
    }
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!containerId) {
    throw new Error("extractGTMCodes: could not find Container ID on page");
  }
  if (!gtmHeadCode || !gtmBodyCode) {
    throw new Error("extractGTMCodes: could not extract complete GTM codes");
  }

  console.log("✅ Extraction complete —", containerId,
    `| head: ${gtmHeadCode.length} chars | body: ${gtmBodyCode.length} chars`);

  return { containerId, gtmHeadCode, gtmBodyCode };
}

module.exports = {
  checkGtmCapacity,
  createGtmAccount,
  fetchGtmCodes,
  publishGtm,
};
