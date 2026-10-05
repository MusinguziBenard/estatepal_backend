/**
 * Transactional email.
 * Provider order: Resend HTTP API (RESEND_API_KEY) -> SMTP (SMTP_HOST) -> console fallback (dev only).
 * Never throws: callers get { ok, error } so a mail problem can't crash signup/login.
 * NOTE: many hosts (incl. Render free tier) block outbound SMTP ports; if codes never arrive
 * in production, use RESEND_API_KEY (HTTPS, works everywhere) or upgrade the host plan.
 */
const config = require('../config');

let transporter;

function getTransporter() {
  if (!config.smtp.host) return null;
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
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

async function sendViaResend({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.smtp.from, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
}

/** @returns {Promise<{ok:boolean, dev?:boolean, error?:string}>} */
async function sendEmail({ to, subject, html, text }) {
  try {
    if (process.env.RESEND_API_KEY) {
      await sendViaResend({ to, subject, html, text });
      return { ok: true };
    }
    const t = getTransporter();
    if (!t) {
      if (config.env === 'production') {
        console.error('[email] no provider configured (set SMTP_* or RESEND_API_KEY)');
        return { ok: false, error: 'Email is not configured on the server' };
      }
      console.log(`[email] (dev fallback) → ${to}: ${subject}\n${text || html}`);
      return { ok: true, dev: true };
    }
    await t.sendMail({ from: config.smtp.from, to, subject, html, text });
    return { ok: true };
  } catch (e) {
    console.error('[email] send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendVerificationCode(to, code) {
  return sendEmail({
    to,
    subject: `${code} is your EstatePal verification code`,
    text: `Your EstatePal verification code is ${code}. It expires in ${config.emailCodeTtlMinutes} minutes.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border-radius:16px;background:#f4faf4">
      <h2 style="color:#1B5E20;margin:0 0 8px">EstatePal</h2>
      <p>Your verification code is</p>
      <p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#1B5E20;margin:8px 0">${code}</p>
      <p style="color:#666">It expires in ${config.emailCodeTtlMinutes} minutes. If you didn't request it, ignore this email.</p></div>`,
  });
}

module.exports = { sendEmail, sendVerificationCode };
