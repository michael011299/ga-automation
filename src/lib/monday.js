/**
 * src/lib/monday.js
 *
 * Monday.com GraphQL API v2 client.
 *
 * Used by the orchestrator to:
 *   1. Create a new item on the correct board when a case arrives
 *   2. Update the item's status column as automation progresses
 *   3. Post text notes/updates to the item's activity log
 *   4. Set the "Info Needed" status and reason when info_needed = true
 *
 * Required env vars:
 *   MONDAY_API_KEY               — Monday.com personal API token
 *   MONDAY_BOARD_ID_LSEO         — board ID for Local SEO cases     (1242223716)
 *   MONDAY_BOARD_ID_TRIALS       — board ID for Trials cases        (5088296844)
 *   MONDAY_GROUP_ID              — group ID (same on both boards)   (1690115520_call360_telephony_s)
 *   MONDAY_COL_ORDER_NUMBER      — column ID for order number       (text50)
 *   MONDAY_COL_CID               — column ID for Google Ads CID     (cid)
 *   MONDAY_COL_WEBSITE_URL       — column ID for website URL        (short_text7)
 *   MONDAY_COL_CMS_CREDS         — column ID for CMS credentials    (long_text4)
 *   MONDAY_COL_NOTES             — column ID for notes              (text_mm1myf7x)
 *   MONDAY_COL_STATUS            — column ID for status             (status70)
 *   MONDAY_COL_INFO_REASON_LSEO  — info reason column on LSEO board (color_mm1gsawq)
 *   MONDAY_COL_INFO_REASON_TRIALS— info reason column on Trials     (color_mm1g7w89)
 */

const axios = require("axios");

const MONDAY_API_URL = "https://api.monday.com/v2";

// ─────────────────────────────────────────────────────────────────────────────
// Valid info_needed reason labels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The exact label strings configured in Monday's info-reason colour columns
 * (color_mm1gsawq on LSEO, color_mm1g7w89 on Trials).
 *
 * Monday colour columns reject any label that doesn't exactly match a
 * configured option (case-sensitive). The reason column must be updated
 * BEFORE the status column — updating status triggers the Monday automation.
 *
 * Used for:
 *   - Validation in setInfoNeeded() before sending to the API
 *   - Reference in entry.js to produce a clear error message
 *   - Can be imported by n8n or a frontend form to populate a dropdown
 */
const VALID_INFO_REASONS = [
  "Incorrect Website Logins",
  "Website Access Level Incorrect",
  "Website Logins Not Provided",
  "GTM / Analytics Access Needed",
  "No CTA's on site",
  "Cookie Consent Issue",
  "Need 3rd Party Logins",
  "3rd Party Logins Incorrect",
  "Website Subscription Level Too Low",
  "No Access To CID",
  "Final Purchase/Booking URL Needed",
  "Website Down",
  "Case Not ready to complete (Service Only)",
];

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — send a GraphQL request to Monday
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a GraphQL mutation or query against the Monday.com API.
 *
 * @param {string} query      — GraphQL query/mutation string
 * @param {Object} variables  — optional variables (not used in v2 string interpolation)
 * @returns {Object} the `data` field from the Monday API response
 */
async function mondayRequest(query) {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) throw new Error("Missing MONDAY_API_KEY environment variable");

  const response = await axios.post(
    MONDAY_API_URL,
    { query },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
        "API-Version": "2024-01",
      },
    }
  );

  if (response.data.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(response.data.errors)}`);
  }

  return response.data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Board + column helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the correct Monday board ID based on product_type.
 * local_seo → LGN Onboarding board
 * anything else → Trials Onboarding board
 *
 * @param {string} productType — value of automation_cases.product_type
 * @returns {string} Monday board ID
 */
function getBoardId(productType) {
  return productType === "local_seo"
    ? process.env.MONDAY_BOARD_ID_LSEO
    : process.env.MONDAY_BOARD_ID_TRIALS;
}

/**
 * Return the info_needed reason column ID for the given board.
 * The column ID differs between the two boards.
 *
 * @param {string} productType
 * @returns {string} column ID
 */
function getInfoReasonColumnId(productType) {
  return productType === "local_seo"
    ? process.env.MONDAY_COL_INFO_REASON_LSEO
    : process.env.MONDAY_COL_INFO_REASON_TRIALS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new Monday item on the correct board for the incoming case.
 * Populates order_number, CID, website URL, CMS credentials, and notes.
 *
 * Called at the very start of handleNewCase() before any automation runs.
 *
 * @param {Object} caseRow — full automation_cases row
 * @returns {string} the new Monday item ID (saved back to automation_cases.monday_item_id)
 */
async function createItem(caseRow) {
  const boardId = getBoardId(caseRow.product_type);
  const groupId = process.env.MONDAY_GROUP_ID;

  // Build the column_values object — each key is a column ID, value is the data.
  const columnValues = {
    [process.env.MONDAY_COL_ORDER_NUMBER]: caseRow.order_number || "",
    [process.env.MONDAY_COL_CID]:          caseRow.cid || "",
    [process.env.MONDAY_COL_WEBSITE_URL]:  caseRow.website_url || "",
    [process.env.MONDAY_COL_CMS_CREDS]:    { text: caseRow.cms_login_credentials || "" },
    [process.env.MONDAY_COL_NOTES]:        caseRow.Notes || "",
  };

  // Monday requires column_values as a JSON string embedded in the GraphQL query.
  const columnValuesStr = JSON.stringify(JSON.stringify(columnValues));
  const itemNameStr = JSON.stringify(caseRow.case_name || caseRow.website_url || "New Case");

  const query = `
    mutation {
      create_item(
        board_id: ${boardId},
        group_id: "${groupId}",
        item_name: ${itemNameStr},
        column_values: ${columnValuesStr}
      ) {
        id
      }
    }
  `;

  const result = await mondayRequest(query);
  const itemId = result?.create_item?.id;

  if (!itemId) throw new Error("Monday create_item did not return an item ID");

  return itemId;
}

/**
 * Update the status column on a Monday item.
 * Used for: "In Progress", "Done", "Error", "Info Needed".
 *
 * @param {string} itemId      — Monday item ID (from automation_cases.monday_item_id)
 * @param {string} productType — determines which board to target
 * @param {string} statusLabel — the status label text, e.g. "In Progress"
 */
async function setItemStatus(itemId, productType, statusLabel) {
  const boardId = getBoardId(productType);
  const columnId = process.env.MONDAY_COL_STATUS;
  const value = JSON.stringify(JSON.stringify({ label: statusLabel }));

  const query = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${columnId}",
        value: ${value}
      ) { id }
    }
  `;

  await mondayRequest(query);
}

/**
 * Set the info_needed reason on the appropriate column and mark status as "Info Needed".
 * Called when info_needed = true at the start of a new case.
 *
 * ORDER IS CRITICAL: reason column must be updated first, status column second.
 * Updating the status column triggers the Monday automation that handles downstream
 * notifications and board movements. If you reverse the order the automation won't
 * have the reason label available when it fires.
 *
 * @param {string} itemId         — Monday item ID
 * @param {string} productType    — determines boards and column IDs
 * @param {string} reason         — must be one of VALID_INFO_REASONS (exact match)
 * @throws {Error} if reason is not in VALID_INFO_REASONS
 */
async function setInfoNeeded(itemId, productType, reason) {
  // Validate before touching Monday — an invalid label causes a Monday API error
  // that leaves the item in a broken state (reason set but status not updated).
  if (!VALID_INFO_REASONS.includes(reason)) {
    throw new Error(
      `Invalid info_needed_reason: "${reason}". ` +
      `Must be one of: ${VALID_INFO_REASONS.map((r) => `"${r}"`).join(", ")}`
    );
  }

  const boardId = getBoardId(productType);
  const reasonColumnId = getInfoReasonColumnId(productType);
  const reasonValue = JSON.stringify(JSON.stringify({ label: reason }));

  // Step 1: Update reason column FIRST — the Monday automation reads this value
  await mondayRequest(`
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${reasonColumnId}",
        value: ${reasonValue}
      ) { id }
    }
  `);

  // Step 2: Update status to "Info Needed" — this triggers the Monday automation
  await setItemStatus(itemId, productType, "Info Needed");
}

/**
 * Post a text update/note to the item's activity timeline.
 * Used to log step completions, errors, and summary messages.
 *
 * @param {string} itemId  — Monday item ID
 * @param {string} message — plain text to post (emojis fine, no HTML)
 */
async function addItemNote(itemId, message) {
  // Escape any backticks or quotes in the message to avoid breaking the GraphQL string
  const safeMessage = String(message).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const query = `
    mutation {
      create_update(
        item_id: ${itemId},
        body: "${safeMessage}"
      ) { id }
    }
  `;

  await mondayRequest(query).catch((err) => {
    // Notes are best-effort — don't let a failed note abort the automation
    console.error("[monday] addItemNote failed:", err.message);
  });
}

/**
 * Update a subitem's Status column and post a Monday Update (activity note).
 *
 * Discovers the subitem's board ID and status column ID automatically via a
 * single query — no env vars or prior knowledge of the subitem board required.
 *
 * @param {string|number} subitemId   — Monday subitem ID
 * @param {string}        statusLabel — exact label string (e.g. "Done", "Failed", "Partial")
 * @param {string}        updateBody  — text to post as a Monday Update on the subitem
 */
async function updateSubitem(subitemId, statusLabel, updateBody) {
  // Step 1: Discover board ID and status column ID from the subitem itself
  const meta = await mondayRequest(`
    query {
      items(ids: [${subitemId}]) {
        board {
          id
          columns { id title type }
        }
      }
    }
  `);

  const board = meta?.items?.[0]?.board;
  if (!board) throw new Error(`updateSubitem: could not fetch board for subitem ${subitemId}`);

  const boardId   = board.id;
  const statusCol = board.columns.find(c => c.type === "color" || c.title === "Status");
  if (!statusCol) throw new Error(`updateSubitem: no Status column found on subitem board ${boardId}`);

  // Step 2: Set the status label
  const value = JSON.stringify(JSON.stringify({ label: statusLabel }));
  await mondayRequest(`
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${subitemId},
        column_id: "${statusCol.id}",
        value: ${value}
      ) { id }
    }
  `);

  // Step 3: Post a Monday Update (create_update) with the step details
  await addItemNote(subitemId, updateBody);
}

module.exports = {
  createItem,
  setItemStatus,
  setInfoNeeded,
  addItemNote,
  updateSubitem,
  getBoardId,
  VALID_INFO_REASONS,
};
