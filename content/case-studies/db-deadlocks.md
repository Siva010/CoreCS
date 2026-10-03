---
title: "Deadlocks in the Inventory Reservation Worker"
subject: db
summary: "Two workers reserving stock for multi-item orders locked the same product rows in different orders. Under a flash sale, deadlock errors hit 4% of orders — fixed by sorting lock acquisition and retrying victims."
difficulty: 3
concepts: [db-locking, os-deadlocks, os-deadlock-handling, db-transactions-acid, db-optimistic-pessimistic]
tags: [deadlock, lock ordering, 40P01, retry, flash sale, row locks]
order: 3
---

## Context

An order pipeline reserves inventory in a single transaction per order:

```sql
BEGIN;
-- for each item in the order, in the order the customer added them to the cart:
UPDATE inventory SET reserved = reserved + $qty WHERE sku = $sku AND available - reserved >= $qty;
COMMIT;
```

Twelve worker processes consume orders from a queue in parallel.

## Symptoms

- During a flash sale, 4% of reservations fail with `ERROR: deadlock detected (SQLSTATE 40P01)`.
- Failed orders are moved to a dead-letter queue; customers see "payment captured, order failed".
- Reservation latency p99 rises to ~1.1 s.

## Metrics

| Metric | Normal | Flash sale |
|---|---|---|
| Orders/s | 15 | 400 |
| Deadlocks/min (`pg_stat_database.deadlocks`) | 0 | 950 |
| Lock waits > 1 s (log_lock_waits) | rare | thousands |
| Items per order (mean) | 1.3 | 3.8 (bundles) |

## Hypotheses

1. Inconsistent lock ordering across transactions touching overlapping SKUs.
2. Foreign-key checks or triggers taking additional locks.
3. Long transactions holding locks (external calls inside the transaction).

## Investigation

The PostgreSQL log includes the deadlock details:

```text
ERROR:  deadlock detected
DETAIL: Process 4121 waits for ShareLock on transaction 88123; blocked by process 4188.
        Process 4188 waits for ShareLock on transaction 88120; blocked by process 4121.
        Process 4121: UPDATE inventory SET reserved = … WHERE sku = 'BUNDLE-B'
        Process 4188: UPDATE inventory SET reserved = … WHERE sku = 'BUNDLE-A'
```

Order X had items [A, B]; order Y had [B, A]. Worker 1 locked A then waited for B; worker 2 locked B then waited for A — a two-transaction cycle. The flash sale's bundles put the same few SKUs in many orders in varying cart order, making cycles frequent. The 1 s p99 latency is `deadlock_timeout`: the default wait before PostgreSQL checks for a cycle.

No triggers were involved, and transactions were short — hypothesis 1 confirmed.

## Root Cause

Circular wait between transactions acquiring row locks in inconsistent order (cart order), combined with high contention on a few hot SKUs. All four Coffman conditions held ([Deadlocks](lesson:os-deadlocks)).

## Fix

1. **Consistent lock order**: sort items by SKU before updating (or lock them all at once: `SELECT … FROM inventory WHERE sku = ANY($1) ORDER BY sku FOR UPDATE`) — breaks circular wait.
2. **Retry on 40P01 and 40001** with jittered backoff, for the whole transaction (the operation is idempotent per order id).
3. Kept each transaction limited to the reservation — no other work inside.

Deadlocks dropped to zero; p99 latency fell to 40 ms (lock waits remained, but no cycles and no 1 s detection delays).

## Prevention

- A code convention: multi-row locks are always acquired in primary-key order.
- Alert on `pg_stat_database.deadlocks` rate > 0.
- For extreme hotspots, pre-split inventory into buckets (e.g., 10 rows per SKU) to reduce contention ([Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).

## Interview Angle

Classic "deadlock in production" question. Show that you (1) read the deadlock report to identify the cycle, (2) name the Coffman condition to break (circular wait → ordering), (3) keep retries because databases resolve deadlocks by aborting a victim, and (4) connect it to the OS deadlock theory — same four conditions, different resources ([Locking](lesson:db-locking)).
