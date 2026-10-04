---
title: "Concurrency Anomalies: What Goes Wrong Without Full Isolation"
subject: db
level: 10
order: 1
summary: "Dirty reads, dirty writes, non-repeatable reads, phantoms, lost updates, read skew and write skew — each shown as a two-transaction timeline, with the real bug it causes and the mechanism that prevents it."
depth: core
difficulty: 3
minutes: 40
relevance: essential
stage: 2
prerequisites: [db-transactions-acid]
related: [db-isolation-levels, db-locking, db-mvcc, db-optimistic-pessimistic, os-race-conditions, x-concurrency-everywhere]
visualizations: [isolation]
labs: [isolation]
tags: [anomalies, dirty read, dirty write, non repeatable read, phantom read, lost update, read skew, write skew, serialization anomaly, race condition, interleaving]
---

## Mental Model

Concurrent transactions are **threads sharing memory** — the database is the shared memory ([Race Conditions](lesson:os-race-conditions)). Each anomaly is a specific bad interleaving, a way the result differs from running the transactions one after another (serially).

The gold standard is **serializability**: whatever the interleaving, the outcome equals *some* serial order. Weaker isolation levels permit some anomalies in exchange for less blocking. To choose a level you must know exactly which anomalies you're accepting.

## Definition

| Anomaly | What happens | One-line example |
|---|---|---|
| **Dirty write** | T2 overwrites T1's uncommitted write | two transfers interleave writes on the same rows; rollback becomes impossible to define |
| **Dirty read** | T2 reads T1's uncommitted write; T1 rolls back | T2 shipped an order whose payment was rolled back |
| **Non-repeatable read** (fuzzy read) | T1 reads a row twice and gets different values because T2 committed an update in between | a report computes totals from two reads of the same balance |
| **Phantom read** | T1 re-runs a range query and sees new/removed rows committed by T2 | "count of bookings for room 5 today" changes within T1 |
| **Lost update** | T1 and T2 both read x, both write x based on what they read; one update vanishes | two stock decrements, one lost |
| **Read skew** | T1 reads related items at different times, seeing an inconsistent combination | sees A after a transfer but B before it: money looks missing |
| **Write skew** | T1 and T2 read an overlapping set, each checks a condition, then write *different* rows, jointly violating the condition | two doctors both go off call; nobody is on call |

## Why It Exists

**The problem.** Running transactions strictly one at a time would be trivially correct and hopelessly slow. Databases interleave them; every interleaving that isn't equivalent to a serial one is a potential bug.

**Why name them.** "Isolation" is too vague to choose between options. Naming the anomalies gives us a vocabulary to state what each isolation level guarantees ([Isolation Levels](lesson:db-isolation-levels)) — and to recognise which one your bug actually is.

:::callout[That's all it is]{type=insight}
An anomaly is a result you could never get if transactions ran one after another. Each has a short story: reading someone's uncommitted change, a value changing under you, rows appearing, two writers overwriting each other, or two transactions each breaking a rule the other was checking.
:::

## How It Works

Timelines below: time flows downward; `R(x)` = read, `W(x)` = write.

### Dirty read

```text
T1: W(balance = 0)                 -- not committed
T2:                 R(balance) → 0  -- sees uncommitted data, declines a payment
T1: ROLLBACK                       -- balance was never 0
```

Prevented at Read Committed and above (all mainstream defaults). PostgreSQL never allows dirty reads, even at "Read Uncommitted".

### Non-repeatable read

```text
T1: R(price of item 7) → 100
T2:                         W(price = 120); COMMIT
T1: R(price of item 7) → 120      -- same query, different answer
```

Allowed at Read Committed (each *statement* gets a fresh snapshot). Prevented at Repeatable Read / Snapshot Isolation (one snapshot for the whole transaction).

### Phantom

```text
T1: SELECT count(*) FROM bookings WHERE room = 5 AND day = '2024-06-01' → 0
T2:        INSERT INTO bookings (room, day) VALUES (5, '2024-06-01'); COMMIT
T1: SELECT count(*) … → 1          -- a "phantom" row appeared
```

The difference from a non-repeatable read: no existing row changed; the **set** matching a predicate changed. Preventing it requires locking or validating *ranges/predicates*, not just rows.

### Lost update — the most common production anomaly

```text
T1: R(stock) → 10
T2: R(stock) → 10
T1: W(stock = 9);  COMMIT
T2: W(stock = 9);  COMMIT        -- two items sold, stock decreased by one
```

This is the application-level read-modify-write race: values computed in application code from an earlier read and written back. Fixes: atomic updates (`SET stock = stock - 1`), `SELECT … FOR UPDATE`, optimistic version checks, or an isolation level that detects it (PostgreSQL Repeatable Read aborts T2 with a serialization error) ([Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).

### Read skew

```text
-- Invariant: A + B = 1000. T2 transfers 100 from A to B.
T1: R(A) → 500
T2:            W(A = 400); W(B = 600); COMMIT
T1: R(B) → 600          -- T1 sees A + B = 1100: an impossible state
```

Each read was of committed data, but from different moments. Snapshot isolation prevents it: T1 would see B = 500 from its snapshot.

### Write skew — the anomaly snapshots don't prevent

Every anomaly above involves two transactions touching the *same* row. Write skew is the sneaky one: they touch *different* rows, so nothing looks like a conflict. Invariant: at least one doctor on call. Alice and Bob are both on call; both want to leave.

```text
T1 (Alice): SELECT count(*) FROM doctors WHERE on_call → 2   -- ok to leave
T2 (Bob):   SELECT count(*) FROM doctors WHERE on_call → 2   -- ok to leave
T1:         UPDATE doctors SET on_call = false WHERE name = 'Alice'; COMMIT
T2:         UPDATE doctors SET on_call = false WHERE name = 'Bob';   COMMIT
-- nobody is on call
```

Each transaction saw a consistent snapshot and wrote a **different** row, so there was no write–write conflict to detect. Snapshot isolation (PostgreSQL Repeatable Read, Oracle "Serializable") allows this. Only true Serializable (SSI or strict 2PL with predicate locks), or explicit locking of the rows read (`SELECT … FOR UPDATE` on the on-call doctors), or a constraint that captures the invariant, prevents it.

Other write-skew bugs: double-booking a meeting room (each checks "no overlapping booking", each inserts one), usernames claimed twice without a unique constraint, overspending a budget split across rows.

::viz{id=isolation}

## Internal Mechanism

:::depth{level=advanced}
### Serializability, formally

A schedule (interleaving) is **conflict-serializable** if it can be transformed into a serial schedule by swapping adjacent non-conflicting operations. Two operations conflict if they're from different transactions, touch the same item and at least one is a write (RW, WR, WW). Build a **precedence graph** with an edge T1 → T2 for each conflict where T1's operation comes first: the schedule is conflict-serializable **iff the graph has no cycle**.

Write skew in graph terms: T1 reads what T2 writes (T1 →rw T2) and T2 reads what T1 writes (T2 →rw T1) — a cycle of two **read-write anti-dependencies**. Serializable Snapshot Isolation detects exactly this "dangerous structure" and aborts one transaction ([Isolation Levels](lesson:db-isolation-levels)).

### Why the SQL standard's definitions are incomplete

The ANSI SQL-92 levels are defined by three phenomena (dirty read, non-repeatable read, phantom). Berenson et al. ("A Critique of ANSI SQL Isolation Levels", 1995) showed this misses dirty writes, lost updates, read skew and write skew, and that snapshot isolation satisfies the standard's "Repeatable Read" description while still allowing write skew. That's why vendors' levels with the same names behave differently.
:::

## Example

A seat-booking service, Repeatable Read (snapshot), no unique constraint:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT 1 FROM seat_bookings WHERE show_id = 7 AND seat = 'C12';   -- none
INSERT INTO seat_bookings (show_id, seat, user_id) VALUES (7, 'C12', $user);
COMMIT;
```

Two users run this concurrently: both see no booking, both insert — two rows for the same seat (write skew on a *phantom*). Robust fix: `UNIQUE (show_id, seat)` — the constraint turns the race into a unique violation for the loser. Constraints are the cheapest serializability you can buy for invariants they can express.

Replay the classic anomalies step by step in the [Isolation lab](lab:isolation).

## Complexity & Performance

Preventing more anomalies costs more coordination: more locks held longer (blocking), or more validation (aborts and retries). The cost appears only under contention — transactions that touch disjoint data rarely pay it.

## Trade-offs

- Accept an anomaly when it can't happen in your access pattern or is harmless (read-only reports tolerating slight skew).
- Prevent it locally (atomic updates, row locks, constraints) rather than raising isolation for the whole application.
- Or use Serializable and handle retries — simplest reasoning, some throughput cost under contention.

## Failure Modes

- Lost updates in read-modify-write code paths (counters, balances, inventory, JSON documents edited in application memory).
- Write skew in "check then insert" logic (bookings, quotas, uniqueness without constraints).
- Reports mixing values from different moments at Read Committed.
- Believing "Repeatable Read" means serializable because of the name.

## In Production

- Most concurrency bugs surface only under load or at scale, rarely in tests. Code review should flag every "read, decide in code, write" sequence and ask what happens if two run at once.
- Serialization failures (SQLSTATE `40001`) and deadlocks (`40P01`) are expected under strong isolation — applications must retry the whole transaction.

## Deeper Connections

- These are the same race conditions as in multithreaded code, with rows instead of variables ([Race Conditions](lesson:os-race-conditions), [Concurrency Everywhere](lesson:x-concurrency-everywhere)).
- Distributed systems generalize them into consistency models ([Consistency Models](lesson:db-consistency-models)).

## Common Misconceptions

- **"Transactions prevent race conditions."** Only at the isolation level you choose; defaults allow several anomalies.
- **"Snapshot isolation is serializable."** It still allows write skew.
- **"Phantoms and non-repeatable reads are the same."** Non-repeatable: an existing row changed. Phantom: the set of rows matching a predicate changed.

## Interview Questions

### [L1 · compare] Dirty read vs non-repeatable read vs phantom read?

Dirty read: reading another transaction's uncommitted changes (which may roll back). Non-repeatable read: re-reading the same row within a transaction returns a different committed value because another transaction updated it. Phantom read: re-running a range/predicate query returns a different set of rows because another transaction inserted or deleted matching rows.

### [L2 · scenario] Two requests increment a `likes` counter by reading it in application code and writing back `likes + 1`. Under load, counts are too low. Explain and fix.

A lost update: both read the same value, both write value + 1, one increment is lost. Fix with an atomic in-database update (`UPDATE posts SET likes = likes + 1 WHERE id = $1`), a row lock (`SELECT … FOR UPDATE` before computing), or optimistic concurrency with a version check and retry. For extremely hot counters, shard the counter or aggregate increments asynchronously.

### [L3 · conceptual] What is write skew, and why doesn't snapshot isolation prevent it?

Two transactions read overlapping data, each makes a decision based on what it read (e.g., "someone else is still on call"), then each writes a different row, together violating an invariant. Snapshot isolation only detects write–write conflicts on the same rows; since the writes are disjoint and each read saw a consistent snapshot, both commit. Prevention: serializable isolation (SSI detects the read-write dependency cycle), locking the rows read with SELECT … FOR UPDATE, materializing the conflict into a single row both must update, or a constraint.

## Practice

### [mcq] T1 reads rows WHERE amount > 100 (3 rows). T2 inserts a row with amount 500 and commits. T1 repeats the query and gets 4 rows. Which anomaly?

- [ ] Dirty read
- [ ] Lost update
- [x] Phantom read
- [ ] Write skew

The set of rows matching the predicate changed.

### [mcq] Which anomaly can occur under snapshot isolation?

- [ ] Dirty read
- [ ] Non-repeatable read
- [ ] Lost update (on the same row, with first-updater-wins)
- [x] Write skew

Snapshots prevent the others; disjoint writes based on overlapping reads slip through.

## Quick Revision

- Serializable = equivalent to some serial order. Anomalies = interleavings that aren't.
- Dirty write/read (uncommitted data), non-repeatable read (row changed), phantom (predicate set changed).
- Lost update (read-modify-write race), read skew (inconsistent combination), write skew (disjoint writes from overlapping reads).
- Snapshot isolation prevents all but write skew (and some phantom-based write skew).
- Fix locally: atomic updates, FOR UPDATE, constraints — or use Serializable with retries.
