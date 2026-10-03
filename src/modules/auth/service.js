const { supabase } = require('../../db/supabase');
const config = require('../../config');
const {
  generateOtp,
  generateEmailCode,
  sha256,
  randomToken,
  hashPassword,
  comparePassword,
} = require('../../utils/crypto');
const { mapUser } = require('../../utils/mappers');
const { validation, unauthorized, conflict } = require('../../utils/errors');
const { emit, EVENTS } = require('../../events/bus');
const { uploadImage } = require('../../services/cloudinary');
const { sendVerificationCode } = require('../../services/email');

const SESSION_DAYS = 60;

function normalizePhone(phone) {
  const p = String(phone || '').replace(/\s/g, '');
  if (!/^\+?\d{10,15}$/.test(p)) throw validation('Invalid phone number');
  return p.startsWith('+') ? p : `+${p}`;
}

function normalizeEmail(email) {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw validation('Invalid email address');
  return e;
}

async function createSession(userId) {
  const rawToken = randomToken(32);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await supabase.from('sessions').insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });
  return rawToken;
}

async function uploadDataUrl(dataUrlOrUrl, folder, publicId) {
  if (!dataUrlOrUrl) return null;
  if (typeof dataUrlOrUrl === 'string' && dataUrlOrUrl.startsWith('data:')) {
    const b64 = dataUrlOrUrl.replace(/^data:image\/\w+;base64,/, '');
    return uploadImage(Buffer.from(b64, 'base64'), { folder, publicId });
  }
  return dataUrlOrUrl; // already a URL
}

async function sendEmailCodeInternal(userId, email) {
  const code = process.env.NODE_ENV === 'development' && process.env.DEV_EMAIL_OTP
    ? process.env.DEV_EMAIL_OTP
    : generateEmailCode();
  const expires = new Date(Date.now() + config.emailCodeTtlMinutes * 60_000).toISOString();

  await supabase.from('email_codes').update({ used: true }).eq('user_id', userId).eq('used', false);
  await supabase.from('email_codes').insert({ user_id: userId, email, code, expires_at: expires });

  if (config.env !== 'production') console.log(`[email-otp] ${email} -> ${code}`);
  await sendVerificationCode(email, code);
}

/**
 * Registration collects name, phone and password up front (required), with
 * email and a profile picture optional. If an email is given we immediately
 * fire off a verification code (self-serve, checked via /auth/email/verify).
 * Phone verification is a later feature -- the number is only collected and
 * stored here; real SMS verification is wired up separately. The account is
 * usable (session returned) right after registering so sign-up stays fast.
 */
async function register({ name, phone, password, email, acceptedTerms, profilePicture }) {
  const normPhone = normalizePhone(phone);
  const normEmail = normalizeEmail(email);
  if (!name || String(name).trim().length < 2) throw validation('Please enter your name');
  if (!password || String(password).length < 6) throw validation('Password must be at least 6 characters');
  if (!acceptedTerms) throw validation('Please accept the Terms of Use and Privacy Policy');

  const { data: existingPhone } = await supabase.from('users').select('id').eq('phone', normPhone).maybeSingle();
  if (existingPhone) throw conflict('An account with this phone number already exists');

  if (normEmail) {
    const { data: existingEmail } = await supabase.from('users').select('id').eq('email', normEmail).maybeSingle();
    if (existingEmail) throw conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(password);
  const isAdminPhone = config.adminPhones.includes(normPhone);

  let profilePictureUrl = null;
  if (profilePicture) {
    profilePictureUrl = await uploadDataUrl(profilePicture, 'estatepal/profiles', `profile-${Date.now()}`);
  }

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      name: String(name).trim(),
      phone: normPhone,
      email: normEmail,
      password_hash: passwordHash,
      profile_picture_url: profilePictureUrl,
      role: isAdminPhone ? 'admin' : 'user',
      accepted_terms_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;

  const token = await createSession(user.id);

  emit(EVENTS.USER_SIGNED_UP, { userId: user.id, phone: user.phone, name: user.name });

  if (normEmail) {
    // Best-effort -- registration still succeeds even if the email can't be sent.
    sendEmailCodeInternal(user.id, normEmail).catch((e) => console.warn('[email] verification send failed', e.message));
  }

  return { token, user: mapUser(user, { self: true }) };
}

async function login(phoneRaw, password) {
  const phone = normalizePhone(phoneRaw);
  const { data: user } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
  if (!user || !(await comparePassword(password, user.password_hash))) {
    throw unauthorized('Wrong phone number or password');
  }
  const token = await createSession(user.id);
  emit(EVENTS.USER_SIGNED_IN, { userId: user.id, phone: user.phone });
  return { token, user: mapUser(user, { self: true }) };
}

async function requestEmailCode(userId) {
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user.email) throw validation('Add an email address first');
  if (user.email_verified_at) return { ok: true, alreadyVerified: true };
  await sendEmailCodeInternal(userId, user.email);
  return { ok: true };
}

async function verifyEmailCode(userId, code) {
  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user.email) throw validation('No email on this account');

  const { data: rows } = await supabase
    .from('email_codes')
    .select('*')
    .eq('user_id', userId)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const rec = rows?.[0];
  if (!rec || rec.code !== String(code).trim()) throw unauthorized('Wrong or expired code');

  await supabase.from('email_codes').update({ used: true }).eq('id', rec.id);
  const { data: updated } = await supabase
    .from('users')
    .update({ email_verified_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();

  emit(EVENTS.EMAIL_VERIFIED, { userId, email: user.email });
  return mapUser(updated, { self: true });
}

/**
 * ID verification submission (self-serve upload, admin-reviewed). Optional --
 * users can keep using the app without it. The photo itself is never exposed
 * in public payloads; only self and admin views include it.
 */
async function submitIdentity(userId, { idPhoto, fullNameOnId }) {
  if (!idPhoto) throw validation('An ID photo is required to submit for verification');
  const url = await uploadDataUrl(idPhoto, 'estatepal/verification', `id-${userId}-${Date.now()}`);

  const { data: updated, error } = await supabase
    .from('users')
    .update({
      id_photo_url: url,
      id_submitted_at: new Date().toISOString(),
      identity_verification_status: 'PENDING',
      identity_rejection_reason: null,
    })
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;

  emit(EVENTS.IDENTITY_SUBMITTED, { userId, fullNameOnId });
  return mapUser(updated, { self: true });
}

/** --- Legacy / future: phone OTP (kept for when SMS verification is wired up) --- */

async function requestOtp(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  const code = process.env.NODE_ENV === 'development' && process.env.DEV_OTP
    ? process.env.DEV_OTP
    : generateOtp();

  const expires = new Date(Date.now() + config.otpTtlMinutes * 60_000).toISOString();
  await supabase.from('otp_codes').update({ used: true }).eq('phone', phone).eq('used', false);
  const { error } = await supabase.from('otp_codes').insert({ phone, code, expires_at: expires });
  if (error) throw error;

  if (config.env !== 'production') console.log(`[otp] ${phone} -> ${code}`);
  // Production: integrate SMS provider (Africa's Talking, Twilio, etc.)
  return { ok: true };
}

async function verifyOtp(phoneRaw, code) {
  const phone = normalizePhone(phoneRaw);
  if (!code || String(code).length < 4) throw validation('Invalid code');

  const { data: rows } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('phone', phone)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const otp = rows?.[0];
  if (!otp || otp.code !== String(code).trim()) throw unauthorized('Wrong or expired code');
  await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);

  const { data: user } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
  if (!user) throw unauthorized('No account with this phone number -- register first');

  const token = await createSession(user.id);
  emit(EVENTS.USER_SIGNED_IN, { userId: user.id, phone: user.phone });
  return { token, user: mapUser(user, { self: true }) };
}

async function resolveSession(rawToken) {
  if (!rawToken) return null;
  const tokenHash = sha256(rawToken);
  const { data: session } = await supabase
    .from('sessions')
    .select('*, users(*)')
    .eq('token_hash', tokenHash)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!session?.users) return null;
  return mapUser(session.users, { self: true });
}

async function me(userId) {
  const { data } = await supabase.from('users').select('*').eq('id', userId).single();
  return mapUser(data, { self: true });
}

async function revokeSession(rawToken) {
  if (!rawToken) return;
  await supabase.from('sessions').delete().eq('token_hash', sha256(rawToken));
}

module.exports = {
  register,
  login,
  requestEmailCode,
  verifyEmailCode,
  submitIdentity,
  requestOtp,
  verifyOtp,
  resolveSession,
  me,
  revokeSession,
  normalizePhone,
  normalizeEmail,
};
