/**
 * Tool-routing benchmark.
 *
 * Measures how accurately a natural-language question is routed to the right
 * tool. Runs against `POST /api/ai-agent/tools/match`, so it costs **no LLM
 * tokens** and is not affected by the chat cache.
 *
 * Run: node .cache/bench-routing.mjs
 */
import { createHash } from 'node:crypto';

const BASE = process.env.API_BASE ?? 'http://localhost:3001/api';
const EMAIL = 'demo@flightagent.com';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

/** expected: null means "no tool should handle this". */
const CASES = [
  // --- explicit phrasing (keyword routing is expected to handle these) ---
  { q: '给我看看核心指标概览', expected: 'dashboard.overview', kind: 'explicit' },
  { q: '按航司统计取消航班的条形图', expected: 'dashboard.bar', kind: 'explicit' },
  { q: '航司层级气泡图', expected: 'dashboard.bubble', kind: 'explicit' },
  { q: '2018年航班明细', expected: 'flight.query', kind: 'explicit' },
  { q: '查一下有哪些用户', expected: 'user.query', kind: 'explicit' },

  // --- implicit / semantic phrasing (needs understanding, not keywords) ---
  { q: '哪家航空公司取消航班最多？', expected: 'dashboard.bar', kind: 'implicit' },
  { q: '对比一下各机场的延误情况', expected: 'dashboard.bar', kind: 'implicit' },
  { q: '帮我看下 2015 到 2017 年整体数据怎么样', expected: 'dashboard.overview', kind: 'implicit' },
  { q: '哪些航司的航班量最大', expected: 'dashboard.bar', kind: 'implicit' },
  { q: '延误最严重的是哪一年', expected: 'dashboard.bar', kind: 'implicit' },
  { q: '查一下 2016 年 3 月 AA 航司在 JFK 机场的航班记录', expected: 'flight.query', kind: 'implicit' },
  { q: '系统里都注册了哪些人', expected: 'user.query', kind: 'implicit' },

  // --- must NOT be answered with business data ---
  { q: '明天北京飞上海的航班有哪些', expected: null, kind: 'refusal' },
  { q: '帮我订一张机票', expected: null, kind: 'refusal' },
];

async function api(token, path, options = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, ms: Date.now() - started };
}

async function ensureUser(email, password) {
  const login = await api(null, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (login.body?.accessToken) return login.body.accessToken;
  const signup = await api(null, '/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return signup.body?.accessToken ?? null;
}

/** Same dedupe rule as the chat cache, so repeated runs stay comparable. */
function hashQuery(q) {
  return createHash('sha1').update(q.trim().toLowerCase()).digest('hex').slice(0, 12);
}

const token = await ensureUser(EMAIL, PASSWORD);
if (!token) {
  console.error('login failed — cannot run benchmark');
  process.exit(1);
}

const results = [];
for (const c of CASES) {
  const r = await api(token, '/ai-agent/tools/match', {
    method: 'POST',
    body: JSON.stringify({ query: c.q }),
  });
  const got = r.body?.match?.name ?? null;
  results.push({ ...c, got, ok: got === c.expected, ms: r.ms, score: r.body?.match?.score ?? 0 });
}

const byKind = (kind) => results.filter((r) => r.kind === kind);
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

function report(kind, label) {
  const rows = byKind(kind);
  const pass = rows.filter((r) => r.ok).length;
  console.log(`\n--- ${label} (${pass}/${rows.length} = ${pct(pass, rows.length)}%) ---`);
  for (const r of rows) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(r.q)}`);
    console.log(`        期望=${r.expected ?? '(不调用工具)'}  实际=${r.got ?? '(无)'}`);
  }
  return { pass, total: rows.length };
}

console.log('================ 工具路由基准 ================');
const explicit = report('explicit', '明确问法');
const implicit = report('implicit', '隐式/语义问法');
const refusal = report('refusal', '应拒绝回答');

const totalPass = explicit.pass + implicit.pass + refusal.pass;
const total = explicit.total + implicit.total + refusal.total;
const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length * 10) / 10;

console.log('\n================ 汇总 ================');
console.log(`总体准确率      : ${totalPass}/${total} = ${pct(totalPass, total)}%`);
console.log(`  明确问法      : ${pct(explicit.pass, explicit.total)}%`);
console.log(`  隐式问法      : ${pct(implicit.pass, implicit.total)}%`);
console.log(`  应拒绝        : ${pct(refusal.pass, refusal.total)}%`);
console.log(`平均路由耗时    : ${avgMs} ms (纯匹配，不含模型调用)`);
console.log(`(哈希样例 ${hashQuery(CASES[0].q)})`);
