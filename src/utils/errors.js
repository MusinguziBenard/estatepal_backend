class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const notFound = (msg = 'Not found') => new AppError(msg, 404, 'NOT_FOUND');
const unauthorized = (msg = 'Unauthorized') => new AppError(msg, 401, 'UNAUTHORIZED');
const forbidden = (msg = 'Forbidden') => new AppError(msg, 403, 'FORBIDDEN');
const conflict = (msg = 'Conflict') => new AppError(msg, 409, 'CONFLICT');
const validation = (msg = 'Validation failed') => new AppError(msg, 422, 'VALIDATION');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function errorMiddleware(err, _req, res, _next) {
  // Postgrest / Supabase errors often have .message and .code but no .status
  const isDb = err && (err.code === 'PGRST301' || /unregistered api key|jwt|api key/i.test(String(err.message || '')));
  const status = err.status || (isDb ? 503 : 500);
  const expose = status < 500 || process.env.NODE_ENV !== 'production' || isDb;
  const message = expose ? (err.message || 'Internal server error') : 'Internal server error';
  if (status >= 500 || isDb) console.error('[error]', err.message || err);
  res.status(status).json({ message, code: err.code || (isDb ? 'DB_ERROR' : 'ERROR') });
}

module.exports = {
  AppError,
  notFound,
  unauthorized,
  forbidden,
  conflict,
  validation,
  asyncHandler,
  errorMiddleware,
};
