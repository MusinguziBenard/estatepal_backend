/**
 * Applies sql/schema.sql against Supabase via the REST SQL isn't available —
 * print instructions and optionally use pg if DATABASE_URL is set.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log(`
═══════════════════════════════════════════════════════════
  EstatePal — apply schema in Supabase
═══════════════════════════════════════════════════════════

1. Open https://supabase.com/dashboard → your project → SQL Editor
2. Paste the contents of sql/schema.sql and Run
3. Copy Project URL + service_role key into .env

Or set DATABASE_URL=postgresql://... and re-run:
  npm run migrate

Schema path: sql/schema.sql
`);
    console.log('--- schema preview (first 40 lines) ---');
    console.log(sql.split('\n').slice(0, 40).join('\n'));
    return;
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('Schema applied successfully.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
