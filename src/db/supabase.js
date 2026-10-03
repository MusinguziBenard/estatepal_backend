const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  console.warn('[db] Supabase credentials missing — API will fail until configured.');
}

/** Service-role client: full DB access, bypasses RLS. Use only on the server. */
const supabase = createClient(
  config.supabase.url || 'https://placeholder.supabase.co',
  config.supabase.serviceRoleKey || 'placeholder',
  {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'public' },
  }
);

module.exports = { supabase };
