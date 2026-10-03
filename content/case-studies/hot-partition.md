---
title: "One Live Event, One Hot Partition"
subject: db
summary: "Live-stream comments were partitioned by stream id. A celebrity stream sent 40,000 comments per second to a single partition, overloading three replicas while the rest of the cluster idled. Write sharding and read caching fixed it."
difficulty: 4
concepts: [db-sharding, db-wide-column, db-consistent-hashing, db-redis-caching, x-overloaded-server]
tags: [hot partition, hot key, celebrity problem, write sharding, cassandra, bucketing, throttling]
order: 6
---

## Context

A live-streaming platform stores chat messages in a Cassandra-style wide-column cluster (24 nodes, RF 3):

```sql
PRIMARY KEY ((stream_id), sent_at)
```

Typical streams receive a few messages per second. Clients poll "latest 50 messages" every 2 s.

## Symptoms

- During a celebrity's live stream, chat for that stream lags by 30–60 s, then errors.
- Other streams are *mostly* fine, but some that share replicas with the hot one also slow down.
- Write timeouts on the ingest service.

## Metrics

| Metric | Hot stream's 3 replicas | Other 21 nodes |
|---|---|---|
| CPU | 95–100% | 20% |
| Write latency p99 | 1.8 s (timeouts) | 4 ms |
| Pending compactions | 180 | < 5 |
| Partition size | 6 GB and growing | < 10 MB |
| Reads/s on the partition | 350,000 (175k viewers polling) | — |

## Hypotheses

1. The partition key concentrates the stream's writes and reads on one replica set → consistent with per-node metrics.
2. Cluster-wide capacity shortage → ruled out: most nodes idle.
3. Compaction backlog from something else → it's local to the hot replicas.

## Investigation

`nodetool toppartitions` on a hot node: one `stream_id` accounts for > 90% of writes and reads. The partition grows ~40k rows/s; reads of "latest 50" must merge data from many SSTables and the memtable under constant compaction. The problem is **skew**, not capacity: consistent hashing balanced the *keys*, but one key carries the load ([Consistent Hashing](lesson:db-consistent-hashing)).

## Root Cause

A partition key (stream id) with extreme load skew: all writes and reads for a celebrity stream hit one partition and its three replicas. Unbounded partition growth added compaction and read amplification ([Wide-Column Stores](lesson:db-wide-column)).

## Fix

1. **Write sharding**: partition key `(stream_id, bucket)` where `bucket = hash(message_id) % 32` for streams flagged hot (and time-bucketed by minute), spreading one stream over 32 partitions across the ring.
2. **Read path**: a fan-out service maintains the "latest 200 messages" per stream in Redis (and pushes to clients over WebSockets), so 175k viewers don't read the database at all ([Redis & Caching](lesson:db-redis-caching)).
3. Sampling/rate-limiting chat for extremely hot streams (product decision: show a representative subset).

## Prevention

- Model partition keys with load distribution in mind, not just data distribution; bound partitions (time buckets).
- Detect hot keys automatically (toppartitions, per-key metrics) and switch to bucketed keys dynamically.
- Serve high-fan-out reads from caches/push, not from the database.

## Interview Angle

The "celebrity problem" appears in feeds, likes, counters and chats. Interviewers want: why hashing doesn't prevent it (load per key ≠ keys per node), write sharding with suffix buckets (and its read cost: merge N buckets), caching and push for reads, and bounded partitions ([Sharding](lesson:db-sharding)).
