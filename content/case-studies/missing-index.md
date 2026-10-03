---
title: "The Admin Dashboard That Slowed Down Checkout"
subject: db
summary: "A new internal dashboard ran an unindexed query every 30 seconds per open tab. Sequential scans of a 40M-row table saturated disk I/O and pushed checkout p99 from 120 ms to 3 s."
difficulty: 2
concepts: [db-index-fundamentals, db-explain, db-index-design-practice, db-buffer-pool, x-slow-query]
tags: [missing index, sequential scan, io saturation, buffer pool, pg_stat_statements, noisy neighbour]
order: 1
---

## Context

An e-commerce company on a single PostgreSQL primary (16 vCPU, 64 GB RAM, network SSD) with two read replicas. The `orders` table holds 40 million rows (~28 GB). On Monday the support team got a new dashboard: "recent orders by customer email", auto-refreshing every 30 seconds.

## Symptoms

- Starting Monday ~10:00, checkout p99 rises from 120 ms to 2–3 s; p50 from 35 ms to 180 ms.
- Sporadic checkout timeouts (5 s client timeout).
- No deploy of the checkout service that day.

## Metrics

| Metric | Before | During |
|---|---|---|
| Primary disk read throughput | 40 MB/s | 480 MB/s (volume limit) |
| Disk read latency | 0.6 ms | 9 ms |
| Buffer cache hit ratio (orders) | 99.6% | 91% |
| DB CPU | 35% | 55% (mostly I/O wait) |
| Active connections | 25 | 140 |

## Hypotheses

1. Checkout traffic spike → ruled out: orders/minute normal.
2. Checkout query plan changed → possible; check its plan.
3. Something new is reading lots of data → I/O graph strongly suggests it.
4. Storage degradation on the cloud volume → check provider metrics.

## Investigation

`pg_stat_statements` ordered by total time:

```sql
SELECT left(query, 80), calls, round(mean_exec_time) AS mean_ms, shared_blks_read
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 5;
```

The top entry, absent last week: `SELECT … FROM orders o JOIN customers c ON … WHERE lower(c.email) = $1 ORDER BY o.created_at DESC LIMIT 50` — 12,000 calls/hour, mean 2.8 s, millions of blocks read.

```text
EXPLAIN (ANALYZE, BUFFERS) … WHERE lower(c.email) = 'x@y.com' …
Limit
  -> Sort (top-N heapsort)
     -> Hash Join (o.customer_id = c.id)
        -> Seq Scan on orders o   (actual rows=40,012,331)   Buffers: read=3,450,112
        -> Hash
           -> Seq Scan on customers c   Filter: (lower(email) = 'x@y.com')   Rows Removed by Filter: 5,999,999
```

Two problems: no index for `lower(email)` (the existing index is on `email`, and the function makes it unusable), and the planner, expecting a hash join, reads all of `orders`. 50 support agents × a tab refreshing every 30 s ≈ 100 executions/minute of a 28 GB scan — evicting checkout's hot pages from the buffer pool and saturating the volume.

## Root Cause

A non-sargable, unindexed query on the primary, executed at high frequency by an auto-refreshing UI. Its sequential scans saturated storage throughput and polluted the buffer pool; checkout queries, now missing cache and waiting on I/O, slowed and held connections longer.

## Fix

1. Immediate: disabled dashboard auto-refresh; terminated running dashboard queries (`pg_cancel_backend`).
2. `CREATE INDEX CONCURRENTLY customers_email_lower_idx ON customers (lower(email));` and ensured `orders(customer_id, created_at DESC)` existed → plan became two index scans: 2.8 s → 1.1 ms.
3. Routed the dashboard to a read replica.

Checkout p99 returned to 120 ms within minutes of stopping the scans.

## Prevention

- Query review for new features: EXPLAIN on production-sized data before release ([Index Design](lesson:db-index-design-practice)).
- A separate database role for internal tools with `statement_timeout = 2s` and replica routing by default.
- Alerting on new top entries in `pg_stat_statements` and on disk throughput saturation.

## Interview Angle

"A new feature made an unrelated endpoint slow" tests whether you look at **shared resources** (I/O, buffer pool, connections) rather than only the slow endpoint. Walk through: symptom → shared-resource metrics → top queries → EXPLAIN → mechanism (non-sargable predicate + seq scan + cache pollution) → mitigation (stop the load) → fix (index) → prevention (review, isolation of internal traffic, timeouts).
