/**
 * src/playwright/cms.js
 *
 * Installs GTM head/body codes on a client CMS site.
 * Supports WordPress, Wix, and Squarespace.
 *
 * Exported function:
 *
 *   installGtmCodes(page, params)
 *     → Logs into the CMS, installs the provided GTM codes, and returns
 *       form detection metadata for use by the health check / GTM tag setup.
 *
 * Params object:
 *   website_url    {string}  — client site URL (used for Wix site lookup + form detection)
 *   cms_type       {string}  — "wordpress" | "wix" | "squarespace"
 *   cms_username   {string}  — CMS login username / email
 *   cms_password   {string}  — CMS login password
 *   wp_admin_url   {string?} — WordPress admin URL (required when cms_type = "wordpress")
 *   gtm_head_code  {string}  — full GTM <head> snippet (<!-- Google Tag Manager --> ... <!-- End -->)
 *   gtm_body_code  {string}  — full GTM <body> noscript snippet
 *   gtag           {string?} — optional gtag.js snippet to prepend in the WordPress header field
 *
 * Returns:
 *   {
 *     cms_type,
 *     detected_form_type,     — e.g. "cf7", "wpforms", "generic", "unknown"
 *     detected_form_id,
 *     detected_form_class,
 *     detected_form_selector,
 *     detected_form_action,
 *     detected_form_source_url,
 *     detected_success_selectors,
 *   }
 *
 * The page must be a fresh Playwright page (not logged into anything yet).
 * Browser management is the caller's responsibility.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Install GTM codes on the client CMS.
 *
 * @param {import('playwright').Page} page
 * @param {{
 *   website_url: string,
 *   cms_type: string,
 *   cms_username: string,
 *   cms_password: string,
 *   wp_admin_url?: string,
 *   gtm_head_code: string,
 *   gtm_body_code: string,
 *   gtag?: string,
 * }} params
 * @returns {Object} form detection metadata
 */
async function installGtmCodes(page, params) {
  const {
    website_url,
    cms_type,
    cms_username,
    cms_password,
    wp_admin_url,
    gtm_head_code,
    gtm_body_code,
    gtag,
  } = params;

  if (!website_url || !cms_type) throw new Error("installGtmCodes: missing website_url or cms_type");
  if (!gtm_head_code || !gtm_body_code) throw new Error("installGtmCodes: missing gtm_head_code or gtm_body_code");

  const cms = cms_type.toLowerCase();

  if (cms === "wordpress") {
    return await installWordPress(page, { website_url, wp_admin_url, cms_username, cms_password, gtm_head_code, gtm_body_code, gtag });
  }

  if (cms === "wix") {
    return await installWix(page, { website_url, cms_username, cms_password, gtm_head_code });
  }

  if (cms === "squarespace") {
    return await installSquarespace(page, { website_url, cms_username, cms_password, gtm_head_code, gtm_body_code });
  }

  throw new Error(`installGtmCodes: unsupported cms_type "${cms_type}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// WordPress
// ─────────────────────────────────────────────────────────────────────────────

async function installWordPress(page, { website_url, wp_admin_url, cms_username, cms_password, gtm_head_code, gtm_body_code, gtag }) {
  if (!wp_admin_url || !cms_username || !cms_password) {
    throw new Error("WordPress install: missing wp_admin_url, cms_username, or cms_password");
  }

  const baseUrl = wp_admin_url.replace(/\/(wp-admin|wp-login\.php).*$/, "").replace(/\/$/, "");

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Wait for Cloudflare / bot-verification pages to pass automatically.
  async function waitForCfChallenge() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const title = await page.title().catch(() => "");
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const isChallenge =
        /one moment|please wait|verif|checking your browser|just a moment/i.test(title) ||
        /please wait while your request is being verified/i.test(bodyText);
      if (!isChallenge) break;
      console.log("⏳ Bot-verification page — waiting...");
      await page.waitForTimeout(2000);
    }
  }

  // WP sometimes shows a "Confirm admin email" interstitial — dismiss it.
  async function dismissConfirmEmailIfPresent() {
    if (/action=confirm_admin_email/i.test(page.url())) {
      const remindBtn = page
        .locator('a:has-text("Remind me later"), button:has-text("Remind me later"), input[value*="Remind"]')
        .first();
      if (await remindBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await remindBtn.click();
        await page.waitForTimeout(1500);
      }
    }
  }

  // Navigate to a WP admin URL, handle Cloudflare, re-login if session expired.
  async function wpAdminGoto(url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForCfChallenge();
    await page.waitForTimeout(1000);
    console.log("📍 Landed on:", page.url());
    await dismissConfirmEmailIfPresent();

    const currentUrl = page.url();
    if (
      currentUrl.includes("wp-login") ||
      currentUrl.includes("reauth=1") ||
      currentUrl.includes("onelogin")
    ) {
      console.log("🔄 Session expired — re-logging in...");
      await page.goto(`${baseUrl}/wp-login.php`, { waitUntil: "domcontentloaded" });
      await waitForCfChallenge();
      await page.waitForTimeout(1000);
      await page.locator('#user_login, input[name="log"]').first().fill(cms_username);
      await page.locator('#user_pass, input[name="pwd"]').first().fill(cms_password);
      await page.locator('#wp-submit, input[type="submit"]').first().click();
      await page.waitForURL(
        (u) => /\/wp-admin/i.test(u) || /action=confirm_admin_email/i.test(u),
        { timeout: 30000 }
      );
      await page.waitForTimeout(1000);
      await dismissConfirmEmailIfPresent();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  console.log(`🔐 Logging into WordPress: ${wp_admin_url}`);
  await page.goto(`${baseUrl}/wp-login.php`, { waitUntil: "domcontentloaded" });
  await waitForCfChallenge();

  await page.locator('#user_login, input[name="log"]').first().fill(cms_username);
  await page.locator('#user_pass, input[name="pwd"]').first().fill(cms_password);
  await page.locator('#wp-submit, input[type="submit"]').first().click();
  await page.waitForURL(
    (u) => /\/wp-admin/i.test(u) || /action=confirm_admin_email/i.test(u),
    { timeout: 30000 }
  );
  await page.waitForTimeout(500);
  await dismissConfirmEmailIfPresent();
  console.log("✅ Logged into WordPress, URL:", page.url());

  // ── Ensure WPCode is active ────────────────────────────────────────────────
  console.log("🔌 Checking for WPCode plugin...");
  await wpAdminGoto(`${baseUrl}/wp-admin/plugins.php`);

  const wpCodeRow = page.locator('tr[data-slug="insert-headers-and-footers"]').first();
  const pluginExists = (await wpCodeRow.count()) > 0;

  if (!pluginExists) {
    console.log("⚠️ WPCode not found — installing...");
    await wpAdminGoto(`${baseUrl}/wp-admin/plugin-install.php`);

    const searchInput = page.locator('#search-plugins, input[name="s"]').first();
    await searchInput.waitFor({ timeout: 30000 });
    await searchInput.fill("WPCode");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    const installBtn = page.locator('a:has-text("Install Now")').first();
    await installBtn.waitFor({ timeout: 30000 });
    await installBtn.click();
    await page.waitForTimeout(5000);

    const activateBtn = page.locator('a:has-text("Activate")').first();
    await activateBtn.waitFor({ timeout: 30000 });
    await activateBtn.click();
    await page.waitForTimeout(3000);
    console.log("✅ WPCode installed and activated");
  } else {
    const isActive = await wpCodeRow.locator('a:has-text("Deactivate")').first().isVisible().catch(() => false);
    const isInactive = await wpCodeRow.locator('a:has-text("Activate")').first().isVisible().catch(() => false);

    if (isActive) {
      console.log("✅ WPCode already active");
    } else if (isInactive) {
      console.log("⚠️ WPCode inactive — activating...");
      await wpCodeRow.locator('a:has-text("Activate")').first().click();
      await page.waitForTimeout(3000);
      console.log("✅ WPCode activated");
    } else {
      console.log("⚠️ Could not determine WPCode state — proceeding anyway");
    }
  }

  // ── Insert GTM codes via WPCode Header & Footer ────────────────────────────
  console.log("⚙️ Opening WPCode Header & Footer settings...");
  await wpAdminGoto(`${baseUrl}/wp-admin/admin.php?page=wpcode-headers-footers`);

  console.log("📝 Inserting GTM codes...");
  await page.evaluate(
    (codes) => {
      const editors = document.querySelectorAll(".CodeMirror");

      if (editors[0] && editors[0].CodeMirror) {
        const headEditor = editors[0].CodeMirror;
        const existingHead = headEditor.getValue().trim();
        const newHead = (codes.gtag ? codes.gtag + "\n" : "") + codes.head;
        headEditor.setValue(existingHead ? existingHead + "\n\n" + newHead : newHead);
      }

      if (editors[1] && editors[1].CodeMirror) {
        const bodyEditor = editors[1].CodeMirror;
        const existingBody = bodyEditor.getValue().trim();
        bodyEditor.setValue(existingBody ? existingBody + "\n\n" + codes.body : codes.body);
      }
    },
    { head: gtm_head_code, body: gtm_body_code, gtag: gtag || "" }
  );

  const saveBtn = page.locator('button:has-text("Save Changes"), input[type="submit"]').first();
  await saveBtn.click();
  await page.waitForTimeout(2000);
  console.log("✅ GTM codes saved in WPCode");

  // ── Form detection ─────────────────────────────────────────────────────────
  console.log("🔍 Detecting contact form on site...");
  const formData = await detectContactForm(page, website_url);

  console.log("✅ GTM codes installed on WordPress site");

  return { cms_type: "wordpress", ...formData };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wix
// ─────────────────────────────────────────────────────────────────────────────

async function installWix(page, { website_url, cms_username, cms_password, gtm_head_code }) {
  if (!cms_username || !cms_password) throw new Error("Wix install: missing cms_username or cms_password");

  // ── Login ──────────────────────────────────────────────────────────────────
  console.log("🔐 Logging into Wix...");
  await page.goto("https://users.wix.com/signin", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await emailInput.waitFor({ timeout: 30000 });
  await emailInput.fill(cms_username);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
  await passwordInput.waitFor({ timeout: 30000 });
  await passwordInput.fill(cms_password);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);
  console.log("✅ Logged into Wix");

  // ── Navigate to Sites dashboard ────────────────────────────────────────────
  console.log("🔍 Opening Wix Sites dashboard...");
  await page.goto(
    "https://manage.wix.com/studio/sites?referralInfo=sidebar&viewId=all-items-view",
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(8000);

  // ── Find the client site card ──────────────────────────────────────────────
  const targetDomain = getDomain(website_url);
  console.log(`🔍 Searching for domain: ${targetDomain}`);

  const searchInput = page.locator('input[placeholder*="Search"], input[aria-label*="Search"]').first();
  await searchInput.waitFor({ timeout: 20000 });
  await searchInput.click().catch(() => {});
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await searchInput.fill(targetDomain);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  let matchText = page.locator(`text=/\\b${escapeRegExp(targetDomain)}\\b/i`).first();

  if (!(await matchText.count())) {
    // Try just the SLD (e.g. "example" from "example.com")
    const key = targetDomain.split(".")[0];
    console.log(`⚠️ Full domain not found — falling back to key: ${key}`);
    await searchInput.click().catch(() => {});
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await searchInput.fill(key);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);
    matchText = page.locator(`text=/\\b${escapeRegExp(key)}\\b/i`).first();
  }

  await matchText.waitFor({ timeout: 20000 });
  console.log("✅ Found site in dashboard");

  // Pick the card element (below the search bar, y > 200)
  const key = targetDomain.split(".")[0];
  const allMatches = await page.locator(`text=/${escapeRegExp(key)}/i`).all();
  let cardBox = null;
  for (const el of allMatches) {
    const box = await el.boundingBox();
    if (box && box.y > 200) {
      cardBox = box;
      break;
    }
  }
  if (!cardBox) throw new Error("Could not find Wix site card on page");

  // Click the action menu button (offset from the text)
  await page.mouse.click(cardBox.x + 170, cardBox.y);
  await page.waitForTimeout(1500);

  const menuOption = page
    .locator('text="Edit Site"')
    .or(page.locator('text="Manage Site"'))
    .or(page.locator('text="Dashboard"'))
    .first();
  await menuOption.waitFor({ timeout: 8000 });
  await menuOption.click();
  await page.waitForTimeout(4000);

  // New tab may open — use the latest page
  const allPages = page.context().pages();
  const activePage = allPages[allPages.length - 1];
  console.log("📍 Now on:", activePage.url());

  await activePage.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
  await activePage.waitForTimeout(2000);

  // ── Extract site ID from URL and navigate to Settings ─────────────────────
  const currentUrl = activePage.url();
  const metaSiteIdMatch =
    currentUrl.match(/metaSiteId=([a-f0-9-]{36})/i) ||
    currentUrl.match(/\/([a-f0-9-]{36})/i);

  if (!metaSiteIdMatch) {
    throw new Error(`Wix: could not extract site ID from URL: ${currentUrl}`);
  }

  const metaSiteId = metaSiteIdMatch[1];
  console.log("✅ Site ID:", metaSiteId);

  const settingsUrl = `https://manage.wix.com/dashboard/${metaSiteId}/settings`;
  await activePage.goto(settingsUrl, { waitUntil: "domcontentloaded" });
  await activePage.waitForTimeout(4000);

  // ── Navigate to Marketing Integrations ────────────────────────────────────
  console.log("🔍 Opening Marketing Integrations...");
  const marketingLink = activePage.locator('text="Marketing Integrations"').first();
  for (let i = 0; i < 10; i++) {
    if (await marketingLink.isVisible().catch(() => false)) break;
    await activePage.evaluate(() => window.scrollBy(0, 300));
    await activePage.waitForTimeout(500);
  }
  await marketingLink.waitFor({ timeout: 10000 });
  await marketingLink.click();
  await activePage.waitForTimeout(3000);

  // ── Extract GTM ID and enter it ───────────────────────────────────────────
  const gtmIdMatch = gtm_head_code.match(/GTM-[A-Z0-9]+/);
  if (!gtmIdMatch) throw new Error("Wix: could not extract GTM ID from gtm_head_code");
  const gtmId = gtmIdMatch[0];
  console.log("✅ GTM ID:", gtmId);

  const gtmSection = activePage.locator('text="Google Tag Manager"').locator("xpath=ancestor::div[3]");
  const connectBtn = gtmSection.locator('button:has-text("Connect")').first();
  await connectBtn.waitFor({ timeout: 10000 });
  await connectBtn.click();
  await activePage.waitForTimeout(3000);

  const addGtmBtn = activePage.locator('button:has-text("Add Google Tag Manager")').first();
  await addGtmBtn.waitFor({ timeout: 10000 });
  await addGtmBtn.click();
  await activePage.waitForTimeout(3000);

  const gtmInput = activePage.locator("input").first();
  await gtmInput.waitFor({ timeout: 10000 });
  await gtmInput.fill(gtmId);
  await activePage.waitForTimeout(1000);

  const gtmSaveBtn = activePage
    .locator('button:has-text("Save")')
    .or(activePage.locator('button:has-text("Apply")'))
    .or(activePage.locator('button:has-text("Add")'))
    .first();
  await gtmSaveBtn.waitFor({ timeout: 10000 });
  await gtmSaveBtn.click();
  await activePage.waitForTimeout(3000);
  console.log("✅ GTM connected on Wix site");

  return {
    cms_type: "wix",
    detected_form_type: "unknown",
    detected_form_id: null,
    detected_form_class: null,
    detected_form_selector: null,
    detected_form_action: null,
    detected_form_source_url: null,
    detected_success_selectors: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Squarespace
// ─────────────────────────────────────────────────────────────────────────────

async function installSquarespace(page, { website_url, cms_username, cms_password, gtm_head_code, gtm_body_code }) {
  if (!cms_username || !cms_password) {
    throw new Error("Squarespace install: missing cms_username or cms_password");
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  console.log("🔐 Logging into Squarespace...");
  await page.goto("https://login.squarespace.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await emailInput.waitFor({ timeout: 30000 });
  await emailInput.fill(cms_username);

  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
  await passwordInput.fill(cms_password);

  const loginBtn = page.locator('button[type="submit"], input[type="submit"]').first();
  await loginBtn.click();
  await page.waitForTimeout(5000);
  console.log("✅ Logged into Squarespace");

  // ── Navigate to the site if multiple sites are listed ─────────────────────
  const siteLink = page
    .locator(
      `a:has-text("${website_url}"), ` +
        `[href*="${website_url.replace("https://", "").replace("http://", "")}"]`
    )
    .first();

  if (await siteLink.isVisible({ timeout: 10000 }).catch(() => false)) {
    await siteLink.click();
    await page.waitForTimeout(3000);
  }

  // ── Settings → Advanced → Code Injection ──────────────────────────────────
  console.log("⚙️ Opening Code Injection settings...");

  const settingsBtn = page.locator('a:has-text("Settings"), button:has-text("Settings")').first();
  await settingsBtn.waitFor({ timeout: 30000 });
  await settingsBtn.click();
  await page.waitForTimeout(2000);

  const advancedLink = page.locator('a:has-text("Advanced"), button:has-text("Advanced")').first();
  await advancedLink.click();
  await page.waitForTimeout(2000);

  const codeInjectionLink = page
    .locator('a:has-text("Code Injection"), button:has-text("Code Injection")')
    .first();
  await codeInjectionLink.waitFor({ timeout: 30000 });
  await codeInjectionLink.click();
  await page.waitForTimeout(2000);

  // ── Insert GTM codes ───────────────────────────────────────────────────────
  console.log("📝 Inserting GTM head code...");
  if ((await page.locator(".CodeMirror").count()) > 0) {
    // Squarespace uses CodeMirror
    await page.evaluate((code) => {
      const cm = document.querySelector(".CodeMirror").CodeMirror;
      cm.setValue(code);
    }, gtm_head_code);
  } else {
    const headerTextarea = page
      .locator('textarea[name*="header"], textarea[placeholder*="header"]')
      .first();
    await headerTextarea.waitFor({ timeout: 30000 });
    await headerTextarea.fill(gtm_head_code);
  }
  console.log("✅ Head code inserted");

  const footerTextarea = page
    .locator('textarea[name*="footer"], textarea[placeholder*="footer"]')
    .first();
  await footerTextarea.fill(gtm_body_code);
  console.log("✅ Body code inserted");

  const saveBtn = page.locator('button:has-text("Save"), input[value="Save"]').first();
  await saveBtn.click();
  await page.waitForTimeout(3000);
  console.log("✅ GTM codes saved on Squarespace");

  return {
    cms_type: "squarespace",
    detected_form_type: "unknown",
    detected_form_id: null,
    detected_form_class: null,
    detected_form_selector: null,
    detected_form_action: null,
    detected_form_source_url: null,
    detected_success_selectors: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Form detection helpers (WordPress only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discover likely pages to check for a contact form.
 * Navigates to the homepage and looks for links matching contact / enquiry keywords.
 * Falls back to a fixed set of slug guesses if nothing is found.
 *
 * @param {import('playwright').Page} page
 * @param {string} siteBaseUrl
 * @returns {string[]} ordered list of page URLs to check
 */
async function discoverSitePages(page, siteBaseUrl) {
  const contactSlugs = ["contact", "contact-us", "get-in-touch", "enquiry", "enquiries", "quote", "request-quote"];

  try {
    await page.goto(siteBaseUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);

    const hrefs = await page.evaluate((base) => {
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.href)
        .filter(
          (href) =>
            href.startsWith(base) &&
            /contact|enquir|quote|touch|request|support/i.test(href)
        )
        .slice(0, 5);
    }, siteBaseUrl);

    if (hrefs.length > 0) {
      return [...new Set([...hrefs, ...contactSlugs.map((s) => `${siteBaseUrl}/${s}/`)])];
    }
  } catch (err) {
    console.log("⚠️ discoverSitePages failed:", err.message);
  }

  return contactSlugs.map((s) => `${siteBaseUrl}/${s}/`);
}

/**
 * Scan a page for contact forms and return metadata about the best candidate.
 * Also checks iframes. Returns an object compatible with the installGtmCodes return shape.
 *
 * @param {import('playwright').Page} page
 * @param {string} siteUrl
 */
async function detectContactForm(page, siteUrl) {
  const siteBaseUrl = siteUrl.replace(/\/$/, "");
  const pagesToCheck = await discoverSitePages(page, siteBaseUrl);

  let detected_form_type = "unknown";
  let detected_form_id = null;
  let detected_form_class = null;
  let detected_form_selector = null;
  let detected_form_action = null;
  let detected_form_source_url = null;
  const detected_success_selectors = [];

  const pluginFallbacks = {
    cf7: ".wpcf7-mail-sent-ok",
    wpforms: ".wpforms-confirmation",
    gravity: ".gform_confirmation_message",
    elementor: ".elementor-message-success",
    divi: ".et_pb_contact_form_success",
    generic: "[class*='thank'], [class*='success'], [class*='confirmation']",
  };

  for (const pageUrl of pagesToCheck) {
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);
    } catch {
      continue;
    }

    const formMeta = await detectBestFormOnPage(page);

    if (formMeta) {
      detected_form_type = formMeta.type;
      detected_form_id = formMeta.form_id;
      detected_form_class = formMeta.form_class;
      detected_form_selector = formMeta.selector;
      detected_form_action = formMeta.form_action;
      detected_form_source_url = pageUrl;

      const fallbackSelector = pluginFallbacks[formMeta.type] || null;
      if (fallbackSelector) detected_success_selectors.push(fallbackSelector);

      console.log(`✅ Form detected on ${pageUrl}: ${formMeta.type} | ${formMeta.selector}`);
      break;
    }

    // Also check iframes (some plugins render inside them)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const frameMeta = await detectBestFormOnPage(frame);
        if (!frameMeta) continue;
        detected_form_type = frameMeta.type;
        detected_form_id = frameMeta.form_id;
        detected_form_class = frameMeta.form_class;
        detected_form_selector = frameMeta.selector;
        detected_form_action = frameMeta.form_action;
        detected_form_source_url = pageUrl;
        console.log(`✅ Frame form detected on ${pageUrl}: ${frameMeta.type} | ${frameMeta.selector}`);
        break;
      } catch {
        // ignore per-frame errors
      }
    }

    if (detected_form_type !== "unknown") break;
  }

  console.log(`📋 Form detection: type=${detected_form_type} | selector=${detected_form_selector}`);

  return {
    detected_form_type,
    detected_form_id,
    detected_form_class,
    detected_form_selector,
    detected_form_action,
    detected_form_source_url,
    detected_success_selectors,
  };
}

/**
 * In-page evaluation: find the highest-scoring contact form on the current page.
 * Identifies the plugin type (cf7, wpforms, gform, elementor, etc.) and builds
 * a CSS selector for the GTM "Contact Form" trigger.
 *
 * Returns null if no qualifying form is found.
 *
 * @param {import('playwright').Page | import('playwright').Frame} pageOrFrame
 */
async function detectBestFormOnPage(pageOrFrame) {
  return await pageOrFrame.evaluate(() => {
    const normaliseClass = (value) => {
      if (!value || typeof value !== "string") return null;
      const cleaned = value.trim().replace(/\s+/g, " ");
      return cleaned || null;
    };

    const getPluginType = (form) => {
      const formClass = `${form.className || ""} ${(form.closest(".wpcf7, .gform_wrapper, .wpforms-container, .elementor-widget, .et_pb_contact, .fluentform, .nf-form-cont, .frm_forms, .hs-form, .metform-form-main-wrapper")?.className || "")}`.toLowerCase();
      const formId = (form.id || "").toLowerCase();
      const action = (form.getAttribute("action") || "").toLowerCase();

      if (form.matches("form.wp-block-gutena-forms") || formClass.includes("gutena")) return "gutenaforms";
      if (form.matches(".wpcf7-form, form.wpcf7") || formClass.includes("wpcf7")) return "cf7";
      if (form.matches('form[id^="gform_"]') || formId.startsWith("gform_") || formClass.includes("gform_wrapper")) return "gform";
      if (form.matches("form.elementor-form, .elementor-form") || formClass.includes("elementor-form")) return "elementor";
      if (form.matches('form[id^="wpforms-form-"], .wpforms-form') || formId.startsWith("wpforms-form-") || formClass.includes("wpforms")) return "wpforms";
      if (formClass.includes("et_pb_contact_form") || formClass.includes("et_pb_contact")) return "divi";
      if (formClass.includes("hs-form") || action.includes("hubspot")) return "hubspot";
      if (formClass.includes("metform")) return "metform";
      if (formClass.includes("ninja-forms") || formClass.includes("nf-form")) return "ninjaforms";
      if (formClass.includes("formidable") || formClass.includes("frm_form")) return "formidable";
      if (formClass.includes("fluentform") || formClass.includes("ff-el-form")) return "fluentforms";
      return "generic";
    };

    const buildSelector = (form) => {
      if (form.id) return `#${form.id}`;
      const classes = (form.className || "").split(/\s+/).map((c) => c.trim()).filter(Boolean);
      const priorityPatterns = ["wpcf7-form", "elementor-form", "wpforms-form", "gform", "gutena", "et_pb_contact", "hs-form", "nf-form", "frm_form", "metform"];
      const matched = classes.find((cls) => priorityPatterns.some((p) => cls.toLowerCase().includes(p)));
      if (matched) return `.${matched}`;
      if (classes.length) return `.${classes[0]}`;
      return "form";
    };

    const scoreForm = (form) => {
      let score = 0;
      const id = (form.id || "").toLowerCase();
      const cls = (form.className || "").toLowerCase();
      const action = (form.getAttribute("action") || "").toLowerCase();
      const text = (form.innerText || "").toLowerCase();

      if (id.includes("adminbarsearch") || id.includes("search") || cls.includes("search-form") || action.includes("wp-login")) return -999;

      if (form.querySelector('input[type="email"], input[name*="email" i]')) score += 3;
      if (form.querySelector('input[name*="name" i], input[placeholder*="name" i]')) score += 2;
      if (form.querySelector("textarea")) score += 3;
      if (form.querySelector('input[type="tel"], input[name*="phone" i]')) score += 1;
      if (form.querySelector('button[type="submit"], input[type="submit"], button')) score += 3;

      const fieldCount = form.querySelectorAll("input, textarea, select").length;
      if (fieldCount >= 3) score += 2;
      if (/contact|enquir|quote|support|get in touch|message|book|request/.test(text)) score += 3;
      if (/contact|enquir|quote|support|lead|submit/.test(action)) score += 2;
      if (/contact|enquir|quote|support|form|lead/.test(cls)) score += 2;
      if (/contact|enquir|quote|support|form/.test(id)) score += 2;
      if (form.offsetParent === null) score -= 3;

      return score;
    };

    const forms = Array.from(document.querySelectorAll("form"));
    if (!forms.length) return null;

    const candidates = forms
      .map((form) => ({
        type: getPluginType(form),
        score: scoreForm(form),
        form_id: form.id || null,
        form_class: normaliseClass(form.className),
        form_action: form.getAttribute("action") || null,
        selector: buildSelector(form),
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => {
        const aNamed = a.type !== "generic" ? 1 : 0;
        const bNamed = b.type !== "generic" ? 1 : 0;
        if (bNamed !== aNamed) return bNamed - aNamed;
        return b.score - a.score;
      });

    const best = candidates[0];
    if (!best || (best.score < 3 && best.type === "generic")) return null;
    return best;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────────────────────

function getDomain(input) {
  try {
    const u = new URL(input.startsWith("http") ? input : `https://${input}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(input)
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .toLowerCase();
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { installGtmCodes };
