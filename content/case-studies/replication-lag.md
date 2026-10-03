---
title: "“I Just Posted It — Where Did It Go?” Replication Lag"
subject: db
summary: "A nightly backfill generated WAL faster than read replicas could replay it. Replica lag reached 90 seconds, and users reading from replicas didn't see their own new posts — a read-your-writes violation fixed with lag-aware routing."
difficulty: 3
concepts: [db-replication, db-consistency-models, db-wal-durability, db-mvcc, x-sql-query-journey]
tags: [replication lag, read replicas, read your writes, wal, replay, hot standby, bulk updates, routing]
order: 4
---

## Context

A social app: PostgreSQL primary + 3 asynchronous streaming replicas. The app sends all `SELECT`s to replicas via a read pool and writes to the primary. A new nightly job backfills a `search_vector` column for 300 million posts in batches.

## Symptoms

- 01:00–03:00, support tickets: "my post disappeared after posting", "my edit reverted".
- After a refresh a minute later, the content appears.
- Only affects some users (those active during the job, in time zones where it's daytime).

## Metrics

| Metric | Normal | During backfill |
|---|---|---|
| WAL generation on primary | 8 MB/s | 70 MB/s |
| Replica replay lag | < 50 ms | 30–90 s |
| Replica CPU (startup/replay process) | 10% | 100% of one core |
| Replica network in | 8 MB/s | 70 MB/s |

## Hypotheses

1. Replicas lagging, reads served stale → consistent with symptom timing.
2. Caching layer serving stale feed → cache TTL is 5 s; wouldn't explain 60+ s.
3. Writes failing silently → primary shows the rows immediately.

## Investigation

On the primary:

```sql
SELECT application_name, replay_lag, pg_wal_lsn_diff(sent_lsn, replay_lsn) AS bytes_behind
FROM pg_stat_replication;
-- replica-1 | 00:01:12 | 4.9 GB
```

Replay on a physical standby is single-threaded: each WAL record is applied in order. The backfill updated every post row (new row versions, index entries, full-page images after checkpoints), generating WAL at ~9× the normal rate. Replicas received it but couldn't replay fast enough.

Some replica queries also held snapshots long enough to trigger replay pauses (`max_standby_streaming_delay = 30s`), adding lag.

## Root Cause

A bulk write job produced WAL faster than single-threaded replica replay could apply, creating tens of seconds of lag. The application read users' own freshly written data from replicas, violating read-your-writes ([Consistency Models](lesson:db-consistency-models)).

## Fix

1. Throttled the backfill: smaller batches with sleeps, targeting < 20 MB/s of WAL, monitored against replica lag (pause if lag > 2 s).
2. Lag-aware routing: after a user writes, their reads go to the primary for 10 s (session flag).
3. Replicas with lag above 5 s are removed from the read pool automatically.

## Prevention

- Bulk jobs must be "replication-aware": rate-limited by observed lag.
- Alert on replay lag in seconds, not just bytes.
- Decide read routing by consistency need: users' own data → primary (or LSN-checked replica); public feeds → replicas ([Replication](lesson:db-replication)).

## Interview Angle

Demonstrates understanding that async replication is eventually consistent and that "the database lost my write" is often "the replica hasn't replayed it yet". Name the guarantee (read-your-writes), explain why lag spikes (WAL volume vs replay throughput), and propose routing and throttling fixes.
