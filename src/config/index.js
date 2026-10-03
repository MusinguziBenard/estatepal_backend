require('dotenv').config();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const config = {
  port: num(process.env.PORT, 4000),
  env: process.env.NODE_ENV || 'development',
  corsOrigin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  adminPhones: (process.env.ADMIN_PHONES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  smtp: {
    host: process.env.SMTP_HOST,
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    // .env uses EMAIL_FROM; SMTP_FROM accepted too for compatibility. Falls back to
    // SMTP_USER because providers like Gmail reject a From that isn't the authenticated account.
    from: process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || 'EstatePal <no-reply@estatepal.app>',
  },

  emailCodeTtlMinutes: 10,

  fees: {
    connection: num(process.env.CONNECTION_FEE_UGX, 5000),
  },

  pricingBands: [
    { max: 20_000_000, standard: 20_000, premium: 35_000 },
    { max: 50_000_000, standard: 25_000, premium: 45_000 },
    { max: Infinity, standard: 35_000, premium: 60_000 },
  ],

  listingExpiryDays: 30,
  otpTtlMinutes: 10,
  pageSize: 12,

  // Sessions are sliding-window: every authenticated request that lands when less than
  // half the window remains pushes expiry back out to sessionDays. An active user is
  // effectively never logged out; a dormant one expires after ~a year of inactivity.
  sessionDays: num(process.env.SESSION_DAYS, 365),
};

function assertConfig() {
  const missing = [];
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    console.warn(`[config] Missing env: ${missing.join(', ')} — set them before production.`);
  }
}

assertConfig();
module.exports = config;
