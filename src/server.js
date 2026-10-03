// src/server.js
const http = require('http');
const config = require('./config');
const { createApp } = require('./app');
const { initIo } = require('./websocket/io');
const { registerListeners } = require('./events/listeners');

// ─── Startup health check ─────────────────────────────────
async function verifyConnections() {
  const results = [];

  // Postgres (raw SQL via pooler)
  try {
    const { sql } = require('./db/sql');
    const [{ now }] = await sql`select now() as now`;
    results.push(['Postgres', true, `ok (${now.toISOString().slice(0, 19)}Z)`]);
  } catch (err) {
    results.push(['Postgres', false, err.message]);
  }

  // Supabase (service-role)
  try {
    const { supabase } = require('./db/supabase');
    const { error } = await supabase.auth.admin.listUsers({ perPage: 1 });
    if (error) throw error;
    results.push(['Supabase', true, 'ok']);
  } catch (err) {
    results.push(['Supabase', false, err.message]);
  }

  // Cloudinary (via your wrapper)
  try {
    const { uploadImage } = require('./services/cloudinary');
    const sample =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=';
    const url = await uploadImage(Buffer.from(sample, 'base64'), {
      folder: 'estatepal/_healthcheck',
      publicId: `boot-${Date.now()}`,
    });
    const isReal = url.includes('res.cloudinary.com');
    results.push(['Cloudinary', isReal, isReal ? 'ok' : 'dev fallback']);
  } catch (err) {
    results.push(['Cloudinary', false, err?.error?.message || err?.message || 'unknown']);
  }

  // Pretty print
  const pad = (s, n) => String(s).padEnd(n, ' ');
  console.log('\n─── Startup checks ───────────────────────');
  for (const [name, ok, msg] of results) {
    console.log(`  ${ok ? '✅' : '❌'} ${pad(name, 12)} ${msg}`);
  }
  console.log('──────────────────────────────────────────\n');

  return results.every(([, ok]) => ok);
}

// ─── Boot ─────────────────────────────────────────────────
(async () => {
  try {
    await verifyConnections();
  } catch (err) {
    console.error('[startup] Verification crashed:', err.message);
  }

  registerListeners();

  const app = createApp();
  const server = http.createServer(app);

  initIo(server, { corsOrigin: config.corsOrigin });

  server.listen(config.port, () => {
    console.log(`EstatePal API listening on :${config.port} (${config.env})`);
    console.log(`Health:    http://localhost:${config.port}/health`);
    console.log(`WebSocket: path /socket.io`);
  });
})();

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});