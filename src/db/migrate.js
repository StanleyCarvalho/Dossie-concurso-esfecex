const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8');
  await pool.query(schema);
  console.log('Schema PostgreSQL aplicado com sucesso.');
}

migrate()
  .then(() => pool.end())
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
