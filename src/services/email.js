/**
 * Transactional email.
 * Provider order: Brevo (BREVO_API_KEY) → Resend (RESEND_API_KEY) → SMTP → console (non-production).
 * Never throws: callers get { ok, error, dev? } so a mail problem can't crash signup/login.
 *
 * Production tip: Prefer BREVO_API_KEY or RESEND_API_KEY (HTTPS works on Render).
 * EMAIL_FROM must be a sender verified on that provider.
 */
const config = require('../config');

let transporter;

function getTransporter() {
  if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) return null;
  if (!transporter) {
    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch {
      console.error('[email] nodemailer is not installed. Run: npm install');
      return null;
    }
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 20_000,
      tls: { rejectUnauthorized: true },
    });
  }
  return transporter;
}

/** Parse "Name <email@x.com>" or bare email into { name, email }. */
function parseFrom(from) {
  const raw = (from || '').trim() || 'EstatePal <noreply@schoolmasteruganda.com>';
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) {
    return { name: (m[1] || 'EstatePal').trim() || 'EstatePal', email: m[2].trim() };
  }
  if (raw.includes('@')) return { name: 'EstatePal', email: raw };
  return { name: 'EstatePal', email: raw };
}

async function sendViaBrevo({ to, subject, html, text }) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error('BREVO_API_KEY not set');

  const sender = parseFrom(config.smtp.from);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': key,
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html || `<pre>${text || ''}</pre>`,
      textContent: text || undefined,
    }),
  });
  const body = await res.text().catch(() => '');
  // Brevo success is typically 201
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${body}`);
  return body;
}

async function sendViaResend({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');
  const from = config.smtp.from || 'EstatePal <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body}`);
  return body;
}

/**
 * @returns {Promise<{ok:boolean, dev?:boolean, error?:string}>}
 */
async function sendEmail({ to, subject, html, text }) {
  if (config.env !== 'production') {
    console.log(`[email] → ${to}: ${subject}\n${text || html}`);
  }

  try {
    // Prefer Brevo when configured
    if (process.env.BREVO_API_KEY) {
      await sendViaBrevo({ to, subject, html, text });
      console.log(`[email] sent via Brevo → ${to}`);
      return { ok: true };
    }

    if (process.env.RESEND_API_KEY) {
      await sendViaResend({ to, subject, html, text });
      console.log(`[email] sent via Resend → ${to}`);
      return { ok: true };
    }

    const t = getTransporter();
    if (!t) {
      if (config.env === 'production') {
        console.error(
          '[email] no provider configured — set BREVO_API_KEY (recommended), RESEND_API_KEY, or SMTP_*'
        );
        return { ok: false, error: 'Email is not configured on the server' };
      }
      console.log('[email] (dev fallback — no provider) code is in the log above');
      return { ok: true, dev: true };
    }

    await t.sendMail({ from: config.smtp.from, to, subject, html, text });
    console.log(`[email] sent via SMTP → ${to}`);
    return { ok: true };
  } catch (e) {
    console.error('[email] send failed:', e.message);
    if (config.env !== 'production') {
      return { ok: true, dev: true, error: e.message };
    }
    return { ok: false, error: e.message };
  }
}

async function sendVerificationCode(to, code) {
  const minutes = config.emailCodeTtlMinutes || 10;
  return sendEmail({
    to,
    subject: `${code} is your EstatePal verification code`,
    text: `Your EstatePal verification code is ${code}. It expires in ${minutes} minutes.\n\nIf you did not request this, you can ignore this email.`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:auto;padding:24px;border-radius:16px;background:#f4faf4;border:1px solid #c8e6c9">
      <h2 style="color:#1B5E20;margin:0 0 8px">EstatePal</h2>
      <p style="margin:0 0 12px;color:#333">Your verification code is</p>
      <p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#1B5E20;margin:8px 0">${code}</p>
      <p style="color:#666;margin:16px 0 0;font-size:14px">It expires in ${minutes} minutes. If you didn't request it, ignore this email.</p>
    </div>`,
  });
}

module.exports = { sendEmail, sendVerificationCode };
