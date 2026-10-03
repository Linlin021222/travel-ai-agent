/**
 * Verifies the AI Redis cache behaviour:
 *   - ai:session:  short term memory (last 10 turns, 2h TTL)
 *   - ai:chat_cache: identical question reuse (10 min TTL)
 *   - PostgreSQL fallback when the session cache is gone
 */
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3001/api';
const EMAIL = 'demo@flightagent.com';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function api(token, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Try login first (tolerates a pre-existing account), then fall back to
// signup + login for a fresh database.
async function ensureUser(email, password) {
  const existing = await api(null, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (existing.body?.accessToken) return existing.body.accessToken;
  await api(null, '/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
  const created = await api(null, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return created.body?.accessToken ?? null;
}

function redisKeys(pattern) {
  try {
    const out = execSync(
      `docker exec flight-agent-redis redis-cli --scan --pattern "${pattern}"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function redisGet(key) {
  try {
    return execSync(`docker exec flight-agent-redis redis-cli GET "${key}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function redisTtl(key) {
  try {
    return Number(
      execSync(`docker exec flight-agent-redis redis-cli TTL "${key}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    return -2;
  }
}

// Start from a clean AI namespace: stale keys from a previous run would make
// "delete the session key" ambiguous.
function flushAiKeys() {
  for (const key of redisKeys('ai:*')) {
    try {
      execSync(`docker exec flight-agent-redis redis-cli DEL "${key}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }
}
flushAiKeys();
console.log('(cleared pre-existing ai:* keys)');

const T = await ensureUser(EMAIL, PASSWORD);
check('login', Boolean(T));

const question = `缓存验证-${Date.now()}：2018 年延误最严重的月份是哪个月？`;

console.log('\n[1] First ask -> model');
const first = await api(T, '/ai-agent/chat', { method: 'POST', body: JSON.stringify({ content: question }) });
check('chat 201', first.status === 201, `status=${first.status}`);
check('source = model', first.body?.source === 'model', `source=${first.body?.source} provider=${first.body?.provider}`);
const sessionId = first.body?.sessionId;
console.log(`        reply: ${String(first.body?.message?.content ?? '').slice(0, 80)}…`);

console.log('\n[2] Redis keys written');
const sessionKeys = redisKeys('ai:session:*');
const chatKeys = redisKeys('ai:chat_cache:*');
check('ai:session: key created', sessionKeys.length >= 1, sessionKeys[0] ?? 'none');
check('ai:chat_cache: key created', chatKeys.length >= 1, chatKeys[0] ?? 'none');
const ttl = sessionKeys[0] ? redisTtl(sessionKeys[0]) : -2;
check('session TTL ~2h', ttl > 7000 && ttl <= 7200, `ttl=${ttl}s`);
const chatTtl = chatKeys[0] ? redisTtl(chatKeys[0]) : -2;
check('chat cache TTL ~10min', chatTtl > 500 && chatTtl <= 600, `ttl=${chatTtl}s`);

console.log('\n[3] Identical question -> served from cache');
const second = await api(T, '/ai-agent/chat', {
  method: 'POST',
  body: JSON.stringify({ sessionId, content: question }),
});
check('source = cache', second.body?.source === 'cache', `source=${second.body?.source}`);
check(
  'cached answer identical',
  second.body?.message?.content === first.body?.message?.content,
  'same content',
);

console.log('\n[4] Short term memory holds the conversation');
const ctx = sessionKeys[0] ? JSON.parse(redisGet(sessionKeys[0]) || '{}') : {};
check('context has turns', Array.isArray(ctx.turns) && ctx.turns.length >= 2, `turns=${ctx.turns?.length}`);
check('turns capped at 10', (ctx.turns?.length ?? 0) <= 10, `turns=${ctx.turns?.length}`);

console.log('\n[5] Cache invalidation endpoint clears ai:chat_cache:');
const inv = await api(T, '/ai-agent/cache/invalidate', { method: 'POST', body: JSON.stringify({}) });
check('invalidate reports removed', inv.body?.removed >= 1, `removed=${inv.body?.removed}`);
check('chat cache keys gone', redisKeys('ai:chat_cache:*').length === 0);

console.log('\n[6] PostgreSQL fallback after cache loss');
execSync(`docker exec flight-agent-redis redis-cli DEL "${sessionKeys[0]}"`, { stdio: 'ignore' });
check('session cache deleted', redisGet(sessionKeys[0]) === '');
const third = await api(T, '/ai-agent/chat', {
  method: 'POST',
  body: JSON.stringify({ sessionId, content: '我刚才问的是什么？一句话复述。' }),
});
check('follow-up answered after cache loss', third.status === 201 && Boolean(third.body?.message?.content), `source=${third.body?.source}`);
console.log(`        reply: ${String(third.body?.message?.content ?? '').slice(0, 100)}…`);
const rebuilt = redisKeys('ai:session:*');
check('session memory re-warmed from PostgreSQL', rebuilt.length >= 1, rebuilt[0] ?? 'none');

// The real proof: the rebuilt window must contain the EARLIER turns, not just
// the message that triggered the rebuild.
const rebuiltCtx = rebuilt[0] ? JSON.parse(redisGet(rebuilt[0]) || '{}') : {};
const rebuiltTurns = rebuiltCtx.turns ?? [];
check(
  'rebuilt context includes earlier turns (not just the new one)',
  rebuiltTurns.length >= 4,
  `turns=${rebuiltTurns.length}`,
);
check(
  'original question survived the rebuild',
  rebuiltTurns.some((t) => String(t.content ?? '').includes('延误最严重的月份')),
  rebuiltTurns.map((t) => String(t.content).slice(0, 24)).join(' | '),
);
// Identical questions asked twice are legitimate; a double-append would show up
// as two CONSECUTIVE identical turns.
const consecutiveDupes = rebuiltTurns.filter(
  (t, i) => i > 0 && t.content === rebuiltTurns[i - 1].content,
);
check(
  'no double-append (no consecutive identical turns)',
  consecutiveDupes.length === 0,
  `dupes=${consecutiveDupes.length}`,
);

console.log('\n[7] Namespace discipline');
const allKeys = redisKeys('ai:*');
const stray = allKeys.filter(
  (k) => !k.startsWith('ai:session:') && !k.startsWith('ai:chat_cache:') && !k.startsWith('ai:llm_cache:') && !k.startsWith('ai:task_state:'),
);
check('no keys outside the 4 prefixes', stray.length === 0, stray.join(', ') || 'clean');

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exitCode = fail ? 1 : 0;
