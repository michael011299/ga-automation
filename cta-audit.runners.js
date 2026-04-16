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
    const clickable = [];
    const plainText = [];

    // Find clickable tel: links
    document.querySelectorAll('a[href^="tel:"]').forEach(a => {
      const href = a.getAttribute('href');
      const number = href.replace('tel:', '').replace(/\D/g, '');
      clickable.push({
        href,
        number,
        display_text: a.textContent.trim(),
        clickable: true
      });
    });

    // Find plain text phone numbers
    const phoneRegex = /(?:\+?44\s*)?(?:\(?0\d{1,5}\)?\s*\d{3,4}\s*\d{3,4}|\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/g;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest('a[href^="tel:"]')) return NodeFilter.FILTER_REJECT;
          if (parent.closest('script, style, noscript')) return NodeFilter.FILTER_REJECT;
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
          if (digits.length >= 10 && digits.length <= 15) {
            plainText.push({
              number: match,
              digits,
              clickable: false
            });
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

        formData.push({
          page_url: pageUrl,
          form_index: index,
          fields,
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

  pageData.forEach(page => {
    totalClickablePhones += page.phones.clickable.length;
    totalPlainTextPhones += page.phones.plain_text.length;
    totalClickableEmails += page.emails.clickable.length;
    totalPlainTextEmails += page.emails.plain_text.length;
    totalWhatsAppLinks += page.whatsapp.links.length;
    totalBookingLinks += page.booking_links.length;
    totalForms += page.forms.length;
    totalNewsletterForms += page.newsletter.length;
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

  // Live chat warnings
  const liveChatServices = pageData[0]?.live_chat || [];
  liveChatServices.forEach(service => {
    if (['Intercom', 'Drift', 'HubSpot Chat'].includes(service.name)) {
      warnings.push(`${service.name} live chat detected — already has own analytics`);
    }
  });

  return { tags_to_create: tagsToCreate, fixes_needed: fixesNeeded, warnings };
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
      newsletter: await extractNewsletter(page, url),
      forms: await extractForms(page, url),
      live_chat: await extractLiveChat(page)
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
          newsletter: await extractNewsletter(page, contactPageUrl),
          forms: await extractForms(page, contactPageUrl),
          live_chat: await extractLiveChat(page)
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
      duration_ms: Date.now() - startTime
    };

  } catch (error) {
    console.error('CTA audit error:', error);
    throw new Error(`CTA audit failed: ${error.message}`);
  }
}

module.exports = { ctaAuditSite };