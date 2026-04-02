/**
 * src/playwright/ga4.js
 *
 * GA4 Playwright automation — account creation and ID extraction.
 *
 * Assumes the page is already logged into Google (google-login.js ran first).
 *
 * Exported functions:
 *   checkGa4Capacity(page)                         — returns true if an account can be created
 *   createGa4Account(page, params)                 — runs the 4-step GA4 wizard
 *   fetchGa4Ids(page, params)                      — extracts property_id + measurement_id
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (mirror of runners.js helpers, scoped to this module)
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise a raw URL string into a URL object */
function normaliseWebsiteUrl(raw) {
  const cleaned = String(raw || "").trim();
  const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  return new URL(withProto);
}

/** Click Admin button and wait for the admin route */
async function openAdmin(page) {
  const adminBtn = page
    .getByRole("button", { name: /^Admin$/ })
    .or(page.getByRole("link", { name: /^Admin$/ }))
    .or(page.locator('[aria-label="Admin"]'));
  await adminBtn.first().waitFor({ state: "visible", timeout: 30000 });
  await adminBtn.first().click({ timeout: 30000 });
  await page.waitForURL(/\/admin\b/i, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

/** Close the admin left-rail sidebar if it is covering controls */
async function closeAdminSidebarIfOpen(page) {
  await page.mouse.click(650, 320).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(800);
}

/**
 * Open the account picker search dropdown by clicking the breadcrumb arrow,
 * then type the account name and click the matching result.
 */
async function openAccountViaAccountsSearch(page, accountName) {
  const dropdownArrow = page.locator("mat-icon.gmp-breadcrumb-arrow").first();
  await dropdownArrow.waitFor({ timeout: 10000 });
  await dropdownArrow.click();
  await page.waitForTimeout(800);
  await page.keyboard.type(String(accountName), { delay: 25 });
  await page.waitForTimeout(1000);
  const accountItem = page
    .locator('gmp-entity-item, [class*="gmp-entity"], [class*="entity-item"]')
    .filter({ hasText: String(accountName) })
    .first();
  await accountItem.waitFor({ timeout: 15000 });
  await accountItem.click();
  await page.waitForTimeout(1500);
}

/** Fill the web stream form after clicking the Web platform button */
async function fillWebStreamForm(page, { websiteUrl, websiteName }) {
  const urlObj = normaliseWebsiteUrl(websiteUrl);

  // Wait for the form to appear
  await page.waitForSelector('[debug-id="website-url-input"], input[placeholder*="mywebsite"]', { timeout: 20000 });
  await page.waitForTimeout(500);

  const scope = page.locator('mat-dialog-container, [role="dialog"]').last();

  // URL input — use pressSequentially to trigger Angular change detection
  let domainInput = scope.locator('[debug-id="website-url-input"]').first();
  if (!(await domainInput.isVisible().catch(() => false))) {
    domainInput = page.locator('[debug-id="website-url-input"]').first();
  }
  await domainInput.click({ force: true });
  await domainInput.pressSequentially(urlObj.hostname, { delay: 30 });

  // If the value didn't stick, use the native setter as a fallback
  const urlVal = await domainInput.inputValue().catch(() => "");
  if (!urlVal) {
    await domainInput.evaluate((el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, urlObj.hostname);
  }

  await page.waitForTimeout(500);

  // Stream name input
  let streamNameInput = scope.locator('[debug-id="stream-name-input"]').first();
  if (!(await streamNameInput.isVisible().catch(() => false))) {
    streamNameInput = page.locator('[debug-id="stream-name-input"]').first();
  }
  await streamNameInput.click({ force: true });
  await streamNameInput.pressSequentially(websiteName, { delay: 30 });
  await page.waitForTimeout(500);

  // Submit the form
  const createBtn = scope.locator('button:has-text("Create stream"), button:has-text("Create and continue")').first();
  if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await createBtn.click({ timeout: 10000 });
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(3000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether this Google account has space to create a new GA4 account.
 * Navigates to the Account Create page and probes for limit indicators.
 *
 * @param {import('playwright').Page} page - already logged-in page
 * @returns {boolean} true = space available, false = account is full
 */
async function checkGa4Capacity(page) {
  await page.goto("https://analytics.google.com/analytics/web", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await openAdmin(page);
  await closeAdminSidebarIfOpen(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  // Click Create → Account
  const createBtn = page.getByRole("button", { name: /^Create$/ }).first();
  await createBtn.waitFor({ state: "visible", timeout: 20000 });
  await createBtn.click({ timeout: 20000 });

  const menuPanel = page
    .locator('.cdk-overlay-container .mat-mdc-menu-panel, [role="menu"]')
    .filter({ hasText: "Account" })
    .last();
  await menuPanel.waitFor({ state: "visible", timeout: 15000 });
  const accountMenuBtn = menuPanel.locator('button[role="menuitem"]:has-text("Account")').first();
  await accountMenuBtn.waitFor({ state: "visible", timeout: 15000 });
  await accountMenuBtn.click({ timeout: 15000 });
  await page.waitForURL(/\/admin\/account\/create/i, { timeout: 30000 });
  await page.waitForTimeout(800);

  // Check for limit messages
  const limitIndicators = [
    "text=/reached\\s+the\\s+limit/i",
    "text=/limit\\s+reached/i",
    "text=/you\\s+have\\s+reached/i",
    "text=/too\\s+many/i",
    "text=/account\\s+limit/i",
    "text=/can\\s+only\\s+create/i",
  ];
  for (const t of limitIndicators) {
    if (await page.locator(t).first().isVisible().catch(() => false)) {
      console.log(`⚠️ GA4 limit detected: ${t}`);
      return false;
    }
  }

  // Check if we can actually see the account name input
  try {
    const accountInput = page.locator('input[aria-label*="Account"], input[placeholder*="Account"]').first();
    await accountInput.waitFor({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the full 4-step GA4 account creation wizard.
 * The page must already be logged in and on analytics.google.com.
 *
 * @param {import('playwright').Page} page
 * @param {{ account_name: string, property_name: string, website_url: string, website_name: string }} params
 * @returns {{ ga4_property_id: string }} the numeric GA4 property ID
 */
async function createGa4Account(page, { account_name, property_name, website_url, website_name }) {
  console.log(`🚀 Creating GA4 account: ${account_name} / ${property_name}`);

  // Navigate to GA4 and enter Admin
  await page.goto("https://analytics.google.com/analytics/web", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await openAdmin(page);
  await page.waitForTimeout(1200);

  // Build the create URL using current a...p... context
  const urlNow = page.url();
  const ctxMatch = urlNow.match(/#\/(a\d+p\d+)\b/i);
  const ctx = ctxMatch ? ctxMatch[1] : null;
  const createUrl = ctx
    ? `https://analytics.google.com/analytics/web/#/${ctx}/admin/account/create`
    : "https://analytics.google.com/analytics/web/#/admin/account/create";

  const accountInput = page.locator('input[aria-label*="Account"], input[placeholder*="Account"]').first();
  let onCreatePage = false;

  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.goto(createUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.mouse.click(650, 320).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
    if (await accountInput.isVisible().catch(() => false)) { onCreatePage = true; break; }
  }

  if (!onCreatePage) throw new Error("Could not reach GA4 Account Create page");

  // Step 1 — Account Name
  await accountInput.waitFor({ timeout: 30000 });
  await accountInput.fill(account_name);
  await page.waitForTimeout(300);
  const filledValue = await accountInput.inputValue().catch(() => "");
  if (filledValue !== account_name) {
    await accountInput.click({ force: true });
    await accountInput.fill(account_name);
  }

  // Uncheck "Add to organisation" if checked
  try {
    const orgCheckbox = page.locator('mat-checkbox:has-text("organisation"), mat-checkbox:has-text("organization")').first();
    if (await orgCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      const isChecked = await orgCheckbox.locator('input[type="checkbox"]').isChecked().catch(() => false);
      if (isChecked) await orgCheckbox.click();
    }
  } catch { /* non-critical */ }

  await page.click('button:has-text("Next")');
  console.log("✅ Step 1 complete");

  // Step 2 — Property Name
  const step2 = page.locator("#cdk-stepper-0-content-1");
  await step2.waitFor({ timeout: 30000 });
  const propInput = page.locator("#name, input#name").first();
  await propInput.waitFor({ timeout: 10000 });
  await propInput.fill(property_name, { force: true });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  const nextStep2 = step2.locator('button:has-text("Next")').first();
  await nextStep2.waitFor({ timeout: 30000 });
  await nextStep2.click();
  console.log("✅ Step 2 complete");

  // Step 3 — Business details (pick first industry, Small size)
  const step3 = page.locator("#cdk-stepper-0-content-2");
  await step3.waitFor({ timeout: 30000 });
  const industrySelect = step3.locator("mat-select").first();
  if (await industrySelect.isVisible({ timeout: 5000 }).catch(() => false)) {
    await industrySelect.click();
    await page.waitForTimeout(500);
    const firstOption = page.locator('mat-option').first();
    await firstOption.waitFor({ timeout: 10000 });
    await firstOption.click();
    await page.waitForTimeout(300);
  }
  const smallBtn = step3.locator('button:has-text("Small"), [aria-label*="Small"], mat-button-toggle:has-text("Small")').first();
  if (await smallBtn.isVisible({ timeout: 5000 }).catch(() => false)) await smallBtn.click();
  const nextStep3 = step3.locator('button[matsteppernext], button:has-text("Next")').first();
  await nextStep3.waitFor({ timeout: 30000 });
  await nextStep3.click();
  console.log("✅ Step 3 complete");

  // Step 4 — Objectives (tick all 4)
  const step4 = page.locator("#cdk-stepper-0-content-3");
  await step4.waitFor({ timeout: 30000 });
  for (const label of ["Generate leads", "Drive sales", "Understand web and/or app traffic", "View user engagement and retention"]) {
    const cb = step4.getByRole("checkbox", { name: label }).first();
    if (await cb.count()) {
      const checked = await cb.isChecked().catch(() => false);
      if (!checked) await cb.click({ timeout: 15000 });
    }
  }
  const createBtn = page.locator('button:has-text("Create")').last();
  await createBtn.waitFor({ state: "attached", timeout: 30000 });
  await createBtn.scrollIntoViewIfNeeded().catch(() => {});
  await createBtn.click({ timeout: 15000 });
  console.log("✅ Step 4 complete — Create clicked");

  // Terms acceptance
  const acceptBtn = page.locator('button:has-text("I Accept"), button:has-text("Accept")').first();
  if (await acceptBtn.count()) {
    await acceptBtn.waitFor({ timeout: 30000 });
    if (!(await acceptBtn.isEnabled().catch(() => false))) {
      const panel = page.locator('div[role="dialog"]:visible').first();
      await panel.evaluate((el) => {
        const s = el.querySelector('[class*="content"], [class*="body"]') || el;
        s.scrollTop = s.scrollHeight;
      }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await acceptBtn.click({ timeout: 15000 });
    await page.waitForTimeout(800);
  }

  // Step 6 — Web stream form
  const webBtn = page.locator("button").filter({ hasText: /^web$/i }).first();
  if (await webBtn.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false)) {
    const touchTarget = webBtn.locator("span.mat-mdc-button-touch-target").first();
    if (await touchTarget.count()) await touchTarget.click({ timeout: 10000 });
    else await webBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }

  const websiteName = website_name || normaliseWebsiteUrl(website_url).hostname;
  await fillWebStreamForm(page, { websiteUrl: website_url, websiteName });

  // Extract property ID from URL
  await page.waitForTimeout(2000);
  const finalUrl = page.url();
  const propMatch = finalUrl.match(/#\/a\d+p(\d+)\b/i) || finalUrl.match(/#\/p(\d+)\b/i);
  const ga4_property_id = propMatch ? propMatch[1] : null;

  console.log(`✅ GA4 account created — property_id: ${ga4_property_id}`);
  return { ga4_property_id };
}

/**
 * Open the GA4 web data stream and extract property_id, measurement_id, and gtag snippet.
 * Assumes the page is already logged in.
 *
 * @param {import('playwright').Page} page
 * @param {{ account_name: string, property_name: string, website_url: string }} params
 * @returns {{ property_id: string, measurement_id: string, gtag: string }}
 */
async function fetchGa4Ids(page, { account_name, property_name, website_url }) {
  console.log(`📊 Fetching GA4 IDs for ${account_name} / ${property_name}`);

  await openAccountViaAccountsSearch(page, account_name);
  await openAdmin(page);
  await closeAdminSidebarIfOpen(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Select the correct property from the dropdown
  const allDropdowns = page.locator('button[aria-haspopup="listbox"], button[role="combobox"]');
  const count = await allDropdowns.count();
  if (count > 0) {
    const propertyDropdown = count >= 2 ? allDropdowns.nth(1) : allDropdowns.first();
    const currentSelection = await propertyDropdown.textContent();
    if (!currentSelection.includes(property_name)) {
      await propertyDropdown.click({ timeout: 10000 }).catch(async () => {
        await closeAdminSidebarIfOpen(page);
        await propertyDropdown.click({ force: true, timeout: 10000 });
      });
      await page.waitForTimeout(1000);
      const opt = page.locator('[role="option"], mat-option').filter({ hasText: property_name }).first();
      await opt.waitFor({ timeout: 20000 });
      await opt.click({ timeout: 15000 });
      await page.waitForTimeout(1500);
    }
  }

  // Navigate to Data Streams
  const dataStreamsLink = page.locator('a:has-text("Data Streams"), [aria-label*="Data Streams"]').first();
  await dataStreamsLink.waitFor({ timeout: 30000 });
  await dataStreamsLink.click({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Open the web stream row
  const urlObj = normaliseWebsiteUrl(website_url);
  const streamRow = page.locator(`tr:has-text("${urlObj.hostname}"), .stream-row:has-text("${urlObj.hostname}")`).first();
  if (await streamRow.isVisible({ timeout: 5000 }).catch(() => false)) await streamRow.click();
  else await page.locator("tr, .stream-row").first().click({ timeout: 10000 });
  await page.waitForTimeout(2000);

  // Extract measurement ID
  let measurement_id = null;
  const measurementIdEl = page.locator('text=/G-[A-Z0-9]{7,}/, [aria-label*="Measurement ID"]').first();
  if (await measurementIdEl.isVisible({ timeout: 10000 }).catch(() => false)) {
    const text = await measurementIdEl.textContent();
    const match = text.match(/G-[A-Z0-9]{7,}/);
    if (match) measurement_id = match[0];
  }

  // Extract gtag snippet via "View tag instructions"
  let gtag = null;
  const tagInstructionsBtn = page.locator('button:has-text("View tag instructions"), [aria-label*="tag instructions"]').first();
  if (await tagInstructionsBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tagInstructionsBtn.click();
    await page.waitForTimeout(2000);
    const codeEl = page.locator("code, pre").filter({ hasText: "gtag" }).first();
    if (await codeEl.isVisible({ timeout: 5000 }).catch(() => false)) {
      gtag = await codeEl.textContent();
    }
  }

  // Get property ID from URL or page
  await openAdmin(page);
  const currentUrl = page.url();
  const propMatch = currentUrl.match(/#\/a\d+p(\d+)\b/i) || currentUrl.match(/#\/p(\d+)\b/i);
  const property_id = propMatch ? propMatch[1] : null;

  if (!property_id) throw new Error("Could not extract GA4 property_id from URL");
  if (!measurement_id) throw new Error("Could not extract GA4 measurement_id");

  console.log(`✅ GA4 IDs — property_id: ${property_id}, measurement_id: ${measurement_id}`);
  return { property_id, measurement_id, gtag };
}

module.exports = { checkGa4Capacity, createGa4Account, fetchGa4Ids };
