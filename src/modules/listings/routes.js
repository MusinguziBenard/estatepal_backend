const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth } = require('../../middleware/auth');
const listings = require('./service');

const router = Router();

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const filters = {
      district: req.query.district,
      category: req.query.category,
      transactionType: req.query.transactionType,
      q: req.query.q,
      sort: req.query.sort,
    };
    const result = await listings.list(filters, req.query.cursor, req.user?.id);
    res.json(result);
  })
);

router.get(
  '/:id/similar',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const items = await listings.similar(req.params.id, req.user?.id);
    res.json(items);
  })
);

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const item = await listings.getById(req.params.id, req.user?.id);
    res.json(item);
  })
);

router.post(
  '/:id/like',
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = await listings.toggleLike(req.params.id, req.user.id);
    res.json(item);
  })
);

router.post(
  '/',
  requireAuth,
  validate(
    z.object({
      title: z.string().min(3),
      description: z.string().max(4000).optional().or(z.literal('')).optional(),
      category: z.enum(['LAND', 'SUGARCANE_PLANTATION']),
      transactionType: z.enum(['SALE', 'LEASE']),
      acreage: z.number().positive().or(z.string()),
      unitPrice: z.number().positive().or(z.string()),
      leaseYears: z.number().optional().or(z.string().optional()),
      caneAgeMonths: z.number().optional().or(z.string().optional()),
      harvests: z.number().optional().or(z.string().optional()),
      district: z.string().min(1),
      subcounty: z.string().min(1),
      customLocation: z.string().optional(),
      gps: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      package: z.enum(['STANDARD', 'PREMIUM']).default('STANDARD'),
      ownership: z.enum(['OWNER', 'BROKER']),
      images: z.array(z.string()).min(1).max(5),
      phone: z.string().min(10),
      whatsapp: z.string().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const body = {
      ...req.body,
      acreage: Number(req.body.acreage),
      unitPrice: Number(req.body.unitPrice),
      leaseYears: req.body.leaseYears != null ? Number(req.body.leaseYears) : undefined,
      caneAgeMonths: req.body.caneAgeMonths != null ? Number(req.body.caneAgeMonths) : undefined,
      harvests: req.body.harvests != null ? Number(req.body.harvests) : undefined,
      description: req.body.description || undefined,
    };
    const created = await listings.create(body, req.user.id);
    res.status(201).json(created);
  })
);

module.exports = router;
