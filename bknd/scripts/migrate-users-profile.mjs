/**
 * Adds the profile columns the AI "user query" tool needs to the existing
 * `users` table: full_name / title / role / status.
 *
 * The business table is only extended (never rewritten) and existing rows are
 * back-filled so the tool returns meaningful data immediately.
 *
 * Run: node scripts/migrate-users-profile.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  try {
    const raw = readFileSync(file, 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const env = {
  ...loadEnv(resolve(here, '../.env')),
  ...loadEnv(resolve(here, '../../.env')),
  ...process.env,
};

const url = env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not found (checked bknd/.env, root .env, process.env)');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

const COLUMNS = [
  { name: 'full_name', ddl: 'text' },
  { name: 'title', ddl: 'text' },
  { name: 'role', ddl: "text NOT NULL DEFAULT 'user'" },
  { name: 'status', ddl: "text NOT NULL DEFAULT 'active'" },
];

try {
  for (const col of COLUMNS) {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.name} ${col.ddl}`);
    console.log(`column ready: ${col.name}`);
  }

  // Back-fill: name from the e-mail local part, admins from AI_ADMIN_EMAILS.
  const adminEmails = (env.AI_ADMIN_EMAILS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  await pool.query(
    `UPDATE users
        SET full_name = COALESCE(NULLIF(TRIM(full_name), ''), SPLIT_PART(email, '@', 1)),
            title     = COALESCE(NULLIF(TRIM(title), ''), '未填写'),
            status    = COALESCE(NULLIF(TRIM(status), ''), 'active'),
            role      = CASE
                          WHEN role IS NULL OR TRIM(role) = '' THEN 'user'
                          ELSE role
                        END`,
  );

  for (const email of adminEmails) {
    await pool.query(`UPDATE users SET role = 'admin', title = COALESCE(NULLIF(TRIM(title),''), '系统管理员') WHERE lower(email) = $1`, [
      email,
    ]);
    console.log(`promoted to admin: ${email}`);
  }

  const { rows } = await pool.query(
    'SELECT email, full_name, title, role, status FROM users ORDER BY created_at',
  );
  console.log('\nusers table now:');
  for (const row of rows) {
    console.log(`  ${row.email} | ${row.full_name} | ${row.title} | ${row.role} | ${row.status}`);
  }
  console.log(`\n${rows.length} row(s) migrated`);
} finally {
  await pool.end();
}
