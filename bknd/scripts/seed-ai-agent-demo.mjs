/**
 * Seed demo AI-agent sessions so the frontend conversation load can be verified
 * without calling a model. Inserts one session containing every message type
 * (text / table / chart / report / confirm).
 *
 * Usage:
 *   node --env-file=.env scripts/seed-ai-agent-demo.mjs
 *   node --env-file=.env scripts/seed-ai-agent-demo.mjs --email=you@example.com
 *   node --env-file=.env scripts/seed-ai-agent-demo.mjs --reset   (drop demo rows first)
 */

import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = {};
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.replace(/^--/, '').split('=');
  args[key] = value === undefined ? true : value;
}

const EMAIL = args.email ? String(args.email) : null;
const RESET = args.reset === true;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const DEMO_TAG = '[demo]';

async function resolveUserId() {
  if (!EMAIL) return null;
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [
    EMAIL.trim().toLowerCase(),
  ]);
  if (!rows.length) {
    console.warn(`未找到用户 ${EMAIL}，将创建无归属（user_id = NULL）的示例会话。`);
    return null;
  }
  return rows[0].id;
}

/** [role, type, content, payload] */
const MESSAGES = [
  [
    'user',
    'text',
    '帮我看一下 2018 年延误最严重的几家航空公司。',
    null,
  ],
  [
    'assistant',
    'text',
    [
      '## 2018 年延误情况概览',
      '',
      '按**到达航班总数**口径统计，延误最突出的几家航司如下：',
      '',
      '1. **Southwest (WN)** — 运量最大，延误绝对量最高',
      '2. **Delta (DL)** — 准点率表现相对较好',
      '3. **American (AA)** — 取消航班数偏高',
      '',
      '下面是按航司聚合的明细数据。',
    ].join('\n'),
    null,
  ],
  [
    'assistant',
    'table',
    '2018 年主要航司延误指标（示例数据）',
    {
      title: '2018 年主要航司延误指标',
      columns: [
        { key: 'carrier', label: '航司' },
        { key: 'flights', label: '到达航班', align: 'right' },
        { key: 'del15', label: '延误15分钟+', align: 'right' },
        { key: 'rate', label: '延误率', align: 'right' },
      ],
      rows: [
        { carrier: 'WN (Southwest)', flights: '1,352,910', del15: '246,043', rate: '18.2%' },
        { carrier: 'DL (Delta)', flights: '1,019,844', del15: '148,377', rate: '14.5%' },
        { carrier: 'AA (American)', flights: '1,045,662', del15: '203,918', rate: '19.5%' },
        { carrier: 'UA (United)', flights: '742,915', del15: '158,033', rate: '21.3%' },
      ],
      caption: '数据来源：flight_delay（2009-2018 BTS 聚合）',
    },
  ],
  [
    'assistant',
    'chart',
    '延误率对比图（示例数据）',
    {
      title: '主要航司延误率对比',
      chartType: 'bar',
      xLabel: '航司',
      yLabel: '延误率 (%)',
      series: [
        { label: 'WN', value: 18.2 },
        { label: 'DL', value: 14.5 },
        { label: 'AA', value: 19.5 },
        { label: 'UA', value: 21.3 },
        { label: 'AS', value: 16.1 },
      ],
    },
  ],
  [
    'assistant',
    'report',
    '已生成《2018 年度航班延误分析报告》预览。',
    {
      title: '2018 年度航班延误分析报告',
      summary:
        '本报告覆盖 23 家航司、378 个机场的到达航班表现，重点分析延误成因构成与航司间差异。',
      sections: [
        { heading: '一、总体表现', body: '全年到达航班约 780 万班，延误 15 分钟以上占比 17.8%。' },
        { heading: '二、延误成因', body: '晚到飞机（Late Aircraft）为主因，占比约 38%；其次为 NAS 与天气。' },
        { heading: '三、航司差异', body: '低成本航司延误率普遍高于全服务航司约 3-5 个百分点。' },
      ],
      meta: [
        { label: '生成时间', value: '2026-09-16' },
        { label: '数据范围', value: '2009-01 ~ 2018-12' },
        { label: '页数', value: '12' },
      ],
    },
  ],
  [
    'assistant',
    'confirm',
    '需要我把这份报告导出为 PDF 并发送到你的邮箱吗？',
    {
      title: '导出报告',
      description: '将生成 PDF 文件（约 2.4 MB），包含全部图表与明细表。',
      confirmText: '确认导出',
      cancelText: '暂不导出',
      actions: [
        { id: 'export_pdf', label: '导出 PDF' },
        { id: 'export_excel', label: '导出 Excel' },
      ],
    },
  ],
];

async function main() {
  // The AI schema is owned by TypeORM (ai_chat_session / ai_chat_message);
  // start the backend once so the tables exist, then seed rows here.
  for (const table of ['ai_chat_session', 'ai_chat_message']) {
    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
      [table],
    );
    if (!rows.length) {
      console.error(`${table} 不存在，请先启动后端（TypeORM 会自动建表）。`);
      process.exit(1);
    }
  }

  if (RESET) {
    const removed = await pool.query(
      `DELETE FROM ai_chat_session WHERE title LIKE $1 || '%'`,
      [DEMO_TAG],
    );
    console.log(`已清理 ${removed.rowCount} 条示例会话。`);
  }

  const userId = await resolveUserId();
  if (!userId) {
    console.error('ai_chat_session.user_id 不允许为空，请用 --email=<已注册邮箱> 指定用户。');
    process.exit(1);
  }

  const sessionId = randomUUID();
  const title = `${DEMO_TAG} 2018 年航司延误分析（示例）`;

  await pool.query(
    `INSERT INTO ai_chat_session (id, user_id, tenant_id, title, provider, model, status, message_count)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
    [sessionId, userId, userId, title, 'deepseek', 'deepseek-chat', MESSAGES.length],
  );

  const now = Date.now();
  for (let i = 0; i < MESSAGES.length; i += 1) {
    const [role, type, content, payload] = MESSAGES[i];
    await pool.query(
      `INSERT INTO ai_chat_message (id, session_id, user_id, tenant_id, role, message_type, content, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9 || ' milliseconds')::interval)`,
      [
        randomUUID(),
        sessionId,
        userId,
        userId,
        role,
        type,
        content,
        payload ? JSON.stringify(payload) : null,
        String(i * 1000 - (now % 1000)),
      ],
    );
  }

  console.log('示例会话创建成功：');
  console.log(`  sessionId : ${sessionId}`);
  console.log(`  title     : ${title}`);
  console.log(`  userId    : ${userId ?? '(未绑定用户)'}`);
  console.log(`  messages  : ${MESSAGES.length} 条（text/table/chart/report/confirm）`);
  if (!userId) {
    console.log('\n提示：传入 --email=你的登录邮箱 可把会话绑定到你的账号，前端刷新后即可加载。');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
