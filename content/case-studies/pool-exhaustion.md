---
title: "A Slow Payment Provider Took Down the Whole Store"
subject: x
summary: "Checkout called a payment API while holding a database connection inside a transaction. When the provider slowed from 300 ms to 9 s, Little's law turned 40 pooled connections into a hard ceiling and every endpoint returned 503 — while the database sat idle."
difficulty: 3
concepts: [x-connection-management, x-overloaded-server, db-transactions-acid, os-thread-pools, db-distributed-transactions]
tags: [connection pool exhaustion, littles law, bulkhead, circuit breaker, timeouts, external call in transaction, cascading failure]
order: 10
---

## Context

A monolithic Java service (20 instances, each with a 200-thread request pool and a 40-connection HikariCP pool) in front of PostgreSQL. Checkout flow:

```java
@Transactional
public Order checkout(Cart cart) {
    Order o = orders.create(cart);            // DB
    PaymentResult r = payments.charge(o);     // HTTP call to provider, inside the transaction
    orders.markPaid(o, r);                    // DB
    return o;
}
```

## Symptoms

- 19:20: all endpoints (browse, search, account) start returning 503 after ~30 s.
- The database dashboard looks healthy: CPU 15%, no slow queries.
- The payment provider's status page reports "elevated latency".

## Metrics

| Metric | Normal | Incident |
|---|---|---|
| Payment API latency p50 | 300 ms | 9 s |
| Checkout requests/s (total) | 60 | 60 |
| Hikari active connections (per instance) | 3 | 40 / 40 |
| Hikari pending threads | 0 | 180 |
| Connection acquisition time p99 | 1 ms | 30 s (timeout) |
| DB: sessions `idle in transaction` | ~5 | 780 |

## Hypotheses

1. Database overloaded → contradicted by CPU and query latency.
2. Connection pool exhausted by checkout holding connections during payment calls → matches `idle in transaction` count.
3. Thread pool exhaustion → also visible (threads waiting for connections).

## Investigation

Little's law for connections needed by checkout per instance:
60 req/s ÷ 20 instances = 3 req/s per instance × (9 s payment + ~0.05 s DB) ≈ **27 connections** in use just for checkout — and bursts above that. Plus retries from clients re-submitting checkout. The pool (40) filled; every other endpoint's DB query waited for a connection, request threads piled up behind them, and the load balancer's 30 s timeout returned 503s.

`pg_stat_activity` confirmed hundreds of sessions `idle in transaction` with `wait_event = ClientRead`: transactions open while the application waited on HTTP.

## Root Cause

A remote call inside a database transaction coupled the payment provider's latency to the database connection pool, a resource shared by the whole application. With no timeout on the payment call and no isolation between features, one slow dependency exhausted the shared pool ([Connection Management](lesson:x-connection-management)).

## Fix

1. Immediate: lowered the payment client timeout to 3 s and enabled a circuit breaker returning "payment pending, we'll email you" when open.
2. Restructured checkout: transaction 1 creates the order as `PENDING` and commits; the payment call runs **without** a connection or transaction (with an idempotency key); transaction 2 records the result. Failures are reconciled via provider webhooks ([Distributed Transactions](lesson:db-distributed-transactions)).
3. Bulkheads: a separate, bounded executor for payment calls, so checkout can't consume all request threads.

## Prevention

- Rule: no network calls inside database transactions.
- Every outbound call has a timeout, a retry budget and a circuit breaker.
- Alert on pool pending threads and `idle in transaction` sessions, not only on DB CPU.

## Interview Angle

The canonical cascading-failure story: an external slowdown + a shared bounded resource + no timeouts. Use Little's law to show why the pool ran out, explain why the database looked healthy, and describe the fixes (restructure transactions, timeouts, circuit breakers, bulkheads) ([Overloaded Server](lesson:x-overloaded-server)).
