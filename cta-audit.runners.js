const { chromium } = require('playwright');

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
  '.wpcf7-response-output',
  '.wpcf7-mail-sent-ok',
  '.gform_confirmation_message',
  '.contact-form-success',
  '.form-success',
  '.success-message',
  '.thank-you',
  '.thankyou',
  '[class*="success"]',
  '[class*="thank"]',
  '[class*="confirmation"]',
  '[role="alert"]',
  '.alert-success'
];

const BOOKING_PLATFORMS = {
  'calendly.com': 'Calendly',
  'acuityscheduling.com': 'Acuity Scheduling',
  'simplybook.me': 'SimplyBook.me',
  'booksy.com': 'Booksy',
  'mindbodyonline.com': 'Mindbody',
  'squareup.com': 'Square Appointments',
  'setmore.com': 'Setmore',
  'youcanbook.me': 'YouCanBook.me',
  'fresha.com': 'Fresha',
  'cliniko.com': 'Cliniko',
  'janeapp.com': 'Jane App',
  'treatwell.co.uk': 'Treatwell',
  'treatwell.com': 'Treatwell',
  'vagaro.com': 'Vagaro'
};

const NEWSLETTER_PLATFORMS = {
  'mailchimp.com': 'Mailchimp',
  'klaviyo.com': 'Klaviyo',
  'constantcontact.com': 'Constant Contact',
  'convertkit.com': 'ConvertKit',
  'activecampaign.com': 'ActiveCampaign',
  'mailerlite.com': 'MailerLite',
  'brevo.com': 'Brevo',
  'getresponse.com': 'GetResponse',
  'hubspot.com': 'HubSpot'
};

const SOCIAL_PLATFORMS = {
  'facebook.com': 'Facebook',
  'fb.com': 'Facebook',
  'instagram.com': 'Instagram',
  'twitter.com': 'X (Twitter)',
  'x.com': 'X (Twitter)',
  'linkedin.com': 'LinkedIn',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'tiktok.com': 'TikTok',
  'pinterest.com': 'Pinterest',
  'snapchat.com': 'Snapchat',
  'threads.net': 'Threads',
  'trustpilot.com': 'Trustpilot',
  'google.com/maps': 'Google Maps',
  'g.page': 'Google Maps',
  'maps.google.com': 'Google Maps',
};

const LIVE_CHAT_DETECTORS = [
  { name: 'Intercom', global: 'Intercom' },
  { name: 'Drift', global: 'drift' },
  { name: 'Crisp', global: '$crisp' },
  { name: 'Tidio', global: 'tidioChatApi' },
  { name: 'LiveChat', global: 'LC_API' },
  { name: 'Zendesk', global: 'zE' },
  { name: 'HubSpot Chat', global: 'HubSpotConversations' },
  { name: 'Tawk.to', global: 'Tawk_API' },
  { name: 'Facebook Pixel', global: 'fbq' },
  { name: 'TikTok Pixel', global: 'ttq' }
];

async function safeEval(page, script) {
  try {
    return await page.evaluate(script);
  } catch (e) {
    return null;
  }
}

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-gpu-compositing',
        '--mute-audio'
      ]
    });

    browser.on('disconnected', () => {
      browser = null;
    });
  }
  return browser;
}

async function acceptCookieConsent(page) {
  const acceptPatterns = [
    /^accept all$/i,
    /^accept cookies$/i,
    /^allow all$/i,
    /^i accept$/i,
    /^i agree$/i,
    /^ok$/i
  ];

  for (const pattern of acceptPatterns) {
    try {
      const button = page.getByRole('button', { name: pattern });
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
  const contactKeywords = ['contact', 'get-in-touch', 'enquire', 'enquiry', 'quote', 'book', 'reach-us'];
  const commonPaths = ['/contact', '/contact-us', '/get-in-touch', '/enquiry'];

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
    return Array.from(document.querySelectorAll('a[href]')).map(a => ({
      href: a.href,
      text: (a.textContent || '').toLowerCase().trim()
    }));
  });

  if (links) {
    for (const link of links) {
      const linkText = link.text;
      if (contactKeywords.some(keyword => linkText.includes(keyword))) {
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
    document.querySelectorAll('a[href^="tel:"]').forEach(a => {
      const style = window.getComputedStyle(a);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const href = a.getAttribute('href');
      const number = href.replace('tel:', '').replace(/\D/g, '');
      if (!number || number.length < 10) return;
      clickableRaw.push({
        href,
        number,
        display_text: a.textContent.trim(),
        clickable: true
      });
    });

    // Deduplicate by normalised number — keep first DOM occurrence (avoids
    // header + footer + mobile-nav copies of the same number inflating the count)
    const seenNumbers = new Set();
    const clickable = clickableRaw.filter(p => {
      if (seenNumbers.has(p.number)) return false;
      seenNumbers.add(p.number);
      return true;
    });

    // Find plain text phone numbers — tighter UK/international regex to avoid
    // false positives from dates, order numbers, postcodes, etc.
    const phoneRegex = /(?:\+44|0044|0)[\s-]?\(?\d{2,5}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g;
    const plainText = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          // Already covered by a tel: link
          if (parent.closest('a[href^="tel:"]')) return NodeFilter.FILTER_REJECT;
          // Non-visible or non-content nodes
          if (parent.closest('script, style, noscript, [aria-hidden="true"], [hidden], input, select, option, time, data')) return NodeFilter.FILTER_REJECT;
          const pStyle = window.getComputedStyle(parent);
          if (pStyle.display === 'none' || pStyle.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let textNode;
    while (textNode = walker.nextNode()) {
      const text = textNode.textContent;
      const matches = text.match(phoneRegex);
      if (matches) {
        matches.forEach(match => {
          const digits = match.replace(/\D/g, '');
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
    phones.clickable.forEach(phone => phone.page_url = pageUrl);
    phones.plainText.forEach(phone => phone.page_url = pageUrl);
  }

  return phones || { clickable: [], plainText: [] };
}

async function extractEmails(page, pageUrl) {
  const emails = await safeEval(page, () => {
    const clickable = [];
    const plainText = [];

    // Find clickable mailto: links
    document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
      const href = a.getAttribute('href');
      const address = href.replace('mailto:', '').split('?')[0];
      clickable.push({
        href,
        address,
        display_text: a.textContent.trim(),
        clickable: true
      });
    });

    // Find plain text emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest('a[href^="mailto:"]')) return NodeFilter.FILTER_REJECT;
          if (parent.closest('script, style, noscript')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let textNode;
    while (textNode = walker.nextNode()) {
      const text = textNode.textContent;
      const matches = text.match(emailRegex);
      if (matches) {
        matches.forEach(match => {
          plainText.push({
            address: match,
            clickable: false
          });
        });
      }
    }

    return { clickable, plainText };
  });

  if (emails) {
    emails.clickable.forEach(email => email.page_url = pageUrl);
    emails.plainText.forEach(email => email.page_url = pageUrl);
  }

  return emails || { clickable: [], plainText: [] };
}

async function extractWhatsApp(page, pageUrl) {
  const whatsapp = await safeEval(page, () => {
    const links = [];
    const patterns = [
      /wa\.me\/([0-9]+)/,
      /api\.whatsapp\.com\/send\?phone=([0-9]+)/,
      /whatsapp\.com\/send\?phone=([0-9]+)/
    ];

    document.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="api.whatsapp.com"]').forEach(a => {
      const href = a.getAttribute('href');
      let type = null;
      let number = null;

      if (href.includes('wa.me')) {
        type = 'wa.me';
        const match = href.match(patterns[0]);
        if (match) number = match[1];
      } else if (href.includes('api.whatsapp.com') || href.includes('whatsapp.com')) {
        type = 'api.whatsapp.com';
        const match = href.match(patterns[1]) || href.match(patterns[2]);
        if (match) number = match[1];
      }

      if (type && number) {
        links.push({
          href,
          type,
          number,
          display_text: a.textContent.trim()
        });
      }
    });

    // Check for WhatsApp widget
    const hasWidget = !!document.querySelector('script[src*="whatsapp"]') ||
                     !!window.WhatsAppWidget ||
                     !!document.querySelector('[class*="whatsapp"], [id*="whatsapp"]');

    return { links, has_widget: hasWidget };
  });

  if (whatsapp) {
    whatsapp.page_url = pageUrl;
  }

  return whatsapp || { links: [], has_widget: false, page_url: pageUrl };
}

async function extractBookingLinks(page, pageUrl) {
  const bookingLinks = await safeEval(page, () => {
    const links = [];
    const platforms = {
      'calendly.com': 'Calendly',
      'acuityscheduling.com': 'Acuity Scheduling',
      'simplybook.me': 'SimplyBook.me',
      'booksy.com': 'Booksy',
      'mindbodyonline.com': 'Mindbody',
      'squareup.com': 'Square Appointments',
      'setmore.com': 'Setmore',
      'youcanbook.me': 'YouCanBook.me',
      'fresha.com': 'Fresha',
      'cliniko.com': 'Cliniko',
      'janeapp.com': 'Jane App',
      'treatwell.co.uk': 'Treatwell',
      'treatwell.com': 'Treatwell',
      'vagaro.com': 'Vagaro'
    };

    // Check for links
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      for (const [domain, platform] of Object.entries(platforms)) {
        if (href.includes(domain)) {
          links.push({
            href,
            platform,
            domain,
            type: 'external_link',
            opens_new_tab: a.getAttribute('target') === '_blank',
            display_text: a.textContent.trim()
          });
          break;
        }
      }
    });

    // Check for embedded iframes
    document.querySelectorAll('iframe[src]').forEach(iframe => {
      const src = iframe.getAttribute('src');
      for (const [domain, platform] of Object.entries(platforms)) {
        if (src.includes(domain)) {
          links.push({
            href: src,
            platform,
            domain,
            type: 'embedded_iframe',
            opens_new_tab: false,
            display_text: 'Embedded booking widget'
          });
          break;
        }
      }
    });

    return links;
  });

  if (bookingLinks) {
    bookingLinks.forEach(link => link.page_url = pageUrl);
  }

  return bookingLinks || [];
}

// Only match labels that signal direct intent to book/convert — not soft enquiry
// terms like "enquire now", "request a quote", "get started" which typically lead
// to contact forms rather than an actual booking action.
const BOOKING_CTA_KEYWORDS = /\b(book\s*(now|online|a?\s*session|an?\s*appointment|a?\s*class|a?\s*consultation|a?\s*call|your|a?\s*slot|a?\s*visit)?|schedule(\s*(a?\s*call|a?\s*session|now))?|reserve(\s*(a?\s*spot|now))?|make\s*(an?\s*appointment|a?\s*booking)|arrange\s*a?\s*visit)\b/i;

// URL patterns that indicate a generic contact/enquiry page — links landing here
// are soft leads, not direct conversions, and should be excluded from booking CTAs.
const CONTACT_PAGE_PATTERN = /\/(contact|contact-us|get-in-touch|enquire|enquiry|enquiries|reach-us|say-hello|talk-to-us|message-us)(\/|$|\?)/i;

const ALL_BOOKING_DOMAINS = {
  'calendly.com': 'Calendly',
  'acuityscheduling.com': 'Acuity Scheduling',
  'simplybook.me': 'SimplyBook.me',
  'booksy.com': 'Booksy',
  'mindbodyonline.com': 'Mindbody',
  'squareup.com': 'Square Appointments',
  'setmore.com': 'Setmore',
  'youcanbook.me': 'YouCanBook.me',
  'fresha.com': 'Fresha',
  'cliniko.com': 'Cliniko',
  'janeapp.com': 'Jane App',
  'treatwell.co.uk': 'Treatwell',
  'treatwell.com': 'Treatwell',
  'vagaro.com': 'Vagaro',
  'doctolib.fr': 'Doctolib',
  'practicepal.co.uk': 'PracticePal',
  'healthcode.co.uk': 'Healthcode',
  'nookal.com': 'Nookal',
  'powerdiary.com': 'Power Diary',
  'halaxy.com': 'Halaxy',
};

async function extractBookingCTAs(page, context, baseUrl) {
  // Step 1 — collect all booking-related links from the current page
  const rawLinks = await safeEval(page, () => {
    const found = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      const ariaLabel = a.getAttribute('aria-label') || '';
      const labelText = (text || ariaLabel).trim();
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return;
      found.push({ label_text: labelText, href, opens_new_tab: a.getAttribute('target') === '_blank' });
    });
    return found;
  });

  if (!rawLinks) return [];

  // Filter to booking keyword matches and deduplicate by href
  const seenHrefs = new Set();
  const bookingLinks = rawLinks.filter(link => {
    if (!BOOKING_CTA_KEYWORDS.test(link.label_text)) return false;
    if (seenHrefs.has(link.href)) return false;
    seenHrefs.add(link.href);
    return true;
  }).slice(0, 6); // max 6 to keep the audit fast

  // Step 2 — follow each link in a new tab and classify the destination
  const results = [];

  for (const link of bookingLinks) {
    let newPage = null;
    try {
      let absoluteUrl;
      try { absoluteUrl = new URL(link.href, baseUrl).href; } catch { continue; }

      newPage = await context.newPage();
      let redirectHops = 0;
      newPage.on('response', (response) => {
        const status = response.status();
        if (status >= 300 && status < 400) redirectHops++;
      });
      await newPage.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await newPage.waitForLoadState('load', { timeout: 5000 }).catch(() => {});

      const finalUrl = newPage.url();
      const pageTitle = await newPage.title().catch(() => '');
      const pageSnippet = await safeEval(newPage, () =>
        (document.body ? document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 400) : '')
      );

      // Classify destination
      let destinationType = 'unknown';
      let platform = null;

      for (const [domain, name] of Object.entries(ALL_BOOKING_DOMAINS)) {
        if (finalUrl.includes(domain)) {
          destinationType = 'booking_platform';
          platform = name;
          break;
        }
      }

      if (destinationType === 'unknown') {
        try {
          const isSameSite = new URL(finalUrl).origin === new URL(baseUrl).origin;
          if (isSameSite) {
            const formCount = await safeEval(newPage, () => document.querySelectorAll('form').length) || 0;
            destinationType = formCount > 0 ? 'same_site_form' : 'same_site_page';
          } else {
            destinationType = 'external_unknown';
          }
        } catch {
          destinationType = 'external_unknown';
        }
      }

      // Determine how many user clicks from the source page to reach an actual
      // booking action. booking_platform / same_site_form = 1 click (already there).
      // same_site_page = follow one level deeper to see if a booking platform or
      // form lives there — if so, 2 clicks; otherwise null (depth unclear).
      let clicksToBook = null;
      if (destinationType === 'booking_platform' || destinationType === 'same_site_form') {
        clicksToBook = 1;
      } else if (destinationType === 'external_unknown') {
        clicksToBook = 1; // reached something off-site — treat as 1, destination unknown
      } else if (destinationType === 'same_site_page') {
        const deepLinks = await safeEval(newPage, () =>
          Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
        ) || [];
        const bookingDomainKeys = Object.keys(ALL_BOOKING_DOMAINS);
        const hasDeepBookingPlatform = deepLinks.some(href =>
          bookingDomainKeys.some(d => href.includes(d))
        );
        clicksToBook = hasDeepBookingPlatform ? 2 : null;
      }

      // Build GTM recommendation
      let gtm_recommendation;
      if (destinationType === 'booking_platform') {
        const hostname = new URL(finalUrl).hostname;
        gtm_recommendation = `GA4 Event: click_booking — Trigger: Click - Just Links, {{Click URL}} contains "${hostname}"`;
      } else if (destinationType === 'same_site_form') {
        const path = new URL(finalUrl).pathname;
        gtm_recommendation = `GA4 Event: click_book_cta — Trigger: Click - Just Links on this CTA. Also set up form submission tracking on "${path}"`;
      } else if (destinationType === 'same_site_page') {
        const path = new URL(finalUrl).pathname;
        gtm_recommendation = `GA4 Event: click_book_cta — Trigger: Click - Just Links, {{Click URL}} contains "${path}"`;
      } else {
        gtm_recommendation = `GA4 Event: click_book_cta — Trigger: Click - Just Links on booking CTA button (destination: ${finalUrl})`;
      }

      // Only keep CTAs that lead directly to a conversion:
      //   booking_platform  → definite conversion
      //   same_site_form    → conversion only if it's a booking/appointment page,
      //                       not a generic contact/enquiry page
      //   same_site_page    → only if a booking platform was found one level deeper
      //   external_unknown  → keep (may be a custom booking system we don't recognise)
      const isDirectConversion =
        destinationType === 'booking_platform' ||
        destinationType === 'external_unknown' ||
        (destinationType === 'same_site_form' && !CONTACT_PAGE_PATTERN.test(finalUrl)) ||
        (destinationType === 'same_site_page' && clicksToBook !== null);

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
        destination_type: 'error',
        platform: null,
        error: err.message,
        gtm_recommendation: 'Could not follow link — check manually',
      });
    } finally {
      if (newPage) await newPage.close().catch(() => {});
    }
  }

  return results;
}

async function extractSocialLinks(page, pageUrl) {
  const socialLinks = await safeEval(page, () => {
    const platforms = {
      'facebook.com': 'Facebook',
      'fb.com': 'Facebook',
      'instagram.com': 'Instagram',
      'twitter.com': 'X (Twitter)',
      'x.com': 'X (Twitter)',
      'linkedin.com': 'LinkedIn',
      'youtube.com': 'YouTube',
      'youtu.be': 'YouTube',
      'tiktok.com': 'TikTok',
      'pinterest.com': 'Pinterest',
      'snapchat.com': 'Snapchat',
      'threads.net': 'Threads',
      'trustpilot.com': 'Trustpilot',
      'google.com/maps': 'Google Maps',
      'g.page': 'Google Maps',
      'maps.google.com': 'Google Maps',
    };

    const found = [];
    const seen = new Set();

    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('http')) return;

      for (const [domain, platform] of Object.entries(platforms)) {
        if (href.includes(domain)) {
          const key = `${platform}:${href}`;
          if (!seen.has(key)) {
            seen.add(key);
            found.push({
              platform,
              href,
              display_text: a.textContent.trim() || a.getAttribute('aria-label') || '',
              opens_new_tab: a.getAttribute('target') === '_blank',
            });
          }
          break;
        }
      }
    });

    return found;
  });

  if (socialLinks) {
    socialLinks.forEach(link => link.page_url = pageUrl);
  }

  return socialLinks || [];
}

async function extractAboveFoldCTAs(page) {
  return await safeEval(page, () => {
    const viewportHeight = window.innerHeight;
    const results = { phone_links: [], email_links: [], whatsapp_links: [], cta_buttons: [] };

    const isAboveFold = (el) => {
      try {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.top < viewportHeight && rect.width > 0 && rect.height > 0;
      } catch { return false; }
    };

    document.querySelectorAll('a[href^="tel:"]').forEach(a => {
      if (isAboveFold(a))
        results.phone_links.push({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') });
    });

    document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
      if (isAboveFold(a))
        results.email_links.push({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') });
    });

    document.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp.com"]').forEach(a => {
      if (isAboveFold(a))
        results.whatsapp_links.push({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') });
    });

    const ctaPattern = /\b(book(\s*(now|online|appointment|session|call|a\s*class|a\s*consultation))?|schedule|reserve|get\s*started|enquire(\s*now)?|contact\s*us|call\s*(us|now)|get\s*a?\s*quote|free\s*consultation|request\s*(a?\s*(quote|call|callback)))\b/i;
    document.querySelectorAll('a[href], button').forEach(el => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const href = el.getAttribute('href') || '';
      if (!ctaPattern.test(text)) return;
      if (href.startsWith('tel:') || href.startsWith('mailto:') || href.includes('wa.me')) return;
      if (isAboveFold(el))
        results.cta_buttons.push({ text, href: href || null, tag: el.tagName.toLowerCase() });
    });

    return results;
  }) || { phone_links: [], email_links: [], whatsapp_links: [], cta_buttons: [] };
}

async function extractForms(page, pageUrl) {
  const forms = await safeEval(page, (pageUrl) => {
    const formData = [];
    const forms = document.querySelectorAll('form');

    forms.forEach((form, index) => {
      const fields = [];
      const inputs = form.querySelectorAll('input, textarea, select');
      let hasEmailField = false;
      let hasPhoneField = false;
      let hasMessageField = false;
      let score = 0;

      inputs.forEach(input => {
        const type = input.type || 'text';
        const name = input.name || input.id || '';
        const placeholder = input.placeholder || '';
        const required = input.hasAttribute('required');

        fields.push({ type, name, placeholder, required });

        // Scoring for lead forms
        const fieldText = (name + placeholder).toLowerCase();
        if (fieldText.includes('email')) {
          hasEmailField = true;
          score += 2;
        }
        if (fieldText.includes('phone') || fieldText.includes('tel')) {
          hasPhoneField = true;
          score += 1;
        }
        if (fieldText.includes('message') || fieldText.includes('comment') || fieldText.includes('enquiry')) {
          hasMessageField = true;
          score += 1;
        }
        if (fieldText.includes('name')) score += 1;
        if (fieldText.includes('company') || fieldText.includes('business')) score += 1;
      });

      // Only include forms with score >= 2 (likely lead forms)
      if (score >= 2) {
        const submitButton = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        const submitButtonText = submitButton ? submitButton.textContent.trim() || submitButton.value || 'Submit' : 'Submit';

        // Check for third-party forms
        const formAction = form.action || '';
        const thirdParty = /hubspot|typeform|gravity|jotform|mailchimp|convertkit/i.test(formAction) ||
                          /hubspot|typeform|gravity|jotform/i.test(form.className) ||
                          !!form.querySelector('[class*="hubspot"], [class*="typeform"], [class*="gravity"], [class*="jotform"]');

        const fieldCount = inputs.length;
        const requiredCount = [...inputs].filter(i => i.hasAttribute('required')).length;
        formData.push({
          page_url: pageUrl,
          form_index: index,
          fields,
          field_count: fieldCount,
          required_field_count: requiredCount,
          friction_level: fieldCount <= 3 ? 'low' : fieldCount <= 6 ? 'medium' : 'high',
          submit_button_text: submitButtonText,
          has_email_field: hasEmailField,
          has_phone_field: hasPhoneField,
          has_message_field: hasMessageField,
          third_party: thirdParty
        });
      }
    });

    return formData;
  }, pageUrl);

  // Test form submission for up to 2 forms
  if (forms && forms.length > 0) {
    const formsToTest = forms.slice(0, 2);

    for (const formData of formsToTest) {
      try {
        await testFormSubmission(page, formData);
      } catch (e) {
        formData.submission_behaviour = { type: 'unknown', error: e.message };
        formData.gtm_recommendation = 'Form submission test failed - manual GTM setup required';
      }
    }
  }

  return forms || [];
}

async function testFormSubmission(page, formData) {
  const form = await page.locator('form').nth(formData.form_index);

  // Fill form fields with test data
  for (const field of formData.fields) {
    try {
      const selector = field.name ? `[name="${field.name}"]` : `input:nth-child(${formData.fields.indexOf(field) + 1})`;
      const element = form.locator(selector).first();

      if (await element.isVisible({ timeout: 1000 })) {
        const fieldText = (field.name + field.placeholder).toLowerCase();

        if (fieldText.includes('email')) {
          await element.fill(TEST_VALUES.email);
        } else if (fieldText.includes('phone') || fieldText.includes('tel')) {
          await element.fill(TEST_VALUES.phone);
        } else if (fieldText.includes('message') || fieldText.includes('comment') || fieldText.includes('enquiry')) {
          await element.fill(TEST_VALUES.message);
        } else if (fieldText.includes('first') && fieldText.includes('name')) {
          await element.fill(TEST_VALUES.firstName);
        } else if (fieldText.includes('last') && fieldText.includes('name')) {
          await element.fill(TEST_VALUES.lastName);
        } else if (fieldText.includes('name')) {
          await element.fill(TEST_VALUES.fullName);
        } else if (fieldText.includes('company') || fieldText.includes('business')) {
          await element.fill(TEST_VALUES.company);
        } else if (fieldText.includes('postcode') || fieldText.includes('zip')) {
          await element.fill(TEST_VALUES.postcode);
        } else if (field.type === 'text' || field.type === 'email') {
          await element.fill('Test');
        }
      }
    } catch (e) {
      // Continue with other fields if one fails
    }
  }

  const currentUrl = page.url();

  // Submit form
  const submitButton = form.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
  await submitButton.click();

  // Wait a moment for submission to process
  await page.waitForTimeout(2000);

  // Check if URL changed (redirect)
  const newUrl = page.url();
  if (newUrl !== currentUrl) {
    formData.submission_behaviour = { type: 'redirect', thank_you_url: newUrl };
    formData.gtm_recommendation = `Thank You URL detected: ${newUrl} - Create GA4 Event tag triggered by Page View on this URL`;
    return;
  }

  // Check for success message
  for (const selector of SUCCESS_SELECTORS) {
    try {
      const element = page.locator(selector);
      if (await element.isVisible({ timeout: 1000 })) {
        const messageText = await element.textContent();
        const elementId = await element.getAttribute('id');
        formData.submission_behaviour = {
          type: 'inline_message',
          selector,
          message_text: messageText?.trim(),
          element_id: elementId
        };
        formData.gtm_recommendation = `Success message detected with selector "${selector}" - Create GA4 Event tag triggered by Element Visibility on this selector`;
        return;
      }
    } catch (e) {
      // Continue checking other selectors
    }
  }

  // No clear success indicator found
  formData.submission_behaviour = { type: 'unknown' };
  formData.gtm_recommendation = 'No clear success indicator detected - manual form submission tracking setup required';
}

async function extractNewsletter(page, pageUrl) {
  const newsletters = await safeEval(page, (pageUrl) => {
    const newsletterForms = [];
    const forms = document.querySelectorAll('form');

    forms.forEach((form, index) => {
      const inputs = form.querySelectorAll('input');
      let hasEmailField = false;
      let hasPhoneField = false;
      let hasMessageField = false;

      inputs.forEach(input => {
        const fieldText = ((input.name || '') + (input.placeholder || '')).toLowerCase();
        if (fieldText.includes('email')) hasEmailField = true;
        if (fieldText.includes('phone') || fieldText.includes('tel')) hasPhoneField = true;
        if (fieldText.includes('message') || fieldText.includes('comment')) hasMessageField = true;
      });

      // Newsletter forms have email but no phone/message fields
      if (hasEmailField && !hasPhoneField && !hasMessageField) {
        const submitButton = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        const submitButtonText = submitButton ? submitButton.textContent.trim() || submitButton.value || 'Subscribe' : 'Subscribe';

        const formAction = form.action || '';
        let platform = 'Unknown';

        const platforms = {
          'mailchimp.com': 'Mailchimp',
          'klaviyo.com': 'Klaviyo',
          'constantcontact.com': 'Constant Contact',
          'convertkit.com': 'ConvertKit',
          'activecampaign.com': 'ActiveCampaign',
          'mailerlite.com': 'MailerLite',
          'brevo.com': 'Brevo',
          'getresponse.com': 'GetResponse',
          'hubspot.com': 'HubSpot'
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
          submit_button_text: submitButtonText
        });
      }
    });

    return newsletterForms;
  }, pageUrl);

  return newsletters || [];
}

async function extractLiveChat(page) {
  const liveChat = await safeEval(page, () => {
    const detectors = [
      { name: 'Intercom', global: 'Intercom' },
      { name: 'Drift', global: 'drift' },
      { name: 'Crisp', global: '$crisp' },
      { name: 'Tidio', global: 'tidioChatApi' },
      { name: 'LiveChat', global: 'LC_API' },
      { name: 'Zendesk', global: 'zE' },
      { name: 'HubSpot Chat', global: 'HubSpotConversations' },
      { name: 'Tawk.to', global: 'Tawk_API' },
      { name: 'Facebook Pixel', global: 'fbq' },
      { name: 'TikTok Pixel', global: 'ttq' }
    ];

    const found = [];
    detectors.forEach(detector => {
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
  const _uniqueClickableNums = new Set(pageData.flatMap(p => p.phones.clickable.map(ph => ph.number)));
  const _uniquePlainTextNums = new Set(pageData.flatMap(p => p.phones.plainText.map(ph => ph.digits)));
  _uniqueClickableNums.forEach(n => _uniquePlainTextNums.delete(n));
  totalClickablePhones = _uniqueClickableNums.size;
  totalPlainTextPhones  = _uniquePlainTextNums.size;

  pageData.forEach(page => {
    totalClickableEmails += page.emails.clickable.length;
    totalPlainTextEmails += page.emails.plainText.length;
    totalWhatsAppLinks += page.whatsapp.links.length;
    totalBookingLinks += page.booking_links.length;
    totalForms += page.forms.length;
    totalNewsletterForms += page.newsletter.length;
    (page.social_links || []).forEach(s => socialPlatformsSeen.add(s.platform));
  });

  // Phone tracking
  if (totalClickablePhones > 0) {
    tagsToCreate.push(`GA4 Event: click_call — Trigger: Click - Just Links, {{Click URL}} contains tel:`);
  }
  if (totalPlainTextPhones > 0) {
    fixesNeeded.push(`${totalPlainTextPhones} phone number(s) are plain text — wrap in <a href='tel:...'> to enable tracking`);
  }

  // Email tracking
  if (totalClickableEmails > 0) {
    tagsToCreate.push(`GA4 Event: click_email — Trigger: Click - Just Links, {{Click URL}} contains mailto:`);
  }
  if (totalPlainTextEmails > 0) {
    fixesNeeded.push(`${totalPlainTextEmails} email address(es) are plain text — wrap in <a href='mailto:...'> to enable tracking`);
  }

  // WhatsApp tracking
  if (totalWhatsAppLinks > 0) {
    tagsToCreate.push(`GA4 Event: click_whatsapp — Trigger: Click - Just Links, {{Click URL}} contains wa.me OR whatsapp.com`);
  }

  // Booking links tracking
  if (totalBookingLinks > 0) {
    const platforms = [...new Set(pageData.flatMap(p => p.booking_links.map(b => b.domain)))];
    platforms.forEach(platform => {
      tagsToCreate.push(`GA4 Event: click_booking_${platform.replace('.', '_')} — Trigger: Click - Just Links, {{Click URL}} contains ${platform}`);
    });
  }

  // Form tracking
  if (totalForms > 0) {
    tagsToCreate.push(`GA4 Event: form_submit_contact — Trigger: Form submission on contact forms`);
  }

  // Newsletter tracking
  if (totalNewsletterForms > 0) {
    tagsToCreate.push(`GA4 Event: form_submit_newsletter — Trigger: Form submission on newsletter forms`);
  }

  // Booking CTA tracking
  const allBookingCTAs = pageData.flatMap(p => p.booking_ctas || []);
  if (allBookingCTAs.length > 0) {
    const platformCTAs = allBookingCTAs.filter(c => c.destination_type === 'booking_platform');
    const nonPlatformCTAs = allBookingCTAs.filter(c => c.destination_type !== 'booking_platform' && c.destination_type !== 'error');
    const platformNames = [...new Set(platformCTAs.map(c => c.platform).filter(Boolean))];
    platformNames.forEach(p => {
      tagsToCreate.push(`GA4 Event: click_booking_cta — Destination: ${p}. Trigger: Click - Just Links on "${p}" CTA buttons`);
    });
    if (nonPlatformCTAs.length > 0) {
      tagsToCreate.push(`GA4 Event: click_book_cta — Trigger: Click - Just Links on booking CTA buttons (see booking_ctas in audit for per-link GTM recommendations)`);
    }
  }

  // Social link tracking
  if (socialPlatformsSeen.size > 0) {
    [...socialPlatformsSeen].forEach(platform => {
      tagsToCreate.push(`GA4 Event: click_social_${platform.toLowerCase().replace(/[^a-z0-9]/g, '_')} — Trigger: Click - Just Links, {{Click URL}} contains ${platform}`);
    });
  }

  // Live chat warnings
  const liveChatServices = pageData[0]?.live_chat || [];
  liveChatServices.forEach(service => {
    if (['Intercom', 'Drift', 'HubSpot Chat'].includes(service.name)) {
      warnings.push(`${service.name} live chat detected — already has own analytics`);
    }
  });

  return { tags_to_create: tagsToCreate, fixes_needed: fixesNeeded, warnings };
}

function generateCTAQualityReport(pagesData) {
  const issues = [];
  const strengths = [];
  const recommendations = [];

  // --- Phone accessibility ---
  // Deduplicate by normalised digit string across all pages — the same number
  // in the header/footer of every crawled page should count as one, not many.
  const uniqueClickableNumbers = new Set(
    pagesData.flatMap(p => p.phones.clickable.map(ph => ph.number))
  );
  const uniquePlainTextDigits = new Set(
    pagesData.flatMap(p => p.phones.plainText.map(ph => ph.digits))
  );
  // Don't double-count a plain-text instance of a number that's also clickable
  uniqueClickableNumbers.forEach(n => uniquePlainTextDigits.delete(n));

  const totalClickablePhones = uniqueClickableNumbers.size;
  const totalPlainTextPhones  = uniquePlainTextDigits.size;
  const phonesAboveFold = pagesData.some(p => (p.above_fold_ctas?.phone_links?.length ?? 0) > 0);

  let phoneVerdict = 'none';
  if (totalClickablePhones > 0 && totalPlainTextPhones === 0) {
    phoneVerdict = 'good';
    strengths.push('All phone numbers are clickable — trackable and tappable on mobile');
  } else if (totalClickablePhones > 0 && totalPlainTextPhones > 0) {
    phoneVerdict = 'partial';
    issues.push(`${totalPlainTextPhones} plain-text phone number(s) alongside ${totalClickablePhones} clickable — plain-text ones are not trackable or tappable on mobile`);
    recommendations.push('Wrap remaining plain-text phone numbers in <a href="tel:..."> tags');
  } else if (totalPlainTextPhones > 0) {
    phoneVerdict = 'poor';
    issues.push(`${totalPlainTextPhones} phone number(s) are plain text — not clickable on mobile and not trackable in GA4`);
    recommendations.push('Wrap all phone numbers in <a href="tel:..."> tags');
  }

  if (phonesAboveFold) {
    strengths.push('Phone number is visible in the first fold — immediately accessible to visitors');
  } else if (totalClickablePhones > 0 || totalPlainTextPhones > 0) {
    issues.push('Phone number is not visible above the fold — users must scroll to find it');
    recommendations.push('Move phone number to the header or hero section so it is immediately visible');
  }

  // --- Email accessibility ---
  const totalClickableEmails = pagesData.reduce((n, p) => n + p.emails.clickable.length, 0);
  const totalPlainTextEmails  = pagesData.reduce((n, p) => n + p.emails.plainText.length, 0);

  let emailVerdict = 'none';
  if (totalClickableEmails > 0 && totalPlainTextEmails === 0) {
    emailVerdict = 'good';
    strengths.push('Email addresses are clickable mailto: links — trackable in GA4');
  } else if (totalClickableEmails > 0 && totalPlainTextEmails > 0) {
    emailVerdict = 'partial';
    issues.push(`${totalPlainTextEmails} plain-text email address(es) found alongside clickable ones — plain-text ones are not trackable`);
    recommendations.push('Wrap plain-text email addresses in <a href="mailto:..."> tags');
  } else if (totalPlainTextEmails > 0) {
    emailVerdict = 'poor';
    issues.push(`${totalPlainTextEmails} email address(es) are plain text — not clickable or trackable`);
    recommendations.push('Wrap all email addresses in <a href="mailto:..."> tags');
  }

  // --- Above the fold ---
  const homepageAboveFold = pagesData.find(p => p.label === 'homepage')?.above_fold_ctas;
  const aboveFoldCount = homepageAboveFold
    ? (homepageAboveFold.phone_links.length + homepageAboveFold.email_links.length +
       homepageAboveFold.whatsapp_links.length + homepageAboveFold.cta_buttons.length)
    : 0;

  if (aboveFoldCount > 0) {
    strengths.push(`${aboveFoldCount} CTA(s) visible above the fold on the homepage — visitors see them immediately`);
  } else {
    issues.push('No CTAs (phone, email, booking button) are visible above the fold on the homepage');
    recommendations.push('Add a prominent call-to-action (e.g. "Book Now" button or phone number) in the hero section');
  }

  // --- Form friction ---
  const allForms = pagesData.flatMap(p => p.forms || []);
  const avgFieldCount     = allForms.length ? Math.round(allForms.reduce((n, f) => n + (f.field_count ?? f.fields?.length ?? 0), 0) / allForms.length) : 0;
  const avgRequiredCount  = allForms.length ? Math.round(allForms.reduce((n, f) => n + (f.required_field_count ?? 0), 0) / allForms.length) : 0;
  const highFrictionForms = allForms.filter(f => f.friction_level === 'high').length;

  let formFrictionVerdict = 'none';
  if (allForms.length > 0) {
    if (highFrictionForms > 0) {
      formFrictionVerdict = 'high';
      issues.push(`${highFrictionForms} form(s) have more than 6 fields — high friction, likely reducing conversions`);
      recommendations.push('Reduce contact forms to 4 fields or fewer (name, phone or email, message, submit)');
    } else if (avgFieldCount > 4) {
      formFrictionVerdict = 'medium';
      issues.push(`Contact forms average ${avgFieldCount} fields — moderate friction for users`);
      recommendations.push('Consider trimming form fields to improve conversion rate');
    } else {
      formFrictionVerdict = 'low';
      strengths.push(`Contact forms are concise (avg ${avgFieldCount} fields) — low friction for users`);
    }
  }

  // --- Booking journey ---
  const allBookingCTAs    = pagesData.flatMap(p => p.booking_ctas || []);
  const successfulCTAs    = allBookingCTAs.filter(c => c.destination_type !== 'error');
  const directToPlatform  = successfulCTAs.filter(c => c.destination_type === 'booking_platform').length;
  const highHopCTAs       = successfulCTAs.filter(c => (c.redirect_hops ?? 0) > 1);
  const avgRedirectHops   = successfulCTAs.length
    ? Math.round(successfulCTAs.reduce((n, c) => n + (c.redirect_hops ?? 0), 0) / successfulCTAs.length * 10) / 10
    : 0;

  const ctasWithClickDepth = successfulCTAs.filter(c => c.clicks_to_book !== null && c.clicks_to_book !== undefined);
  const minClicksToBook    = ctasWithClickDepth.length
    ? Math.min(...ctasWithClickDepth.map(c => c.clicks_to_book))
    : null;

  if (allBookingCTAs.length === 0) {
    issues.push('No booking CTAs detected on the site — visitors may not know how to book');
    recommendations.push('Add a visible "Book Now" or "Schedule" button linking directly to your booking system');
  } else if (directToPlatform > 0) {
    strengths.push(`${directToPlatform} booking CTA(s) link directly to a booking platform — minimal friction`);
  }

  if (minClicksToBook !== null && minClicksToBook > 1) {
    issues.push(`Booking requires at least ${minClicksToBook} clicks from the page — consider adding a direct booking CTA higher up`);
    recommendations.push('Add a direct "Book Now" link to your booking platform in the header or hero section');
  } else if (minClicksToBook === 1) {
    strengths.push('Booking is reachable in 1 click from at least one page CTA');
  }

  if (highHopCTAs.length > 0) {
    issues.push(`${highHopCTAs.length} booking CTA(s) pass through multiple redirects before reaching the destination — adds load time and drop-off risk`);
    recommendations.push('Update booking CTA links to point directly to the final booking URL to reduce redirects');
  }

  // --- Overall score ---
  let score = 100;
  if (phoneVerdict === 'poor')         score -= 20;
  else if (phoneVerdict === 'partial') score -= 10;
  if (!phonesAboveFold && (totalClickablePhones + totalPlainTextPhones) > 0) score -= 5;
  if (emailVerdict === 'poor')         score -= 10;
  else if (emailVerdict === 'partial') score -= 5;
  if (aboveFoldCount === 0)            score -= 15;
  if (formFrictionVerdict === 'high')  score -= 15;
  else if (formFrictionVerdict === 'medium') score -= 5;
  if (allBookingCTAs.length === 0)     score -= 10;
  score -= highHopCTAs.length * 5;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';

  return {
    overall_score: score,
    grade,
    phone_quality: {
      unique_clickable:  totalClickablePhones,
      unique_plain_text: totalPlainTextPhones,
      above_fold:        phonesAboveFold,
      verdict:           phoneVerdict,
    },
    email_quality: {
      clickable_count:  totalClickableEmails,
      plain_text_count: totalPlainTextEmails,
      verdict:          emailVerdict,
    },
    above_fold: {
      has_phone:      (homepageAboveFold?.phone_links?.length ?? 0) > 0,
      has_email:      (homepageAboveFold?.email_links?.length ?? 0) > 0,
      has_whatsapp:   (homepageAboveFold?.whatsapp_links?.length ?? 0) > 0,
      has_cta_button: (homepageAboveFold?.cta_buttons?.length ?? 0) > 0,
      elements:       homepageAboveFold ?? {},
    },
    form_friction: {
      forms_found:         allForms.length,
      avg_field_count:     avgFieldCount,
      avg_required_fields: avgRequiredCount,
      high_friction_forms: highFrictionForms,
      verdict:             formFrictionVerdict,
    },
    booking_journey: {
      ctas_found:         allBookingCTAs.length,
      min_clicks_to_book: minClicksToBook,
      avg_redirect_hops:  avgRedirectHops,
      direct_to_platform: directToPlatform,
      high_hop_ctas:      highHopCTAs.length,
    },
    strengths,
    issues,
    recommendations,
  };
}

async function ctaAuditSite(url) {
  const startTime = Date.now();

  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });

    await context.route('**/*', async route => {
      const request = route.request();
      const resourceType = request.resourceType();

      if (['image', 'media', 'font'].includes(resourceType)) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    const page = await context.newPage();
    const pagesCrawled = [];
    const pagesData = [];

    // Load homepage
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});

    await acceptCookieConsent(page);

    pagesCrawled.push(url);

    // Extract data from homepage
    const homepageData = {
      url,
      label: 'homepage',
      phones: await extractPhones(page, url),
      emails: await extractEmails(page, url),
      whatsapp: await extractWhatsApp(page, url),
      booking_links: await extractBookingLinks(page, url),
      booking_ctas: await extractBookingCTAs(page, context, url),
      social_links: await extractSocialLinks(page, url),
      newsletter: await extractNewsletter(page, url),
      forms: await extractForms(page, url),
      live_chat: await extractLiveChat(page),
      above_fold_ctas: await extractAboveFoldCTAs(page),
    };

    pagesData.push(homepageData);

    // Find and crawl contact page
    const contactPageUrl = await findContactPageUrl(page, url);
    if (contactPageUrl && contactPageUrl !== url) {
      try {
        await page.goto(contactPageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});

        pagesCrawled.push(contactPageUrl);

        const contactPageData = {
          url: contactPageUrl,
          label: 'contact',
          phones: await extractPhones(page, contactPageUrl),
          emails: await extractEmails(page, contactPageUrl),
          whatsapp: await extractWhatsApp(page, contactPageUrl),
          booking_links: await extractBookingLinks(page, contactPageUrl),
          booking_ctas: await extractBookingCTAs(page, context, contactPageUrl),
          social_links: await extractSocialLinks(page, contactPageUrl),
          newsletter: await extractNewsletter(page, contactPageUrl),
          forms: await extractForms(page, contactPageUrl),
          live_chat: await extractLiveChat(page),
          above_fold_ctas: await extractAboveFoldCTAs(page),
        };

        pagesData.push(contactPageData);
      } catch (e) {
        console.error('Failed to crawl contact page:', e.message);
      }
    }

    await context.close();

    const gtmSummary = await generateGTMSummary(pagesData);

    return {
      website_url: url,
      ran_at: new Date().toISOString(),
      pages_crawled: pagesCrawled,
      pages: pagesData,
      gtm_summary: gtmSummary,
      cta_quality: generateCTAQualityReport(pagesData),
      duration_ms: Date.now() - startTime
    };

  } catch (error) {
    console.error('CTA audit error:', error);
    throw new Error(`CTA audit failed: ${error.message}`);
  }
}

module.exports = { ctaAuditSite };