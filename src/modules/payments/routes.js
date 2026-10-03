const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const payments = require('./service');

const router = Router();

router.post(
  '/proof',
  requireAuth,
  validate(
    z.object({
      referenceCode: z.string().min(3),
      transactionId: z.string().min(4),
      payerPhone: z.string().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    await payments.submitProof(req.body, req.user.id);
    res.status(204).end();
  })
);

module.exports = router;
