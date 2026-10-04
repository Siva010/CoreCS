---
title: "Optimistic vs Pessimistic Concurrency Control"
subject: db
level: 10
order: 5
summary: "Lock first or check at the end? SELECT … FOR UPDATE versus version columns and compare-and-set updates, ETags and If-Match in APIs, retries and idempotency keys, and how to choose based on contention and the cost of wasted work."
depth: core
difficulty: 3
minutes: 35
relevance: high
stage: 2
prerequisites: [db-locking]
related: [db-mvcc, db-anomalies, os-atomic-instructions, cn-http-caching, sql-dml-ddl, db-distributed-transactions, x-concurrency-everywhere]
labs: [db-locks]
tags: [optimistic locking, pessimistic locking, version column, compare and set, cas, select for update, lost update, etag, if-match, 412 precondition failed, retry, idempotency key, advisory lock]
---

## Mental Model

Two strategies for preventing lost updates when several actors modify the same data:

- **Pessimistic**: "Someone will probably interfere — lock it before I touch it." Others **wait**.
- **Optimistic**: "Probably nobody will interfere — work freely, and at the end **check** nothing changed; if it did, retry." Nobody waits; losers **redo** their work.

It's the same choice as a mutex vs a compare-and-swap loop in concurrent programming ([Atomic Instructions](lesson:os-atomic-instructions)).

## Definition

- **Pessimistic concurrency control**: acquire locks (row locks via `SELECT … FOR UPDATE`, advisory locks) before reading-for-update; hold them until commit.
- **Optimistic concurrency control (OCC)**: read with a version marker; write conditionally (`WHERE version = <read version>`); detect conflict by the affected-row count; retry or report the conflict.
- **Version column**: an integer (or timestamp/hash) incremented on every update.
- **Compare-and-set (CAS) update**: `UPDATE … SET …, version = version + 1 WHERE id = ? AND version = ?`.

## Why It Exists

**The problem.** Many updates are **read → think → write**, where "think" happens in application code or even in a human's browser tab for minutes. Holding a database lock across a user's editing session is impossible; holding one across a fast in-request computation is fine. The two strategies fit those two situations.

**The underlying trade.** Locking pays a cost *every time* (bookkeeping and waiting) to avoid conflicts. Checking pays nothing up front and pays only when a conflict actually happens (redo the work). Which is cheaper depends on how often conflicts really happen.

:::callout[That's all it is]{type=insight}
Pessimistic: lock the row first, so others wait. Optimistic: remember the version you read and update only if it's unchanged; if it changed, retry. Pick by how often conflicts happen and how long the "think" step takes.
:::

## How It Works

### Pessimistic: lock, then compute

```sql
BEGIN;
SELECT quantity, reserved FROM inventory WHERE sku = 'A-17' FOR UPDATE;   -- others wait here
-- application computes the new reservation
UPDATE inventory SET reserved = reserved + 2 WHERE sku = 'A-17';
COMMIT;                                                                     -- lock released
```

Guarantees no one changes the row between your read and write. Keep the locked section short, lock multiple rows in a consistent order ([Locking](lesson:db-locking)), and use `NOWAIT`/`lock_timeout` where waiting is unacceptable.

### Optimistic: version check at write time

```sql
-- 1. read (no lock)
SELECT id, title, body, version FROM documents WHERE id = 42;     -- version = 7

-- 2. user edits for 3 minutes …

-- 3. conditional write
UPDATE documents
SET title = $1, body = $2, version = version + 1
WHERE id = 42 AND version = 7;
-- 1 row updated → success (now version 8)
-- 0 rows updated → someone else saved first: reload, merge or show a conflict
```

No locks held while the user edits. The single `UPDATE` is atomic, so two concurrent saves can't both match `version = 7`.

ORMs support this directly (JPA `@Version`, Rails `lock_version`, Django via conditional updates).

### Across HTTP: ETags and If-Match

The same pattern for REST APIs ([HTTP Caching](lesson:cn-http-caching)):

```http
GET /documents/42          → 200, ETag: "7"
PUT /documents/42
If-Match: "7"              → 200 (saved, ETag "8")   or   412 Precondition Failed
```

### Idempotency: the companion of retries

Optimistic schemes and network failures both lead to **retries**. Make operations safe to repeat: store a client-supplied idempotency key with a unique constraint, so a retried "charge ₹500" doesn't charge twice ([DML & DDL](lesson:sql-dml-ddl)).

## Internal Mechanism

:::depth{level=advanced}
### Optimism inside the database

- PostgreSQL Repeatable Read's "first updater wins" is built-in optimistic control on rows: the second writer aborts with a serialization error instead of silently overwriting.
- Serializable Snapshot Isolation is optimistic concurrency for whole transactions: run without read locks, validate dependencies at commit, abort on dangerous patterns ([Isolation Levels](lesson:db-isolation-levels)).
- Classic OCC (Kung & Robinson) has read, validation and write phases; many in-memory and distributed databases use variants because they avoid lock management across nodes.

### Choosing by contention

Expected cost per operation:

- Pessimistic ≈ lock overhead + P(conflict) × wait time (+ deadlock risk).
- Optimistic ≈ P(conflict) × (wasted work + retry).

At low conflict probability optimistic wins (no waiting, no lock bookkeeping, works across long think times). At high contention on a hot item, optimistic retries snowball — each retry may conflict again (livelock-like behavior) — and pessimistic queueing is more efficient.

### Atomic statements beat both

Where the update can be expressed as a single statement on current values — `SET stock = stock - 1 WHERE stock > 0`, `SET views = views + 1`, `INSERT … ON CONFLICT DO UPDATE` — the database does the read-modify-write atomically under its own row lock, with neither application-level locking nor retries.
:::

## Example

Choosing per use case:

| Use case | Strategy | Why |
|---|---|---|
| Wiki/CMS page editing (minutes of think time) | Optimistic (version column / ETag) | can't hold locks across user sessions; conflicts rare |
| Seat reservation for a hot concert | Pessimistic (`FOR UPDATE`, or `SKIP LOCKED` on seat rows) or atomic conditional update | high contention; retries would thrash |
| Incrementing counters | Atomic `UPDATE … SET n = n + 1` | no read in application code |
| Wallet transfer | Pessimistic locks in id order, or Serializable + retry | invariants across two rows |
| Mobile app offline sync | Optimistic with per-record versions + conflict resolution | clients are disconnected for long periods |

## Complexity & Performance

- Pessimistic: throughput on a hot row ≤ 1 / lock hold time; waiting under contention; deadlocks possible.
- Optimistic: zero waiting; wasted work proportional to conflict rate × work per attempt; can degrade sharply under contention.

## Trade-offs

Pessimistic is predictable under contention but couples transactions (waits, deadlocks) and can't span user think time. Optimistic scales with low contention and long think times, spans service and HTTP boundaries, but needs retry/merge logic and degrades on hotspots.

## Failure Modes

- **Forgetting to check the affected-row count** in optimistic updates — conflicts silently ignored, the lost update returns.
- **Updating without bumping the version** in one code path (e.g., a batch job) — other writers never notice its changes.
- **Holding `FOR UPDATE` locks across slow operations** (API calls, user input).
- **Retry storms** on a hot row with optimistic control.
- **Retrying non-idempotent side effects** (emails, charges) along with the transaction.

## In Production

- Use a DB-generated version increment (`version = version + 1` in SQL, or a trigger) rather than trusting clients.
- Expose conflicts meaningfully to users ("This document was changed by Priya 2 minutes ago — review changes").

## Deeper Connections

- CAS loops in lock-free programming, HTTP conditional requests, and database version columns are one idea at three layers ([Concurrency Everywhere](lesson:x-concurrency-everywhere)).
- Distributed systems lean optimistic (fencing tokens, conditional writes in object stores, version vectors) because distributed locks are fragile ([Distributed Transactions](lesson:db-distributed-transactions)).

## Common Misconceptions

- **"Optimistic locking uses locks."** It uses no locks — only a conditional write.
- **"Optimistic is always faster."** Only when conflicts are rare.
- **"Transactions alone prevent lost updates."** At Read Committed, read-modify-write in application code still loses updates without FOR UPDATE, a version check or an atomic statement.

## Interview Questions

### [L2 · compare] Optimistic vs pessimistic locking — how do they work and when do you use each?

Pessimistic locking acquires a lock (e.g., SELECT … FOR UPDATE) before reading data to modify, making other writers wait until commit — best under high contention and short critical sections. Optimistic locking reads a version, performs the update conditionally on that version (`WHERE version = ?`), and retries or reports a conflict if zero rows were updated — best with low contention, long think times, or across HTTP/service boundaries.

### [L2 · how] Implement optimistic locking for updating a user profile.

:::answer
Add `version int NOT NULL DEFAULT 0`. Read the profile with its version; on save run

```sql
UPDATE profiles SET display_name = $1, bio = $2, version = version + 1
WHERE user_id = $3 AND version = $4;
```

If the affected-row count is 1, success. If 0, someone else updated it: reload and merge or return a conflict (HTTP 409/412). Expose the version as an ETag and accept If-Match for API clients.
:::

### [L3 · scenario] A flash sale: 50,000 users try to buy 100 units within seconds, using optimistic version checks on the product row. What goes wrong and what would you do?

Nearly every attempt conflicts on the same row, so most transactions fail and retry, multiplying load (retry storms) while few succeed. Better: an atomic conditional decrement (`UPDATE … SET stock = stock - 1 WHERE id = ? AND stock > 0`), which serializes on the row lock without wasted work; or pre-split inventory into many rows (per-unit or bucketed) claimed with `FOR UPDATE SKIP LOCKED`; or queue purchase requests and process them sequentially; plus rate limiting at the edge.

## Practice

### [mcq] An optimistic update `UPDATE t SET v = $1, version = version + 1 WHERE id = 5 AND version = 3` reports 0 rows updated. What does it mean?

- [ ] The row was locked
- [x] The row's version is no longer 3 — another writer updated it (or it was deleted)
- [ ] The update is waiting
- [ ] The transaction deadlocked

Zero affected rows is the conflict signal; the application must handle it.

### [mcq] Which strategy fits editing a long form in a web app where the user may take 10 minutes?

- [ ] SELECT … FOR UPDATE when the form opens
- [x] Optimistic concurrency with a version column / ETag
- [ ] Serializable transaction spanning the edit
- [ ] Table lock

Locks and transactions can't be held across user think time.

## Quick Revision

- Pessimistic: lock first (FOR UPDATE), others wait; good for hot rows and short critical sections.
- Optimistic: read version, conditional write, 0 rows = conflict → retry/merge; good for low contention and long think times.
- HTTP analogue: ETag + If-Match → 412.
- Atomic single statements avoid both. Pair retries with idempotency keys.
- Optimistic degrades into retry storms on hotspots.
