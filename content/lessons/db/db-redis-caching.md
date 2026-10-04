---
title: "Redis and Caching Patterns: Cache-Aside, Invalidation and Stampedes"
subject: db
level: 14
order: 2
summary: "Why Redis is fast (in-memory, single-threaded event loop), its data structures and persistence options, cache-aside vs write-through vs write-behind, TTLs and eviction, invalidation races, stampedes and hot keys — the caching layer in front of almost every database."
depth: core
difficulty: 3
minutes: 50
relevance: essential
stage: 2
prerequisites: [db-why-databases]
related: [os-epoll-event-loops, db-consistent-hashing, x-caching-everywhere, cn-http-caching, db-replication, db-nosql-landscape, x-overloaded-server]
tags: [redis, cache, cache aside, lazy loading, write through, write behind, ttl, eviction, lru, lfu, cache invalidation, cache stampede, thundering herd, hot key, rdb, aof, redis cluster, sentinel, distributed lock, rate limiting]
---

## Mental Model

A cache is **a small, fast copy of data whose source of truth lives elsewhere**. Reading from memory over a warm connection takes ~0.1–0.5 ms; a database query with disk I/O and planning may take 5–50 ms. Putting a cache in front of hot reads cuts latency and, more importantly, **protects the database** from load it can't absorb.

The price is **staleness and complexity**: two copies of data can disagree, and the cache itself becomes something that can fail, fill up or be stampeded. "There are only two hard things in computer science: cache invalidation and naming things."

## Definition

- **Redis**: an in-memory data-structure server (strings, hashes, lists, sets, sorted sets, streams, bitmaps, HyperLogLog, geo) with optional persistence and replication.
- **Cache hit / miss**; **hit ratio** = hits / lookups.
- **TTL**: time-to-live after which an entry expires.
- **Eviction policy**: what to drop when memory is full (`allkeys-lru`, `allkeys-lfu`, `volatile-ttl`, `noeviction`).
- **Cache-aside (lazy loading)**: app reads cache; on miss, reads DB and populates cache.
- **Write-through**: app writes to cache and DB synchronously on every write.
- **Write-behind (write-back)**: app writes to cache; cache/worker persists to DB asynchronously.
- **Stampede (thundering herd / dog-piling)**: many concurrent misses for the same key all hit the database.

## Why It Exists

**The problem.** Read-heavy workloads repeatedly compute the same results (product pages, user profiles, feed fragments, permission checks). Serving them from memory reduces latency, database CPU and I/O — often by 10–100× for the hottest data — and absorbs traffic spikes that would otherwise overload the database ([Overloaded Server](lesson:x-overloaded-server)).

**The idea.** Remember answers you've already computed, in memory, close to the app — and accept that the remembered copy can be briefly out of date. Every cache pattern is a different answer to "when do we refresh the copy, and who does it?"

:::callout[That's all it is]{type=insight}
Check the cache; on a miss, read the database and store the result with a TTL. On writes, update the database and delete the cache entry. TTLs bound staleness; coalescing and jitter stop a popular key's expiry from flooding the database.
:::

## How It Works

### Why Redis is fast

- Data lives in RAM; operations are simple in-memory data-structure manipulations (O(1) or O(log n)).
- A **single-threaded event loop** multiplexes thousands of connections with epoll ([epoll & Event Loops](lesson:os-epoll-event-loops)): no locks, no context switches between commands; each command is atomic.
- Pipelining batches many commands per round trip. (Redis 6+ uses I/O threads for network reads/writes; command execution remains single-threaded.)

Consequence: **one slow command blocks everyone** — `KEYS *`, `SMEMBERS` on a million-element set, big `DEL`s, Lua scripts that loop. Use `SCAN`, `UNLINK` (async delete) and bounded structures.

### Cache-aside: the default pattern

```python
def get_product(pid):
    key = f"product:{pid}"
    data = redis.get(key)
    if data is not None:
        return deserialize(data)                     # hit
    row = db.query("SELECT … FROM products WHERE id = %s", pid)   # miss
    redis.set(key, serialize(row), ex=300 + random.randint(0, 60))  # TTL + jitter
    return row

def update_product(pid, fields):
    db.execute("UPDATE products SET … WHERE id = %s", pid)
    redis.delete(f"product:{pid}")                   # invalidate after the DB write
```

Why **delete** rather than **set** on update: two concurrent writers setting the cache can leave the older value in cache permanently; deleting forces the next reader to load the current DB state.

### The invalidation race (and the TTL safety net)

```text
Reader R: cache miss → reads DB (old value v1) … (slow)
Writer W:                    UPDATE DB → v2; DELETE cache
Reader R: … SET cache = v1   ← stale value cached after the invalidation
```

Mitigations: always set a **TTL** (bounds staleness), delay a second delete ("delayed double delete"), version values (only set if version is newer), or invalidate from the database's change stream (CDC) rather than the application.

### Pattern comparison

| Pattern | Read path | Write path | Consistency | Risk |
|---|---|---|---|---|
| Cache-aside | cache → DB on miss | DB, then invalidate | stale up to TTL/race window | miss storms; race above |
| Read-through | cache library loads from DB | — | as above | same, centralized |
| Write-through | cache (always populated) | cache + DB synchronously | fresher | write latency; caching data never read |
| Write-behind | cache | cache; DB later, batched | DB lags | **data loss** if cache dies before flush |
| Refresh-ahead | cache | background refresh before expiry | fresh for hot keys | wasted refreshes |

### Stampedes and hot keys

A cache's danger is that the database gets sized for the *cached* load. The moment a popular entry disappears, the uncached load returns all at once. When a hot key expires, thousands of requests miss simultaneously and all query the database:

- **Request coalescing / single-flight**: one request recomputes; others wait for its result (in-process, or with a short Redis lock `SET lock:key NX PX 3000`).
- **Stale-while-revalidate**: serve the stale value while one worker refreshes (store a soft expiry inside the value) — the same idea as HTTP's `stale-while-revalidate` ([HTTP Caching](lesson:cn-http-caching)).
- **TTL jitter**: randomize TTLs so keys populated together don't expire together.
- **Probabilistic early expiration**: refresh slightly before expiry with increasing probability.
- **Hot keys** (one celebrity profile): add a small in-process cache in each app server, or replicate the key under several names.

### Other Redis uses

- Rate limiting (`INCR` + `EXPIRE`, sliding windows with sorted sets).
- Sessions and short-lived tokens with TTLs.
- Leaderboards (sorted sets: `ZADD`, `ZREVRANGE`).
- Queues/streams (`LPUSH/BRPOP`, Streams with consumer groups).
- Distributed locks — carefully: a lock with a TTL can expire while the holder is paused; protect the resource with fencing tokens for correctness-critical locks ([Failover](lesson:db-failover)).

## Internal Mechanism

:::depth{level=advanced}
### Persistence

- **RDB snapshots**: `fork()` the process and write a point-in-time dump; copy-on-write keeps the parent serving ([Copy-on-Write](lesson:os-cow-mmap)) — but a write-heavy instance can nearly double memory during the snapshot.
- **AOF (append-only file)**: log every write; `appendfsync everysec` (lose ≤ ~1 s on crash) or `always` (slow). AOF rewrite compacts the log.
- As a pure cache, persistence can be off; as a primary store, you need AOF + replication, and you accept it's still an in-memory system.

### Eviction and memory

`maxmemory` + policy. LRU/LFU are **approximated** by sampling a few keys and evicting the best candidate. `noeviction` makes writes fail when full — right for data you can't lose, wrong for caches. Fragmentation and fork overhead mean you should leave headroom (don't size maxmemory at 100% of RAM).

### Replication and clustering

- Asynchronous primary → replica replication; **Sentinel** monitors and fails over.
- **Redis Cluster** shards the keyspace into 16,384 hash slots across primaries; clients are redirected (`MOVED`/`ASK`); multi-key operations require keys in the same slot (hash tags: `{user:42}:cart`).
- Async replication means acknowledged writes can be lost on failover ([Replication](lesson:db-replication)).
:::

## Example

Latency and load math for a product page:

- 20,000 requests/s, each needing the product row. DB query p50 8 ms; Redis p50 0.3 ms.
- Hit ratio 98% → DB receives 400 queries/s instead of 20,000; average fetch latency ≈ 0.98 × 0.3 + 0.02 × (0.3 + 8) ≈ 0.46 ms.
- If Redis goes down (or the whole cache is flushed): 20,000 queries/s hit a database sized for ~1,000 → overload and cascading failure. **Plan for cache failure**: rate-limit the fallback path, keep a local in-process cache, warm caches before shifting traffic.

## Complexity & Performance

- Most Redis commands O(1) or O(log n); network round trip dominates (~0.1–0.5 ms in-DC). Pipelining amortizes it.
- A single Redis instance: ~100k–1M simple ops/s depending on payload and pipelining.
- Memory is the cost driver; compress large values and avoid caching data that's rarely read.

## Trade-offs

- Freshness vs load: shorter TTLs and eager invalidation = fresher data, more DB load.
- Cache-aside simplicity vs write-through freshness vs write-behind speed (and risk).
- What to cache: rendered fragments (fewer computations, harder invalidation) vs raw rows (simple invalidation, more assembly).

## Failure Modes

- **Stampedes** on expiry of hot keys or after a cache flush/restart.
- **Stale data** from invalidation races or missing invalidation paths (a batch job updating the DB directly).
- **Cache as hidden primary**: data that exists only in Redis (write-behind, sessions) lost on failover or eviction.
- **Big keys / slow commands** blocking the event loop → latency spikes for all clients.
- **Cache penetration**: repeated lookups for non-existent keys always miss → cache negative results briefly or use a Bloom filter.
- **Eviction of important keys** under memory pressure with a wrong policy.

## In Production

- Monitor hit ratio, evictions, memory, latency (`LATENCY DOCTOR`, slowlog), connected clients, replication lag.
- Treat the cache as an optimization the system can survive without — at reduced capacity — rather than a correctness dependency.

## Deeper Connections

- Caching is a cross-cutting pattern with the same trade-offs at every layer — CPU caches, page cache, buffer pool, CDN, HTTP ([Caching Everywhere](lesson:x-caching-everywhere)).
- Redis Cluster's hash slots are sharding; client-side ketama rings are consistent hashing ([Consistent Hashing](lesson:db-consistent-hashing)).

## Common Misconceptions

- **"Redis is single-threaded, so it's slow."** Single-threaded execution avoids locking; it's fast because operations are tiny and in memory.
- **"Update the cache on writes (SET) instead of deleting."** Concurrent writers can leave stale values; delete-on-write plus TTL is safer.
- **"A cache makes the system more reliable."** It adds capacity but also a failure mode: losing it can overload the database.

## Interview Questions

### [L1 · compare] Explain cache-aside, write-through and write-behind.

Cache-aside: the application checks the cache, loads from the database on a miss and populates the cache; writes go to the database and invalidate the cache. Write-through: every write updates both cache and database synchronously, keeping the cache fresh at the cost of write latency. Write-behind: writes go to the cache and are persisted to the database asynchronously — fast writes, but risk of data loss and lag.

### [L2 · how] What is a cache stampede and how do you prevent it?

When a popular key expires (or the cache is flushed), many concurrent requests miss at once and all hit the database to recompute the same value, potentially overloading it. Prevent with request coalescing (single-flight or a short lock so only one request recomputes), serving stale data while one worker refreshes, TTL jitter, early probabilistic refresh, and pre-warming.

### [L2 · why] Why is Redis fast despite being single-threaded?

All data is in memory and commands are simple data-structure operations; a single event loop with epoll handles many connections without locks or context switches; each command runs atomically to completion. The bottleneck is usually the network, which pipelining and I/O threads mitigate. The flip side: a slow command blocks all clients.

### [L3 · scenario] After a deploy, Redis was restarted with an empty cache and the database fell over. What should have happened?

The system depended on the cache for capacity: with a cold cache every request became a DB query. Mitigations: don't restart all cache nodes at once (rolling restarts with replicas), persist/replicate caches so a restart isn't cold, warm critical keys before taking traffic, apply request coalescing and rate limiting on the miss path, and size the database (or degrade features) to survive a cache outage.

### [L3 · design] How do you keep cached product data consistent with the database?

Use cache-aside with delete-on-write after the database commit, always with a TTL as a bound on staleness. For stronger guarantees, drive invalidation from the database's change stream (CDC) so every writer's changes invalidate caches, and guard against the read/write race with versioned values or a delayed second delete. Decide per data type how much staleness is acceptable (price at checkout: read from DB; product description: minutes are fine).

## Practice

### [numeric 400] A service receives 20,000 reads/s with a 98% cache hit ratio. How many reads per second reach the database?

:::answer
Misses = 2% of 20,000 = **400** reads/s. At 90% hit ratio it would be 2,000/s — 5× the load for an 8-point drop.
:::

### [mcq] Why do many teams DELETE the cache key on update instead of SETting the new value?

- [ ] DELETE is faster than SET
- [x] Concurrent updates can leave an older value in the cache if both SET; deleting makes the next reader load the committed state
- [ ] SET doesn't support TTLs
- [ ] Redis can't store updated values

Delete-on-write plus TTL narrows the stale-data window.

## Quick Revision

- Cache = fast copy; trade staleness and complexity for latency and DB protection.
- Redis: in-memory, single-threaded event loop, atomic commands; avoid slow/big commands.
- Cache-aside (read miss → DB → set with TTL; write → DB → delete) is the default; write-through/write-behind trade freshness/latency/loss.
- Always TTL (+ jitter). Stampedes: single-flight, stale-while-revalidate, early refresh. Hot keys: local caches, key replication.
- Persistence: RDB (fork snapshots), AOF (log). Async replication can lose writes. Plan for the cache being empty or down.
