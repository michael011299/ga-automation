# ga-automation

A Node.js automation server that handles GA4 account creation, GTM container setup, CMS code installation, and tracking health checks across client websites. Built with Playwright (browser automation) and Express (HTTP API).

Deployed bare-metal on a Ubuntu VPS, managed with PM2. No Docker required.

---

## Repository Structure

```
ga-automation/
├── runners.js              ← GA4/GTM automation server (port 3000)
├── server.js               ← Health check server (port 3001)
├── gateway.js              ← Reverse proxy routing traffic to both servers (port 8080)
├── health.runners.js       ← Playwright-based tracking health check engine
├── health.routes.js        ← Express router for health check endpoints
├── ecosystem.config.js     ← PM2 process definitions for all three servers
├── package.json            ← Project dependencies
├── package-lock.json       ← Locked dependency versions
├── .env.example            ← Environment variable reference (copy to .env)
└── .gitignore              ← Files excluded from Git
```

---

## How the System Fits Together

```
n8n / external caller
        │
        ▼
  gateway.js :8080
   ┌──────────────────────────────┐
   │  /health/* → server.js :3001 │  ← health.routes.js + health.runners.js
   │  everything else → :3000     │  ← runners.js
   └──────────────────────────────┘
```

n8n sends HTTP POST requests to the public URL (ngrok or direct VPS IP). The gateway routes each request to the correct internal server. All results come back as JSON.

---

## File Descriptions

### `runners.js` — Main Automation Server
**Port: 3000**

Accepts `POST /run` and executes browser automation actions using Playwright (headless Chromium) against Google Analytics, Google Tag Manager, and client CMS platforms.

**Supported actions (passed as `action` in the request body):**

| Action | What it does |
|---|---|
| `login_and_create_ga4` | Navigates to GA4 Admin and checks whether a new account can be created (capacity check) |
| `create_ga_account` | Runs the full 4-step GA4 account creation wizard |
| `fetch_gtag_and_property_id` | Opens the GA4 web data stream and extracts the `gtag` snippet, `measurement_id`, and `property_id` |
| `check_gtm_capacity` | Creates a GTM account form to test whether the account pool has space; returns GTM codes and numeric IDs |
| `fetch_gtm_codes` | Opens an existing GTM container by ID and returns the head/body install snippets |
| `configure_and_publish_gtm` | Navigates to a GTM workspace by numeric IDs and publishes it |
| `install_gtm_codes` | Logs into a client CMS (WordPress, Wix, or Squarespace) and installs the GTM codes; also detects the contact form plugin type |
| `add_search_console_property` | Adds a URL-prefix Search Console property, injects the HTML meta tag via WPCode, and verifies ownership |
| `test_tracking_ctas` | Visits the client site and checks whether phone links, email links, and forms fire GA4 events |
| `submit_google_otp` | Handles Google 2FA — receives an OTP code for an in-progress login session |

---

### `server.js` — Health Check Server
**Port: 3001** (set via `PORT` environment variable)

A lightweight Express server that mounts the health check routes.

- `GET /health` → `{ status: 'ok', timestamp: '...' }`
- `POST /health/run` → single-site health check (via `health.routes.js`)
- `POST /health/batch` → batch health check for multiple clients
- `GET /health/batch/:job_id` → poll batch job status

---

### `gateway.js` — Reverse Proxy
**Port: 8080**

Sits in front of both servers and routes by path:

- `/health/*` → `server.js` on port **3001**
- Everything else → `runners.js` on port **3000**

Externally (from n8n or ngrok) you only need to call one port (8080).

---

### `health.runners.js` — Tracking Health Check Engine

The core logic for automated tracking health checks. Exported function: `trackingHealthCheckSite(url)`.

Given a client website URL, it:
1. Launches a shared Playwright browser session (up to 20 concurrent checks)
2. Navigates to the homepage and up to 2 additional contact pages
3. Intercepts network requests to capture GA4 beacons
4. Accepts cookie consent banners
5. Detects GTM via DOM scan, network beacons, `window.google_tag_manager`, `gtm.start` dataLayer event, live iframe scan, `page.content()` fallback, and Playwright HTTP fallback
6. Clicks phone (`tel:`) and email (`mailto:`) links and checks whether a non-generic GA4 event fires
7. Runs a duplicate-fire test per CTA
8. Fills and submits contact forms, checks whether a GA4 event fires
9. Grades the site: **T1** (all pass), **T2** (partial/issues), **T3** (untestable / no CTAs), or **FAIL** (GTM present but nothing fires)

**Browser flags (headless Chromium, hardened for Linux VPS):**
- `--disable-gpu`, `--disable-gpu-compositing` — prevents SharedImageManager GPU crashes
- `--disable-webgl`, `--disable-webgl2` — prevents WebGL software fallback crash
- `--disable-dev-shm-usage` — prevents shared memory OOM on low-RAM servers
- `--no-sandbox`, `--disable-setuid-sandbox` — required for running as non-root

---

### `health.routes.js` — Health Check API Routes

Mounted at `/health` inside `server.js`.

**Endpoints:**

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/health/run` | `{ action, url }` | Single-site check |
| `POST` | `/health/batch` | `{ clients: [{url, ...}] }` | Batch check (async, returns job_id) |
| `GET` | `/health/batch/:job_id` | — | Poll batch job status + results |

---

### `ecosystem.config.js` — PM2 Process Config

Defines all three processes for PM2. Use this for all deployments — it sets the correct port for each process via the `PORT` env var.

| PM2 name | Script | Port |
|---|---|---|
| `ga-runner` | `runners.js` | 3000 |
| `ga-health` | `server.js` | 3001 |
| `ga-gateway` | `gateway.js` | 8080 |

---

## Server Setup (Fresh Deploy)

```bash
# Prerequisites on Ubuntu VPS
sudo apt update && sudo apt install -y nodejs npm
sudo npm install -g pm2

# Clone repo and install dependencies
git clone https://github.com/michael011299/ga-automation.git /home/alex/ga-automation
cd /home/alex/ga-automation
npm ci

# Install Playwright's Chromium browser + system dependencies
npx playwright install chromium
npx playwright install-deps chromium

# Copy and edit environment variables
cp .env.example .env
nano .env

# Start all three servers
pm2 start ecosystem.config.js

# Persist across reboots
pm2 save
pm2 startup   # run the printed command as root to enable autostart
```

---

## Updating the Server

```bash
cd /home/alex/ga-automation
git pull origin main
npm ci
pm2 reload ecosystem.config.js   # zero-downtime reload
pm2 status                        # confirm all online
```

---

## Clearing Everything & Starting Fresh

```bash
# Remove any Docker containers/images (if any remain from older deploys)
docker stop $(docker ps -aq) 2>/dev/null; docker rm $(docker ps -aq) 2>/dev/null
docker rmi $(docker images -q) 2>/dev/null

# Stop and remove all PM2 processes
pm2 stop all
pm2 delete all

# Pull latest and reinstall
cd /home/alex/ga-automation
git pull origin main
npm ci

# Restart fresh
pm2 start ecosystem.config.js
pm2 save
pm2 status
```

---

## Running Locally (Development)

```bash
npm ci
npx playwright install chromium

# Terminal 1 — GA runner
PORT=3000 node runners.js

# Terminal 2 — Health check server
PORT=3001 node server.js

# Terminal 3 — Gateway (optional, needed if testing end-to-end routing)
node gateway.js
```

---

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed. The file is never committed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` (server.js), `3000` (runners.js) | Set by ecosystem.config.js automatically |
| `NODE_ENV` | `production` | Set by ecosystem.config.js automatically |
| `LOG_LEVEL` | `info` | `debug` for verbose output, `silent` to suppress all logs |
| `HEALTH_MAX_CONCURRENT` | `20` | Max parallel health checks (each opens a Playwright page) |
| `HEALTH_GLOBAL_TIMEOUT` | `120000` | Hard cap per site in ms |
| `HEALTH_SLOT_TIMEOUT` | `90000` | Slot wait timeout in ms |
| `HEALTH_NAV_TIMEOUT` | `15000` | Page navigation timeout in ms |
| `HEALTH_MAX_PAGES` | `3` | Max pages to visit per site |
| `HEALTH_TEST_EMAIL` | `test-automation@example.com` | Email injected into forms during checks |
| `HEALTH_TEST_PHONE` | `01632960123` | Phone injected into forms during checks |
| `HEALTH_TEST_MESSAGE` | `This is a tracking health check...` | Message injected into textarea fields |

Credentials (Google email/password, CMS logins) are passed per-request in the POST body to `runners.js`, not stored as env vars.

---

## Checking Logs

```bash
pm2 logs              # tail all logs
pm2 logs ga-health    # health runner logs only
pm2 logs ga-runner    # GA/GTM automation logs only
pm2 logs ga-gateway   # gateway logs only
```
