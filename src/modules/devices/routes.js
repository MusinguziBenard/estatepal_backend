const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { supabase } = require('../../db/supabase');

const router = Router();

router.post(
  '/',
  requireAuth,
  validate(
    z.object({
      pushToken: z.string().min(10),
      platform: z.string().default('android'),
    })
  ),
  asyncHandler(async (req, res) => {
    const { pushToken, platform } = req.body;
    const userId = req.user.id;

    await supabase.from('devices').upsert(
      { user_id: userId, push_token: pushToken, platform },
      { onConflict: 'user_id,push_token' }
    );

    // Also keep array on user for convenience
    const { data: user } = await supabase.from('users').select('push_tokens').eq('id', userId).single();
    const tokens = new Set([...(user?.push_tokens || []), pushToken]);
    await supabase.from('users').update({ push_tokens: [...tokens] }).eq('id', userId);

    res.status(204).end();
  })
);

module.exports = router;
