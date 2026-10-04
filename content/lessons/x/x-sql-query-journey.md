---
title: "The Journey of a SQL Query: App → Network → Kernel → Database → Disk"
subject: x
level: 0
order: 2
summary: "One UPDATE followed from the application's driver through the connection pool, TCP, the database backend process, parsing and planning, the buffer pool and B+ tree, locks and MVCC, the WAL and fsync, replication — and back — tying OS, networking and database concepts into one timeline."
depth: core
difficulty: 3
minutes: 45
relevance: essential
stage: 2
prerequisites: [db-query-lifecycle, db-wal-durability, os-syscalls-interrupts, cn-sockets]
related: [x-website-journey, x-connection-management, db-buffer-pool, db-btree, db-locking, db-mvcc, db-replication, x-durability-chain]
labs: [sql-playground]
tags: [sql query lifecycle, database driver, connection pool, wire protocol, backend process, parser, planner, executor, buffer pool, b+ tree, row lock, mvcc, wal, fsync, group commit, replication, end to end]
---

## Mental Model

A single line of application code —

```python
cursor.execute("UPDATE accounts SET balance = balance - 100 WHERE id = %s", (42,)); conn.commit()
```

— touches almost every concept in this academy: a **connection pool** hands out a socket; the **kernel** moves bytes through **TCP**; a **database backend process** parses and plans; the **B+ tree** finds the row via the **buffer pool**; a **row lock** and **MVCC** version protect concurrent readers and writers; the **WAL** and **fsync** make it durable; **replication** ships it elsewhere; and the result travels back the same way.

Knowing this path lets you answer "where could this be slow?" and "what if X fails here?" for any query.

## Definition

The stations, in order:

| # | Station | Subject |
|---|---|---|
| 1 | Driver + connection pool | app / [Connection Management](lesson:x-connection-management) |
| 2 | Wire protocol over TCP (maybe TLS) | CN |
| 3 | Kernel send/receive paths, syscalls, interrupts | OS |
| 4 | Backend process: parse → analyze → plan → execute | DB ([Query Lifecycle](lesson:db-query-lifecycle)) |
| 5 | Index lookup via B+ tree through the buffer pool | DB ([B+ Trees](lesson:db-btree), [Buffer Pool](lesson:db-buffer-pool)) |
| 6 | Row lock + new row version | DB ([Locking](lesson:db-locking), [MVCC](lesson:db-mvcc)) |
| 7 | WAL append; COMMIT flushes WAL (fsync) | DB + OS ([WAL](lesson:db-wal-durability)) |
| 8 | Replication to standbys | DB + CN ([Replication](lesson:db-replication)) |
| 9 | Response back to the app | CN + OS |

## Why It Exists

**The problem.** Performance and reliability problems rarely respect subject boundaries. "The UPDATE is slow" may mean pool exhaustion (app), packet loss (network), CPU saturation (OS), a sequential scan (planner), a lock wait (concurrency), slow fsync (storage) or synchronous replication to a distant replica (distributed). Seeing the whole path is what lets you locate the problem.

**The idea.** Each station on the path exists to solve one problem — reuse connections (pool), move bytes (TCP/kernel), choose a method (planner), find the row fast (B+ tree, buffer pool), keep concurrent users apart (locks, MVCC), survive crashes (WAL), survive machine loss (replication). Know which problem each station solves and you know what it looks like when it fails.

:::callout[That's all it is]{type=insight}
A query borrows a connection, crosses the network, gets planned, finds its row through an index and the cache, takes a lock and writes a new version, flushes the log at commit, ships the log to replicas, and returns. A slow query is one of those steps taking longer than usual.
:::

## How It Works

### 1. Application: driver and pool

The driver asks the pool for a connection. If all are busy, the request **waits** (often the first hidden source of latency). With a connection in hand, the driver serializes the statement using the database's wire protocol — for PostgreSQL, a `Parse/Bind/Execute` sequence for prepared statements, or a simple `Query` message.

### 2–3. Network and kernel (client side)

`send()` is a system call: the CPU switches to kernel mode, copies the bytes into the socket's send buffer, and TCP segments them, adds headers, and hands them to the NIC driver ([Syscalls & Interrupts](lesson:os-syscalls-interrupts), [Sockets](lesson:cn-sockets)). Same-datacenter RTT ≈ 0.1–0.5 ms; cross-zone ≈ 1 ms.

Server side: the NIC raises an interrupt, the kernel processes the TCP segment, places bytes in the backend's socket receive buffer and wakes the backend process blocked in `recv()`.

### 4. Backend: parse, plan, execute

PostgreSQL has one OS process per connection; it parses the SQL, resolves `accounts` in the catalog, and plans: `Index Scan using accounts_pkey` (or reuses a cached plan for prepared statements). The executor runs the `ModifyTable` node over that scan.

Walkthrough: [SQL execution](uth:sql-execution).

### 5. Finding the row

The B+ tree descent reads the root, an internal page and a leaf of `accounts_pkey` — each a **buffer pool** lookup: hit (~microseconds) or miss (a `pread()` system call; the OS page cache may serve it, otherwise the SSD — ~100 µs) ([Page Cache](lesson:os-page-cache)). The leaf gives the TID; the heap page is fetched the same way.

Walkthrough: [Index lookup](uth:index-lookup).

### 6. Locking and versioning

The backend checks the row version is visible and not locked by another writer. If another transaction is updating account 42, it **waits** on that transaction's lock (a lock wait — [Locking](lesson:db-locking)). Otherwise it writes a new row version (xmin = its transaction id) and marks the old one with xmax; concurrent readers keep seeing the old version from their snapshots ([MVCC](lesson:db-mvcc)). The buffer page is now dirty — in memory only.

### 7. Durability: WAL and COMMIT

Each change produced a WAL record in the in-memory WAL buffer. `COMMIT` appends a commit record and then **waits for the WAL to be flushed**: `write()` to the WAL file + `fdatasync()` → filesystem → block layer → SSD, which must persist it (not just cache it) ([Durability Chain](lesson:x-durability-chain)). Group commit lets one flush serve many concurrent commits. The data page itself is written later by the checkpointer.

Walkthrough: [COMMIT](uth:commit).

### 8. Replication

WAL sender processes stream the new WAL to standbys. With synchronous replication, the COMMIT also waits until a standby confirms it has flushed the WAL — adding a network round trip ([Replication](lesson:db-replication)).

### 9. Response

The backend sends `CommandComplete ("UPDATE 1")` and `ReadyForQuery`; the kernel and network carry it back; the driver returns to the application, which releases the connection to the pool.

## Internal Mechanism

:::depth{level=advanced}
### Latency budget of a fast UPDATE (same zone, warm cache)

| Step | Typical time |
|---|---|
| Pool checkout (no contention) | ~0.01 ms |
| Client → server network | ~0.2 ms |
| Parse/plan (prepared: skipped) | 0–0.2 ms |
| Index lookup + heap access (cached) | ~0.02 ms |
| Lock + new version + WAL record | ~0.01 ms |
| WAL fsync (NVMe with power-loss protection) | ~0.05–0.5 ms |
| Sync replication (optional, same region) | +0.5–2 ms |
| Server → client network | ~0.2 ms |
| **Total** | **≈ 0.5–1 ms** (≈ 1.5–3 ms with sync replication) |

When the same statement takes 800 ms, some step deviated: a pool wait, a lock wait, a cache miss storm, an fsync stall, or a lagging synchronous replica. `pg_stat_activity.wait_event` names the step a backend is waiting on.

### Context switches along the way

The client thread blocks in `recv()`; the backend process is woken; the WAL writer or the backend itself blocks in `fdatasync()`; walsender processes wake. Each block/wake is a scheduler event; under heavy load with thousands of connections, this machinery itself becomes overhead ([Context Switch](lesson:os-context-switch)).
:::

## Example

The same UPDATE observed in three incidents:

| Symptom | Where on the path | Evidence | Fix |
|---|---|---|---|
| p99 1.5 s, DB CPU idle | pool checkout wait | app metrics: pool wait time; all connections busy | fix slow transactions holding connections; size pool correctly |
| Many backends `wait_event = Lock:transactionid` | step 6 | `pg_blocking_pids` points to an idle-in-transaction session | kill it; fix transaction scoping |
| Every commit ~40 ms | step 7/8 | `WALSync` waits or `SyncRep` waits | storage flush latency / distant synchronous replica |

## Complexity & Performance

The fast path is ~1 ms and dominated by network round trips and one fsync. The slow paths are waits: pool, lock, I/O, replication. Throughput is bounded by the slowest shared resource (connections, a hot row, WAL flush rate).

## Trade-offs

- Synchronous replication and full durability add latency to every commit; relaxing them trades a bounded risk of losing recent commits.
- Prepared statements save planning but can pick generic plans ([Query Lifecycle](lesson:db-query-lifecycle)).
- More connections ≠ more throughput: beyond cores × small factor, contention and context switching dominate ([Connection Management](lesson:x-connection-management)).

## Failure Modes

- Crash after `COMMIT` returned: WAL is durable → recovery replays it; the update survives ([Crash Recovery](lesson:db-crash-recovery)).
- Crash before the WAL flush: the transaction is lost — and the application never got "COMMIT OK".
- Network failure after commit, before the reply: the application doesn't know whether it committed → idempotent retries or checking state are required.

## In Production

- Tracing spans around pool checkout, query execution and commit separate app-side from DB-side time.
- Database wait events, `pg_stat_statements` and OS metrics (fsync latency, CPU, network retransmits) localize the slow station.

## Deeper Connections

- The browser-side prelude of this journey is [What Happens When You Open a Website](lesson:x-website-journey).
- Durability's full stack is [The Durability Chain](lesson:x-durability-chain); the pool station is [Connection Management](lesson:x-connection-management).

## Common Misconceptions

- **"COMMIT writes the table to disk."** It flushes the WAL; pages follow later.
- **"If the query is fast in psql, the app is slow."** The app path adds pool waits, network and serialization — measure each.
- **"A timeout means the transaction didn't happen."** It may have committed; the reply was lost.

## Interview Questions

### [L2 · trace] Trace an UPDATE statement from the application to durable storage.

:::answer
The app borrows a pooled connection; the driver encodes the statement in the wire protocol and sends it via a send() syscall; TCP carries it to the database host, whose kernel wakes the backend. The backend parses, plans (index scan on the primary key), and executes: descends the B+ tree through the buffer pool (reading pages from disk on misses), checks visibility, acquires the row lock, writes a new row version (dirtying the page in memory) and appends WAL records. On COMMIT it appends a commit record and waits for the WAL to be fsync'd (and for synchronous replicas, if configured). It replies to the client; dirty pages are written later by the checkpointer.
:::

### [L2 · debugging] The same UPDATE usually takes 1 ms but sometimes 2 seconds. List where on its path the time could go and how you'd check each.

Pool wait (app metrics for checkout time), network (retransmits, cross-zone routing), planning (rare), lock waits on the row (pg_locks / wait_event Lock), I/O misses (buffer reads in EXPLAIN (ANALYZE, BUFFERS), storage latency), WAL fsync (wait_event WALSync / IO metrics), synchronous replication (SyncRep waits, replica health), and CPU saturation on either host. Correlate slow instances with these metrics.

### [L3 · scenario] The app received a timeout on COMMIT. Did the transaction commit?

Unknown: the commit might have been durably recorded and only the reply lost, or never executed. The application must either make the operation idempotent (unique request/idempotency key, so a retry is harmless) or check the resulting state before retrying. Never assume failure.

## Practice

### [mcq] During an UPDATE, which step must complete before COMMIT is acknowledged (default PostgreSQL settings)?

- [ ] Writing the modified heap page to its data file
- [x] Flushing the WAL up to the commit record
- [ ] Vacuuming the old row version
- [ ] Updating table statistics

Only the log must be durable; everything else is deferred.

### [mcq] Many sessions show wait_event `Lock:transactionid`. Which station of the journey is slow?

- [ ] Connection pool checkout
- [ ] Network transfer
- [x] Waiting for another transaction's row lock
- [ ] WAL fsync

They're queued behind a transaction that holds a lock on rows they need.

## Quick Revision

- Pool → driver/wire protocol → syscalls/TCP → backend (parse/plan/execute) → B+ tree via buffer pool → lock + MVCC version → WAL → fsync on COMMIT → (sync replica) → reply.
- Fast path ≈ 1 ms: network + one fsync. Slow paths are waits: pool, lock, I/O, replication.
- Durable = WAL flushed; data pages later; crash after COMMIT is safe.
- Timeouts leave outcomes unknown → idempotency.
