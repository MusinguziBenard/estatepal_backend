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
const { validation, unauthorized, conflict, notFound } = require('../../utils/errors');
const { emit, EVENTS } = require('../../events/bus');
const { uploadImage } = require('../../services/cloudinary');
const { sendVerificationCode } = require('../../services/email');

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
  const expiresAt = new Date(Date.now() + config.sessionDays * 86400_000).toISOString();
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
  return sendVerificationCode(email, code);
}

/**
 * Registration collects name, phone and password up front (required), with email and
 * an avatar optional. This is the "start with email" gate the product wants: if an
 * email is given, the account is created but NOT logged in yet — a code is fired off
 * and the app is told `needsEmailVerification`, so verify-email is step two. With no
 * email, phone+password is enough and a session is returned immediately. Phone
 * verification is always a separate, later, optional step (requestPhoneOtp/verifyPhone).
 */
async function register({ name, phone, password, email, acceptedTerms, avatar }) {
  const normPhone = normalizePhone(phone);
  const normEmail = normalizeEmail(email);
  if (!name || String(name).trim().length < 2) throw validation('Please enter your name');
  if (!password || String(password).length < 6) throw validation('Password must be at least 6 characters');
  if (!acceptedTerms) throw validation('Please accept the Terms of Use and Privacy Policy');

  const { data: existingPhone } = await supabase.from('users').select('*').eq('phone', normPhone).maybeSingle();
  if (existingPhone) {
    // Half-finished earlier signup (email given, never verified): let them resume instead of locking them out.
    const sameOwner = existingPhone.email && !existingPhone.email_verified_at && (await comparePassword(password, existingPhone.password_hash));
    if (!sameOwner) throw conflict('An account with this phone number already exists');
    const target = normEmail || existingPhone.email;
    if (normEmail && normEmail !== existingPhone.email) {
      await supabase.from('users').update({ email: normEmail }).eq('id', existingPhone.id);
    }
    const sent = await sendEmailCodeInternal(existingPhone.id, target);
    return { needsEmailVerification: true, email: target, emailSent: !!sent?.ok, message: sent?.ok ? undefined : 'We could not send the code. Tap "Resend code".' };
  }

  if (normEmail) {
    const { data: existingEmail } = await supabase.from('users').select('id').eq('email', normEmail).maybeSingle();
    if (existingEmail) throw conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(password);
  const isAdminPhone = config.adminPhones.includes(normPhone);

  let avatarUrl = null;
  if (avatar) avatarUrl = await uploadDataUrl(avatar, 'estatepal/profiles', `profile-${Date.now()}`);

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      name: String(name).trim(),
      phone: normPhone,
      email: normEmail,
      password_hash: passwordHash,
      profile_picture_url: avatarUrl,
      role: isAdminPhone ? 'admin' : 'user',
      accepted_terms_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;

  emit(EVENTS.USER_SIGNED_UP, { userId: user.id, phone: user.phone, name: user.name });

  if (normEmail) {
    const sent = await sendEmailCodeInternal(user.id, normEmail);
    return {
      needsEmailVerification: true,
      email: normEmail,
      emailSent: !!sent?.ok,
      message: sent?.ok ? undefined : 'Account created, but we could not send the code. Tap "Resend code".',
    };
  }

  const token = await createSession(user.id);
  return { token, user: mapUser(user) };
}

/**
 * Accepts phone OR email + password. If the account has an email that hasn't been
 * verified yet, login is blocked with `needsEmailVerification` instead of a token —
 * mirrors register()'s gate so a half-finished signup can always be resumed.
 */
async function login({ phone, email, password }) {
  if (!phone && !email) throw validation('Enter your phone number or email');

  let query = supabase.from('users').select('*');
  query = phone ? query.eq('phone', normalizePhone(phone)) : query.eq('email', normalizeEmail(email));
  const { data: user, error } = await query.maybeSingle();
  // Never mask DB/auth failures as "wrong password" (e.g. Unregistered API key).
  if (error) {
    console.error('[auth/login] supabase error:', error.message);
    throw error;
  }

  if (!user || !(await comparePassword(password, user.password_hash))) {
    throw unauthorized('Wrong phone/email or password');
  }

  if (user.email && !user.email_verified_at) {
    const sent = await sendEmailCodeInternal(user.id, user.email);
    return {
      needsEmailVerification: true,
      email: user.email,
      emailSent: !!sent?.ok,
      message: sent?.ok ? 'Verify your email first — we just sent you a new code.' : 'Verify your email first. We could not send a code, tap "Resend code".',
    };
  }

  const token = await createSession(user.id);
  emit(EVENTS.USER_SIGNED_IN, { userId: user.id, phone: user.phone });
  return { token, user: mapUser(user) };
}

/**
 * Public (no auth yet — this is what completes a pending registration/login).
 * Verifies the code, marks the email verified, and — since this is the moment the
 * account becomes fully usable — issues the session here.
 */
async function verifyEmail(emailRaw, code) {
  const email = normalizeEmail(emailRaw);
  if (!email) throw validation('Email required');
  const { data: user, error: userErr } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (userErr) { console.error('[auth/verifyEmail]', userErr.message); throw userErr; }
  if (!user) throw notFound('No account with this email');

  const { data: rows } = await supabase
    .from('email_codes')
    .select('*')
    .eq('user_id', user.id)
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
    .eq('id', user.id)
    .select('*')
    .single();

  emit(EVENTS.EMAIL_VERIFIED, { userId: user.id, email });

  const token = await createSession(user.id);
  return { token, user: mapUser(updated) };
}

/** Public — resend while the account still has no password-protected session. */
async function resendEmailOtp(emailRaw) {
  const email = normalizeEmail(emailRaw);
  const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (!user) throw notFound('No account with this email');
  if (user.email_verified_at) return { ok: true, message: 'This email is already verified — just log in.' };
  const sent = await sendEmailCodeInternal(user.id, email);
  if (!sent?.ok) throw validation('Could not send the email right now. Please try again shortly.');
  return { ok: true };
}

/** ─── Phone verification: authenticated, always a later/optional step ─── */

async function requestPhoneOtp(userId, phone) {
  const code = process.env.NODE_ENV === 'development' && process.env.DEV_OTP ? process.env.DEV_OTP : generateOtp();
  const expires = new Date(Date.now() + config.otpTtlMinutes * 60_000).toISOString();
  await supabase.from('otp_codes').update({ used: true }).eq('phone', phone).eq('used', false);
  await supabase.from('otp_codes').insert({ phone, code, expires_at: expires });
  if (config.env !== 'production') console.log(`[otp] ${phone} -> ${code}`);
  // Production: integrate an SMS provider (Africa's Talking, Twilio, etc.) here.
  return { ok: true };
}

async function verifyPhone(userId, phone, code) {
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

  const { data: updated, error } = await supabase
    .from('users')
    .update({ phone_verified_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;

  emit(EVENTS.PHONE_VERIFIED, { userId, phone });
  return { user: mapUser(updated) };
}

/**
 * ID verification submission (self-serve upload, admin-reviewed). Optional —
 * users can keep using the app without it. The photo itself is never exposed
 * in public payloads; only admin endpoints include it.
 */
async function submitIdentity(userId, { nationalIdImage, nationalIdName }) {
  if (!nationalIdImage) throw validation('A national ID photo is required');
  const url = await uploadDataUrl(nationalIdImage, 'estatepal/verification', `id-${userId}-${Date.now()}`);

  const { data: updated, error } = await supabase
    .from('users')
    .update({
      id_photo_url: url,
      id_full_name: nationalIdName || null,
      id_submitted_at: new Date().toISOString(),
      identity_verification_status: 'PENDING',
      identity_rejection_reason: null,
    })
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;

  emit(EVENTS.IDENTITY_SUBMITTED, { userId, fullNameOnId: nationalIdName });
  return mapUser(updated);
}

/** Consolidated profile update: name / avatar / push preference, any subset. */
async function updateProfile(userId, { name, avatar, pushEnabled }) {
  const patch = {};
  if (name != null) patch.name = String(name).trim();
  if (pushEnabled != null) patch.notifications_enabled = !!pushEnabled;
  if (avatar) patch.profile_picture_url = await uploadDataUrl(avatar, 'estatepal/profiles', `profile-${userId}-${Date.now()}`);

  const { data, error } = await supabase.from('users').update(patch).eq('id', userId).select('*').single();
  if (error) throw error;
  return mapUser(data);
}

/**
 * Resolves a bearer token to a user, sliding the session's expiry forward when it's
 * more than half spent — an active user is effectively never logged out, while a
 * token nobody has used in config.sessionDays/2 .. sessionDays stops renewing itself.
 */
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

  const msRemaining = new Date(session.expires_at).getTime() - Date.now();
  const halfWindowMs = (config.sessionDays * 86400_000) / 2;
  if (msRemaining < halfWindowMs) {
    const newExpiry = new Date(Date.now() + config.sessionDays * 86400_000).toISOString();
    supabase.from('sessions').update({ expires_at: newExpiry }).eq('id', session.id).then(() => {}).catch(() => {});
  }

  return mapUser(session.users);
}

async function me(userId) {
  const { data } = await supabase.from('users').select('*').eq('id', userId).single();
  return mapUser(data);
}

async function meAdmin(userId) {
  const { data } = await supabase.from('users').select('*').eq('id', userId).single();
  return mapUser(data, { admin: true });
}

async function revokeSession(rawToken) {
  if (!rawToken) return;
  await supabase.from('sessions').delete().eq('token_hash', sha256(rawToken));
}


/**
 * Forgot password — email only (needs an email on the account).
 * Always returns a generic ok so we do not leak whether the email is registered.
 * Code is still stored when the user exists.
 */
async function requestPasswordReset(emailRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) throw validation('Email is required');

  const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (!user) {
    // Do not reveal missing accounts
    return { ok: true, message: 'If that email is registered, a reset code has been sent.' };
  }
  if (!user.password_hash) {
    return { ok: true, message: 'If that email is registered, a reset code has been sent.' };
  }

  const sent = await sendEmailCodeInternal(user.id, email);
  if (!sent?.ok) {
    // Still surface send failures so ops can see Resend/domain issues
    throw validation(
      sent?.error?.includes('403') || sent?.error?.includes('domain')
        ? 'Email could not be delivered. The server needs a verified sending domain.'
        : 'Could not send the reset code. Please try again shortly.'
    );
  }
  return { ok: true, message: 'If that email is registered, a reset code has been sent.', emailSent: true };
}

/**
 * Reset password with email + OTP from requestPasswordReset.
 * Invalidates other sessions after a successful change.
 */
async function resetPassword({ email: emailRaw, code, newPassword }) {
  const email = normalizeEmail(emailRaw);
  if (!email) throw validation('Email is required');
  if (!newPassword || String(newPassword).length < 6) {
    throw validation('New password must be at least 6 characters');
  }

  const { data: user, error: userErr } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (userErr) { console.error('[auth/resetPassword]', userErr.message); throw userErr; }
  if (!user) throw unauthorized('Wrong or expired code');

  const { data: rows } = await supabase
    .from('email_codes')
    .select('*')
    .eq('user_id', user.id)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const rec = rows?.[0];
  if (!rec || rec.code !== String(code).trim()) throw unauthorized('Wrong or expired code');

  await supabase.from('email_codes').update({ used: true }).eq('id', rec.id);

  const passwordHash = await hashPassword(newPassword);
  await supabase.from('users').update({ password_hash: passwordHash }).eq('id', user.id);

  // Force re-login everywhere
  await supabase.from('sessions').delete().eq('user_id', user.id);

  return { ok: true, message: 'Password updated. You can sign in with your new password.' };
}


/** Check reset OTP without consuming it — UI can advance to “new password” step. */
async function verifyResetCode(emailRaw, code) {
  const email = normalizeEmail(emailRaw);
  if (!email) throw validation('Email is required');
  if (!code || String(code).trim().length < 4) throw validation('Enter the code from your email');

  const { data: user } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (!user) throw unauthorized('Wrong or expired code');

  const { data: rows } = await supabase
    .from('email_codes')
    .select('*')
    .eq('user_id', user.id)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const rec = rows?.[0];
  if (!rec || rec.code !== String(code).trim()) throw unauthorized('Wrong or expired code');
  return { ok: true, message: 'Code confirmed. Choose a new password.' };
}

module.exports = {
  register,
  login,
  verifyEmail,
  resendEmailOtp,
  requestPasswordReset,
  verifyResetCode,
  resetPassword,
  requestPhoneOtp,
  verifyPhone,
  submitIdentity,
  updateProfile,
  resolveSession,
  me,
  meAdmin,
  revokeSession,
  normalizePhone,
  normalizeEmail,
};
