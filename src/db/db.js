const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada. Informe a conexão PostgreSQL do Neon.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

async function query(text, params = [], client = pool) {
  const result = await client.query(text, params);
  return result.rows;
}

async function one(text, params = [], client = pool) {
  const rows = await query(text, params, client);
  return rows[0] || null;
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ping() {
  await one('SELECT 1 AS ok');
}

module.exports = { pool, query, one, transaction, ping };
