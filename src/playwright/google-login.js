/**
 * src/playwright/google-login.js
 *
 * Handles Google account login via email/password + OneLogin SSO.
 * This is the shared login flow used at the start of every Playwright automation.
 *
 * The login loop handles all the screens Google may show:
 *   - Email input
 *   - Password input
 *   - OneLogin SSO (username + password)
 *   - "Stay signed in?" / "Continue" interstitials
 *   - "Choose an account" picker (when multiple accounts are in the browser)
 *
 * Note: 2FA/OTP is NOT handled here — the orchestrator is not designed for
 * interactive OTP flows. Accounts should have 2FA managed via SSO.
 */

/**
 * Log into Google Analytics using email/password + OneLogin SSO.
 * Navigates to analytics.google.com and works through all login screens.
 *
 * @param {import('playwright').Page} page
 * @param {{ google_email: string, google_password: string, sso_username: string, sso_password: string }} credentials
 * @throws if login does not reach analytics.google.com after 15 attempts
 */
async function loginToGoogle(page, { google_email, google_password, sso_username, sso_password }) {
  console.log(`🔐 Logging into Google as ${google_email}...`);

  await page.goto("https://analytics.google.com", { waitUntil: "domcontentloaded" });

  for (let i = 0; i < 15; i++) {
    const url = page.url();

    // ── Success: reached Analytics ─────────────────────────────────────────
    if (url.startsWith("https://analytics.google.com")) {
      console.log("✅ Logged into Google Analytics");
      return;
    }

    // ── Email input ────────────────────────────────────────────────────────
    if ((await page.locator('input[type="email"]:visible').count()) > 0) {
      await page.fill('input[type="email"]:visible', google_email);
      await page.keyboard.press("Enter");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
      continue;
    }

    // ── Password input ─────────────────────────────────────────────────────
    if ((await page.locator('input[name="Passwd"]:visible').count()) > 0) {
      await page.fill('input[name="Passwd"]:visible', google_password);
      await page.keyboard.press("Enter");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
      continue;
    }

    // ── OneLogin SSO ───────────────────────────────────────────────────────
    if (url.includes("onelogin.com")) {
      if ((await page.locator('input[name="username"]:visible').count()) > 0) {
        await page.fill('input[name="username"]:visible', sso_username || google_email);
        await page.keyboard.press("Enter");
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        continue;
      }
      if ((await page.locator('input[name="password"]:visible').count()) > 0) {
        await page.fill('input[name="password"]:visible', sso_password || google_password);
        await page.keyboard.press("Enter");
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
        continue;
      }
    }

    // ── "Choose an account" picker — prefer the matching email ────────────
    const accountPickerEmail = page
      .locator(`[data-identifier*="${google_email}"], li:has-text("${google_email}"), [data-email*="${google_email}"]`)
      .first();
    if (await accountPickerEmail.isVisible().catch(() => false)) {
      await accountPickerEmail.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
      continue;
    }
    const anyPickerAccount = page.locator("[data-identifier], .OVnw0d").first();
    if (await anyPickerAccount.isVisible().catch(() => false)) {
      await anyPickerAccount.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
      continue;
    }

    // ── "Stay signed in?" interstitial ────────────────────────────────────
    const staySignedIn = page
      .locator('button:has-text("Yes"), button:has-text("Stay signed in"), [jsname="LgbsSe"]:has-text("Yes")')
      .first();
    if (await staySignedIn.isVisible().catch(() => false)) {
      await staySignedIn.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
      continue;
    }

    // ── "Continue" interstitial ────────────────────────────────────────────
    const continueBtn = page
      .locator('button:has-text("Continue"), a:has-text("Continue")')
      .first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
      continue;
    }

    await page.waitForTimeout(1000);
  }

  // Final check — if we're still not on Analytics, throw
  if (!page.url().startsWith("https://analytics.google.com")) {
    throw new Error(`Login failed — stuck at: ${page.url()}`);
  }
}

module.exports = { loginToGoogle };
