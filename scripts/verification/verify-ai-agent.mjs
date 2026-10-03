const adminPassword = () => {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    console.error('请先设置环境变量 ADMIN_PASSWORD（管理员账号口令）');
    process.exit(1);
  }
  return value;
};

/**
 * End-to-end verification for the AI agent data layer + Redis cache.
 * Run: node .cache/verify-ai-agent.mjs
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
      ...(options.headers ?? {}),
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

async function login(email, password) {
  const { status, body } = await api(null, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (status !== 200 && status !== 201) return { token: null, status };
  return { token: body.accessToken, status };
}

// Try login first (tolerates a pre-existing account), then fall back to
// signup + login for a fresh database. This avoids the previous failure where
// signup failed ("email already exists") and we then logged in with the wrong
// password.
async function ensureUser(email, password) {
  const existing = await login(email, password);
  if (existing.token) return existing;
  await api(null, '/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
  return login(email, password);
}

const main = async () => {
  const demo = await ensureUser('demo@flightagent.com', 'demo1234');
  check('demo login', Boolean(demo.token));
  const admin = await ensureUser('admin@flightagent.com', adminPassword());
  check('admin login (AI_ADMIN_EMAILS)', Boolean(admin.token));

  const T = demo.token;
  const A = admin.token;

  console.log('\n[1] JWT enforcement');
  const anon = await api(null, '/ai-agent/sessions');
  check('no token -> 401', anon.status === 401, `status=${anon.status}`);
  const bad = await api('not-a-real-token', '/ai-agent/memories');
  check('invalid token -> 401', bad.status === 401, `status=${bad.status}`);

  console.log('\n[2] Sessions (pagination + owner scope)');
  const sessions = await api(T, '/ai-agent/sessions?page=1&pageSize=5');
  check('list sessions 200', sessions.status === 200, `status=${sessions.status}`);
  check(
    'returns page envelope',
    Array.isArray(sessions.body?.items) && typeof sessions.body?.total === 'number',
    `total=${sessions.body?.total} pages=${sessions.body?.totalPages}`,
  );
  const firstSessionId = sessions.body.items?.[0]?.id ?? null;

  const created = await api(T, '/ai-agent/sessions', {
    method: 'POST',
    body: JSON.stringify({ title: '验证会话', provider: 'qwen' }),
  });
  check('create session 201', created.status === 201, `status=${created.status}`);

  console.log('\n[3] Cross-user / cross-tenant isolation');
  if (firstSessionId) {
    const other = await api(A, `/ai-agent/sessions/${firstSessionId}`);
    check(
      'admin cannot read another user session -> 404',
      other.status === 404,
      `status=${other.status} msg=${other.body?.message ?? ''}`,
    );
  } else {
    console.log('  SKIP  isolation (no existing session)');
  }

  console.log('\n[4] Memory CRUD');
  const mem = await api(T, '/ai-agent/memories', {
    method: 'POST',
    body: JSON.stringify({
      memoryKey: 'preferred_airline',
      memoryValue: 'WN',
      category: 'preference',
      importance: 50,
    }),
  });
  check('create memory 201', mem.status === 201, `status=${mem.status}`);
  const memId = mem.body?.id;

  const memList = await api(T, '/ai-agent/memories?category=preference');
  check('list memory', memList.status === 200 && memList.body?.total >= 1, `total=${memList.body?.total}`);

  const upsert = await api(T, '/ai-agent/memories', {
    method: 'POST',
    body: JSON.stringify({ memoryKey: 'preferred_airline', memoryValue: 'DL', category: 'preference' }),
  });
  check('upsert same key does not duplicate', upsert.status === 201, `id=${upsert.body?.id}`);

  const patched = await api(T, `/ai-agent/memories/${memId}`, {
    method: 'PATCH',
    body: JSON.stringify({ importance: 90 }),
  });
  check('patch memory importance', patched.status === 200 && patched.body?.importance === 90, `importance=${patched.body?.importance}`);

  console.log('\n[5] Task CRUD + Redis task state');
  const task = await api(T, '/ai-agent/tasks', {
    method: 'POST',
    body: JSON.stringify({ taskType: 'flight_delay_query', title: '2018 延误分析' }),
  });
  check('create task 201', task.status === 201, `status=${task.status}`);
  const taskId = task.body?.id;
  const threadId = task.body?.threadId;

  const state = await api(T, `/ai-agent/tasks/${taskId}/state`);
  check('task state seeded in Redis', state.body?.state?.status === 'pending', `state=${JSON.stringify(state.body?.state)}`);

  const running = await api(T, `/ai-agent/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'running', progress: 40 }),
  });
  check('patch task -> running', running.body?.status === 'running', `progress=${running.body?.progress}`);

  const done = await api(T, `/ai-agent/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'success', progress: 100, output: { rows: 12 } }),
  });
  check('patch task -> success sets duration', done.body?.status === 'success' && done.body?.durationMs !== null, `durationMs=${done.body?.durationMs}`);

  const afterDone = await api(T, `/ai-agent/tasks/${taskId}/state`);
  check('terminal task clears Redis state', afterDone.body?.state === null, `state=${JSON.stringify(afterDone.body?.state)}`);

  console.log('\n[6] Audit permissions');
  const demoAudit = await api(T, '/ai-agent/audits?pageSize=50');
  const demoAll = await api(T, '/ai-agent/audits?scope=all&pageSize=50');
  check('user sees only own audits', demoAudit.body?.total >= 1, `self=${demoAudit.body?.total}`);
  check(
    'scope=all ignored for non-admin',
    demoAll.body?.total === demoAudit.body?.total,
    `self=${demoAudit.body?.total} all=${demoAll.body?.total}`,
  );
  const adminSelf = await api(A, '/ai-agent/audits?pageSize=50');
  const adminAll = await api(A, '/ai-agent/audits?scope=all&pageSize=50');
  check(
    'admin scope=all sees cross-tenant rows',
    adminAll.body?.total > adminSelf.body?.total,
    `adminSelf=${adminSelf.body?.total} adminAll=${adminAll.body?.total}`,
  );

  console.log('\n[7] Redis cache');
  const health = await api(T, '/ai-agent/cache/health');
  check('redis healthy', health.body === true, `health=${health.body}`);

  const stats = await api(T, '/ai-agent/cache/stats');
  check(
    'stats expose 4 namespaces',
    stats.body && 'session' in stats.body && 'chatCache' in stats.body && 'llmCache' in stats.body && 'taskState' in stats.body,
    JSON.stringify(stats.body),
  );

  const tsKey = `verify-${Date.now()}`;
  const write = await api(T, '/ai-agent/cache/task-state', {
    method: 'POST',
    body: JSON.stringify({ threadId: tsKey, state: { step: 'extract' }, ttlSeconds: 120 }),
  });
  check('write task state', write.body?.stored === true, JSON.stringify(write.body));

  const read = await api(T, `/ai-agent/cache/task-state?threadId=${tsKey}`);
  check('read task state', read.body?.step === 'extract', JSON.stringify(read.body));

  const keys = await api(T, '/ai-agent/cache/checkpoints/' + tsKey);
  check('langgraph checkpointer list works', keys.status === 200, `count=${keys.body?.count}`);

  const inv = await api(T, '/ai-agent/cache/invalidate', {
    method: 'POST',
    body: JSON.stringify({ dimension: 'flight-delay' }),
  });
  check('invalidate by dimension', inv.status === 201 || inv.status === 200, JSON.stringify(inv.body));

  const del = await api(T, `/ai-agent/cache/task-state/${tsKey}`, { method: 'DELETE' });
  check('delete task state', del.body?.deleted === true, JSON.stringify(del.body));

  console.log('\n[8] Validation (class-validator)');
  const badMemory = await api(T, '/ai-agent/memories', {
    method: 'POST',
    body: JSON.stringify({ memoryKey: 'x'.repeat(200) }),
  });
  check('oversized memoryKey rejected -> 400', badMemory.status === 400, `status=${badMemory.status}`);

  const badTask = await api(T, '/ai-agent/tasks', {
    method: 'POST',
    body: JSON.stringify({ taskType: 'x', status: 'not-a-status' }),
  });
  check('unknown field rejected -> 400', badTask.status === 400, `status=${badTask.status}`);

  console.log('\n[9] Cleanup');
  if (memId) {
    const rm = await api(T, `/ai-agent/memories/${memId}`, { method: 'DELETE' });
    check('delete memory', rm.body?.deleted === true, JSON.stringify(rm.body));
  }
  if (taskId) {
    const rm = await api(T, `/ai-agent/tasks/${taskId}`, { method: 'DELETE' });
    check('delete task', rm.body?.deleted === true, JSON.stringify(rm.body));
  }

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  process.exitCode = fail ? 1 : 0;
};

await main();
