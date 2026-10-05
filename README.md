# Flight Agent development workspace

This workspace contains the frontend (`ftnd`) and backend (`bknd`) applications.

## Local service configuration

1. Install Docker Desktop and enable its WSL 2 based engine.
2. Copy `.env.example` to `.env` and replace `POSTGRES_PASSWORD` with a local-only password.
3. Start PostgreSQL (with pgvector) and Redis with `docker compose up -d`.
4. Confirm both services are healthy with `docker compose ps`.

The backend uses the values in `bknd/.env.example`; copy it to `bknd/.env` and keep its database password in sync with the root `.env` file. The frontend uses `ftnd/.env.local.example`, copied to `ftnd/.env.local`.

The backend sample also reserves provider variables for DeepSeek, Zhipu AI (GLM), DashScope (Qwen), Kimi (Moonshot), OpenAI and a local OpenAI-compatible model server. Keep API keys only in `bknd/.env`.

## Planned application responsibilities

- `ftnd`: Next.js and Material UI; email/password signup and login, an extensible navigation bar (Dashboard, Flight info, Agent tasks, User), and a global floating AI chat entry.
- `bknd`: NestJS REST API; user module, validation/error responses, JWT authentication, Swagger documentation, PostgreSQL/pgvector, Redis, and LangGraph integration.

Do not commit `.env` files or real JWT secrets.

## Airline delay data module

The raw files in `trip_airline_delay/` (2009-2018) are **flight-level** records (~61.5 M rows, 7.4 GB).
The Flight info page serves the BTS "Airline Delay Causes" grain instead: one row per
`year + month + carrier + arrival airport`, with 21 business fields.

### 1. Build the table and load it

```bash
cd bknd
npm run ingest:flight-delay            # all years
npm run ingest:flight-delay -- --years=2018 --no-truncate
npm run ingest:flight-delay -- --dry-run --limit-rows=2000000
```

The script streams the CSVs, aggregates in memory, then bulk-writes `flight_delay`
(DDL in `bknd/scripts/flight-delay-schema.sql`). It also runs `ANALYZE` at the end.
Options: `--years`, `--limit-rows`, `--dry-run`, `--no-truncate`, `--batch-size`.

### 2. Aggregation rules

| Field | Rule (per flight record) |
| --- | --- |
| `arr_flights` | every record in the group |
| `arr_del15` | `ARR_DELAY >= 15` |
| `arr_cancelled` / `arr_diverted` | `CANCELLED = 1` / `DIVERTED = 1` |
| `arr_delay` | sum of `ARR_DELAY` for flights with `ARR_DELAY >= 15` |
| `carrier_delay` … `late_aircraft_delay` | the whole `ARR_DELAY` is attributed to the **dominant** cause (largest of the five cause columns), so the five sum back to `arr_delay` |
| `carrier_ct` … `late_aircraft_ct` | flight count per dominant cause |

The airport dimension is the **arrival** airport (`DEST`), matching the BTS convention.
Carrier and airport names come from the OpenFlights reference data in `.cache/`
(downloaded on first run) with overrides in `bknd/scripts/ingest-flight-delay.mjs`.

### 3. API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/flight-delay` | paged rows (`page`, `pageSize` = 20/50/100, `sortBy`, `sortDir`) |
| `GET` | `/api/flight-delay/filter-options` | cascading dropdown options + numeric bounds |
| `GET` | `/api/flight-delay/aggregate` | grouped sums by `dimension` (`date`/`carrier`/`airport`) for one `metric`; metric range applied as `HAVING SUM(metric)` |
| `GET` | `/api/flight-delay/bubble` | carrier → airport hierarchy with all 5 metrics summed per node (for the D3 bubble chart) |

Dimension filters: `years`, `months`, `carriers`, `airports` (comma separated, multi-select).
Range filters: `<field>_min` / `<field>_max` for all 15 numeric columns.
Each dropdown is computed with the *other* dimensions applied, so months cascade off
years and airports cascade off carriers. Swagger UI: <http://localhost:3001/api/docs>.

### 4. Frontend

`/flight-info` renders all 21 columns with a sticky header, frozen year/month columns,
drag-to-resize column widths, 20/50/100 pagination, cascading multi-select filters,
numeric range filters, an empty state and a one-click reset.

`/dashboard` (`ftnd/src/app/dashboard/page.tsx`) builds on the same `flight_delay` table:

- **Shared filter bar** (`DashboardFilterBar.tsx`): date range (start/end year-month),
  carrier multi-select, airport multi-select, Y-axis metric single-select, and a
  min~max range for the current metric. All filters drive every chart on the page.
- **Two dynamic bar charts** (`BarChartCard.tsx`): X-axis dimension (carrier / date),
  Y-axis single metric (arrivals / delayed ≥15 min / cancelled / diverted / total delay),
  shared filter state, responsive SVG with hover tooltip.
- **D3 bubble chart** (`BubbleChart.tsx`): level 1 = airline, level 2 = airport. The root
  view shows only the 23 airline bubbles laid out with `d3.forceSimulation` in a rectangular
  area; clicking one switches to that carrier's airports, clicking a bubble or the background
  returns to the airlines. Hover shows all 5 metrics.

## AI agent module (chat + multi-model)

### Backend — `bknd/src/ai-agent/`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/ai-agent/providers` | available providers, which ones have keys, current default |
| `POST` | `/api/ai-agent/chat` | send a message, get the model reply (chat cache aware) |
| `GET` | `/api/ai-agent/sessions` | **paged** sessions of the current user |
| `POST` | `/api/ai-agent/sessions` | create a session |
| `GET` | `/api/ai-agent/sessions/:id` | session + message history (restores chat after refresh) |
| `PATCH` / `DELETE` | `/api/ai-agent/sessions/:id` | rename / archive / delete (also clears its cache) |
| `POST` | `/api/ai-agent/sessions/:id/messages` | append a structured message |
| `GET` `POST` | `/api/ai-agent/memories` | long-term user memory (upsert by `memoryKey` + `scope`) |
| `GET` `PATCH` `DELETE` | `/api/ai-agent/memories/:id` | single memory |
| `GET` `POST` | `/api/ai-agent/tasks` | agent task records |
| `GET` `PATCH` `DELETE` | `/api/ai-agent/tasks/:id` | single task; `GET .../state` reads its Redis state |
| `GET` `POST` | `/api/ai-agent/audits` | operation audit log (`scope=all` admins only) |
| `GET` | `/api/ai-agent/cache/health` | Redis reachability |
| `GET` | `/api/ai-agent/cache/stats` | key counts per namespace |
| `POST` | `/api/ai-agent/cache/invalidate` | drop chat cache by business dimension |
| `GET` `POST` `DELETE` | `/api/ai-agent/cache/task-state` | task state read / write / clear |
| `GET` | `/api/ai-agent/cache/checkpoints/:threadId` | LangGraph-shaped view of a thread |

Every endpoint above requires `Authorization: Bearer <jwt>` and is scoped to the caller.

**Multi-model adapter** (`ai-agent/llm/`): DeepSeek, Qwen/DashScope, OpenAI, Kimi (Moonshot)
and any local OpenAI-compatible server all speak the *chat completions* protocol, so a single
`OpenAiCompatibleProvider` transport covers all of them — only base URL, key and default model
differ (`llm.config.ts`). Select one with `LLM_PROVIDER` (+ `LLM_MODEL`) in `bknd/.env`, or
override per request with the `provider` field / the dropdown in the chat header.

Required env keys: `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, `OPENAI_API_KEY`, `KIMI_API_KEY`
(or `MOONSHOT_API_KEY`); the local provider needs none and reads `LOCAL_LLM_BASE_URL`.

### AI data tables (TypeORM, isolated from business tables)

The AI module owns its own TypeORM connection (`AI_DATA_SOURCE = 'ai'`) and its own entity
directory. Business code keeps using the raw `pg` pool, and **no business table is altered** —
only the five AI entities are registered with `synchronize`, so nothing else can be touched.

| Table | Purpose | Key columns / indexes |
| --- | --- | --- |
| `ai_chat_session` | conversation header | `user_id`, `tenant_id`, `status`, `message_count`; idx `(user_id, updated_at)`, `(tenant_id)`, `(status)` |
| `ai_chat_message` | line items of a session | `session_id`, `role`, `message_type`, `payload jsonb`; idx `(session_id, created_at)`, `(user_id)` |
| `ai_user_memory` | long-term per-user facts | unique `(user_id, memory_key, scope)`; idx `(user_id, updated_at)` |
| `ai_task_record` | durable agent task outcome | `status`, `progress`, `thread_id`, `duration_ms`; idx `(user_id, created_at)`, `(status)` |
| `ai_operation_audit` | append-only operation log | `action`, `operation`, `resource_type`; idx `(user_id, created_at)`, `(tenant_id, created_at)` |

`user_id` is a *logical* reference to `users.id` (no database FK) so the AI schema can never
block or constrain business data. `tenant_id` defaults to the user id, but a JWT carrying
`tenant_id` transparently switches the whole layer to tenant scoping.

**Permissions**: every query is filtered by `user_id` + `tenant_id`, so another user's id simply
resolves to `404` rather than `403` (no existence leak). Administrators — listed in
`AI_ADMIN_EMAILS`, because `users` has no role column — may additionally read the full audit log
with `?scope=all`.

Migrating last sprint's tables to the new names:

```bash
cd bknd
node --env-file=.env scripts/migrate-ai-chat-tables.mjs --drop   # copy, then drop the old tables
```

### Agent Redis cache

Four namespaces, and every AI Redis call goes through `AiCacheService` (the client itself is
provided by a non-global `AiRedisModule`, so business code cannot grab it):

| Namespace | Stores | TTL |
| --- | --- | --- |
| `ai:session:` | short-term memory, last 10 turns | 2 h (refreshed on every message) |
| `ai:chat_cache:` | identical user + question answers | 10 min, per business dimension |
| `ai:llm_cache:` | *placeholder* — model response cache, not implemented yet | — |
| `ai:task_state:` | LangGraph task state | 1 h, auto-expires |

- Cache misses never break a request: Redis failures degrade to a miss.
- When `ai:session:` expires the window is rebuilt from `ai_chat_message` and re-warmed.
- Chat cache switches/TTLs are configured per business dimension via
  `AI_CACHE_BUSINESS_PROFILES` (e.g. `{"flight-delay":{"enabled":true,"ttlSeconds":900}}`);
  when business data changes, call `POST /api/ai-agent/cache/invalidate` to drop it.
- `cache/langgraph-checkpointer.ts` implements the LangGraph `BaseCheckpointSaver` shape
  (`getTuple` / `put` / `putWrites` / `list`) on top of `ai:task_state:`, ready for
  orchestration work.

Seed a demo conversation covering every message type:

```bash
cd bknd
node --env-file=.env scripts/seed-ai-agent-demo.mjs --email=you@example.com --reset
```

### Frontend — `ftnd/src/components/ai-agent/`

- `ChatLauncher.tsx` — global floating entry (a slim "input box" pill, bottom-right); clicking
  it expands the chat window. Mounted in `MainLayout`, so it is available on every
  authenticated page.
- `ChatWindow.tsx` — window shell: header (provider dropdown, new-conversation button),
  scrollable message list, input.
- `MessageRenderer.tsx` — dispatcher: user/assistant are split left/right with distinct
  colours and avatars, and the renderer is chosen by `message.type`.
- `messages/` — `TextMessage` (Markdown), `TableMessage`, `ChartMessage`, `ReportMessage`,
  `ConfirmMessage` (human-in-the-loop card).
- `Markdown.tsx` — dependency-free renderer for headings, ordered/unordered lists, bold,
  inline code and fenced code blocks. It renders React elements only (never
  `dangerouslySetInnerHTML`), so model output cannot inject HTML.
- `ChatInput.tsx` — multiline input, file attachments, **Enter sends / Shift+Enter newline**,
  clears after send.
- `src/lib/useChatSession.ts` + `src/lib/ai-agent.ts` — typed message model and session hook.
  The session id is cached in `localStorage` and the messages live in Postgres, so refreshing
  the page restores the exact conversation.

`/agent-tasks` (navigation entry "Agent tasks") is a placeholder task-progress board with
static rows; it exists so the navigation and layout are in place before orchestration lands.

## Tool-calling layer

The assistant answers from real data through five read-only tools rather than from model memory.

| Tool | Result type | Answers |
|---|---|---|
| `user.query` | `QUERY_DATA` (table) | Business user directory, e-mail masking |
| `flight.query` | `QUERY_DATA` (table) | Filtered delay metrics, paginated |
| `dashboard.overview` | `STATISTICS_ANALYSIS` (metric cards) | Headline totals for a filter |
| `dashboard.bar` | `STATISTICS_ANALYSIS` (bar chart) | Ranking by dimension |
| `dashboard.bubble` | `STATISTICS_ANALYSIS` (bubble chart) | Metric distribution with an extra size axis |

Design notes:

- `tools/base-tool.ts` is an abstract base class; every tool receives a `ToolContext`
  (authenticated user) and returns the same envelope
  `{ code, data, message, resultType, toolName, pagination, meta }`.
- `ToolRegistryService` auto-registers tools, does intent matching, exposes OpenAI
  function-calling schemas, and can disable a tool at runtime.
- `@AuditedTool()` writes an audit row (caller, parameters, result summary) with
  sensitive values masked — no manual logging inside tools.
- The frontend picks a renderer purely from `resultType` + `data.chartType`, so adding a
  tool never requires frontend changes.

### Parameter extraction

Names are translated into codes through a dictionary loaded from the same
`getFilterOptions` catalogue the Flight info page uses (23 carriers, 378 airports,
plus a Chinese alias table), so "Alaska Airlines" / "阿拉斯加航空" / "ATL" all become the
`AS` / `ATL` filter. Ranking questions understand Chinese numerals and explicit limits
("取前五名" -> 5, "前十" -> 10), and an unspecified limit means *all* groups rather than
the single largest one. Literal filters (year, top-N, carrier, airport, value range)
outrank the model's guess, while semantic parameters (dimension, metric) stay
model-first. Every tool result echoes the filters it applied in `meta.filters`.

### Hybrid routing

Routing combines three paths instead of always asking the model:

1. **Strong keyword shortcut** — unambiguous questions never reach the model (0 tokens).
2. **Model function calling** — the model picks the tool and arguments for implicit phrasings.
3. **Multi-round orchestration** — up to 3 tool rounds, then a forced summary, for
   comparison questions ("compare 2017 and 2018").

A multi-step signal detector keeps strong-keyword matches from collapsing a
multi-part question into a single answer. If the model is unreachable or returns no tool
call, routing falls back to keywords.

Measured on `scripts/verification/`: end-to-end routing accuracy went 71% → 100%,
implicit-question hit rate 14.3% → 100%, out-of-scope refusal 0% → 100%, and versus
always calling the model it is ~40% faster with ~42% fewer tokens.

## Verification

```bash
ADMIN_PASSWORD='<admin password>' node scripts/verification/verify-ai-tools.mjs
node scripts/verification/verify-ai-agent.mjs
node scripts/verification/verify-ai-cache.mjs
node scripts/verification/bench-e2e-routing.mjs
```

See [scripts/verification/README.md](scripts/verification/README.md) for what each script
covers and the latest baseline numbers.

## Raw data

`trip_airline_delay/*.csv` (7.2 GB of BTS archives) is **not** committed. See
[trip_airline_delay/README.md](trip_airline_delay/README.md) for the download and ingest steps.
