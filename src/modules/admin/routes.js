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

// Hard-delete listing in any status (including PUBLISHED / approved)
router.delete(
  '/listings/:id',
  asyncHandler(async (req, res) => {
    res.json(await admin.deleteListing(req.params.id, req.user.id));
  })
);

// Update listing details and/or replace images (any status)
router.patch(
  '/listings/:id',
  validate(
    z
      .object({
        title: z.string().min(3).optional(),
        description: z.string().max(4000).nullable().optional(),
        category: z.enum(['LAND', 'SUGARCANE_PLANTATION']).optional(),
        transactionType: z.enum(['SALE', 'LEASE']).optional(),
        acreage: z.number().positive().or(z.string()).optional(),
        unitPrice: z.number().positive().or(z.string()).optional(),
        advertisedValueUGX: z.number().positive().or(z.string()).optional(),
        leaseYears: z.number().nullable().or(z.string()).optional(),
        caneAgeMonths: z.number().nullable().or(z.string()).optional(),
        harvests: z.number().nullable().or(z.string()).optional(),
        district: z.string().min(1).optional(),
        subcounty: z.string().min(1).optional(),
        customLocation: z.string().nullable().optional(),
        gps: z
          .object({
            latitude: z.number().optional(),
            longitude: z.number().optional(),
          })
          .optional(),
        ownership: z.enum(['OWNER', 'BROKER']).optional(),
        package: z.enum(['STANDARD', 'PREMIUM']).optional(),
        status: z
          .enum([
            'DRAFT',
            'AWAITING_PAYMENT',
            'PROOF_SUBMITTED',
            'UNDER_REVIEW',
            'PUBLISHED',
            'EXPIRED',
            'SOLD',
            'LEASED',
            'REJECTED',
          ])
          .optional(),
        contactPhone: z.string().optional(),
        contactWhatsapp: z.string().nullable().optional(),
        contactName: z.string().nullable().optional(),
        rejectionReason: z.string().nullable().optional(),
        // Full replace: mix of existing https URLs + new data: base64 uploads
        images: z.array(z.string()).min(1).max(8).optional(),
      })
      .partial()
  ),
  asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (body.acreage != null) body.acreage = Number(body.acreage);
    if (body.unitPrice != null) body.unitPrice = Number(body.unitPrice);
    if (body.advertisedValueUGX != null) body.advertisedValueUGX = Number(body.advertisedValueUGX);
    if (body.leaseYears != null && body.leaseYears !== '') body.leaseYears = Number(body.leaseYears);
    if (body.caneAgeMonths != null && body.caneAgeMonths !== '') body.caneAgeMonths = Number(body.caneAgeMonths);
    if (body.harvests != null && body.harvests !== '') body.harvests = Number(body.harvests);
    res.json(await admin.updateListing(req.params.id, req.user.id, body));
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
