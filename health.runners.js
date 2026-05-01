// health.runners.js
// INTELLIGENT TRACKING HEALTH CHECK
//
// Version history:
//   V27  2026-03-13  Concurrency fix — raised MAX_CONCURRENT to 20, async queue with slot
//                    acquire/release, 120s global timeout per site
//   V28  2026-03-25  Roll back to clean base; add WebGL crash fix (--disable-webgl/2),
//                    browser crash recovery (disconnected event + newContext retry),
//                    tightened phone regex (pureDigits 10–13 chars, IP exclusion)
//   V29  2026-03-25  Restore feedback improvements: 4-attempt GTM retry loop with delays,
//                    live iframe scan, gtm.start dataLayer signal, page.content() fallback,
//                    Playwright HTTP fallback (Chrome TLS), non-clickable false-positive fix
//   V30  2026-03-25  Remove GPU compositing crash (--disable-gpu-compositing,
//                    --disable-accelerated-2d-canvas, --disable-accelerated-video-decode),
//                    comment out non-clickable contact detection (too many false positives)
//   V31  2026-03-30  GTM final retry delay increased 3s → 6s; non-clickable detection
//                    removed entirely; grade output simplified to Perfect / Partial / Fail
//   V32  2026-03-30  Fix t.co substring matching social domain blocker (false-positives on .com sites);
//                    fix G-RECAPTCHA false GA4 ID (require digit in ID); add <link> tag GTM scan;
//                    direct GA4 (no GTM) allowed through to CTA testing; more cookie consent CMPs
//   V33  2026-03-30  Fix "mainForms is not iterable" crash (safeEvaluate null guard);
//                    filter placeholder/fake GTM IDs (GTM-XXXXXXX, GTM-INIT, GTM-SCRIPT etc.);
//                    filter too-short GA4 IDs (G-1234 etc., require ≥7 chars after dash);
//                    expand CAPTCHA/bot-protection detection selectors
//   V34  2026-04-08  Increase GLOBAL_TIMEOUT_MS 120s→180s (eliminates timeout ERRORs on slow sites);
//                    fix <link href> false-positive GTM detection — only flag gtm.js links, not
//                    plain preconnect/dns-prefetch to googletagmanager.com (was causing direct-GA4
//                    sites to show "GTM is installed but..." instead of correct direct-GA4 message);
//                    add post-consent scroll to trigger IntersectionObserver/consent-delayed GTM loads
//   V36  2026-04-10  Fix CMP-blocked script detection: scan data-src, data-original-src,
//                    data-href on <script> and data-src on <iframe> — consent managers
//                    (CookieYes, Cookiebot, Complianz) move src→data-src to block execution
//                    but GTM ID is still in the attribute; extend page.content() fallback
//                    to scan full HTML (not just <head>) and detect data-src GTM pattern
//   V35  2026-04-10  Remove early NO_TRACKING return — now visits all discovered pages before
//                    concluding no tracking; re-runs detectTrackingSetup on inner pages so GTM
//                    installed only on contact/inner pages is correctly detected; CTA tests only
//                    run on pages where tracking is confirmed;
//                    server-side GTM: extend GTM beacon classifier to match /gtm.js?id=GTM- on
//                    any domain (sGTM proxy); extend noscript iframe check to match /ns.html?id=GTM-
//                    on any domain
//

const SCRIPT_VERSION = "2026-04-16T00:00:00Z-V41";

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
function logInfo(msg, data = null) {
  if (LOG_LEVEL === "silent") return;
  const ts = new Date().toISOString();
  if (data) console.log(`[${ts}] ${msg}`, JSON.stringify(data, null, 2));
  else console.log(`[${ts}] ${msg}`);
}
function logDebug(msg, data = null) {
  if (LOG_LEVEL !== "debug") return;
  const ts = new Date().toISOString();
  if (data) console.log(`[${ts}] [DEBUG] ${msg}`, JSON.stringify(data, null, 2));
  else console.log(`[${ts}] [DEBUG] ${msg}`);
}

// ─────────────────────────────────────────────
// Configuration — all overridable via env vars
// ─────────────────────────────────────────────
const MAX_PAGES_TO_VISIT = Number(process.env.HEALTH_MAX_PAGES || 3);
const MAX_PHONE_TESTS = Number(process.env.HEALTH_MAX_PHONE_TESTS || 50);
const MAX_EMAIL_TESTS = Number(process.env.HEALTH_MAX_EMAIL_TESTS || 50);

// FIX 3: single nav attempt, hard 15s cap
const NAV_TIMEOUT_MS = Number(process.env.HEALTH_NAV_TIMEOUT || 15000);

const HEADLESS = true;

// Primary CTA click poll window
const POST_ACTION_POLL_MS = Number(process.env.HEALTH_POLL_MS || 3000);

// Duplicate-fire second click — shorter window, we only need to detect presence/absence
const SECOND_CLICK_POLL_MS = Number(process.env.HEALTH_SECOND_POLL_MS || 1500);

// Settle between first and second click in duplicate-fire test
const DUPLICATE_TEST_SETTLE_MS = Number(process.env.HEALTH_SETTLE_MS || 600);

const FORM_SUBMIT_WAIT_MS = Number(process.env.HEALTH_FORM_WAIT_MS || 5000);

// FIX 2: hard global cap per site; also used as acquireCheckSlot timeout
const GLOBAL_TIMEOUT_MS = Number(process.env.HEALTH_GLOBAL_TIMEOUT || 180000);
const SLOT_ACQUIRE_TIMEOUT = Number(process.env.HEALTH_SLOT_TIMEOUT || 120000);

// FIX 1: raised to 20; safe because each worker is mostly I/O-bound
const MAX_CONCURRENT_CHECKS = Number(process.env.HEALTH_MAX_CONCURRENT || 20);

// FIX 5: how long to actively poll for GTM after consent (ms)
const POST_CONSENT_MAX_WAIT_MS = Number(process.env.HEALTH_CONSENT_WAIT || 6000);
const POST_CONSENT_POLL_MS = 200; // check every 200ms

const TEST_VALUES = {
  firstName: "HealthCheck",
  lastName: "Test",
  fullName: "HealthCheck Test",
  email: process.env.HEALTH_TEST_EMAIL || "test-automation@example.com",
  phone: process.env.HEALTH_TEST_PHONE || "01632960123",
  message: process.env.HEALTH_TEST_MESSAGE || "This is a tracking health check. Please ignore.",
  company: "Test Company",
  postcode: "SW1A 1AA",
  city: "London",
  address: "1 Test Street",
  subject: "General Enquiry",
  date: "2026-12-31",
  number: "1",
};

const GENERIC_EVENTS = new Set([
  "page_view",
  "user_engagement",
  "scroll",
  "session_start",
  "first_visit",
  "form_start",
  "gtm.js",
  "gtm.dom",
  "gtm.load",
  "timing_complete",
  "exception",
  "web_vitals",
  "optimize.activate",
]);

const CONTACT_PAGE_KEYWORDS = [
  "contact",
  "get-in-touch",
  "enquire",
  "enquiry",
  "quote",
  "book",
  "request",
  "reach-us",
  "talk",
  "call-us",
];
const COMMON_CONTACT_PATHS = ["/contact", "/contact-us", "/get-in-touch", "/enquiry", "/quote", "/book", "/reach-us"];
const THIRD_PARTY_HINTS = [
  "hubspot",
  "hsforms",
  "jotform",
  "typeform",
  "google.com/forms",
  "forms.gle",
  "calendly",
  "marketo",
  "salesforce",
  "formstack",
  "cognitoforms",
  "gravity",
  "wufoo",
];
const SOCIAL_DOMAINS = [
  "facebook.com",
  "twitter.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "pinterest.com",
  "youtube.com",
  "whatsapp.com",
  "snapchat.com",
  "t.co",
  "lnkd.in",
  "fb.com",
  "x.com",
];

// Placeholder / fake GTM IDs that appear in themes, starter templates, or error pages.
// These are never real container IDs — exclude them from detected_gtm_ids.
const FAKE_GTM_ID_PATTERNS = [
  /^GTM-[X]+$/i, // GTM-XXXXXXX (template placeholders)
  /^GTM-INIT$/i, // GTM-INIT
  /^GTM-SCRIPT$/i, // GTM-SCRIPT
  /^GTM-TAG$/i, // GTM-TAG
  /^GTM-CODE$/i, // GTM-CODE
  /^GTM-ID$/i, // GTM-ID
  /^GTM-[0-9]{1,3}$/i, // GTM-1, GTM-12 (too short to be real)
];

// Real GTM IDs are GTM- followed by exactly 7–8 alphanumeric chars.
// Filter out obvious fakes before storing.
function isValidGtmId(id) {
  if (!id) return false;
  const upper = id.toUpperCase();
  if (FAKE_GTM_ID_PATTERNS.some((re) => re.test(upper))) return false;
  // Must be GTM- + 4–10 real alphanumeric chars (real IDs are 7–8 but allow a little slack)
  return /^GTM-[A-Z0-9]{4,10}$/.test(upper);
}

// Real GA4 measurement IDs are G- or GT- followed by ≥7 alphanumeric chars (containing ≥1 digit).
// Short ones like G-1234 are template placeholders.
function isValidGa4Id(id) {
  if (!id) return false;
  const upper = id.toUpperCase();
  return /^(?:G|GT)-(?=[A-Z0-9]*[0-9])[A-Z0-9]{7,}$/.test(upper);
}

// Proper social-domain check — use hostname boundary matching, not substring.
// Substring matching ("t.co".includes) false-fires on any .com domain ending in "t"
// e.g. paullonghurst.com, handsonfeet.com, carillionprint.co.uk
function isSocialDomain(urlStr) {
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase();
    return SOCIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith("." + d));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// FIX 1: Concurrency — async mutex for browser pool
// ─────────────────────────────────────────────
let activeChecks = 0;
const checkQueue = [];

let globalBrowser = null;
let browserUses = 0;
let browserLaunchLock = null; // Promise while a launch is in progress
const MAX_BROWSER_USES = 100;

async function getBrowser() {
  // If a launch is already in progress, wait for it rather than launching again
  if (browserLaunchLock) {
    await browserLaunchLock;
  }

  // If Chrome crashed (WebGL fault, OOM, etc.) clear the dead reference so we relaunch
  if (globalBrowser && !globalBrowser.isConnected()) {
    logInfo("⚠️ Browser disconnected — clearing stale reference for relaunch");
    globalBrowser = null;
    browserUses = 0;
  }

  // Recycle browser after MAX_BROWSER_USES to prevent memory leaks
  if (globalBrowser && browserUses >= MAX_BROWSER_USES) {
    logDebug("♻️  Recycling browser after max uses");
    const old = globalBrowser;
    globalBrowser = null;
    browserUses = 0;
    old.close().catch(() => null); // fire-and-forget — don't block on close
  }

  if (!globalBrowser) {
    // Set the lock so concurrent callers wait for this launch
    let resolveLock;
    browserLaunchLock = new Promise((r) => {
      resolveLock = r;
    });

    try {
      globalBrowser = await chromium.launch({
        headless: HEADLESS,
        timeout: 30000,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          // Disable all GPU paths — on headless Linux the GPU process has no
          // hardware to talk to. --disable-gpu alone is not enough: Chrome's
          // software compositing pipeline (SharedImageManager) still runs and
          // hits fatal mailbox errors that trigger a graceful browser shutdown.
          "--disable-gpu",
          "--disable-gpu-compositing", // stops SharedImageManager crashes
          "--disable-accelerated-2d-canvas", // no GPU canvas (uses CPU path)
          "--disable-accelerated-video-decode",
          "--disable-webgl",
          "--disable-webgl2",
          // Suppress ALSA audio errors and media permission prompts
          "--mute-audio",
          "--use-fake-ui-for-media-stream",
          "--proxy-server='direct://'",
          "--proxy-bypass-list=*",
        ],
      });
      // Clear the global ref the moment Chrome dies so next getBrowser() relaunches
      globalBrowser.on("disconnected", () => {
        logInfo("⚠️ Browser process disconnected — will relaunch on next request");
        globalBrowser = null;
        browserUses = 0;
      });
      logDebug("🚀 Browser launched");
    } finally {
      browserLaunchLock = null;
      resolveLock();
    }
  }

  browserUses++;
  return globalBrowser;
}

// ─────────────────────────────────────────────
// RAM safeguard: track open contexts and force-close stale ones
// ─────────────────────────────────────────────
const openContexts = new Map(); // context -> { createdAt, url }
const STALE_CONTEXT_MS = GLOBAL_TIMEOUT_MS + 60000; // max age before force-close

setInterval(async () => {
  const now = Date.now();
  for (const [ctx, info] of openContexts) {
    if (now - info.createdAt > STALE_CONTEXT_MS) {
      logInfo(
        `⚠️ RAM safeguard: force-closing stale context for ${info.url} (open ${Math.round((now - info.createdAt) / 1000)}s)`,
      );
      openContexts.delete(ctx);
      try {
        await ctx.close();
      } catch {}
    }
  }
}, 60000);

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────
function normaliseUrl(input) {
  const u = (input || "").trim().replace(/^http:\/\//i, "https://");
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}
function safeUrlObj(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}
function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}
function escapeAttrValue(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function nowIso() {
  return new Date().toISOString();
}

async function safeEvaluate(page, func, ...args) {
  try {
    return await page.evaluate(func, ...args);
  } catch {
    return null;
  }
}

async function safeWait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// FIX 2: acquireCheckSlot with hard timeout so a stuck check never blocks the queue
async function acquireCheckSlot() {
  if (activeChecks < MAX_CONCURRENT_CHECKS) {
    activeChecks++;
    return;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Remove from queue if still waiting
      const idx = checkQueue.indexOf(entry);
      if (idx !== -1) checkQueue.splice(idx, 1);
      reject(
        new Error(
          `acquireCheckSlot timed out after ${SLOT_ACQUIRE_TIMEOUT}ms — all ${MAX_CONCURRENT_CHECKS} workers busy`,
        ),
      );
    }, SLOT_ACQUIRE_TIMEOUT);

    const entry = () => {
      clearTimeout(timer);
      activeChecks++;
      resolve();
    };
    checkQueue.push(entry);
  });
}

function releaseCheckSlot() {
  activeChecks--;
  if (checkQueue.length > 0) {
    const next = checkQueue.shift();
    next(); // next() increments activeChecks internally
  }
}

async function withTimeout(promise, ms, msg) {
  let id;
  const t = new Promise((_, rej) => {
    id = setTimeout(() => rej(new Error(msg)), ms);
  });
  try {
    const r = await Promise.race([promise, t]);
    clearTimeout(id);
    return r;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// FIX 3: single-attempt safeGoto — fail fast on dead sites, no double-timeout
async function safeGoto(page, url) {
  if (isSocialDomain(url)) {
    return { ok: false, error: "Blocked social domain" };
  }
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function simulateHumanBrowsing(page) {
  try {
    await safeEvaluate(page, () => window.scrollBy(0, document.body.scrollHeight / 2));
    await safeWait(400);
    const vp = page.viewportSize();
    if (vp) await page.mouse.move(Math.random() * vp.width, Math.random() * vp.height, { steps: 5 });
    await safeEvaluate(page, () => window.scrollTo(0, 0));
  } catch {}
}

function classifyAndParseBeacon(reqUrl, postData) {
  const u = (reqUrl || "").toLowerCase();
  let type = "OTHER";
  if (u.includes("/g/collect") || u.includes("/r/collect") || u.includes("/mp/collect")) type = "GA4";
  else if (u.includes("gtag/js")) type = "GTAG";
  else if (u.includes("google-analytics.com")) type = "GA";
  else if (/googletagmanager\.com\/gtm\.js/.test(u) || /\/gtm\.js\?(?:[^#]*&)?id=GTM-[A-Z0-9]{4,}/i.test(u))
    type = "GTM"; // second clause catches server-side GTM proxy on custom domain
  if (type === "OTHER") return null;

  let event_name = null;
  try {
    event_name = new URL(reqUrl).searchParams.get("en");
  } catch {}
  if (!event_name && postData) {
    try {
      event_name = new URLSearchParams(postData).get("en");
    } catch {}
    if (!event_name) {
      try {
        const p = JSON.parse(postData);
        if (p?.events?.[0]?.name) event_name = p.events[0].name;
        else if (p?.en) event_name = p.en;
      } catch {}
    }
  }

  const payload_dump = (reqUrl + " " + (postData || "")).toLowerCase();
  let tid = null;
  try {
    tid = new URL(reqUrl).searchParams.get("tid");
  } catch {}
  if (!tid && postData) {
    try {
      tid = new URLSearchParams(postData).get("tid");
    } catch {}
    try {
      if (!tid) tid = JSON.parse(postData)?.tid;
    } catch {}
  }
  let gtmHash = null;
  try {
    gtmHash = new URL(reqUrl).searchParams.get("gtm");
  } catch {}

  // ── Feature 3: full GA4 payload extraction ──
  // Parse all event parameters (ep.*), user properties (up.*), and session info
  // from the GA4 collect request body so failure messages can be specific.
  let params = null;
  if (type === "GA4" && postData) {
    try {
      const p = new URLSearchParams(postData);
      const extracted = {};
      // Standard GA4 Measurement Protocol fields
      for (const key of ["en", "tid", "cid", "sid", "sct", "_et", "dl", "dt", "dr"]) {
        const v = p.get(key);
        if (v) extracted[key] = v;
      }
      // Event parameters (ep.XXX) and user properties (up.XXX)
      for (const [k, v] of p.entries()) {
        if (k.startsWith("ep.") || k.startsWith("up.") || k.startsWith("epn.")) {
          extracted[k] = v;
        }
      }
      if (Object.keys(extracted).length > 0) params = extracted;
    } catch {}
    // Also try JSON body (GA4 Measurement Protocol v2 batch format)
    if (!params) {
      try {
        const body = JSON.parse(postData);
        const ev = body?.events?.[0];
        if (ev) params = { en: ev.name, ...(ev.params || {}) };
      } catch {}
    }
  }

  return { url: reqUrl, timestamp: nowIso(), type, event_name, payload_dump, tid, gtmHash, params };
}

// ─────────────────────────────────────────────
// Cookie consent
// ─────────────────────────────────────────────
async function handleCookieConsent(page) {
  const out = { accepted: false };

  // ── Native Playwright click (primary attempt) ──────────────────────────────
  // React/SPA consent banners often don't respond to el.click() from safeEvaluate
  // because they use synthetic event delegation. Playwright's locator.click() sends
  // real pointer events (pointerdown → mousedown → mouseup → click) that React handles.
  const nativePatterns = [
    /^accept all$/i,
    /^accept all cookies$/i,
    /^accept cookies$/i,
    /^allow all$/i,
    /^allow all cookies$/i,
    /^i accept$/i,
    /^i agree$/i,
    /^agree$/i,
    /^agree and continue$/i,
    /^ok$/i,
    /^got it$/i,
    /^continue$/i,
  ];
  for (const pattern of nativePatterns) {
    try {
      const btn = page.getByRole("button", { name: pattern });
      if ((await btn.count()) > 0) {
        await btn.first().click({ timeout: 1500, force: true });
        out.accepted = true;
        logDebug("🍪 Cookie consent accepted (native click)");
        return out;
      }
    } catch {}
  }
  // ──────────────────────────────────────────────────────────────────────────
  const candidates = [
    // OneTrust
    "#onetrust-accept-btn-handler",
    // Cookiebot
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    // Complianz
    ".cmplz-accept",
    ".cmplz-btn",
    // Cookie Notice / WP Cookie Notice
    "#wt-cli-accept-all-btn",
    ".wt-cli-accept-all-btn",
    "#cookie_action_close_header",
    ".cookie-accept",
    ".accept-cookies",
    // CookieYes
    "[data-cky-tag='accept-button']",
    // Iubenda
    "#iubFooterBtn",
    ".iubenda-cs-accept-btn",
    // CookieScript
    "#cookiescript_accept",
    "#cookiescript_acceptall",
    // Civic Cookie Control
    "#ccc-accept-settings",
    "#ccc-notify-accept",
    // Osano
    ".osano-cm-accept-all",
    // TrustArc
    "#truste-consent-button",
    ".truste_popframe",
    // OneTrust
    "#onetrust-accept-btn-handler",
    ".onetrust-accept-btn-handler",
    // Borlabs Cookie
    "#CybotCookiebotDialogBodyButtonAccept",
    // Complianz
    ".cmplz-accept",
    ".cmplz-btn.cmplz-accept",
    // WP Cookie Notice
    "#cookie-notice-agree",
    // GDPR Cookie Consent (WP plugin)
    "#gdpr-cookie-accept",
    ".gdpr-cookie-accept",
    // Cookiebot
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    // Generic patterns
    "[aria-label='Accept cookies']",
    "[aria-label='Accept all cookies']",
    "[id*='accept'][class*='cookie']",
    "[class*='accept'][class*='cookie']",
    "[id*='cookie'][id*='accept']",
    "[class*='cookie-accept']",
    "button[id*='consent'][id*='accept']",
    "button[class*='consent-accept']",
  ];
  const textLabels = [
    "Accept All",
    "Accept all",
    "Accept All Cookies",
    "Accept Cookies",
    "Accept all cookies",
    "I Accept",
    "I accept",
    "I Agree",
    "Allow All",
    "Allow all",
    "Allow Cookies",
    "Allow all cookies",
    "Agree",
    "Agree and Continue",
    "Agree & Continue",
    "OK",
    "Got it",
    "Continue",
    "Yes, I agree",
    "Yes I agree",
    "Close and accept",
  ];

  try {
    const clicked = await safeEvaluate(
      page,
      (sels, labels) => {
        for (const sel of sels) {
          for (const el of document.querySelectorAll(sel)) {
            if (el.offsetHeight > 0) {
              el.click();
              return true;
            }
          }
        }
        for (const btn of document.querySelectorAll("button,a[role='button'],[type='button'],[type='submit']")) {
          const t = (btn.textContent || "").trim();
          if (labels.some((l) => t === l || t.startsWith(l)) && btn.offsetHeight > 0) {
            btn.click();
            return true;
          }
        }
        return false;
      },
      candidates,
      textLabels,
    );

    if (clicked) {
      out.accepted = true;
      logDebug("🍪 Cookie consent accepted");
    }
  } catch {}
  return out;
}

// ─────────────────────────────────────────────
// FIX 5+6: Post-consent active GTM poll
// ─────────────────────────────────────────────
async function waitForGtmInit(page, beacons, maxWaitMs = POST_CONSENT_MAX_WAIT_MS) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const gtmReady = await safeEvaluate(page, () => !!window.google_tag_manager);
    if (gtmReady) {
      logDebug("✅ GTM object detected after consent");
      return true;
    }

    const gtmBeacon = beacons.some((b) => /googletagmanager\.com\/gtm\.js/.test(b.url));
    if (gtmBeacon) {
      logDebug("✅ GTM beacon detected after consent");
      return true;
    }

    const gtmInSource = await safeEvaluate(page, () => {
      for (const s of document.querySelectorAll("script")) {
        const content = (s.src || "") + (s.innerHTML || "");
        if (/GTM-[A-Z0-9]{4,}/i.test(content)) return true;
      }
      return false;
    });
    if (gtmInSource) {
      logDebug("✅ GTM ID found in source after consent");
      return true;
    }

    // Early-exit for direct GA4 (no GTM) — gtag.js has loaded and a G- ID is present.
    // These sites will never set window.google_tag_manager, so avoid burning the full wait window.
    const directGa4Ready = await safeEvaluate(page, () => {
      if (typeof window.gtag !== "function") return false;
      for (const s of document.querySelectorAll("script[src]")) {
        if (/googletagmanager\.com\/gtag\/js/i.test(s.src || "")) return true;
      }
      return false;
    });
    if (directGa4Ready) {
      logDebug("✅ Direct GA4 (gtag.js) detected — skipping remaining GTM wait");
      return false; // not GTM, but no point waiting longer
    }

    // Also early-exit if a GA4 collect beacon has already fired — tracking is clearly active
    const ga4BeaconFired = beacons.some((b) => b.type === "GA4");
    if (ga4BeaconFired) {
      logDebug("✅ GA4 collect beacon detected — skipping remaining GTM wait");
      return false;
    }

    await safeWait(POST_CONSENT_POLL_MS);
  }
  logDebug("⏱ GTM init poll timed out — proceeding anyway");
  return false;
}

// ─────────────────────────────────────────────
// FIX 4: detectTrackingSetup — break early on GTM confirmed
// ─────────────────────────────────────────────
async function detectTrackingSetup(page, beacons) {
  let gtmIds = new Set();
  let ga4Ids = new Set();

  let gtmStartFired = false; // set when dataLayer contains {event:"gtm.start"}
  let gtmIframe = false; // set when a live GTM noscript iframe is found

  // ── Step 1: HTML source scan (primary) ────────────────────────────────────
  // Pull the full serialised HTML immediately after consent/settle.
  // This catches the standard static GTM/GA4 installation snippets:
  //   <script src="gtm.js?id=GTM-XXXXX">   ← GTM head snippet
  //   ('GTM-XXXXX')                         ← GTM inline IIFE
  //   ns.html?id=GTM-XXXXX                  ← GTM noscript body tag
  //   gtag/js?id=G-XXXXX                    ← direct GA4 script src
  //   gtag('config','G-XXXXX')              ← direct GA4 config call
  // Also catches CMP-blocked scripts where src has been moved to data-src —
  // page.content() returns raw HTML attribute strings, not live DOM .src values.
  try {
    const html = await page.content();
    if (html) {
      const upper = html.toUpperCase();
      for (const m of upper.matchAll(/GTM-[A-Z0-9]{4,}/g)) {
        if (isValidGtmId(m[0])) gtmIds.add(m[0]);
      }
      for (const m of upper.matchAll(/\b(?:G|GT)-(?=[A-Z0-9]*[0-9])[A-Z0-9]{7,}\b/g)) {
        if (isValidGa4Id(m[0])) ga4Ids.add(m[0]);
      }
      if (/googletagmanager\.com\/ns\.html/i.test(html)) gtmIframe = true;
      if (/data-src="[^"]*googletagmanager\.com\/gtm\.js/i.test(html)) gtmIframe = true;
      logDebug(`HTML source scan: ${gtmIds.size} GTM ID(s), ${ga4Ids.size} GA4 ID(s)`);
    }
  } catch (e) {
    logDebug(`HTML source scan failed: ${e.message}`);
  }

  // ── Step 2: Runtime / DOM scan ────────────────────────────────────────────
  // Checks dataLayer, window.google_tag_manager, gtag.q, and dynamically
  // injected script attributes that only exist after JS execution.
  // Run 1 pass if the HTML scan already found IDs (just need runtime signals);
  // run up to 4 passes with back-off if the HTML scan found nothing (deferred
  // loading, SPA hydration, or heavy consent gate delay).
  const maxAttempts = gtmIds.size > 0 || gtmIframe ? 1 : 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const scan = await safeEvaluate(page, () => {
      const found = { gtm: [], ga4: [], gtmStartFired: false, gtmIframe: false };
      function extract(str) {
        if (typeof str !== "string" || !str) return;
        for (const m of str.toUpperCase().matchAll(/GTM-[A-Z0-9]{4,}/g)) found.gtm.push(m[0]);
        // Require ≥7 chars after dash (rules out G-1234, G-RECAPTCHA etc.)
        for (const m of str.toUpperCase().matchAll(/\b(?:G|GT)-(?=[A-Z0-9]*[0-9])[A-Z0-9]{7,}\b/g))
          found.ga4.push(m[0]);
      }
      for (const s of document.querySelectorAll("script")) {
        extract(s.src);
        extract(s.innerHTML);
        // CMP-blocked scripts: consent managers move src → data-src to block execution.
        // The GTM ID is still in the attribute — scan all data-* src variants.
        extract(s.getAttribute("data-src") || "");
        extract(s.getAttribute("data-original-src") || "");
        extract(s.getAttribute("data-href") || "");
        extract(s.getAttribute("data-gtmsrc") || "");
      }
      for (const ns of document.querySelectorAll("noscript")) extract(ns.innerHTML);
      // Live iframes from GTM noscript fallback (always present even when JS blocked).
      // Second clause catches server-side GTM proxying ns.html through a custom domain.
      for (const f of document.querySelectorAll("iframe")) {
        const src = f.getAttribute("src") || f.getAttribute("data-src") || "";
        if (/googletagmanager\.com\/ns\.html/i.test(src) || /\/ns\.html\?(?:[^#]*&)?id=GTM-[A-Z0-9]{4,}/i.test(src)) {
          found.gtmIframe = true;
          extract(src);
        }
      }
      for (const m of document.querySelectorAll("meta")) {
        extract(m.getAttribute("content") || "");
        extract(m.getAttribute("name") || "");
      }
      // <link rel="preload"> referencing gtm.js is a reliable GTM signal.
      // Deliberately NOT matching plain preconnect/dns-prefetch to googletagmanager.com —
      // those appear on direct GA4 (gtag.js) sites and would cause a false GTM positive.
      for (const l of document.querySelectorAll("link[href]")) {
        const href = l.getAttribute("href") || "";
        if (/googletagmanager\.com\/gtm\.js/i.test(href)) found.gtmIframe = true;
        extract(href);
      }
      if (Array.isArray(window.dataLayer)) {
        for (const push of window.dataLayer) {
          try {
            extract(JSON.stringify(push));
            // gtm.start is pushed by GTM itself on full initialisation — definitive proof
            if (push && push.event === "gtm.start") found.gtmStartFired = true;
          } catch {}
        }
      }
      if (window.google_tag_manager) {
        for (const k of Object.keys(window.google_tag_manager)) extract(k);
      }
      if (window.dataLayer) {
        for (const item of window.dataLayer) {
          try {
            const s = JSON.stringify(item);
            if (s.includes('"config"') || (item[0] === "config" && typeof item[1] === "string")) {
              extract(typeof item[1] === "string" ? item[1] : s);
            }
          } catch {}
        }
      }
      if (typeof window.gtag === "function" && window.gtag.q) {
        for (const call of window.gtag.q || []) {
          try {
            extract(JSON.stringify(call));
          } catch {}
        }
      }
      return found;
    });

    if (scan) {
      scan.gtm.forEach((id) => {
        if (isValidGtmId(id)) gtmIds.add(id);
      });
      scan.ga4.forEach((id) => {
        if (isValidGa4Id(id)) ga4Ids.add(id);
      });
      if (scan.gtmStartFired) gtmStartFired = true;
      if (scan.gtmIframe) gtmIframe = true;
    }

    for (const b of beacons) {
      const u = b.url.toUpperCase();
      for (const m of u.matchAll(/GTM-[A-Z0-9]{4,}/g)) {
        if (isValidGtmId(m[0])) gtmIds.add(m[0]);
      }
      if (b.type === "GA4" && b.tid && isValidGa4Id(b.tid)) ga4Ids.add(b.tid.toUpperCase());
      try {
        const params = new URL(b.url).searchParams;
        const id = params.get("id") || params.get("tid");
        if (id && isValidGa4Id(id)) ga4Ids.add(id.toUpperCase());
      } catch {}
    }

    const gtmInNetwork = beacons.some((b) => /googletagmanager\.com\/(gtm\.js|ns\.html)/.test(b.url));
    const globalGtmObj = await safeEvaluate(page, () => !!window.google_tag_manager);

    if (gtmIds.size > 0 || gtmInNetwork || globalGtmObj || gtmStartFired || gtmIframe) break;

    await safeWait([500, 1000, 2000, 6000][attempt] || 1000);
  }

  const linkedGa4 = new Set();
  const unlinkedGa4 = new Set();
  for (const b of beacons) {
    if (b.type === "GA4" && b.tid && isValidGa4Id(b.tid)) {
      const tid = b.tid.toUpperCase();
      if (b.gtmHash) linkedGa4.add(tid);
      else unlinkedGa4.add(tid);
    }
  }
  for (const id of ga4Ids) {
    if (!linkedGa4.has(id)) unlinkedGa4.add(id);
  }

  const gtmInNetwork = beacons.some((b) => /googletagmanager\.com\/(gtm\.js|ns\.html)/.test(b.url));
  const ga4FiredViaGtm = beacons.some((b) => b.type === "GA4" && !!b.gtmHash && isValidGa4Id(b.tid));
  const globalGtmObj = await safeEvaluate(page, () => !!window.google_tag_manager);

  const has_gtm = gtmIds.size > 0 || globalGtmObj || gtmInNetwork || ga4FiredViaGtm || gtmStartFired || gtmIframe;
  const has_any_ga4 = ga4Ids.size > 0 || linkedGa4.size > 0 || unlinkedGa4.size > 0;

  return {
    gtm: Array.from(gtmIds),
    ga4: Array.from(linkedGa4),
    unlinked_ga4: Array.from(unlinkedGa4),
    has_gtm,
    has_linked_ga4: linkedGa4.size > 0,
    has_any_ga4,
  };
}

// ─────────────────────────────────────────────
// Page & CTA Discovery
// ─────────────────────────────────────────────
async function discoverCandidatePages(page, baseUrl) {
  const currentUrl = page.url();
  const origin = safeUrlObj(currentUrl)?.origin || safeUrlObj(baseUrl)?.origin || null;

  let links = await safeEvaluate(page, () =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      href: a.getAttribute("href") || "",
      text: (a.textContent || "").trim().slice(0, 120),
    })),
  );
  if (!links) links = [];

  const seen = new Set([currentUrl]);
  const scored = links
    .map((l) => {
      try {
        const u = new URL(l.href, currentUrl);
        u.hash = "";
        const str = u.toString();
        if (isSocialDomain(str)) return null;
        if (origin && !str.startsWith(origin)) return null;
        return { url: str, text: l.text };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((x) => ({
      ...x,
      score: CONTACT_PAGE_KEYWORDS.reduce(
        (acc, k) => (`${x.url} ${x.text}`.toLowerCase().includes(k) ? acc + 1 : acc),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const uniqueSorted = scored.filter((x) => {
    if (seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });
  // Prioritise URLs that literally contain "contact" — they're the most likely to have CTAs
  const firstContact = uniqueSorted.find((x) => /contact/.test(x.url.toLowerCase()));
  let discovered = [firstContact?.url, ...uniqueSorted.filter((x) => x !== firstContact).map((x) => x.url)]
    .filter(Boolean)
    .slice(0, Math.max(0, MAX_PAGES_TO_VISIT - 1));

  // Always probe common contact paths even when keyword pages were found — they may not overlap.
  // This ensures /contact is always checked regardless of discovery order or scoring.
  if (origin) {
    for (const p of COMMON_CONTACT_PATHS) {
      const candidate = origin + p;
      if (!seen.has(candidate) && !discovered.includes(candidate)) {
        discovered.push(candidate);
        seen.add(candidate);
        if (discovered.length >= MAX_PAGES_TO_VISIT - 1) break;
      }
    }
  }
  // Trim to limit after injecting probes
  discovered = discovered.slice(0, Math.max(0, MAX_PAGES_TO_VISIT - 1));
  return discovered;
}

// ─────────────────────────────────────────────
// Full CTA scan — clickable links + plain-text contacts
// ─────────────────────────────────────────────
async function scanCTAsOnPage(page) {
  const clickable = await safeEvaluate(page, () => ({
    phones: Array.from(document.querySelectorAll("a[href^='tel:' i]"))
      .map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim() }))
      .filter((x) => x.href),
    emails: Array.from(document.querySelectorAll("a[href^='mailto:' i]"))
      .map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim() }))
      .filter((x) => x.href),
  }));

  /* NON-CLICKABLE CONTACT DETECTION — removed, too many false positives
  const plainText = await safeEvaluate(page, () => {
    function normPhone(d) {
      if (d.startsWith('+44')) return '0' + d.slice(3);
      if (d.startsWith('0044')) return '0' + d.slice(4);
      return d;
    }
    const linkedPhones = new Set(
      Array.from(document.querySelectorAll("a[href^='tel:' i]"))
        .map(a => normPhone((a.getAttribute("href") || "").replace(/[^\d\+]/g, ""))).filter(Boolean)
    );
    const linkedEmails = new Set(
      Array.from(document.querySelectorAll("a[href^='mailto:' i]"))
        .map(a => (a.getAttribute("href") || "").replace(/mailto:/i, "").trim().toLowerCase()).filter(Boolean)
    );

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName?.toLowerCase();
        if (["script","style","noscript","head","template"].includes(tag)) return NodeFilter.FILTER_REJECT;
        const el = node.parentElement;
        if (el) {
          try {
            if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true }))
              return NodeFilter.FILTER_REJECT;
          } catch {}
          if (el.offsetWidth === 0 && el.offsetHeight === 0) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const phonePattern = /(?<![.\d])(\+?0[\d\s\-\(\)\.]{7,16}[\d]|\+[1-9]\d[\d\s\-\(\)\.]{6,14}[\d])(?![.\d])/g;
    const emailPattern = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
    const placeholderDomains = new Set(["example.com","example.org","example.net","example.co.uk","test.com","placeholder.com","domain.com","yourdomain.com","email.com"]);
    const foundPhones = [], foundEmails = [];

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || "";
      if (node.parentElement?.closest("a[href]")) continue;

      for (const m of text.matchAll(phonePattern)) {
        const pureDigits = m[1].replace(/[^0-9]/g, "");
        if (pureDigits.length < 10 || pureDigits.length > 13) continue;
        if (/^\d{1,3}(?:[.\s]\d{1,3}){3}$/.test(m[1].trim())) continue;
        const beforeInNode  = text.slice(Math.max(0, m.index - 80), m.index);
        const parentCtx     = (node.parentElement?.innerText || "").slice(0, 300);
        const labelInBefore = /(?:call|tel(?:ephone)?|phone|mobile|mob|fax|ring|speak\s+to|contact(?:\s+us)?(?:\s+on|\s+at)?)\s*[:|-]?\s*$/i.test(beforeInNode.trim());
        const labelInParent = /(?:^|\b)(?:call|tel(?:ephone)?|phone|mobile|mob|fax)\b/i.test(parentCtx);
        if (!labelInBefore && !labelInParent) continue;
        const digits = normPhone(m[1].replace(/[^\d\+]/g, ""));
        if (!linkedPhones.has(digits))
          foundPhones.push({ raw: m[1].trim(), digits });
      }

      for (const m of text.matchAll(emailPattern)) {
        const norm   = m[1].trim().toLowerCase();
        const domain = norm.split("@")[1] || "";
        if (placeholderDomains.has(domain)) continue;
        if (!linkedEmails.has(norm)) foundEmails.push({ raw: m[1].trim(), norm });
      }
    }

    const seenPh = new Set(), seenEm = new Set();
    return {
      phones: foundPhones.filter(p => { if (seenPh.has(p.digits)) return false; seenPh.add(p.digits); return true; }),
      emails: foundEmails.filter(e => { if (seenEm.has(e.norm))   return false; seenEm.add(e.norm);   return true; })
    };
  });
  */

  return {
    phones: clickable?.phones || [],
    emails: clickable?.emails || [],
  };
}

function normaliseTelHref(href) {
  return href ? href.replace(/\s+/g, "").toLowerCase() : null;
}
function normaliseMailtoHref(href) {
  return href ? href.trim().toLowerCase() : null;
}

// ─────────────────────────────────────────────
// Low-level: click one element, poll for GA4 event
// ─────────────────────────────────────────────
async function clickAndPollForEvent(
  page,
  beacons,
  selector,
  fromIdx,
  ctaSearchValue,
  type,
  pollMs = POST_ACTION_POLL_MS,
) {
  await page
    .locator(selector)
    .first()
    .click({ timeout: 2000, noWaitAfter: true })
    .catch(async () => {
      await safeEvaluate(
        page,
        (sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        },
        selector,
      );
    });

  const start = Date.now();
  while (Date.now() - start < pollMs) {
    const newGa4 = beacons.slice(fromIdx).filter((b) => b.type === "GA4");

    const tier1 = newGa4.filter((b) => {
      const en = (b.event_name || "").toLowerCase();
      if (GENERIC_EVENTS.has(en)) return false;
      const hasPayload = ctaSearchValue && (b.payload_dump || "").includes(ctaSearchValue);
      const strongName =
        (type === "phone" && /phone|call|tel|click_call|call_click/.test(en)) ||
        (type === "email" && /email|mail|click_email|email_click/.test(en));
      return hasPayload || strongName;
    });
    if (tier1.length)
      return {
        fired: true,
        match_tier: "exact",
        ga4_events: uniq(tier1.map((b) => b.event_name)),
        evidence_urls: tier1.slice(0, 3).map((b) => b.url),
        generic_events_seen: [],
      };

    const tier2 = newGa4.filter((b) => {
      const en = (b.event_name || "").toLowerCase();
      return !GENERIC_EVENTS.has(en) && en !== "";
    });
    if (tier2.length)
      return {
        fired: true,
        match_tier: "inferred",
        ga4_events: uniq(tier2.map((b) => b.event_name)),
        evidence_urls: tier2.slice(0, 3).map((b) => b.url),
        generic_events_seen: [],
      };

    await safeWait(100);
  }

  const allNewGa4 = beacons.slice(fromIdx).filter((b) => b.type === "GA4");
  return {
    fired: false,
    ga4_events: [],
    evidence_urls: [],
    generic_events_seen: uniq(allNewGa4.map((b) => b.event_name)),
  };
}

// ─────────────────────────────────────────────
// testLinkCTA — primary click + duplicate-fire test
// ─────────────────────────────────────────────
async function testLinkCTA(page, beacons, rawHref, type, pageUrl) {
  const hrefEsc = escapeAttrValue(rawHref);
  const selector = `a[href="${hrefEsc}" i]`;
  const ctaSearchValue =
    type === "phone"
      ? rawHref.replace(/[^\d\+]/g, "")
      : rawHref
          .replace(/mailto:/i, "")
          .toLowerCase()
          .trim();

  try {
    const loc = page.locator(selector).first();
    if (!(await loc.count())) {
      return { status: "NOT_TESTED", reason: "CTA element not found in DOM", page_url: pageUrl };
    }

    await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => null);
    await safeWait(300);

    // ── Step 1: Primary click ──
    const click1 = await clickAndPollForEvent(
      page,
      beacons,
      selector,
      beacons.length,
      ctaSearchValue,
      type,
      POST_ACTION_POLL_MS,
    );

    if (!click1.fired) {
      return {
        status: "FAIL",
        reason: click1.generic_events_seen.length
          ? `GA4 fired but only generic events (${click1.generic_events_seen.join(", ")}) — no conversion event`
          : "No GA4 beacon fired after click",
        ga4_events: [],
        generic_events_seen: click1.generic_events_seen,
        page_url: pageUrl,
        duplicate_fire_test: null,
      };
    }

    // ── Step 2: Duplicate-fire test ──
    await safeWait(DUPLICATE_TEST_SETTLE_MS);
    const beforeClick2 = beacons.length;

    await safeEvaluate(
      page,
      (sel) => {
        const el = document.querySelector(sel);
        if (el) el.click();
      },
      selector,
    );

    const click2 = await clickAndPollForEvent(
      page,
      beacons,
      selector,
      beforeClick2,
      ctaSearchValue,
      type,
      SECOND_CLICK_POLL_MS,
    );

    const duplicate_fire_test = click2.fired
      ? {
          result: "DUPLICATE_FIRED",
          summary:
            `A second GA4 event fired after clicking the same ${type === "phone" ? "tel:" : "mailto:"} link again on the same page. ` +
            `The GTM tag is set to "Once per event" or "Unlimited" — it will fire on every click and double-count conversions.`,
          events_on_second_click: click2.ga4_events,
          fix:
            `In GTM, open the GA4 Event tag for ${type === "phone" ? "click_call / click_phone" : "click_email"}, ` +
            `go to Advanced Settings → Tag firing options, change from "Once per event" to "Once per page". ` +
            `This ensures the event fires only once per page load no matter how many times the link is clicked.`,
        }
      : {
          result: "CORRECTLY_SUPPRESSED",
          summary: `No second GA4 event fired after re-clicking on the same page — tag is correctly set to "Once per page".`,
        };

    return {
      status: "PASS",
      match_tier: click1.match_tier,
      ...(click1.match_tier === "inferred"
        ? { match_note: "Non-generic GA4 event fired — CTA value may be in custom dimensions" }
        : {}),
      ga4_events: click1.ga4_events,
      evidence_urls: click1.evidence_urls,
      page_url: pageUrl,
      duplicate_fire_test,
    };
  } catch (e) {
    return { status: "NOT_TESTED", reason: e.message, page_url: pageUrl, duplicate_fire_test: null };
  }
}

// ─────────────────────────────────────────────
// Per-page CTA orchestrator
// ─────────────────────────────────────────────
async function testCTAsOnPage(
  page,
  beacons,
  pageUrl,
  uniquePhones,
  uniqueEmails,
  phoneItems,
  emailItems,
  phoneDone,
  emailDone,
) {
  const ctas = await scanCTAsOnPage(page);
  const currentUrl = page.url();

  if (!phoneDone.value) {
    for (const ctaObj of ctas.phones || []) {
      const rawTel = ctaObj.href;
      const norm = normaliseTelHref(rawTel);
      if (!norm) continue;
      uniquePhones.add(norm);

      const result = await testLinkCTA(page, beacons, rawTel, "phone", currentUrl);
      result.href = rawTel;
      result.display_text = ctaObj.text || null;
      phoneItems.push(result);
      phoneDone.value = true;
      break;
    }
  }

  for (const ctaObj of ctas.phones || []) {
    const norm = normaliseTelHref(ctaObj.href);
    if (norm) uniquePhones.add(norm);
  }

  if (!emailDone.value) {
    for (const ctaObj of ctas.emails || []) {
      const rawMail = ctaObj.href;
      const norm = normaliseMailtoHref(rawMail);
      if (!norm) continue;
      uniqueEmails.add(norm);

      const result = await testLinkCTA(page, beacons, rawMail, "email", currentUrl);
      result.href = rawMail;
      result.display_text = ctaObj.text || null;
      emailItems.push(result);
      emailDone.value = true;
      break;
    }
  }

  for (const ctaObj of ctas.emails || []) {
    const norm = normaliseMailtoHref(ctaObj.href);
    if (norm) uniqueEmails.add(norm);
  }
}

// ─────────────────────────────────────────────
// Form detection & testing
// ─────────────────────────────────────────────
async function discoverAllFormsOnPage(page, pageUrl) {
  // safeEvaluate returns null when the page blocks CDP injection (WAF/bot-protection).
  // Guard with ?? [] so spreading never throws "mainForms is not iterable".
  const mainForms = (await scanFrameForForms(page)) ?? [];
  let frameForms = [];
  try {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const ff = (await scanFrameForForms(frame)) ?? [];
      if (ff.length) {
        ff.forEach((f) => {
          f.isFrame = true;
        });
        frameForms.push(...ff);
      }
    }
  } catch {}
  const leadForms = [...mainForms, ...frameForms].filter((f) => f.score >= 1);
  leadForms.sort((a, b) => b.score - a.score);
  const firstParty = [],
    thirdParty = [];
  for (const f of leadForms) {
    let isThirdParty = false;
    if (f.action) {
      try {
        const actionUrl = new URL(f.action, pageUrl);
        if (
          actionUrl.origin !== new URL(pageUrl).origin &&
          THIRD_PARTY_HINTS.some((h) => actionUrl.href.toLowerCase().includes(h))
        )
          isThirdParty = true;
      } catch {}
    }
    (isThirdParty ? thirdParty : firstParty).push(f);
  }
  return { firstPartyForms: firstParty, thirdPartyForms: thirdParty, totalLeadForms: leadForms.length };
}

async function scanFrameForForms(frameOrPage) {
  return await safeEvaluate(frameOrPage, () => {
    const out = [];
    function textOf(el) {
      return (el?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400);
    }
    function attr(el, name) {
      return el?.getAttribute?.(name) || "";
    }
    function has(el, sel) {
      try {
        return !!el.querySelector(sel);
      } catch {
        return false;
      }
    }
    for (let i = 0; i < document.querySelectorAll("form").length; i++) {
      const f = document.querySelectorAll("form")[i];
      const action = attr(f, "action");
      const inputs = f.querySelectorAll("input,textarea,select");
      const hasTextarea = has(f, "textarea");
      const hasEmail =
        has(f, "input[type='email']") ||
        Array.from(inputs).some((x) => /email/i.test(attr(x, "name") + attr(x, "placeholder") + attr(x, "id")));
      const hasPhone = Array.from(inputs).some((x) =>
        /phone|tel|mobile/i.test(attr(x, "name") + attr(x, "placeholder") + attr(x, "id") + attr(x, "type")),
      );
      const hasName = Array.from(inputs).some((x) =>
        /^(name|full.?name|first.?name)/i.test(attr(x, "name") + attr(x, "placeholder") + attr(x, "id")),
      );
      const submitBtn =
        f.querySelector("button[type='submit'],input[type='submit']") ||
        Array.from(f.querySelectorAll("button")).find((b) =>
          /send|submit|enquir|quote|request|book|contact|get.?in.?touch/i.test(textOf(b)),
        );
      const submitText = submitBtn ? textOf(submitBtn) : "";
      const hay = `${attr(f, "id")} ${attr(f, "class")} ${attr(f, "name")} ${submitText} ${textOf(f)}`.toLowerCase();
      const isSearch = /search|login|sign.?in|subscribe|newsletter/.test(hay) && !hasTextarea && inputs.length < 3;
      let score = 0;
      if (isSearch) {
        score -= 999;
      } else {
        if (hasTextarea) score += 3;
        if (hasEmail) score += 2;
        if (hasPhone) score += 2;
        if (hasName && inputs.length >= 2) score += 1;
        if (/send|submit|enquir|contact|book/i.test(submitText)) score += 2;
        if (/contact|enquir|quote|touch/i.test(hay)) score += 1;
      }
      out.push({ index: i, action, hasEmail, hasPhone, hasTextarea, submitText, score });
    }
    return out;
  });
}

async function detectFieldType(el) {
  try {
    const tag = await el.evaluate((e) => e.tagName.toLowerCase()).catch(() => "");
    const type = (await el.getAttribute("type").catch(() => "")) || "";
    const name = (await el.getAttribute("name").catch(() => "")) || "";
    const ph = (await el.getAttribute("placeholder").catch(() => "")) || "";
    const id = (await el.getAttribute("id").catch(() => "")) || "";
    const c = `${type} ${name} ${ph} ${id}`.toLowerCase();
    if (tag === "select") return { type: "select" };
    if (type === "checkbox") return { type: "checkbox" };
    if (type === "radio") return { type: "radio" };
    if (type === "hidden") return { type: "hidden" };
    if (type === "file") return { type: "file" };
    if (type === "date") return { type: "date" };
    if (type === "time") return { type: "time" };
    if (type === "datetime-local") return { type: "datetime-local" };
    if (type === "month") return { type: "month" };
    if (type === "week") return { type: "week" };
    if (type === "number" || type === "range") return { type: "number" };
    if (type === "url") return { type: "url" };
    if (type === "color") return { type: "color" };
    if (/email/.test(c)) return { type: "email" };
    if (/phone|tel|mobile/.test(c)) return { type: "phone" };
    if (/message|enquiry|comment|details|how.?can/.test(c) || tag === "textarea") return { type: "message" };
    if (/first.?name|forename/.test(c)) return { type: "firstName" };
    if (/last.?name|surname/.test(c)) return { type: "lastName" };
    if (/company|business|organisation/.test(c)) return { type: "company" };
    if (/postcode|post.?code|zip/.test(c)) return { type: "postcode" };
    if (/subject|topic/.test(c)) return { type: "subject" };
    return { type: "text" };
  } catch {
    return { type: "unknown" };
  }
}

async function fillFormFieldSmart(el, fieldInfo) {
  try {
    const { type } = fieldInfo;
    if (type === "hidden") return;
    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) return;
    if (type === "select") {
      await el
        .evaluate((sel) => {
          if (sel.options.length > 1) {
            sel.selectedIndex = 1;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        })
        .catch(() => null);
      return;
    }
    if (type === "checkbox" || type === "radio") {
      await el.check({ timeout: 500, force: true }).catch(() => null);
      return;
    }
    // Native date/time inputs — fill with correctly-formatted values
    if (type === "date") {
      await el.fill(TEST_VALUES.date, { timeout: 500 }).catch(() => null);
      return;
    }
    if (type === "time") {
      await el.fill("10:00", { timeout: 500 }).catch(() => null);
      return;
    }
    if (type === "datetime-local") {
      await el.fill(`${TEST_VALUES.date}T10:00`, { timeout: 500 }).catch(() => null);
      return;
    }
    if (type === "month") {
      await el.fill("2026-12", { timeout: 500 }).catch(() => null);
      return;
    }
    if (type === "week") {
      await el.fill("2026-W52", { timeout: 500 }).catch(() => null);
      return;
    }
    if (type === "number") {
      await el.fill(TEST_VALUES.number, { timeout: 500 }).catch(() => null);
      return;
    }
    if (type === "url") {
      await el.fill("https://example.com", { timeout: 500 }).catch(() => null);
      return;
    }
    // Skip inputs the bot genuinely cannot fill
    if (type === "file" || type === "color" || type === "range") return;

    const valueMap = {
      email: TEST_VALUES.email,
      phone: TEST_VALUES.phone,
      message: TEST_VALUES.message,
      firstName: TEST_VALUES.firstName,
      lastName: TEST_VALUES.lastName,
      company: TEST_VALUES.company,
      postcode: TEST_VALUES.postcode,
      subject: TEST_VALUES.subject,
    };
    await el.fill(valueMap[type] || TEST_VALUES.fullName, { timeout: 500 }).catch(() => null);
  } catch {}
}

async function hasVisibleValidationErrors(page, formIndex) {
  return await safeEvaluate(
    page,
    (idx) => {
      const form = document.querySelectorAll("form")[idx];
      if (!form) return false;
      if ([...form.querySelectorAll(":invalid")].some((el) => el.offsetParent !== null)) return true;
      return [
        '[role="alert"]',
        ".error",
        ".invalid-feedback",
        ".wpcf7-not-valid-tip",
        ".validation-error",
        ".hs-error-msgs",
        ".field-error",
        ".form-error",
        "[data-error]",
        ".help-block",
        ".alert-danger",
      ].some((sel) =>
        [...form.querySelectorAll(sel)].some((el) => el.offsetParent !== null && el.innerText.trim().length > 0),
      );
    },
    formIndex,
  );
}

async function testFirstPartyForm(page, beacons, pageUrl, formMeta) {
  try {
    if (formMeta.isFrame) return { status: "NOT_TESTED", reason: "Form is inside a cross-origin iframe" };
    const formLocator = page.locator("form").nth(formMeta.index);
    if (!(await formLocator.count())) return { status: "NOT_TESTED", reason: "Form not found in DOM" };
    const botDetected = await safeEvaluate(page, () => {
      // CAPTCHA widgets
      if (
        document.querySelector(
          "iframe[src*='recaptcha'],iframe[src*='turnstile'],iframe[src*='hcaptcha']," +
            ".g-recaptcha,.h-captcha,[data-sitekey],[data-captcha]," +
            "div[class*='recaptcha'],div[class*='captcha'],div[id*='captcha']," +
            "script[src*='recaptcha'],script[src*='hcaptcha'],script[src*='turnstile']",
        )
      )
        return "CAPTCHA";
      // Cloudflare challenge / interstitial page
      if (
        document.querySelector("#challenge-form,#cf-challenge-running,#cf-error-details") ||
        /checking your browser|enable javascript and cookies|cloudflare ray id/i.test(document.body?.innerText || "")
      )
        return "Cloudflare";
      // Generic "bot detected" / access denied pages
      if (
        /access denied|403 forbidden|you have been blocked|bot detected|automated access/i.test(
          document.title + " " + (document.body?.innerText || "").slice(0, 500),
        )
      )
        return "AccessDenied";
      return null;
    });
    if (botDetected) return { status: "FAIL", reason: `Bot Protection (${botDetected})` };

    // Check for multi-step form (Next/Continue button or step-progress widgets)
    const multiStepBtn = await safeEvaluate(
      page,
      (idx) => {
        const form = document.querySelectorAll("form")[idx];
        if (!form) return null;
        const visible = [...form.querySelectorAll("button,input[type='submit'],input[type='button']")].filter(
          (b) => b.offsetParent !== null,
        );
        const primaryBtn = visible.find((b) => b.type === "submit") || visible[0];
        const btnText = (primaryBtn?.textContent || primaryBtn?.value || "").trim();
        const isNextStep = /^(next|continue|proceed|go to step|step\s*\d)/i.test(btnText);
        const hasStepper = !!form.querySelector(
          '[class*="step-"],[class*="wizard"],[class*="multi-step"],[data-step],[aria-current="step"],[class*="progress-step"]',
        );
        return isNextStep || hasStepper ? btnText || "Next" : null;
      },
      formMeta.index,
    );
    if (multiStepBtn !== null && multiStepBtn !== undefined) {
      return {
        status: "NOT_TESTED",
        reason: `Multi-step form — button says "${multiStepBtn}"; automated testing cannot navigate all steps`,
      };
    }

    // Check for inputs the bot cannot fill before attempting
    const unfillableFields = await safeEvaluate(
      page,
      (idx) => {
        const form = document.querySelectorAll("form")[idx];
        if (!form) return [];
        const issues = [];
        const visible = [...form.querySelectorAll("input,select,textarea")].filter((el) => el.offsetParent !== null);
        if (visible.some((el) => el.type === "file")) issues.push("file upload");
        if (
          form.querySelector(
            "[class*='datepick'],[class*='flatpickr'],[class*='pikaday'],[class*='daterangepick'],[class*='react-datepick'],[class*='vue-datepick'],[class*='air-datepick']",
          )
        )
          issues.push("custom date picker widget");
        return issues;
      },
      formMeta.index,
    );
    if (unfillableFields.length > 0) {
      return {
        status: "NOT_TESTED",
        reason: `Form contains fields the bot cannot fill: ${unfillableFields.join(", ")}`,
      };
    }

    const beforeBeaconIdx = beacons.length;
    const beforeUrl = page.url();
    const fields = formLocator.locator("input:visible,textarea:visible,select:visible");
    const fieldCount = await fields.count();
    for (let i = 0; i < fieldCount; i++) {
      await fillFormFieldSmart(fields.nth(i), await detectFieldType(fields.nth(i)));
    }
    await safeWait(300);

    const btnLocator = formLocator
      .locator(
        "button[type='submit'],input[type='submit'],button:has-text('Send'),button:has-text('Submit'),button:has-text('Enquire'),button:has-text('Book'),button:has-text('Request')",
      )
      .first();
    if (!((await btnLocator.count()) > 0 && (await btnLocator.isVisible().catch(() => false)))) {
      return { status: "NOT_TESTED", reason: "No visible submit button found" };
    }

    let submitted = await btnLocator
      .click({ timeout: 2000, noWaitAfter: true })
      .then(() => true)
      .catch(() => false);
    if (!submitted) {
      submitted = await safeEvaluate(
        page,
        (idx) => {
          const f = document.querySelectorAll("form")[idx];
          const btn = f?.querySelector("button[type='submit'],input[type='submit']");
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        },
        formMeta.index,
      ).then((r) => !!r);
    }
    if (!submitted) {
      await safeEvaluate(
        page,
        (idx) => {
          const f = document.querySelectorAll("form")[idx];
          if (f) {
            try {
              f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
              f.submit();
            } catch {}
          }
        },
        formMeta.index,
      );
    }

    await safeWait(800);
    if (await hasVisibleValidationErrors(page, formMeta.index))
      return { status: "NOT_TESTED", reason: "Form validation blocked submission" };

    let newGa4 = [],
      meaningfulEvents = [];
    const submitStart = Date.now();
    while (Date.now() - submitStart < FORM_SUBMIT_WAIT_MS) {
      await safeWait(400);
      const afterUrl = page.url();
      const urlChanged = afterUrl !== beforeUrl;
      newGa4 = beacons.slice(beforeBeaconIdx).filter((b) => b.type === "GA4");
      meaningfulEvents = newGa4.filter((b) => {
        const en = (b.event_name || "").toLowerCase();
        if (GENERIC_EVENTS.has(en)) return false;
        if (en === "page_view" && urlChanged && /thank|success|confirm|sent/i.test(afterUrl)) return true;
        return true;
      });
      if (meaningfulEvents.length > 0) break;
    }
    if (meaningfulEvents.length > 0) {
      return {
        status: "PASS",
        ga4_events: uniq(meaningfulEvents.map((b) => b.event_name)),
        evidence_urls: meaningfulEvents.slice(0, 3).map((b) => b.url),
      };
    }

    const successVisible = await safeEvaluate(page, () =>
      /thank|thanks|sent|success|confirm|received|we.ll be in touch|we will be in touch|message received/i.test(
        document.body.innerText,
      ),
    );
    if (successVisible || /thank|success|confirm|sent/i.test(page.url())) {
      return {
        status: "FAIL",
        reason: "Form submitted (success detected) but no GA4 event fired",
        ga4_events_seen: uniq(newGa4.map((b) => b.event_name)),
      };
    }
    return {
      status: "NOT_TESTED",
      reason: "Submission unconfirmed — no success message, URL change, or GA4 event",
      ga4_events_seen: uniq(newGa4.map((b) => b.event_name)),
    };
  } catch (e) {
    return { status: "NOT_TESTED", reason: `Unexpected error: ${e.message}` };
  }
}

async function testAllFormsOnPage(page, beacons, pageUrl) {
  const discovery = await discoverAllFormsOnPage(page, pageUrl);
  const result = {
    page_url: pageUrl,
    total_lead_forms_found: discovery.totalLeadForms,
    first_party_forms: [],
    third_party_forms: [],
  };
  for (const formMeta of discovery.firstPartyForms) {
    const res = await testFirstPartyForm(page, beacons, pageUrl, formMeta);
    result.first_party_forms.push(res);
    if (res.status === "PASS") break;
  }
  return result;
}

// ─────────────────────────────────────────────
// GTM container analysis
// ─────────────────────────────────────────────

// Map of GTM tag function names to human-readable labels
const GTM_TAG_TYPES = {
  __googtag: "Google Tag (gtag)",
  __gaawe: "GA4 Event",
  __sp: "GA4 Configuration",
  __ua: "Universal Analytics",
  __html: "Custom HTML",
  __gclidw: "Google Ads Conversion Linking",
  __awct: "Google Ads Conversion Tracking",
  __flc: "Floodlight Counter",
  __fls: "Floodlight Sales",
  __bzi: "Bizible Insights",
  __fb: "Meta Pixel",
  __linkedin_insight: "LinkedIn Insight Tag",
  __msft_uet: "Microsoft/Bing UET",
};

/**
 * Download and analyse a GTM container's compiled JS.
 * Does NOT require API credentials — the container JS is publicly accessible.
 *
 * @param {string} gtmId  — e.g. "GTM-ABCD1234"
 * @returns {{ version: string|null, tags: Array, eventNames: string[], rawTagCount: number }|null}
 */
async function downloadGtmContainerConfig(gtmId) {
  if (!gtmId || !isValidGtmId(gtmId)) return null;
  try {
    const url = `https://www.googletagmanager.com/gtm.js?id=${gtmId}&l=dataLayer`;
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" },
      responseType: "text",
    });
    const js = resp.data || "";

    // ── Tag types ──
    const tags = [];
    for (const [fn, label] of Object.entries(GTM_TAG_TYPES)) {
      // Count occurrences of this tag function in the compiled container
      const matches = js.match(new RegExp(`"function":"${fn.replace("__", "__")}"`, "g")) || [];
      if (matches.length > 0) tags.push({ function: fn, label, count: matches.length });
    }

    // ── Custom event names from GA4 Event tags ──
    const eventNames = [...js.matchAll(/"vtp_eventName":"([^"]+)"/g)].map((m) => m[1]);

    // ── Measurement IDs referenced in the container ──
    const measurementIds = [...new Set([...js.matchAll(/G-[A-Z0-9]{7,}/g)].map((m) => m[0]).filter(isValidGa4Id))];

    // ── Container version (rough extract) ──
    const verMatch = js.match(/"version":"(\d+)"/);
    const version = verMatch ? verMatch[1] : null;

    return {
      version,
      rawTagCount: tags.reduce((a, t) => a + t.count, 0),
      tags,
      eventNames: [...new Set(eventNames)],
      measurementIds,
    };
  } catch (e) {
    logDebug(`GTM container download failed for ${gtmId}: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function trackingHealthCheckSiteInternal(url, expectedGtmId = null) {
  const targetUrl = normaliseUrl(url);

  // ── Working state (not returned) ──
  const beacons = [];
  const interceptedForms = [];
  const uniquePhones = new Set();
  const uniqueEmails = new Set();
  const visitedUrls = new Set();
  const phoneItems = [];
  const emailItems = [];
  const phoneDone = { value: false };
  const emailDone = { value: false };
  const ga4ValidationErrors = []; // populated by /debug/mp/collect response listener

  // ── Return payload — maps directly to DB schema ──
  const results = {
    website_url: targetUrl,
    ran_at: nowIso(),
    grade: null,
    health_status: null,
    health_reasons: null,

    detected_gtm_ids: [],
    detected_ga4_ids: [],
    gtm_id_expected: expectedGtmId || null,
    gtm_id_match: null,

    phone_found: 0,
    phone_tested: 0,
    phone_passed: 0,
    phone_failed: 0,

    email_found: 0,
    email_tested: 0,
    email_passed: 0,
    email_failed: 0,

    forms_found: 0,
    forms_passed: 0,
    forms_failed: 0,

    cta_details: {
      phones: { items: [] },
      emails: { items: [] },
    },

    // form_details: forms.pages array
    form_details: [],

    // fix: joined summary of all actionable fixes from failure_detail
    fix: null,

    // failure_detail retained in full for callers that need structured issue data
    failure_detail: [],

    ga4_events_captured: [],
    // Rich GA4 beacon payloads — event name + all parameters seen across the session
    ga4_events_detail: [],
    // dataLayer push sequence captured by the pre-load spy
    datalayer_events: [],
    // GTM container tag analysis (populated after GTM ID confirmed)
    container_analysis: null,
    // GA4 debug-mode validation errors returned by Google's servers
    ga4_validation_errors: [],
    duration_ms: null,
  };

  let context = null,
    page = null;
  const _checkStart = Date.now();

  try {
    logInfo(`🔍 [${SCRIPT_VERSION}] Starting check`, { url: targetUrl });
    const browser = await getBrowser();

    const ctxOpts = {
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      locale: "en-GB",
      timezoneId: "Europe/London",
    };
    try {
      context = await browser.newContext(ctxOpts);
    } catch (ctxErr) {
      // Browser process died between getBrowser() and here — relaunch once
      if (/browser.*closed|Target.*closed/i.test(ctxErr.message)) {
        globalBrowser = null;
        browserUses = 0;
        const freshBrowser = await getBrowser();
        context = await freshBrowser.newContext(ctxOpts);
      } else {
        throw ctxErr;
      }
    }
    openContexts.set(context, { createdAt: Date.now(), url: targetUrl });
    page = await context.newPage();

    // ── Fingerprint hardening (supplements playwright-extra stealth plugin) ──
    // The stealth plugin handles navigator.webdriver, window.chrome, plugins, and
    // permissions. These patches cover the remaining signals that headless Chrome
    // on a Linux server leaks and that Cloudflare's fingerprinting checks.
    await page.addInitScript(() => {
      // Remove Playwright's internal automation globals that can leak through
      try {
        delete window.__playwright;
      } catch {}
      try {
        delete window.__pw_manual;
      } catch {}
      try {
        delete window.playwrightBinding;
      } catch {}

      // hardwareConcurrency — headless on low-CPU VMs often returns 0 or 1
      try {
        if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 2) {
          Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
        }
      } catch {}

      // deviceMemory — often undefined in headless, real Chrome reports 8
      try {
        if (!navigator.deviceMemory) {
          Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
        }
      } catch {}

      // screen dimensions — viewport is 1920×1080 but screen properties can differ
      try {
        Object.defineProperty(screen, "availWidth", { get: () => 1920 });
        Object.defineProperty(screen, "availHeight", { get: () => 1040 }); // taskbar offset
        Object.defineProperty(screen, "width", { get: () => 1920 });
        Object.defineProperty(screen, "height", { get: () => 1080 });
        Object.defineProperty(screen, "colorDepth", { get: () => 24 });
        Object.defineProperty(screen, "pixelDepth", { get: () => 24 });
      } catch {}

      // window.outerWidth / outerHeight — should match viewport in a real browser
      try {
        Object.defineProperty(window, "outerWidth", { get: () => 1920 });
        Object.defineProperty(window, "outerHeight", { get: () => 1080 });
      } catch {}

      // Notification.permission — headless returns "default", but the Notification
      // constructor itself may throw. Normalise to match real Chrome behaviour.
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          Object.defineProperty(Notification, "permission", { get: () => "default" });
        }
      } catch {}

      // MediaDevices.enumerateDevices — returns empty list in headless; real Chrome
      // returns at least one audio/video device even without physical hardware.
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const _orig = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
          navigator.mediaDevices.enumerateDevices = () =>
            _orig().then((devices) =>
              devices.length > 0
                ? devices
                : [
                    { deviceId: "default", groupId: "default", kind: "audioinput", label: "" },
                    { deviceId: "default", groupId: "default", kind: "audiooutput", label: "" },
                  ],
            );
        }
      } catch {}
    });

    // ── Feature 1: dataLayer spy ──
    // Injected before ANY page script runs. Intercepts every dataLayer.push() call
    // from the very first moment — catches gtm.start and all custom events even if
    // they fire before our post-load safeEvaluate can read window.dataLayer.
    await page.addInitScript(() => {
      window.__dlSpy = [];
      const _nativePush = Array.prototype.push;
      function spyPush(...args) {
        for (const a of args) {
          try {
            window.__dlSpy.push(JSON.parse(JSON.stringify(a)));
          } catch {}
        }
        return _nativePush.apply(this, args);
      }
      function attachSpy(arr) {
        if (arr && !arr.__spied) {
          arr.push = spyPush;
          arr.__spied = true;
        }
        return arr;
      }
      // Spy on any existing dataLayer
      let _backing = attachSpy(window.dataLayer || []);
      try {
        Object.defineProperty(window, "dataLayer", {
          configurable: true,
          enumerable: true,
          get() {
            return _backing;
          },
          // GTM's first action is: window.dataLayer = window.dataLayer || []
          // This setter catches that and re-attaches the spy on the new array.
          set(v) {
            _backing = attachSpy(v) || v;
          },
        });
      } catch {}
      // Initialise if not already set
      if (!window.dataLayer) window.dataLayer = [];
    });

    // ── Feature 4: GA4 debug mode injection ──
    // Causes GA4 to route events to /debug/mp/collect which returns per-event
    // validation JSON from Google's servers (invalid params, unknown events, etc.)
    await page.addInitScript(() => {
      window.__ga4DebugErrors = [];
      // Override gtag once it's defined to inject debug_mode on every config call
      const _origGtag = window.gtag;
      Object.defineProperty(window, "gtag", {
        configurable: true,
        get() {
          return this._gtag;
        },
        set(fn) {
          this._gtag = function (...args) {
            // Inject debug_mode into 'config' calls so GA4 uses /debug/mp/collect
            if (args[0] === "config" && typeof args[2] === "undefined") {
              args[2] = { debug_mode: true };
            } else if (args[0] === "config" && typeof args[2] === "object") {
              args[2] = { ...args[2], debug_mode: true };
            }
            return fn.apply(this, args);
          };
        },
      });
      if (typeof _origGtag === "function") window.gtag = _origGtag;
    });

    await context.route("**/*", (route) => {
      const req = route.request();
      const type = req.resourceType();
      const reqUrl = req.url();
      const method = req.method();
      if (["image", "media", "font"].includes(type)) return route.abort();
      try {
        if (isSocialDomain(reqUrl)) return route.abort();
      } catch {}
      const lower = reqUrl.toLowerCase();
      const isAnalytics =
        lower.includes("google-analytics") || lower.includes("googletagmanager") || lower.includes("/collect");
      if (method === "POST" && !isAnalytics) {
        interceptedForms.push({ url: reqUrl, data: req.postData() });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, message: "mocked" }),
        });
      }
      route.continue();
    });

    page.on("request", (req) => {
      const b = classifyAndParseBeacon(req.url(), req.postData());
      if (b) {
        beacons.push(b);
        logDebug("📡 Beacon", { type: b.type, event: b.event_name });
      }
    });
    page.on("response", async (res) => {
      try {
        const req = res.request();
        // Capture GTM script response — once the response is received GTM JS has been fetched.
        // We wait a beat after this for GTM to execute and push gtm.start into dataLayer.
        if (/googletagmanager\.com\/gtm\.js/i.test(req.url())) {
          logDebug("📡 GTM script response received — allowing 500ms for execution");
          safeWait(500)
            .then(() => {
              const already = beacons.some((b) => b.type === "GTM" && b.url === req.url());
              if (!already)
                beacons.push({
                  url: req.url(),
                  timestamp: nowIso(),
                  type: "GTM",
                  event_name: null,
                  payload_dump: req.url().toLowerCase(),
                  tid: null,
                  gtmHash: null,
                  params: null,
                });
            })
            .catch(() => null);
        }
        // ── Feature 4: GA4 debug validation response ──
        // /debug/mp/collect returns a JSON body with per-event validation messages
        // from Google's servers. Parse these and store for the results payload.
        if (/\/debug\/mp\/collect/i.test(req.url())) {
          try {
            const body = await res.text();
            const json = JSON.parse(body);
            // validationMessages is an array of { fieldPath, description, validationCode }
            const msgs = json?.validationMessages || [];
            if (msgs.length > 0) {
              const eventName = req.url().includes("en=")
                ? new URL(req.url()).searchParams.get("en")
                : msgs[0]?.fieldPath || "unknown";
              ga4ValidationErrors.push({ event: eventName, messages: msgs });
              logDebug(`⚠️  GA4 debug validation errors for "${eventName}":`, msgs);
            }
          } catch {}
        }
        if (req.method() === "POST") {
          const b = classifyAndParseBeacon(req.url(), req.postData());
          if (b && !beacons.find((x) => x.url === b.url && x.timestamp === b.timestamp)) beacons.push(b);
        }
      } catch {}
    });

    // ── Load homepage ──
    const gotoResult = await safeGoto(page, targetUrl);
    if (!gotoResult.ok) {
      logInfo(`⚠️ Homepage failed to load: ${gotoResult.error}`);
      const pageHasContent = await safeEvaluate(page, () => (document.body?.innerText || "").length > 100);
      if (!pageHasContent) {
        results.grade = "Fail";
        results.health_status = "SITE_UNAVAILABLE";
        results.health_reasons = `Site could not be reached: ${gotoResult.error}`;
        return results;
      }
    }
    visitedUrls.add(page.url());

    // Wait for full page load so JS frameworks (React/Next.js) can hydrate and mount
    // consent banners before we try to interact with them. Capped at 6s to avoid hanging
    // on image-heavy sites where resources load slowly.
    await page.waitForLoadState("load", { timeout: 6000 }).catch(() => null);
    await simulateHumanBrowsing(page);

    await handleCookieConsent(page);
    // Scroll slightly after consent so IntersectionObserver-gated or consent-delayed scripts fire
    await safeEvaluate(page, () => window.scrollBy(0, 200));

    // ── Early HTML GTM scan ──
    // Pull the rendered HTML immediately after cookie consent and scan for GTM IDs via
    // regex before any JS-based beacon/global detection runs. If expectedGtmId is
    // provided, check for that specific ID first. If null, look for any GTM ID.
    {
      const html = (await page.content().catch(() => "")).toUpperCase();
      const htmlGtmIds = [];
      for (const m of html.matchAll(/GTM-[A-Z0-9]{4,}/g)) {
        if (isRealGtmId(m[0]) && !htmlGtmIds.includes(m[0])) htmlGtmIds.push(m[0]);
      }

      if (htmlGtmIds.length > 0) {
        logInfo(`🔎 Early HTML scan found GTM IDs: ${htmlGtmIds.join(", ")}`);
        for (const id of htmlGtmIds) {
          if (!results.detected_gtm_ids.includes(id)) results.detected_gtm_ids.push(id);
        }
        if (expectedGtmId) {
          const normExpected = expectedGtmId.toUpperCase().trim();
          if (htmlGtmIds.includes(normExpected)) {
            results.gtm_id_match = true;
            logInfo(`✅ Early HTML scan: expected GTM ID ${normExpected} confirmed in page source`);
          } else {
            logInfo(`⚠️  Early HTML scan: ${normExpected} not found in HTML (found: ${htmlGtmIds.join(", ")})`);
          }
        }
      } else {
        logInfo(`⚠️  Early HTML scan: no GTM IDs found in page source`);
      }
    }

    await waitForGtmInit(page, beacons, POST_CONSENT_MAX_WAIT_MS);

    // Second consent pass: for React/SPA sites where the cookie banner mounts AFTER our
    // first attempt (banner rendered by JS that executes after DOMContentLoaded + hydration)
    if (!(await safeEvaluate(page, () => !!window.google_tag_manager)) && !beacons.some((b) => b.type === "GTM")) {
      const retryConsent = await handleCookieConsent(page);
      if (retryConsent.accepted) {
        logInfo("🍪 Second consent pass accepted — re-polling for GTM");
        await safeEvaluate(page, () => window.scrollBy(0, 200));
        await waitForGtmInit(page, beacons, POST_CONSENT_MAX_WAIT_MS / 2);
      }
    }

    // tracking is mutable — may be updated if GTM is found on an inner page
    let tracking = await detectTrackingSetup(page, beacons);
    results.detected_gtm_ids = tracking.gtm;
    results.detected_ga4_ids = [...tracking.ga4, ...tracking.unlinked_ga4];

    // ── Feature 2: GTM container analysis ──
    // Download and analyse the compiled container JS for the first detected GTM ID.
    // Done once — no need to re-run for additional pages.
    if (tracking.gtm.length > 0 && !results.container_analysis) {
      logInfo(`📦 Downloading GTM container config for ${tracking.gtm[0]}...`);
      results.container_analysis = await downloadGtmContainerConfig(tracking.gtm[0]);
      if (results.container_analysis) {
        logInfo(
          `📦 Container v${results.container_analysis.version}: ${results.container_analysis.rawTagCount} tag(s) — ${results.container_analysis.tags.map((t) => t.label).join(", ")}`,
        );
      }
    }

    if (!tracking.has_gtm && !tracking.has_any_ga4) {
      logInfo(`⚠️  No GTM/GA4 on homepage — will check inner pages before concluding NO_TRACKING`);
    }

    // ── Discover and visit pages ──
    // Discover pages regardless of tracking state — GTM may only be installed on inner pages
    const discovered = await discoverCandidatePages(page, targetUrl);
    const pagesToVisit = [targetUrl, ...discovered].slice(0, MAX_PAGES_TO_VISIT);

    for (let i = 0; i < pagesToVisit.length; i++) {
      const pageUrl = pagesToVisit[i];

      if (i > 0) {
        const navResult = await safeGoto(page, pageUrl);
        if (!navResult.ok) {
          logDebug(`⚠️ Skipping page (nav failed): ${pageUrl}`);
          continue;
        }
        const finalUrl = page.url();
        if (visitedUrls.has(finalUrl)) {
          logDebug(`Skipping duplicate: ${finalUrl}`);
          continue;
        }
        visitedUrls.add(finalUrl);

        await page.waitForLoadState("load", { timeout: 4000 }).catch(() => null);
        await handleCookieConsent(page);
        await safeEvaluate(page, () => window.scrollBy(0, 200));
        await waitForGtmInit(page, beacons, POST_CONSENT_MAX_WAIT_MS / 2);

        // Re-run tracking detection on inner pages — GTM may only be on the contact page
        if (!tracking.has_gtm && !tracking.has_any_ga4) {
          const innerTracking = await detectTrackingSetup(page, beacons);
          if (innerTracking.has_gtm || innerTracking.has_any_ga4) {
            tracking = innerTracking;
            results.detected_gtm_ids = uniq([...results.detected_gtm_ids, ...innerTracking.gtm]);
            results.detected_ga4_ids = uniq([
              ...results.detected_ga4_ids,
              ...innerTracking.ga4,
              ...innerTracking.unlinked_ga4,
            ]);
            logInfo(`⚠️  GTM/GA4 detected on inner page — updating tracking state`, { url: page.url() });
            // Run container analysis now that we have an ID
            if (innerTracking.gtm.length > 0 && !results.container_analysis) {
              results.container_analysis = await downloadGtmContainerConfig(innerTracking.gtm[0]);
            }
          }
        }
      }

      // Always test CTAs — GTM may be deferred and only confirmed by post-click network beacons
      await testCTAsOnPage(
        page,
        beacons,
        page.url(),
        uniquePhones,
        uniqueEmails,
        phoneItems,
        emailItems,
        phoneDone,
        emailDone,
      );

      const formRes = await testAllFormsOnPage(page, beacons, page.url());
      results.form_details.push(formRes);

      // Second-pass tracking detection using post-CTA beacons — catches deferred/lazy GTM
      if (!tracking.has_gtm && !tracking.has_any_ga4) {
        const postCtaTracking = await detectTrackingSetup(page, beacons);
        if (postCtaTracking.has_gtm || postCtaTracking.has_any_ga4) {
          tracking = postCtaTracking;
          results.detected_gtm_ids = uniq([...results.detected_gtm_ids, ...postCtaTracking.gtm]);
          results.detected_ga4_ids = uniq([
            ...results.detected_ga4_ids,
            ...postCtaTracking.ga4,
            ...postCtaTracking.unlinked_ga4,
          ]);
          logInfo(`⚠️  GTM/GA4 confirmed via post-CTA beacons — updating tracking state`);
        }
      }
    }

    // After visiting all pages — if still no tracking found anywhere, return NO_TRACKING
    if (!tracking.has_gtm && !tracking.has_any_ga4) {
      results.grade = "Fail";
      results.health_status = "NO_TRACKING";
      results.health_reasons = `No GTM container or GA4 detected on any of the ${pagesToVisit.length} page(s) visited (including homepage and contact pages). No GTM tag IDs in source, no GTM network requests, no google_tag_manager global object.`;
      results.failure_detail = [
        {
          category: "Google Tag Manager",
          grade_impact: "FAIL",
          summary:
            "No GTM container was found on any page. GTM must be installed before any conversion tracking can work.",
          fix: "Install a Google Tag Manager container. Add the GTM <head> snippet and <body> noscript snippet to every page, then republish.",
        },
      ];
      results.fix =
        "Install a Google Tag Manager container. Add the GTM <head> snippet and <body> noscript snippet to every page, then republish.";
      logInfo(`╔══════════════════════════════════════════════╗`);
      logInfo(`  GRADE : ❌ FAIL — NO GTM/GA4 DETECTED`);
      logInfo(`╚══════════════════════════════════════════════╝`);
      return results;
    }

    // ── GTM ID mismatch check ──
    // If the caller supplied an expected GTM container ID, verify the site has it installed.
    // Any other GTM container (or no GTM at all) is treated as a Fail.
    if (expectedGtmId) {
      const normExpected = expectedGtmId.toUpperCase().trim();
      const foundIds = results.detected_gtm_ids.map((id) => id.toUpperCase().trim());
      const matched = foundIds.includes(normExpected);
      results.gtm_id_match = matched;
      if (!matched) {
        const foundStr = foundIds.length > 0 ? foundIds.join(", ") : "none";
        results.grade = "Fail";
        results.health_status = "GTM_MISMATCH";
        results.health_reasons = `Expected GTM container ${normExpected} but found: ${foundStr}. The wrong GTM container is installed — conversion tracking will not work for this account.`;
        results.failure_detail = [
          {
            category: "Google Tag Manager",
            grade_impact: "FAIL",
            summary: `Wrong GTM container detected. Expected ${normExpected}, found ${foundStr || "none"}.`,
            fix: `Replace the installed GTM snippet with container ${normExpected}. Remove any other GTM containers to avoid conflicting tracking.`,
          },
        ];
        results.fix = `Replace the installed GTM snippet with container ${normExpected}. Remove any other GTM containers to avoid conflicting tracking.`;
        logInfo(`╔══════════════════════════════════════════════╗`);
        logInfo(`  GRADE : ❌ FAIL — GTM MISMATCH`);
        logInfo(`  Expected : ${normExpected}`);
        logInfo(`  Found    : ${foundStr}`);
        logInfo(`╚══════════════════════════════════════════════╝`);
        return results;
      }
      logInfo(`✅ GTM ID match confirmed: ${normExpected}`);
    }

    // Direct GA4 (gtag.js without GTM container): note the setup difference but continue to grading
    const directGa4Only = !tracking.has_gtm && tracking.has_any_ga4;
    if (directGa4Only) {
      logInfo(`⚠️  Direct GA4 detected (no GTM container)`);
    }

    // ── Commit counts ──
    results.cta_details.phones.items = phoneItems;
    results.cta_details.emails.items = emailItems;

    results.phone_found = uniquePhones.size;
    results.phone_tested = phoneItems.length;
    results.phone_passed = phoneItems.filter((i) => i.status === "PASS").length;
    results.phone_failed = phoneItems.filter((i) => i.status === "FAIL").length;

    results.email_found = uniqueEmails.size;
    results.email_tested = emailItems.length;
    results.email_passed = emailItems.filter((i) => i.status === "PASS").length;
    results.email_failed = emailItems.filter((i) => i.status === "FAIL").length;

    const allFormResults = results.form_details.flatMap((p) => [...p.first_party_forms, ...p.third_party_forms]);
    results.forms_found = results.form_details.reduce((acc, p) => acc + p.total_lead_forms_found, 0);
    results.forms_passed = allFormResults.filter((f) => f.status === "PASS").length;
    results.forms_failed = allFormResults.filter((f) => f.status === "FAIL").length;

    const phoneDuplicateItems = phoneItems.filter((i) => i.duplicate_fire_test?.result === "DUPLICATE_FIRED");
    const emailDuplicateItems = emailItems.filter((i) => i.duplicate_fire_test?.result === "DUPLICATE_FIRED");

    // ── Failure detail ──
    const failureDetail = [];

    // ── Phone calls ──
    if (uniquePhones.size > 0) {
      const phoneFailed = phoneItems.filter((i) => i.status === "FAIL");
      const phoneNT = phoneItems.filter((i) => i.status === "NOT_TESTED");
      const phonePassed = phoneItems.filter((i) => i.status === "PASS");

      if (phonePassed.length === 0 && phoneNT.length === phoneItems.length) {
        failureDetail.push({
          category: "Phone Calls",
          grade_impact: "T3",
          found: uniquePhones.size,
          tested: phoneItems.length,
          passed: 0,
          summary: `${uniquePhones.size} phone link(s) found but none could be tested automatically — manual verification required.`,
          items: phoneItems.map((i) => ({
            href: i.href,
            display_text: i.display_text || null,
            page_url: i.page_url,
            status: i.status,
            reason: i.reason || null,
            fix: `Phone link could not be clicked (${i.reason || "unknown"}). Test manually in GTM Preview.`,
          })),
        });
      } else if (phonePassed.length === 0 && phoneFailed.length > 0) {
        failureDetail.push({
          category: "Phone Calls",
          grade_impact: "FAIL",
          found: uniquePhones.size,
          tested: phoneItems.length,
          passed: 0,
          summary: `${uniquePhones.size} phone link(s) found and tested — none fired a GA4 conversion event.`,
          items: phoneItems.map((i) => ({
            href: i.href,
            display_text: i.display_text || null,
            page_url: i.page_url,
            status: i.status,
            reason: i.reason || null,
            generic_events_seen: i.generic_events_seen || [],
            fix:
              i.status === "FAIL"
                ? i.generic_events_seen?.length
                  ? `GTM fired but only generic events (${i.generic_events_seen.join(", ")}) — add a GA4 Event tag with a Click — Just Links trigger for href contains tel:.`
                  : "No GA4 beacon fired. Create a Click — Just Links trigger in GTM for href contains tel: and attach a GA4 Event tag (e.g. event name: click_phone)."
                : `Could not be clicked (${i.reason || "unknown"}). Test manually in GTM Preview.`,
          })),
        });
      } else if (phonePassed.length > 0 && phoneFailed.length > 0) {
        failureDetail.push({
          category: "Phone Calls — Partial",
          grade_impact: "T2",
          found: uniquePhones.size,
          tested: phoneItems.length,
          passed: phonePassed.length,
          failed: phoneFailed.length,
          summary: `Phone tracking fires on some pages but not all — ${phonePassed.length} passed, ${phoneFailed.length} failed.`,
          items: phoneItems
            .filter((i) => i.status === "FAIL")
            .map((i) => ({
              href: i.href,
              display_text: i.display_text || null,
              page_url: i.page_url,
              status: i.status,
              reason: i.reason || null,
              generic_events_seen: i.generic_events_seen || [],
              fix: i.generic_events_seen?.length
                ? `GTM fired but only generic events (${i.generic_events_seen.join(", ")}) on ${i.page_url} — check the GTM trigger scope.`
                : `No GA4 beacon fired on ${i.page_url}. Verify the Click — Just Links trigger is firing on all pages, not just certain page paths.`,
            })),
        });
      }
    }

    if (phoneDuplicateItems.length > 0) {
      failureDetail.push({
        category: "Phone Call — Duplicate Firing",
        grade_impact: "T2",
        summary: `${phoneDuplicateItems.length} phone CTA(s) fired GA4 more than once on the same page — tag is set to "Once per event" and will double-count conversions.`,
        items: phoneDuplicateItems.map((i) => ({
          href: i.href,
          page_url: i.page_url,
          warning: i.duplicate_fire_test.summary,
          events_on_second_click: i.duplicate_fire_test.events_on_second_click,
          fix: i.duplicate_fire_test.fix,
        })),
      });
    }

    // ── Email clicks ──
    if (uniqueEmails.size > 0) {
      const emailFailed = emailItems.filter((i) => i.status === "FAIL");
      const emailNT = emailItems.filter((i) => i.status === "NOT_TESTED");
      const emailPassed = emailItems.filter((i) => i.status === "PASS");

      if (emailPassed.length === 0 && emailNT.length === emailItems.length) {
        failureDetail.push({
          category: "Email Clicks",
          grade_impact: "T3",
          found: uniqueEmails.size,
          tested: emailItems.length,
          passed: 0,
          summary: `${uniqueEmails.size} email link(s) found but none could be tested automatically — manual verification required.`,
          items: emailItems.map((i) => ({
            href: i.href,
            display_text: i.display_text || null,
            page_url: i.page_url,
            status: i.status,
            reason: i.reason || null,
            fix: `Email link could not be clicked (${i.reason || "unknown"}). Test manually in GTM Preview.`,
          })),
        });
      } else if (emailPassed.length === 0 && emailFailed.length > 0) {
        failureDetail.push({
          category: "Email Clicks",
          grade_impact: "FAIL",
          found: uniqueEmails.size,
          tested: emailItems.length,
          passed: 0,
          summary: `${uniqueEmails.size} email link(s) found and tested — none fired a GA4 conversion event.`,
          items: emailItems.map((i) => ({
            href: i.href,
            display_text: i.display_text || null,
            page_url: i.page_url,
            status: i.status,
            reason: i.reason || null,
            generic_events_seen: i.generic_events_seen || [],
            fix:
              i.status === "FAIL"
                ? i.generic_events_seen?.length
                  ? `GTM fired but only generic events (${i.generic_events_seen.join(", ")}) — add a GA4 Event tag with a Click — Just Links trigger for href contains mailto:.`
                  : "No GA4 beacon fired. Create a Click — Just Links trigger in GTM for href contains mailto: and attach a GA4 Event tag (e.g. event name: click_email)."
                : `Could not be clicked (${i.reason || "unknown"}). Test manually in GTM Preview.`,
          })),
        });
      } else if (emailPassed.length > 0 && emailFailed.length > 0) {
        failureDetail.push({
          category: "Email Clicks — Partial",
          grade_impact: "T2",
          found: uniqueEmails.size,
          tested: emailItems.length,
          passed: emailPassed.length,
          failed: emailFailed.length,
          summary: `Email tracking fires on some pages but not all — ${emailPassed.length} passed, ${emailFailed.length} failed.`,
          items: emailItems
            .filter((i) => i.status === "FAIL")
            .map((i) => ({
              href: i.href,
              display_text: i.display_text || null,
              page_url: i.page_url,
              status: i.status,
              reason: i.reason || null,
              generic_events_seen: i.generic_events_seen || [],
              fix: i.generic_events_seen?.length
                ? `GTM fired but only generic events (${i.generic_events_seen.join(", ")}) on ${i.page_url} — check the GTM trigger scope.`
                : `No GA4 beacon fired on ${i.page_url}. Verify the Click — Just Links trigger is firing on all pages.`,
            })),
        });
      }
    }

    if (emailDuplicateItems.length > 0) {
      failureDetail.push({
        category: "Email Click — Duplicate Firing",
        grade_impact: "T2",
        summary: `${emailDuplicateItems.length} email CTA(s) fired GA4 more than once on the same page — tag is set to "Once per event" and will double-count conversions.`,
        items: emailDuplicateItems.map((i) => ({
          href: i.href,
          page_url: i.page_url,
          warning: i.duplicate_fire_test.summary,
          events_on_second_click: i.duplicate_fire_test.events_on_second_click,
          fix: i.duplicate_fire_test.fix,
        })),
      });
    }

    if (results.forms_found > 0 && results.forms_passed === 0) {
      const botBlocked = allFormResults.some((f) => f.reason?.includes("Bot Protection"));
      const allNT = allFormResults.every((f) => f.status === "NOT_TESTED");
      const formGrade = botBlocked || allNT ? "T3" : "FAIL";

      failureDetail.push({
        category: "Contact Forms",
        grade_impact: formGrade,
        found: results.forms_found,
        tested: allFormResults.filter((f) => f.status !== "NOT_TESTED").length,
        passed: 0,
        summary: botBlocked
          ? `${results.forms_found} form(s) — CAPTCHA/bot protection blocked automated testing. Manual verification required.`
          : allNT
            ? `${results.forms_found} form(s) — could not be submitted automatically. Manual verification required.`
            : `${results.forms_found} form(s) submitted — none fired a GA4 conversion event.`,
        items: allFormResults.map((f, idx) => ({
          form_index: idx,
          page_url: f.page_url || null,
          status: f.status,
          reason: f.reason || null,
          ga4_events_seen: f.ga4_events_seen || f.ga4_events || [],
          fix: f.reason?.includes("Bot Protection")
            ? "CAPTCHA present — submit manually and verify GA4 event in GTM Preview."
            : f.status === "FAIL" && f.reason?.includes("success")
              ? "Form submitted (success detected) but no GA4 event fired. Add a GTM trigger for Form Submission or Thank You page URL, with a GA4 Event tag."
              : f.status === "FAIL"
                ? "Form submitted but no GA4 event captured. Check GTM trigger scope — confirm the GA4 Event tag is published and the trigger matches this form."
                : f.reason?.includes("Validation")
                  ? "Validation blocked submission. Fill and submit manually, then verify in GTM Preview."
                  : f.reason?.includes("No visible submit button")
                    ? "No standard submit button found — may use custom JS. Submit manually and verify in GTM Preview."
                    : `Could not test automatically (${f.reason || "unknown"}). Submit manually and verify in GTM Preview.`,
        })),
      });
    }

    // ── Grading ──
    const totalFound = uniquePhones.size + uniqueEmails.size + results.forms_found;
    const hasFail = failureDetail.some((f) => f.grade_impact === "FAIL");
    const hasT2 = failureDetail.some((f) => f.grade_impact === "T2");
    const hasT3 = failureDetail.some((f) => f.grade_impact === "T3");
    const anyPassed = results.phone_passed > 0 || results.email_passed > 0 || results.forms_passed > 0;
    const hasDuplicateFiring = phoneDuplicateItems.length > 0 || emailDuplicateItems.length > 0;

    let grade, health_status, health_reasons;

    if (totalFound === 0) {
      grade = "Partial";
      health_status = "NOT_TESTED";
      health_reasons =
        "No trackable CTAs were found on any page visited. Check that the site has clickable phone numbers (tel: links), email addresses (mailto: links), or contact forms visible on the pages the runner visited.";
    } else if (hasFail && !anyPassed) {
      grade = "Fail";
      health_status = "NO_CONVERSIONS_TRACKED";
      health_reasons = directGa4Only
        ? "Direct GA4 (gtag.js) detected — no GTM container. No GA4 conversion event fired for any tested CTA or form. Check: (1) the GA4 event tags are configured correctly in your tag setup, (2) triggers fire on the correct interactions, (3) the GA4 Measurement ID matches the property."
        : "GTM is installed but no GA4 conversion event fired for any tested CTA or form. Check: (1) the GA4 tag is published in GTM — not just saved, (2) trigger conditions match the actual click events, (3) the GA4 Measurement ID is correct and the property is receiving data.";
    } else if (hasT3 && !hasFail && !hasT2 && !hasDuplicateFiring) {
      grade = "Partial";
      health_status = "NOT_TESTED";
      const t3FormDetail = failureDetail.find((f) => f.grade_impact === "T3" && f.category === "Contact Forms");
      health_reasons = t3FormDetail
        ? `${t3FormDetail.summary} Open GTM Preview, submit each form manually, and verify a GA4 event fires in the network tab.`
        : "CTAs were found but could not be tested automatically. Open GTM Preview, test manually, and verify GA4 events fire.";
    } else if (hasT2 || hasDuplicateFiring || (hasFail && anyPassed)) {
      grade = "Partial";
      health_status = "TRACKING_ISSUES_FOUND";
      const t2lines = [];
      if (hasDuplicateFiring)
        t2lines.push(
          `${phoneDuplicateItems.length + emailDuplicateItems.length} CTA(s) firing GA4 more than once per click — change the GTM tag firing option from "Once per event" to "Once per page".`,
        );
      failureDetail.filter((f) => f.grade_impact === "T2").forEach((f) => t2lines.push(f.summary));
      failureDetail.filter((f) => f.grade_impact === "FAIL" && anyPassed).forEach((f) => t2lines.push(f.summary));
      health_reasons =
        "Tracking is working but has issues. " +
        (t2lines.length > 0 ? t2lines.join(" | ") : failureDetail.map((f) => f.category).join(", "));
    } else {
      grade = "Perfect";
      health_status = "PASS";
      health_reasons =
        "All tracked CTAs are firing correctly. Every phone link, email link, and form tested fired a GA4 conversion event with no double-firing.";
    }

    results.grade = grade;
    results.health_status = health_status;
    results.health_reasons = health_reasons;
    results.failure_detail = failureDetail;

    // ── Consolidated fix text for the fix column ──
    const fixLines = [];
    if (!tracking.has_gtm) {
      fixLines.push("Install GTM: add the <head> and <body> snippets to every page then republish.");
    } else {
      if (hasDuplicateFiring)
        fixLines.push("Change duplicate-firing tag(s) in GTM from 'Once per event' to 'Once per page'.");
      const formFails = failureDetail.find((f) => f.category === "Contact Forms" && f.grade_impact !== "T3");
      if (formFails)
        fixLines.push(
          "Form submitted but no GA4 event fired — add a GTM Form Submission trigger (or Thank You page URL trigger) with a GA4 Event tag.",
        );
      const phoneFails = failureDetail.find((f) => f.category.startsWith("Phone Calls") && f.grade_impact === "FAIL");
      if (phoneFails)
        fixLines.push(
          "Phone click not tracked — create a GTM Click – Just Links trigger for href contains tel: and attach a GA4 Event tag (event name: click_call).",
        );
      const emailFails = failureDetail.find((f) => f.category.startsWith("Email Clicks") && f.grade_impact === "FAIL");
      if (emailFails)
        fixLines.push(
          "Email click not tracked — create a GTM Click – Just Links trigger for href contains mailto: and attach a GA4 Event tag (event name: click_email).",
        );
    }
    results.fix = fixLines.length > 0 ? fixLines.join(" | ") : null;

    // ── Console output ──
    const GRADE_LABEL = {
      Perfect: "✅ Perfect — PASS",
      Partial: "⚠️  Partial — ISSUES / NOT TESTED",
      Fail: "❌ Fail — NO TRACKING / NO CONVERSIONS",
    };
    logInfo(`\n╔══════════════════════════════════════════════╗`);
    logInfo(`  TRACKING HEALTH CHECK RESULT`);
    logInfo(`  URL        : ${targetUrl}`);
    logInfo(`  GRADE      : ${GRADE_LABEL[grade]}`);
    logInfo(`  WHY        : ${health_reasons}`);
    logInfo(
      `  SCORES     : Forms ${results.forms_passed}/${results.forms_found} | Calls ${results.phone_passed}/${results.phone_found} | Emails ${results.email_passed}/${results.email_found}`,
    );
    logInfo(`  DUPE FIRES : Phones ${phoneDuplicateItems.length} | Emails ${emailDuplicateItems.length}`);
    logInfo(`  GTM IDs    : ${results.detected_gtm_ids.join(", ") || "none"}`);
    logInfo(`  GA4 IDs    : ${results.detected_ga4_ids.join(", ") || "none"}`);
    if (results.container_analysis) {
      logInfo(
        `  CONTAINER  : v${results.container_analysis.version} — tags: ${results.container_analysis.tags.map((t) => `${t.label}(${t.count})`).join(", ") || "none"}`,
      );
      if (results.container_analysis.eventNames.length > 0)
        logInfo(`  DL EVENTS  : ${results.container_analysis.eventNames.join(", ")}`);
    }
    if (results.ga4_validation_errors.length > 0)
      logInfo(
        `  GA4 ERRORS : ${results.ga4_validation_errors.map((e) => `${e.event}(${e.messages.length} issue(s))`).join(", ")}`,
      );

    if (failureDetail.length > 0) {
      logInfo(`\n  ── FAILURES ──`);
      failureDetail.forEach((f) => {
        logInfo(`\n  [${f.grade_impact}] ${f.category.toUpperCase()} — ${f.summary}`);
        (f.items || []).forEach((item, idx) => {
          logInfo(`    ${idx + 1}. ${item.href || item.raw || "N/A"}  [${item.page_url || ""}]`);
          if (item.status) logInfo(`       Status : ${item.status}`);
          if (item.reason) logInfo(`       Reason : ${item.reason}`);
          if (item.warning) logInfo(`       ⚠️      : ${item.warning}`);
          if (item.events_on_second_click?.length)
            logInfo(`       2nd click events : ${item.events_on_second_click.join(", ")}`);
          logInfo(`       Fix    : ${item.fix}`);
        });
      });
    }

    const passingCTAs = [...phoneItems, ...emailItems].filter((i) => i.status === "PASS");
    if (passingCTAs.length > 0) {
      logInfo(`\n  ── PASSING CTAs ──`);
      passingCTAs.forEach((i) => {
        const dup =
          i.duplicate_fire_test?.result === "DUPLICATE_FIRED"
            ? "⚠️ DUPLICATE FIRE"
            : i.duplicate_fire_test?.result === "CORRECTLY_SUPPRESSED"
              ? "✅ once-per-page OK"
              : "—";
        logInfo(`    ✅ ${i.href}  [${i.page_url}]  dup-test: ${dup}`);
      });
    }

    results.ga4_events_captured = [
      ...new Set(beacons.filter((b) => b.type === "GA4" && b.event_name).map((b) => b.event_name)),
    ];

    // ── Feature 1: harvest dataLayer spy ──
    const dlSpy = await safeEvaluate(page, () => window.__dlSpy || []);
    if (Array.isArray(dlSpy) && dlSpy.length > 0) {
      // Summarise: event name + any event_category / event_action for UA-style pushes
      results.datalayer_events = dlSpy
        .filter((e) => e && (e.event || e["gtm.start"]))
        .map((e) => ({
          event: e.event || "gtm.start",
          ...(e.event_category ? { event_category: e.event_category } : {}),
          ...(e.event_action ? { event_action: e.event_action } : {}),
          ...(e.event_label ? { event_label: e.event_label } : {}),
        }))
        .slice(0, 100); // cap to avoid huge payloads
      logInfo(`📋 dataLayer spy: ${results.datalayer_events.length} event(s) captured`);
    }

    // ── Feature 3: rich GA4 event detail ──
    results.ga4_events_detail = beacons
      .filter((b) => b.type === "GA4" && b.event_name)
      .map((b) => ({
        event_name: b.event_name,
        measurement_id: b.tid || null,
        gtm_triggered: !!b.gtmHash,
        params: b.params || null,
      }));

    // ── Feature 4: GA4 validation errors ──
    results.ga4_validation_errors = ga4ValidationErrors;
    if (ga4ValidationErrors.length > 0) {
      logInfo(`⚠️  GA4 validation errors detected: ${ga4ValidationErrors.length} event(s) with issues`);
    }

    results.duration_ms = Date.now() - _checkStart;

    logInfo(`╚══════════════════════════════════════════════╝\n`);
    logInfo("✅ Check complete", { url: targetUrl, grade, status: health_status });
    return results;
  } catch (error) {
    logInfo(`❌ Fatal error`, { url: targetUrl, error: error.message });
    return {
      ...results,
      grade: "Partial",
      health_status: "ERROR",
      health_reasons: `Fatal error: ${error.message}`,
      duration_ms: Date.now() - _checkStart,
    };
  } finally {
    if (page) {
      try {
        page.removeAllListeners();
        await page.close();
      } catch {}
    }
    if (context) {
      openContexts.delete(context);
      try {
        await context.close();
      } catch {}
    }
  }
}

async function trackingHealthCheckSite(url, expectedGtmId = null) {
  await acquireCheckSlot();
  try {
    return await withTimeout(
      trackingHealthCheckSiteInternal(url, expectedGtmId),
      GLOBAL_TIMEOUT_MS,
      `Global timeout (${GLOBAL_TIMEOUT_MS}ms) exceeded for ${url}`,
    );
  } catch (e) {
    logInfo(`⏱ Check aborted: ${e.message}`, { url });
    return { website_url: normaliseUrl(url), grade: "Partial", health_status: "ERROR", health_reasons: e.message };
  } finally {
    releaseCheckSlot();
  }
}

// ─────────────────────────────────────────────
// Batch processing system
// ─────────────────────────────────────────────
const batchJobs = new Map();

async function runBatchHealthCheck(jobId, clients, callbackUrl = null) {
  const clientList = clients.map((c, i) => (typeof c === "string" ? { url: c, _index: i } : { ...c, _index: i }));

  batchJobs.set(jobId, {
    total: clientList.length,
    completed: 0,
    results: [],
    status: "running",
    startedAt: new Date().toISOString(),
    callbackUrl,
  });

  logInfo(`🚀 Starting batch job ${jobId} with ${clientList.length} clients`);

  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const i = nextIndex++;
      if (i >= clientList.length) break;
      const client = clientList[i];
      const { url, gtm_id, _index, ...metadata } = client;
      try {
        const result = await trackingHealthCheckSite(url, gtm_id || null);
        const job = batchJobs.get(jobId);
        if (job) {
          job.results.push({ ...metadata, url, index: _index, ...result });
          job.completed++;
          logDebug(`✓ Batch job ${jobId}: completed ${job.completed}/${job.total}`);
        }
      } catch (error) {
        const job = batchJobs.get(jobId);
        if (job) {
          job.results.push({
            ...metadata,
            url,
            index: _index,
            grade: "Partial",
            health_status: "ERROR",
            health_reasons: error.message,
          });
          job.completed++;
          logDebug(`✗ Batch job ${jobId}: error for ${url} - ${error.message}`);
        }
      }
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_CHECKS, clientList.length);
  logInfo(`🔄 Batch job ${jobId}: spawning ${workerCount} workers for ${clientList.length} clients`);

  try {
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    const job = batchJobs.get(jobId);
    if (job) {
      job.status = "complete";
      job.results.sort((a, b) => a.index - b.index);
      logInfo(`✅ Batch job ${jobId} completed: ${job.completed}/${job.total} processed`);
      if (callbackUrl) sendBatchCallback(jobId, job, callbackUrl);
      // Auto-cleanup: remove job from memory after 4 hours to prevent unbounded RAM growth
      setTimeout(
        () => {
          batchJobs.delete(jobId);
          logDebug(`🗑 Batch job ${jobId} evicted from memory`);
        },
        4 * 60 * 60 * 1000,
      );
    }
  } catch (error) {
    const job = batchJobs.get(jobId);
    if (job) {
      job.status = "error";
      job.error = error.message;
      logInfo(`❌ Batch job ${jobId} failed: ${error.message}`);
    }
  }
}

function getBatchJob(jobId) {
  return batchJobs.get(jobId);
}

async function sendBatchCallback(jobId, job, callbackUrl) {
  const url = require("url");
  const parsedUrl = url.parse(callbackUrl);
  const isHttps = parsedUrl.protocol === "https:";
  const httpModule = isHttps ? require("https") : require("http");

  const payload = JSON.stringify({
    job_id: jobId,
    status: job.status,
    total: job.total,
    completed: job.completed,
    results: job.results,
    startedAt: job.startedAt,
    completedAt: new Date().toISOString(),
  });

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  logInfo(`📞 Sending batch completion callback to ${callbackUrl}`);

  const req = httpModule.request(options, (res) => {
    logDebug(`Callback response status: ${res.statusCode}`);
  });

  req.on("error", (error) => {
    logInfo(`❌ Callback failed: ${error.message}`, { jobId, callbackUrl });
  });

  req.write(payload);
  req.end();
}

module.exports = {
  trackingHealthCheckSite,
  runBatchHealthCheck,
  getBatchJob,
};
