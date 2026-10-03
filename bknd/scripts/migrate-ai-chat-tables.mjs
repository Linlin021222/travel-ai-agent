/**
 * One-off migration: ai_chat_sessions / ai_chat_messages  ->  ai_chat_session / ai_chat_message
 *
 * The AI tables were renamed to match the architecture spec (singular, tenant
 * aware, TypeORM managed). Business tables are never touched.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-ai-chat-tables.mjs            # copy only
 *   node --env-file=.env scripts/migrate-ai-chat-tables.mjs --drop     # copy + drop old tables
 */
import pg from 'pg';

const dropOld = process.argv.includes('--drop');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function tableExists(name) {
  const { rows } = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
    [name],
  );
  return rows.length > 0;
}

async function columnsOf(name) {
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
    [name],
  );
  return rows.map((r) => r.column_name);
}

try {
  const hasOld = await tableExists('ai_chat_sessions');
  const hasNew = await tableExists('ai_chat_session');

  if (!hasNew) {
    console.error('ai_chat_session does not exist yet — start the backend first so TypeORM creates it.');
    process.exit(1);
  }
  if (!hasOld) {
    console.log('legacy ai_chat_sessions not found; nothing to migrate.');
    process.exit(0);
  }

  const oldCols = await columnsOf('ai_chat_sessions');
  const { rows: oldSessions } = await pool.query('SELECT * FROM ai_chat_sessions');
  let sessions = 0;
  let orphanSessions = 0;
  for (const row of oldSessions) {
    const userId = row.user_id ?? null;
    // Anonymous sessions predate authentication; the new schema requires an owner.
    if (!userId) {
      orphanSessions += 1;
      continue;
    }
    const createdAt = row.created_at ?? new Date();
    await pool.query(
      `INSERT INTO ai_chat_session (id, user_id, tenant_id, title, provider, model, status, message_count, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        userId,
        userId,
        row.title ?? '新对话',
        row.provider ?? 'deepseek',
        row.model ?? '',
        'active',
        Number(row.message_count ?? 0),
        createdAt,
        row.updated_at ?? createdAt,
      ],
    );
    sessions += 1;
  }
  console.log(`sessions migrated: ${sessions} (legacy columns: ${oldCols.join(', ')})`);

  const hasOldMessages = await tableExists('ai_chat_messages');
  let messages = 0;
  let skipped = 0;
  if (hasOldMessages) {
    const sessionOwner = new Map(oldSessions.map((s) => [s.id, s.user_id ?? null]));
    const { rows: oldMessages } = await pool.query('SELECT * FROM ai_chat_messages');
    for (const row of oldMessages) {
      const owner = sessionOwner.get(row.session_id);
      // Skip messages of unknown or anonymous sessions (owner required).
      if (!owner) {
        skipped += 1;
        continue;
      }
      await pool.query(
        `INSERT INTO ai_chat_message (id, session_id, user_id, tenant_id, role, message_type, content, payload, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.session_id,
          owner,
          owner,
          row.role ?? 'user',
          row.message_type ?? 'text',
          row.content ?? '',
          row.payload ?? null,
          row.created_at ?? new Date(),
        ],
      );
      messages += 1;
    }
  }
  console.log(`messages migrated: ${messages}${skipped ? ` (skipped ${skipped} orphaned)` : ''}`);

  // Keep message_count in sync for the migrated sessions.
  await pool.query(
    `UPDATE ai_chat_session s SET message_count = m.cnt
     FROM (SELECT session_id, COUNT(*) AS cnt FROM ai_chat_message GROUP BY session_id) m
     WHERE s.id = m.session_id`,
  );
  console.log('message_count refreshed');

  if (dropOld) {
    await pool.query('DROP TABLE IF EXISTS ai_chat_messages');
    await pool.query('DROP TABLE IF EXISTS ai_chat_sessions');
    console.log('legacy tables dropped');
  } else {
    console.log('legacy tables kept — re-run with --drop once you have verified the copy');
  }
} catch (error) {
  console.error('migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
