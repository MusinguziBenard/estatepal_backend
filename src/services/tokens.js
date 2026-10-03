const { supabase } = require('../db/supabase');

/**
 * Collect Expo push tokens for given user ids.
 */
async function tokensForUsers(userIds) {
  if (!userIds?.length) return [];
  // Respect each user's notification toggle (Play policy: user-controllable notifications).
  const { data: enabledUsers } = await supabase
    .from('users')
    .select('id, push_tokens')
    .in('id', userIds)
    .eq('notifications_enabled', true);
  const ids = (enabledUsers || []).map((u) => u.id);
  if (!ids.length) return [];

  const { data: devices } = await supabase.from('devices').select('push_token').in('user_id', ids);
  const fromDevices = (devices || []).map((d) => d.push_token);
  const fromUsers = (enabledUsers || []).flatMap((u) => u.push_tokens || []);

  return [...new Set([...fromDevices, ...fromUsers].filter(Boolean))];
}

/** All registered tokens for users who haven't opted out (for broadcasts e.g. new published listing) */
async function allTokens() {
  const { data: users } = await supabase.from('users').select('id').eq('notifications_enabled', true);
  const ids = (users || []).map((u) => u.id);
  if (!ids.length) return [];
  const { data: devices } = await supabase.from('devices').select('push_token').in('user_id', ids);
  return [...new Set((devices || []).map((d) => d.push_token).filter(Boolean))];
}

/** Admin user ids */
async function adminUserIds() {
  const { data } = await supabase.from('users').select('id').eq('role', 'admin');
  return (data || []).map((u) => u.id);
}

module.exports = { tokensForUsers, allTokens, adminUserIds };
