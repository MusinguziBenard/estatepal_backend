const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { supabase } = require('../../db/supabase');
const { mapUser } = require('../../utils/mappers');
const { uploadImage } = require('../../services/cloudinary');
const listings = require('../listings/service');
const connections = require('../connections/service');
const auth = require('../auth/service');

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await auth.me(req.user.id));
  })
);

router.patch(
  '/',
  requireAuth,
  validate(z.object({ name: z.string().min(2).optional(), email: z.string().email().optional() })),
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body.name) patch.name = req.body.name.trim();
    if (req.body.email) patch.email = auth.normalizeEmail(req.body.email);
    const { data, error } = await supabase.from('users').update(patch).eq('id', req.user.id).select('*').single();
    if (error) throw error;
    res.json(mapUser(data, { self: true }));
  })
);

// Optional profile picture — accepts a data: URL (base64) or a remote URL.
router.post(
  '/profile-picture',
  requireAuth,
  validate(z.object({ image: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    const img = req.body.image;
    const url = img.startsWith('data:')
      ? await uploadImage(Buffer.from(img.replace(/^data:image\/\w+;base64,/, ''), 'base64'), {
          folder: 'estatepal/profiles',
          publicId: `profile-${req.user.id}-${Date.now()}`,
        })
      : img;
    const { data, error } = await supabase
      .from('users')
      .update({ profile_picture_url: url })
      .eq('id', req.user.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json(mapUser(data, { self: true }));
  })
);

// Optional identity verification: ID photo + the name it's registered under.
// Admin reviews and approves/rejects manually (see /admin/verifications).
router.post(
  '/verification',
  requireAuth,
  validate(z.object({ idPhoto: z.string().min(10), fullNameOnId: z.string().min(2).optional() })),
  asyncHandler(async (req, res) => {
    res.json(await auth.submitIdentity(req.user.id, req.body));
  })
);

// Play policy: users must be able to control non-essential notifications.
router.patch(
  '/notifications',
  requireAuth,
  validate(z.object({ enabled: z.boolean() })),
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('users')
      .update({ notifications_enabled: req.body.enabled })
      .eq('id', req.user.id)
      .select('*')
      .single();
    if (error) throw error;
    res.json(mapUser(data, { self: true }));
  })
);

router.get(
  '/listings',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listings.mine(req.user.id));
  })
);

router.get(
  '/saved',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listings.saved(req.user.id));
  })
);

router.get(
  '/connections',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await connections.mine(req.user.id));
  })
);

router.get(
  '/connections/received',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await connections.received(req.user.id, req.query.listingId));
  })
);

module.exports = router;
