---
title: "Database Locking: Row Locks, 2PL, Gap Locks and Deadlocks"
subject: db
level: 10
order: 3
summary: "Shared and exclusive locks, lock granularity and intention locks, two-phase locking, SELECT … FOR UPDATE / SKIP LOCKED, gap and next-key locks, lock queues behind DDL, and how databases detect and resolve deadlocks."
depth: core
difficulty: 3
minutes: 50
relevance: essential
stage: 2
prerequisites: [db-isolation-levels, os-deadlocks]
related: [db-mvcc, db-optimistic-pessimistic, os-sync-primitives, os-deadlock-handling, sql-dml-ddl, x-concurrency-everywhere]
labs: [db-locks]
tags: [locks, shared lock, exclusive lock, row lock, table lock, intention lock, two phase locking, strict 2pl, select for update, for share, skip locked, nowait, gap lock, next key lock, deadlock detection, lock timeout, lock queue, advisory lock]
---

## Mental Model

A database lock is a **mutex on a piece of data held for the rest of the transaction** ([Synchronization Primitives](lesson:os-sync-primitives)). Readers can share (shared lock); writers need exclusivity (exclusive lock). Waiting transactions queue. If transactions wait on each other in a cycle, that's a **deadlock** — and the database, unlike most application code, detects it and kills one participant ([Deadlocks](lesson:os-deadlocks)).

In MVCC databases, **plain reads don't take row locks** — they read snapshots ([MVCC](lesson:db-mvcc)). Locks matter for writes, for explicit locking reads (`FOR UPDATE`), and for schema changes.

## Definition

- **Shared (S) lock**: many holders; blocks exclusive requests.
- **Exclusive (X) lock**: one holder; blocks both S and X.
- **Granularity**: row, page, table (and database). Coarse locks are cheap to manage but block more.
- **Intention locks** (IS, IX): taken on the table before locking rows, so a table-level lock request can see "someone holds row locks here" without scanning all rows.
- **Two-phase locking (2PL)**: a transaction acquires locks (growing phase) and releases them (shrinking phase); never acquires after releasing. Guarantees conflict-serializability. **Strict 2PL**: hold exclusive locks until commit/abort (prevents cascading aborts) — what databases do.
- **Deadlock**: a cycle in the waits-for graph.
- **Lock timeout**: give up after waiting too long.

Compatibility:

| requested ↓ / held → | S | X |
|---|---|---|
| **S** | ✓ | ✗ |
| **X** | ✗ | ✗ |

## Why It Exists

**The problem.** Isolation requires preventing conflicting operations from interleaving badly ([Anomalies](lesson:db-anomalies)).

**The idea.** Borrow the oldest tool in concurrency: a mutex. Before touching a piece of data, take its lock; anyone who wants a conflicting lock waits. Locks are the pessimistic way: make the second transaction **wait** until the first finishes, turning a potential anomaly into a delay.

**Why hold locks until commit.** If a transaction released a row's lock mid-way, another could change the row and the first might then read or overwrite a different value than it decided on. Holding locks to the end (strict two-phase locking) is what makes the interleaving equivalent to a serial order.

:::callout[That's all it is]{type=insight}
Writers lock the rows they change until commit; readers can share, writers can't. Conflicts wait in a queue, and when two transactions wait on each other the database kills one. Everything else is about what exactly gets locked (rows, ranges, tables).
:::

## How It Works

### Row locks from writes

`UPDATE`/`DELETE` lock each affected row exclusively until commit. A second transaction updating the same row waits:

```text
T1: BEGIN; UPDATE accounts SET balance = balance - 100 WHERE id = 1;   -- X lock on row 1
T2: BEGIN; UPDATE accounts SET balance = balance + 50  WHERE id = 1;   -- waits…
T1: COMMIT;                                                           -- T2 proceeds
```

Writes never block plain reads in PostgreSQL/InnoDB (readers use snapshots).

### Explicit row locks: locking reads

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;   -- X-like row lock: others' FOR UPDATE/UPDATE wait
-- decide in application code
UPDATE accounts SET balance = $new WHERE id = 1;
COMMIT;
```

Variants (PostgreSQL): `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE` (weaker modes used by FK checks); modifiers **`NOWAIT`** (error instead of waiting) and **`SKIP LOCKED`** (skip rows others have locked).

`SKIP LOCKED` turns a table into a work queue:

```sql
-- Each worker grabs a different pending job without blocking the others
BEGIN;
SELECT id, payload FROM jobs
WHERE status = 'pending'
ORDER BY created_at
LIMIT 10
FOR UPDATE SKIP LOCKED;
-- process, then
UPDATE jobs SET status = 'done' WHERE id = ANY($ids);
COMMIT;
```

### Table locks and the DDL queue

Every statement takes a table-level lock of some mode: `SELECT` takes ACCESS SHARE, DML takes ROW EXCLUSIVE, most `ALTER TABLE` forms take **ACCESS EXCLUSIVE** (conflicts with everything). Locks are granted in **queue order**: an `ALTER TABLE` waiting behind a long `SELECT` blocks every later query on the table, even though those queries don't conflict with the `SELECT`. Result: a "harmless" migration stalls the site ([DML & DDL](lesson:sql-dml-ddl)). Use `lock_timeout` for DDL.

### Gap and next-key locks (InnoDB)

Locking rows can't stop phantoms — the problem row doesn't exist yet, so there's nothing to lock. The fix is to lock the *space* where it would go. To prevent phantoms for locking reads and writes, InnoDB locks not only index records but the **gaps** between them. A next-key lock = record lock + the gap before it.

```text
index on age: 20, 30, 40
T1: SELECT * FROM users WHERE age BETWEEN 25 AND 35 FOR UPDATE;
    → locks record 30 and gaps (20,30), (30,40)
T2: INSERT INTO users (age) VALUES (27);   -- blocks: 27 falls in a locked gap
```

Side effect: inserts into ranges near a locked range block, and gap locks are a frequent source of surprising InnoDB deadlocks. Without a usable index, a locking statement may lock every row scanned — effectively the whole table.

### Deadlocks

```text
T1: UPDATE accounts … WHERE id = 1;   -- holds row 1
T2: UPDATE accounts … WHERE id = 2;   -- holds row 2
T1: UPDATE accounts … WHERE id = 2;   -- waits for T2
T2: UPDATE accounts … WHERE id = 1;   -- waits for T1 → cycle
```

Detection: PostgreSQL checks the waits-for graph after a transaction has waited `deadlock_timeout` (1 s by default); InnoDB checks immediately on each wait. One transaction is chosen as the victim and aborted (`ERROR: deadlock detected`, SQLSTATE 40P01); the other proceeds. The application must retry the victim.

Prevention (the OS deadlock conditions again — [Deadlock Handling](lesson:os-deadlock-handling)): **lock in a consistent global order** (e.g., ascending id), keep transactions short, lock everything needed up front, and make sure locking statements use indexes.

::lab{id=db-locks}

## Internal Mechanism

:::depth{level=advanced}
### Where locks live

- PostgreSQL keeps heavyweight locks (tables, advisory locks, transaction ids) in a shared-memory lock table. **Row locks are stored in the tuple header** (`xmax` + infomask bits) rather than the lock table, so locking a million rows doesn't exhaust memory — but a waiter then waits on the locker's *transaction id*. Multiple sharers use a "MultiXact".
- InnoDB keeps lock structures per page in memory with bitmaps of locked records; very large locking statements can grow the lock memory significantly.
- SQL Server can **escalate** many row locks into a table lock to save memory — sudden table-wide blocking.

### Latches vs locks

Latches protect in-memory structures (buffer pages, B-tree nodes) for microseconds and have no deadlock detection (ordering discipline prevents cycles). Locks protect logical data for transaction lifetimes with deadlock detection ([Buffer Pool](lesson:db-buffer-pool)).

### Advisory locks

`pg_advisory_lock(key)` / `pg_try_advisory_xact_lock(key)`: application-defined mutexes managed by the database — e.g., "only one instance runs this cron job" or "serialize work per customer id". They follow the same wait/deadlock machinery but protect whatever the application says they protect.
:::

## Example

Diagnosing blocking in PostgreSQL:

```sql
SELECT a.pid, a.state, now() - a.xact_start AS xact_age,
       pg_blocking_pids(a.pid) AS blocked_by, left(a.query, 60) AS query
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0;
```

Typical finding: dozens of sessions blocked by one pid that is "idle in transaction" — it updated a hot row and then the application stalled. Terminate it, then fix the code path ([Transactions](lesson:db-transactions-acid)). Experiment with lock queues and deadlocks in the [Locks lab](lab:db-locks).

## Complexity & Performance

- Lock acquisition is cheap; **waiting** is the cost. Throughput on a hot row is bounded by 1 / (lock hold time): a row locked for 5 ms per transaction supports at most ~200 updates/s.
- Deadlock detection costs little unless deadlocks are frequent.

## Trade-offs

- Pessimistic locking: no wasted work, but waiting and deadlocks; good under high contention.
- Optimistic (version checks/SSI): no waiting, but retries; good under low contention ([Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).
- Fine granularity (rows): more concurrency, more lock bookkeeping; coarse (tables): simple, heavy blocking.

## Failure Modes

- **Hot rows**: a global counter, a popular product's stock, a tenant's settings row — every transaction serializes on it.
- **Lock queues behind DDL** freezing a table.
- **Deadlocks** from inconsistent lock ordering (updating rows in different orders in different code paths, or in the order a batch arrives).
- **Unindexed locking statements** (InnoDB) locking far more rows/gaps than intended.
- **Long transactions** holding locks while doing unrelated work.

## In Production

- Log lock waits (`log_lock_waits = on` logs waits longer than deadlock_timeout); alert on deadlock rates.
- Sort keys before batch updates; use `SKIP LOCKED` for queues; set `lock_timeout` for migrations and `statement_timeout` as a guard.

## Deeper Connections

- Database locks are the OS locking story with automatic deadlock detection ([Deadlocks](lesson:os-deadlocks)); hot rows are lock contention like a hot mutex ([Concurrency Everywhere](lesson:x-concurrency-everywhere)).
- Distributed databases need distributed locks or leases and must survive partial failure ([Distributed Transactions](lesson:db-distributed-transactions)).

## Common Misconceptions

- **"SELECT takes row locks."** Plain SELECTs in MVCC databases don't; only locking reads do.
- **"Deadlocks mean a database bug."** They're an expected outcome of concurrent transactions acquiring locks in different orders; handle them with ordering and retries.
- **"FOR UPDATE locks the whole table."** It locks the matching rows (plus gaps in InnoDB); the table gets only a weak lock.

## Interview Questions

### [L1 · compare] Shared vs exclusive locks?

A shared lock allows other shared locks but not exclusive ones — used for reading data you need to stay unchanged. An exclusive lock allows no other locks — taken for writes. Many readers can share; a writer needs exclusivity.

### [L2 · conceptual] What is two-phase locking and why does it guarantee serializability?

Each transaction acquires locks during a growing phase and releases them during a shrinking phase, never acquiring after releasing. At its lock point (when it holds all its locks), each transaction's conflicting operations are ordered consistently with others', so the precedence graph can't contain a cycle — the schedule is conflict-serializable. Strict 2PL holds write locks until commit to avoid cascading aborts.

### [L2 · scenario] Two services transfer money between accounts and occasionally hit "deadlock detected". Why, and how do you fix it?

Transfers lock two account rows; one transfer locks A then B while another locks B then A, forming a cycle. Fix by always locking accounts in a consistent order (e.g., by ascending id: `SELECT … WHERE id IN ($a, $b) ORDER BY id FOR UPDATE`), keep transactions short, and retry on deadlock errors since the database aborts one victim.

### [L2 · design] How would you build a job queue in PostgreSQL where many workers fetch jobs concurrently?

Workers run `SELECT … FROM jobs WHERE status = 'pending' ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED` inside a transaction, process the rows, and mark them done before commit (or mark them 'running' with a lease timestamp and commit quickly for long jobs). SKIP LOCKED lets each worker take different rows without blocking; a partial index on pending jobs keeps the query fast.

### [L3 · incident] A 2-second `ALTER TABLE orders ADD COLUMN` caused a 3-minute outage. Explain the lock mechanics.

ALTER TABLE needs ACCESS EXCLUSIVE, which conflicts with every other lock. A long-running query held ACCESS SHARE on orders, so the ALTER waited. Because lock requests queue in order, every new query on orders (needing ACCESS SHARE or ROW EXCLUSIVE) queued behind the waiting ALTER, so the table was effectively unavailable until the long query finished and the ALTER ran. Use lock_timeout with retries, and check for long transactions before migrating.

## Practice

### [mcq] T1 holds a shared lock on row R. Which request is granted immediately?

- [x] T2 requests a shared lock on R
- [ ] T2 requests an exclusive lock on R
- [ ] T2 requests an exclusive lock on R with NOWAIT
- [ ] None

S is compatible only with S; NOWAIT makes the X request fail immediately instead of waiting.

### [numeric 200] Every transaction updating a hot counter row holds its row lock for 5 ms. What is the maximum number of such transactions per second on that row?

:::answer
Updates to one row are serialized: 1000 ms / 5 ms = **200** transactions per second, no matter how many cores or connections you add.
:::

## Quick Revision

- S shared with S; X exclusive. Intention locks connect row and table granularity.
- Strict 2PL: acquire as needed, release at commit → serializable.
- Writes lock rows; plain MVCC reads don't; FOR UPDATE/SHARE lock explicitly; NOWAIT and SKIP LOCKED (queues).
- InnoDB gap/next-key locks prevent phantoms — and cause surprising waits/deadlocks.
- Deadlock = waits-for cycle → victim aborted → retry. Prevent with consistent lock order and short transactions.
- DDL needs ACCESS EXCLUSIVE; lock queues make waiting DDL block everyone → lock_timeout.
