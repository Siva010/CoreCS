---
title: "Autoscaling Into “Too Many Clients”"
subject: x
summary: "A traffic spike triggered autoscaling from 40 to 160 pods. Each pod opened a 20-connection pool, the database hit max_connections, and new pods crash-looped — every restart making the connection storm worse. A transaction-mode pooler fixed the architecture."
difficulty: 3
concepts: [x-connection-management, x-overloaded-server, os-file-descriptors, db-query-lifecycle]
tags: [max_connections, autoscaling, connection storm, pgbouncer, transaction pooling, crash loop, jitter]
order: 11
---

## Context

A Node.js API on Kubernetes (HPA scaling on CPU, 40–200 pods) talking directly to PostgreSQL (`max_connections = 800`, 32 vCPU). Each pod creates a pool with `min = 20, max = 20` connections at startup and fails readiness until the pool is full.

## Symptoms

- Marketing email at 10:00 → traffic ×3 → HPA scales to 160 pods.
- New pods log `FATAL: sorry, too many clients already` and crash-loop.
- Existing pods' latency rises sharply; the database CPU jumps to 90% with low query throughput.

## Metrics

| Metric | Before | During |
|---|---|---|
| Pods | 40 | 160 (many CrashLoopBackOff) |
| DB connections (pg_stat_activity) | 800 (40 × 20) | 800 (capped) + rejected attempts |
| New connection attempts/s | ~0 | ~900 |
| DB CPU | 30% | 90% (mostly authentication and process forking) |
| Active (non-idle) connections | 25 | 60 |

Only ~60 connections were ever *active*; the rest sat idle in pools.

## Hypotheses

1. Connection limit reached because pools × pods > max_connections.
2. Reconnect storm (crash loops + retries without backoff) burning DB CPU on connection setup.
3. Actual query load too high → contradicted by the small number of active sessions.

## Investigation

Arithmetic: 160 pods × 20 = 3,200 desired connections vs 800 allowed. Each crash-looping pod attempted 20 connections on every restart, and each successful connection forked a backend process and ran SCRAM authentication — expensive CPU work that produced no queries. Idle connections consumed memory (~10 MB each with caches), pushing the database toward swapping.

Little's law per pod: ~40 req/s × 5 ms DB time ≈ 0.2 connections needed. Pools of 20 were 100× oversized.

## Root Cause

Per-instance connection pools multiplied by autoscaled instance counts exceeded the database's connection capacity. Aggressive reconnect behavior turned the limit into a storm that spent database CPU on connection setup ([Connection Management](lesson:x-connection-management)).

## Fix

1. Immediate: paused autoscaling at 60 pods and reduced pool max to 5 via config; storm subsided.
2. Deployed PgBouncer (transaction mode, HA pair): pods connect to PgBouncer (cheap), PgBouncer holds 120 server connections to PostgreSQL. Migrated off session-level features (session prepared statements → protocol-level support, `SET` → `SET LOCAL`).
3. Pods: `min = 0, max = 5`, lazy connection creation, exponential backoff with jitter on connection failures; readiness no longer requires a full pool.

## Prevention

- Capacity rule: (max pods × pool max) must fit the pooler's client limit, and the pooler's server pool must fit the database's optimum.
- Alert on connection counts by state and on connection-creation rate.
- Load test scale-out events, not only steady load.

## Interview Angle

Tests whether you know that stateless app tiers scale easily but stateful dependencies don't — and that connections are the coupling. Explain the multiplication, why idle connections are costly for PostgreSQL, why transaction pooling helps (and its caveats), and why backoff with jitter matters during storms ([Overloaded Server](lesson:x-overloaded-server)).
