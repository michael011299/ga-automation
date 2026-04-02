/**
 * src/lib/supabase.js
 *
 * Singleton Supabase client using the SERVICE ROLE key.
 * This bypasses Row Level Security and gives the server full read/write access.
 *
 * IMPORTANT: Never expose SUPABASE_SERVICE_KEY to the browser or client-side code.
 * It is only safe here because this runs server-side on the VPS.
 *
 * Usage anywhere in the codebase:
 *   const supabase = require('./src/lib/supabase');
 *   const { data, error } = await supabase.from('automation_cases').select('*');
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables. " +
    "Copy .env.example to .env and fill in the values."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    // Disable auto-refresh and session persistence — this is a server-side client
    // that authenticates via service key, not user sessions.
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = supabase;
