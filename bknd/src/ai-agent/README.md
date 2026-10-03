# ai-agent module

AI owned data layer, Redis cache and multi-model chat. Everything here is physically
isolated from the business modules:

- **Own TypeORM connection** (`AI_DATA_SOURCE = 'ai'`) with only the 5 AI entities registered.
  Business code keeps using the raw `pg` pool (`PG_POOL`), so `users` / `flight_delay` are
  never created, altered or dropped by this module.
- **Own Redis connection** (`AiRedisModule`, deliberately *not* `@Global()`). All Redis access
  goes through `AiCacheService`.

```
ai-agent/
  ai-agent.module.ts            wiring: TypeORM + Redis + JWT
  ai-agent.controller.ts        /providers, /chat, /sessions/:id/messages
  ai-agent.service.ts           chat orchestration (LLM + cache + audit)
  ai-orm.constants.ts           named DataSource id
  ai-snake-naming.strategy.ts   camelCase entities -> snake_case columns
  controllers/                  CRUD endpoints for the 4 tables + cache ops
  services/                     CRUD services (user + tenant scoped)
  dto/                          class-validator DTOs (query / create / update)
  entities/                     TypeORM entities (AI module only)
  cache/
    ai-redis.module.ts          ioredis provider
    cache-keys.ts               the 4 key prefixes + TTLs
    ai-cache.service.ts         single entry point for every Redis call
    langgraph-checkpointer.ts   task state with a LangGraph-compatible shape
  llm/                          multi-model adapter (DeepSeek / Qwen / OpenAI / Kimi / local)
```

## 1. Tables

| # | Table | Grain | Purpose |
| --- | --- | --- | --- |
| 1 | `ai_chat_session` | one conversation | header: title, provider, model, status |
| 1b | `ai_chat_message` | one message | **line items of `ai_chat_session`** |
| 2 | `ai_user_memory` | one fact per user+key+scope | long-term memory |
| 3 | `ai_task_record` | one agent task | durable outcome of a run |
| 4 | `ai_operation_audit` | one operation | append-only audit trail |

`ai_chat_message` is the detail table of `ai_chat_session`; the architecture's "four tables"
count treats it as part of the session entity.

### Constraints & indexes

| Table | Notable columns | Indexes |
| --- | --- | --- |
| `ai_chat_session` | `id uuid pk`, `user_id text NOT NULL`, `tenant_id text NOT NULL`, `status text default 'active'`, `message_count int default 0`, `metadata jsonb` | `(user_id, updated_at)`, `(tenant_id)`, `(status)` |
| `ai_chat_message` | `session_id uuid`, `role text`, `message_type text`, `content text`, `payload jsonb` | `(session_id, created_at)`, `(user_id)` |
| `ai_user_memory` | `memory_key text`, `memory_value jsonb NOT NULL`, `category`/`scope`, `importance int` | **unique** `(user_id, memory_key, scope)`, `(user_id, updated_at)`, `(tenant_id)` |
| `ai_task_record` | `task_type`, `status`, `progress`, `input`/`output jsonb`, `thread_id`, `duration_ms` | `(user_id, created_at)`, `(tenant_id)`, `(status)`, `(task_type)` |
| `ai_operation_audit` | `action`, `operation`, `resource_type`, `success`, `status_code`, `ip_address` | `(user_id, created_at)`, `(tenant_id, created_at)`, `(action)`, `(resource_type, resource_id)` |

**Relation to `users`**: `user_id` / `tenant_id` are *logical* references to `users.id`
(no database FK). This satisfies "never modify business tables" and keeps the AI schema from
constraining business writes. Optional physical FK:

```sql
ALTER TABLE ai_chat_session
  ADD CONSTRAINT fk_ai_chat_session_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
```

## 2. Permissions

- `JwtAuthGuard` on every controller: missing/invalid token → `401`.
- Every query is filtered by `user_id` **and** `tenant_id`. Another user's id returns `404`
  (not `403`), so resource existence is not leaked.
- Admins = emails in `AI_ADMIN_EMAILS` (the `users` table has no role column and must not be
  altered). Only admins can widen `GET /ai-agent/audits?scope=all`; for everyone else the
  parameter is silently ignored.
- Cross-tenant data is unreachable: `tenant_id` is part of every predicate.

## 3. Redis cache

| Prefix | Content | Default TTL | Notes |
| --- | --- | --- | --- |
| `ai:session:` | `{sessionId, userId, tenantId, turns[]}` | 2 h | last 10 turns; refreshed on each message; cleared when a session is archived/deleted |
| `ai:chat_cache:` | cached answer for user + question | 10 min | key includes provider/model/filters; per-dimension switch + TTL |
| `ai:llm_cache:` | *placeholder* | — | `AI_LLM_CACHE_ENABLED=false`; methods are safe no-ops today |
| `ai:task_state:` | task / LangGraph state | 1 h | auto-expires; explicit `expiresAt` swept by `clearExpiredTaskStates()` |

Behaviours worth knowing:

- **Fallback**: on an `ai:session:` miss the last 10 turns are loaded from `ai_chat_message`
  and re-warmed, so a Redis restart never loses conversation context.
- **Degradation**: Redis errors are swallowed and logged; a cache failure behaves like a miss.
- **Invalidation**: `POST /api/ai-agent/cache/invalidate` with `{dimension}` drops the chat
  cache for that business dimension; admins may pass `allTenants: true`.
- **Per-dimension config**: `AI_CACHE_BUSINESS_PROFILES='{"flight-delay":{"enabled":true,"ttlSeconds":900}}'`.
- **LangGraph**: `cache/langgraph-checkpointer.ts` mirrors `BaseCheckpointSaver`
  (`getTuple` / `put` / `putWrites` / `list`). Types are declared locally because
  `@langchain/langgraph`'s peer `@langchain/core` is not installed.

## 4. Environment

```ini
AI_ADMIN_EMAILS=admin@flightagent.com      # audit-log admins
AI_DB_SYNCHRONIZE=true                     # create/alter the 5 AI entities only
AI_SESSION_CACHE_TTL=7200                  # ai:session:
AI_CHAT_CACHE_ENABLED=true
AI_CHAT_CACHE_TTL=600                      # ai:chat_cache:
AI_CACHE_BUSINESS_PROFILES={"flight-delay":{"enabled":true,"ttlSeconds":900}}
AI_TASK_STATE_TTL=3600                     # ai:task_state:
AI_LLM_CACHE_ENABLED=false                 # placeholder
```

## 5. Verify

```bash
node .cache/verify-ai-agent.mjs    # 31 checks: CRUD, pagination, isolation, admin, validation
node .cache/verify-ai-cache.mjs    # 20 checks: session memory, chat cache, PG fallback
```
