const crypto = require('crypto');
const bcrypt = require('bcryptjs');

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
}

async function comparePassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), hash);
}

/** 6-digit numeric email verification code */
function generateEmailCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** 6-digit numeric OTP */
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function reference(prefix, seq) {
  const n = String(seq).padStart(6, '0');
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${n}`;
}

module.exports = {
  sha256,
  randomToken,
  generateOtp,
  generateEmailCode,
  reference,
  hashPassword,
  comparePassword,
};
