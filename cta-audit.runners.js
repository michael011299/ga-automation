const { chromium } = require("playwright");

let browser = null;

const TEST_VALUES = {
  firstName: "AuditTest",
  lastName: "Bot",
  fullName: "AuditTest Bot",
  email: process.env.AUDIT_TEST_EMAIL || "audit-test@example.com",
  phone: process.env.AUDIT_TEST_PHONE || "01632960123",
  message: "This is an automated CTA audit. Please ignore.",
  company: "Test Company",
  postcode: "SW1A 1AA",
};

const SUCCESS_SELECTORS = [
  ".wpcf7-response-output",
  ".wpcf7-mail-sent-ok",
  ".gform_confirmation_message",
  ".contact-form-success",
  ".form-success",
  ".success-message",
  ".thank-you",
  ".thankyou",
  '[class*="success"]',
  '[class*="thank"]',
  '[class*="confirmation"]',
  '[role="alert"]',
  ".alert-success",
  // Additional common selectors
  ".success",
  ".message-success",
  ".form-message.success",
  ".notification.success",
  ".alert.success",
  ".status.success",
  ".response.success",
  ".feedback.success",
  ".result.success",
  '[class*="sent"]',
  '[class*="submitted"]',
  '[class*="complete"]',
  ".cf7-mail-sent",
  ".elementor-message-success",
  ".wpforms-confirmation",
  ".forminator-success",
  ".ninja-forms-success",
  ".gravityform-success",
  ".contact-form-7-success",
  ".success-msg",
  ".success-text",
  ".success-alert",
  ".success-notification",
  ".success-banner",
  ".success-modal",
  ".success-popup",
  ".success-toast",
  ".toast.success",
  ".flash.success",
  ".notice.success",
  ".info.success",
  '[data-status="success"]',
  '[data-type="success"]',
  '[data-message-type="success"]',
];

const BOOKING_PLATFORMS = {
  "calendly.com": "Calendly",
  "acuityscheduling.com": "Acuity Scheduling",
  "simplybook.me": "SimplyBook.me",
  "booksy.com": "Booksy",
  "mindbodyonline.com": "Mindbody",
  "squareup.com": "Square Appointments",
  "setmore.com": "Setmore",
  "youcanbook.me": "YouCanBook.me",
  "fresha.com": "Fresha",
  "cliniko.com": "Cliniko",
  "janeapp.com": "Jane App",
  "treatwell.co.uk": "Treatwell",
  "treatwell.com": "Treatwell",
  "vagaro.com": "Vagaro",
};

const NEWSLETTER_PLATFORMS = {
  "mailchimp.com": "Mailchimp",
  "klaviyo.com": "Klaviyo",
  "constantcontact.com": "Constant Contact",
  "convertkit.com": "ConvertKit",
  "activecampaign.com": "ActiveCampaign",
  "mailerlite.com": "MailerLite",
  "brevo.com": "Brevo",
  "getresponse.com": "GetResponse",
  "hubspot.com": "HubSpot",
};

const SOCIAL_PLATFORMS = {
  "facebook.com": "Facebook",
  "fb.com": "Facebook",
  "instagram.com": "Instagram",
  "twitter.com": "X (Twitter)",
  "x.com": "X (Twitter)",
  "linkedin.com": "LinkedIn",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "tiktok.com": "TikTok",
  "pinterest.com": "Pinterest",
  "snapchat.com": "Snapchat",
  "threads.net": "Threads",
  "trustpilot.com": "Trustpilot",
  // Google Maps removed — handled separately via extractLocationLinks
};

// Free consumer email providers — any address at these domains is filtered out
// (real businesses should use their own domain email)
const GENERIC_EMAIL_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.com.au",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "outlook.com",
  "outlook.co.uk",
  "live.com",
  "live.co.uk",
  "live.ca",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "inbox.com",
  "yandex.com",
  "yandex.ru",
]);

// Automated/system local-parts — filtered regardless of domain
const GENERIC_EMAIL_LOCAL =
  /^(noreply|no[-_.]reply|donotreply|do[-_.]not[-_.]reply|bounce|bounces?|mailer[-_]daemon|postmaster|webmaster|hostmaster|daemon|automated|unsubscribe|subscribe|notification|notifications|alerts?|info-noreply|support-noreply|admin-noreply)$/i;

// Generic business placeholder local-parts — these are catch-all inboxes that
// appear on almost every site and don't represent meaningful conversion intent.
// Named personal emails (john@company.com) or specific dept emails (sales@) pass.
const PLACEHOLDER_EMAIL_LOCAL =
  /^(info|information|hello|hi|hey|contact|contactus|enquir(y|ies|e)|general|generalenquir(y|ies)|office|team|mail|email|reception|welcome|getintouch|reach|reachout|ask|query|queries|message|feedback|hq|headquarters)$/i;

function isGenericEmail(address) {
  if (!address || !address.includes("@")) return false;
  const [local, domain] = address.toLowerCase().split("@");
  if (!domain) return false;
  if (GENERIC_EMAIL_PROVIDERS.has(domain)) return true;
  if (GENERIC_EMAIL_LOCAL.test(local)) return true;
  if (PLACEHOLDER_EMAIL_LOCAL.test(local)) return true;
  return false;
}

const LIVE_CHAT_DETECTORS = [
  { name: "Intercom", global: "Intercom" },
  { name: "Drift", global: "drift" },
  { name: "Crisp", global: "$crisp" },
  { name: "Tidio", global: "tidioChatApi" },
  { name: "LiveChat", global: "LC_API" },
  { name: "Zendesk", global: "zE" },
  { name: "HubSpot Chat", global: "HubSpotConversations" },
  { name: "Tawk.to", global: "Tawk_API" },
  { name: "Facebook Pixel", global: "fbq" },
  { name: "TikTok Pixel", global: "ttq" },
];

async function safeEval(page, script, arg) {
  try {
    return arg !== undefined
      ? await page.evaluate(script, arg)
      : await page.evaluate(script);
  } catch (e) {
    return null;
  }
}

// Strip leading country code / trunk prefix to get the 9–10 digit subscriber core.
// Used to match a UK tel: number against the same number in a wa.me link.
//   447911123456 → 7911123456  (international with 44)
//   07911123456  → 7911123456  (UK local, strip leading 0)
//   17145551234  → 7145551234  (North American +1)
function normalisePhoneCore(digits) {
  const d = (digits || "").replace(/\D/g, "");
  if (d.startsWith("44") && d.length >= 11) return d.slice(2);
  if (d.startsWith("1") && d.length === 11) return d.slice(1);
  if (d.startsWith("0") && d.length >= 10) return d.slice(1);
  return d;
}

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--mute-audio",
      ],
    });

    browser.on("disconnected", () => {
      browser = null;
    });
  }
  return browser;
}

async function acceptCookieConsent(page) {
  const acceptPatterns = [/^accept all$/i, /^accept cookies$/i, /^allow all$/i, /^i accept$/i, /^i agree$/i, /^ok$/i];

  for (const pattern of acceptPatterns) {
    try {
      const button = page.getByRole("button", { name: pattern });
      if (await button.isVisible({ timeout: 2000 })) {
        await button.click();
        await page.waitForTimeout(1000);
        break;
      }
    } catch (e) {
      // Continue to next pattern
    }
  }
}

async function findContactPageUrl(page, baseUrl) {
  const contactKeywords = ["contact", "get-in-touch", "enquire", "enquiry", "quote", "book", "reach-us"];
  const commonPaths = ["/contact", "/contact-us", "/get-in-touch", "/enquiry"];

  // Check common paths first
  for (const path of commonPaths) {
    try {
      const url = new URL(path, baseUrl).href;
      const response = await page.request.head(url);
      if (response.ok()) {
        return url;
      }
    } catch (e) {
      // Continue to next path
    }
  }

  // Look for contact links on the page
  const links = await safeEval(page, () => {
    return Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      href: a.href,
      text: (a.textContent || "").toLowerCase().trim(),
    }));
  });

  if (links) {
    for (const link of links) {
      const linkText = link.text;
      if (contactKeywords.some((keyword) => linkText.includes(keyword))) {
        try {
          const url = new URL(link.href, baseUrl);
          if (url.origin === new URL(baseUrl).origin) {
            return url.href;
          }
        } catch (e) {
          // Continue to next link
        }
      }
    }
  }

  return null;
}

async function extractPhones(page, pageUrl) {
  const phones = await safeEval(page, () => {
    const clickableRaw = [];

    // Find clickable tel: links — skip invisible elements
    document.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      const style = window.getComputedStyle(a);
      if (style.display === "none" || style.visibility === "hidden") return;
      const href = a.getAttribute("href");
      const number = href.replace("tel:", "").replace(/\D/g, "");
      if (!number || number.length < 10) return;
      clickableRaw.push({
        href,
        number,
        display_text: a.textContent.trim(),
        clickable: true,
      });
    });

    // Deduplicate by normalised number — keep first DOM occurrence (avoids
    // header + footer + mobile-nav copies of the same number inflating the count)
    const seenNumbers = new Set();
    const clickable = clickableRaw.filter((p) => {
      if (seenNumbers.has(p.number)) return false;
      seenNumbers.add(p.number);
      return true;
    });

    // Find plain text phone numbers — tighter UK/international regex to avoid
    // false positives from dates, order numbers, postcodes, etc.
    const phoneRegex = /(?:\+44|0044|0)[\s-]?\(?\d{2,5}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g;
    const plainText = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Already covered by a tel: link
        if (parent.closest('a[href^="tel:"]')) return NodeFilter.FILTER_REJECT;
        // Non-visible or non-content nodes
        if (
          parent.closest('script, style, noscript, [aria-hidden="true"], [hidden], input, select, option, time, data')
        )
          return NodeFilter.FILTER_REJECT;
        const pStyle = window.getComputedStyle(parent);
        if (pStyle.display === "none" || pStyle.visibility === "hidden") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent;
      const matches = text.match(phoneRegex);
      if (matches) {
        matches.forEach((match) => {
          const digits = match.replace(/\D/g, "");
          if (digits.length >= 10 && digits.length <= 13) {
            // Skip if this number is already covered by a clickable tel: link
            if (seenNumbers.has(digits)) return;
            plainText.push({ number: match.trim(), digits, clickable: false });
          }
        });
      }
    }

    return { clickable, plainText };
  });

  if (phones) {
    phones.clickable.forEach((phone) => (phone.page_url = pageUrl));
    phones.plainText.forEach((phone) => (phone.page_url = pageUrl));
  }

  return phones || { clickable: [], plainText: [] };
}

async function extractEmails(page, pageUrl) {
  const emails = await safeEval(page, () => {
    const clickable = [];
    const plainText = [];

    // Find clickable mailto: links
    document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const href = a.getAttribute("href");
      const address = href.replace("mailto:", "").split("?")[0];
      clickable.push({
        href,
        address,
        display_text: a.textContent.trim(),
        clickable: true,
      });
    });

    // Find plain text emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('a[href^="mailto:"]')) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script, style, noscript")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent;
      const matches = text.match(emailRegex);
      if (matches) {
        matches.forEach((match) => {
          plainText.push({
            address: match,
            clickable: false,
          });
        });
      }
    }

    return { clickable, plainText };
  });

  if (emails) {
    // Remove free-provider and automated addresses — not the business's own contact info
    emails.clickable = emails.clickable.filter((e) => !isGenericEmail(e.address));
    emails.plainText = emails.plainText.filter((e) => !isGenericEmail(e.address));
    emails.clickable.forEach((email) => (email.page_url = pageUrl));
    emails.plainText.forEach((email) => (email.page_url = pageUrl));
  }

  return emails || { clickable: [], plainText: [] };
}

async function extractWhatsApp(page, pageUrl) {
  const whatsapp = await safeEval(page, () => {
    const links = [];
    const seenHrefs = new Set();

    const numberFromStr = (str) => {
      const m =
        str.match(/wa\.me\/([0-9]+)/) || str.match(/phone=([0-9]+)/) || str.match(/whatsapp:\/\/send\?phone=([0-9]+)/);
      return m ? m[1] : null;
    };

    const typeFromStr = (str) => {
      if (str.includes("wa.me")) return "wa.me";
      if (str.includes("api.whatsapp.com") || str.includes("whatsapp.com/send")) return "api.whatsapp.com";
      if (str.includes("whatsapp://")) return "whatsapp://";
      return null;
    };

    const isFixed = (el) => {
      let node = el;
      while (node && node !== document.body) {
        const pos = window.getComputedStyle(node).position;
        if (pos === "fixed" || pos === "sticky") return true;
        node = node.parentElement;
      }
      return false;
    };

    const pushLink = (href, el) => {
      const key = href.replace(/\s+/g, "");
      if (seenHrefs.has(key)) return;
      seenHrefs.add(key);
      const type = typeFromStr(href);
      const number = numberFromStr(href);
      if (!type) return;
      links.push({
        href: key,
        type,
        number: number || "unknown",
        display_text: (el.textContent || "").trim() || el.getAttribute("aria-label") || "",
        is_floating: isFixed(el),
      });
    };

    // 1. Standard anchor hrefs — wa.me, whatsapp.com, whatsapp:// protocol
    document
      .querySelectorAll(
        'a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="api.whatsapp.com"], a[href*="whatsapp://"]',
      )
      .forEach((a) => pushLink(a.getAttribute("href") || "", a));

    // 2. Non-anchor elements — div/button/span with onclick, data-href, or data-url
    //    containing a WhatsApp URL (common in floating button plugins)
    document
      .querySelectorAll(
        '[onclick*="wa.me"], [onclick*="whatsapp"], [data-href*="wa.me"], [data-href*="whatsapp"], [data-url*="wa.me"], [data-url*="whatsapp"], [data-link*="wa.me"], [data-link*="whatsapp"]',
      )
      .forEach((el) => {
        if (el.tagName === "A") return; // already handled above
        const src =
          el.getAttribute("onclick") ||
          el.getAttribute("data-href") ||
          el.getAttribute("data-url") ||
          el.getAttribute("data-link") ||
          "";
        const urlMatch = src.match(/https?:\/\/[^\s'")\]]+/);
        if (urlMatch) pushLink(urlMatch[0], el);
      });

    // 3. Widget detection — broader class/id patterns used by popular WP plugins
    const hasWidget =
      !!document.querySelector('script[src*="whatsapp"]') ||
      !!window.WhatsAppWidget ||
      !!document.querySelector(
        '[class*="whatsapp"],[id*="whatsapp"],[class*="wts-chat"],[class*="wwa-btn"],' +
          '[class*="wa-chat"],[class*="wp-whatsapp"],[class*="whatshelp"],' +
          '[class*="wpwl-"],[id*="wpwl-"],[class*="tawkto-whatsapp"]',
      );

    return { links, has_widget: hasWidget };
  });

  if (whatsapp) {
    whatsapp.page_url = pageUrl;
  }

  return whatsapp || { links: [], has_widget: false, page_url: pageUrl };
}

async function extractBookingLinks(page, pageUrl) {
  // Pass ALL_BOOKING_DOMAINS entries into the browser context so this function
  // stays in sync with the master platform list without duplication.
  const platformEntries = Object.entries(ALL_BOOKING_DOMAINS);

  const bookingLinks = await safeEval(
    page,
    (entries) => {
      const links = [];

      // Check for links
      document.querySelectorAll("a[href]").forEach((a) => {
        const href = (a.getAttribute("href") || "").trim();
        if (!href) return;
        for (const [domain, platformName] of entries) {
          if (href.includes(domain)) {
            links.push({
              href,
              platform: platformName,
              domain,
              type: "external_link",
              opens_new_tab: a.getAttribute("target") === "_blank",
              display_text: a.textContent.trim(),
            });
            break;
          }
        }
      });

      // Check for embedded iframes (booking widgets embedded directly on page)
      document.querySelectorAll("iframe[src]").forEach((iframe) => {
        const src = (iframe.getAttribute("src") || "").trim();
        if (!src) return;
        for (const [domain, platformName] of entries) {
          if (src.includes(domain)) {
            links.push({
              href: src,
              platform: platformName,
              domain,
              type: "embedded_iframe",
              opens_new_tab: false,
              display_text: "Embedded booking widget",
            });
            break;
          }
        }
      });

      return links;
    },
    platformEntries,
  );

  if (bookingLinks) {
    bookingLinks.forEach((link) => (link.page_url = pageUrl));
  }

  return bookingLinks || [];
}

// Match labels that signal direct intent to book or get a price — covers both
// appointment-style ("book now", "schedule") and transport/service-style
// ("get a quote", "order now", "hire a driver", "calculate fare") CTAs.
const BOOKING_CTA_KEYWORDS =
  /\b(book(\s*(now|online|a?\s*taxi|a?\s*cab|a?\s*ride|a?\s*transfer|a?\s*session|an?\s*appointment|a?\s*class|a?\s*consultation|a?\s*call|your|a?\s*slot|a?\s*visit))?|schedule(\s*(a?\s*call|a?\s*session|now))?|reserve(\s*(a?\s*spot|now|a?\s*seat))?|make\s*(an?\s*appointment|a?\s*booking|a?\s*reservation)|arrange\s*(a?\s*visit|a?\s*transfer)|get\s*a?\s*(quote|price|fare)|order(\s*(now|a?\s*(taxi|cab|ride|transfer)))?|hire(\s*(a?\s*(driver|taxi|cab|car|van|minibus|coach)))?|calculate\s*(fare|price|route)|check\s*(fare|price|availability)|instant\s*(quote|booking)|request\s*(a?\s*(quote|call|callback|transfer))|make\s*a?\s*transfer)\b/i;

// URL patterns that indicate a generic contact/enquiry page — links landing here
// are soft leads, not direct conversions, and should be excluded from booking CTAs.
const CONTACT_PAGE_PATTERN =
  /\/(contact|contact-us|get-in-touch|enquire|enquiry|enquiries|reach-us|say-hello|talk-to-us|message-us)(\/|$|\?)/i;

// URL patterns for service/info pages — a link to these with a form on them is
// NOT a direct booking CTA; it's just a nav link to a brochure/services page.
const INFO_PAGE_PATTERN =
  /\/(services?|our-services?|treatments?|packages?|about|about-us|our-story|portfolio|gallery|blog|news|team|staff|faq|faqs|help)(\/|$|\?)/i;

// Booking platform domain → display name.
// Organised by sector so it's easy to add new platforms.
// To extend: add "domain.com": "Platform Name" in the relevant sector block.
const ALL_BOOKING_DOMAINS = {
  // ── General multi-sector scheduling ───────────────────────────────────────
  "calendly.com":          "Calendly",
  "acuityscheduling.com":  "Acuity Scheduling",
  "simplybook.me":         "SimplyBook.me",
  "setmore.com":           "Setmore",
  "youcanbook.me":         "YouCanBook.me",
  "trafft.com":            "Trafft",
  "appointy.com":          "Appointy",
  "10to8.com":             "10to8",
  "supersaas.com":         "SuperSaaS",
  "picktime.com":          "Picktime",
  "bookafy.com":           "Bookafy",
  "vcita.com":             "vCita",
  "bookwhen.com":          "Bookwhen",
  "shore.com":             "Shore",
  "squareup.com":          "Square Appointments",
  "thryv.com":             "Thryv",
  "hubspot.com":           "HubSpot Meetings",
  "meetings.hubspot.com":  "HubSpot Meetings",
  "chili.piper.com":       "Chili Piper",
  "chilipiper.com":        "Chili Piper",
  "savvycal.com":          "SavvyCal",
  "doodle.com":            "Doodle",
  "reclaim.ai":            "Reclaim",
  "book.like.a.boss":      "Book Like a Boss",
  "oncehub.com":           "OnceHub",

  // ── Beauty / personal care / hair / nails ─────────────────────────────────
  "booksy.com":            "Booksy",
  "fresha.com":            "Fresha",
  "treatwell.co.uk":       "Treatwell",
  "treatwell.com":         "Treatwell",
  "vagaro.com":            "Vagaro",
  "glossgenius.com":       "GlossGenius",
  "boulevard.app":         "Boulevard",
  "booker.com":            "Booker",
  "salonspa.com":          "SalonSpa",
  "salonbiz.com":          "SalonBiz",
  "shortcuts.net":         "Shortcuts",
  "timely.com":            "Timely",
  "goldie.app":            "Goldie",
  "styleseat.com":         "StyleSeat",
  "genbook.com":           "Genbook",

  // ── Fitness / gym / wellness / yoga ───────────────────────────────────────
  "mindbodyonline.com":    "Mindbody",
  "wellhub.com":           "Wellhub",
  "gympass.com":           "Gympass",
  "clubready.com":         "ClubReady",
  "marianatek.com":        "Mariana Tek",
  "wellnessliving.com":    "WellnessLiving",
  "teamup.com":            "TeamUp",
  "ezfacility.com":        "EZFacility",
  "gymmaster.com":         "GymMaster",
  "pushpress.com":         "PushPress",
  "zenplanner.com":        "Zen Planner",
  "glofox.com":            "Glofox",
  "hapana.com":            "Hapana",
  "classbento.com.au":     "ClassBento",

  // ── Healthcare / medical / dental / therapy ───────────────────────────────
  "cliniko.com":           "Cliniko",
  "janeapp.com":           "Jane App",
  "powerdiary.com":        "Power Diary",
  "halaxy.com":            "Halaxy",
  "nookal.com":            "Nookal",
  "practicepal.co.uk":     "PracticePal",
  "healthcode.co.uk":      "Healthcode",
  "doctolib.fr":           "Doctolib",
  "doctolib.de":           "Doctolib",
  "zocdoc.com":            "Zocdoc",
  "healthengine.com.au":   "HealthEngine",
  "lumahealth.io":         "Luma Health",
  "myhealth1st.com.au":    "MyHealth1st",
  "patientfusion.com":     "Patient Fusion",
  "dentally.co":           "Dentally",
  "soegroup.co.uk":        "Software of Excellence",
  "psyquel.com":           "Psyquel",
  "therapynotes.com":      "TherapyNotes",
  "simplepractice.com":    "SimplePractice",
  "karenapp.io":           "Karen (dental)",
  "drchrono.com":          "DrChrono",

  // ── Taxi / private hire / transfers / transport ───────────────────────────
  "icabbi.com":            "iCabbi",
  "autocab.com":           "Autocab",
  "autocabgo.com":         "Autocab Go",
  "taxicaller.com":        "TaxiCaller",
  "cab9.net":              "Cab9",
  "karhoo.com":            "Karhoo",
  "cordic.com":            "Cordic",
  "comcab.com":            "ComCab",
  "igoapp.com":            "iGo Taxi",
  "taxibooker.com":        "TaxiBooker",
  "gett.com":              "Gett",
  "wheely.com":            "Wheely",
  "blacklane.com":         "Blacklane",
  "welcomepickups.com":    "Welcome Pickups",
  "mytransfer.com":        "MyTransfer",
  "transfeero.com":        "Transfeero",
  "kiwitaxi.com":          "KiwiTaxi",

  // ── Tours / activities / experiences ──────────────────────────────────────
  "viator.com":            "Viator",
  "getyourguide.com":      "GetYourGuide",
  "klook.com":             "Klook",
  "fareharbor.com":        "FareHarbor",
  "xola.com":              "Xola",
  "checkfront.com":        "Checkfront",
  "rezdy.com":             "Rezdy",
  "bokun.io":              "Bókun",
  "peek.com":              "Peek Pro",
  "trekksoft.com":         "TrekkSoft",

  // ── Restaurants / hospitality / food ──────────────────────────────────────
  "opentable.com":         "OpenTable",
  "resy.com":              "Resy",
  "sevenrooms.com":        "SevenRooms",
  "quandoo.co.uk":         "Quandoo",
  "quandoo.com":           "Quandoo",
  "designmynight.com":     "DesignMyNight",
  "bookatable.co.uk":      "TheFork",
  "thefork.com":           "TheFork",
  "resdiary.com":          "ResDiary",
  "eatapp.co":             "Eat App",
  "dimmi.com.au":          "Dimmi",
  "nowbookit.com":         "NowBookIt",

  // ── Hotels / accommodation ────────────────────────────────────────────────
  "booking.com":           "Booking.com",
  "hotels.com":            "Hotels.com",
  "expedia.com":           "Expedia",
  "siteminder.com":        "SiteMinder",
  "cloudbeds.com":         "Cloudbeds",
  "little-hotelier.com":   "Little Hotelier",
  "guestline.com":         "Guestline",
  "mews.com":              "Mews",
  "clock-software.com":    "Clock PMS",
  "beds24.com":            "Beds24",

  // ── Events / tickets ──────────────────────────────────────────────────────
  "eventbrite.com":        "Eventbrite",
  "eventbrite.co.uk":      "Eventbrite",
  "ticketmaster.com":      "Ticketmaster",
  "ticketmaster.co.uk":    "Ticketmaster",
  "dice.fm":               "Dice",
  "skiddle.com":           "Skiddle",
  "seetickets.com":        "See Tickets",
  "axs.com":               "AXS",
  "humanitix.com":         "Humanitix",
  "universe.com":          "Universe",
  "tixel.com":             "Tixel",
  "tickettailor.com":      "Ticket Tailor",
  "billetto.co.uk":        "Billetto",

  // ── Home services / trades / cleaning / maintenance ───────────────────────
  "checkatrade.com":       "Checkatrade",
  "ratedpeople.com":       "Rated People",
  "trustatrader.com":      "TrustATrader",
  "mybuilder.com":         "MyBuilder",
  "bark.com":              "Bark",
  "hipages.com.au":        "Hipages",
  "houzz.com":             "Houzz",
  "taskrabbit.com":        "TaskRabbit",
  "angi.com":              "Angi",
  "homeadvisor.com":       "HomeAdvisor",
  "thumbtack.com":         "Thumbtack",
  "jobber.com":            "Jobber",
  "housecallpro.com":      "Housecall Pro",
  "servicem8.com":         "ServiceM8",
  "launch27.com":          "Launch27",
  "mhelpdesk.com":         "mHelpDesk",

  // ── Legal / professional services ─────────────────────────────────────────
  "clio.com":              "Clio",
  "mycase.com":            "MyCase",
  "practicepanther.com":   "PracticePanther",
  "lawmatics.com":         "Lawmatics",
  "smokeball.com":         "Smokeball",
  "filevine.com":          "Filevine",

  // ── Photography / creative / events planning ──────────────────────────────
  "honeybook.com":         "HoneyBook",
  "dubsado.com":           "Dubsado",
  "17hats.com":            "17Hats",
  "sproutstudio.com":      "Sprout Studio",
  "studio.ninja":          "Studio Ninja",
  "pixieset.com":          "Pixieset",
  "táve.com":              "Táve",

  // ── Education / tutoring / coaching ──────────────────────────────────────
  "tutorcruncher.com":     "TutorCruncher",
  "teachworks.com":        "Teachworks",
  "tutorbird.com":         "TutorBird",
  "lessonspace.com":       "Lessonspace",
  "classgap.com":          "Classgap",
  "coach.me":              "Coach.me",
  "paperbell.com":         "Paperbell",
  "coachvantage.com":      "CoachVantage",

  // ── Pet care / grooming / vet ─────────────────────────────────────────────
  "gingr.com":             "Gingr",
  "timetopet.com":         "Time To Pet",
  "pawfinity.com":         "Pawfinity",
  "petexec.net":           "PetExec",
  "petstablished.com":     "Petstablished",
  "123pet.com":            "123Pet",
  "daysmart.com":          "DaySmart Pet",

  // ── Automotive / MOT / servicing ──────────────────────────────────────────
  "motorway.co.uk":        "Motorway",
  "autoserve1.com":        "AutoServe1",
  "schedulemaster.com":    "ScheduleMaster",
  "workshopmate.co.uk":    "WorkshopMate",
  "garage-hive.com":       "Garage Hive",

  // ── Sports / leisure / courts / classes ───────────────────────────────────
  "courtreserve.com":      "CourtReserve",
  "clubautomation.com":    "Club Automation",
  "amilia.com":            "Amilia",
  "sportsbooking.com":     "SportsbBooking",
  "pitchbooking.com":      "Pitchbooking",
  "playfinder.com":        "Playfinder",
  "lta.org.uk":            "LTA Clubspark",
  "clubspark.co.uk":       "LTA ClubSpark",

  // ── Childcare / nursery ───────────────────────────────────────────────────
  "brightwheel.com":       "Brightwheel",
  "himama.com":            "HiMama",
  "procaresoftware.com":   "Procare",
  "kindertales.com":       "Kindertales",

  // ── Real estate / lettings ────────────────────────────────────────────────
  "viewingtracker.com":    "ViewingTracker",
  "rex.technology":        "Rex CRM",
  "propertybase.com":      "Propertybase",
  "agentbox.com.au":       "AgentBox",

  // ── eCommerce checkout / payment-linked booking ───────────────────────────
  "thrivecart.com":        "ThriveCart",
  "samcart.com":           "SamCart",
  "kartra.com":            "Kartra",
};

async function extractBookingCTAs(page, context, baseUrl) {
  // Step 1 — collect all booking-related links from the current page
  const rawLinks = await safeEval(page, () => {
    const found = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const text = (a.textContent || "").replace(/\s+/g, " ").trim();
      const ariaLabel = a.getAttribute("aria-label") || "";
      const labelText = (text || ariaLabel).trim();
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("tel:") || href.startsWith("mailto:")) return;

      // Include same-page anchor links (#section) only when the target element
      // exists and is a form — these are very common on taxi/service sites where
      // "Book Now" scrolls to an on-page booking form.
      if (href.startsWith("#")) {
        const anchor = href.slice(1);
        if (!anchor) return;
        const target = document.getElementById(anchor) || document.querySelector(`[name="${anchor}"]`);
        if (!target) return;
        const hasForm = target.tagName === "FORM" || !!target.querySelector("form");
        if (!hasForm) return;
      }

      found.push({ label_text: labelText, href, opens_new_tab: a.getAttribute("target") === "_blank", is_anchor: href.startsWith("#") });
    });
    return found;
  });

  if (!rawLinks) return [];

  // Filter to booking keyword matches and deduplicate by href
  const seenHrefs = new Set();
  const bookingLinks = rawLinks
    .filter((link) => {
      if (!BOOKING_CTA_KEYWORDS.test(link.label_text)) return false;
      if (seenHrefs.has(link.href)) return false;
      seenHrefs.add(link.href);
      return true;
    })
    .slice(0, 6); // max 6 to keep the audit fast

  // Step 2 — follow each link in a new tab and classify the destination
  const results = [];

  for (const link of bookingLinks) {
    // Same-page anchor links (#section) that passed the form check above are
    // classified directly — no navigation needed, form is already on this page.
    if (link.is_anchor) {
      results.push({
        link_text: link.label_text,
        source_href: link.href,
        final_url: baseUrl,
        page_title: await page.title().catch(() => ""),
        destination_type: "same_site_form",
        platform: null,
        clicks_to_book: 1,
        redirect_hops: 0,
        page_snippet: "",
        gtm_recommendation: `GA4 Event: contact_form | Trigger: Form Submission — on-page booking form (anchor: ${link.href})`,
      });
      continue;
    }

    let newPage = null;
    try {
      let absoluteUrl;
      try {
        absoluteUrl = new URL(link.href, baseUrl).href;
      } catch {
        continue;
      }

      newPage = await context.newPage();
      let redirectHops = 0;
      newPage.on("response", (response) => {
        const status = response.status();
        if (status >= 300 && status < 400) redirectHops++;
      });
      await newPage.goto(absoluteUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await newPage.waitForLoadState("load", { timeout: 5000 }).catch(() => {});

      const finalUrl = newPage.url();
      const pageTitle = await newPage.title().catch(() => "");
      const pageSnippet = await safeEval(newPage, () =>
        document.body ? document.body.innerText.replace(/\s+/g, " ").trim().substring(0, 400) : "",
      );

      // Classify destination
      let destinationType = "unknown";
      let platform = null;

      // 1. Check known booking platform domains
      for (const [domain, name] of Object.entries(ALL_BOOKING_DOMAINS)) {
        if (finalUrl.includes(domain)) {
          destinationType = "booking_platform";
          platform = name;
          break;
        }
      }

      // 2. If not a known platform, check if the destination URL path itself
      //    signals a booking system we haven't catalogued (e.g. /book, /booking,
      //    /appointments, /schedule, /reserve, /checkout on an external domain).
      if (destinationType === "unknown") {
        try {
          const destUrl = new URL(finalUrl);
          const isSameSite = destUrl.origin === new URL(baseUrl).origin;
          if (!isSameSite) {
            const BOOKING_PATH = /\/(book(ing|ings)?|appointments?|schedule|reserve|reservations?|checkout|order|quote|availability)(\/|$|\?)/i;
            if (BOOKING_PATH.test(destUrl.pathname)) {
              destinationType = "booking_platform";
              platform = destUrl.hostname.replace(/^www\./, "");
            }
          }
        } catch {}
      }

      if (destinationType === "unknown") {
        try {
          const isSameSite = new URL(finalUrl).origin === new URL(baseUrl).origin;
          if (isSameSite) {
            const formCount = (await safeEval(newPage, () => document.querySelectorAll("form").length)) || 0;
            destinationType = formCount > 0 ? "same_site_form" : "same_site_page";
          } else {
            destinationType = "external_unknown";
          }
        } catch {
          destinationType = "external_unknown";
        }
      }

      // Determine how many user clicks from the source page to reach an actual
      // booking action. booking_platform / same_site_form = 1 click (already there).
      // same_site_page = follow one level deeper to see if a booking platform or
      // form lives there — if so, 2 clicks; otherwise null (depth unclear).
      let clicksToBook = null;
      if (destinationType === "booking_platform" || destinationType === "same_site_form") {
        clicksToBook = 1;
      } else if (destinationType === "external_unknown") {
        clicksToBook = 1; // reached something off-site — treat as 1, destination unknown
      } else if (destinationType === "same_site_page") {
        const deepLinks =
          (await safeEval(newPage, () => Array.from(document.querySelectorAll("a[href]")).map((a) => a.href))) || [];
        const bookingDomainKeys = Object.keys(ALL_BOOKING_DOMAINS);
        const hasDeepBookingPlatform = deepLinks.some((href) => bookingDomainKeys.some((d) => href.includes(d)));
        clicksToBook = hasDeepBookingPlatform ? 2 : null;
      }

      // Build GTM recommendation
      let gtm_recommendation;
      if (destinationType === "booking_platform") {
        const hostname = new URL(finalUrl).hostname;
        gtm_recommendation = `GA4 Event: click_booking | Trigger: Click - Just Links | Filter: Click URL contains "${hostname}"`;
      } else if (destinationType === "same_site_form") {
        const path = new URL(finalUrl).pathname;
        gtm_recommendation = `GA4 Event: click_book_cta | Trigger: Click - Just Links on this CTA. Also set up form submission tracking on "${path}"`;
      } else if (destinationType === "same_site_page") {
        const path = new URL(finalUrl).pathname;
        gtm_recommendation = `GA4 Event: click_book_cta | Trigger: Click - Just Links | Filter: Click URL contains "${path}"`;
      } else {
        gtm_recommendation = `GA4 Event: click_book_cta | Trigger: Click - Just Links on booking CTA button | Destination: ${finalUrl}`;
      }

      // Only keep CTAs that lead directly to a conversion:
      //   booking_platform  → definite conversion
      //   same_site_form    → conversion only if it's a booking/appointment page,
      //                       not a generic contact/enquiry page
      //   same_site_page    → only if a booking platform was found one level deeper
      //   external_unknown  → keep (may be a custom booking system we don't recognise)
      const isDirectConversion =
        destinationType === "booking_platform" ||
        destinationType === "external_unknown" ||
        (destinationType === "same_site_form" &&
          !CONTACT_PAGE_PATTERN.test(finalUrl) &&
          !INFO_PAGE_PATTERN.test(finalUrl)) ||
        (destinationType === "same_site_page" && clicksToBook !== null);

      if (!isDirectConversion) continue;

      results.push({
        link_text: link.label_text,
        source_href: link.href,
        final_url: finalUrl,
        page_title: pageTitle,
        destination_type: destinationType,
        platform,
        clicks_to_book: clicksToBook,
        redirect_hops: redirectHops,
        page_snippet: pageSnippet,
        gtm_recommendation,
      });
    } catch (err) {
      results.push({
        link_text: link.label_text,
        source_href: link.href,
        final_url: null,
        page_title: null,
        destination_type: "error",
        platform: null,
        error: err.message,
        gtm_recommendation: "Could not follow link. Please check manually.",
      });
    } finally {
      if (newPage) await newPage.close().catch(() => {});
    }
  }

  return results;
}

function checkDeadSocialLink(href, platform) {
  try {
    const url = new URL(href);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (platform === "LinkedIn") {
      if (!/^\/(in|company|school)\/[^/]+/.test(path))
        return { is_dead: true, dead_reason: "Missing profile path (/in/ or /company/)" };
    } else if (platform === "YouTube") {
      if (!/^\/((@[^/]+)|(c\/[^/]+)|(channel\/[^/]+)|(user\/[^/]+))/.test(path))
        return { is_dead: true, dead_reason: "Missing channel path (/@username, /c/, /channel/, /user/)" };
    } else if (platform === "Instagram") {
      if (path === "/" || /^\/(explore|reels|accounts|stories|direct|p\/|reel\/)/.test(path))
        return { is_dead: true, dead_reason: "Links to Instagram homepage or generic page, not a profile" };
    } else if (platform === "X (Twitter)") {
      if (path === "/" || /^\/(login|signup|home|share|intent|i\/|hashtag\/|search)/.test(path))
        return { is_dead: true, dead_reason: "Links to X homepage or generic page, not a profile" };
    } else if (platform === "Facebook") {
      if (path === "/" || /^\/(sharer|dialog|login|share\/)/.test(path))
        return { is_dead: true, dead_reason: "Links to Facebook homepage or share/dialog, not a page" };
    } else if (platform === "TikTok") {
      if (!path.startsWith("/@"))
        return { is_dead: true, dead_reason: "Missing profile path (/@username)" };
    }
    return { is_dead: false, dead_reason: null };
  } catch {
    return { is_dead: false, dead_reason: null };
  }
}

async function extractSocialLinks(page, pageUrl) {
  const socialLinks = await safeEval(page, () => {
    const platforms = {
      "facebook.com": "Facebook",
      "fb.com": "Facebook",
      "instagram.com": "Instagram",
      "twitter.com": "X (Twitter)",
      "x.com": "X (Twitter)",
      "linkedin.com": "LinkedIn",
      "youtube.com": "YouTube",
      "youtu.be": "YouTube",
      "tiktok.com": "TikTok",
      "pinterest.com": "Pinterest",
      "snapchat.com": "Snapchat",
      "threads.net": "Threads",
      "trustpilot.com": "Trustpilot",
      // Google Maps intentionally excluded — tracked separately via extractLocationLinks
    };

    const found = [];
    const seen = new Set();

    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("http")) return;

      for (const [domain, platform] of Object.entries(platforms)) {
        if (href.includes(domain)) {
          const key = `${platform}:${href}`;
          if (!seen.has(key)) {
            seen.add(key);
            found.push({
              platform,
              href,
              display_text: a.textContent.trim() || a.getAttribute("aria-label") || "",
              opens_new_tab: a.getAttribute("target") === "_blank",
            });
          }
          break;
        }
      }
    });

    return found;
  });

  if (socialLinks) {
    socialLinks.forEach((link) => {
      link.page_url = pageUrl;
      const dead = checkDeadSocialLink(link.href, link.platform);
      link.is_dead = dead.is_dead;
      link.dead_reason = dead.dead_reason;
    });
  }

  return socialLinks || [];
}

// ---------------------------------------------------------------------------
// Google Maps location links — each unique location gets its own entry so
// individual GTM triggers can be created per location.
// ---------------------------------------------------------------------------
async function extractLocationLinks(page, pageUrl) {
  const MAPS_PATTERNS = [
    "google.com/maps",
    "maps.google.com",
    "g.page",
    "goo.gl/maps",
    "maps.app.goo.gl",
    "maps.google",
    "google.com/map",
    "maps.google.co.uk",
    "maps.google.ca",
    "maps.google.com.au",
    "maps.google.de",
    "maps.google.fr",
    "maps.google.es",
    "maps.google.it",
    "maps.google.nl",
    "maps.google.be",
    "maps.google.ch",
    "maps.google.at",
    "maps.google.se",
    "maps.google.no",
    "maps.google.dk",
    "maps.google.fi",
    "maps.google.pt",
    "maps.google.pl",
    "maps.google.cz",
    "maps.google.sk",
    "maps.google.hu",
    "maps.google.ro",
    "maps.google.bg",
    "maps.google.hr",
    "maps.google.si",
    "maps.google.ba",
    "maps.google.me",
    "maps.google.rs",
    "maps.google.mk",
    "maps.google.al",
    "maps.google.gr",
    "maps.google.tr",
    "maps.google.ru",
    "maps.google.ua",
    "maps.google.by",
    "maps.google.kz",
    "maps.google.uz",
    "maps.google.tm",
    "maps.google.tj",
    "maps.google.kg",
    "maps.google.az",
    "maps.google.ge",
    "maps.google.am",
    "maps.google.com.tr",
    "maps.google.com.eg",
    "maps.google.com.sa",
    "maps.google.com.ae",
    "maps.google.co.in",
    "maps.google.co.jp",
    "maps.google.co.kr",
    "maps.google.com.sg",
    "maps.google.com.hk",
    "maps.google.com.tw",
    "maps.google.com.vn",
    "maps.google.com.my",
    "maps.google.com.ph",
    "maps.google.com.th",
    "maps.google.com.id",
    "maps.google.com.mx",
    "maps.google.com.ar",
    "maps.google.com.br",
    "maps.google.com.co",
    "maps.google.com.pe",
    "maps.google.com.cl",
    "maps.google.com.ve",
    "maps.google.com.ec",
    "maps.google.com.py",
    "maps.google.com.uy",
    "maps.google.com.bo",
  ];

  const locations = await safeEval(
    page,
    (patterns) => {
      const found = [];
      const seenKeys = new Set();

      // Google attribution/system link texts that appear on embedded maps but are
      // not business location links worth tracking.
      const MAPS_SYSTEM_TEXT = /^(report\s*(a\s*)?(error|problem|an?\s*issue)|view\s*larger\s*map|open\s*(in\s*)?(google\s*)?maps|terms\s*of\s*use|map\s*data|©|privacy|keyboard\s*shortcuts?|satellite|terrain)\s*$/i;

      document.querySelectorAll("a[href]").forEach((a) => {
        const href = (a.getAttribute("href") || "").trim();
        if (!href.startsWith("http")) return;
        if (!patterns.some((p) => href.includes(p))) return;

        // Skip Google attribution / system links that appear alongside embedded maps
        const displayText = (a.textContent || "").replace(/\s+/g, " ").trim();
        if (MAPS_SYSTEM_TEXT.test(displayText)) return;

        // Also require the URL to contain a location identifier — a plain map view
        // URL with no place/dir/search/cid is not a useful business location link.
        const hasLocationId =
          href.includes("/maps/place/") ||
          href.includes("/maps/dir/") ||
          href.includes("/maps/search/") ||
          href.includes("place_id=") ||
          href.includes("cid=") ||
          /[?&]q=/.test(href) ||
          href.includes("g.page/");
        if (!hasLocationId) return;

        // Deduplicate by the URL without query fragments
        const key = href.split("#")[0];
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        // Try to extract a human-readable place name from the URL path
        // e.g. /maps/place/Eiffel+Tower/@48.8584...
        let locationName = "";
        const placeMatch = href.match(/\/maps\/place\/([^/@?&]+)/);
        if (placeMatch) {
          try {
            locationName = decodeURIComponent(placeMatch[1].replace(/\+/g, " "));
          } catch {}
        }

        // Also try /maps/search/ and /maps/dir/ URLs
        if (!locationName) {
          const searchMatch = href.match(/\/maps\/(search|dir)\/([^/@?&]+)/);
          if (searchMatch) {
            try {
              locationName = decodeURIComponent(searchMatch[2].replace(/\+/g, " "));
            } catch {}
          }
        }

        // Try g.page URLs
        if (!locationName && href.includes("g.page")) {
          const gpageMatch = href.match(/g\.page\/([^/?]+)/);
          if (gpageMatch) {
            locationName = gpageMatch[1].replace(/[-_]/g, " ");
          }
        }

        // Fall back to the link's visible text or aria-label
        if (!locationName) {
          locationName =
            (a.textContent || "").replace(/\s+/g, " ").trim() ||
            a.getAttribute("aria-label") ||
            a.getAttribute("title") ||
            "Google Maps location";
        }

        // Clean up location name
        locationName = locationName.replace(/\s+/g, " ").trim();
        if (locationName.length > 100) {
          locationName = locationName.substring(0, 97) + "...";
        }

        // Extract lat/lng coords if present (@lat,lng,zoom)
        let coords = null;
        const coordsMatch = href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordsMatch) coords = `${coordsMatch[1]},${coordsMatch[2]}`;

        // Detect place_id=ChIJ... or cid=... or q=... for a stable identifier
        let placeId = null;
        const placeIdMatch = href.match(/[?&]place_id=([^&]+)/);
        if (placeIdMatch) placeId = placeIdMatch[1];
        const cidMatch = href.match(/[?&]cid=([^&]+)/);
        if (cidMatch && !placeId) placeId = `cid:${cidMatch[1]}`;
        const queryIdMatch = href.match(/[?&]q=([^&]+)/);
        if (queryIdMatch && !placeId) placeId = `query:${decodeURIComponent(queryIdMatch[1])}`;

        found.push({
          href,
          location_name: locationName || "Google Maps location",
          coords,
          place_id: placeId,
          display_text: (a.textContent || "").replace(/\s+/g, " ").trim() || a.getAttribute("aria-label") || "",
          opens_new_tab: a.getAttribute("target") === "_blank",
        });
      });

      return found;
    },
    MAPS_PATTERNS,
  );

  if (locations) {
    locations.forEach((l) => (l.page_url = pageUrl));
  }

  return locations || [];
}

// ---------------------------------------------------------------------------
// Service page discovery — finds all service/treatment pages from the nav.
// ---------------------------------------------------------------------------

// Kept as a fallback for flat navs and sub-page expansion on already-visited pages.
const SERVICE_URL_PATTERN =
  /\/(services?|treatments?|therapies|therapists?|what-we-do|solutions|programs?|packages?|specialties|procedures|expertise|offerings|portfolio|our-service|physiotherapy|osteopathy|chiropractic|massage|acupuncture|nutrition|wellness|health|medical|clinic|practice|care|therapy|treatment|healing|rehab|rehabilitation|recovery|pain|injury|fitness|exercise|training|consultation|assessment|diagnosis|prescription|medicine|pharmacy|dental|dentistry|orthodontics|cosmetic|beauty|aesthetic|spa|wellbeing|holistic|alternative|complementary)(\/|$|\?|#)/i;

const SERVICE_TEXT_PATTERN =
  /^(services?|treatments?|therapies|therapy|what we do|solutions|programs?|packages?|specialties|our\s+work|offerings|how we help|expertise|our services?|our treatments?|our therapies?|physiotherapy|osteopathy|chiropractic|massage|acupuncture|nutrition|wellness|health|clinic|practice|care|healing|rehab|pain|injury|fitness|consultation|assessment|dental|cosmetic|beauty|spa|wellbeing|holistic|alternative|complementary)\s*$/i;

// Pages that should never be treated as service pages regardless of context.
const GENERIC_PAGE_PATTERN =
  /\/(about|about-us|our-story|our-people|the-team|our-team|meet-the-team|team|staff|people|blog|news|articles|press|media|resources|downloads|case-studies|gallery|events|calendar|careers|jobs|vacancies|work-for-us|privacy|privacy-policy|terms|terms-of-service|terms-conditions|cookie-policy|legal|disclaimer|sitemap|faq|faqs|help|support|login|sign-in|signup|register|account|basket|cart|checkout|search|404|error|home)(\/|$|\?|#)/i;

// Top-level nav section text that signals a non-service section.
const GENERIC_NAV_TEXT =
  /^(about|about us|our story|our people|the team|our team|meet the team|team|staff|people|blog|news|press|media|resources|case studies|gallery|events|careers|jobs|work for us|privacy|terms|legal|sitemap|faq|faqs|help|support|login|sign in|register|account|basket|cart|home|get in touch|contact us?)\s*$/i;

async function findServicePages(page, baseUrl) {
  let baseOrigin;
  try { baseOrigin = new URL(baseUrl).origin; } catch { return []; }

  // Parse the nav as a tree so we can identify sections with dropdown children.
  // Any non-generic nav section that has sub-menu items is treated as a service
  // section — its children are all included regardless of URL/text patterns.
  // Three strategies, tried in order:
  //   1. LI-based  — standard WordPress / Bootstrap / most themes
  //   2. Direct children of nav container  — Webflow, custom div navs
  //   3. Flat fallback  — flat nav with no hierarchy; falls back to pattern matching
  const navTree = await safeEval(page, () => {
    const cleanText = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const seen = new Set();
    const sections = [];

    const pushSection = (topAnchor, childAnchors) => {
      if (!topAnchor || !topAnchor.href || seen.has(topAnchor.href)) return;
      seen.add(topAnchor.href);
      sections.push({
        href: topAnchor.href,
        text: cleanText(topAnchor),
        children: childAnchors
          .filter(a => a !== topAnchor && a.href)
          .map(a => ({ href: a.href, text: cleanText(a) })),
      });
    };

    // Strategy 1: find top-level <li> elements under any nav/header <ul>
    const navUls = document.querySelectorAll(
      '[role="navigation"] > ul, nav > ul, header > ul, ' +
      '[role="navigation"] > div > ul, nav > div > ul, ' +
      'header > nav > ul, .menu > ul, .nav > ul, ' +
      '.navbar > ul, .navigation > ul, .main-navigation > ul, ' +
      '.primary-menu > ul, .site-navigation > ul'
    );
    navUls.forEach(ul => {
      ul.querySelectorAll(':scope > li').forEach(li => {
        const top = li.querySelector(':scope > a[href]');
        const children = Array.from(li.querySelectorAll('a[href]'));
        pushSection(top, children);
      });
    });

    if (sections.length >= 2) return { tree: sections };

    // Strategy 2: direct children of nav/header containers (Webflow, custom)
    const containers = [
      ...document.querySelectorAll('[role="navigation"]'),
      ...document.querySelectorAll('nav'),
      document.querySelector('header'),
    ].filter(Boolean);

    for (const container of containers) {
      Array.from(container.children).forEach(child => {
        // Skip children that are themselves containers (nested nav/ul/div wrapping everything)
        const tag = child.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'nav') return;
        const links = Array.from(child.querySelectorAll('a[href]'));
        if (links.length > 0) pushSection(links[0], links);
      });
      if (sections.length >= 2) break;
    }

    if (sections.length >= 2) return { tree: sections };

    // Strategy 3: flat fallback
    return {
      flat: Array.from(document.querySelectorAll(
        'nav a[href], header a[href], [role="navigation"] a[href]'
      )).map(a => ({ href: a.href, text: cleanText(a) })),
    };
  });

  if (!navTree) return [];

  const seen = new Set();
  const results = [];

  const tryAdd = (href) => {
    try {
      const u = new URL(href);
      if (u.origin !== baseOrigin) return;
      if (u.pathname === '/' || u.pathname === '') return;
      const canonical = u.origin + u.pathname.replace(/\/$/, '');
      if (seen.has(canonical)) return;
      if (GENERIC_PAGE_PATTERN.test(u.pathname)) return;
      seen.add(canonical);
      results.push(u.href);
    } catch { /* skip malformed */ }
  };

  if (navTree.tree) {
    for (const section of navTree.tree) {
      // Skip obviously non-service top-level sections
      if (GENERIC_NAV_TEXT.test(section.text)) continue;

      if (section.children.length > 0) {
        // This section has a dropdown — all its children are candidate pages.
        // Cap at 30 to guard against mega-menus with hundreds of links.
        tryAdd(section.href);
        section.children.slice(0, 30).forEach(c => tryAdd(c.href));
      } else {
        // No dropdown — only include if the URL/text matches known service patterns
        let pathname = '';
        try { pathname = new URL(section.href).pathname; } catch {}
        if (SERVICE_URL_PATTERN.test(pathname) || SERVICE_TEXT_PATTERN.test(section.text)) {
          tryAdd(section.href);
        }
      }
    }
  } else if (navTree.flat) {
    // Flat fallback: pattern matching only
    navTree.flat.forEach(link => {
      let pathname = '';
      try { pathname = new URL(link.href).pathname; } catch {}
      if (SERVICE_URL_PATTERN.test(pathname) || SERVICE_TEXT_PATTERN.test(link.text)) {
        tryAdd(link.href);
      }
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Service sub-page discovery — called when visiting a service LISTING page.
// Finds service-related pages linked from the listing. Looks for:
// 1. Direct child pages (e.g. /services/massage when visiting /services)
// 2. Any pages that match service patterns (e.g. /physiotherapy/, /massage/)
// ---------------------------------------------------------------------------
async function findServiceSubPages(page, currentUrl, baseOrigin, alreadySeen) {
  let currentPath;
  try {
    currentPath = new URL(currentUrl).pathname.replace(/\/$/, "");
  } catch {
    return [];
  }

  const links =
    (await safeEval(page, () =>
      Array.from(
        document.querySelectorAll(
          'main a[href], [class*="content"] a[href], [class*="services"] a[href], [class*="service"] a[href], [class*="treatment"] a[href], [class*="therapy"] a[href], article a[href], section a[href], .entry-content a[href], [class*="post"] a[href], [class*="cta"] a[href], [class*="button"] a[href], button a[href], [role="button"] a[href]',
        ),
      ).map((a) => ({
        href: a.href,
        text: (a.textContent || "").replace(/\s+/g, " ").trim(),
      })),
    )) || [];

  const subPages = [];
  const seen = new Set(alreadySeen);

  for (const link of links) {
    try {
      const u = new URL(link.href);
      if (u.origin !== baseOrigin) continue;
      const cleanPath = u.pathname.replace(/\/$/, "");
      const canonical = u.origin + cleanPath;
      if (seen.has(canonical)) continue;

      // Check for direct children first (original logic)
      let isServiceSubPage = false;
      if (cleanPath.startsWith(currentPath + "/")) {
        const remainder = cleanPath.slice(currentPath.length + 1);
        if (!remainder.includes("/")) {
          // not a grandchild
          isServiceSubPage = true;
        }
      }

      // Also check for any links that match service patterns
      if (!isServiceSubPage && (SERVICE_URL_PATTERN.test(cleanPath) || SERVICE_TEXT_PATTERN.test(link.text))) {
        isServiceSubPage = true;
      }

      if (isServiceSubPage) {
        seen.add(canonical);
        subPages.push(u.href);
      }
    } catch {
      /* skip malformed */
    }
  }

  return subPages;
}

// ---------------------------------------------------------------------------
// Form type detection — runs on the current page to identify iframe-embedded
// forms and multi-stage form wizards, used for the SayHello viability check.
// ---------------------------------------------------------------------------
async function detectPageFormFeatures(page) {
  return (
    (await safeEval(page, () => {
      // ── Multi-stage form indicators ──────────────────────────────────────────
      const MULTI_STAGE_SELECTORS = [
        '[class*="multi-step"]',
        '[class*="multistep"]',
        '[class*="form-step"]',
        '[class*="form-wizard"]',
        '[class*="wizard"]',
        '[class*="step-nav"]',
        '[class*="progress-step"]',
        '[class*="steps-container"]',
        "[data-step]",
        "[data-page]",
        "[data-form-step]",
        "[data-wizard]",
      ];
      const hasMultiStageClass = MULTI_STAGE_SELECTORS.some((sel) => !!document.querySelector(sel));

      // "Next" or "Back" buttons inside a form are a strong multi-stage signal
      const hasNextBack = Array.from(
        document.querySelectorAll('form button, form input[type="button"], form input[type="submit"]'),
      ).some((b) => /\b(next\s*step|back|previous|continue\s*to)\b/i.test(b.textContent || b.value || ""));

      const isMultiStage = hasMultiStageClass || hasNextBack;

      // ── Iframe form providers ────────────────────────────────────────────────
      const FORM_IFRAME_HOSTS = [
        "typeform.com",
        "jotform.com",
        "wufoo.com",
        "formstack.com",
        "paperform.co",
        "123formbuilder.com",
        "formsite.com",
        "hsforms.com",
        "hbspt",
        "forms.hubspot.com",
      ];
      const iframeProviders = [];
      document.querySelectorAll("iframe[src]").forEach((iframe) => {
        const src = (iframe.getAttribute("src") || "").toLowerCase();
        FORM_IFRAME_HOSTS.forEach((host) => {
          if (src.includes(host) && !iframeProviders.includes(host)) {
            iframeProviders.push(host);
          }
        });
      });

      return {
        is_multi_stage: isMultiStage,
        has_iframe_forms: iframeProviders.length > 0,
        iframe_providers: iframeProviders,
      };
    })) || { is_multi_stage: false, has_iframe_forms: false, iframe_providers: [] }
  );
}

// ---------------------------------------------------------------------------
// Geographic signals — scanned from the page for the SayHello viability check.
// ---------------------------------------------------------------------------
async function extractGeoSignals(page) {
  return (
    (await safeEval(page, () => {
      const text = (document.body ? document.body.innerText : "").substring(0, 12000);

      let hreflangUK = false;
      let hreflangNA = false;
      document.querySelectorAll("link[hreflang], [hreflang]").forEach((el) => {
        const lang = (el.getAttribute("hreflang") || "").toLowerCase();
        if (lang.includes("gb") || lang.includes("uk")) hreflangUK = true;
        if (lang.includes("us") || lang.includes("ca")) hreflangNA = true;
      });

      // Currency symbols
      const hasGBP = /£/.test(text);
      const hasUSD = /\$\d/.test(text);

      // UK postcode (rough: 1-2 letters + 1-2 digits + space + digit + 2 letters)
      const hasUKPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/.test(text);

      // Country/city mentions
      const ukMention =
        /\b(United Kingdom|England|Scotland|Wales|Northern Ireland|Great Britain|London|Manchester|Birmingham|Edinburgh|Dublin)\b/i.test(
          text,
        );
      const naMention =
        /\b(United States|USA|Canada|New York|Los Angeles|Chicago|Toronto|Vancouver|San Francisco)\b/i.test(text);

      return { hreflangUK, hreflangNA, hasGBP, hasUSD, hasUKPostcode, ukMention, naMention };
    })) || {}
  );
}

async function extractAboveFoldCTAs(page) {
  return (
    (await safeEval(page, () => {
      const viewportHeight = window.innerHeight;
      const results = { phone_links: [], email_links: [], whatsapp_links: [], cta_buttons: [] };

      // Fixed/sticky elements are always visible regardless of scroll position —
      // treat them as always-present CTAs even if their rect.top is near the bottom.
      const isFloating = (el) => {
        let node = el;
        while (node && node !== document.body) {
          const pos = window.getComputedStyle(node).position;
          if (pos === "fixed" || pos === "sticky") return true;
          node = node.parentElement;
        }
        return false;
      };

      const isVisibleInFold = (el) => {
        try {
          if (isFloating(el)) return true; // always on screen
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.top < viewportHeight && rect.width > 0 && rect.height > 0;
        } catch {
          return false;
        }
      };

      document.querySelectorAll('a[href^="tel:"]').forEach((a) => {
        if (isVisibleInFold(a))
          results.phone_links.push({
            text: a.textContent.replace(/\s+/g, " ").trim(),
            href: a.getAttribute("href"),
            is_floating: isFloating(a),
          });
      });

      document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
        if (isVisibleInFold(a))
          results.email_links.push({
            text: a.textContent.replace(/\s+/g, " ").trim(),
            href: a.getAttribute("href"),
            is_floating: isFloating(a),
          });
      });

      // WhatsApp — anchor hrefs AND non-anchor elements (div/button floating plugins)
      const waSeen = new Set();
      const pushWa = (el, href) => {
        if (waSeen.has(href)) return;
        waSeen.add(href);
        if (isVisibleInFold(el))
          results.whatsapp_links.push({
            text: (el.textContent || "").replace(/\s+/g, " ").trim() || el.getAttribute("aria-label") || "",
            href,
            is_floating: isFloating(el),
          });
      };
      document
        .querySelectorAll(
          'a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="api.whatsapp.com"], a[href*="whatsapp://"]',
        )
        .forEach((a) => pushWa(a, a.getAttribute("href") || ""));
      document
        .querySelectorAll(
          '[onclick*="wa.me"],[onclick*="whatsapp"],[data-href*="wa.me"],[data-href*="whatsapp"],' +
            '[data-url*="wa.me"],[data-url*="whatsapp"],[data-link*="wa.me"],[data-link*="whatsapp"]',
        )
        .forEach((el) => {
          if (el.tagName === "A") return;
          const src =
            el.getAttribute("onclick") ||
            el.getAttribute("data-href") ||
            el.getAttribute("data-url") ||
            el.getAttribute("data-link") ||
            "";
          const m = src.match(/https?:\/\/[^\s'")\]]+/);
          if (m) pushWa(el, m[0]);
        });

      const ctaPattern =
        /\b(book(\s*(now|online|appointment|session|call|a\s*class|a\s*consultation))?|schedule|reserve|get\s*started|enquire(\s*now)?|contact\s*us|call\s*(us|now)|get\s*a?\s*quote|free\s*consultation|request\s*(a?\s*(quote|call|callback)))\b/i;
      document.querySelectorAll("a[href], button").forEach((el) => {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        const href = el.getAttribute("href") || "";
        if (!ctaPattern.test(text)) return;
        if (href.startsWith("tel:") || href.startsWith("mailto:") || href.includes("wa.me")) return;
        if (isVisibleInFold(el))
          results.cta_buttons.push({
            text,
            href: href || null,
            tag: el.tagName.toLowerCase(),
            is_floating: isFloating(el),
          });
      });

      return results;
    })) || { phone_links: [], email_links: [], whatsapp_links: [], cta_buttons: [] }
  );
}

async function extractForms(page, pageUrl) {
  const forms = await safeEval(
    page,
    (pageUrl) => {
      const formData = [];
      const forms = document.querySelectorAll("form");

      forms.forEach((form, index) => {
        const fields = [];
        // Only count inputs that are typically considered "form fields" for contact/lead forms
        // Exclude radio buttons, checkboxes, file uploads, date/time pickers, etc.
        const inputs = form.querySelectorAll(
          "input[type='text'], input[type='email'], input[type='tel'], input[type='url'], input[type='password'], input:not([type]), textarea, select",
        );

        let hasEmailField = false;
        let hasPhoneField = false;
        let hasMessageField = false;
        let hasNameField = false;
        let score = 0;

        inputs.forEach((input) => {
          const type = input.type || "text";
          const name = input.name || input.id || "";
          const placeholder = input.placeholder || "";
          const label = input.getAttribute("aria-label") || input.getAttribute("data-label") || "";
          const required = input.hasAttribute("required") || input.getAttribute("aria-required") === "true";

          // Skip if input is not visible or is a system field
          const style = window.getComputedStyle(input);
          if (style.display === "none" || style.visibility === "hidden" || input.disabled) {
            return;
          }

          fields.push({ type, name, placeholder, label, required });

          // Improved scoring for lead forms - check name, placeholder, label, and aria-label
          const fieldText = (name + " " + placeholder + " " + label).toLowerCase();

          if (fieldText.includes("email") || type === "email") {
            hasEmailField = true;
            score += 3; // Email is a strong lead indicator
          }
          if (
            fieldText.includes("phone") ||
            fieldText.includes("tel") ||
            fieldText.includes("mobile") ||
            fieldText.includes("cell") ||
            type === "tel"
          ) {
            hasPhoneField = true;
            score += 2;
          }
          if (
            fieldText.includes("message") ||
            fieldText.includes("comment") ||
            fieldText.includes("enquiry") ||
            fieldText.includes("inquiry") ||
            fieldText.includes("notes") ||
            type === "textarea"
          ) {
            hasMessageField = true;
            score += 2;
          }
          if (
            fieldText.includes("name") ||
            fieldText.includes("first") ||
            fieldText.includes("last") ||
            fieldText.includes("full")
          ) {
            hasNameField = true;
            score += 1;
          }
          if (fieldText.includes("company") || fieldText.includes("business") || fieldText.includes("organization")) {
            score += 1;
          }
          if (fieldText.includes("website") || fieldText.includes("url")) {
            score += 1;
          }
        });

        // Only include forms that look like lead/contact forms (score >= 3)
        // This filters out search forms, login forms, etc.
        if (score >= 3 && fields.length > 0) {
          const submitButton = form.querySelector(
            'button[type="submit"], input[type="submit"], button:not([type]):not([type="button"]), [role="button"]',
          );
          const submitButtonText = submitButton
            ? (
                submitButton.textContent ||
                submitButton.value ||
                submitButton.getAttribute("aria-label") ||
                ""
              ).trim() || "Submit"
            : "Submit";

          // Check for third-party forms
          const formAction = form.action || "";
          const formClass = form.className || "";
          const formId = form.id || "";
          const thirdParty =
            /hubspot|typeform|gravity|jotform|mailchimp|convertkit|activecampaign|constantcontact/i.test(formAction) ||
            /hubspot|typeform|gravity|jotform|mailchimp|convertkit|activecampaign|constantcontact/i.test(formClass) ||
            /hubspot|typeform|gravity|jotform|mailchimp|convertkit|activecampaign|constantcontact/i.test(formId) ||
            !!form.querySelector(
              '[class*="hubspot"], [class*="typeform"], [class*="gravity"], [class*="jotform"], [class*="mailchimp"], [class*="convertkit"]',
            );

          const fieldCount = fields.length;
          const requiredCount = fields.filter((f) => f.required).length;

          const rect = form.getBoundingClientRect();
          const scrollY = window.scrollY || window.pageYOffset || 0;
          const positionPx = Math.round(rect.top + scrollY);
          const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1);
          const positionPercent = Math.round((positionPx / totalHeight) * 100);
          const positionLabel = positionPercent <= 30 ? "above_fold" : positionPercent <= 70 ? "mid_page" : "below_fold";

          // ── Static submission detection (no form submit needed) ──────────
          // Detect success behaviour from HTML alone before we ever submit.
          // Reliable for CF7, Gravity Forms, WPForms, Elementor, etc.
          let staticSubmissionHint = null;

          // 1. Form action URL contains thank/success → redirect form
          const actionUrl = (form.getAttribute("action") || "").toLowerCase();
          if (actionUrl && !/^javascript:|^#/.test(actionUrl) && /thank|success|confirm|complete|sent/.test(actionUrl)) {
            staticSubmissionHint = {
              type: "redirect",
              thank_you_url: form.getAttribute("action"),
              confidence: "high",
              detected_by: "form_action",
            };
          }

          // 2. Plugin-specific hidden confirmation elements already in the DOM
          if (!staticSubmissionHint) {
            const PLUGIN_PATTERNS = [
              { sel: ".wpcf7-response-output",                 plugin: "Contact Form 7" },
              { sel: ".wpcf7-mail-sent-ok",                    plugin: "Contact Form 7" },
              { sel: '[class*="gform_confirmation_message"]',   plugin: "Gravity Forms" },
              { sel: ".wpforms-confirmation",                   plugin: "WPForms" },
              { sel: '[class*="wpforms-confirmation"]',         plugin: "WPForms" },
              { sel: ".elementor-message-success",              plugin: "Elementor Forms" },
              { sel: '[class*="elementor-message"]',            plugin: "Elementor Forms" },
              { sel: ".nf-response-msg",                        plugin: "Ninja Forms" },
              { sel: ".forminator-response-message",            plugin: "Forminator" },
              { sel: '[class*="frm_message"]',                  plugin: "Formidable Forms" },
              { sel: ".mc4wp-success",                          plugin: "MC4WP" },
              { sel: '[class*="fluentform"] .success-message',  plugin: "Fluent Forms" },
              { sel: ".ff-message-success",                     plugin: "Fluent Forms" },
              { sel: '[class*="hs-form"] .submitted-message',   plugin: "HubSpot Forms" },
            ];
            const searchRoot = form.closest('[class*="wpcf7"],[class*="gform"],[class*="wpforms"],[class*="elementor-form"]') || form.parentElement || document.body;
            for (const { sel, plugin } of PLUGIN_PATTERNS) {
              const el = searchRoot.querySelector(sel) || document.querySelector(sel);
              if (el) {
                const specificSel = el.id ? `#${el.id}` : sel;
                staticSubmissionHint = {
                  type: "inline_message",
                  selector: specificSel,
                  element_id: el.id || null,
                  element_class: el.className || null,
                  plugin,
                  confidence: "high",
                  detected_by: "static_plugin_pattern",
                };
                break;
              }
            }
          }

          // 3. Hidden input with a redirect URL value
          if (!staticSubmissionHint) {
            const redir = form.querySelector(
              'input[type="hidden"][name*="redirect"], input[type="hidden"][name*="thankyou"], input[type="hidden"][name*="thank_you"]',
            );
            if (redir && redir.value && /https?:\/\/|^\//.test(redir.value)) {
              staticSubmissionHint = {
                type: "redirect",
                thank_you_url: redir.value,
                confidence: "medium",
                detected_by: "hidden_redirect_input",
              };
            }
          }

          // 4. Adjacent sibling or parent container with success-like class/id that is hidden
          if (!staticSubmissionHint) {
            const ADJACENT_PATTERN = /success|thank|confirm|sent|complete|submitted/i;
            const candidates = [
              ...(form.parentElement ? Array.from(form.parentElement.children) : []),
              form.nextElementSibling,
              form.previousElementSibling,
            ].filter(Boolean);
            for (const el of candidates) {
              if (el === form) continue;
              if (ADJACENT_PATTERN.test(el.className + " " + (el.id || ""))) {
                const cs = window.getComputedStyle(el);
                const isHidden = cs.display === "none" || cs.visibility === "hidden" || el.hasAttribute("hidden");
                if (isHidden) {
                  const specificSel = el.id ? `#${el.id}` : "." + Array.from(el.classList).slice(0, 3).join(".");
                  staticSubmissionHint = {
                    type: "inline_message",
                    selector: specificSel,
                    element_id: el.id || null,
                    element_class: el.className || null,
                    confidence: "medium",
                    detected_by: "adjacent_hidden_element",
                  };
                  break;
                }
              }
            }
          }

          // ── Form plugin detection ────────────────────────────────────────────
          // Check the form element and its ancestors for plugin-specific
          // class/id/attribute fingerprints. The detected plugin key maps to the
          // Custom HTML listener script generated in gtm-container-generator.js.
          let form_plugin = null;
          let form_plugin_meta = {};

          const formClasses = (form.className || "").toLowerCase();
          const parentClasses = (form.parentElement ? (form.parentElement.className || "") : "").toLowerCase();
          const grandParentClasses = (form.parentElement && form.parentElement.parentElement
            ? (form.parentElement.parentElement.className || "")
            : "").toLowerCase();
          const allClasses = formClasses + " " + parentClasses + " " + grandParentClasses;
          const wrapperId = (form.closest('[class*="wpcf7"],[class*="gform_wrapper"],[class*="wpforms-container"],[class*="elementor-widget-form"],[class*="hs_form_target"]') || {}).id || "";

          if (/wpcf7/.test(allClasses) || /wpcf7/.test(formId)) {
            form_plugin = "cf7";
          } else if (/et[-_]pb[-_]contact/.test(allClasses) || /et_pb_contactform/.test(formId)) {
            form_plugin = "divi";
          } else if (/gform/.test(formId) || /gform_wrapper/.test(allClasses)) {
            form_plugin = "gravityforms";
            // Extract numeric form ID (gform_1, gform_wrapper_1, etc.)
            const gfMatch = (formId + " " + allClasses).match(/gform[_-](?:wrapper[_-])?(\d+)/);
            if (gfMatch) form_plugin_meta.form_id = gfMatch[1];
          } else if (/elementor-form/.test(formClasses) || /elementor-widget-form/.test(allClasses)) {
            form_plugin = "elementor";
          } else if (/wpforms-form/.test(formId) || /wpforms-form/.test(formClasses)) {
            form_plugin = "wpforms";
            // Extract numeric form ID (wpforms-form-41, wpforms-form-123, etc.)
            const wpfMatch = (formId + " " + formClasses).match(/wpforms-form-(\d+)/);
            if (wpfMatch) form_plugin_meta.form_id = wpfMatch[1];
          } else if (/\bhs-form\b|\bhsForm/.test(allClasses) || /hs-form/.test(formId)) {
            form_plugin = "hubspot";
          } else if (/wsf-form/.test(formClasses)) {
            form_plugin = "wsforms";
            form_plugin_meta.form_id = form.getAttribute("data-id") || null;
          } else if (/react-form-contents/.test(formClasses)) {
            form_plugin = "squarespace";
          } else if (/metform-form-content/.test(formClasses)) {
            form_plugin = "metform";
            // Try to extract MetForm endpoint ID from action or data attributes
            const metMatch = (form.action || "").match(/\/entries\/insert\/(\d+)/);
            if (metMatch) form_plugin_meta.form_id = metMatch[1];
          } else if (/fluentform|ff-form/.test(allClasses)) {
            form_plugin = "fluentforms";
          } else if (/nf-form/.test(formId) || /nf-form-content/.test(formClasses)) {
            form_plugin = "ninjaforms";
          } else if (/forminator/.test(formId) || /forminator/.test(formClasses)) {
            form_plugin = "forminator";
          }

          formData.push({
            page_url: pageUrl,
            form_index: index,
            fields,
            field_count: fieldCount,
            required_field_count: requiredCount,
            friction_level: fieldCount <= 2 ? "low" : fieldCount <= 4 ? "medium" : "high",
            submit_button_text: submitButtonText,
            has_email_field: hasEmailField,
            has_phone_field: hasPhoneField,
            has_message_field: hasMessageField,
            has_name_field: hasNameField,
            third_party: thirdParty,
            position_px: positionPx,
            position_percent: positionPercent,
            position_label: positionLabel,
            score,
            static_submission_hint: staticSubmissionHint,
            form_plugin,
            form_plugin_meta,
          });
        }
      });

      return formData;
    },
    pageUrl,
  );

  // Resolve submission behaviour — use static hint when confident, submit otherwise
  if (forms && forms.length > 0) {
    for (const formData of forms.slice(0, 2)) {
      const hint = formData.static_submission_hint;

      if (hint && hint.confidence === "high") {
        // Static analysis already gave us a reliable answer — no submission needed
        formData.submission_behaviour = hint;
        if (hint.type === "redirect") {
          formData.gtm_recommendation = `Thank You URL detected: ${hint.thank_you_url} — GA4 Event: Page View trigger with URL contains "${hint.thank_you_url}"`;
        } else {
          formData.gtm_recommendation = `Success element detected${hint.plugin ? ` (${hint.plugin})` : ""}: "${hint.selector}" — GA4 Event: Element Visibility trigger on this selector`;
        }
      } else {
        // Fall back to live submission test (also seeds from medium-confidence hint if found)
        try {
          await testFormSubmission(page, formData);
        } catch (e) {
          // If live test fails but we have a medium-confidence static hint, use that
          if (hint) {
            formData.submission_behaviour = { ...hint, fallback: true };
            formData.gtm_recommendation = hint.type === "redirect"
              ? `Thank You URL (static detection): ${hint.thank_you_url}`
              : `Success element (static detection): "${hint.selector}" — GA4 Event: Element Visibility trigger`;
          } else {
            formData.submission_behaviour = { type: "unknown", error: e.message };
            formData.gtm_recommendation = "Form submission test failed — manual GTM setup required";
          }
        }
      }
    }
  }

  return forms || [];
}

// Build the most specific usable CSS selector for an element returned from page.evaluate.
// Priority: #id > meaningful class combo > [role] > [data-*] > full class list > tag
function buildSpecificSelector(id, classList, role, dataAttrs, tag) {
  if (id) return `#${id}`;
  const meaningful = (classList || []).filter((c) =>
    /success|thank|confirm|sent|submit|complete|response|message|alert|notification|error|wpcf7|gform|wpforms|forminator|ninja|elementor/i.test(c),
  );
  if (meaningful.length) return "." + meaningful.join(".");
  if (role) return `[role="${role}"]`;
  for (const [attr, val] of Object.entries(dataAttrs || {})) {
    if (val) return `[${attr}="${val}"]`;
  }
  if ((classList || []).length) return "." + classList.slice(0, 3).join(".");
  return tag || "div";
}

async function testFormSubmission(page, formData) {
  const form = await page.locator("form").nth(formData.form_index);

  // ── Fill fields ───────────────────────────────────────────────────────────
  for (const field of formData.fields) {
    try {
      const selector = field.name
        ? `[name="${field.name}"]`
        : `input:nth-child(${formData.fields.indexOf(field) + 1})`;
      const element = form.locator(selector).first();
      if (await element.isVisible({ timeout: 1000 })) {
        const fieldText = (field.name + " " + field.placeholder).toLowerCase();
        if (fieldText.includes("email"))                                         await element.fill(TEST_VALUES.email);
        else if (fieldText.includes("phone") || fieldText.includes("tel"))       await element.fill(TEST_VALUES.phone);
        else if (fieldText.includes("message") || fieldText.includes("comment") || fieldText.includes("enquiry")) await element.fill(TEST_VALUES.message);
        else if (fieldText.includes("first") && fieldText.includes("name"))      await element.fill(TEST_VALUES.firstName);
        else if (fieldText.includes("last") && fieldText.includes("name"))       await element.fill(TEST_VALUES.lastName);
        else if (fieldText.includes("name"))                                     await element.fill(TEST_VALUES.fullName);
        else if (fieldText.includes("company") || fieldText.includes("business")) await element.fill(TEST_VALUES.company);
        else if (fieldText.includes("postcode") || fieldText.includes("zip"))    await element.fill(TEST_VALUES.postcode);
        else if (field.type === "select-one") { /* leave selects at default */ }
        else if (field.type === "text" || field.type === "email")                await element.fill("Test");
      }
    } catch (_) { /* continue */ }
  }

  // ── Snapshot hidden success-like elements & start MutationObserver ─────────
  await page.evaluate(() => {
    window.__apFormResult = null;

    // Record elements that look like success containers but are currently hidden
    const PATTERN = /success|thank|confirm|sent|complete|response|submitted|wpcf7-response|gform_confirmation|wpforms-confirmation|elementor-message/i;
    window.__apHiddenCandidates = Array.from(document.querySelectorAll("*")).filter((el) => {
      if (!PATTERN.test(el.className + " " + (el.id || ""))) return false;
      const cs = window.getComputedStyle(el);
      return cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0" || el.hasAttribute("hidden");
    });

    // Observe new nodes added to the DOM
    window.__apAddedNodes = [];
    window.__apObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.textContent?.trim().length > 3) {
            window.__apAddedNodes.push(node);
          }
        }
        // Also watch for attribute changes that might reveal hidden elements
        if (m.type === "attributes" && m.target.nodeType === 1) {
          window.__apAddedNodes.push(m.target);
        }
      }
    });
    window.__apObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden"],
    });
  });

  const currentUrl = page.url();

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submitButton = form
    .locator('button[type="submit"], input[type="submit"], button:not([type]):not([type="button"]), [role="button"]')
    .first();
  await submitButton.click();
  await page.waitForTimeout(3000);

  // ── Redirect ──────────────────────────────────────────────────────────────
  const newUrl = page.url();
  if (newUrl !== currentUrl) {
    formData.submission_behaviour = { type: "redirect", thank_you_url: newUrl };
    formData.gtm_recommendation = `Thank You URL detected: ${newUrl} — GA4 Event: Page View trigger with URL contains "${newUrl}"`;
    return;
  }

  // ── URL fragment ──────────────────────────────────────────────────────────
  const fragment = newUrl.split("#")[1];
  if (fragment && /success|thank|sent|complete/i.test(fragment)) {
    formData.submission_behaviour = { type: "url_fragment", fragment };
    formData.gtm_recommendation = `Success URL fragment: #${fragment} — GA4 Event: Page View trigger with URL fragment condition`;
    return;
  }

  // ── Check mutation observer results — newly added/revealed elements ────────
  const mutationHit = await page.evaluate(() => {
    if (window.__apObserver) window.__apObserver.disconnect();

    const PATTERN = /success|thank|confirm|sent|complete|response|submitted|wpcf7|gform|wpforms|elementor-message/i;
    const isVisible = (el) => {
      if (!el || el.nodeType !== 1) return false;
      const cs = window.getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0 && el.offsetParent !== null;
    };
    const buildInfo = (el) => ({
      id:        el.id || null,
      classList: Array.from(el.classList),
      role:      el.getAttribute("role"),
      dataAttrs: {
        "data-status": el.getAttribute("data-status"),
        "data-type":   el.getAttribute("data-type"),
      },
      tag:  el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, 300),
    });

    // 1. Previously hidden candidates that are now visible
    for (const el of window.__apHiddenCandidates || []) {
      if (isVisible(el) && el.textContent?.trim().length > 3) return buildInfo(el);
    }

    // 2. Newly added nodes that match success pattern and are visible
    for (const el of window.__apAddedNodes || []) {
      if (!isVisible(el)) continue;
      if (PATTERN.test(el.className + " " + (el.id || "")) && el.textContent?.trim().length > 3) return buildInfo(el);
    }

    // 3. Any newly added node that is visible and has meaningful text (less strict)
    for (const el of window.__apAddedNodes || []) {
      if (isVisible(el) && el.textContent?.trim().length > 10) return buildInfo(el);
    }

    return null;
  });

  if (mutationHit) {
    const selector = buildSpecificSelector(
      mutationHit.id,
      mutationHit.classList,
      mutationHit.role,
      mutationHit.dataAttrs,
      mutationHit.tag,
    );
    formData.submission_behaviour = {
      type:          "inline_message",
      selector,
      message_text:  mutationHit.text,
      element_id:    mutationHit.id,
      element_class: mutationHit.classList.join(" ") || null,
      detected_by:   "mutation_observer",
    };
    formData.gtm_recommendation = `Success element detected: "${selector}" — GA4 Event: Element Visibility trigger on this selector`;
    return;
  }

  // ── Fallback: scan SUCCESS_SELECTORS list ─────────────────────────────────
  for (const genericSelector of SUCCESS_SELECTORS) {
    try {
      const el = page.locator(genericSelector).first();
      if (await el.isVisible({ timeout: 1500 })) {
        // Generate the most specific selector for the actual element found
        const info = await el.evaluate((node) => ({
          id:        node.id || null,
          classList: Array.from(node.classList),
          role:      node.getAttribute("role"),
          dataAttrs: {
            "data-status": node.getAttribute("data-status"),
            "data-type":   node.getAttribute("data-type"),
          },
          tag:  node.tagName.toLowerCase(),
          text: (node.textContent || "").trim().slice(0, 300),
        }));
        const specificSelector = buildSpecificSelector(
          info.id, info.classList, info.role, info.dataAttrs, info.tag,
        );
        formData.submission_behaviour = {
          type:          "inline_message",
          selector:      specificSelector,
          fallback_selector: genericSelector,
          message_text:  info.text,
          element_id:    info.id,
          element_class: info.classList.join(" ") || null,
          detected_by:   "selector_scan",
        };
        formData.gtm_recommendation = `Success element detected: "${specificSelector}" — GA4 Event: Element Visibility trigger on this selector`;
        return;
      }
    } catch (_) { /* try next */ }
  }

  // ── No success indicator found ────────────────────────────────────────────
  formData.submission_behaviour = { type: "unknown" };
  formData.gtm_recommendation = "No clear success indicator detected — manual GTM setup required";
}

async function extractNewsletter(page, pageUrl) {
  const newsletters = await safeEval(
    page,
    (pageUrl) => {
      const newsletterForms = [];
      const forms = document.querySelectorAll("form");

      forms.forEach((form, index) => {
        const inputs = form.querySelectorAll("input");
        let hasEmailField = false;
        let hasPhoneField = false;
        let hasMessageField = false;

        inputs.forEach((input) => {
          const fieldText = ((input.name || "") + (input.placeholder || "")).toLowerCase();
          if (fieldText.includes("email")) hasEmailField = true;
          if (fieldText.includes("phone") || fieldText.includes("tel")) hasPhoneField = true;
          if (fieldText.includes("message") || fieldText.includes("comment")) hasMessageField = true;
        });

        // Newsletter forms have email but no phone/message fields
        if (hasEmailField && !hasPhoneField && !hasMessageField) {
          const submitButton = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
          const submitButtonText = submitButton
            ? submitButton.textContent.trim() || submitButton.value || "Subscribe"
            : "Subscribe";

          const formAction = form.action || "";
          let platform = "Unknown";

          const platforms = {
            "mailchimp.com": "Mailchimp",
            "klaviyo.com": "Klaviyo",
            "constantcontact.com": "Constant Contact",
            "convertkit.com": "ConvertKit",
            "activecampaign.com": "ActiveCampaign",
            "mailerlite.com": "MailerLite",
            "brevo.com": "Brevo",
            "getresponse.com": "GetResponse",
            "hubspot.com": "HubSpot",
          };

          for (const [domain, platformName] of Object.entries(platforms)) {
            if (formAction.includes(domain)) {
              platform = platformName;
              break;
            }
          }

          newsletterForms.push({
            page_url: pageUrl,
            form_index: index,
            platform,
            form_action: formAction,
            submit_button_text: submitButtonText,
          });
        }
      });

      return newsletterForms;
    },
    pageUrl,
  );

  return newsletters || [];
}

async function extractLiveChat(page) {
  const liveChat = await safeEval(page, () => {
    const detectors = [
      { name: "Intercom", global: "Intercom" },
      { name: "Drift", global: "drift" },
      { name: "Crisp", global: "$crisp" },
      { name: "Tidio", global: "tidioChatApi" },
      { name: "LiveChat", global: "LC_API" },
      { name: "Zendesk", global: "zE" },
      { name: "HubSpot Chat", global: "HubSpotConversations" },
      { name: "Tawk.to", global: "Tawk_API" },
      { name: "Facebook Pixel", global: "fbq" },
      { name: "TikTok Pixel", global: "ttq" },
    ];

    const found = [];
    detectors.forEach((detector) => {
      if (window[detector.global]) {
        found.push(detector);
      }
    });

    return found;
  });

  return liveChat || [];
}

async function generateGTMSummary(pageData) {
  const tagsToCreate = [];
  const fixesNeeded = [];
  const warnings = [];

  let totalClickablePhones = 0;
  let totalPlainTextPhones = 0;
  let totalClickableEmails = 0;
  let totalPlainTextEmails = 0;
  let totalWhatsAppLinks = 0;
  let totalBookingLinks = 0;
  let totalForms = 0;
  let totalNewsletterForms = 0;
  const socialPlatformsSeen = new Set();

  // Collect unique numbers across pages before summing
  const _uniqueClickableNums = new Set(pageData.flatMap((p) => p.phones.clickable.map((ph) => ph.number)));
  const _uniquePlainTextNums = new Set(pageData.flatMap((p) => p.phones.plainText.map((ph) => ph.digits)));
  _uniqueClickableNums.forEach((n) => _uniquePlainTextNums.delete(n));
  totalClickablePhones = _uniqueClickableNums.size;
  totalPlainTextPhones = _uniquePlainTextNums.size;

  pageData.forEach((page) => {
    totalClickableEmails += page.emails.clickable.length;
    totalPlainTextEmails += page.emails.plainText.length;
    totalWhatsAppLinks += page.whatsapp.links.length;
    totalBookingLinks += page.booking_links.length;
    totalForms += page.forms.length;
    totalNewsletterForms += page.newsletter.length;
    (page.social_links || []).forEach((s) => socialPlatformsSeen.add(s.platform));
  });

  // Deduplicated Google Maps locations across all pages (by href)
  const locationMap = new Map();
  pageData.forEach((page) => {
    (page.location_links || []).forEach((loc) => {
      if (!locationMap.has(loc.href)) locationMap.set(loc.href, loc);
    });
  });
  const uniqueLocations = [...locationMap.values()];

  // Phone tracking
  if (totalClickablePhones > 0) {
    tagsToCreate.push(`GA4 Event: click_call | Trigger: Click - Just Links | Filter: Click URL contains "tel:"`);
  }
  if (totalPlainTextPhones > 0) {
    fixesNeeded.push(
      `${totalPlainTextPhones} phone number(s) are plain text. Wrap in <a href="tel:..."> to make them clickable and trackable.`,
    );
  }

  // Email tracking
  if (totalClickableEmails > 0) {
    tagsToCreate.push(`GA4 Event: click_email | Trigger: Click - Just Links | Filter: Click URL contains "mailto:"`);
  }
  if (totalPlainTextEmails > 0) {
    fixesNeeded.push(
      `${totalPlainTextEmails} email address(es) are plain text. Wrap in <a href="mailto:..."> to make them trackable.`,
    );
  }

  // WhatsApp tracking
  if (totalWhatsAppLinks > 0) {
    tagsToCreate.push(
      `GA4 Event: click_whatsapp | Trigger: Click - Just Links | Filter: Click URL contains "wa.me" or "whatsapp.com"`,
    );
  }

  // Booking links tracking
  if (totalBookingLinks > 0) {
    const platforms = [...new Set(pageData.flatMap((p) => p.booking_links.map((b) => b.domain)))];
    platforms.forEach((platform) => {
      tagsToCreate.push(
        `GA4 Event: click_booking_${platform.replace(".", "_")} | Trigger: Click - Just Links | Filter: Click URL contains "${platform}"`,
      );
    });
  }

  // Form tracking
  if (totalForms > 0) {
    tagsToCreate.push(`GA4 Event: form_submit_contact | Trigger: Form Submission on contact forms`);
  }

  // High-friction form abandonment tracking
  const highFrictionForms = pageData.flatMap((p) => (p.forms || []).filter((f) => f.friction_level === "high"));
  if (highFrictionForms.length > 0) {
    tagsToCreate.push(
      `GA4 Event: form_view | Trigger: Element Visibility — form 50% in viewport (fires when user first sees high-friction form)`,
    );
    tagsToCreate.push(
      `GA4 Event: form_submit_hi_friction | Trigger: Form Submission on high-friction forms (${highFrictionForms.length} form(s) with 5+ fields) — compare with form_view to measure abandonment rate`,
    );
  }

  // Newsletter tracking
  if (totalNewsletterForms > 0) {
    tagsToCreate.push(`GA4 Event: form_submit_newsletter | Trigger: Form Submission on newsletter forms`);
  }

  // Booking CTA tracking
  const allBookingCTAs = pageData.flatMap((p) => p.booking_ctas || []);
  if (allBookingCTAs.length > 0) {
    const platformCTAs = allBookingCTAs.filter((c) => c.destination_type === "booking_platform");
    const nonPlatformCTAs = allBookingCTAs.filter(
      (c) => c.destination_type !== "booking_platform" && c.destination_type !== "error",
    );
    const platformNames = [...new Set(platformCTAs.map((c) => c.platform).filter(Boolean))];
    platformNames.forEach((p) => {
      tagsToCreate.push(
        `GA4 Event: click_booking_cta | Destination: ${p} | Trigger: Click - Just Links on "${p}" CTA buttons`,
      );
    });
    if (nonPlatformCTAs.length > 0) {
      tagsToCreate.push(
        `GA4 Event: click_book_cta | Trigger: Click - Just Links on booking CTA buttons (see booking_ctas in audit for per-link GTM details)`,
      );
    }
  }

  // Social link tracking
  if (socialPlatformsSeen.size > 0) {
    [...socialPlatformsSeen].forEach((platform) => {
      tagsToCreate.push(
        `GA4 Event: click_social_${platform.toLowerCase().replace(/[^a-z0-9]/g, "_")} | Trigger: Click - Just Links | Filter: Click URL contains "${platform}"`,
      );
    });
  }

  // Google Maps location tracking - one trigger and tag per unique location
  if (uniqueLocations.length > 0) {
    uniqueLocations.forEach((loc) => {
      const safeName = loc.location_name
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .toLowerCase();
      tagsToCreate.push(
        `GA4 Event: click_location_${safeName} | Trigger: Click - Just Links | Filter: Click URL contains "${loc.href}" | Location: "${loc.location_name}"`,
      );
    });
  }

  // Live chat warnings
  const liveChatServices = pageData[0]?.live_chat || [];
  liveChatServices.forEach((service) => {
    if (["Intercom", "Drift", "HubSpot Chat"].includes(service.name)) {
      warnings.push(
        `${service.name} live chat detected. This platform includes its own analytics so additional GA4 event tracking is not required.`,
      );
    }
  });

  return {
    tags_to_create: tagsToCreate,
    fixes_needed: fixesNeeded,
    warnings,
    location_links: uniqueLocations,
  };
}

function generateCTAQualityReport(pagesData) {
  const issues = [];
  const strengths = [];
  const recommendations = [];

  // --- Phone accessibility ---
  // Deduplicate by normalised digit string across all pages — the same number
  // in the header/footer of every crawled page should count as one, not many.
  const uniqueClickableNumbers = new Set(pagesData.flatMap((p) => p.phones.clickable.map((ph) => ph.number)));
  const uniquePlainTextDigits = new Set(pagesData.flatMap((p) => p.phones.plainText.map((ph) => ph.digits)));
  // Don't double-count a plain-text instance of a number that's also clickable
  uniqueClickableNumbers.forEach((n) => uniquePlainTextDigits.delete(n));

  const totalClickablePhones = uniqueClickableNumbers.size;
  const totalPlainTextPhones = uniquePlainTextDigits.size;
  const phonesAboveFold = pagesData.some((p) => (p.above_fold_ctas?.phone_links?.length ?? 0) > 0);

  // Identify which clickable phone numbers are also the WhatsApp number
  // (same subscriber digits) — these are dual-purpose CTAs, not separate contacts.
  const waPhoneCoresAll = new Set(
    pagesData.flatMap((p) => (p.whatsapp?.links || []).map((w) => normalisePhoneCore(w.number || "")).filter(Boolean)),
  );
  const sharedPhoneNumbers = [...uniqueClickableNumbers].filter((n) => waPhoneCoresAll.has(normalisePhoneCore(n)));
  const independentClickable = totalClickablePhones - sharedPhoneNumbers.length;

  let phoneVerdict = "none";
  if (totalClickablePhones > 0 && totalPlainTextPhones === 0) {
    phoneVerdict = "good";
    strengths.push("All phone numbers are clickable. They are trackable in GA4 and tappable on mobile.");
    if (sharedPhoneNumbers.length > 0) {
      strengths.push(
        `${sharedPhoneNumbers.length} phone number(s) double as a WhatsApp contact. These are dual-purpose CTAs.`,
      );
    }
  } else if (totalClickablePhones > 0 && totalPlainTextPhones > 0) {
    phoneVerdict = "partial";
    issues.push(
      `${totalPlainTextPhones} phone number(s) are displayed as plain text alongside ${totalClickablePhones} clickable number(s). Plain-text numbers cannot be tracked or tapped on mobile.`,
    );
    recommendations.push('Wrap remaining plain-text phone numbers in <a href="tel:..."> tags.');
    if (sharedPhoneNumbers.length > 0) {
      strengths.push(
        `${sharedPhoneNumbers.length} phone number(s) double as a WhatsApp contact. These are dual-purpose CTAs.`,
      );
    }
  } else if (totalPlainTextPhones > 0) {
    phoneVerdict = "poor";
    issues.push(
      `${totalPlainTextPhones} phone number(s) are plain text. They cannot be clicked on mobile and cannot be tracked in GA4.`,
    );
    recommendations.push('Wrap all phone numbers in <a href="tel:..."> tags.');
  }

  if (phonesAboveFold) {
    strengths.push("A phone number is visible above the fold. Visitors can see it without scrolling.");
  } else if (totalClickablePhones > 0 || totalPlainTextPhones > 0) {
    issues.push("No phone number is visible above the fold. Visitors must scroll down to find contact details.");
    recommendations.push(
      "Move the phone number to the header or hero section so it is immediately visible on arrival.",
    );
  }

  // --- Email accessibility ---
  const totalClickableEmails = pagesData.reduce((n, p) => n + p.emails.clickable.length, 0);
  const totalPlainTextEmails = pagesData.reduce((n, p) => n + p.emails.plainText.length, 0);

  let emailVerdict = "none";
  if (totalClickableEmails > 0 && totalPlainTextEmails === 0) {
    emailVerdict = "good";
    strengths.push("All email addresses are clickable mailto: links. They are trackable in GA4.");
  } else if (totalClickableEmails > 0 && totalPlainTextEmails > 0) {
    emailVerdict = "partial";
    issues.push(
      `${totalPlainTextEmails} email address(es) are displayed as plain text alongside clickable ones. Plain-text emails cannot be tracked.`,
    );
    recommendations.push('Wrap plain-text email addresses in <a href="mailto:..."> tags.');
  } else if (totalPlainTextEmails > 0) {
    emailVerdict = "poor";
    issues.push(
      `${totalPlainTextEmails} email address(es) are plain text. They are not clickable or trackable in GA4.`,
    );
    recommendations.push('Wrap all email addresses in <a href="mailto:..."> tags.');
  }

  // --- Above the fold ---
  // Build a deduplicated per-page breakdown. CTA buttons are deduplicated by
  // href+text within each page to collapse floating/sticky nav duplicates.
  const aboveFoldByPage = pagesData.map((p) => {
    const af = p.above_fold_ctas || { phone_links: [], email_links: [], whatsapp_links: [], cta_buttons: [] };

    const seenBtns = new Set();
    const uniqueCtaButtons = (af.cta_buttons || []).filter((b) => {
      const key = `${b.href}|${b.text}`;
      if (seenBtns.has(key)) return false;
      seenBtns.add(key);
      return true;
    });

    const seenPhones = new Set();
    const uniquePhoneLinks = (af.phone_links || []).filter((ph) => {
      const key = ph.href;
      if (seenPhones.has(key)) return false;
      seenPhones.add(key);
      return true;
    });

    const seenWa = new Set();
    const uniqueWaLinks = (af.whatsapp_links || []).filter((w) => {
      const key = w.href;
      if (seenWa.has(key)) return false;
      seenWa.add(key);
      return true;
    });

    return {
      page: p.url,
      label: p.label,
      has_phone: uniquePhoneLinks.length > 0,
      has_email: (af.email_links || []).length > 0,
      has_whatsapp: uniqueWaLinks.length > 0,
      has_cta_button: uniqueCtaButtons.length > 0,
      phone_links: uniquePhoneLinks,
      email_links: af.email_links || [],
      whatsapp_links: uniqueWaLinks,
      cta_buttons: uniqueCtaButtons,
    };
  });

  // Homepage-level count used for scoring and issue messages
  const homepageFold = aboveFoldByPage.find((p) => p.label === "homepage");
  const aboveFoldCount = homepageFold
    ? homepageFold.phone_links.length +
      homepageFold.email_links.length +
      homepageFold.whatsapp_links.length +
      homepageFold.cta_buttons.length
    : 0;

  if (aboveFoldCount > 0) {
    strengths.push(
      `${aboveFoldCount} CTA(s) are visible above the fold on the homepage. Visitors see them without scrolling.`,
    );
  } else {
    issues.push("No CTAs (phone number, email, or booking button) are visible above the fold on the homepage.");
    recommendations.push(
      'Add a prominent call-to-action such as a "Book Now" button or phone number in the hero section.',
    );
  }

  // --- Form friction ---
  const allForms = pagesData.flatMap((p) => p.forms || []);
  const avgFieldCount = allForms.length
    ? Math.round(allForms.reduce((n, f) => n + (f.field_count ?? f.fields?.length ?? 0), 0) / allForms.length)
    : 0;
  const avgRequiredCount = allForms.length
    ? Math.round(allForms.reduce((n, f) => n + (f.required_field_count ?? 0), 0) / allForms.length)
    : 0;
  const highFrictionForms = allForms.filter((f) => f.friction_level === "high").length;

  let formFrictionVerdict = "none";
  if (allForms.length > 0) {
    if (highFrictionForms > 0) {
      formFrictionVerdict = "high";
      issues.push(
        `${highFrictionForms} form(s) have more than 6 fields. This is high friction and is likely to reduce conversions.`,
      );
      recommendations.push(
        "Reduce contact forms to 4 fields or fewer: name, phone or email, message, and a submit button.",
      );
    } else if (avgFieldCount > 4) {
      formFrictionVerdict = "medium";
      issues.push(`Contact forms average ${avgFieldCount} fields. This is moderate friction for users.`);
      recommendations.push("Consider trimming form fields to improve conversion rate.");
    } else {
      formFrictionVerdict = "low";
      strengths.push(
        `Contact forms are concise with an average of ${avgFieldCount} fields. This is low friction for users.`,
      );
    }
  }

  // --- Form position ---
  const belowFoldForms = allForms.filter((f) => f.position_label === "below_fold");
  const midPageForms   = allForms.filter((f) => f.position_label === "mid_page");
  if (belowFoldForms.length > 0) {
    issues.push(
      `${belowFoldForms.length} form(s) are positioned low on the page (below 70% scroll depth). Most visitors will never reach them.`,
    );
    recommendations.push(
      "Move contact forms higher up the page — ideally within the first 50% of scroll depth so visitors see them without having to scroll past most of the content.",
    );
  } else if (midPageForms.length > 0 && allForms.every((f) => f.position_label !== "above_fold")) {
    recommendations.push(
      "Consider moving a contact form into the upper half of the page to make it easier for visitors to reach.",
    );
  }

  // --- Booking journey ---
  const allBookingCTAs = pagesData.flatMap((p) => p.booking_ctas || []);
  const successfulCTAs = allBookingCTAs.filter((c) => c.destination_type !== "error");
  const directToPlatform = successfulCTAs.filter((c) => c.destination_type === "booking_platform").length;
  const highHopCTAs = successfulCTAs.filter((c) => (c.redirect_hops ?? 0) > 1);
  const avgRedirectHops = successfulCTAs.length
    ? Math.round((successfulCTAs.reduce((n, c) => n + (c.redirect_hops ?? 0), 0) / successfulCTAs.length) * 10) / 10
    : 0;

  const ctasWithClickDepth = successfulCTAs.filter((c) => c.clicks_to_book !== null && c.clicks_to_book !== undefined);
  const minClicksToBook = ctasWithClickDepth.length
    ? Math.min(...ctasWithClickDepth.map((c) => c.clicks_to_book))
    : null;

  if (allBookingCTAs.length === 0) {
    issues.push("No booking CTAs were detected on the site. Visitors may not know how to book.");
    recommendations.push('Add a visible "Book Now" or "Schedule" button that links directly to your booking system.');
  } else if (directToPlatform > 0) {
    strengths.push(
      `${directToPlatform} booking CTA(s) link directly to a booking platform. This is minimal friction for the user.`,
    );
  }

  if (minClicksToBook !== null && minClicksToBook > 1) {
    issues.push(
      `Booking requires at least ${minClicksToBook} clicks from the page. Consider adding a direct booking CTA higher up the page.`,
    );
    recommendations.push('Add a direct "Book Now" link to your booking platform in the header or hero section.');
  } else if (minClicksToBook === 1) {
    strengths.push("Booking is reachable in 1 click from at least one CTA on the page.");
  }

  if (highHopCTAs.length > 0) {
    issues.push(
      `${highHopCTAs.length} booking CTA(s) pass through multiple redirects before reaching the destination. This adds load time and increases drop-off risk.`,
    );
    recommendations.push(
      "Update booking CTA links to point directly to the final booking URL to reduce the number of redirects.",
    );
  }

  // --- Overall score ---
  let score = 100;
  if (phoneVerdict === "poor") score -= 20;
  else if (phoneVerdict === "partial") score -= 10;
  if (!phonesAboveFold && totalClickablePhones + totalPlainTextPhones > 0) score -= 5;
  if (emailVerdict === "poor") score -= 10;
  else if (emailVerdict === "partial") score -= 5;
  if (aboveFoldCount === 0) score -= 15;
  if (formFrictionVerdict === "high") score -= 15;
  else if (formFrictionVerdict === "medium") score -= 5;
  if (allBookingCTAs.length === 0) score -= 10;
  score -= highHopCTAs.length * 5;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

  return {
    overall_score: score,
    grade,
    phone_quality: {
      unique_clickable: totalClickablePhones,
      unique_plain_text: totalPlainTextPhones,
      independent_clickable: independentClickable,
      shared_with_whatsapp: sharedPhoneNumbers,
      above_fold: phonesAboveFold,
      verdict: phoneVerdict,
    },
    email_quality: {
      clickable_count: totalClickableEmails,
      plain_text_count: totalPlainTextEmails,
      verdict: emailVerdict,
    },
    above_fold: {
      has_phone: aboveFoldByPage.some((p) => p.has_phone),
      has_email: aboveFoldByPage.some((p) => p.has_email),
      has_whatsapp: aboveFoldByPage.some((p) => p.has_whatsapp),
      has_cta_button: aboveFoldByPage.some((p) => p.has_cta_button),
      by_page: aboveFoldByPage,
    },
    form_friction: {
      forms_found: allForms.length,
      avg_field_count: avgFieldCount,
      avg_required_fields: avgRequiredCount,
      high_friction_forms: highFrictionForms,
      verdict: formFrictionVerdict,
    },
    booking_journey: {
      ctas_found: allBookingCTAs.length,
      min_clicks_to_book: minClicksToBook,
      avg_redirect_hops: avgRedirectHops,
      direct_to_platform: directToPlatform,
      high_hop_ctas: highHopCTAs.length,
    },
    strengths,
    issues,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// SayHello viability check
// Determines whether a site is a viable SayHello candidate based on four
// binary pass/fail conditions — all four must pass for the site to be viable.
// ---------------------------------------------------------------------------
function generateSayHelloViability(pagesData, siteUrl) {
  // ── 1. Multi-stage forms — must be FALSE (no multi-stage) ─────────────────
  const multiStagePage = pagesData.find((p) => p.form_features?.is_multi_stage);
  const hasMultiStageForms = !!multiStagePage;

  // ── 2. Forms must be native HTML, not iframes ─────────────────────────────
  const iframePage = pagesData.find(
    (p) => p.form_features?.has_iframe_forms || (p.booking_links || []).some((b) => b.type === "embedded_iframe"),
  );
  const hasIframeForms = !!iframePage;
  const iframeProviders = [
    ...new Set(
      pagesData.flatMap((p) => [
        ...(p.form_features?.iframe_providers || []),
        ...(p.booking_links || []).filter((b) => b.type === "embedded_iframe").map((b) => b.platform || b.domain),
      ]),
    ),
  ];

  // ── 3. Phone numbers — ≤4 unique and no 08xx / 03xx numbers ──────────────
  const allClickableNums = new Set(pagesData.flatMap((p) => (p.phones?.clickable || []).map((ph) => ph.number)));
  const allPlainDigits = new Set(pagesData.flatMap((p) => (p.phones?.plainText || []).map((ph) => ph.digits)));
  // Don't double-count plain-text instances of already-clickable numbers
  allClickableNums.forEach((n) => allPlainDigits.delete(n));
  const uniquePhoneCount = allClickableNums.size + allPlainDigits.size;

  // Detect 08xx or 03xx (premium rate / non-geographic / public-service numbers).
  // Normalise to local UK format first (strip +44 / 0044 → leading 0).
  const problematicPhones = [
    ...pagesData.flatMap((p) => [
      ...(p.phones?.clickable || []).map((ph) => ph.number),
      ...(p.phones?.plainText || []).map((ph) => ph.digits),
    ]),
  ].filter((n) => {
    const digits = (n || "").replace(/\D/g, "");
    const local = digits.startsWith("44") ? "0" + digits.slice(2) : digits.startsWith("0") ? digits : digits;
    return /^0[38]/.test(local);
  });

  const phoneCountOk = uniquePhoneCount <= 4;
  const noProblematicNums = problematicPhones.length === 0;
  const phonesOk = phoneCountOk && noProblematicNums;

  // ── 4. Geography — GB / Northern Ireland or North America ─────────────────
  let geoScore = { uk: 0, na: 0 };

  // Domain TLD signals (highest weight)
  try {
    const hostname = new URL(siteUrl).hostname.toLowerCase();
    if (/\.(co\.uk|org\.uk|me\.uk|net\.uk|uk)$/.test(hostname)) geoScore.uk += 5;
    if (/\.ca$/.test(hostname)) geoScore.na += 5;
    if (/\.(us)$/.test(hostname)) geoScore.na += 5;
  } catch {}

  // Aggregate page-level geo signals
  pagesData.forEach((p) => {
    const s = p.geo_signals || {};
    if (s.hreflangUK) geoScore.uk += 3;
    if (s.hreflangNA) geoScore.na += 3;
    if (s.hasGBP) geoScore.uk += 2;
    if (s.hasUSD) geoScore.na += 1;
    if (s.hasUKPostcode) geoScore.uk += 3;
    if (s.ukMention) geoScore.uk += 2;
    if (s.naMention) geoScore.na += 2;
  });

  // Phone number format signals
  pagesData
    .flatMap((p) => [
      ...(p.phones?.clickable || []).map((ph) => ph.number),
      ...(p.phones?.plainText || []).map((ph) => ph.digits),
    ])
    .forEach((n) => {
      const d = (n || "").replace(/\D/g, "");
      if (d.startsWith("44") || (d.startsWith("0") && d.length >= 10 && d.length <= 11)) geoScore.uk += 1;
      if (d.startsWith("1") && d.length === 11) geoScore.na += 1;
    });

  const isGB = geoScore.uk >= 3;
  const isNA = geoScore.na >= 3;
  const geoOk = isGB || isNA;

  // ── Assemble result ───────────────────────────────────────────────────────
  const checks = {
    single_stage_forms: {
      pass: !hasMultiStageForms,
      label: "No multi-stage forms",
      detail: hasMultiStageForms
        ? `Multi-stage form wizard detected on: ${multiStagePage.url}`
        : "All forms appear to be single-stage",
    },
    native_forms: {
      pass: !hasIframeForms,
      label: "Forms are native HTML (not iframes)",
      detail: hasIframeForms
        ? `Iframe-based form(s) detected: ${iframeProviders.join(", ")} — on: ${iframePage.url}`
        : "No iframe-embedded form providers found",
    },
    phone_numbers_ok: {
      pass: phonesOk,
      label: "≤4 unique phone numbers and no 08xx/03xx numbers",
      detail: !phoneCountOk
        ? `${uniquePhoneCount} unique phone numbers found (max 4 allowed)`
        : !noProblematicNums
          ? `Found 08xx/03xx number(s): ${[...new Set(problematicPhones)].join(", ")}`
          : `${uniquePhoneCount} unique phone number(s) — all OK`,
    },
    geography_ok: {
      pass: geoOk,
      label: "Based in GB, Northern Ireland, or North America",
      detail: geoOk
        ? isGB
          ? `Appears to be GB/Northern Ireland-based (confidence: ${geoScore.uk})`
          : `Appears to be North America-based (confidence: ${geoScore.na})`
        : `Could not confirm GB or North American location (UK score: ${geoScore.uk}, NA score: ${geoScore.na})`,
    },
  };

  const allPass = Object.values(checks).every((c) => c.pass);
  const failReasons = Object.values(checks)
    .filter((c) => !c.pass)
    .map((c) => c.detail);

  return {
    viable: allPass,
    verdict: allPass ? "VIABLE: Meets all SayHello criteria" : `NOT VIABLE: ${failReasons.length} condition(s) failed`,
    checks,
    fail_reasons: failReasons,
  };
}

// Helper: extract all data from a single already-loaded page.
// Shared between homepage, contact, and service page crawls.
async function extractPageData(page, pageUrl, label, context) {
  const phones = await extractPhones(page, pageUrl);
  const whatsapp = await extractWhatsApp(page, pageUrl);

  // Cross-reference: mark phone numbers that are also used in a WhatsApp link.
  // Normalise both sides to a stripped subscriber core for reliable matching.
  const waPhoneCores = new Set((whatsapp.links || []).map((w) => normalisePhoneCore(w.number || "")).filter(Boolean));
  [...(phones.clickable || []), ...(phones.plainText || [])].forEach((ph) => {
    const core = normalisePhoneCore(ph.number || ph.digits || "");
    ph.also_on_whatsapp = waPhoneCores.has(core) && core.length >= 9;
  });

  return {
    url: pageUrl,
    label,
    phones,
    emails: await extractEmails(page, pageUrl),
    whatsapp,
    location_links: await extractLocationLinks(page, pageUrl),
    booking_links: await extractBookingLinks(page, pageUrl),
    booking_ctas: await extractBookingCTAs(page, context, pageUrl),
    social_links: await extractSocialLinks(page, pageUrl),
    newsletter: await extractNewsletter(page, pageUrl),
    forms: await extractForms(page, pageUrl),
    form_features: await detectPageFormFeatures(page),
    live_chat: await extractLiveChat(page),
    above_fold_ctas: await extractAboveFoldCTAs(page),
    geo_signals: await extractGeoSignals(page),
  };
}

async function ctaAuditSite(url) {
  const startTime = Date.now();

  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    });

    await context.route("**/*", async (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    const page = await context.newPage();
    const pagesCrawled = [];
    const pagesData = [];

    // ── Homepage ──────────────────────────────────────────────────────────────
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
    await acceptCookieConsent(page);
    pagesCrawled.push(url);

    // Discover contact + service pages while we're on the homepage
    const [contactPageUrl, servicePageUrls] = await Promise.all([
      findContactPageUrl(page, url),
      findServicePages(page, url),
    ]);

    pagesData.push(await extractPageData(page, url, "homepage", context));

    // ── Contact page ──────────────────────────────────────────────────────────
    if (contactPageUrl && contactPageUrl !== url) {
      try {
        await page.goto(contactPageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
        pagesCrawled.push(contactPageUrl);
        pagesData.push(await extractPageData(page, contactPageUrl, "contact", context));
      } catch (e) {
        console.error("Failed to crawl contact page:", e.message);
      }
    }

    // ── Service pages — dynamic queue ─────────────────────────────────────────
    // The queue starts with pages found in the nav. After visiting each page,
    // findServiceSubPages scans it for any additional service pages linked from
    // the content (e.g. individual treatment pages linked from a /services listing).
    // New discoveries are pushed back onto the queue so the crawl expands naturally.
    const crawledSet = new Set(pagesCrawled);
    const serviceQueue = [...servicePageUrls];
    let qi = 0;

    let baseOrigin;
    try { baseOrigin = new URL(url).origin; } catch { baseOrigin = ''; }

    while (qi < serviceQueue.length) {
      const serviceUrl = serviceQueue[qi++];
      if (crawledSet.has(serviceUrl)) continue;

      try {
        await page.goto(serviceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        crawledSet.add(serviceUrl);
        pagesCrawled.push(serviceUrl);

        pagesData.push(await extractPageData(page, serviceUrl, 'service', context));

        // After visiting the page, scan it for any linked service sub-pages and
        // add them to the queue if not already seen. This handles listing pages
        // (e.g. /services → /services/massage) as well as any page that cross-links
        // to other service pages in its body copy or sidebar.
        const subPages = await findServiceSubPages(page, serviceUrl, baseOrigin, crawledSet);
        subPages.forEach(u => {
          if (!crawledSet.has(u)) serviceQueue.push(u);
        });
      } catch (e) {
        console.error(`Failed to crawl service page ${serviceUrl}:`, e.message);
      }
    }

    await context.close();

    const gtmSummary = await generateGTMSummary(pagesData);
    const ctaQuality = generateCTAQualityReport(pagesData);
    const sayHello = generateSayHelloViability(pagesData, url);

    return {
      website_url: url,
      ran_at: new Date().toISOString(),
      pages_crawled: pagesCrawled,
      pages: pagesData,
      gtm_summary: gtmSummary,
      cta_quality: ctaQuality,
      sayhello_viability: sayHello,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    console.error("CTA audit error:", error);
    throw new Error(`CTA audit failed: ${error.message}`);
  }
}

module.exports = { ctaAuditSite, getBrowser };
