// src/db/sql.js
const postgres = require('postgres');

if (!process.env.DATABASE_URL) {
  console.warn('[db/sql] DATABASE_URL is not set — SQL queries will fail.');
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,        
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},    
});

module.exports = { sql };