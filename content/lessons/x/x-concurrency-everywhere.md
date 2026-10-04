---
title: "Concurrency Everywhere: Races, Locks and CAS from CPUs to Clusters"
subject: x
level: 1
order: 2
summary: "The same concurrency problems and solutions appear in threads, databases and distributed systems: races and anomalies, mutexes and row locks and leases, compare-and-swap and version columns and ETags, deadlocks at every level, and copy-on-write/MVCC as the way to avoid locking readers."
depth: advanced
difficulty: 4
minutes: 40
relevance: high
stage: 3
prerequisites: [os-sync-primitives, db-isolation-levels, db-optimistic-pessimistic]
related: [os-race-conditions, os-atomic-instructions, os-deadlocks, db-locking, db-mvcc, db-anomalies, db-failover, db-quorums-consensus, x-caching-everywhere]
tags: [concurrency, race condition, mutex, row lock, distributed lock, lease, compare and swap, cas, optimistic concurrency, version column, etag, deadlock, mvcc, copy on write, rcu, idempotency, fencing token]
---

## Mental Model

Whenever two actors can touch the same state at the same time, you get the same three problems and the same three families of solutions — whether the actors are **threads** sharing memory, **transactions** sharing rows, or **services** sharing a database or a cloud resource.

**Problems**: lost updates (read-modify-write races), inconsistent views (reading a half-updated state), and deadlocks (waiting in a cycle).

**Solutions**:

1. **Mutual exclusion** — take a lock first (pessimistic).
2. **Optimistic conflict detection** — do the work, then commit only if nothing changed (compare-and-swap).
3. **Versioning** — never modify shared data in place; readers see immutable snapshots (copy-on-write, MVCC).

## Definition

| Concept | Threads (OS) | Database | Distributed systems |
|---|---|---|---|
| Shared state | memory | rows/tables | database records, object storage, leader role |
| Race / anomaly | data race, lost update | lost update, write skew | double processing, split brain |
| Lock | mutex, rwlock | row/table lock, `SELECT … FOR UPDATE` | distributed lock / lease (etcd, ZooKeeper, Redis) |
| Optimistic check | CAS instruction | `UPDATE … WHERE version = ?` | ETag + If-Match, conditional put |
| Versioning | copy-on-write, RCU | MVCC snapshots | immutable event logs, versioned objects |
| Deadlock handling | lock ordering, trylock | detection + victim abort | timeouts, leases, ordering |
| Atomic "do it once" | atomic increment | unique constraint, upsert | idempotency keys |

## Why It Exists

**The problem.** Concurrency is how systems get throughput — more threads, more connections, more instances. Every added actor sharing state reintroduces the same hazards.

**The idea.** The hazards come from one situation — two actors, one piece of state, no agreed order — so the fixes are the same three at every layer: make them take turns (locks), let them race but check at the end (compare-and-swap), or stop sharing mutable state (versions). Recognizing the common pattern lets you transfer solutions across layers instead of rediscovering them (often badly) at each one.

:::callout[That's all it is]{type=insight}
Threads, transactions and services all hit the same three problems (lost updates, inconsistent reads, deadlocks) and use the same three fixes (lock first, check-and-retry, or immutable versions). Only the names change between layers.
:::

## How It Works

### Lost update, three times

```text
Threads:      x = counter; x = x + 1; counter = x;           (two threads interleave → one increment lost)
Database:     SELECT stock → app computes stock − 1 → UPDATE stock = …   (two requests → one sale lost)
Distributed:  GET object → modify → PUT object                (two services → one change overwritten)
```

Fixes, layer by layer:

| Fix style | Threads | Database | Distributed |
|---|---|---|---|
| Atomic operation | `atomic.fetch_add` | `UPDATE … SET stock = stock − 1 WHERE stock > 0` | server-side atomic ops (Redis `INCR`, DynamoDB update expressions) |
| Lock | mutex around the sequence | `SELECT … FOR UPDATE` | lease-based lock + fencing token |
| Optimistic | CAS loop | version column | ETag/If-Match, conditional writes |

([Atomic Instructions](lesson:os-atomic-instructions), [Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic))

### Deadlock, three times

- Threads: T1 holds mutex A wants B; T2 holds B wants A — hangs forever unless you order locks ([Deadlocks](lesson:os-deadlocks)).
- Database: two transactions update rows in opposite order — the database detects the cycle and aborts one ([Locking](lesson:db-locking)).
- Distributed: service A holds lock X waiting for B's response; B needs lock X — usually resolved by timeouts/lease expiry (no global waits-for graph).

The prevention is identical: **acquire resources in a consistent global order**, hold them briefly, and bound waits.

### Readers without locks: versioning

- **Copy-on-write / RCU** (OS, languages): writers create a new version and atomically publish a pointer; readers keep using the old one until done ([Copy-on-Write](lesson:os-cow-mmap)).
- **MVCC** (databases): writers create row versions; readers use snapshots ([MVCC](lesson:db-mvcc)).
- **Immutable logs** (distributed): append events; consumers read at their own offsets.

All three trade memory and garbage collection for reader concurrency — and all three need cleanup of versions nobody can see anymore (grace periods, vacuum, log retention).

### Distributed locks are different

A local mutex holder can't vanish without the OS knowing; a distributed lock holder can pause (GC, VM freeze) or be partitioned while believing it still holds the lock. Hence **leases** (locks that expire) and **fencing tokens** (monotonically increasing numbers checked by the protected resource) — the same term-number idea as Raft ([Quorums & Consensus](lesson:db-quorums-consensus), [Failover](lesson:db-failover)).

## Internal Mechanism

:::depth{level=advanced}
### Hardware underneath everything

Database latches, OS mutexes and language-level locks are built from CPU atomic instructions (CAS, LL/SC, atomic exchange) plus memory barriers; contention shows up as cache-line bouncing between cores ([CPU Caches](lesson:os-cpu-caches-contention)). A "hot row" in a database is a hot lock and a hot cache line at the same time.

### Isolation levels ⇔ memory models

Database isolation levels and CPU/language memory models answer the same question — which interleavings may readers observe? Serializability ⇔ sequential consistency (roughly); weaker isolation ⇔ relaxed memory ordering. In both worlds, the default is weaker than programmers assume, and bugs appear only under load ([Isolation Levels](lesson:db-isolation-levels), [Race Conditions](lesson:os-race-conditions)).

### Contention is the universal limit

Whatever the mechanism, operations on one hot item serialize: a mutex held 1 µs caps that critical section at ~1M ops/s; a row lock held 5 ms caps updates to ~200/s; a single-partition leader caps writes to its throughput. Scaling requires **splitting** the hot item (sharded counters, per-core structures, partitioned keys) rather than a faster lock.
:::

## Example

"Charge a customer exactly once" in three designs:

| Design | Mechanism | Pitfall |
|---|---|---|
| In-memory mutex in the payment service | local lock | useless with 2+ instances |
| Redis lock with TTL around the charge | distributed lease | lock expires during a long GC pause → second instance charges too |
| Idempotency key with a UNIQUE constraint in the payments table, charge API called with the same key | atomic insert-once + provider-side idempotency | none of the above — correctness no longer depends on timing |

The robust solution turns the concurrency problem into a **constraint** checked atomically by the system of record ([Keys & Constraints](lesson:db-keys-constraints)).

## Complexity & Performance

- Locks: waiting ∝ contention × hold time; deadlock detection cost ∝ waits.
- Optimistic: wasted work ∝ conflict rate × work per attempt.
- Versioning: memory/storage for versions + cleanup work.

## Trade-offs

Pessimistic (predictable under contention, blocking), optimistic (no blocking, retries under contention), versioned (lock-free reads, garbage collection) — the same three-way trade-off at every layer.

## Failure Modes

- Check-then-act sequences without atomicity (in code, in SQL, across services).
- Locks held across slow I/O (network calls inside critical sections or transactions).
- Inconsistent lock ordering → deadlocks.
- Distributed locks treated like local mutexes (no fencing) → double execution.
- Hot items that no locking strategy can scale.

## In Production

- Review every read-modify-write path: which mechanism makes it safe? Prefer atomic statements and constraints; then optimistic checks; then locks.
- Monitor contention: lock waits, deadlocks, serialization failures, CAS retry counts.

## Deeper Connections

- Caches add concurrency problems of their own: invalidation races are lost updates on the cache ([Caching Everywhere](lesson:x-caching-everywhere)).
- Anomalies are race conditions with a database vocabulary ([Anomalies](lesson:db-anomalies)).

## Common Misconceptions

- **"Transactions make concurrent code safe."** Only at sufficient isolation, or with explicit locking/atomic statements.
- **"A distributed lock with a TTL is as safe as a mutex."** Pauses and clock issues break it without fencing.
- **"Optimistic is always faster."** Only when conflicts are rare.

## Interview Questions

### [L2 · compare] Show how a compare-and-swap appears at the CPU, database and HTTP layers.

CPU: `CAS(addr, expected, new)` atomically updates memory only if it still holds the expected value — used in lock-free loops. Database: `UPDATE t SET v = ?, version = version + 1 WHERE id = ? AND version = ?` — zero rows updated means someone else changed it. HTTP: `PUT` with `If-Match: <ETag>` — 412 Precondition Failed if the resource changed. Same pattern: read a version, write conditionally, retry or report on conflict.

### [L3 · design] How would you ensure a scheduled job runs on only one of ten instances at a time, safely?

Use leader election or a lease from a consensus-backed store (etcd/ZooKeeper) or a database advisory lock held for the job's duration; make the job itself idempotent and have side effects check a fencing token (e.g., the lease revision) so a paused former holder can't commit stale work. Alternatively claim work items with `SELECT … FOR UPDATE SKIP LOCKED`, which naturally lets only one instance process each item.

## Practice

### [numeric 500] Every update to a hot row holds its lock for 2 ms. What is the maximum number of updates per second to that row, regardless of how many servers you add?

:::answer
Updates to one row serialize: 1000 ms / 2 ms = **500** updates per second. To go faster, split the hot row (sharded counters) or shorten the hold time.
:::

### [mcq] Which mechanism makes "charge exactly once" correct even if two instances race and one pauses for 60 seconds?

- [ ] A local mutex in each instance
- [ ] A Redis lock with a 30-second TTL
- [x] An idempotency key protected by a unique constraint (and passed to the payment provider)
- [ ] Running the job at Read Committed

The atomic constraint doesn't depend on timing; leases can expire during pauses.

## Quick Revision

- Same problems everywhere: lost updates, inconsistent views, deadlocks.
- Same fixes everywhere: atomic operations, locks, optimistic CAS/versions, copy-on-write/MVCC.
- Deadlock prevention: consistent ordering, short holds, bounded waits.
- Distributed locks need leases + fencing tokens; prefer constraints and idempotency.
- Hot items serialize at any layer — split them.
