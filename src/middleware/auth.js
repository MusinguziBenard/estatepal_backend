const { resolveSession } = require('../modules/auth/service');
const { unauthorized, forbidden } = require('../utils/errors');

async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
    const user = await resolveSession(token);
    if (!user) throw unauthorized();
    req.user = user;
    req.token = token;
    next();
  } catch (e) {
    next(e.status ? e : unauthorized());
  }
}

/** Optional auth — attaches user if token present */
async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const user = await resolveSession(token);
      if (user) {
        req.user = user;
        req.token = token;
      }
    }
    next();
  } catch {
    next();
  }
}

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(forbidden('Admin only'));
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
