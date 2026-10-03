const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const auth = require('../auth/service');

const router = Router();

// Optional self-serve ID verification: POST /verification { nationalIdImage, nationalIdName }
// Admin reviews and approves/rejects manually — see GET/POST /admin/verifications.
router.post(
  '/',
  requireAuth,
  validate(z.object({ nationalIdImage: z.string().min(10), nationalIdName: z.string().min(2).optional() })),
  asyncHandler(async (req, res) => {
    res.json(await auth.submitIdentity(req.user.id, req.body));
  })
);

module.exports = router;
