/**
 * src/orchestrator/entry.js
 *
 * Entry point for every new automation case.
 *
 * handleNewCase(caseId) is called by the /run route in runners.js whenever n8n
 * fires a "handle_new_case" action. It:
 *
 *   1. Loads the full case row from automation_cases
 *   2. Creates a Monday.com item (if one does not already exist)
 *   3. If info_needed = true → sets "Info Needed" status on Monday and returns
 *   4. Routes to the correct variant orchestrator based on core_variant
 *
 * Supported core_variant values:
 *   "full"              → runFullSetup   (src/orchestrator/full-setup.js)
 *   (others not yet built → logged and returned as unhandled)
 *
 * n8n integration:
 *   POST /run { "action": "handle_new_case", "case_id": "<uuid>" }
 *   → returns { status: "done" | "waiting_for_info" | "unhandled_variant" | "error", ... }
 *
 * Info-needed resumption:
 *   When info_needed is cleared (set to false), n8n calls handle_new_case again
 *   with the same case_id. Monday item creation is skipped because
 *   monday_item_id is already set on the row.
 */

const { getCaseById, updateCase } = require("../lib/credentials");
const { createItem, setInfoNeeded, setItemStatus, addItemNote, VALID_INFO_REASONS } = require("../lib/monday");
const { runFullSetup } = require("./full-setup");

/**
 * Handle a new (or resumed) automation case end-to-end.
 *
 * @param {string} caseId — UUID of the automation_cases row
 * @returns {Object} result with at minimum { status: string }
 */
async function handleNewCase(caseId) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`🚀 handleNewCase: ${caseId}`);
  console.log(`${"─".repeat(60)}`);

  let caseRow;
  try {
    caseRow = await getCaseById(caseId);
  } catch (err) {
    console.error("❌ Could not load case:", err.message);
    throw err;
  }

  // ── Normalise boolean fields ───────────────────────────────────────────────
  // Supabase may return booleans as strings when coming through an n8n webhook.
  const infoNeeded = normaliseBoolean(caseRow.info_needed);
  const coreVariant = (caseRow.core_variant || "full").trim().toLowerCase();

  console.log(`📋 Case: ${caseRow.case_name || caseRow.website_url}`);
  console.log(`   product_type: ${caseRow.product_type}`);
  console.log(`   core_variant: ${coreVariant}`);
  console.log(`   info_needed:  ${infoNeeded}`);

  // ── Monday: Create item (first run only) ──────────────────────────────────
  // If monday_item_id is already set, the item was created on a previous run
  // (e.g. info_needed resumption). Skip creation to avoid duplicates.
  let mondayItemId = caseRow.monday_item_id;

  if (!mondayItemId) {
    console.log("📋 Creating Monday.com item...");
    try {
      mondayItemId = await createItem(caseRow);
      await updateCase(caseId, { monday_item_id: mondayItemId });
      console.log("✅ Monday item created:", mondayItemId);
    } catch (err) {
      // A failed Monday item creation is not fatal — log and continue.
      // The orchestrator can still run; Monday sync will be partial.
      console.error("⚠️ Monday createItem failed (non-fatal):", err.message);
    }
  } else {
    console.log("ℹ️ Monday item already exists:", mondayItemId);
  }

  // ── info_needed check ─────────────────────────────────────────────────────
  // If the case is waiting for information, update Monday and stop here.
  // n8n will re-call handle_new_case when info_needed is cleared.
  if (infoNeeded) {
    console.log("⏸️ info_needed = true — setting Monday status and waiting");

    const reason = caseRow.info_needed_reason;
    if (!reason || !VALID_INFO_REASONS.includes(reason)) {
      const msg =
        `info_needed_reason "${reason}" is not a valid Monday label. ` +
        `Must be one of: ${VALID_INFO_REASONS.map((r) => `"${r}"`).join(", ")}`;
      console.error("❌", msg);
      await updateCase(caseId, { status: "error", error_message: msg });
      return { status: "error", case_id: caseId, error: msg };
    }

    if (mondayItemId) {
      try {
        await setInfoNeeded(mondayItemId, caseRow.product_type, reason);
      } catch (err) {
        console.error("⚠️ Monday setInfoNeeded failed (non-fatal):", err.message);
      }
    }

    await updateCase(caseId, { status: "waiting_for_info" });

    return { status: "waiting_for_info", case_id: caseId };
  }

  // ── Route to variant orchestrator ─────────────────────────────────────────
  switch (coreVariant) {
    case "full":
      return await runFullSetup(caseId, caseRow, mondayItemId);

    default:
      console.log(`⚠️ Unhandled core_variant: "${coreVariant}"`);
      return { status: "unhandled_variant", core_variant: coreVariant, case_id: caseId };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a value that may arrive as boolean, string "true"/"false", or 0/1.
 *
 * @param {*} value
 * @returns {boolean}
 */
function normaliseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return Boolean(value);
}

module.exports = { handleNewCase };
