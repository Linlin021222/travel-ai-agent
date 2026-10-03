/**
 * End-to-end routing benchmark.
 *
 * Sends every question through `POST /ai-agent/chat` and records which tool
 * actually ran, how it was selected (`routedBy`) and how long it took.
 * Unlike `bench-routing.mjs` this measures the *real* user-facing path,
 * including model-driven tool selection.
 *
 * Clear the chat cache before running, or cached answers will mask the model:
 *   docker exec flight-agent-redis redis-cli --scan --pattern "ai:chat_cache:*"
 *
 * Run: node .cache/bench-e2e-routing.mjs
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3001/api';
const EMAIL = 'demo@flightagent.com';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

const CASES = [
  { q: '给我看看核心指标概览', expected: 'dashboard.overview', kind: 'explicit' },
  { q: '按航司统计取消航班的条形图', expected: 'dashboard.bar', kind: 'explicit' },
  { q: '航司层级气泡图', expected: 'dashboard.bubble', kind: 'explicit' },
  { q: '2018年航班明细', expected: 'flight.query', kind: 'explicit' },
  { q: '查一下有哪些用户', expected: 'user.query', kind: 'explicit' },

  { q: '哪家航空公司取消航班最多？', expected: 'dashboard.bar', kind: 'implicit' },
  { q: '对比一下各机场的延误情况', expected: 'dashboard.bar', kind: 'implicit' },
  { q: '帮我看下 2015 到 2017 年整体数据怎么样', expected: 'dashboard.overview', kind: 'implicit' },
  { q: '哪些航司的航班量最大', expected: 'dashboard.bar', kind: 'implicit' },
  { q: '延误最严重的是哪一年', expected: 'dashboard.bar', kind: 'implicit' },
  { q: '查一下 2016 年 3 月 AA 航司在 JFK 机场的航班记录', expected: 'flight.query', kind: 'implicit' },
  { q: '系统里都注册了哪些人', expected: 'user.query', kind: 'implicit' },

  { q: '明天北京飞上海的航班有哪些？给我航班号和起飞时间', expected: null, kind: 'refusal' },
  { q: '帮我订一张明天去纽约的机票', expected: null, kind: 'refusal' },
];

async function api(token, path, options = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: res.status, body, ms: Date.now() - started };
}

const login = await api(null, '/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const token = login.body?.accessToken;
if (!token) { console.error('login failed'); process.exit(1); }

const results = [];
for (const c of CASES) {
  const r = await api(token, '/ai-agent/chat', {
    method: 'POST',
    // No sessionId -> a fresh session each time, so history never interferes.
    body: JSON.stringify({ content: c.q }),
  });
  const got = r.body?.tool ?? null;
  const content = String(r.body?.message?.content ?? '');
  // A refusal must both skip the tools and say so in words.
  const refused =
    got === null && /(无法|不能|没有.*数据|超出|不支持|仅|只.*提供|范围|抱歉|没.*权限)/.test(content);
  results.push({
    ...c,
    got,
    ok: c.expected === null ? refused : got === c.expected,
    refused,
    routedBy: r.body?.routedBy ?? null,
    ms: r.ms,
    tokens: r.body?.usage?.totalTokens ?? 0,
  });
}

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

function report(kind, label) {
  const rows = results.filter((r) => r.kind === kind);
  const pass = rows.filter((r) => r.ok).length;
  console.log(`\n--- ${label} (${pass}/${rows.length} = ${pct(pass, rows.length)}%) ---`);
  for (const r of rows) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(r.q)}`);
    console.log(`        期望=${r.expected ?? '(拒绝回答)'}`);
    console.log(`        实际=${r.got ?? '(未调用工具)'}  路由=${r.routedBy ?? '-'}  ${r.ms}ms  ${r.tokens}tok`);
    if (!r.ok) console.log(`        回答=${String(r.content ?? '').slice(0, 0)}`);
  }
  return { pass, total: rows.length };
}

console.log('================ 端到端路由基准 ================');
const explicit = report('explicit', '明确问法');
const implicit = report('implicit', '隐式/语义问法');
const refusal = report('refusal', '应拒绝回答');

const totalPass = explicit.pass + implicit.pass + refusal.pass;
const total = explicit.total + implicit.total + refusal.total;
const avgMs = Math.round((results.reduce((s, r) => s + r.ms, 0) / results.length) * 10) / 10;
const totalTok = results.reduce((s, r) => s + r.tokens, 0);
const byModel = results.filter((r) => r.routedBy === 'model').length;
const byKeyword = results.filter((r) => r.routedBy === 'keyword').length;

console.log('\n================ 汇总 ================');
console.log(`总体准确率    : ${totalPass}/${total} = ${pct(totalPass, total)}%`);
console.log(`  明确问法    : ${pct(explicit.pass, explicit.total)}%`);
console.log(`  隐式问法    : ${pct(implicit.pass, implicit.total)}%`);
console.log(`  应拒绝      : ${pct(refusal.pass, refusal.total)}%`);
console.log(`平均端到端耗时: ${avgMs} ms`);
console.log(`累计 token    : ${totalTok}`);
console.log(`路由来源      : model=${byModel}  keyword=${byKeyword}  chat=${total - byModel - byKeyword}`);
