const db = require('../db/db');

const STANLEY_EMAIL = 'stanley.2010.lost@gmail.com';
const ADMIN_EMAIL = 'admin@dossie-esfcex.local';
const ADMIN_HASH = 'scrypt$11797825d27a1c0f091d2150cb24facb$00794c95d18c3280733c73d70767ab19632630c3c2cab4e362bf8f8871b80c38937f28b26147652ff53345e6e4e78b7e70e64d0d7d9d2f0b677b406f16ec0961';
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
    await client.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS context_text TEXT`);
    await client.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS context_title TEXT`);

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
