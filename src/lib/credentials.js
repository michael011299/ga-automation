/**
 * src/lib/credentials.js
 *
 * All Supabase read/write helpers used by the orchestrator.
 *
 * Functions:
 *   getCaseById(caseId)              — load a full automation_cases row
 *   updateCase(caseId, updates)      — patch any columns on automation_cases
 *   getAllGoogleAccounts()           — load all 12 google_accounts ordered by account_index
 *   getGoogleAccountByName(name)     — load one google_accounts row by account_name
 *   incrementAccountCount(id, field) — bump ga4_property_count or gtm_container_count
 */

const supabase = require("./supabase");

// ─────────────────────────────────────────────────────────────────────────────
// automation_cases helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a single automation_cases row by its UUID.
 * Throws if the case is not found or Supabase returns an error.
 *
 * @param {string} caseId — UUID of the automation case
 * @returns {Object} the full row from automation_cases
 */
async function getCaseById(caseId) {
  const { data, error } = await supabase
    .from("automation_cases")
    .select("*")
    .eq("id", caseId)
    .single();

  if (error) throw new Error(`getCaseById failed for ${caseId}: ${error.message}`);
  if (!data) throw new Error(`No case found with id: ${caseId}`);

  return data;
}

/**
 * Patch one or more columns on an automation_cases row.
 * Always merges updated_at so the dashboard shows when the row last changed.
 *
 * @param {string} caseId   — UUID of the automation case
 * @param {Object} updates  — key/value pairs to update, e.g. { status: "running" }
 */
async function updateCase(caseId, updates) {
  const { error } = await supabase
    .from("automation_cases")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", caseId);

  if (error) {
    // Log but don't throw — a failed status update should not abort the automation.
    console.error(`[credentials] updateCase failed for ${caseId}:`, error.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// google_accounts helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load all 12 Google accounts ordered by account_index (ascending).
 * The orchestrator iterates these in order when looking for an account with space.
 *
 * @returns {Array} array of google_accounts rows
 */
async function getAllGoogleAccounts() {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("*")
    .order("account_index", { ascending: true });

  if (error) throw new Error(`getAllGoogleAccounts failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("No Google accounts found in google_accounts table");

  return data;
}

/**
 * Load a single google_accounts row by its account_name.
 * Used after the orchestrator has already determined which account to use.
 *
 * @param {string} accountName — e.g. "leadgen-accesss.uk.1"
 * @returns {Object} the google_accounts row
 */
async function getGoogleAccountByName(accountName) {
  const { data, error } = await supabase
    .from("google_accounts")
    .select("*")
    .eq("account_name", accountName)
    .single();

  if (error) throw new Error(`getGoogleAccountByName failed for "${accountName}": ${error.message}`);
  if (!data) throw new Error(`No Google account found with name: ${accountName}`);

  return data;
}

/**
 * Increment ga4_property_count or gtm_container_count after a successful creation.
 * This keeps the dashboard count accurate without re-querying Google.
 *
 * @param {string} accountId — UUID of the google_accounts row
 * @param {"ga4_property_count"|"gtm_container_count"} field — which counter to bump
 */
async function incrementAccountCount(accountId, field) {
  // First read the current value, then write value + 1.
  // Supabase JS v2 does not support atomic increments via the JS client directly.
  const { data, error: readError } = await supabase
    .from("google_accounts")
    .select(field)
    .eq("id", accountId)
    .single();

  if (readError) {
    console.error(`[credentials] incrementAccountCount read failed:`, readError.message);
    return;
  }

  const current = data?.[field] ?? 0;

  const { error: writeError } = await supabase
    .from("google_accounts")
    .update({ [field]: current + 1 })
    .eq("id", accountId);

  if (writeError) {
    console.error(`[credentials] incrementAccountCount write failed:`, writeError.message);
  }
}

module.exports = {
  getCaseById,
  updateCase,
  getAllGoogleAccounts,
  getGoogleAccountByName,
  incrementAccountCount,
};
