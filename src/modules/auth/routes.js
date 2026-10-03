const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/errors');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const auth = require('./service');

const router = Router();

// ─── Register: name + phone + password required, email + avatar optional ───
router.post(
  '/register',
  validate(
    z.object({
      name: z.string().min(2),
      phone: z.string().min(10),
      password: z.string().min(6),
      email: z.string().email().optional().or(z.literal('')).optional(),
      acceptedTerms: z.boolean(),
      avatar: z.string().optional(), // data: URL or remote URL
    })
  ),
  asyncHandler(async (req, res) => {
    const result = await auth.register({ ...req.body, email: req.body.email || undefined });
    res.status(201).json(result);
  })
);

// ─── Login: phone OR email + password. May come back needsEmailVerification. ───
router.post(
  '/login',
  validate(
    z.object({
      phone: z.string().min(10).optional(),
      email: z.string().email().optional(),
      password: z.string().min(1),
    }).refine((d) => d.phone || d.email, { message: 'Phone or email is required' })
  ),
  asyncHandler(async (req, res) => {
    const result = await auth.login(req.body);
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

// ─── Email verification (public — this is what completes a pending signup/login) ───
router.post(
  '/verify-email',
  validate(z.object({ email: z.string().email(), code: z.string().min(4) })),
  asyncHandler(async (req, res) => {
    res.json(await auth.verifyEmail(req.body.email, req.body.code));
  })
);

router.post(
  '/resend-email-otp',
  validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    res.json(await auth.resendEmailOtp(req.body.email));
  })
);

// ─── Phone verification: authenticated, optional, always a later step ───
router.post(
  '/request-phone-otp',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await auth.requestPhoneOtp(req.user.id, req.user.phone));
  })
);

router.post(
  '/verify-phone',
  requireAuth,
  validate(z.object({ code: z.string().min(4) })),
  asyncHandler(async (req, res) => {
    res.json(await auth.verifyPhone(req.user.id, req.user.phone, req.body.code));
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await auth.me(req.user.id));
  })
);

module.exports = router;
