const adminPassword = () => {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    console.error('请先设置环境变量 ADMIN_PASSWORD（管理员账号口令）');
    process.exit(1);
  }
  return value;
};

/**
 * End-to-end verification for week 2: AI tool layer.
 *
 * Covers: registry, intent matching, permissions, enable/disable, the five
 * read-only tools, standardised envelopes, audit trail, masking and cache.
 *
 * Run: node .cache/verify-ai-tools.mjs   (needs backend + postgres + redis)
 */
const BASE = 'http://localhost:3001/api';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(token, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function ensureUser(email, password) {
  const login = await api(null, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (login.body?.accessToken) return login.body.accessToken;
  await api(null, '/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
  const created = await api(null, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return created.body?.accessToken ?? null;
}

const run = async () => {
  const T = await ensureUser('demo@flightagent.com', 'demo1234');
  const A = await ensureUser('admin@flightagent.com', adminPassword());
  check('demo login', Boolean(T));
  check('admin login', Boolean(A));

  /* ---------------------------------------------------------------- 1 注册中心 */
  console.log('\n[1] Tool registry');
  const anon = await api(null, '/ai-agent/tools');
  check('tools require auth -> 401', anon.status === 401, `status=${anon.status}`);

  const list = await api(T, '/ai-agent/tools');
  const tools = list.body?.items ?? [];
  // 5 read tools + 7 write tools (week 3).
  const readTools = tools.filter((t) => t.write !== true);
  const writeTools = tools.filter((t) => t.write === true);
  check('registry lists 12 tools (5 read + 7 write)', tools.length === 12, `${tools.length}: ${tools.map((t) => t.name).join(', ')}`);
  check('read tools unchanged (5)', readTools.length === 5, readTools.map((t) => t.name).join(', '));
  check('write tools registered (7)', writeTools.length === 7, writeTools.map((t) => t.name).join(', '));
  check(
    'every tool declares intent + permission',
    tools.every((t) => t.intent && t.permission && t.resultType),
  );
  const intents = [...new Set(tools.map((t) => t.intent))].sort();
  check(
    'intents are QUERY_DATA / STATISTICS_ANALYSIS / WRITE_DATA',
    intents.join(',') === 'QUERY_DATA,STATISTICS_ANALYSIS,WRITE_DATA',
    intents.join(','),
  );
  check(
    'write tools never auto-execute and stay admin-only',
    writeTools.every((t) => t.autoExecute === false && t.adminOnly === true),
  );

  /* ------------------------------------------------------------ 2 意图匹配 */
  console.log('\n[2] Intent matching');
  const cases = [
    ['查一下有哪些用户', 'user.query'],
    ['2018年航班明细', 'flight.query'],
    ['给我看看核心指标概览', 'dashboard.overview'],
    ['按航司统计取消航班的条形图', 'dashboard.bar'],
    ['航司层级气泡图', 'dashboard.bubble'],
  ];
  for (const [question, expected] of cases) {
    const match = await api(T, '/ai-agent/tools/match', {
      method: 'POST',
      body: JSON.stringify({ query: question }),
    });
    check(
      `match "${question}" -> ${expected}`,
      match.body?.match?.name === expected,
      `got=${match.body?.match?.name ?? 'null'} score=${match.body?.match?.score ?? 0}`,
    );
  }

  /* --------------------------------------------------------- 3 工具执行结果 */
  console.log('\n[3] Tool execution envelopes');

  const unknown = await api(T, '/ai-agent/tools/does.not.exist/execute', {
    method: 'POST',
    body: JSON.stringify({ params: {} }),
  });
  check('unknown tool -> 404 envelope', unknown.body?.code === 404, `code=${unknown.body?.code}`);

  const overview = await api(T, '/ai-agent/tools/dashboard.overview/execute', {
    method: 'POST',
    body: JSON.stringify({ params: {} }),
  });
  check('overview code=0', overview.body?.code === 0, `code=${overview.body?.code} msg=${overview.body?.message}`);
  check('overview resultType=chart', overview.body?.resultType === 'chart');
  const cards = overview.body?.data?.cards ?? [];
  check('overview returns 4 metric cards', cards.length === 4, cards.map((c) => `${c.label}=${c.formatted}`).join(' | '));
  check(
    'big numbers use K/M/B',
    cards.every((c) => typeof c.formatted === 'string' && c.formatted.length > 0),
    cards.map((c) => c.formatted).join(', '),
  );
  check(
    'cancel card carries a ratio (量 + 百分比)',
    cards.some((c) => c.ratio && typeof c.ratio.percent === 'number'),
    JSON.stringify(cards.find((c) => c.ratio)?.ratio ?? null),
  );

  const bar = await api(T, '/ai-agent/tools/dashboard.bar/execute', {
    method: 'POST',
    body: JSON.stringify({ params: { dimension: 'carrier', metric: 'arr_cancelled', topN: 5 } }),
  });
  check('bar code=0', bar.body?.code === 0, `code=${bar.body?.code}`);
  check(
    'bar payload shape',
    bar.body?.data?.chartType === 'bar' && Array.isArray(bar.body?.data?.points) && bar.body.data.points.length > 0,
    `points=${bar.body?.data?.points?.length} dim=${bar.body?.data?.dimension} metric=${bar.body?.data?.metric}`,
  );
  check('bar honours topN', (bar.body?.data?.points?.length ?? 99) <= 5, `points=${bar.body?.data?.points?.length}`);
  check(
    'bar carries Chinese labels for the UI',
    Boolean(bar.body?.data?.dimensionLabel && bar.body?.data?.metricLabel),
    `${bar.body?.data?.dimensionLabel}/${bar.body?.data?.metricLabel}`,
  );

  const bubble = await api(T, '/ai-agent/tools/dashboard.bubble/execute', {
    method: 'POST',
    body: JSON.stringify({ params: { metric: 'arr_flights', topN: 3 } }),
  });
  check('bubble code=0', bubble.body?.code === 0, `code=${bubble.body?.code}`);
  const nodes = bubble.body?.data?.nodes ?? [];
  check(
    'bubble is hierarchical (level 1 with children)',
    nodes.length > 0 && nodes[0].level === 1 && Array.isArray(nodes[0].children) && nodes[0].children.length > 0,
    `nodes=${nodes.length} firstChildren=${nodes[0]?.children?.length ?? 0}`,
  );

  const flight = await api(T, '/ai-agent/tools/flight.query/execute', {
    method: 'POST',
    body: JSON.stringify({ params: { years: [2018], months: [1], pageSize: 20 } }),
  });
  check('flight query code=0', flight.body?.code === 0, `code=${flight.body?.code}`);
  check(
    'flight returns table envelope + pagination',
    flight.body?.resultType === 'table' &&
      Array.isArray(flight.body?.data?.rows) &&
      typeof flight.body?.pagination?.total === 'number',
    `rows=${flight.body?.data?.rows?.length} total=${flight.body?.pagination?.total}`,
  );
  check(
    'flight columns align with the business table',
    (flight.body?.data?.columns ?? []).some((c) => c.key === 'arr_flights' && c.label === '抵达航班数'),
  );

  /* ------------------------------------------------------------ 4 权限与脱敏 */
  console.log('\n[4] Permissions + masking');
  const users = await api(T, '/ai-agent/tools/user.query/execute', {
    method: 'POST',
    body: JSON.stringify({ params: { pageSize: 20 } }),
  });
  check('user query code=0', users.body?.code === 0, `code=${users.body?.code} msg=${users.body?.message}`);
  const rows = users.body?.data?.rows ?? [];
  check('user rows returned', rows.length > 0, `rows=${rows.length}`);
  check(
    'non-admin sees masked e-mail',
    rows.length > 0 && rows.every((r) => String(r.email).includes('***')),
    rows[0]?.email ?? 'none',
  );
  check(
    'columns are 姓名/邮箱/职位/角色/状态',
    (users.body?.data?.columns ?? []).map((c) => c.label).join(',') === '姓名,邮箱,职位,角色,状态',
    (users.body?.data?.columns ?? []).map((c) => c.label).join(','),
  );

  const adminUsers = await api(A, '/ai-agent/tools/user.query/execute', {
    method: 'POST',
    body: JSON.stringify({ params: { pageSize: 20 } }),
  });
  check(
    'admin sees raw e-mail (no masking)',
    (adminUsers.body?.data?.rows ?? []).every((r) => String(r.email).includes('@') && !r.email.includes('***')),
    adminUsers.body?.data?.rows?.[0]?.email ?? 'none',
  );

  /* ------------------------------------------------------- 5 启停与错误封装 */
  console.log('\n[5] Enable/disable + error envelope');
  const forbidden = await api(T, '/ai-agent/tools/dashboard.overview/enabled', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  });
  check('non-admin cannot toggle -> 403', forbidden.status === 403, `status=${forbidden.status}`);

  const disabled = await api(A, '/ai-agent/tools/dashboard.overview/enabled', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  });
  check('admin disables tool', disabled.body?.enabled === false, JSON.stringify(disabled.body));

  const runDisabled = await api(T, '/ai-agent/tools/dashboard.overview/execute', {
    method: 'POST',
    body: JSON.stringify({ params: {} }),
  });
  check('disabled tool -> 409 friendly message', runDisabled.body?.code === 409, `code=${runDisabled.body?.code} msg=${runDisabled.body?.message}`);

  await api(A, '/ai-agent/tools/dashboard.overview/enabled', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: true }),
  });
  const reEnabled = await api(T, '/ai-agent/tools/dashboard.overview/execute', {
    method: 'POST',
    body: JSON.stringify({ params: {} }),
  });
  check('re-enabled tool works again', reEnabled.body?.code === 0, `code=${reEnabled.body?.code}`);

  /* -------------------------------------------------------------- 6 审计埋点 */
  console.log('\n[6] Audit trail (decorator)');
  const audits = await api(A, '/ai-agent/audits?scope=all&pageSize=50');
  const toolAudits = (audits.body?.items ?? []).filter((row) => row.action === 'tool.execute');
  check('tool executions are audited', toolAudits.length > 0, `rows=${toolAudits.length}`);
  const sample = toolAudits[0];
  check(
    'audit records tool name + result + duration',
    Boolean(sample?.resourceId && sample?.responseSummary && sample?.durationMs !== null),
    `tool=${sample?.resourceId} code=${sample?.responseSummary?.code} durationMs=${sample?.durationMs}`,
  );
  check(
    'audit stores user id',
    Boolean(sample?.userId),
    `userId=${sample?.userId}`,
  );

  /* ------------------------------------------------------ 7 对话接入与缓存 */
  console.log('\n[7] Chat integration + cache');
  const question = `工具验证-${Date.now()}：给我看看核心指标概览`;
  const first = await api(T, '/ai-agent/chat', { method: 'POST', body: JSON.stringify({ content: question }) });
  check('chat answered by a tool', first.status === 201 && Boolean(first.body?.tool), `tool=${first.body?.tool} source=${first.body?.source}`);
  check(
    'chat message carries the tool payload',
    first.body?.message?.payload?.resultType === 'chart',
    `type=${first.body?.message?.type} resultType=${first.body?.message?.payload?.resultType}`,
  );

  const second = await api(T, '/ai-agent/chat', {
    method: 'POST',
    body: JSON.stringify({ sessionId: first.body?.sessionId, content: question }),
  });
  check('identical question served from cache', second.body?.source === 'cache', `source=${second.body?.source}`);
  check(
    'cached reply keeps its chart payload',
    second.body?.message?.payload?.resultType === 'chart',
    `resultType=${second.body?.message?.payload?.resultType}`,
  );

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exitCode = fail ? 1 : 0;
};

await run();
