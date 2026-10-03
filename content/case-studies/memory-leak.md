---
title: "The Service the OOM Killer Restarted Every Three Days"
subject: os
summary: "A Java service's memory grew ~1.5 GB per day until the kernel OOM killer terminated it. The cause was an unbounded in-process cache keyed by session id; the GC pauses that preceded each kill were the first visible symptom."
difficulty: 3
concepts: [os-dynamic-allocation, os-address-spaces, os-thrashing-working-set, os-profiling-observability, x-caching-everywhere]
tags: [memory leak, oom killer, rss, heap dump, gc pauses, unbounded cache, cgroups, memory limit]
order: 20
---

## Context

A JVM service in containers with a 6 GiB memory limit (cgroup), `-Xmx4g`. It enriches requests with user preferences and was recently changed to cache them "for performance".

## Symptoms

- Pods restart roughly every 60–80 hours with exit code 137.
- Hours before each restart, p99 latency climbs from 40 ms to 2–4 s in bursts.
- After restart, everything is fast again.

## Metrics

| Metric | After start | 60 h later |
|---|---|---|
| Container RSS | 1.8 GiB | 5.9 GiB |
| JVM heap used after full GC | 0.9 GiB | 3.8 GiB |
| GC time per minute | 0.3 s | 21 s |
| `oom_kill` events (cgroup memory.events) | 0 | 1 |

`dmesg` / cgroup events: `Memory cgroup out of memory: Killed process … (java)`. Exit code 137 = 128 + SIGKILL (9).

## Hypotheses

1. Heap leak: objects retained by a long-lived reference → heap-after-GC rising supports it.
2. Native memory leak (off-heap buffers, threads, JNI) → would show RSS growing faster than heap.
3. Limit too small for legitimate working set → growth is unbounded, not a plateau.

## Investigation

- **Heap vs RSS**: heap-after-GC grows in step with RSS (plus fixed overhead) → a heap leak, not native.
- **Heap dump** at 40 h (`jcmd <pid> GC.heap_dump`), analyzed for dominators: a `ConcurrentHashMap<String, UserPrefs>` held 9.6 million entries (~2.6 GB), keyed by **session id**, never evicted.
- Sessions are short-lived, so almost every entry was garbage from the application's point of view but reachable from the map — a classic logical leak.
- The latency bursts: as the live heap approached `-Xmx`, the collector ran ever more frequent full collections that freed little (GC thrashing — the heap analogue of [Thrashing](lesson:os-thrashing-working-set)).
- The kill: heap 4 GiB + metaspace + thread stacks + direct buffers + JIT code exceeded the 6 GiB cgroup limit; the kernel's OOM killer sent SIGKILL.

## Root Cause

An unbounded in-process cache keyed by a high-cardinality, short-lived key retained memory indefinitely. The application had no eviction policy; the cache grew until GC thrashing and finally the cgroup OOM killer ended the process.

## Fix

1. Replaced the map with a bounded cache (Caffeine: `maximumSize(200_000)`, `expireAfterAccess(10m)`), keyed by **user id** (the real identity of preferences) instead of session id.
2. Added cache metrics (size, evictions, hit ratio).
3. Set `-XX:MaxRAMPercentage` so heap sizing follows the container limit with headroom for non-heap memory.

RSS now plateaus at ~2.4 GiB; GC time stays under 1 s/min.

## Prevention

- Every cache must have a bound and an eviction policy ([Caching Everywhere](lesson:x-caching-everywhere)).
- Alert on heap-after-GC trend and GC time, not just container restarts.
- Load tests long enough (or accelerated) to reveal slow leaks.

## Interview Angle

"Memory grows until the process is killed" → distinguish heap vs native (RSS vs heap-after-GC), take a heap dump and find dominators, explain exit code 137 and the OOM killer, and explain why latency degrades *before* the crash (GC thrashing). Relate it to OS memory: RSS, virtual vs resident memory, cgroup limits ([Address Spaces](lesson:os-address-spaces), [Dynamic Allocation](lesson:os-dynamic-allocation)).
