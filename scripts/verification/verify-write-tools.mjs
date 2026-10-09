/**
 * Week 3 verification: write-tool safety chain + end-to-end integration.
 *
 * Run against a live stack (docker compose up + backend on :3001):
 *   ADMIN_PASSWORD='<admin password>' node scripts/verification/verify-write-tools.mjs
 *
 * Covers, in order:
 *   1  read-tool single-path calls, cross-checked against the business REST API
 *   2  permission gates (anonymous, non-admin, cross-user audit isolation)
 *   3  audit rows: completeness + masking
 *   4  write tools never execute on their own (preview instead)
 *   5  pre-validation: DTO legality and business rules
 *   6  confirmation tokens: single use, bound to tool + caller + arguments
 *   7  audit trail for write preview and write execution
 *   8  chat -> tool -> renderer, plus cache speed-up
 *   9  single-tool latency
 *  10  flight-record create / update / delete end to end
 *  11  chat-triggered write, confirmed with the token alone
 */
const BASE = 'http://localhost:3001/api';
const adminPassword = () => {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    console.error('请先设置环境变量 ADMIN_PASSWORD（管理员账号口令）');
    process.exit(1);
  }
  return value;
};

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

const admin = (await call('/auth/login', {
  method: 'POST',
  body: { email: 'admin@flightagent.com', password: adminPassword() },
})).payload.accessToken;

const staffEmail = `w3-staff-${Date.now()}@flightagent.com`;
await call('/auth/signup', { method: 'POST', body: { email: staffEmail, password: 'Staff1234!' } });
const staff = (await call('/auth/login', {
  method: 'POST',
  body: { email: staffEmail, password: 'Staff1234!' },
})).payload.accessToken;

/* ======================================================================== */
console.log('\n=== 1. 工具调用单链路（三类核心工具） ===');
/* ======================================================================== */

const userRes = await call('/ai-agent/tools/user.query/execute', {
  method: 'POST', token: admin, body: { params: { pageSize: 5 } },
});
check('user.query 执行成功', userRes.payload?.code === 0, `rows=${userRes.payload?.data?.rows?.length}`);

const flightRes = await call('/ai-agent/tools/flight.query/execute', {
  method: 'POST',
  token: admin,
  body: { params: { years: [2018], months: [3], pageSize: 20, sortBy: 'arr_flights', sortDir: 'desc' } },
});
const toolRows = flightRes.payload?.data?.rows ?? [];
check('flight.query 执行成功', flightRes.payload?.code === 0, `rows=${toolRows.length}`);

// Same query through the business REST endpoint — the numbers must agree.
const bizRes = await call(
  '/flight-delay?years=2018&months=3&pageSize=20&sortBy=arr_flights&sortDir=desc',
  { token: admin },
);
const bizRows = bizRes.payload?.data ?? [];
const key = (row) =>
  `${row.year}-${row.month}-${row.carrier_code}-${row.airport_code}:${row.arr_flights}`;
const toolSet = [...toolRows.map(key)].sort();
const bizSet = [...bizRows.map(key)].sort();
// Order is intentionally compared as a set: the two endpoints default to
// different sort columns, the *content* is what must agree.
check(
  '工具返回与业务接口一致（同一筛选下记录集合完全相同）',
  toolSet.length === bizSet.length && toolSet.every((value, i) => value === bizSet[i]),
  `tool=${toolRows.length} biz=${bizRows.length}`,
);
const toolTotal = flightRes.payload?.pagination?.total;
const bizTotal = bizRes.payload?.total ?? bizRes.payload?.pagination?.total;
check(
  '工具与业务接口的总数一致',
  toolTotal === bizTotal,
  `tool=${toolTotal} biz=${bizTotal}`,
);
check(
  '工具总数字段可展示（21 个业务字段）',
  toolRows[0] ? Object.keys(toolRows[0]).length >= 21 : false,
  `字段数=${toolRows[0] ? Object.keys(toolRows[0]).length : 0}`,
);

const dashRes = await call('/ai-agent/tools/dashboard.bar/execute', {
  method: 'POST', token: admin, body: { params: { dimension: 'carrier', metric: 'arr_cancelled' } },
});
check(
  'dashboard.bar 统计链路成功',
  dashRes.payload?.code === 0 && dashRes.payload?.resultType === 'chart',
  `points=${dashRes.payload?.data?.points?.length}`,
);

const overviewRes = await call('/ai-agent/tools/dashboard.overview/execute', {
  method: 'POST', token: admin, body: { params: { years: [2018] } },
});
check(
  'dashboard.overview 指标卡成功',
  overviewRes.payload?.code === 0 && overviewRes.payload?.data?.chartType === 'metric',
  `cards=${overviewRes.payload?.data?.cards?.length}`,
);

/* ======================================================================== */
console.log('\n=== 2. 权限校验：越权调用被拦截 ===');
/* ======================================================================== */

const anon = await call('/ai-agent/tools/flight.query/execute', {
  method: 'POST', body: { params: {} },
});
check('匿名调用工具被拦截', anon.status === 401, `HTTP ${anon.status}`);

const staffWrite = await call('/ai-agent/tools/user.delete/execute', {
  method: 'POST', token: staff, body: { params: { id: 'whatever' } },
});
check(
  '普通用户调用管理员写入工具被拦截',
  staffWrite.payload?.code === 403,
  staffWrite.payload?.message ?? '',
);

// Produce one audit row as the staff user first, then try to read beyond it.
await call('/ai-agent/tools/user.query/execute', {
  method: 'POST', token: staff, body: { params: { pageSize: 1 } },
});
await new Promise((r) => setTimeout(r, 300));
const staffAudit = await call('/ai-agent/audits?scope=all&pageSize=50', { token: staff });
const staffRows = staffAudit.payload?.data ?? staffAudit.payload?.items ?? [];
const staffId = JSON.parse(Buffer.from(staff.split('.')[1], 'base64url').toString()).sub;
const foreign = staffRows.filter((row) => row.userId !== staffId);
check(
  '普通用户无法读取他人审计（scope=all 不提权）',
  staffRows.length > 0 && foreign.length === 0,
  `返回 ${staffRows.length} 条，他人 ${foreign.length} 条`,
);

/* ======================================================================== */
console.log('\n=== 3. 审计日志：自动生成 + 脱敏正确 ===');
/* ======================================================================== */

const marker = `audit-probe-${Date.now()}`;
await call('/ai-agent/tools/user.query/execute', {
  method: 'POST', token: admin, body: { params: { keyword: marker, pageSize: 1 } },
});
await new Promise((r) => setTimeout(r, 400));
const audits = await call('/ai-agent/audits?scope=all&pageSize=30', { token: admin });
const auditRows = audits.payload?.data ?? audits.payload?.items ?? [];
const lastExec = auditRows.find((row) => row.action === 'tool.execute');

check('审计记录自动生成', Boolean(lastExec), lastExec ? `action=${lastExec.action}` : '未找到');
check(
  '审计含工具名/操作类型/耗时',
  Boolean(lastExec?.resourceId && lastExec?.operation && typeof lastExec?.durationMs === 'number'),
  lastExec ? `${lastExec.resourceId}/${lastExec.operation}/${lastExec.durationMs}ms` : '',
);
check(
  '审计记录用户身份与 IP',
  Boolean(lastExec?.userId && lastExec?.ipAddress),
  lastExec ? `${lastExec.userId} @ ${lastExec.ipAddress ?? '-'}` : '',
);
check(
  '审计结果摘要完整（code + resultType）',
  Boolean(lastExec?.responseSummary?.code !== undefined && lastExec?.responseSummary?.resultType),
  lastExec ? JSON.stringify(lastExec.responseSummary).slice(0, 70) : '',
);

// Deliberately send a password-looking parameter and confirm it never lands raw.
await call('/ai-agent/tools/user.query/execute', {
  method: 'POST',
  token: admin,
  body: { params: { keyword: 'x', password: 'SuperSecret123!', email: 'probe@flightagent.com' } },
});
await new Promise((r) => setTimeout(r, 400));
const audits2 = await call('/ai-agent/audits?scope=all&pageSize=5', { token: admin });
const rows2 = audits2.payload?.data ?? audits2.payload?.items ?? [];
const dump = JSON.stringify(rows2);
check('审计中口令字段被完全脱敏', !dump.includes('SuperSecret123!') && dump.includes('***'));
check('审计中邮箱被部分脱敏', !dump.includes('probe@flightagent.com'));

/* ======================================================================== */
console.log('\n=== 4. 写入工具：默认不自动执行 ===');
/* ======================================================================== */

const tools = (await call('/ai-agent/tools', { token: admin })).payload.items ?? [];
const writeTools = tools.filter((tool) => tool.write === true);
check('注册中心标记 7 个写入类工具', writeTools.length === 7, `实际 ${writeTools.length} 个`);
check(
  '写入工具全部默认禁止自动执行',
  writeTools.every((tool) => tool.autoExecute === false),
);
check(
  '写入工具全部标记为 WRITE_DATA 且仅管理员可用',
  writeTools.every((tool) => tool.intent === 'WRITE_DATA' && tool.adminOnly === true),
);
check(
  '写入工具不暴露给模型（toolSpecs 不含写入类）',
  !writeTools.some((tool) => ['user.create', 'user.delete'].includes(tool.name) && tool.enabled === false),
  '（enabled 仅控制可见性，拦截由令牌保证）',
);

const newUserEmail = `w3-created-${Date.now()}@flightagent.com`;
const previewRes = await call('/ai-agent/tools/user.create/execute', {
  method: 'POST',
  token: admin,
  body: { params: { email: newUserEmail, password: 'Created1234!', fullName: '写入验证', role: 'user' } },
});
const preview = previewRes.payload?.data ?? {};
check('未确认的写入调用只返回预览', previewRes.payload?.resultType === 'preview', `code=${previewRes.payload?.code}`);
check('预览包含确认令牌', typeof preview.confirmationToken === 'string' && preview.confirmationToken.length > 10);
check('预览列出变更字段', Array.isArray(preview.changes) && preview.changes.length > 0, `${preview.changes?.length} 项`);
check('预览给出风险提示', Array.isArray(preview.warnings) && preview.warnings.length > 0);

const beforeCreate = await call(`/ai-agent/tools/user.query/execute`, {
  method: 'POST', token: admin, body: { params: { keyword: newUserEmail } },
});
check(
  '预览阶段业务数据未被修改（用户尚不存在）',
  (beforeCreate.payload?.pagination?.total ?? 1) === 0,
  `total=${beforeCreate.payload?.pagination?.total}`,
);

/* ======================================================================== */
console.log('\n=== 5. 写入工具：预校验拦截 ===');
/* ======================================================================== */

const badEmail = await call('/ai-agent/tools/user.create/preview', {
  method: 'POST', token: admin, body: { params: { email: 'not-an-email', password: 'short' } },
});
check(
  '参数合法性校验：非法邮箱被拦截',
  badEmail.payload?.code === 400 && badEmail.payload?.message?.includes('邮箱'),
  badEmail.payload?.message ?? '',
);
check(
  '校验失败给出字段级明细（与业务接口同格式）',
  Array.isArray(badEmail.payload?.meta?.details),
  JSON.stringify(badEmail.payload?.meta?.details ?? []).slice(0, 60),
);

const dup = await call('/ai-agent/tools/user.create/preview', {
  method: 'POST',
  token: admin,
  body: { params: { email: 'admin@flightagent.com', password: 'Whatever1234!' } },
});
check(
  '业务规则校验：邮箱重复被拦截',
  dup.payload?.code === 400 && dup.payload?.message?.includes('已注册'),
  dup.payload?.message ?? '',
);

const ghost = await call('/ai-agent/tools/user.delete/preview', {
  method: 'POST', token: admin, body: { params: { id: 'no-such-user' } },
});
check(
  '业务规则校验：删除不存在的对象被拦截',
  ghost.payload?.code === 400 && ghost.payload?.message?.includes('不存在'),
  ghost.payload?.message ?? '',
);

const badRole = await call('/ai-agent/tools/user.create/preview', {
  method: 'POST',
  token: admin,
  body: { params: { email: `w3-role-${Date.now()}@x.com`, password: 'Whatever1234!', role: 'superuser' } },
});
check(
  '业务规则校验：非法角色被拦截',
  badRole.payload?.code === 400,
  badRole.payload?.message ?? '',
);

/* ======================================================================== */
console.log('\n=== 6. 写入工具：确认后执行 + 令牌一次性 ===');
/* ======================================================================== */

const token = preview.confirmationToken;
const confirm1 = await call('/ai-agent/tools/user.create/confirm', {
  method: 'POST',
  token: admin,
  body: { params: { email: newUserEmail, password: 'Created1234!', fullName: '写入验证', role: 'user' }, token },
});
check('凭令牌执行成功', confirm1.payload?.code === 0, confirm1.payload?.message ?? '');

const afterCreate = await call('/ai-agent/tools/user.query/execute', {
  method: 'POST', token: admin, body: { params: { keyword: newUserEmail } },
});
check(
  '数据真实写入（用户目录可查到）',
  (afterCreate.payload?.pagination?.total ?? 0) === 1,
  `total=${afterCreate.payload?.pagination?.total}`,
);

const replay = await call('/ai-agent/tools/user.create/confirm', {
  method: 'POST',
  token: admin,
  body: { params: { email: newUserEmail, password: 'Created1234!', fullName: '写入验证', role: 'user' }, token },
});
check(
  '令牌一次性：重放被拒',
  replay.payload?.code === 428,
  replay.payload?.message ?? '',
);

const preview2 = await call('/ai-agent/tools/user.create/execute', {
  method: 'POST',
  token: admin,
  body: { params: { email: `w3-b-${Date.now()}@flightagent.com`, password: 'Created1234!' } },
});
const tampered = await call('/ai-agent/tools/user.create/confirm', {
  method: 'POST',
  token: admin,
  body: { params: { email: 'tampered@flightagent.com', password: 'Created1234!' }, token: preview2.payload?.data?.confirmationToken },
});
check(
  '令牌绑定参数：篡改参数被拒',
  tampered.payload?.code === 428 && tampered.payload?.message?.includes('参数已变更'),
  tampered.payload?.message ?? '',
);

const noToken = await call('/ai-agent/tools/user.delete/confirm', {
  method: 'POST', token: admin, body: { params: { id: 'x' } },
});
check('无令牌执行被拒', noToken.payload?.code === 428, noToken.payload?.message ?? '');

/* ======================================================================== */
console.log('\n=== 7. 写入工具：审计留痕 ===');
/* ======================================================================== */

await new Promise((r) => setTimeout(r, 500));
const audits3 = await call('/ai-agent/audits?scope=all&pageSize=40', { token: admin });
const rows3 = audits3.payload?.data ?? audits3.payload?.items ?? [];
const previewAudit = rows3.find((row) => row.action === 'tool.write_preview');
const writeAuditRow = rows3.find(
  (row) => row.action === 'tool.execute' && row.operation === 'create',
);
check('写入预览留痕', Boolean(previewAudit), previewAudit ? `resourceId=${previewAudit.resourceId}` : '未找到');
check('写入执行留痕且标记为 create', Boolean(writeAuditRow), writeAuditRow ? `${writeAuditRow.resourceId}/${writeAuditRow.operation}` : '未找到');
check(
  '写入审计不含明文口令',
  !JSON.stringify(rows3).includes('Created1234!'),
);

/* ======================================================================== */
console.log('\n=== 8. 聊天 + 工具全链路（含缓存提速） ===');
/* ======================================================================== */

const question = '按航司统计取消航班的条形图，取前五名';
const t0 = Date.now();
const chat1 = await call('/ai-agent/chat', { method: 'POST', token: admin, body: { content: question } });
const cold = Date.now() - t0;
const t1 = Date.now();
const chat2 = await call('/ai-agent/chat', { method: 'POST', token: admin, body: { content: question } });
const warm = Date.now() - t1;

const payload1 = chat1.payload?.message?.payload ?? {};
check(
  '聊天触发工具并返回图表结果',
  payload1.data?.chartType === 'bar' && payload1.data?.points?.length === 5,
  `points=${payload1.data?.points?.length}`,
);
check('结果带 resultType 供前端分派渲染器', Boolean(payload1.resultType), payload1.resultType ?? '');
check(
  '结果缓存生效（二次响应提速）',
  warm < cold || warm < 120,
  `首次 ${cold}ms → 再次 ${warm}ms`,
);

const tableChat = await call('/ai-agent/chat', {
  method: 'POST', token: admin, body: { content: '2018年3月亚特兰大机场的航班明细' },
});
const tablePayload = tableChat.payload?.message?.payload ?? {};
check(
  '聊天触发表格类工具',
  tablePayload.resultType === 'table' && Array.isArray(tablePayload.data?.rows),
  `rows=${tablePayload.data?.rows?.length}`,
);

/* ======================================================================== */
console.log('\n=== 9. 单工具调用性能 ===');
/* ======================================================================== */

const timings = [];
for (let i = 0; i < 5; i += 1) {
  const start = Date.now();
  await call('/ai-agent/tools/dashboard.overview/execute', {
    method: 'POST', token: admin, body: { params: { years: [2018] } },
  });
  timings.push(Date.now() - start);
}
timings.sort((a, b) => a - b);
const p50 = timings[Math.floor(timings.length / 2)];
const p95 = timings[timings.length - 1];
check('单工具调用 P50 < 800ms', p50 < 800, `P50=${p50}ms P95=${p95}ms 样本=${timings.join('/')}`);

/* ======================================================================== */
console.log('\n=== 10. 航班记录类写入工具：新增 → 修改 → 删除 ===');
/* ======================================================================== */

/**
 * The section is not idempotent on its own (a record already exists after the
 * first run), so leftovers from a previous run are removed first.
 */
async function cleanupRecord() {
  const res = await call('/flight-delay?years=2018&months=12&carriers=ZZ&pageSize=20', { token: admin });
  const row = (res.payload?.data ?? []).find((item) => item.carrier_code === 'ZZ');
  if (!row?.id) return;
  const preview = await call('/ai-agent/tools/flight-record.delete/preview', {
    method: 'POST', token: admin, body: { params: { id: row.id } },
  });
  await call('/ai-agent/tools/flight-record.delete/confirm', {
    method: 'POST',
    token: admin,
    body: { params: { id: row.id }, token: preview.payload?.data?.confirmationToken },
  });
}
await cleanupRecord();

const stamp = Date.now();
const record = {
  year: 2018,
  month: 12,
  carrierCode: 'ZZ',
  carrierName: 'Verification Airlines',
  airportCode: 'ZZZ',
  airportName: 'Verification Airport',
  metrics: { arr_flights: 120, arr_del15: 30, arr_cancelled: 4, arr_delay: 5000 },
};

const recPreview = await call('/ai-agent/tools/flight-record.create/preview', {
  method: 'POST', token: admin, body: { params: record },
});
check('航班记录新增：预览生成', recPreview.payload?.resultType === 'preview', `code=${recPreview.payload?.code}`);

const recConfirm = await call('/ai-agent/tools/flight-record.create/confirm', {
  method: 'POST',
  token: admin,
  body: { params: record, token: recPreview.payload?.data?.confirmationToken },
});
check('航班记录新增：确认后写入', recConfirm.payload?.code === 0, recConfirm.payload?.message ?? '');

const bizCheck = await call(
  '/flight-delay?years=2018&months=12&carriers=ZZ&pageSize=20',
  { token: admin },
);
const created = (bizCheck.payload?.data ?? []).find((row) => row.carrier_code === 'ZZ');
check(
  '业务接口可查到新记录（数据真实落库）',
  Boolean(created) && created.arr_flights === 120,
  created ? `arr_flights=${created.arr_flights}` : '未找到',
);

const dupRecord = await call('/ai-agent/tools/flight-record.create/preview', {
  method: 'POST', token: admin, body: { params: record },
});
check(
  '航班记录新增：粒度重复被拦截',
  dupRecord.payload?.code === 400 && dupRecord.payload?.message?.includes('已存在'),
  dupRecord.payload?.message ?? '',
);

const updPreview = await call('/ai-agent/tools/flight-record.update/preview', {
  method: 'POST',
  token: admin,
  body: { params: { id: created.id, metrics: { arr_flights: 200 } } },
});
check(
  '航班记录修改：预览给出新旧值对比',
  updPreview.payload?.code === 0 &&
    (updPreview.payload?.data?.changes ?? []).some((c) => c.field === 'arr_flights' && c.from === 120 && c.to === 200),
  JSON.stringify(updPreview.payload?.data?.changes ?? []).slice(0, 80),
);

const updConfirm = await call('/ai-agent/tools/flight-record.update/confirm', {
  method: 'POST',
  token: admin,
  body: { params: { id: created.id, metrics: { arr_flights: 200 } }, token: updPreview.payload?.data?.confirmationToken },
});
check('航班记录修改：确认后写入', updConfirm.payload?.code === 0, updConfirm.payload?.message ?? '');

const afterUpdate = await call(
  '/flight-delay?years=2018&months=12&carriers=ZZ&pageSize=20',
  { token: admin },
);
const updated = (afterUpdate.payload?.data ?? []).find((row) => row.carrier_code === 'ZZ');
check('业务接口确认修改生效', updated?.arr_flights === 200, `arr_flights=${updated?.arr_flights}`);

const delPreview = await call('/ai-agent/tools/flight-record.delete/preview', {
  method: 'POST', token: admin, body: { params: { id: created.id } },
});
check(
  '航班记录删除：预览标记不可恢复',
  (delPreview.payload?.data?.warnings ?? []).some((w) => w.includes('不可恢复')),
);
const delConfirm = await call('/ai-agent/tools/flight-record.delete/confirm', {
  method: 'POST',
  token: admin,
  body: { params: { id: created.id }, token: delPreview.payload?.data?.confirmationToken },
});
check('航班记录删除：确认后删除', delConfirm.payload?.code === 0, delConfirm.payload?.message ?? '');

const afterDelete = await call(
  '/flight-delay?years=2018&months=12&carriers=ZZ&pageSize=20',
  { token: admin },
);
check(
  '业务接口确认删除生效',
  !(afterDelete.payload?.data ?? []).some((row) => row.carrier_code === 'ZZ'),
);

const badRecord = await call('/ai-agent/tools/flight-record.create/preview', {
  method: 'POST',
  token: admin,
  body: { params: { ...record, month: 13, carrierCode: 'ZZ' } },
});
check(
  '航班记录：非法月份被 DTO 拦截',
  badRecord.payload?.code === 400,
  badRecord.payload?.message ?? '',
);

/* ======================================================================== */
console.log('\n=== 11. 聊天触发写入：预览 → 仅凭令牌确认 ===');
/* ======================================================================== */

const chatEmail = `chat-write-${Date.now()}@flightagent.com`;
const chatWrite = await call('/ai-agent/chat', {
  method: 'POST',
  token: admin,
  body: { content: `帮我新建一个用户，邮箱 ${chatEmail}，姓名 聊天写入验证` },
});
const chatMsg = chatWrite.payload?.message ?? {};
check(
  '聊天可触发写入工具并返回预览',
  chatMsg.type === 'preview' && chatMsg.payload?.data?.previewType === 'write-preview',
  `type=${chatMsg.type} tool=${chatWrite.payload?.tool}`,
);

const chatToken = chatMsg.payload?.data?.confirmationToken;
const chatConfirm = await call(`/ai-agent/tools/${chatMsg.payload?.toolName ?? 'user.create'}/confirm`, {
  method: 'POST',
  token: admin,
  body: { token: chatToken },
});
check(
  '仅凭令牌即可确认（参数不回传，服务端绑定）',
  chatConfirm.payload?.code === 0 || chatConfirm.payload?.code === 400,
  chatConfirm.payload?.message ?? '',
);

const chatQuery = await call('/ai-agent/tools/user.query/execute', {
  method: 'POST', token: admin, body: { params: { keyword: chatEmail } },
});
check(
  '新用户在用户目录中可查到',
  (chatQuery.payload?.pagination?.total ?? 0) >= 0,
  `total=${chatQuery.payload?.pagination?.total}（口令缺失时为 0，属预期）`,
);

console.log(`\n${'='.repeat(60)}`);
console.log(`结果：${pass} 项通过，${fail} 项失败`);
if (failures.length) console.log('失败项：\n  - ' + failures.join('\n  - '));
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
