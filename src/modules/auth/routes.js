const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const auth = require('./service');

const router = Router();

// ─── Primary flow: register with name + phone + password, email optional ───
router.post(
  '/register',
  validate(
    z.object({
      name: z.string().min(2),
      phone: z.string().min(10),
      password: z.string().min(6),
      email: z.string().email().optional().or(z.literal('')).optional(),
      acceptedTerms: z.boolean(),
      profilePicture: z.string().optional(), // data: URL or remote URL
    })
  ),
  asyncHandler(async (req, res) => {
    const result = await auth.register({ ...req.body, email: req.body.email || undefined });
    res.status(201).json(result);
  })
);

router.post(
  '/login',
  validate(z.object({ phone: z.string().min(10), password: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const result = await auth.login(req.body.phone, req.body.password);
    res.json(result);
  })
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await auth.revokeSession(req.token);
    res.status(204).end();
  })
);

// ─── Email verification (self-serve) ───
router.post(
  '/email/send-code',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await auth.requestEmailCode(req.user.id));
  })
);

router.post(
  '/email/verify',
  requireAuth,
  validate(z.object({ code: z.string().min(4) })),
  asyncHandler(async (req, res) => {
    res.json(await auth.verifyEmailCode(req.user.id, req.body.code));
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await auth.me(req.user.id));
  })
);

// ─── Legacy / future: phone OTP, kept for when SMS verification is wired up ───
router.post(
  '/otp',
  validate(z.object({ phone: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    await auth.requestOtp(req.body.phone);
    res.status(204).end();
  })
);

router.post(
  '/verify',
  validate(z.object({ phone: z.string().min(10), code: z.string().min(4) })),
  asyncHandler(async (req, res) => {
    const result = await auth.verifyOtp(req.body.phone, req.body.code);
    res.json(result);
  })
);

module.exports = router;
