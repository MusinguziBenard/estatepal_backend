const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const admin = require('./service');

const router = Router();
router.use(requireAuth, requireAdmin);

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    res.json(await admin.dashboard());
  })
);

router.get(
  '/proofs',
  asyncHandler(async (_req, res) => {
    res.json(await admin.listPendingProofs());
  })
);

router.post(
  '/proofs/:id/review',
  validate(
    z.object({
      approve: z.boolean(),
      note: z.string().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const result = await admin.reviewProof(req.params.id, req.user.id, req.body);
    res.json(result);
  })
);

router.get(
  '/listings',
  asyncHandler(async (req, res) => {
    res.json(await admin.listListings({ status: req.query.status, q: req.query.q }));
  })
);

router.post(
  '/listings/:id/approve',
  validate(z.object({ note: z.string().optional() }).partial()),
  asyncHandler(async (req, res) => {
    res.json(await admin.approveListing(req.params.id, req.user.id, req.body || {}));
  })
);

router.post(
  '/listings/:id/reject',
  validate(z.object({ reason: z.string().optional() }).partial()),
  asyncHandler(async (req, res) => {
    res.json(await admin.rejectListing(req.params.id, req.user.id, req.body || {}));
  })
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    res.json(await admin.listUsers({ q: req.query.q }));
  })
);

// Pending ID-photo verifications awaiting manual review.
router.get(
  '/verifications',
  asyncHandler(async (_req, res) => {
    res.json(await admin.listVerifications());
  })
);

router.post(
  '/users/:id/role',
  validate(z.object({ role: z.enum(['user', 'admin']) })),
  asyncHandler(async (req, res) => {
    res.json(await admin.setUserRole(req.params.id, req.body.role, req.user.id));
  })
);

router.post(
  '/users/:id/identity',
  validate(z.object({ status: z.enum(['NONE', 'PENDING', 'VERIFIED', 'REJECTED']), reason: z.string().optional() })),
  asyncHandler(async (req, res) => {
    res.json(await admin.setIdentityStatus(req.params.id, req.body.status, req.user.id, { reason: req.body.reason }));
  })
);

module.exports = router;
