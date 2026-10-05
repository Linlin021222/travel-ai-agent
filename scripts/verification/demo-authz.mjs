const adminPassword = () => {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    console.error('请先设置环境变量 ADMIN_PASSWORD（管理员账号口令）');
    process.exit(1);
  }
  return value;
};

/**
 * Live proof that every tool call carries an authenticated identity and that
 * cross-tenant / cross-user access is rejected.
 *
 * Run: node .cache/demo-authz.mjs
 */
const BASE = 'http://localhost:3001/api';

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, payload };
};

const line = (label, result, detail) =>
  console.log(
    `${label.padEnd(46)} -> HTTP ${String(result.status).padEnd(4)} ${detail ?? ''}`,
  );

const admin = (await call('/auth/login', {
  method: 'POST',
  body: { email: 'admin@flightagent.com', password: adminPassword() },
})).payload.accessToken;

// A throwaway non-admin account, created through the public signup endpoint.
const staffEmail = 'authz-demo-' + Date.now() + '@flightagent.com';
const signup = await call('/auth/signup', {
  method: 'POST',
  body: { email: staffEmail, password: 'Staff1234!' },
});
if (!signup.payload?.accessToken) {
  console.log('注册演示账号失败:', signup.status, JSON.stringify(signup.payload).slice(0, 200));
}
const staff = signup.payload.accessToken;

console.log('=== 1. 没有身份：一律拒绝 ===');
line('匿名调用工具接口', await call('/ai-agent/tools/dashboard.bar/execute', {
  method: 'POST',
  body: { params: {} },
}));
line('匿名调用对话接口', await call('/ai-agent/chat', { method: 'POST', body: { content: '有哪些用户' } }));
line('匿名调用工具目录', await call('/ai-agent/tools'));

console.log('\n=== 2. 有身份：越权访问被拦截 ===');
line(
  '普通用户启停工具（仅管理员）',
  await call('/ai-agent/tools/dashboard.bar/enabled', {
    method: 'PATCH',
    token: staff,
    body: { enabled: false },
  }),
);
line('普通用户重载实体字典（仅管理员）', await call('/ai-agent/tools/reload-entities', { method: 'POST', token: staff }));

const ownId = JSON.parse(Buffer.from(staff.split('.')[1], 'base64url').toString()).sub;

console.log('\n=== 3. 身份进入工具：同一工具不同可见范围 ===');
const staffUsers = await call('/ai-agent/tools/user.query/execute', {
  method: 'POST',
  token: staff,
  body: { params: { pageSize: 3 } },
});
const adminUsers = await call('/ai-agent/tools/user.query/execute', {
  method: 'POST',
  token: admin,
  body: { params: { pageSize: 3 } },
});
const staffRows = staffUsers.payload?.data?.rows ?? [];
const adminRows = adminUsers.payload?.data?.rows ?? [];
console.log('普通用户看到的邮箱:', staffRows.map((r) => r.email).join(', ') || '(无)');
console.log('管理员看到的邮箱  :', adminRows.map((r) => r.email).join(', ') || '(无)');
console.log('脱敏标记 masked   :', staffUsers.payload?.meta?.masked, '/', adminUsers.payload?.meta?.masked);

console.log('\n=== 4. 跨用户数据隔离 ===');
const staffAudits = await call('/ai-agent/audits?scope=all&pageSize=50', { token: staff });
const staffAuditRows = staffAudits.payload?.data ?? staffAudits.payload?.items ?? [];
const foreign = staffAuditRows.filter((row) => row.userId !== ownId);
console.log(
  `普通用户请求 scope=all -> HTTP ${staffAudits.status}，返回 ${staffAuditRows.length} 条，其中他人记录 ${foreign.length} 条（0 = 无法提权）`,
);

const staffSession = await call('/ai-agent/sessions', {
  method: 'POST',
  token: staff,
  body: { title: '越权演示会话' },
});
const sessionId = staffSession.payload?.id;
line('普通用户读自己的会话', await call('/ai-agent/sessions/' + sessionId, { token: staff }));
line('管理员读普通用户的会话（按归属隔离）', await call('/ai-agent/sessions/' + sessionId, { token: admin }));
line('读一个不存在的会话 id', await call('/ai-agent/sessions/00000000-0000-0000-0000-000000000000', { token: staff }));

console.log('\n=== 5. 审计留痕（谁、用哪个工具、什么参数、哪个 IP）===');
const audits = await call('/ai-agent/audits?scope=all&pageSize=5', { token: admin });
const rows = audits.payload?.data ?? audits.payload?.items ?? [];
for (const row of rows.slice(0, 5)) {
  console.log(
    `  ${String(row.action).padEnd(12)} tool=${String(row.resourceId ?? '-').padEnd(18)} user=${String(row.userId).slice(0, 8)}… ip=${row.ipAddress ?? '-'} ok=${row.success}`,
  );
}
if (!rows.length) console.log('  (审计接口返回结构不同，原始：' + JSON.stringify(audits.payload).slice(0, 200) + ')');
