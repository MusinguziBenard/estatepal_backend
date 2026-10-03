const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { errorMiddleware } = require('./utils/errors');

const authRoutes = require('./modules/auth/routes');
const listingsRoutes = require('./modules/listings/routes');
const connectionsRoutes = require('./modules/connections/routes');
const paymentsRoutes = require('./modules/payments/routes');
const devicesRoutes = require('./modules/devices/routes');
const usersRoutes = require('./modules/users/routes');
const adminRoutes = require('./modules/admin/routes');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '12mb' }));
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

  app.use(
    '/auth',
    rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false })
  );

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'estatepal-api', time: new Date().toISOString() });
  });

  app.use('/auth', authRoutes);
  app.use('/me', usersRoutes);
  app.use('/listings', listingsRoutes);
  app.use('/connections', connectionsRoutes);
  app.use('/payments', paymentsRoutes);
  app.use('/devices', devicesRoutes);
  app.use('/admin', adminRoutes);

  app.use(errorMiddleware);
  return app;
}

module.exports = { createApp };
