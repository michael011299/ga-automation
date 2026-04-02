-- migrations/001_google_accounts.sql
--
-- Creates the google_accounts table which stores credentials and capacity
-- counters for each of the 12 Google Leadgen accounts used for GA4/GTM.
--
-- Run this once in the Supabase SQL editor before starting the automation.
-- Idempotent — safe to re-run.

create table if not exists public.google_accounts (
  id                    uuid        not null default gen_random_uuid() primary key,

  -- Unique name that matches the "GA4_Google_ account" / "GTM_Google _Account"
  -- columns in automation_cases (e.g. "leadgen-accesss.uk.1")
  account_name          text        not null unique,

  -- Google account credentials used by Playwright for browser login
  google_email          text        not null,
  google_password       text        not null,

  -- OneLogin SSO credentials (used during Google sign-in when SSO is enforced)
  sso_username          text        not null default '',
  sso_password          text        not null default '',

  -- OAuth2 refresh token for this account (used by GTM API and GA4 API calls).
  -- Extract via: n8n export:credentials --decrypted | grep refresh_token
  gtm_ga4_refresh_token text        null,

  -- Live counters incremented after each successful creation.
  -- These power the dashboard without needing to query Google.
  ga4_property_count    integer     not null default 0,
  gtm_container_count   integer     not null default 0,

  -- Determines the order in which the orchestrator tries accounts.
  -- account_index = 1 is tried first.
  account_index         integer,

  notes                 text,
  created_at            timestamptz not null default now()
);

-- Index for the account-selection loop (ordered by account_index)
create index if not exists google_accounts_account_index_idx
  on public.google_accounts (account_index asc nulls last);

-- Row Level Security: service role has full access; anon/authenticated have none.
-- The server uses the SUPABASE_SERVICE_KEY which bypasses RLS, but we enable it
-- as a defence-in-depth measure to prevent accidental public exposure.
alter table public.google_accounts enable row level security;

-- No public policies — only the service role can access this table.
-- (Service key bypasses RLS automatically.)
