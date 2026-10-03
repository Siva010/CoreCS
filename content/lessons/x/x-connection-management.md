---
title: "Connection Management: Pools, Limits and Timeouts Across the Stack"
subject: x
level: 0
order: 3
summary: "Why connections are expensive (TCP, TLS, auth, a database process each), how pools work and how to size them with Little's law, PgBouncer and transaction pooling, keep-alive and ephemeral ports, file-descriptor limits, timeouts at every layer, and the pool-exhaustion failure pattern."
depth: core
difficulty: 3
minutes: 45
relevance: essential
stage: 3
prerequisites: [os-file-descriptors, cn-tcp-handshake, db-query-lifecycle, os-thread-pools]
related: [x-overloaded-server, x-slow-query, cn-http-connections, cn-tcp-termination, cn-proxies-load-balancers, db-redis-caching, os-epoll-event-loops]
tags: [connection pool, pool size, littles law, pgbouncer, transaction pooling, max_connections, keep alive, ephemeral ports, time_wait, file descriptors, ulimit, timeouts, connect timeout, statement timeout, pool exhaustion, connection storm]
---

## Mental Model

A connection is **an expensive, stateful pipe** between two processes — and every layer has a limited number of them. Creating one costs round trips (TCP, TLS, authentication) and resources (a file descriptor on each side, kernel buffers, and on PostgreSQL a whole backend process with its own memory). So systems **reuse** connections through **pools**, and most connection problems are about pools that are the wrong size, held too long, or exhausted.

The pool is a queue in front of a scarce resource. **Little's law** tells you how big it must be: `connections in use = throughput × time each request holds one`.

## Definition

- **Connection pool**: a set of open connections handed out to requests and returned after use.
- **Pool size / max**: the most connections the pool will open; **checkout timeout**: how long a request waits for one.
- **Server-side limits**: `max_connections` (PostgreSQL), `max_connections` (MySQL), Redis `maxclients`, OS file-descriptor limits (`ulimit -n`), ephemeral port range.
- **External pooler**: a proxy multiplexing many client connections onto few database connections (PgBouncer, pgcat, RDS Proxy, ProxySQL).
- **Pooling modes** (PgBouncer): session (a server connection per client session), **transaction** (a server connection only for the duration of a transaction), statement.
- **Keep-alive**: reusing an HTTP/TCP connection for several requests ([HTTP Connections](lesson:cn-http-connections)).
- **Little's law**: L = λ × W (items in system = arrival rate × time in system).

## Why It Exists

Opening a database connection per request would add several round trips (TCP + TLS + auth ≈ 3–5 RTT) and, for PostgreSQL, fork a process (~ms, plus several MB of memory). At hundreds of requests per second, connection setup would dominate, and thousands of simultaneous connections would exhaust memory, file descriptors and CPU (context switching, snapshot overhead). Pools amortize setup and cap concurrency.

## How It Works

### Cost of a new connection (PostgreSQL, same region)

| Step | Cost |
|---|---|
| TCP handshake | 1 RTT |
| TLS handshake | 1 RTT (TLS 1.3) |
| Startup + authentication (SCRAM) | 1–2 RTT + CPU (key derivation is deliberately expensive) |
| Backend process fork + catalog cache warm-up | ~1–5 ms, several MB RAM |

A pooled checkout costs microseconds.

### Sizing a pool with Little's law

Required connections ≈ requests per second that use the DB × seconds each request holds a connection.

- 2,000 requests/s, each holding a connection 5 ms → 2,000 × 0.005 = **10 connections** busy on average. A pool of ~20 absorbs bursts.
- Same load, but code holds the connection while calling an external API for 200 ms → 2,000 × 0.205 ≈ **410 connections**. The problem isn't the pool size; it's holding connections during unrelated work.

And the database side has its own optimum: throughput peaks when active connections ≈ a small multiple of CPU cores (plus some for I/O waits). Beyond that, extra connections add contention (locks, context switches, cache thrashing) and **reduce** throughput. A 16-core database rarely benefits from more than ~50–100 truly active connections.

### The multiplication problem

50 application instances × pool size 20 = 1,000 database connections — even though each instance is mostly idle. Autoscaling to 150 instances → 3,000 → `FATAL: sorry, too many clients already`. Solutions:

- Smaller per-instance pools, sized by Little's law.
- An **external pooler** in transaction mode: thousands of client connections share, say, 100 server connections, because a server connection is only needed *during* a transaction. Caveat: session state (session-level prepared statements, `SET`, advisory locks, `LISTEN`, temp tables) doesn't survive across transactions — use transaction-scoped equivalents.

### Timeouts at every layer

Without timeouts, one stuck dependency ties up connections forever and the whole system freezes.

| Timeout | Guards against |
|---|---|
| Pool checkout timeout | waiting forever for a connection (fail fast, return 503) |
| TCP connect timeout | unreachable host (default OS SYN retries can take ~2 minutes) |
| Statement timeout (`statement_timeout`) | runaway queries holding connections and locks |
| `idle_in_transaction_session_timeout` | leaked transactions holding locks/snapshots ([Transactions](lesson:db-transactions-acid)) |
| `lock_timeout` | long lock waits (e.g., migrations) |
| HTTP client/read timeouts | slow downstream services |
| Load balancer idle timeout | half-dead idle connections; must exceed app keep-alive assumptions correctly |

Rule: timeouts should shrink as you go deeper (edge 30 s > app 10 s > DB statement 5 s), so inner work is abandoned before the caller gives up, not after.

### Keep-alive, TIME_WAIT and ephemeral ports

Opening and closing many short outbound connections (to a database, cache or HTTP API without pooling) leaves sockets in **TIME_WAIT** for ~60 s on the side that closed first ([TCP Termination](lesson:cn-tcp-termination)). Each outbound connection to the same destination IP:port uses a distinct ephemeral port (~28,000 by default on Linux). At ~500 new connections/s you can run out: `connect: cannot assign requested address`. Keep-alive and pooling fix it.

### File descriptors

Every socket is a file descriptor ([File Descriptors](lesson:os-file-descriptors)). Default per-process limits (often 1,024 soft) are too low for servers handling many connections; raise `ulimit -n` / systemd `LimitNOFILE`. "Too many open files" (EMFILE) on accept means new connections are refused while the process may otherwise be healthy.

## Internal Mechanism

:::depth{level=advanced}
### Why PostgreSQL connections are heavyweight

Each connection is a forked process with private memory (work_mem allocations, catalog caches, prepared statements). Taking a snapshot scans the array of running transactions — O(connections) — and lock/latch contention grows with active backends. PostgreSQL 14 improved snapshot scalability substantially, but thousands of *active* connections remain inefficient; idle ones still cost memory. MySQL uses threads (lighter), with a thread pool plugin for very high counts.

### Pool behavior details

- **Validation**: pools test connections (on checkout or periodically) to discard ones killed by a failover, proxy idle timeout or network change.
- **Max lifetime**: recycle connections periodically (e.g., 30 min) so load rebalances after failovers and DNS changes, and server-side memory is released.
- **Fairness**: FIFO waiting avoids starvation; bounded wait queues avoid unbounded latency.
- **Prepared statement caches** are per connection — another reason transaction pooling needs protocol-level support (PgBouncer 1.21+ supports protocol-level prepared statements).
:::

## Example

**Pool exhaustion incident** — an e-commerce API:

1. A payment provider slows from 200 ms to 8 s.
2. The checkout handler calls it *inside* a database transaction (holding a pooled connection).
3. Little's law: 50 checkouts/s × 8 s = 400 connections needed; the pool has 40.
4. Every other endpoint (browse, search) now waits for a connection → pool checkout timeouts → 503s across the whole site, while the database itself is nearly idle.

Fix: move the external call outside the transaction (and the connection checkout), add a short timeout + circuit breaker on the provider, separate pools (bulkheads) for critical vs non-critical paths ([Overloaded Server](lesson:x-overloaded-server)).

## Complexity & Performance

- Pooled checkout: µs. New connection: ms to tens of ms.
- Database throughput vs active connections: rises until ~cores × small factor, then falls.
- Required pool size = throughput × hold time; reduce hold time before raising size.

## Trade-offs

- Bigger pools absorb bursts but can overload the database and hide slow code.
- External poolers (transaction mode) scale client counts but restrict session features and add a hop.
- Long-lived connections are efficient but stick to one backend after scaling/failover — use max lifetime.

## Failure Modes

- **Pool exhaustion** from slow queries, external calls inside transactions, or leaked connections (not returned on error paths).
- **Connection storms** after deploys/failovers: every instance reconnects at once — add jitter and backoff.
- **max_connections exceeded** from autoscaling × per-instance pools.
- **Ephemeral port exhaustion / TIME_WAIT** from not reusing connections.
- **EMFILE** from low file-descriptor limits.
- **Missing timeouts** turning a slow dependency into a full outage.

## In Production

- Metrics: pool active/idle/waiting, checkout wait time, connection creation rate, DB connection count by state (`pg_stat_activity`), errors like "too many clients", EMFILE, EADDRNOTAVAIL.
- A reasonable default: small app pools (5–20), a transaction-mode pooler in front of PostgreSQL for large fleets, explicit timeouts everywhere.

## Deeper Connections

- The pool is a bounded queue in front of a server — queueing theory applies directly ([Overloaded Server](lesson:x-overloaded-server)).
- File descriptors, TIME_WAIT and keep-alive connect the OS and TCP lessons ([File Descriptors](lesson:os-file-descriptors), [TCP Termination](lesson:cn-tcp-termination)).
- Thread pools have the same sizing logic as connection pools ([Thread Pools](lesson:os-thread-pools)).

## Common Misconceptions

- **"More connections = more database throughput."** Past a point, fewer active connections do more work.
- **"The pool is too small" is the usual root cause.** Usually connections are held too long.
- **"Idle connections are free."** They cost memory, file descriptors and (for PostgreSQL) processes.

## Interview Questions

### [L2 · why] Why use a database connection pool?

Creating a connection costs several network round trips (TCP, TLS, authentication) and server resources (a process or thread and memory per connection). A pool keeps a bounded set of open connections for reuse, making checkout nearly free and capping the concurrency the database sees, which protects its throughput.

### [L2 · numerical] An API handles 1,500 requests/s; each request holds a DB connection for 20 ms. What pool size is needed on average, and what would you configure?

:::answer
Little's law: 1,500 × 0.020 = **30** connections in use on average. Configure headroom for bursts and variance (e.g., 40–50 total across instances), check that it fits the database's max_connections and core count, and first try to reduce hold time (shorter transactions, no external calls while holding a connection).
:::

### [L3 · incident] During a partner API slowdown, your entire site returned 503s although the database was idle. Explain.

Handlers held pooled database connections (or worker threads) while waiting on the slow partner API, so hold time exploded; by Little's law the pool needed far more connections than it had. All requests — including unrelated ones — queued for connections and timed out. Fixes: don't hold connections across external calls, set tight timeouts and circuit breakers on the partner, and isolate pools per dependency (bulkheads).

### [L3 · design] You're autoscaling to 200 app pods against a PostgreSQL primary with max_connections = 500. Design the connection setup.

Per-pod pools must be small (Little's law per pod) but 200 × even 5 = 1,000 > 500. Put a transaction-mode pooler (PgBouncer/pgcat, highly available) between pods and the database with a server pool sized near the database's optimum (~2–4× cores), let pods connect to the pooler, avoid session-level features, add connection jitter/backoff for deploy storms, and route read-only traffic to replicas with their own pools.

## Practice

### [numeric 40] A service handles 400 requests/s and each request holds a database connection for 100 ms. On average, how many connections are in use?

:::answer
L = λ × W = 400/s × 0.1 s = **40** connections.
:::

### [mcq] Which error most directly indicates ephemeral port exhaustion on a client making many short outbound connections?

- [ ] ECONNREFUSED
- [x] EADDRNOTAVAIL ("cannot assign requested address")
- [ ] EMFILE ("too many open files")
- [ ] ETIMEDOUT

The kernel has no free local port for another connection to the same destination; reuse connections.

## Quick Revision

- Connections are expensive (RTTs + process/memory); pools reuse and cap them.
- Pool size ≈ throughput × hold time (Little's law); fix hold time before growing pools.
- DB throughput peaks at a modest number of active connections; use external transaction-mode poolers for large fleets.
- Timeouts at every layer, decreasing inward; max lifetime + validation for pooled connections.
- Watch for pool exhaustion, connection storms, max_connections, TIME_WAIT/ephemeral ports, EMFILE.
