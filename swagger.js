/**
 * swagger.js
 *
 * OpenAPI 3.0 spec for all runner + health endpoints.
 * Served at GET /docs by runners.js (port 3000 / gateway port 8080).
 *
 * Coverage:
 *   Runners (port 3000):
 *     GET    /accounts
 *     PATCH  /accounts/:id/capacity
 *     POST   /accounts/scan-capacity
 *     POST   /run  (all actions)
 *
 *   Health (port 3001, proxied via gateway at /health/...):
 *     GET    /health
 *     POST   /health/run
 *     POST   /health/batch
 *     GET    /health/batch/:job_id
 *     POST   /health/audit
 */

const spec = {
  openapi: "3.0.3",
  info: {
    title: "GA Automation API",
    version: "1.0.0",
    description:
      "Automation runner and health-check API. All requests go through the gateway on port 8080. " +
      "Runner actions are at `/run`; health checks are at `/health/...`.",
  },
  servers: [{ url: "http://localhost:8080", description: "Gateway (production entry point)" }],

  tags: [
    { name: "Accounts", description: "Google account capacity management" },
    { name: "Runner", description: "Browser-automation actions dispatched via POST /run" },
    { name: "Health", description: "Site tracking health checks" },
  ],

  paths: {
    // ──────────────────────────────────────────────────────────────────────────
    // ACCOUNTS
    // ──────────────────────────────────────────────────────────────────────────
    "/accounts": {
      get: {
        tags: ["Accounts"],
        summary: "List all Google accounts",
        description:
          "Returns all 12 Google accounts ordered by account_index. " +
          "Includes current ga4_property_count and gtm_container_count.",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    accounts: {
                      type: "array",
                      items: { $ref: "#/components/schemas/GoogleAccount" },
                    },
                  },
                },
              },
            },
          },
          500: { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },

    "/accounts/{id}/capacity": {
      patch: {
        tags: ["Accounts"],
        summary: "Set ga4_property_count / gtm_container_count on one account",
        description:
          "Directly overwrite the stored counts. Useful when the DB count drifts from reality. " +
          "Provide at least one of the two fields.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "UUID of the google_accounts row",
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ga4_property_count: {
                    type: "integer",
                    example: 5,
                    description: "Number of GA4 properties created under this account",
                  },
                  gtm_container_count: {
                    type: "integer",
                    example: 3,
                    description: "Number of GTM containers created under this account",
                  },
                },
              },
              example: { ga4_property_count: 5, gtm_container_count: 3 },
            },
          },
        },
        responses: {
          200: {
            description: "Updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    id: { type: "string", example: "uuid-here" },
                    updated: {
                      type: "object",
                      example: { ga4_property_count: 5 },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "No updatable fields provided",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorBody" },
              },
            },
          },
          500: { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },

    "/accounts/scan-capacity": {
      post: {
        tags: ["Accounts"],
        summary: "Live-scan GA4 account capacity for multiple accounts",
        description:
          "Logs into each Google account via Playwright, navigates to the GA4 account-creation page, " +
          "and reads how many accounts remain. Runs sequentially. Can take several minutes for 12 accounts.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["accounts"],
                properties: {
                  accounts: {
                    type: "array",
                    description: "Array of google_accounts rows (must include google_email and google_password)",
                    items: {
                      type: "object",
                      required: ["google_email", "google_password"],
                      properties: {
                        id: { type: "string", format: "uuid" },
                        account_name: { type: "string", example: "leadgen-accesss.uk.1" },
                        google_email: { type: "string", example: "leadgen1@example.com" },
                        google_password: { type: "string", example: "password123" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Scan complete",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          account_name: { type: "string" },
                          google_email: { type: "string" },
                          remaining: { type: "integer", nullable: true, example: 68 },
                          used: { type: "integer", nullable: true, example: 32 },
                          max: { type: "integer", example: 100 },
                          error: { type: "string", nullable: true, example: null },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { $ref: "#/components/responses/ErrorResponse" },
          500: { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },

    // ──────────────────────────────────────────────────────────────────────────
    // RUNNER — /run
    // ──────────────────────────────────────────────────────────────────────────
    "/run": {
      post: {
        tags: ["Runner"],
        summary: "Dispatch a browser-automation action",
        description:
          "Single endpoint for all automation actions. Set `action` to one of the values below. " +
          "Required fields vary per action — see the request body examples.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RunRequest" },
              examples: {
                search_ga4_accounts: {
                  summary: "Search GA4 accounts by name",
                  value: { action: "search_ga4_accounts", query: "Harris Decs" },
                },
                fetch_ga4_measurement_id: {
                  summary: "Fetch measurement ID for an existing GA4 property",
                  value: {
                    action: "fetch_ga4_measurement_id",
                    google_email: "leadgen1@example.com",
                    property_id: "531534461",
                  },
                },
                setup_gtm_tags: {
                  summary: "Create workspace + click vars + triggers + GA4 tags via API",
                  value: {
                    action: "setup_gtm_tags",
                    google_email: "leadgen1@example.com",
                    numeric_account_id: "123456789",
                    numeric_container_id: "987654321",
                    measurement_id: "G-XXXXXXXXXX",
                  },
                },
                register_ga4_conversions: {
                  summary: "Register click_call / click_email / contact_form as GA4 conversions",
                  value: {
                    action: "register_ga4_conversions",
                    google_email: "leadgen1@example.com",
                    property_id: "531534461",
                  },
                },
                handle_new_case: {
                  summary: "Run the full orchestrator for a Supabase automation_cases row",
                  value: { action: "handle_new_case", case_id: "75e2bd32-..." },
                },
                submit_google_otp: {
                  summary: "Submit Google 2FA code into a paused browser session",
                  value: {
                    action: "submit_google_otp",
                    sessionId: "otp_1713350400000",
                    otp_code: "123456",
                  },
                },
                create_ga4_full: {
                  summary: "Check capacity + create GA4 account + property + fetch IDs in one session",
                  value: {
                    action: "create_ga4_full",
                    google_email: "leadgen1@example.com",
                    google_password: "password123",
                    account_name: "AP - Harris Decs",
                    property_name: "AP - Harris Decs",
                    website_url: "https://www.harrisdecs.co.uk",
                  },
                },
                create_ga_account: {
                  summary: "Create a new GA4 account (without fetching IDs)",
                  value: {
                    action: "create_ga_account",
                    google_email: "leadgen1@example.com",
                    google_password: "password123",
                    account_name: "AP - Harris Decs",
                    property_name: "AP - Harris Decs",
                    website_url: "https://www.harrisdecs.co.uk",
                  },
                },
                fetch_gtag_and_property_id: {
                  summary: "Fetch gtag snippet + property ID from an existing GA4 property",
                  value: {
                    action: "fetch_gtag_and_property_id",
                    google_email: "leadgen1@example.com",
                    google_password: "password123",
                    account_name: "AP - Harris Decs",
                    property_name: "AP - Harris Decs",
                    website_url: "https://www.harrisdecs.co.uk",
                  },
                },
                check_gtm_capacity: {
                  summary: "Check GTM account has space + create container if it does",
                  value: {
                    action: "check_gtm_capacity",
                    google_email: "leadgen1@example.com",
                    google_password: "password123",
                    gtm_account_name: "AP - Harris Decs",
                    container_url: "https://www.harrisdecs.co.uk",
                  },
                },
                configure_and_publish_gtm: {
                  summary: "Publish the AP Tracking Setup workspace in an existing GTM container",
                  value: {
                    action: "configure_and_publish_gtm",
                    google_email: "leadgen1@example.com",
                    google_password: "password123",
                    gtm_container_id: "GTM-XXXXXXX",
                    numeric_account_id: "123456789",
                    numeric_container_id: "987654321",
                    workspace_id: "5",
                  },
                },
                install_gtm_codes: {
                  summary: "Install GTM head + body codes into a CMS (WordPress / Wix / Squarespace)",
                  value: {
                    action: "install_gtm_codes",
                    website_url: "https://www.harrisdecs.co.uk",
                    cms_type: "wordpress",
                    wp_admin_url: "https://www.harrisdecs.co.uk/wp-admin",
                    cms_username: "admin",
                    cms_password: "password123",
                    gtm_head_code: "<!-- GTM head snippet -->",
                    gtm_body_code: "<!-- GTM body snippet -->",
                  },
                },
                add_search_console_property: {
                  summary: "Add a URL-prefix property to Google Search Console",
                  value: {
                    action: "add_search_console_property",
                    google_email: "leadgen1@example.com",
                    google_password: "password123",
                    website_url: "https://www.harrisdecs.co.uk",
                  },
                },
                fetch_gtm_codes: {
                  summary: "Fetch GTM head + body install snippets from an existing container",
                  value: {
                    action: "fetch_gtm_codes",
                    google_email: "leadgen1@example.com",
                    google_password: "password123",
                    gtm_container_id: "GTM-XXXXXXX",
                  },
                },
                test_tracking_ctas: {
                  summary: "Test phone/email/form CTAs and confirm GTM events fire",
                  value: {
                    action: "test_tracking_ctas",
                    google_email: "leadgen1@example.com",
                    google_password: "password123",
                    website_url: "https://www.harrisdecs.co.uk",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description:
              "Action result. Shape depends on the action — see individual action schemas below.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RunResponse" },
                examples: {
                  success_create_ga4_full: {
                    summary: "create_ga4_full — success",
                    value: {
                      status: "success",
                      account_name: "AP - Harris Decs",
                      property_name: "AP - Harris Decs",
                      property_id: "531534461",
                      measurement_id: "G-3NZF3E61Z5",
                      gtag: "<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-3NZF3E61Z5\"></script>...",
                    },
                  },
                  failed_account_no_space: {
                    summary: "create_ga4_full — account full",
                    value: { status: "failed", reason: "account_no_space" },
                  },
                  failed_automation_error: {
                    summary: "Any action — unhandled automation error",
                    value: {
                      status: "failed",
                      reason: "automation_error",
                      error: "locator.waitFor timeout exceeded",
                      page_url: "https://analytics.google.com/...",
                      page_snippet: "Welcome to Google Analytics...",
                      screenshot_b64: "iVBORw0KGgo...",
                    },
                  },
                  success_check_gtm_capacity: {
                    summary: "check_gtm_capacity — container created",
                    value: {
                      status: "success",
                      reason: "gtm_has_space",
                      codes: {
                        gtmId: "GTM-XXXXXXX",
                        numericAccountId: "123456789",
                        numericContainerId: "987654321",
                        gtmHeadCode: "<!-- GTM head -->",
                        gtmBodyCode: "<!-- GTM body -->",
                      },
                    },
                  },
                  success_search_ga4_accounts: {
                    summary: "search_ga4_accounts — found",
                    value: {
                      status: "found",
                      query: "Harris Decs",
                      count: 1,
                      matches: [
                        {
                          ga4_account_name: "AP - Harris Decs",
                          ga4_account_id: "531534461",
                          google_account_name: "leadgen-accesss.uk.1",
                          google_email: "leadgen1@example.com",
                        },
                      ],
                    },
                  },
                  success_setup_gtm_tags: {
                    summary: "setup_gtm_tags — success",
                    value: {
                      status: "success",
                      workspace_id: "5",
                      call_trigger_id: "10",
                      email_trigger_id: "11",
                      form_trigger_id: "12",
                    },
                  },
                  success_fetch_gtm_codes: {
                    summary: "fetch_gtm_codes — success",
                    value: {
                      status: "success",
                      gtm_container_id: "GTM-XXXXXXX",
                      gtm_head_code: "<!-- GTM head snippet -->",
                      gtm_body_code: "<!-- GTM body noscript -->",
                      numeric_account_id: "123456789",
                      numeric_container_id: "987654321",
                    },
                  },
                  success_search_console_verified: {
                    summary: "add_search_console_property — auto-verified",
                    value: {
                      status: "success",
                      message: "Search Console property added and auto-verified",
                      website_url: "https://www.harrisdecs.co.uk",
                      verified: true,
                      method: "auto_verified",
                    },
                  },
                  success_search_console_partial: {
                    summary: "add_search_console_property — manual verification needed",
                    value: {
                      status: "partial",
                      message: "Search Console property added but could not auto-verify",
                      website_url: "https://www.harrisdecs.co.uk",
                      verified: false,
                      html_meta_tag: "<meta name=\"google-site-verification\" content=\"...\">",
                    },
                  },
                  success_test_tracking_ctas: {
                    summary: "test_tracking_ctas — success",
                    value: {
                      status: "success",
                      website_url: "https://www.harrisdecs.co.uk",
                      phones: [{ href: "tel:01234567890", text: "01234567890", status: "PASS", events: ["click_call"] }],
                      emails: [{ href: "mailto:info@harrisdecs.co.uk", text: "info@harrisdecs.co.uk", status: "PASS", events: ["click_email"] }],
                      forms: [{ selector: "form.contact", status: "PASS", events: ["contact_form"] }],
                      summary: { phones_found: 1, phones_passed: 1, emails_found: 1, emails_passed: 1, forms_found: 1, forms_passed: 1 },
                    },
                  },
                  need_otp: {
                    summary: "Any action that hits Google 2FA",
                    value: {
                      status: "need_code",
                      stage: "google_otp",
                      sessionId: "otp_1713350400000",
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Unknown action or missing required field",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorBody" },
              },
            },
          },
        },
      },
    },

    // ──────────────────────────────────────────────────────────────────────────
    // HEALTH
    // ──────────────────────────────────────────────────────────────────────────
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Server liveness check",
        responses: {
          200: {
            description: "Server is alive",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/health/run": {
      post: {
        tags: ["Health"],
        summary: "Run a tracking health check on a single site",
        description:
          "Visits the site with a headless browser, handles cookie consent, detects GTM and GA4 IDs, " +
          "tests phone/email/form CTA events, and returns a full tracking report.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action", "url"],
                properties: {
                  action: {
                    type: "string",
                    enum: ["tracking_health_check_site"],
                    example: "tracking_health_check_site",
                  },
                  url: { type: "string", example: "https://floright.ie/" },
                  expected: {
                    type: "object",
                    nullable: true,
                    description: "Optional expected values for comparison in the response",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Health check result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthCheckResult" },
                examples: {
                  has_tracking: {
                    summary: "Site has GTM + GA4",
                    value: {
                      ok: true,
                      status: "HEALTHY",
                      url: "https://floright.ie/",
                      has_gtm: true,
                      has_ga4: true,
                      detected_gtm_ids: ["GTM-N7TZ783Z", "GTM-TCJP9X4B"],
                      detected_ga4_ids: ["G-XXXXXXXXXX"],
                      phone_found: 1,
                      phone_passed: 1,
                      email_found: 0,
                      form_found: 1,
                      form_passed: 1,
                      duration_ms: 28450,
                      expected: null,
                    },
                  },
                  no_tracking: {
                    summary: "Site has no tracking",
                    value: {
                      ok: true,
                      status: "NO_TRACKING",
                      url: "https://example.com/",
                      has_gtm: false,
                      has_ga4: false,
                      detected_gtm_ids: [],
                      detected_ga4_ids: [],
                      phone_found: 0,
                      email_found: 0,
                      form_found: 0,
                      duration_ms: 4100,
                      expected: null,
                    },
                  },
                },
              },
            },
          },
          400: {
            description: "Missing URL or unknown action",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorBody" },
              },
            },
          },
          500: { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },

    "/health/batch": {
      post: {
        tags: ["Health"],
        summary: "Queue a batch health check for multiple sites",
        description:
          "Starts a background job and returns immediately with a `job_id`. " +
          "Poll `GET /health/batch/{job_id}` to get progress and results. " +
          "Accepts either `clients` (objects with metadata) or legacy `urls` (plain strings). " +
          "Maximum 2000 entries per batch.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  clients: {
                    type: "array",
                    description: "Preferred: rich client objects",
                    items: {
                      type: "object",
                      required: ["url"],
                      properties: {
                        url: { type: "string", example: "https://floright.ie/" },
                        client_name: { type: "string", example: "Floright Plumbing" },
                        supabase_id: { type: "string" },
                        cid: { type: "string" },
                        order_number: { type: "string" },
                      },
                    },
                  },
                  urls: {
                    type: "array",
                    description: "Legacy: plain URL strings",
                    items: { type: "string", example: "https://floright.ie/" },
                  },
                  callback_url: {
                    type: "string",
                    nullable: true,
                    description: "Optional webhook URL to POST results to when the job completes",
                    example: "https://your-n8n-instance.com/webhook/health-batch",
                  },
                },
              },
              examples: {
                clients_array: {
                  summary: "Rich client objects",
                  value: {
                    clients: [
                      { url: "https://floright.ie/", client_name: "Floright Plumbing", order_number: "ORD-001" },
                      { url: "https://harrisdecs.co.uk/", client_name: "Harris Decs", order_number: "ORD-002" },
                    ],
                    callback_url: "https://n8n.example.com/webhook/batch-done",
                  },
                },
                urls_array: {
                  summary: "Legacy plain URLs",
                  value: { urls: ["https://floright.ie/", "https://harrisdecs.co.uk/"] },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: "Batch job queued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    job_id: { type: "string", example: "a1b2c3d4-..." },
                    queued: { type: "integer", example: 2 },
                    status_url: { type: "string", example: "/health/batch/a1b2c3d4-..." },
                    message: { type: "string", example: "Batch job started" },
                  },
                },
              },
            },
          },
          400: { $ref: "#/components/responses/ErrorResponse" },
          500: { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },

    "/health/batch/{job_id}": {
      get: {
        tags: ["Health"],
        summary: "Get batch job status and results",
        parameters: [
          {
            name: "job_id",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "a1b2c3d4-...",
          },
        ],
        responses: {
          200: {
            description: "Job status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    job_id: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["running", "complete"],
                      example: "running",
                    },
                    total: { type: "integer", example: 100 },
                    completed: { type: "integer", example: 47 },
                    results: {
                      type: "array",
                      items: { $ref: "#/components/schemas/HealthCheckResult" },
                    },
                    startedAt: { type: "string", format: "date-time" },
                    completedAt: {
                      type: "string",
                      format: "date-time",
                      nullable: true,
                      description: "Set when status = complete",
                    },
                  },
                },
              },
            },
          },
          404: {
            description: "Job not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorBody" },
              },
            },
          },
        },
      },
    },

    "/health/audit": {
      post: {
        tags: ["Health"],
        summary: "CTA audit — discover all trackable conversion points on a site",
        description:
          "Crawls the homepage and contact page with a headless browser. " +
          "Discovers phones, emails, WhatsApp links, booking platform embeds, " +
          "contact/newsletter forms, and live chat widgets. " +
          "Tests form submission behaviour and generates a GTM tag recommendation list. " +
          "Timeout: 120 seconds.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: {
                    type: "string",
                    example: "https://floright.ie/",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "CTA audit result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuditResult" },
                example: {
                  ok: true,
                  url: "https://floright.ie/",
                  pages_crawled: ["https://floright.ie/", "https://floright.ie/contact/"],
                  ctas: {
                    phones: [{ text: "01 234 5678", href: "tel:012345678", clickable: true, source_page: "homepage" }],
                    emails: [],
                    whatsapp: [],
                    booking_platforms: [],
                    forms: [
                      {
                        source_page: "contact",
                        action: "/contact",
                        fields: ["name", "email", "message"],
                        submission_result: "redirect",
                        success_detected: true,
                      },
                    ],
                    newsletter_forms: [],
                    live_chat: [],
                  },
                  gtm_summary: {
                    tags_to_create: ["GA4 Event — click_call", "GA4 Event — contact_form"],
                    fixes_needed: [],
                    warnings: [],
                  },
                },
              },
            },
          },
          400: {
            description: "URL is required",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorBody" },
              },
            },
          },
          500: { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // COMPONENTS
  // ──────────────────────────────────────────────────────────────────────────
  components: {
    schemas: {
      GoogleAccount: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          account_name: { type: "string", example: "leadgen-accesss.uk.1" },
          account_index: { type: "integer", example: 1 },
          google_email: { type: "string", example: "leadgen1@example.com" },
          ga4_property_count: { type: "integer", example: 4 },
          gtm_container_count: { type: "integer", example: 2 },
        },
      },

      RunRequest: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: [
              "search_ga4_accounts",
              "fetch_ga4_measurement_id",
              "setup_gtm_tags",
              "register_ga4_conversions",
              "handle_new_case",
              "submit_google_otp",
              "login_and_create_ga4",
              "create_ga4_full",
              "create_ga_account",
              "fetch_gtag_and_property_id",
              "check_gtm_capacity",
              "configure_and_publish_gtm",
              "install_gtm_codes",
              "add_search_console_property",
              "fetch_gtm_codes",
              "test_tracking_ctas",
            ],
            description: "Which automation to run",
          },
          google_email: { type: "string", description: "Google account email (most browser actions)" },
          google_password: { type: "string", description: "Google account password (most browser actions)" },
          sso_username: { type: "string", description: "OneLogin SSO username (if account uses SSO)" },
          sso_password: { type: "string", description: "OneLogin SSO password (if account uses SSO)" },
          account_name: { type: "string", description: "GA4 account display name (e.g. 'AP - Harris Decs')" },
          property_name: { type: "string", description: "GA4 property display name" },
          website_url: { type: "string", description: "Client website URL" },
          gtm_account_name: { type: "string", description: "GTM account display name" },
          container_url: { type: "string", description: "Container URL for GTM (used as container name)" },
          gtm_container_id: { type: "string", description: "GTM container ID, e.g. GTM-XXXXXXX" },
          numeric_account_id: { type: "string", description: "Numeric GTM account ID from URL" },
          numeric_container_id: { type: "string", description: "Numeric GTM container ID from URL" },
          workspace_id: { type: "string", description: "GTM workspace ID" },
          measurement_id: { type: "string", description: "GA4 measurement ID, e.g. G-XXXXXXXXXX" },
          property_id: { type: "string", description: "GA4 numeric property ID" },
          cms_type: {
            type: "string",
            enum: ["wordpress", "wix", "squarespace"],
            description: "CMS type for install_gtm_codes",
          },
          wp_admin_url: { type: "string", description: "WordPress admin URL" },
          cms_username: { type: "string", description: "CMS login username" },
          cms_password: { type: "string", description: "CMS login password" },
          gtm_head_code: { type: "string", description: "GTM <head> script snippet" },
          gtm_body_code: { type: "string", description: "GTM <body> noscript snippet" },
          query: { type: "string", description: "Search query for search_ga4_accounts" },
          case_id: { type: "string", description: "Supabase automation_cases UUID (handle_new_case)" },
          sessionId: { type: "string", description: "OTP session ID returned by a paused action" },
          otp_code: { type: "string", description: "6-digit Google 2FA code" },
        },
      },

      RunResponse: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["success", "failed", "partial", "error", "found", "not_found", "need_code"],
          },
          reason: {
            type: "string",
            enum: ["account_no_space", "gtm_no_space", "gtm_has_space", "account_has_space", "automation_error"],
            nullable: true,
          },
          error: { type: "string", nullable: true, description: "Error message (when status = failed/error)" },
          page_url: { type: "string", nullable: true, description: "URL where automation failed" },
          page_snippet: { type: "string", nullable: true, description: "First 300 chars of page text at failure" },
          screenshot_b64: { type: "string", nullable: true, description: "Base64 PNG screenshot taken at failure" },
        },
        description: "Shape varies per action — see the examples on this endpoint for each action's full response.",
      },

      HealthCheckResult: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          status: {
            type: "string",
            enum: ["HEALTHY", "PARTIAL", "NO_TRACKING", "ERROR"],
          },
          url: { type: "string" },
          has_gtm: { type: "boolean" },
          has_ga4: { type: "boolean" },
          detected_gtm_ids: { type: "array", items: { type: "string" } },
          detected_ga4_ids: { type: "array", items: { type: "string" } },
          phone_found: { type: "integer" },
          phone_passed: { type: "integer" },
          email_found: { type: "integer" },
          email_passed: { type: "integer" },
          form_found: { type: "integer" },
          form_passed: { type: "integer" },
          duration_ms: { type: "integer", nullable: true },
          error: { type: "string", nullable: true },
          expected: { type: "object", nullable: true },
        },
      },

      AuditResult: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          url: { type: "string" },
          pages_crawled: { type: "array", items: { type: "string" } },
          ctas: {
            type: "object",
            properties: {
              phones: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    href: { type: "string" },
                    clickable: { type: "boolean" },
                    source_page: { type: "string", enum: ["homepage", "contact"] },
                  },
                },
              },
              emails: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    href: { type: "string" },
                    source_page: { type: "string" },
                  },
                },
              },
              whatsapp: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    href: { type: "string" },
                    source_page: { type: "string" },
                  },
                },
              },
              booking_platforms: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    platform: { type: "string", example: "Calendly" },
                    url: { type: "string" },
                    embed_type: { type: "string", enum: ["link", "iframe"] },
                    source_page: { type: "string" },
                  },
                },
              },
              forms: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    source_page: { type: "string" },
                    action: { type: "string" },
                    fields: { type: "array", items: { type: "string" } },
                    submission_result: {
                      type: "string",
                      enum: ["redirect", "inline_message", "unknown"],
                    },
                    success_detected: { type: "boolean" },
                  },
                },
              },
              social_links: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    platform: { type: "string", example: "Facebook" },
                    href: { type: "string" },
                    display_text: { type: "string" },
                    opens_new_tab: { type: "boolean" },
                    page_url: { type: "string" },
                  },
                },
              },
              newsletter_forms: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    platform: { type: "string", example: "Mailchimp" },
                    source_page: { type: "string" },
                  },
                },
              },
              live_chat: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    platform: { type: "string", example: "Tidio" },
                    source_page: { type: "string" },
                  },
                },
              },
            },
          },
          gtm_summary: {
            type: "object",
            properties: {
              tags_to_create: {
                type: "array",
                items: { type: "string" },
                description: "Recommended GTM tags to create based on discovered CTAs",
              },
              fixes_needed: {
                type: "array",
                items: { type: "string" },
                description: "Issues that must be resolved before tracking can work",
              },
              warnings: {
                type: "array",
                items: { type: "string" },
                description: "Non-blocking issues worth reviewing",
              },
            },
          },
        },
      },

      ErrorBody: {
        type: "object",
        properties: {
          ok: { type: "boolean", example: false },
          error: { type: "string", example: "URL is required" },
          status: { type: "string", example: "error" },
        },
      },
    },

    responses: {
      ErrorResponse: {
        description: "Server error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorBody" },
          },
        },
      },
    },
  },
};

module.exports = spec;
