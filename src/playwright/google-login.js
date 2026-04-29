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
 * Log into a Google property using email/password + optional OneLogin SSO.
 *
 * @param {import('playwright').Page} page
 * @param {{ google_email: string, google_password: string, sso_username: string, sso_password: string }} credentials
 * @param {string} [targetUrl] - Google property to land on (default: analytics.google.com)
 * @throws if login does not reach the target after 15 attempts
 */
async function loginToGoogle(page, { google_email, google_password, sso_username, sso_password }, targetUrl = "https://analytics.google.com") {
  // Strip hash fragment for success-check — hash is not part of the origin
  const targetOrigin = targetUrl.split("#")[0].replace(/\/$/, "");
  console.log(`🔐 Logging into Google as ${google_email} (target: ${targetOrigin})...`);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  for (let i = 0; i < 15; i++) {
    const url = page.url();

    // ── Success: reached target ────────────────────────────────────────────
    if (url.startsWith(targetOrigin)) {
      console.log(`✅ Logged in — reached ${targetOrigin}`);
      return;
    }

    // ── Email input ────────────────────────────────────────────────────────
    const emailInput = page.locator('input[type="email"], input#identifierId').first();
    if (await emailInput.isVisible({ timeout: 500 }).catch(() => false)) {
      await emailInput.click({ timeout: 5000 }).catch(() => {});
      await emailInput.fill(google_email, { timeout: 10000 });
      await page.keyboard.press("Enter");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
      continue;
    }

    // ── Password input ─────────────────────────────────────────────────────
    const passwdInput = page.locator('input[name="Passwd"], input[type="password"]').first();
    if (await passwdInput.isVisible({ timeout: 500 }).catch(() => false)) {
      await passwdInput.click({ timeout: 5000 }).catch(() => {});
      await passwdInput.fill(google_password, { timeout: 10000 });
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

    // ── "Verify it's you" / challenge/selection screen ────────────────────
    // Google shows this for unrecognised devices even without 2FA.
    // Try "Not now", "Skip", or "Try another way" to get past it.
    if (url.includes("/signin/challenge") || url.includes("/signin/v2/challenge")) {
      const skipBtn = page
        .locator('button:has-text("Not now"), button:has-text("Skip"), a:has-text("Not now"), a:has-text("Skip")')
        .first();
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        continue;
      }
      const tryAnotherWay = page.locator('button:has-text("Try another way"), a:has-text("Try another way")').first();
      if (await tryAnotherWay.isVisible().catch(() => false)) {
        await tryAnotherWay.click();
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        continue;
      }
      // If no skip option, this challenge cannot be bypassed automatically
      throw new Error(`Google requires manual verification — sign into this account from the server once to trust the IP, then retry. Stuck at: ${url}`);
    }

    await page.waitForTimeout(1000);
  }

  // Final check — if we're still not on the target, throw
  if (!page.url().startsWith(targetOrigin)) {
    throw new Error(`Login failed — stuck at: ${page.url()}`);
  }
}

module.exports = { loginToGoogle };
