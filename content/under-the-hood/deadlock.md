---
title: "What Happens When Two Transactions Deadlock"
summary: "Two transfers lock the same accounts in opposite order. Follow the lock waits, the deadlock timeout, the waits-for graph search, the choice of a victim, the error your application receives, and the retry that completes the job."
subjects: [db, os]
order: 16
related: [db-locking, os-deadlocks, os-deadlock-handling, db-transactions-acid, db-optimistic-pessimistic]
---

T1 transfers ₹100 from account 1 to account 2. T2 transfers ₹50 from account 2 to account 1. Both start at the same moment.

## [db] T1 locks row 1

`UPDATE accounts SET balance = balance - 100 WHERE id = 1;` — T1 writes a new version of row 1 and holds its row lock (via its xid in the tuple's `xmax`).

## [db] T2 locks row 2

`UPDATE accounts SET balance = balance - 50 WHERE id = 2;` — T2 holds row 2.

## [locks] T1 waits for T2

T1: `UPDATE … WHERE id = 2` finds row 2 locked by T2 (xmax = T2's xid, still running). T1 requests a share lock on **T2's transaction id** — the way PostgreSQL waits for a row lock — and sleeps ([Locking](lesson:db-locking)).

## [locks] T2 waits for T1

T2: `UPDATE … WHERE id = 1` finds row 1 locked by T1 and waits on T1's xid. Now T1 waits for T2 and T2 waits for T1: a **cycle** in the waits-for graph. All four Coffman conditions hold ([Deadlocks](lesson:os-deadlocks)).

## [locks] deadlock_timeout expires

Checking for deadlocks on every wait would be expensive, so PostgreSQL only runs detection after a waiter has slept for `deadlock_timeout` (default 1 s). T1 started waiting first, so its timer fires first: it wakes and searches the waits-for graph starting from itself.

## [locks] Cycle found — choose a victim

The search finds T1 → T2 → T1. The transaction running the check aborts itself (in PostgreSQL the detector is the victim; other systems choose by cost, e.g., least work done). T1's locks — including its lock on row 1 — are released ([Deadlock Handling](lesson:os-deadlock-handling)).

## [app] The victim's application sees an error

```text
ERROR:  deadlock detected
DETAIL: Process 812 waits for ShareLock on transaction 5102; blocked by process 815.
        Process 815 waits for ShareLock on transaction 5101; blocked by process 812.
SQLSTATE: 40P01
```

T1's whole transaction is rolled back — including its debit of account 1.

## [db] The survivor proceeds

With T1's lock on row 1 gone, T2's wait ends: it updates row 1 and commits. Its transfer is complete.

## [app] Retry — and prevent

The application catches 40P01 and retries T1 from the beginning; it succeeds now. The real fix removes the cycle: always lock accounts in ascending id order (`SELECT … WHERE id IN (1, 2) ORDER BY id FOR UPDATE`), so both transfers wait on row 1 first and can never deadlock ([Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).
