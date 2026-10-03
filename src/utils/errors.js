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
  const status = err.status || 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  if (status === 500) console.error('[error]', err);
  res.status(status).json({ message, code: err.code || 'ERROR' });
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
