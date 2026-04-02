-- migrations/002_automation_cases_step_columns.sql
--
-- Adds per-step tracking columns to automation_cases.
-- These columns power a real-time dashboard showing exactly where each case
-- is in the 19-step full-setup pipeline.
--
-- Run this once in the Supabase SQL editor.
-- Idempotent — safe to re-run (all statements use IF NOT EXISTS / IF EXISTS).

-- ── Step-status columns ───────────────────────────────────────────────────────
-- Each column holds: 'pending' | 'done' | 'error' | 'skipped'

alter table public.automation_cases
  add column if not exists ga4_setup_status         text,  -- GA4 property creation
  add column if not exists gtm_setup_status         text,  -- GTM account + container creation
  add column if not exists gtm_tags_status          text,  -- GTM workspace, variables, triggers, tags
  add column if not exists gtm_publish_status       text,  -- GTM workspace publish
  add column if not exists cms_install_status       text,  -- GTM codes installed on CMS
  add column if not exists conversion_events_status text,  -- GA4 conversion events registered
  add column if not exists ads_link_status          text,  -- GA4 linked to Google Ads
  add column if not exists search_console_status    text,  -- Search Console property added/verified
  add column if not exists tracking_test_status     text;  -- Health check grade: T1 / T2 / T3 / Partial / FAIL

-- ── Progress tracking ─────────────────────────────────────────────────────────
alter table public.automation_cases
  add column if not exists last_step_completed      text;  -- Name of the last step that succeeded

-- ── IDs and codes captured during setup ──────────────────────────────────────
alter table public.automation_cases
  add column if not exists measurement_id               text,  -- GA4 measurement ID (G-XXXXXXXX)
  add column if not exists gtm_numeric_account_id       text,  -- Numeric GTM account ID (from URL)
  add column if not exists gtm_numeric_container_id     text,  -- Numeric GTM container ID (from URL)
  add column if not exists gtm_workspace_id             text,  -- GTM workspace ID (from API)
  add column if not exists gtm_head_code                text,  -- GTM <head> install snippet
  add column if not exists gtm_body_code                text;  -- GTM <body> noscript snippet

-- ── Monday.com item reference ────────────────────────────────────────────────
alter table public.automation_cases
  add column if not exists monday_item_id               text;  -- Monday item ID created at start of case

-- ── Form detection results (from CMS install step) ───────────────────────────
alter table public.automation_cases
  add column if not exists detected_form_type           text,  -- e.g. "cf7", "wpforms", "generic"
  add column if not exists detected_form_selector       text,  -- CSS selector for the contact form
  add column if not exists detected_form_source_url     text;  -- URL where the form was found
