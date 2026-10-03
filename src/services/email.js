/**
 * Transactional email. Uses SMTP if configured, otherwise logs to the console
 * (same dev-friendly fallback pattern as the phone OTP service) so local/dev
 * work never blocks on a mail provider.
 */
const config = require('../config');

let transporterPromise;

async function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporterPromise) {
    const nodemailer = require('nodemailer');
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      })
    );
  }
  return transporterPromise;
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} msg
 */
async function sendEmail({ to, subject, html, text }) {
  const transporter = await getTransporter();
  if (!transporter) {
    console.log(`[email] (dev fallback, no SMTP configured) → ${to}: ${subject}\n${text || html}`);
    return { ok: true, dev: true };
  }
  try {
    await transporter.sendMail({ from: config.smtp.from, to, subject, html, text });
    return { ok: true };
  } catch (e) {
    console.warn('[email] send failed', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendVerificationCode(to, code) {
  return sendEmail({
    to,
    subject: 'Your EstatePal verification code',
    text: `Your EstatePal verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your EstatePal verification code is <b style="font-size:20px">${code}</b>.</p><p>It expires in 10 minutes.</p>`,
  });
}

module.exports = { sendEmail, sendVerificationCode };
