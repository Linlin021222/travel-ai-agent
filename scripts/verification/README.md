# Verification scripts

Automated checks used while developing the AI agent module. Every change to the
tool layer, routing or caching is re-checked with these scripts before it is
considered done.

## Prerequisites

```bash
docker compose up -d                 # PostgreSQL (pgvector) + Redis
cd bknd && npm install && npm run start:dev
cd ftnd && npm install && npm run dev   # optional, needed for UI checks
```

Common environment variables (the scripts fall back to sensible defaults):

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:3001` | Backend base URL |
| `ADMIN_PASSWORD` | – | **Required** for the tool/audit scripts (admin account password) |
| `DEMO_PASSWORD` | `demo1234` | Password for the throwaway user created by the cache script |

> When calling `localhost` from a shell with a proxy configured, the scripts already
> pass `--noproxy '*'` equivalents; keep that in mind if you curl manually.

## Verification (regression)

```bash
ADMIN_PASSWORD='<your-admin-password>' node scripts/verification/verify-ai-tools.mjs   # 45 checks: tools, registry, audit
ADMIN_PASSWORD='<your-admin-password>' node scripts/verification/verify-ai-agent.mjs   # 31 checks: sessions, streaming, memory
node scripts/verification/verify-ai-cache.mjs                                          # 20 checks: Redis namespaces, isolation
```

Covers 96 assertions in total. All three must be green before a change is merged.

### Week 3 – integration and write tools

```bash
ADMIN_PASSWORD='<your-admin-password>' node scripts/verification/verify-write-tools.mjs          # 57 checks
ADMIN_PASSWORD='<your-admin-password>' node scripts/verification/verify-storage-compliance.mjs   # 18 checks
```

`verify-write-tools.mjs` covers read-tool output cross-checked against the business REST API,
permission gates, audit completeness and masking, the write-tool safety chain
(preview → single-use token → execution), flight-record create/update/delete, chat-triggered
writes, and single-tool latency.

`verify-storage-compliance.mjs` walks `bknd/src/ai-agent/**/*.ts` and asserts there is no
business-table SQL and no `PG_POOL` import, then checks the four AI tables for dirty rows and
verifies Redis namespaces, cache hits and token TTL.

Unit tests (no database needed) live in `bknd/test/` and are run with `npm test` inside `bknd/`:

| File | Covers |
|---|---|
| `test/param-extractor.spec.ts` | Chinese numerals ("前五名"), entity resolution, numeric ranges |
| `test/tool-registry.spec.ts` | anonymous refusal, admin-only tools, disabled/unknown tools, error text, audit masking |
| `test/write-tools.spec.ts` | write tools never mutate unconfirmed, token replay/tamper refusal, admin gate, business validation |

## Identity / authorisation demo

```bash
ADMIN_PASSWORD='<your-admin-password>' node scripts/verification/demo-authz.mjs
```

Proves, against the running stack, that anonymous calls are rejected (401), admin-only
endpoints reject regular users (403), `scope=all` cannot escalate, tool results are masked
per identity, sessions are isolated by owner, and every tool execution is audited with
user id + IP.

## Benchmarks (before/after comparison)

```bash
node scripts/verification/bench-routing.mjs        # routing accuracy: explicit vs implicit questions
node scripts/verification/bench-e2e-routing.mjs    # 14 end-to-end routing cases
node scripts/verification/bench-hallucination.mjs  # out-of-scope / write requests must be refused
```

Clear Redis question caches before benchmarking so answers are recomputed:

```bash
docker exec flight-agent-redis redis-cli --scan --pattern 'ai:chat_cache:*' | xargs -r docker exec -i flight-agent-redis redis-cli del
```

## Latest results

| Metric | Before | After |
|---|---|---|
| End-to-end routing accuracy (14 cases) | 71% | 100% |
| Implicit-question hit rate | 14.3% | 100% |
| Out-of-scope refusal rate | 0% | 100% |
| Latency vs. always-call-model | – | ~40% faster, ~42% fewer tokens |

Week 3 (measured on the running stack, caches cleared):

| Check | Result |
|---|---|
| Read-tool output vs. business REST API | identical record set, `total` 1647 = 1647 |
| Unconfirmed write calls that mutated data | **0** (all returned a preview) |
| Token replay / tampered arguments | refused (HTTP 428 envelope) |
| Business rules enforced before preview | duplicate e-mail, missing target, illegal role/month |
| Write audit rows | preview + execution, operation `create/update/delete` |
| Business SQL inside the AI module | none (63 files scanned) |
| AI tables with dirty rows | none (357 NULL durations backfilled) |
| Single tool latency | P50 20–29 ms, P95 ≤ 30 ms |
| Cached second answer | 3608 ms → 32 ms |
