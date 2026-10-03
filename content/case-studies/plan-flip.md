---
title: "The Query Plan That Changed Overnight"
subject: db
summary: "After a large tenant was imported, auto-analyze refreshed statistics and a report query switched from a hash join to a nested loop based on a 3,000× underestimate. Runtime went from 90 ms to 6 minutes."
difficulty: 4
concepts: [db-query-optimization, db-explain, db-scans-joins, db-query-lifecycle]
tags: [plan regression, cardinality estimation, correlated columns, extended statistics, nested loop, auto_explain]
order: 2
---

## Context

A multi-tenant SaaS on PostgreSQL. A reporting endpoint aggregates `events` (1.2 billion rows, partitioned monthly) joined to `users` for one tenant and one region. On Wednesday night the sales team onboarded an enterprise customer, importing 150 million events in bulk.

## Symptoms

- Thursday 08:00: the report endpoint times out for several tenants (30 s limit); others are fine.
- Database CPU on the primary rises to 85%, mostly from a handful of long-running queries.

## Metrics

| Metric | Wednesday | Thursday |
|---|---|---|
| Report query mean time (pg_stat_statements) | 90 ms | 6 min (when allowed to finish) |
| Rows returned | ~2,000 | ~2,000 |
| Shared buffers hit per call | 12k | 45M |

Same query text, same result size, vastly more work: a plan change.

## Hypotheses

1. Data volume grew → but most tenants' data didn't change.
2. Plan regression after statistics changed → auto-analyze ran at 03:10 on the events partition after the import.
3. Locking/contention → no lock waits in `pg_stat_activity`.

## Investigation

`auto_explain` had captured the slow plan:

```text
Nested Loop  (cost=… rows=4) (actual rows=11,900,000 loops=1)
  -> Index Scan using events_tenant_region_idx on events_2024_09 e
        Index Cond: ((tenant_id = 7) AND (region = 'ap-south'))
        (rows=4) (actual rows=11,900,000)
  -> Index Scan using users_pkey on users u  (loops=11,900,000)
```

Estimated 4 rows, actual 11.9 million. The planner multiplies selectivities of `tenant_id = 7` and `region = 'ap-south'` as if independent; for tenant 7 (the newly imported enterprise), **all** events are in `ap-south`. After the import, the MCV statistics made each predicate look selective, and the product looked tiny → nested loop with 11.9M index probes.

Before the import, tenant 7 didn't exist in statistics and the default estimates happened to favor a hash join — the old plan was good partly by luck.

## Root Cause

A cardinality misestimate from correlated predicates (tenant determines region), exposed when fresh statistics described a skewed new tenant. The planner chose a nested loop suitable for a handful of rows.

## Fix

```sql
CREATE STATISTICS events_tenant_region (dependencies, mcv) ON tenant_id, region FROM events;
ANALYZE events;
```

The estimate became ~11M rows, the planner picked a hash join with a parallel scan: 6 min → 1.4 s. A composite covering index on `(tenant_id, region, created_at) INCLUDE (user_id, kind)` then allowed a time-bounded index-only scan: 1.4 s → 70 ms.

## Prevention

- Extended statistics for known correlated column groups (tenant/region, city/state, account/owner).
- `ANALYZE` as part of bulk-import jobs, and a post-import check of top queries' plans.
- `auto_explain` enabled with a threshold (e.g., 2 s) so regressions leave evidence.
- Per-endpoint query timeouts so one plan regression can't consume the database.

## Interview Angle

Shows that "same query, suddenly slow" usually means **plan change**, and that plan changes usually mean **estimates vs reality diverged**. Expect follow-ups on how estimates are computed (MCVs, histograms, independence assumption), how to read `rows=4 (actual rows=11,900,000)`, and why hints are a last resort compared with fixing statistics ([Query Optimization](lesson:db-query-optimization)).
