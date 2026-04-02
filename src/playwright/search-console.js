/**
 * src/playwright/search-console.js
 *
 * Adds a URL-prefix property to Google Search Console and verifies it.
 *
 * Verification strategy (no CMS login required):
 *   1. Add the URL-prefix property via the Search Console welcome screen
 *   2. Check if Google auto-verifies (via GA4 or GTM linked to the same account)
 *   3. If not auto-verified, try selecting "Google Analytics" or
 *      "Google Tag Manager" as the verification method and click Verify
 *
 * The page must already be logged into the correct Google account
 * (same account as the GA4 property created earlier in the sequence).
 * Browser management is the caller's responsibility.
 *
 * Exported function:
 *   addSearchConsoleProperty(page, { website_url })
 *     Returns: { verified: boolean, method: string }
 */

/**
 * Add a URL-prefix property to Search Console and attempt auto-verification
 * via the Google Analytics / Google Tag Manager method.
 *
 * @param {import('playwright').Page} page — already logged into Google
 * @param {{ website_url: string }} params
 * @returns {{ verified: boolean, method: string }}
 *   verified — true if Google confirmed ownership; false if pending manual check
 *   method   — "auto_verified" | "google_analytics" | "pending"
 */
async function addSearchConsoleProperty(page, { website_url }) {
  if (!website_url) throw new Error("addSearchConsoleProperty: missing website_url");

  console.log(`🔍 Adding Search Console property: ${website_url}`);

  // ── Step 1: Open the welcome / add-property screen ────────────────────────
  await page.goto("https://search.google.com/search-console/welcome", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);

  await page.locator("text=Welcome to Google Search Console").first().waitFor({ timeout: 20000 });

  // ── Step 2: Fill in the URL-prefix input ──────────────────────────────────
  // Find the input inside the "URL prefix" card.
  const urlPrefixHeading = page.locator("text=URL prefix").first();
  await urlPrefixHeading.waitFor({ state: "visible", timeout: 20000 });

  // Climb up to the card container and find an enabled input inside it.
  const urlPrefixCard = urlPrefixHeading.locator("xpath=ancestor::*[self::div or self::section][1]");
  let urlInput = urlPrefixCard.locator('input:not([disabled]):not([aria-hidden="true"])').last();

  // Global fallback: pick any visible, enabled, non-hidden input that looks like the property field.
  if (!(await urlInput.isVisible().catch(() => false))) {
    const inputs = page.locator('input:not([disabled]):not([aria-hidden="true"])');
    const count = await inputs.count();
    let found = null;
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      if (!(await input.isVisible().catch(() => false))) continue;
      const type = await input.getAttribute("type").catch(() => "");
      if (type === "hidden") continue;
      const val = await input.inputValue().catch(() => "");
      if ((val || "").includes("Inspect any URL")) continue;
      found = input;
    }
    if (!found) throw new Error("Search Console: could not find URL prefix input");
    urlInput = found;
  }

  await urlInput.waitFor({ state: "visible", timeout: 10000 });
  await urlInput.click({ force: true });
  await urlInput.fill(website_url);
  console.log("✅ Filled site URL:", website_url);

  // Submit via Enter (avoids ambiguous "Continue" buttons)
  await urlInput.press("Enter");
  await page.waitForTimeout(5000);

  // ── Step 3: Check for auto-verification ───────────────────────────────────
  const verificationText = await page.evaluate(() => document.body.innerText || "");
  console.log("📄 Verification screen (first 500 chars):", verificationText.substring(0, 500));

  const isAutoVerified =
    verificationText.includes("Ownership auto verified") ||
    verificationText.includes("Ownership verified") ||
    verificationText.includes("Property verified") ||
    verificationText.includes("You are a verified owner") ||
    verificationText.includes("Google Analytics, Google Tag Manager");

  if (isAutoVerified) {
    console.log("✅ Search Console property auto-verified");

    // Dismiss the success dialog
    const goToPropertyBtn = page
      .locator('button:has-text("GO TO PROPERTY"), button:has-text("Go to property")')
      .first();
    if (await goToPropertyBtn.isVisible().catch(() => false)) {
      await goToPropertyBtn.click().catch(() => {});
    } else {
      const doneBtn = page.locator('button:has-text("DONE"), button:has-text("Done")').first();
      if (await doneBtn.isVisible().catch(() => false)) {
        await doneBtn.click().catch(() => {});
      }
    }

    return { verified: true, method: "auto_verified" };
  }

  // ── Step 4: Try Google Analytics / GTM verification method ────────────────
  // This method works when the GA4 property (created earlier) is on the same
  // Google account. Google detects the GA4 tracking code on the site and
  // confirms ownership.
  console.log("🔍 Not auto-verified — attempting Google Analytics verification...");
  await page.waitForTimeout(3000);

  // Expand "Other verification methods" if collapsed
  const otherMethods = page.locator("text=Other verification methods").first();
  if (await otherMethods.isVisible().catch(() => false)) {
    await otherMethods.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  // Select "Google Analytics" or "Google Tag Manager" as the method
  const gaMethod = page
    .locator("text=Google Analytics, text=Google Tag Manager")
    .first();
  if (await gaMethod.isVisible().catch(() => false)) {
    await gaMethod.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  // Click Verify
  const verifyBtn = page.locator('button:has-text("VERIFY"), button:has-text("Verify")').first();
  if (await verifyBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
    await verifyBtn.click();
    await page.waitForTimeout(6000);
  }

  // Read the outcome
  const verified = await page.evaluate(() => {
    const body = document.body.innerText;
    return (
      body.includes("Ownership verified") ||
      body.includes("Ownership auto verified") ||
      body.includes("verified")
    );
  });

  if (verified) {
    console.log("✅ Search Console property verified via Google Analytics");
    return { verified: true, method: "google_analytics" };
  }

  // Could not verify — the GA4 property may not have propagated yet
  const pageState = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => "");
  console.log("⚠️ Could not verify Search Console property. Page state:", pageState);
  console.log("   Check that the GA4 property is linked to the same Google account.");

  return { verified: false, method: "pending" };
}

module.exports = { addSearchConsoleProperty };
