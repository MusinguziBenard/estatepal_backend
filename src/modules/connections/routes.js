const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const connections = require('./service');

const router = Router();

router.post(
  '/',
  requireAuth,
  validate(z.object({ listingId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const c = await connections.request(req.body.listingId, req.user.id);
    res.status(201).json(c);
  })
);

router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await connections.mine(req.user.id);
    res.json(list);
  })
);

router.get(
  '/received',
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await connections.received(req.user.id, req.query.listingId);
    res.json(list);
  })
);

module.exports = router;
