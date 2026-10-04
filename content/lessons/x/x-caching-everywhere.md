---
title: "Caching Everywhere: One Idea at Every Layer"
subject: x
level: 1
order: 1
summary: "CPU caches, TLBs, the page cache, the buffer pool, application caches, Redis, CDNs and browsers all solve the same problem with the same trade-offs: locality, hit ratio, eviction, write policy, invalidation and consistency. Learn the pattern once, recognize it everywhere."
depth: core
difficulty: 3
minutes: 40
relevance: high
stage: 3
prerequisites: [os-page-replacement, cn-http-caching, db-redis-caching, db-buffer-pool]
related: [os-cpu-caches-contention, os-tlb, os-page-cache, cn-cdn, cn-dns-fundamentals, db-replication, sql-views-programmability, x-concurrency-everywhere]
tags: [caching, memory hierarchy, locality, hit ratio, eviction, lru, lfu, clock, write back, write through, invalidation, coherence, ttl, staleness, stampede, cache hierarchy]
---

## Mental Model

Every cache exists because **two storage levels differ in speed and cost**, and programs reuse data (**locality**). A cache keeps a small, hot subset of the slow level in the fast level. Every cache, from an L1 cache line to a CDN edge, must answer the same five questions:

1. **What to keep?** (admission, locality)
2. **What to throw out when full?** (eviction: LRU, LFU, CLOCK, TTL)
3. **What happens on writes?** (write-through, write-back, write-around, invalidate)
4. **How does it learn the source changed?** (invalidation, TTL, coherence protocols)
5. **What happens when it's cold, wrong or down?** (misses, stampedes, staleness)

## Definition

| Layer | Fast level | Slow level | Unit | Hit cost vs miss cost |
|---|---|---|---|---|
| CPU L1/L2/L3 | SRAM | DRAM | 64-byte line | ~1–40 ns vs ~100 ns |
| TLB | TLB entries | page-table walk | page mapping | ~1 ns vs ~10–100 ns |
| OS page cache | RAM | disk/SSD | 4 KB page | ~µs vs 100 µs–10 ms |
| DB buffer pool | RAM | data files | 8–16 KB page | ~µs vs 100 µs+ |
| App in-process cache | heap | DB/service | object | ~100 ns vs ms |
| Redis/Memcached | remote RAM | DB | key/value | ~0.3 ms vs 5–50 ms |
| CDN edge | nearby server | origin | HTTP response | ~10–30 ms vs 100–300 ms |
| Browser cache | local disk/RAM | network | HTTP response | ~0–5 ms vs RTTs |
| DNS caches | resolver memory | authoritative servers | record | ~0 ms vs 20–100 ms |

Latency numbers are orders of magnitude, not benchmarks; the ratio between levels is what makes caching pay off.

## Why It Exists

**The problem.** The **memory hierarchy** is a fact of physics and economics: faster storage is smaller and more expensive per byte. Locality — recently used data is likely reused (temporal), nearby data is likely used next (spatial) — means a small fast level can serve most accesses. Average access time = hit time + miss rate × miss penalty; with a 1,000× miss penalty, going from 95% to 99% hits makes a large difference.

**Why one lesson for all caches.** CPU caches, the TLB, the page cache, buffer pools, Redis, browsers and CDNs look unrelated, but each exists for the same reason and must answer the same five questions. Learn the questions once and every new cache is familiar.

:::callout[That's all it is]{type=insight}
Every cache is a small fast copy of a slow source. The design is always the same five choices: what to keep, what to evict, how to handle writes, how to learn about changes, and what happens on a miss.
:::

## How It Works

### Eviction: the same algorithms everywhere

| Policy | Idea | Where you met it |
|---|---|---|
| LRU | evict least recently used | Redis approx-LRU, many app caches |
| CLOCK / second chance | cheap LRU approximation with reference bits | OS page replacement, PostgreSQL clock-sweep ([Page Replacement](lesson:os-page-replacement), [Buffer Pool](lesson:db-buffer-pool)) |
| LFU / TinyLFU | evict least frequently used; resists one-time scans | Redis allkeys-lfu, Caffeine |
| Scan-resistant LRU variants | protect hot items from one-pass scans | InnoDB midpoint insertion, Linux active/inactive lists |
| TTL-based | expire after time | DNS, HTTP max-age, Redis TTL |
| Set-associative replacement | limited choice per set | CPU caches |

### Write policies

| Policy | Where | Trade-off |
|---|---|---|
| Write-back (dirty, flush later) | CPU caches, page cache, buffer pool | fast writes; must flush in the right order (WAL rule, fsync) |
| Write-through | some CPU caches, write-through app caches | always consistent source; slower writes |
| Write-around / invalidate | cache-aside with Redis | writes go to source; cache entry deleted |
| No write caching | HTTP caches (responses only) | simple |

### Invalidation and consistency

- **Hardware**: coherence protocols (MESI) keep CPU caches consistent automatically — at the cost of cache-line ping-pong under contention (false sharing — [CPU Caches](lesson:os-cpu-caches-contention)).
- **OS**: the page cache *is* the file's contents; all processes see one copy.
- **DB**: the buffer pool is the only copy in memory; replicas are caches of the primary with lag ([Replication](lesson:db-replication)).
- **Application / distributed**: no automatic coherence — you choose TTLs, delete-on-write, CDC-driven invalidation, versioned keys.
- **HTTP/DNS**: TTL-based freshness + validation (ETags) — staleness bounded by time, not events ([HTTP Caching](lesson:cn-http-caching)).

The further a cache is from the source, the weaker and slower its invalidation — and the more you rely on TTLs and accepting staleness.

## Internal Mechanism

:::depth{level=advanced}
### Recurring failure patterns

| Pattern | CPU / OS | Database | Distributed |
|---|---|---|---|
| Thrashing (working set > cache) | page thrashing, cache misses | buffer pool too small | cache hit ratio collapse |
| Scan pollution | streaming reads evicting hot lines | seq scan flooding buffer pool | batch job flooding Redis |
| Cold start | cold CPU caches after context switch | empty buffer pool after restart/failover | empty cache after deploy → DB overload |
| Stampede / herd | — | — | many misses for one expired key |
| Stale data | (coherence prevents) | replica lag | TTL windows, invalidation races |
| Contention | false sharing | hot page latch | hot key on one node |

### Cache hierarchies compound

A read of a row may hit: CPU cache (row bytes) ← buffer pool (page) ← OS page cache (file block) ← SSD's own DRAM cache ← NAND. Double caching (buffer pool + page cache) wastes memory; databases choose O_DIRECT or tune sizes accordingly ([Buffer Pool](lesson:db-buffer-pool)).

### Caches change failure modes

Adding a cache improves the normal case and creates a new abnormal one: the system is now sized for the hit ratio. When the cache fails or goes cold, the load behind it multiplies — the database must survive it or requests must be shed ([Overloaded Server](lesson:x-overloaded-server)).
:::

## Example

A product page request benefits from caches at seven layers: browser (static assets, `immutable`), CDN (images and a 30-second cached HTML fragment), load balancer connection reuse (TLS session), app in-process cache (feature flags), Redis (product data, 5-minute TTL), database buffer pool (index pages), OS page cache and CPU caches (hot code and data). A price change must propagate through the ones that hold it: invalidate Redis on write, purge or wait out the CDN's 30 s, never cache the price in the browser — and read the authoritative price from the database at checkout.

## Complexity & Performance

Average access time = Σ over levels (probability of reaching that level × its cost). Improving the hit ratio at a level with a huge miss penalty (remote → local) matters far more than shaving the hit time.

## Trade-offs

- Freshness vs load/latency (TTL length, invalidation effort).
- Memory cost vs hit ratio (diminishing returns once the working set fits).
- Write-back speed vs durability/consistency risk (and the need for flush ordering).
- Caching closer to users (faster) vs harder invalidation.

## Failure Modes

- Caching data you can't be stale on (balances, permissions, prices at checkout).
- Missing invalidation paths (a second writer bypasses the cache).
- Sizing downstream capacity for the hit ratio with no plan for cold/failed caches.
- Personalized data in shared caches → data leaks ([HTTP Caching](lesson:cn-http-caching)).

## In Production

- Monitor hit ratio *and* miss rate × miss cost at each layer; alert on sudden hit-ratio drops (often the first sign of a deploy that changed keys).
- Document, for each cached datum: owner, TTL, invalidation mechanism, acceptable staleness.

## Deeper Connections

- MVCC snapshots and replicas are "caches of the past"; materialized views are caches of query results ([Views](lesson:sql-views-programmability)).
- Caching and concurrency meet in coherence and invalidation races ([Concurrency Everywhere](lesson:x-concurrency-everywhere)).

## Common Misconceptions

- **"Caching is an application-level feature."** It's everywhere from silicon to CDNs; the application layer is just the one you control directly.
- **"A higher hit ratio is always worth more memory."** Past the working set, returns vanish.
- **"Caches make systems more reliable."** They add capacity and a new failure mode.

## Interview Questions

### [L2 · conceptual] What properties of programs make caching work, and what limits it?

Temporal locality (recently used data is reused soon) and spatial locality (nearby data is used next) mean a small fast store can serve most accesses. Limits: working sets larger than the cache (thrashing), access patterns without locality (random or one-pass scans), invalidation/consistency requirements, and the cost of misses (cold starts, stampedes).

### [L2 · compare] Compare write-back and write-through caching, with examples at different layers.

Write-back caches modify data in the fast layer and write it to the slow layer later (CPU caches, the OS page cache, database buffer pools): fast writes, but data can be lost on failure unless ordering/flush protocols exist (fsync, WAL). Write-through writes to both immediately (some CPU caches, write-through application caches): the source is always current, writes are slower. Cache-aside application caches typically write to the source and invalidate the cache.

### [L3 · design] A cache in front of your database has a 99% hit ratio. What risks does that create, and how do you mitigate them?

The database is effectively sized for 1% of the read load; if the cache is flushed, restarted, loses a node, or a hot key expires, load on the database can spike 10–100×. Mitigate with replicated/persistent caches and rolling restarts, prewarming, request coalescing and stale-while-revalidate, TTL jitter, load shedding on the miss path, and database capacity (or graceful degradation) for a realistic cold-cache scenario.

## Practice

### [numeric 1 unit=ms] A cache has a 99% hit ratio, a 0.5 ms hit time and a 50 ms miss penalty (the extra time a miss costs). What is the average access time in milliseconds?

:::answer
Average = hit time + miss rate × miss penalty = 0.5 + 0.01 × 50 = **1** ms. At a 95% hit ratio it would be 0.5 + 0.05 × 50 = 3 ms — three times slower from a four-point drop.
:::

### [mcq] Which pair describes the same idea at two different layers?

- [x] PostgreSQL's clock-sweep buffer replacement and the OS CLOCK page-replacement algorithm
- [ ] HTTP ETags and CPU branch prediction
- [ ] TLB entries and database foreign keys
- [ ] DNS TTLs and TCP sequence numbers

Both approximate LRU with per-entry usage bits and a sweeping hand.

## Quick Revision

- Every cache: what to keep, what to evict, how writes work, how invalidation works, what happens cold/down.
- Hierarchy: CPU → TLB → page cache → buffer pool → app cache → Redis → CDN → browser/DNS; ratios make it pay.
- Eviction families recur (LRU, CLOCK, LFU, TTL, scan resistance); write-back needs flush ordering.
- The farther from the source, the weaker the invalidation → TTLs and accepted staleness.
- Caches create new failure modes: cold starts, stampedes, stale data, leaks — size the backend for cache failure.
