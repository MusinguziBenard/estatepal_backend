const { validation } = require('../utils/errors');

/**
 * Zod schema middleware.
 * @param {import('zod').ZodSchema} schema
 * @param {'body'|'query'|'params'} source
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const msg = result.error.errors.map((e) => e.message).join('; ');
      return next(validation(msg));
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
