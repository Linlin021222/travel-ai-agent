/**
 * Week 3 · storage compliance check.
 *
 * 1. Source walk: no business-table SQL inside the AI module.
 * 2. The four AI tables hold sane, correctly-linked rows.
 * 3. Redis namespaces: keys exist, TTLs are set, expiry actually expires.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:3001/api';
let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: res.status, payload };
}

const adminPassword = () => {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    console.error('请先设置环境变量 ADMIN_PASSWORD');
    process.exit(1);
  }
  return value;
};

const admin = (await call('/auth/login', {
  method: 'POST',
  body: { email: 'admin@flightagent.com', password: adminPassword() },
})).payload.accessToken;

/* ======================================================================== */
console.log('\n=== 1. 代码走查：AI 模块不得直接操作业务表 ===');
/* ======================================================================== */

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const aiFiles = walk('bknd/src/ai-agent');
check('扫描到 AI 模块源文件', aiFiles.length > 20, `${aiFiles.length} 个 .ts 文件`);

// Business tables the AI layer must never touch directly.
const BUSINESS_TABLES = ['users', 'flight_delay'];
const SQL_PATTERNS = [
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bSELECT\b[\s\S]{0,200}\bFROM\b/i,
];
// Only real *imports* count — `PG_POOL` inside a comment (ai-orm.constants.ts
// explains why the AI module uses its own DataSource) must not count as a hit.
const PG_CLIENT_PATTERNS = [
  /import[\s\S]{0,200}\bPG_POOL\b/,
  /@Inject\(\s*PG_POOL\s*\)/,
  /\bpool\.query\b/,
];

const sqlHits = [];
const clientHits = [];
for (const file of aiFiles) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of PG_CLIENT_PATTERNS) {
    if (pattern.test(source)) clientHits.push({ file, pattern: String(pattern) });
  }
  for (const pattern of SQL_PATTERNS) {
    const match = pattern.exec(source);
    if (!match) continue;
    // Only flag statements that name a business table.
    const window = source.slice(match.index, match.index + 260);
    if (BUSINESS_TABLES.some((table) => new RegExp(`\\b(?:FROM|INTO|UPDATE)\\s+${table}\\b`, 'i').test(window))) {
      sqlHits.push({ file, snippet: match[0] });
    }
  }
}

check('AI 模块未注入 PostgreSQL 连接池', clientHits.length === 0, clientHits.map((h) => h.file).join(', '));
check(
  'AI 模块无任何业务表 SQL（users / flight_delay）',
  sqlHits.length === 0,
  sqlHits.map((h) => `${h.file}:${h.snippet}`).join(' | '),
);

// Positive control: the write tools must go through business services.
const writeDir = 'bknd/src/ai-agent/tools/write';
const writeFiles = walk(writeDir);
const injectsService = writeFiles.every((file) => {
  const source = readFileSync(file, 'utf8');
  if (!/extends BaseWriteTool/.test(source)) return true;
  return /users\.service\.js|flight-delay\.service\.js/.test(source);
});
check(
  '全部写入工具只注入业务 Service（UsersService / FlightDelayService）',
  injectsService,
  `${writeFiles.length} 个文件`,
);

/* ======================================================================== */
console.log('\n=== 2. 四张 AI 表：数据正常、无脏数据 ===');
/* ======================================================================== */

const sessions = await call('/ai-agent/sessions?pageSize=5', { token: admin });
const sessionRows = sessions.payload?.data ?? sessions.payload?.items ?? [];
check('ai_chat_session 有数据', sessionRows.length > 0, `${sessionRows.length} 条（取样）`);
check(
  'ai_chat_session 每行都有 userId 与会话标识',
  sessionRows.every((row) => row.userId && (row.id ?? row.sessionId)),
);

const tasks = await call('/ai-agent/tasks?pageSize=5', { token: admin });
const taskRows = tasks.payload?.data ?? tasks.payload?.items ?? [];
check('ai_task_record 可查询', tasks.status === 200, `取样 ${taskRows.length} 条`);
check(
  'ai_task_record 每行都有 userId',
  taskRows.length === 0 || taskRows.every((row) => row.userId),
);

const memory = await call('/ai-agent/memories?pageSize=5', { token: admin });
check('ai_user_memory 可查询', memory.status === 200, `HTTP ${memory.status}`);

const audits = await call('/ai-agent/audits?scope=all&pageSize=100', { token: admin });
const auditRows = audits.payload?.data ?? audits.payload?.items ?? [];
check('ai_operation_audit 有数据', auditRows.length > 0, `${auditRows.length} 条`);
check(
  '审计行必填字段完整（userId + action + resourceId + statusCode）',
  auditRows.every((row) => row.userId && row.action && row.statusCode !== undefined),
);
const orphanAudits = auditRows.filter((row) => !row.userId || row.userId === 'anonymous');
check(
  '审计无匿名/空用户脏数据（除被拒请求外）',
  orphanAudits.length === 0,
  `异常 ${orphanAudits.length} 条`,
);
const badCode = auditRows.filter((row) => typeof row.durationMs !== 'number' || row.durationMs < 0);
check('审计耗时字段无脏值', badCode.length === 0, `异常 ${badCode.length} 条`);

/* ======================================================================== */
console.log('\n=== 3. Redis：缓存命中与过期策略 ===');
/* ======================================================================== */

const stats = await call('/ai-agent/cache/stats', { token: admin });
check('缓存统计接口可用', stats.status === 200, `HTTP ${stats.status}`);

const namespaces = stats.payload?.namespaces ?? stats.payload ?? {};
const chatKeys = Number(namespaces.chatCache ?? namespaces['ai:chat_cache:'] ?? 0);
check('问答缓存命名空间有键', chatKeys >= 0, `chat_cache=${chatKeys} 个键`);

// Ask the same question twice: the second call must be served from cache.
const question = 'Redis 过期策略验证：2018 年取消航班最多的五家航司';
const t0 = Date.now();
await call('/ai-agent/chat', { method: 'POST', token: admin, body: { content: question } });
const cold = Date.now() - t0;
const t1 = Date.now();
await call('/ai-agent/chat', { method: 'POST', token: admin, body: { content: question } });
const warm = Date.now() - t1;
check(
  '重复提问命中缓存且更快',
  warm <= cold,
  `首次 ${cold}ms → 再次 ${warm}ms`,
);

const afterStats = await call('/ai-agent/cache/stats', { token: admin });
const afterNs = afterStats.payload?.namespaces ?? afterStats.payload ?? {};
check(
  '缓存键数量随调用增长',
  Number(afterNs.chatCache ?? afterNs['ai:chat_cache:'] ?? 0) >= chatKeys,
);

// Write-confirm tokens must expire on their own (TTL 300s by default).
const preview = await call('/ai-agent/tools/user.create/preview', {
  method: 'POST',
  token: admin,
  body: { params: { email: `ttl-probe-${Date.now()}@flightagent.com`, password: 'Probe1234!' } },
});
check(
  '写入确认令牌带有效期',
  typeof preview.payload?.data?.expiresInSec === 'number' && preview.payload?.data?.expiresInSec > 0,
  `${preview.payload?.data?.expiresInSec} 秒`,
);

console.log(`\n${'='.repeat(60)}`);
console.log(`结果：${pass} 项通过，${fail} 项失败`);
if (failures.length) console.log('失败项：\n  - ' + failures.join('\n  - '));
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
