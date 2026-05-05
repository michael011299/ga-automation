# ga-automation

A Node.js automation server that handles GA4 account creation, GTM container setup, CMS code installation, tracking health checks, and CTA audits across client websites.

Built with Playwright (headless browser automation) and Express (HTTP API). Deployed bare-metal on a Ubuntu VPS, managed with PM2.

**Server IP:** `95.217.208.221`

| Server       | Port   | Handles                                  |
| ------------ | ------ | ---------------------------------------- |
| `runners.js` | `3000` | GA4 / GTM / CMS automation, orchestrator |
| `server.js`  | `3001` | Health checks, CTA audits, offboarding   |

**Repo:** `https://github.com/michael011299/ga-automation`

---

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [Calling from n8n](#calling-from-n8n)
3. [API Reference — Automation Server (port 3000)](#api-reference--automation-server-port-3000)
4. [API Reference — Health & Audit Server (port 3001)](#api-reference--health--audit-server-port-3001)
5. [The Full Setup Orchestrator](#the-full-setup-orchestrator)
6. [Tracking Health Check Engine](#tracking-health-check-engine)
7. [CTA Audit Engine](#cta-audit-engine)
8. [Environment Variables](#environment-variables)
9. [Server Setup (Fresh Deploy)](#server-setup-fresh-deploy)
10. [Updating the Server](#updating-the-server)
11. [PM2 Process Management](#pm2-process-management)
12. [Checking Logs](#checking-logs)
13. [Key Dependencies](#key-dependencies)

---

## Repository Structure

```
ga-automation/
│
├── runners.js                  ← Automation server (port 3000)
├── server.js                   ← Health / audit server (port 3001)
├── gateway.js                  ← Internal reverse proxy (not called directly)
│
├── health.runners.js           ← Tracking health check engine
├── health.routes.js            ← Health check API routes (mounted on server.js)
│
├── cta-audit.runners.js        ← CTA audit crawler engine
├── audit-report-builder.js     ← Google Docs report builder for CTA audits
│
├── gtm-container-generator.js  ← Generates GTM container export JSON
├── gtm-payload-generator.js    ← Generates ordered GTM API call sequences
│
├── swagger.js                  ← Swagger/OpenAPI spec (served at /docs)
├── ecosystem.config.js         ← PM2 process definitions
├── package.json
├── .env.example                ← All environment variable names + defaults
│
├── src/
│   ├── api/
│   │   ├── ga4-api.js          ← GA4 Admin API calls
│   │   ├── gtm-api.js          ← GTM API calls
│   │   └── google-ads-api.js   ← Google Ads API
│   ├── lib/
│   │   ├── credentials.js      ← Supabase helpers
│   │   ├── supabase.js         ← Supabase client
│   │   ├── monday.js           ← Monday.com API helpers
│   │   └── google-oauth.js     ← OAuth2 token refresh
│   ├── orchestrator/
│   │   ├── entry.js            ← Routes new cases to the correct orchestrator
│   │   └── full-setup.js       ← 19-step full client onboarding sequence
│   └── playwright/
│       ├── google-login.js     ← Shared Google + OneLogin SSO login flow
│       ├── ga4.js              ← GA4 Playwright automation
│       ├── gtm.js              ← GTM Playwright automation
│       ├── cms.js              ← CMS login + GTM code installation
│       ├── search-console.js   ← Search Console property creation
│       └── tracking.js         ← CTA click testing
│
└── migrations/
    ├── 001_google_accounts.sql
    └── 002_automation_cases_step_columns.sql
```

---

## Calling from n8n

All calls use the **HTTP Request** node in n8n.

### Base URLs

- **Automation actions:** `http://95.217.208.221:3000`
- **Health checks & audits:** `http://95.217.208.221:3001`

### n8n HTTP Request node — standard setup

For every endpoint:

1. Add an **HTTP Request** node
2. Set **Method** to `POST` (or `GET` where noted)
3. Set **URL** as shown for each endpoint below
4. Under **Body**, select **JSON**
5. Either use **JSON/RAW Parameters** mode and paste the body, or use **Specify Body Fields** and add each field individually
6. Leave **Authentication** as `None`

To pass data from a previous node into the body, use n8n expressions: `{{ $json.field_name }}` or `{{ $node["NodeName"].json.field_name }}`.

---

## API Reference — Automation Server (port 3000)

### `POST /run` — Run Automation Action

**n8n node:**

```
Method : POST
URL    : http://95.217.208.221:3000/run
Body   : JSON — see action table below
```

All actions use the same endpoint — only the `action` field changes. Credentials (`email`, `sso_username`, `sso_password`) are passed per-request in the body and are never stored on the server.

---

#### `handle_new_case`

Routes a new Supabase case through the full 19-step onboarding orchestrator.

```json
{
  "action": "handle_new_case",
  "case_id": "uuid-from-supabase"
}
```

---

#### `login_and_create_ga4`

Navigates to GA4 and checks account capacity.

```json
{
  "action": "login_and_create_ga4",
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password"
}
```

---

#### `create_ga4_full`

Full GA4 account + property creation wizard.

```json
{
  "action": "create_ga4_full",
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password",
  "account_name": "Client Name",
  "property_name": "Client Website",
  "website_url": "https://example.com",
  "business_type": "Other",
  "timezone": "Europe/London",
  "currency": "GBP"
}
```

---

#### `fetch_ga4_measurement_id`

Opens an existing GA4 data stream and returns the measurement ID + gtag snippet.

```json
{
  "action": "fetch_ga4_measurement_id",
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password",
  "account_id": "283675043",
  "property_id": "456789012"
}
```

---

#### `check_gtm_capacity`

Tests whether a GTM account has space by navigating to the container creation form.

```json
{
  "action": "check_gtm_capacity",
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password",
  "gtm_account_name": "Client GTM Account"
}
```

---

#### `fetch_gtm_codes`

Opens a GTM container and returns the `<head>` and `<body>` install snippets plus numeric IDs.

```json
{
  "action": "fetch_gtm_codes",
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password",
  "account_id": "6300697388",
  "container_id": "98765432"
}
```

---

#### `configure_and_publish_gtm`

Navigates to a GTM workspace and publishes it.

```json
{
  "action": "configure_and_publish_gtm",
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password",
  "account_id": "6300697388",
  "container_id": "98765432",
  "workspace_id": "3"
}
```

---

#### `install_gtm_codes`

Logs into a client CMS and installs the GTM head/body code snippets.

```json
{
  "action": "install_gtm_codes",
  "cms_type": "wordpress",
  "cms_url": "https://example.com/wp-admin",
  "cms_username": "admin",
  "cms_password": "password",
  "gtm_head": "<script>(function(w,d,s,l,i){...})(window,document,'script','dataLayer','GTM-XXXXX');</script>",
  "gtm_body": "<noscript><iframe src=\"https://www.googletagmanager.com/ns.html?id=GTM-XXXXX\"...></iframe></noscript>"
}
```

Supported `cms_type` values: `wordpress`, `wix`, `squarespace`.

---

#### `add_search_console_property`

Adds a URL-prefix Search Console property and verifies ownership via WPCode.

```json
{
  "action": "add_search_console_property",
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password",
  "website_url": "https://example.com",
  "cms_url": "https://example.com/wp-admin",
  "cms_username": "admin",
  "cms_password": "password"
}
```

---

#### `generate_gtm_payload`

Generates an ordered list of GTM API calls from a CTA audit result. Returns the payload without executing it.

```json
{
  "action": "generate_gtm_payload",
  "audit": { "...CTA audit JSON from POST /health/audit..." }
}
```

---

#### `execute_gtm_payload`

Executes an ordered GTM API payload step by step against a live workspace.

```json
{
  "action": "execute_gtm_payload",
  "access_token": "ya29.xxx",
  "account_id": "6300697388",
  "container_id": "98765432",
  "workspace_id": "3",
  "payload": ["...steps from generate_gtm_payload..."]
}
```

---

#### `generate_gtm_container`

Generates a GTM container export JSON file ready for GTM Admin → Import Container.

```json
{
  "action": "generate_gtm_container",
  "audit": { "...CTA audit JSON..." }
}
```

---

#### `build_audit_report`

Writes a formatted Google Docs CTA audit report from an audit result.

```json
{
  "action": "build_audit_report",
  "audit": { "...CTA audit JSON..." },
  "doc_id": "google-doc-id",
  "access_token": "ya29.xxx"
}
```

---

#### `register_ga4_conversions`

Registers GA4 conversion events on a property via the Admin API.

```json
{
  "action": "register_ga4_conversions",
  "access_token": "ya29.xxx",
  "property_id": "456789012",
  "events": ["click_call", "click_email", "form_submit"]
}
```

---

#### `setup_gtm_tags`

Creates all GTM tags and triggers for a workspace via the API, using a CTA audit as the source.

```json
{
  "action": "setup_gtm_tags",
  "access_token": "ya29.xxx",
  "account_id": "6300697388",
  "container_id": "98765432",
  "workspace_id": "3",
  "audit": { "...CTA audit JSON..." }
}
```

---

#### `build_gtm_from_audit`

Combined: generates the GTM payload from an audit and executes it against a live workspace in one call.

```json
{
  "action": "build_gtm_from_audit",
  "access_token": "ya29.xxx",
  "account_id": "6300697388",
  "container_id": "98765432",
  "workspace_id": "3",
  "audit": { "...CTA audit JSON..." }
}
```

---

#### `search_ga4_accounts`

Searches for GA4 accounts matching a name via the API.

```json
{
  "action": "search_ga4_accounts",
  "access_token": "ya29.xxx",
  "query": "Client Name"
}
```

---

#### `submit_google_otp`

Submits an OTP code for an in-progress Google login session (if 2FA is triggered).

```json
{
  "action": "submit_google_otp",
  "otp": "123456"
}
```

---

### Account Management Endpoints

These are REST endpoints on the automation server, not action-based.

#### `GET /accounts`

**n8n node:** `Method: GET` / `URL: http://95.217.208.221:3000/accounts`

Returns all GA4/GTM accounts and their current capacity.

---

#### `POST /accounts/scan-capacity`

**n8n node:** `Method: POST` / `URL: http://95.217.208.221:3000/accounts/scan-capacity`

Scans all 12 GA4 and GTM accounts and updates capacity in Supabase.

---

#### `PATCH /accounts/:id/capacity`

**n8n node:** `Method: PATCH` / `URL: http://95.217.208.221:3000/accounts/[id]/capacity`

Manually adjust the capacity for a specific account.

```json
{ "capacity": 80 }
```

---

## API Reference — Health & Audit Server (port 3001)

---

### `POST /health/run` — Single Site Health Check

**n8n node:**

```
Method : POST
URL    : http://95.217.208.221:3001/health/run
Body   : JSON
```

```json
{
  "action": "tracking_health_check_site",
  "url": "https://example.com",
  "gtm": "GTM-XXXXXXX"
}
```

`gtm` (or `gtm_id`) is optional. If provided, the result includes `gtm_id_match: true/false` and returns `health_status: "GTM_MISMATCH"` if the container found on the site doesn't match.

**Key response fields:**

| Field                                           | Description                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `grade`                                         | `Perfect` / `Partial` / `Fail`                                                                                              |
| `health_status`                                 | `PASS` / `TRACKING_ISSUES_FOUND` / `NO_TRACKING` / `GTM_MISMATCH` / `NO_CONVERSIONS_TRACKED` / `SITE_UNAVAILABLE` / `ERROR` |
| `health_reasons`                                | Human-readable explanation                                                                                                  |
| `detected_gtm_ids`                              | Array of GTM container IDs found on the site                                                                                |
| `detected_ga4_ids`                              | Array of GA4 measurement IDs found                                                                                          |
| `gtm_id_expected`                               | The GTM ID passed in the request (or null)                                                                                  |
| `gtm_id_match`                                  | `true` / `false` / `null`                                                                                                   |
| `prefetch_status`                               | `ok` / `ok_no_ids` / `bot_challenge` / `fetch_failed` / `fetch_error`                                                       |
| `phone_found` / `phone_passed` / `phone_failed` | Phone CTA counts                                                                                                            |
| `email_found` / `email_passed` / `email_failed` | Email CTA counts                                                                                                            |
| `forms_found` / `forms_passed` / `forms_failed` | Form counts                                                                                                                 |
| `cta_details`                                   | Full per-CTA results with status, events fired, fix messages                                                                |
| `container_analysis`                            | GTM container tag breakdown                                                                                                 |
| `failure_detail`                                | Structured list of failures with fix instructions                                                                           |
| `fix`                                           | Pipe-separated summary of all fix actions                                                                                   |
| `duration_ms`                                   | Total check time in milliseconds                                                                                            |

---

### `POST /health/batch` — Batch Health Check

**n8n node:**

```
Method : POST
URL    : http://95.217.208.221:3001/health/batch
Body   : JSON
```

```json
{
  "clients": [
    {
      "url": "https://example.com",
      "gtm": "GTM-XXXXXXX",
      "client_name": "Example Ltd",
      "cid": "1234567890",
      "order_number": "ORD-12345",
      "supabase_id": "uuid"
    }
  ],
  "callback_url": "https://your-n8n-instance/webhook/batch-complete"
}
```

Returns immediately with `{ job_id: "...", status_url: "/health/batch/:job_id" }`. All fields on each client object other than `url`/`gtm` are passed through unchanged into the results — use this to carry Supabase IDs, order numbers, or Monday item IDs back out.

If `callback_url` is provided, the server POSTs the full results to that URL when the job completes. In n8n, set the callback to a Webhook node so the workflow continues automatically.

---

### `GET /health/batch/:job_id` — Poll Batch Job

**n8n node:**

```
Method : GET
URL    : http://95.217.208.221:3001/health/batch/{{ $json.job_id }}
```

Poll this with a **Wait** node + loop until `status === "complete"`. Returns `status`, `total`, `completed`, and `results` (populated as each check finishes).

---

### `POST /health/audit` — CTA Audit

**n8n node:**

```
Method : POST
URL    : http://95.217.208.221:3001/health/audit
Body   : JSON
```

```json
{ "url": "https://example.com" }
```

Crawls up to 10 pages and returns the full CTA audit JSON — phones, emails, forms, social links, booking CTAs, Google Maps, WhatsApp, location intelligence, and service intent. This JSON is the input for `build_audit_report`, `generate_gtm_container`, and `generate_gtm_payload`.

---

### `GET /health/scrape` — Rendered HTML

**n8n node:**

```
Method : GET
URL    : http://95.217.208.221:3001/health/scrape?url=https://example.com
```

Returns the fully-rendered HTML of the page after JavaScript execution and cookie consent. Handles StackProtect/Cloudflare bot challenges automatically. Useful for debugging what the browser actually sees.

---

### `POST /health/offboard-ga4` — Remove GA4 Account Access

**n8n node:**

```
Method : POST
URL    : http://95.217.208.221:3001/health/offboard-ga4
Body   : JSON
```

```json
{
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password",
  "account_id": "283675043",
  "property_id": "456789012"
}
```

Logs in as the given user, navigates to GA4 Account Access Management, and clicks "Remove myself". Returns `{ ok: true, message: "Successfully removed..." }` or `{ ok: true, message: "Already removed..." }` if already offboarded.

---

### `POST /health/accept-gtm-invitation` — Accept GTM Invitation

**n8n node:**

```
Method : POST
URL    : http://95.217.208.221:3001/health/accept-gtm-invitation
Body   : JSON
```

```json
{
  "email": "admin@company.com",
  "sso_username": "user@company.com",
  "sso_password": "password",
  "gtm_account_id": "6300697388"
}
```

Logs in, navigates to GTM home, opens the Invitations panel, and accepts the pending invitation for the given account ID.

---

## The Full Setup Orchestrator

Triggered by `POST /run { "action": "handle_new_case", "case_id": "<uuid>" }`.

The case row is read from Supabase `automation_cases`. If `info_needed = true`, the case is paused and Monday is updated to "Info Needed". Otherwise the 19-step sequence runs:

| Step | Action                                                                       |
| ---- | ---------------------------------------------------------------------------- |
| 0    | Mark case "running", Monday → "In Progress"                                  |
| 1    | Find GA4 account with capacity (rotates across 12 accounts)                  |
| 2    | Find GTM account with capacity (rotates across 12 accounts)                  |
| 3    | Create GA4 property (Playwright)                                             |
| 4    | Fetch GA4 measurement ID + gtag snippet (Playwright)                         |
| 5    | Create GTM account + container (Playwright)                                  |
| 6    | Fetch GTM head/body codes + numeric IDs (Playwright)                         |
| 7    | Create GTM workspace (API)                                                   |
| 8    | Enable click built-in variables (API)                                        |
| 9    | Create GTM triggers (API)                                                    |
| 10   | Create GTM tags (API)                                                        |
| 11   | Publish GTM workspace (Playwright)                                           |
| 12   | Install GTM codes on client CMS (Playwright — WordPress / Wix / Squarespace) |
| 13   | Register GA4 conversion events (API)                                         |
| 14   | Link GA4 to Google Ads (API — only if `cid` present on the case)             |
| 15   | Create Google Ads conversion actions (API — only if `cid` present)           |
| 16   | Add Search Console property + verify ownership (Playwright)                  |
| 17   | Run tracking health check                                                    |
| 18   | Mark case "done", Monday → "Done", post summary note                         |

Each step is independently wrapped in try/catch. A failure updates the case status to "error" and posts a note to Monday before re-throwing. Optional steps (Ads, Search Console) catch their own errors and continue without stopping the sequence.

---

## Tracking Health Check Engine

### Grading

| Grade     | Meaning                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| `Perfect` | All tested CTAs pass, no duplicate firing                                                   |
| `Partial` | Tracking present but issues found (duplicate firing, some CTAs not tracked, forms untested) |
| `Fail`    | No GTM/GA4 detected, wrong GTM container, or no conversions tracked at all                  |

### GTM Detection Order

1. **HTTP pre-fetch** — plain HTTP GET with real browser headers before the browser opens. Bypasses JS-based bot protection. Extracts GTM/GA4 IDs from static HTML in under 2 seconds.
2. **HTML source scan** — `page.content()` immediately after cookie consent. Catches CMP-blocked `data-src` attributes.
3. **DOM/runtime scan** — queries `window.dataLayer`, `window.google_tag_manager`, live script attributes. 1 pass if the HTML scan found IDs; up to 4 passes with back-off if not.
4. **Network beacons** — intercepts all GTM and GA4 network requests throughout the session.

### Bot Challenge Handling

Sites using **StackProtect** or **Cloudflare** serve a challenge page to headless browsers. The engine handles this in two layers:

1. The HTTP pre-fetch gets real HTML regardless (GTM IDs are found before the browser even opens)
2. If the browser hits a challenge, `waitThroughBotChallenge` waits up to 8 seconds for the invisible reCAPTCHA to auto-resolve. If it doesn't pass, CTA testing is skipped but GTM IDs from the pre-fetch are still reported.

The `prefetch_status` field in the response tells you exactly what happened: `ok`, `ok_no_ids`, `bot_challenge`, `fetch_failed`, or `fetch_error`.

### GTM ID Matching

Pass `gtm` in the request body to validate the installed container. Comparison is case-insensitive and normalises spaces to dashes (`"GTM ABCD1234"` → `"GTM-ABCD1234"`). If the expected ID is not found, returns `grade: "Fail"` / `health_status: "GTM_MISMATCH"` immediately.

---

## CTA Audit Engine

`POST /health/audit { "url": "https://example.com" }`

Crawls up to 10 pages and extracts:

- **Phones** — click-to-call links and visible numbers (placeholder numbers filtered)
- **Emails** — mailto links (generic/placeholder domains filtered)
- **Forms** — field count, labels, CMS plugin type detection
- **Social links** — with dead-link detection (403/404 flagged)
- **Booking CTAs** — Calendly, Acuity, SimplyBook etc., with redirect chain analysis and GA4 `_gl` cross-domain attribution check
- **Google Maps** — embedded iframes and location links
- **WhatsApp** — floating buttons, click-to-chat widgets, plugin-specific patterns
- **Service intent** — detects emergency/high-urgency vs scheduled service from H1/H2/H3 headings
- **Location intelligence** — extracts served areas from URL slug patterns (`/service-in-[place]/`)

The audit JSON feeds three downstream actions: `build_audit_report`, `generate_gtm_container`, and `generate_gtm_payload`.

---

## Environment Variables

Copy `.env.example` to `.env`. This file is never committed to Git.

### Health Check

| Variable                | Default                              | Description                                        |
| ----------------------- | ------------------------------------ | -------------------------------------------------- |
| `LOG_LEVEL`             | `info`                               | `debug` for verbose, `silent` to suppress all      |
| `HEALTH_MAX_CONCURRENT` | `20`                                 | Max parallel checks (each opens a Playwright page) |
| `HEALTH_GLOBAL_TIMEOUT` | `120000`                             | Hard timeout per site (ms)                         |
| `HEALTH_SLOT_TIMEOUT`   | `90000`                              | Slot queue wait timeout (ms)                       |
| `HEALTH_NAV_TIMEOUT`    | `15000`                              | Per-navigation timeout (ms)                        |
| `HEALTH_MAX_PAGES`      | `3`                                  | Max pages visited per check                        |
| `HEALTH_TEST_EMAIL`     | `test-automation@example.com`        | Injected into forms during checks                  |
| `HEALTH_TEST_PHONE`     | `01632960123`                        | Injected into forms during checks                  |
| `HEALTH_TEST_MESSAGE`   | `This is a tracking health check...` | Injected into textarea fields                      |

### Integrations

| Variable                       | Description                                  |
| ------------------------------ | -------------------------------------------- |
| `SUPABASE_URL`                 | Supabase project URL                         |
| `SUPABASE_SERVICE_KEY`         | Supabase service role key (bypasses RLS)     |
| `MONDAY_API_KEY`               | Monday.com API key                           |
| `MONDAY_BOARD_ID_LSEO`         | Monday board ID for Local SEO product        |
| `MONDAY_BOARD_ID_TRIALS`       | Monday board ID for Trials product           |
| `GOOGLE_CLIENT_ID`             | OAuth2 client ID (Google Cloud Console)      |
| `GOOGLE_CLIENT_SECRET`         | OAuth2 client secret                         |
| `GOOGLE_ADS_REFRESH_TOKEN`     | Shared refresh token for all 12 Ads accounts |
| `GOOGLE_ADS_DEVELOPER_TOKEN`   | Google Ads developer token                   |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Manager account CID (`7651196543`)           |

Google and CMS credentials are passed **per-request in the POST body** — never stored as env vars.

---

## Server Setup (Fresh Deploy)

```bash
# Prerequisites — Ubuntu 22.04+
sudo apt update && sudo apt install -y nodejs npm
sudo npm install -g pm2

# Clone repo
git clone https://github.com/michael011299/ga-automation.git /home/alex/ga-automation
cd /home/alex/ga-automation
npm ci

# Install Playwright's Chromium + system dependencies
npx playwright install chromium
npx playwright install-deps chromium

# Set environment variables
cp .env.example .env
nano .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, MONDAY_API_KEY, GOOGLE_* values

# Start all three servers
pm2 start ecosystem.config.js

# Persist across reboots
pm2 save
pm2 startup   # run the printed command as root
```

---

## Updating the Server

```bash
cd /home/alex/ga-automation
git pull origin main
npm ci
pm2 reload ecosystem.config.js   # zero-downtime reload
pm2 status                        # confirm all three are online
```

---

## PM2 Process Management

| PM2 name     | Script       | Port | Memory limit |
| ------------ | ------------ | ---- | ------------ |
| `ga-runner`  | `runners.js` | 3000 | 1 GB         |
| `ga-health`  | `server.js`  | 3001 | 1 GB         |
| `ga-gateway` | `gateway.js` | —    | 256 MB       |

```bash
pm2 status                        # show all processes
pm2 restart ga-health             # restart one process
pm2 reload ecosystem.config.js    # reload all (zero-downtime)
pm2 stop all                      # stop all
pm2 delete all                    # remove all from PM2 registry
pm2 save                          # persist current process list
```

---

## Checking Logs

```bash
pm2 logs                  # tail all logs
pm2 logs ga-health        # health check / audit logs
pm2 logs ga-runner        # GA/GTM automation logs
pm2 logs --lines 200      # show last 200 lines from all
```

Log files are written to `~/.pm2/logs/`. Each process has a separate stdout and stderr file.

---

## Key Dependencies

| Package                          | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `playwright`                     | Browser automation (Chromium)                   |
| `playwright-extra`               | Playwright with plugin support                  |
| `puppeteer-extra-plugin-stealth` | Anti-bot-detection patches for headless Chrome  |
| `express`                        | HTTP server framework                           |
| `http-proxy-middleware`          | Internal reverse proxy (gateway.js)             |
| `axios`                          | HTTP client (GTM container download, API calls) |
| `@supabase/supabase-js`          | Supabase database client                        |
| `swagger-ui-express`             | Swagger UI served at `/docs` on port 3000       |

Node's built-in `https`, `http`, and `zlib` modules handle the HTTP pre-fetch in the health check engine — no extra dependency needed.
