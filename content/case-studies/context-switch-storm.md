---
title: "More Threads Made It Slower: A Context-Switch Storm"
subject: os
summary: "To fix latency, a team raised a CPU-bound service's thread pool from 32 to 2,000. Throughput fell 40%: context switches jumped 20×, caches went cold, and threads spent their time waiting for a shared lock and the scheduler."
difficulty: 4
concepts: [os-context-switch, os-thread-pools, os-scheduling-basics, os-cpu-caches-contention, os-sync-primitives]
tags: [context switch, thread pool sizing, run queue, cache misses, lock contention, vmstat, pidstat, throughput collapse]
order: 22
---

## Context

An image-thumbnail service on 16-core machines: each request decodes, resizes and encodes an image (CPU-bound, ~40 ms of CPU). Worker pool: 32 threads. During peaks, requests queued and p99 latency reached 900 ms. A configuration change raised the pool to 2,000 threads "so requests don't wait".

## Symptoms

- p99 latency got **worse** (2.5 s) and throughput dropped from ~390 to ~230 requests/s per machine.
- CPU utilization stayed near 100%, but with a much larger share of system time.

## Metrics

| Metric | 32 threads | 2,000 threads |
|---|---|---|
| Throughput (req/s per host) | 390 | 230 |
| CPU user / sys | 92% / 5% | 61% / 31% |
| Context switches/s (`vmstat cs`) | 45,000 | 950,000 |
| Run queue length (`vmstat r`) | 20 | 600+ |
| LLC miss rate (perf) | 8% | 27% |
| Time waiting on `metricsLock` (profiler) | negligible | 18% of wall time |

## Hypotheses

1. Oversubscription: 2,000 runnable threads on 16 cores → scheduler churn and cache thrashing.
2. Lock contention amplified by more concurrent threads.
3. Memory pressure (2,000 stacks + buffers) → some; each thread held a decode buffer.

## Investigation

- `pidstat -w -t` showed hundreds of thousands of involuntary context switches/s (preemption at time-slice end), plus voluntary switches from threads blocking on a lock.
- Every switch costs direct time (saving/restoring state, scheduler work) and indirect time: the incoming thread finds L1/L2/LLC and TLB contents belonging to someone else ([Context Switch](lesson:os-context-switch)). Image processing is cache-sensitive, so the indirect cost dominated.
- A lock profiler showed threads convoying on a global `metricsLock` (a synchronized histogram updated per request): at 32 threads it was rarely contended; at 2,000 threads it serialized them and triggered sleep/wake cycles ([Synchronization Primitives](lesson:os-sync-primitives)).
- Queueing math: throughput is capped by 16 cores × (1 s / 40 ms) = 400 req/s no matter how many threads exist; extra threads only add overhead and move the queue from the pool (cheap) into the scheduler's run queue (expensive).

## Root Cause

A CPU-bound workload's pool was sized far beyond the number of cores. Oversubscription converted queueing in the thread pool into scheduler thrashing, cold caches and lock convoys, reducing useful work per CPU cycle.

## Fix

1. Pool size back to ~cores (16–20) for the CPU-bound stage; a bounded queue in front with load shedding (503 when the queue exceeds 2 s of work) ([Thread Pools](lesson:os-thread-pools)).
2. Replaced the global metrics lock with per-thread counters (merged on scrape) — no shared cache line on the hot path ([CPU Caches](lesson:os-cpu-caches-contention)).
3. Scaled horizontally for peak capacity instead of adding threads.

Throughput returned to ~395 req/s/host; p99 at peak dropped to 600 ms with shedding protecting the tail.

## Prevention

- Size pools by workload type: CPU-bound ≈ cores; I/O-bound ≈ cores × (1 + wait/compute), or use async I/O.
- Watch context switches, run queue length and sys CPU when changing concurrency settings.
- Treat throughput per core, not just latency, as a regression metric.

## Interview Angle

Counter-intuitive results impress interviewers: explain why more threads can reduce throughput (context-switch cost, cache/TLB pollution, lock contention, memory) and how to size pools. Tie it to scheduling (run queue, time slices) and to queueing theory: capacity is set by the bottleneck resource, not by the number of workers ([Scheduling Basics](lesson:os-scheduling-basics)).
