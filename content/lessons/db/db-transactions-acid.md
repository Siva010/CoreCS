---
title: "Transactions and ACID, Precisely"
subject: db
level: 9
order: 1
summary: "What a transaction guarantees and what it doesn't: atomicity, consistency, isolation and durability defined precisely, the mechanism behind each, autocommit and savepoints, and the transaction-handling mistakes that cause real outages."
depth: core
difficulty: 2
minutes: 40
relevance: essential
stage: 2
prerequisites: [sql-dml-ddl]
related: [db-wal-durability, db-anomalies, db-isolation-levels, db-locking, db-mvcc, db-crash-recovery, db-distributed-transactions, x-durability-chain]
labs: [isolation]
tags: [transaction, acid, atomicity, consistency, isolation, durability, commit, rollback, savepoint, autocommit, begin, idle in transaction, long running transaction]
---

## Mental Model

A transaction is a **bundle of reads and writes that the database treats as one indivisible, isolated, permanent step**. Either all of its changes happen or none do; other sessions never see it half-done; once `COMMIT` returns, the changes survive crashes.

The classic example: transferring ₹500 from account A to B is two updates. Without a transaction, a crash between them destroys money, and a concurrent reader could see ₹500 missing from both accounts.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 500 WHERE id = 'A';
UPDATE accounts SET balance = balance + 500 WHERE id = 'B';
COMMIT;
```

## Definition

| Property | Precise meaning | Implemented by |
|---|---|---|
| **Atomicity** | All of the transaction's effects happen, or none do (on error, abort or crash) | Undo information (old row versions / undo log) and WAL-based recovery |
| **Consistency** | A transaction moves the database from one state satisfying all declared constraints to another | Constraints (PK, FK, UNIQUE, CHECK) + *the application's* correct logic |
| **Isolation** | Concurrent transactions don't interfere beyond what the isolation level allows; ideally, as if run one at a time (serializable) | Locking and/or MVCC ([Isolation Levels](lesson:db-isolation-levels)) |
| **Durability** | Once committed, effects survive crashes and power loss | WAL flushed to stable storage before COMMIT returns ([WAL](lesson:db-wal-durability)) |

Consistency is the odd one out: it's mostly the application's responsibility. The database guarantees the constraints you declared; it can't know your business invariants ("total money is conserved") unless you encode them.

## Why It Exists

Without transactions every application would need to handle partial failure (crash after the first of five writes) and concurrency (another request interleaving its writes) by itself — with compensation logic, retries and locking scattered through the code. Transactions move that burden into the database, where it's implemented once, carefully.

## How It Works

### Transaction control

```sql
BEGIN;                         -- or START TRANSACTION
  … statements …
  SAVEPOINT before_items;
  … statements …
  ROLLBACK TO SAVEPOINT before_items;   -- undo only part
COMMIT;                        -- or ROLLBACK;
```

- **Autocommit**: without `BEGIN`, each statement is its own transaction (the default in most drivers and `psql`).
- In PostgreSQL, **any error aborts the transaction**: further statements fail with "current transaction is aborted" until `ROLLBACK` (or rollback to a savepoint). MySQL continues after many errors, leaving it to the application.
- DDL is transactional in PostgreSQL (you can roll back a `CREATE TABLE`); MySQL commits implicitly on most DDL.

### Atomicity: how "all or nothing" works

- During the transaction, changes are written as new row versions (PostgreSQL) or in place with undo records (InnoDB), and described in the WAL.
- On `ROLLBACK`: PostgreSQL marks the transaction aborted — its row versions become invisible instantly; InnoDB applies undo records to restore old values.
- On crash: recovery replays the WAL and treats transactions without a commit record as aborted ([Crash Recovery](lesson:db-crash-recovery)).

### Durability: what COMMIT waits for

`COMMIT` writes a commit record to the WAL and waits until the WAL is flushed (`fsync`) to stable storage. Data pages are written later. Durability thus depends on the whole chain — the database's flush, the filesystem, the disk's write cache honoring flushes, and, for high availability, replication to another machine ([Durability Chain](lesson:x-durability-chain)).

### Isolation: a spectrum, not a switch

Full isolation (serializability) is expensive, so databases default to weaker levels — PostgreSQL *Read Committed*, MySQL *Repeatable Read* — that permit certain anomalies. Choosing and understanding the level is the subject of the next lessons ([Anomalies](lesson:db-anomalies), [Isolation Levels](lesson:db-isolation-levels)).

## Internal Mechanism

:::depth{level=advanced}
### Transaction ids and commit status

PostgreSQL assigns a transaction id (xid) when a transaction first writes. Every row version records the xid that created it (`xmin`) and deleted it (`xmax`). Commit status per xid is kept in the commit log (`pg_xact`). Visibility checks consult it: a row version is visible if its creator committed before your snapshot and its deleter didn't ([MVCC](lesson:db-mvcc)). Commit is therefore cheap: flush WAL, flip two bits in the commit log.

### Group commit

Each commit needs a WAL flush (~0.05–2 ms on SSDs, up to 10 ms on disks). Under concurrency, the database flushes once for many transactions waiting at the same moment ("group commit"), so throughput scales with concurrency even though each flush is slow.

### Trading durability for speed, deliberately

- `synchronous_commit = off` (PostgreSQL): COMMIT returns before the WAL flush; a crash can lose the last ~few hundred ms of commits — but never corrupts data or breaks atomicity. Useful for low-value writes (analytics events).
- `innodb_flush_log_at_trx_commit = 2`: similar trade in MySQL.
- `fsync = off`: can **corrupt** the database on crash — never in production.
:::

## Example

An order placement touching three tables — all or nothing:

```sql
BEGIN;
INSERT INTO orders (customer_id, status, total, order_date)
VALUES (42, 'pending', 1499.00, CURRENT_DATE) RETURNING id;          -- → 9001

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
VALUES (9001, 7, 1, 1499.00);

UPDATE products SET stock = stock - 1 WHERE id = 7 AND stock > 0;     -- 0 rows? → ROLLBACK
COMMIT;
```

If the stock update affects 0 rows, the application issues `ROLLBACK` and the order and item disappear as if never inserted. If the server crashes before `COMMIT` completes, recovery discards all three changes.

## Complexity & Performance

- Commit latency ≈ WAL flush latency (plus replication round trip if synchronous replication is on).
- Long transactions cost more than their own time: they hold locks, pin old row versions (blocking vacuum → bloat) and, in InnoDB, grow undo history.
- Many tiny transactions (autocommit per row) → one flush per row; batching many rows per transaction amortizes it.

## Trade-offs

- Bigger transactions: fewer flushes and all-or-nothing semantics, but longer lock holding and more work lost on conflict/retry.
- Stronger isolation: fewer anomalies, more blocking or aborts.
- Relaxed durability: lower commit latency, bounded data loss window on crash.

## Failure Modes

- **Idle in transaction**: the app opens a transaction, then waits on a slow HTTP call or user input while holding locks and pinning snapshots. Everything behind those locks queues. Set `idle_in_transaction_session_timeout`.
- **Transactions across network calls** (call payment API inside a DB transaction): the external side effect can't be rolled back, and locks are held for the API's latency.
- **Swallowed errors**: code catches an exception mid-transaction and continues; in PostgreSQL every subsequent statement fails; in MySQL, partial work may be committed.
- **Autocommit surprises**: developers think several statements are atomic when each is committed separately.

## In Production

- Keep transactions short and free of external I/O. Do the network call before (or after, with an outbox pattern — [Distributed Transactions](lesson:db-distributed-transactions)).
- Monitor transaction age (`pg_stat_activity.xact_start`), idle-in-transaction sessions and lock waits.
- Frameworks manage transactions via decorators/annotations (`@Transactional`, `atomic()`); know where the boundary actually is and which connection it uses.

## Deeper Connections

- Atomicity + durability come from the log — the same "write intent first" idea as filesystem journaling ([Journaling](lesson:os-journaling)).
- Isolation is concurrency control — the database counterpart of mutexes and memory models ([Concurrency Everywhere](lesson:x-concurrency-everywhere)).
- Across services, ACID doesn't extend for free — sagas, outboxes and 2PC ([Distributed Transactions](lesson:db-distributed-transactions)).

## Common Misconceptions

- **"ACID means my transactions are serializable."** Most databases default to weaker isolation levels.
- **"Consistency means the database ensures my data is correct."** It enforces declared constraints; business rules you didn't declare are on you.
- **"Durable means the data is on disk when COMMIT returns."** The *log* is; data pages come later. And it's only as durable as the storage stack's flush honesty.

## Interview Questions

### [L1 · conceptual] Explain ACID.

Atomicity: a transaction's changes happen entirely or not at all. Consistency: a transaction takes the database from one valid state to another, respecting constraints (and application invariants). Isolation: concurrent transactions don't see each other's intermediate effects beyond what the isolation level allows. Durability: committed changes survive crashes, because the log is flushed to stable storage before commit returns.

### [L2 · how] How does a database implement atomicity and durability?

With a write-ahead log: every change is logged before it's applied to data pages; commit writes a commit record and flushes the log. On rollback, undo information (old versions or undo records) restores prior state or makes new versions invisible. On crash, recovery redoes logged changes of committed transactions and undoes/ignores uncommitted ones.

### [L2 · debugging] Many queries are stuck waiting on locks; `pg_stat_activity` shows a session "idle in transaction" for 40 minutes. Explain and fix.

A client began a transaction, took row or table locks (e.g., via UPDATE or SELECT … FOR UPDATE), and never committed — typically an application bug (exception path without rollback, or waiting on an external call). Its locks block other writers, and its snapshot prevents vacuum from cleaning dead rows. Immediate fix: terminate that backend (`pg_terminate_backend`). Prevention: `idle_in_transaction_session_timeout`, correct transaction scoping in code (always commit/rollback in finally blocks), no external I/O inside transactions.

### [L3 · design] Is it safe to call a payment provider's API inside a database transaction that creates the order?

No. The API call can't be rolled back if the transaction later aborts, and the transaction holds locks and a snapshot for the duration of a slow network call. Instead: create the order as 'pending' and commit; call the provider with an idempotency key; record the result in a second transaction; reconcile failures with retries or webhooks. For reliably emitting events, write them to an outbox table in the same transaction and publish asynchronously.

## Practice

### [mcq] Which ACID property is primarily the application's responsibility?

- [ ] Atomicity
- [x] Consistency (beyond declared constraints)
- [ ] Isolation
- [ ] Durability

The database enforces constraints you declare; business invariants you don't encode can be violated by correct-but-wrong application logic.

### [mcq] In PostgreSQL, a statement inside an explicit transaction fails with a unique violation. What happens to the next statement in the same transaction?

- [ ] It runs normally
- [ ] The failed statement is retried
- [x] It fails: the transaction is aborted until ROLLBACK (or rollback to a savepoint)
- [ ] The transaction commits automatically

Use savepoints if you need to recover from an expected error inside a transaction.

## Quick Revision

- Transaction = all-or-nothing, isolated, durable unit of work.
- A: undo/new versions + WAL. C: constraints + your logic. I: locks/MVCC, level-dependent. D: WAL flushed at COMMIT.
- Autocommit by default; PostgreSQL aborts the transaction on any error; savepoints for partial rollback.
- Keep transactions short; never hold them across network calls or user think time.
- Relaxed durability (async commit) loses recent commits, never consistency; fsync=off can corrupt.
