---
title: "Midnight Cache Stampede"
subject: x
summary: "A deploy repopulated 2 million product cache entries with the same 24-hour TTL. The next night they all expired within a minute, and 30,000 requests per second fell through to a database sized for 2,000."
difficulty: 3
concepts: [db-redis-caching, x-caching-everywhere, x-overloaded-server]
tags: [cache stampede, thundering herd, ttl jitter, single flight, stale while revalidate, cache warming]
order: 12
---

## Context

A product catalog API: cache-aside with Redis, TTL 24 h, 98.5% hit ratio at 30,000 req/s. PostgreSQL behind it comfortably handles ~2,000 product queries/s. A deploy on Tuesday at 00:05 flushed the cache (key format change) and a warm-up job reloaded all 2 million products within 8 minutes.

## Symptoms

- Wednesday 00:05–00:14: API p99 jumps from 25 ms to 8 s; error rate 35%.
- Database CPU pinned at 100%; connection pool exhausted in API pods.
- Recovers on its own after ~10 minutes; recurs the next night, slightly weaker.

## Metrics

| Metric | Normal | 00:06 Wednesday |
|---|---|---|
| Redis hit ratio | 98.5% | 12% |
| DB product queries/s | 450 | 26,000 attempted (≈ 2,000 served) |
| Keys expiring per second (Redis `expired_keys` rate) | ~25 | ~4,000 |
| Duplicate DB queries for the same product within 1 s | ~0 | up to 300 for bestsellers |

## Hypotheses

1. Mass expiry because all keys got identical TTLs during the warm-up.
2. Redis eviction under memory pressure → `evicted_keys` flat; ruled out.
3. A cron job hammering the database at midnight → none found.

## Investigation

TTL histogram (`OBJECT` sampling via a script) showed nearly all keys expiring in the same 9-minute window — exactly 24 h after the warm-up. Each expired hot key triggered concurrent misses: 300 simultaneous requests for a bestseller each queried the database (no request coalescing). The database, sized for the 1.5% miss rate, received ~15× its capacity; pools exhausted; timeouts triggered client retries, extending the overload.

The recurrence the following night was weaker because keys refilled during the incident at scattered times.

## Root Cause

Synchronized TTLs from a bulk warm-up + no stampede protection turned cache expiry into a thundering herd that exceeded database capacity ([Redis & Caching](lesson:db-redis-caching)).

## Fix

1. TTL jitter: `ttl = 24h ± random(0, 2h)`.
2. Single-flight per key: a short Redis lock (`SET lock:product:{id} NX PX 2000`) — one request recomputes; others wait briefly or serve stale.
3. Soft TTL with stale-while-revalidate: values carry a "refresh after" timestamp; after it, serve the cached value and refresh in the background; hard TTL much longer.
4. Load shedding on the miss path: cap concurrent DB fetches per pod.

## Prevention

- Treat bulk cache (re)population as a load event: spread TTLs, warm gradually.
- Alert on hit-ratio drops and expiry-rate spikes, not just errors.
- Capacity plan the database for a partially cold cache ([Caching Everywhere](lesson:x-caching-everywhere)).

## Interview Angle

Stampede questions test whether you understand that a cache changes the system's failure modes. Explain the herd (many concurrent misses for the same and many keys), then layer fixes: jitter, coalescing, stale-while-revalidate, early refresh, and protecting the backend with limits ([Overloaded Server](lesson:x-overloaded-server)).
