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
ADMIN_PASSWORD='<your-admin-password>' node scripts/verification/verify-ai-tools.mjs   # 42 checks: tools, registry, audit
node scripts/verification/verify-ai-agent.mjs                                          # 32 checks: sessions, streaming, memory
node scripts/verification/verify-ai-cache.mjs                                          # 21 checks: Redis namespaces, isolation
```

Covers ~95 assertions in total. All three must be green before a change is merged.

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
