---
title: "Tail Latency: Percentiles, P99, Fan-Out Amplification and Hedged Requests"
subject: cn
level: 10
order: 2
summary: "Why averages lie, how to read p50/p95/p99, why the tail dominates user experience in fan-out systems, where tail latency comes from, and the techniques that tame it."
depth: advanced
difficulty: 4
minutes: 40
relevance: high
stage: 3
prerequisites: [cn-latency-bandwidth, os-performance-method]
related: [cn-tcp-reliability, x-overloaded-server, os-profiling-observability, db-replication]
labs: [network-calculator]
tags: [tail latency, percentiles, p50, p95, p99, p999, fan-out, hedged requests, coordinated omission, histograms, slo, gc pauses, queueing]
---

## Mental Model

Averages describe a **typical** request; users experience **distributions**. If 1 in 100 requests takes 1 second, then:

- a user loading a page that makes 50 backend requests hits at least one slow request **~40% of the time**;
- a service that fans out each request to 100 shards is slow **~63%** of the time.

At scale, the **tail becomes the common case**. That's why engineers talk in percentiles (p50, p99, p99.9) and why tail latency, not average latency, drives architecture decisions.

## Definition

- **Percentile pN**: the value below which N% of observations fall. p50 = median; p99 = 99% of requests were faster than this.
- **Tail latency**: the high percentiles (p99, p99.9, max).
- **Fan-out**: one request depending on many parallel sub-requests; overall latency = the **slowest** sub-request.
- **SLO**: a service-level objective, e.g., "p99 < 300 ms over 30 days".

## Why It Exists

Latency distributions in real systems are long-tailed: most requests are fast, but queueing, garbage collection, retransmissions, cache misses, lock contention and noisy neighbors produce occasional very slow ones. In distributed systems, those occasional delays compound.

## How It Works

### Why averages mislead

Latencies for 10 requests (ms): 10, 11, 10, 12, 10, 11, 10, 12, 11, **900**.

- Mean = 99.7 ms (describes no actual request).
- p50 = 11 ms, p90 ≈ 12 ms, max = 900 ms.

The mean is dragged by one outlier yet hides how bad that outlier is. Percentiles describe both halves honestly.

### Fan-out amplification

If each sub-request independently exceeds threshold T with probability q, the chance at least one of n does is:

```text
P(slow) = 1 − (1 − q)^n
```

| Per-request slow probability q | n = 1 | n = 10 | n = 100 |
|---|---|---|---|
| 1% (p99 exceeded) | 1% | 9.6% | **63.4%** |
| 0.1% (p99.9 exceeded) | 0.1% | 1% | 9.5% |

So a service fanning out to 100 leaves needs each leaf's **p99.9** to be good for the overall **p90** to be good. ("The Tail at Scale", Dean & Barroso, 2013.)

### Where the tail comes from

| Source | Mechanism |
|---|---|
| Queueing | Bursty arrivals near saturation → waiting time explodes ([Performance Fundamentals](lesson:os-performance-method)) |
| TCP retransmission timeouts | A lost packet costing ≥ 200 ms RTO ([TCP Reliability](lesson:cn-tcp-reliability)) |
| Garbage collection / JIT / page faults | Pauses stop the whole process |
| Lock contention | Occasional long waits behind a holder |
| Cache misses | Cold cache → DB/disk path is 10–100× slower |
| Background work | Compaction, log rotation, backups, checkpoints |
| Noisy neighbors | Shared CPU, disk, network on multi-tenant hosts; CPU throttling in containers |
| Head-of-line blocking | One slow request blocking others on a connection or queue |
| Retries | Timeout + retry adds the full timeout to a request's latency |

## Internal Mechanism

### Techniques to tame the tail

- **Hedged requests**: send the request to one replica; if no response within, say, the p95 latency, send a second copy to another replica and use whichever answers first. Adds ~5% load, cuts p99.9 dramatically. Only for idempotent reads.
- **Tied requests**: send to two replicas at once with cross-cancellation when one starts executing.
- **Timeouts with budgets**: deadlines that shrink as a request travels, so no layer waits longer than the caller.
- **Reduce variability at the source**: tune GC (or use low-pause collectors), avoid lock hot spots, pre-warm caches, pace background work, isolate noisy neighbors, keep utilization below the knee.
- **Micro-partitioning and load balancing** by least-outstanding-requests or power-of-two choices to avoid slow nodes.
- **Degraded responses**: return partial results when some shards are slow (search engines do this).
- **Admission control / load shedding**: reject early instead of queueing when overloaded ([Overloaded Servers](lesson:x-overloaded-server)).

:::depth{level=advanced}
### Measuring correctly

- **Don't average percentiles** across hosts or time windows — p99 of the union isn't the average of p99s. Aggregate **histograms** (HDR histograms, Prometheus histogram buckets) and compute percentiles from merged distributions.
- **Coordinated omission**: closed-loop load generators stop sending while the server stalls, hiding the stall's true impact on users. Use constant-arrival-rate load generation and correct for intended send times ([Performance Fundamentals](lesson:os-performance-method)).
- Percentiles need enough samples: a p99.9 from 1,000 requests is one data point.
:::

## Example

An API's latency dashboard:

| Percentile | Before | After deploy |
|---|---|---|
| p50 | 18 ms | 17 ms |
| p95 | 45 ms | 48 ms |
| p99 | 90 ms | 310 ms |
| p99.9 | 180 ms | 1,250 ms |

Median unchanged, tail exploded. Typical causes: a new synchronous dependency with occasional slow responses, a larger heap causing longer GC pauses, or a code path that sometimes misses cache. Break it down with traces of slow requests (tail-based sampling) rather than averages.

## Visualization

Use the calculator to see how loss and RTT feed into transfer time — the raw material of network-driven tail latency:

::lab{id=network-calculator}

## Complexity & Performance

- Fan-out raises the effective percentile you must control: with n sub-calls, control each at roughly p(1 − 1/(100n)) for the aggregate p99.
- Hedging costs extra load (bounded by the hedge threshold) for large tail reductions.

## Trade-offs

- Hedging/replication: lower tail vs extra load and complexity (only idempotent operations).
- Tight timeouts: bounded latency vs more errors/retries.
- Running at low utilization: short tails vs cost.

## Failure Modes

- Alerting on averages → tail regressions ship unnoticed.
- Retry storms: timeouts + retries during slowdowns multiply load and lengthen the tail.
- Hidden serialization: a synchronized logger or connection pool making occasional requests wait.
- Averaging percentiles across instances in dashboards.

## In Production

- SLOs on p95/p99 per endpoint; histograms in metrics; exemplars linking slow buckets to traces.
- Case study: [Packet Loss and P99](case:packet-loss).

## Deeper Connections

- Queueing theory behind the tail ([Performance Fundamentals](lesson:os-performance-method)); overload behavior ([Overloaded Servers](lesson:x-overloaded-server)); read replicas enabling hedged reads ([Replication](lesson:db-replication)).

## Common Misconceptions

- **"If average latency is good, users are happy."** Many users hit the tail, especially on multi-request pages.
- **"p99 means 1% of users are affected."** With multiple requests per user session, far more users see p99-level delays.
- **"You can average p99s across servers."** Percentiles don't average; merge histograms.

## Interview Questions

### [L1 · conceptual] What does p99 latency mean and why is it more useful than average latency?

99% of requests complete faster than the p99 value; 1% are slower. Latency distributions are skewed, so averages hide outliers and describe no real request. Percentiles show both typical (p50) and worst-case-ish (p99, p99.9) experience, which matter because users make many requests and fan-out systems depend on the slowest component.

### [L2 · numerical] A request fans out to 50 shards in parallel; each shard exceeds 100 ms 1% of the time independently. What fraction of requests exceed 100 ms?

1 − 0.99⁵⁰ ≈ 1 − 0.605 = **~39.5%**.

### [L3 · how] What are hedged requests and when should you use them?

After waiting for a short delay (e.g., the p95 latency), send a duplicate request to another replica and use the first response, cancelling the other. It dramatically reduces tail latency at a small cost in extra load. Use only for idempotent, side-effect-free operations (reads), and bound the hedge rate to avoid amplifying overload.

### [L4 · incident] Your service's p99 latency increased while p50, CPU and error rate are unchanged, and network packet loss increased slightly. How would you investigate?

Suspect TCP retransmission timeouts: a small loss rate barely affects medians but adds ≥ 200 ms RTO stalls (plus backoff) to affected requests. Check retransmission and timeout counters per host and path (nstat, ss -ti, tcpretrans), correlate slow traces with retransmits, localize the loss (mtr per hop, specific AZ/rack/NIC, LB), check MTU/fragmentation issues and NIC errors (ethtool -S), and confirm by packet capture on slow requests. Mitigate by fixing the lossy component, enabling tail-loss probing/RACK, hedging idempotent calls, and avoiding cross-zone paths.

## Practice

### [numeric 63.4 ±0.5 unit=%] Each of 100 parallel sub-requests exceeds its latency target with probability 1%. What is the probability (in %) that the overall request exceeds the target?

:::answer
1 − 0.99¹⁰⁰ ≈ 1 − 0.366 = **63.4%**.
:::

### [mcq] Which is the correct way to compute a fleet-wide p99 from 20 servers?

- [ ] Average the 20 servers' p99 values
- [ ] Take the maximum p99
- [x] Merge the latency histograms, then compute the percentile
- [ ] Take the median of the p99 values

Percentiles aren't additive.

## Quick Revision

- Use percentiles (p50/p95/p99/p99.9), not averages; percentiles don't average — merge histograms.
- Fan-out: P(slow) = 1 − (1 − q)^n → at scale the tail is the common case.
- Sources: queueing, RTOs, GC, locks, cache misses, background work, noisy neighbors, retries.
- Fixes: hedged/tied requests (idempotent), deadlines, reduce variability, low utilization, load shedding, partial results.
- Beware coordinated omission.
