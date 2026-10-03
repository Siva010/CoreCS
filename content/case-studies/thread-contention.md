---
title: "A Global Lock Hidden in the Logger"
subject: os
summary: "A service plateaued at 35% CPU no matter how much load it received. Thread dumps showed hundreds of threads blocked on one monitor inside a synchronous logging appender that wrote to a slow network file system."
difficulty: 3
concepts: [os-sync-primitives, os-race-conditions, os-cpu-caches-contention, x-concurrency-everywhere, os-io-models]
tags: [lock contention, thread dump, blocked threads, logging, synchronous io, throughput plateau, async logging]
order: 23
---

## Context

A Java API on 8-core hosts with a 200-thread request pool. After a logging change (adding request/response logging for an audit), throughput stopped scaling.

## Symptoms

- Throughput plateaus at ~1,100 req/s per host; beyond that, latency rises steeply.
- CPU never exceeds ~35%; database and downstream services are healthy.
- Adding hosts helps linearly, but each host is "underused".

## Metrics

| Metric | Value |
|---|---|
| CPU utilization | 30–35% |
| Threads RUNNABLE / BLOCKED / WAITING | 12 / 170 / 18 |
| Disk / network | log volume on NFS: write latency 3–8 ms |
| Lock profiler top monitor | `ch.qos.logback.core.OutputStreamAppender` lock — 91% of blocked time |

Low CPU + high latency + threads blocked = **contention** or **waiting**, not a lack of CPU ([Performance Method](lesson:os-performance-method)).

## Hypotheses

1. Lock contention on a shared resource.
2. Thread pool too small → no: most threads exist but are blocked.
3. Slow downstream → traces show time spent inside logging calls.

## Investigation

Three thread dumps 5 s apart (`jstack`) showed the same pattern: ~170 threads `BLOCKED (on object monitor)` waiting to enter the appender's `synchronized` write; one thread inside it, in `FileOutputStream.write` → `fsync`-like flush to an NFS mount.

The appender serializes all log writes (for ordering). Most writes returned quickly, but it flushed its buffer to the NFS mount every few KB — 3–8 ms while holding the lock. Averaged over all writes, each one held the lock for ~0.45 ms, so the lock admitted at most 1 / 0.45 ms ≈ 2,200 log writes per second. With two log lines per request, that's ≈ 1,100 requests/s — exactly the plateau. One lock bounded throughput regardless of core count: Amdahl's law with a serialized fraction.

## Root Cause

A global lock (the logging appender's monitor) held during slow synchronous I/O serialized a highly concurrent service. CPUs idled while threads queued for the lock ([Synchronization Primitives](lesson:os-sync-primitives)).

## Fix

1. Switched to an asynchronous appender: request threads enqueue log events into a bounded ring buffer; a single background thread writes in batches ([I/O Models](lesson:os-io-models)).
2. Moved logs from NFS to local disk, shipped asynchronously by an agent.
3. Decided the policy when the buffer is full (drop DEBUG, block for AUDIT) explicitly.

Throughput per host rose to ~3,800 req/s with CPU at 75%.

## Prevention

- Never hold a lock across I/O; keep critical sections tiny.
- Include lock-contention profiling (JFR, async-profiler lock mode, `perf lock`) in performance tests.
- Treat "low CPU, high latency, many blocked threads" as the contention signature.

## Interview Angle

Shows the difference between being **CPU-bound** and **contention-bound**, and how to diagnose with thread dumps and lock profiles. Relate to Amdahl's law (the serialized fraction limits speedup) and to the general concurrency toolkit — shorten critical sections, shard locks, make work asynchronous ([Concurrency Everywhere](lesson:x-concurrency-everywhere)).
