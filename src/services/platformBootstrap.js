const db = require('../db/db');

const STANLEY_EMAIL = 'stanley.2010.lost@gmail.com';
const ADMIN_EMAIL = 'admin@dossie-esfcex.local';
const ADMIN_HASH = 'scrypt$de247295ef3f055685db7e4f8f7de466$429a9ab2626ff8bd4e992f19ba6187106ae9d717b2ea9165549ca02dd28dcaaeec9c566f8dd4f80a2e8e53e4ae5fa13126712dfd955f793a98e21363a5e76b62';
let readyPromise;

async function bootstrap() {
  await db.transaction(async client => {
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS access_until DATE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);
    await client.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE`);

    const stanley = (await client.query('SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1', [STANLEY_EMAIL])).rows[0];
    if (stanley) {
      await client.query(`UPDATE users SET approval_status='approved' WHERE id=$1`, [stanley.id]);
      await client.query(`UPDATE exams SET user_id=$1 WHERE user_id IS NULL`, [stanley.id]);
      await client.query(`UPDATE simulados SET user_id=$1 WHERE user_id IS NULL`, [stanley.id]);
      await client.query(`UPDATE questions q SET user_id=COALESCE(e.user_id,$1) FROM exams e WHERE q.exam_id=e.id AND q.user_id IS NULL`, [stanley.id]);
      await client.query(`UPDATE questions SET user_id=$1 WHERE user_id IS NULL`, [stanley.id]);
    }

    await client.query(`UPDATE users SET approval_status='approved' WHERE approval_status IS NULL`);
    await client.query(`INSERT INTO users(email,password_hash,name,role,approval_status,access_until) VALUES($1,$2,$3,'admin','approved',NULL) ON CONFLICT(email) DO UPDATE SET role='admin',approval_status='approved'`, [ADMIN_EMAIL, ADMIN_HASH, 'Administrador da Plataforma']);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_questions_user_id ON questions(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_approval ON users(approval_status,access_until)`);
  });
}

function ensurePlatformReady() {
  if (!readyPromise) readyPromise = bootstrap().catch(error => { readyPromise = null; throw error; });
  return readyPromise;
}

module.exports = { ensurePlatformReady, ADMIN_EMAIL };
