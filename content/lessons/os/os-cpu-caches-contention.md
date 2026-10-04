---
title: "CPU Caches, False Sharing, Lock Contention and Context-Switch Overhead"
subject: os
level: 10
order: 2
summary: "Why multithreaded code slows down on more cores: cache coherence (MESI), false sharing, contended locks and atomics, and the context-switch tax — plus how to diagnose each."
depth: advanced
difficulty: 4
minutes: 40
relevance: medium
stage: 3
prerequisites: [os-hardware-model, os-atomic-instructions, os-performance-method]
related: [os-race-conditions, os-context-switch, os-hugepages-numa, os-profiling-observability]
tags: [cpu cache, cache line, mesi, cache coherence, false sharing, true sharing, lock contention, cache miss, locality, ipc, memory bound, context switch overhead]
---

## Mental Model

Each core has its own private notebook (L1/L2 cache), and they share a whiteboard (L3 and RAM). When one core writes a value, every other core's copy of that **page of the notebook** (a 64-byte **cache line**) must be torn out — they have to re-copy it from whoever has the latest version.

If two cores keep writing to the same line — even to **different variables** that merely happen to sit on the same line — that line ping-pongs between them hundreds of thousands of times per second. Code that looks perfectly parallel runs *slower* on eight cores than on one.

## Definition

- **Cache line**: the unit of transfer between memory levels, typically 64 bytes on x86 and many ARM cores (Apple M-series use 128 bytes).
- **Cache coherence protocol** (e.g., **MESI**: Modified, Exclusive, Shared, Invalid): hardware protocol ensuring all cores see a consistent value for each line.
- **True sharing**: multiple threads actually access the same variable (e.g., a shared counter).
- **False sharing**: threads access *different* variables that live on the same cache line, causing coherence traffic as if they were shared.
- **Lock contention**: threads frequently compete for the same lock, waiting and bouncing its cache line.

## Why It Exists

**The problem.** Private caches are necessary for speed; coherence is necessary for correctness. Put them together and every *write* to shared data must chase down and invalidate other cores' copies.

**Why it's surprising.** The cost of coherence is invisible in source code — it depends on memory layout and access patterns — so it's a common cause of "mysterious" scaling failures. Two lines of code that look independent can fight over the same 64 bytes.

**The idea for fixing it.** Coherence works at cache-line granularity, so design at cache-line granularity: give each thread's hot data its own line, write shared data rarely, and batch updates.

:::callout[That's all it is]{type=insight}
Cores keep private copies of 64-byte lines; a write by one core invalidates everyone else's copy. If several cores keep writing the same line — even different variables on it — the line bounces between them and parallel code runs slower than serial.
:::

## How It Works

### MESI in one table

| State | Meaning | On a write by this core | On a read by another core |
|---|---|---|---|
| Modified | Only copy, dirty | Write locally | Supply data, → Shared |
| Exclusive | Only copy, clean | Write locally, → Modified (no bus traffic) | → Shared |
| Shared | Several clean copies | Must invalidate others first (→ Modified) | Stay Shared |
| Invalid | Not present / stale | Must fetch with ownership | — |

A write to a line in Shared state requires a **read-for-ownership**/invalidate round-trip to all other holders: tens to hundreds of cycles — far more across sockets ([NUMA](lesson:os-hugepages-numa)).

### False sharing, concretely

The hardware doesn't know about variables; it only knows lines. So two variables that happen to be neighbours behave as if they were one shared variable.

```c
struct Counters { long a; long b; };   // a and b share one 64-byte line
struct Counters c;
// thread 1: for (...) c.a++;          // core 0 writes the line
// thread 2: for (...) c.b++;          // core 1 writes the same line
```

The threads never touch each other's data, but every increment invalidates the other core's copy. Typical slowdown vs padded layout: **several times to 10×+**.

Fix: pad or align each hot per-thread item to its own line:

```c
struct alignas(64) PaddedCounter { long value; char pad[64 - sizeof(long)]; };
struct PaddedCounter per_thread[NTHREADS];
```

Java offers `@Contended` (JDK internal/with flag) and libraries pad manually (LMAX Disruptor, `LongAdder` cells); Go's runtime pads hot structures; Linux uses `____cacheline_aligned_in_smp`.

### Contended locks and atomics

A mutex's state word is a cache line. Under contention:

1. every acquire attempt pulls the line in exclusive mode;
2. waiters that sleep need futex syscalls and wakeups (context switches);
3. the critical section runs serially — Amdahl's serial fraction ([Concurrency vs Parallelism](lesson:os-concurrency-vs-parallelism)).

Symptoms: throughput flattens or drops as threads are added; CPU shows high `%sys` (futex) or spinning; profiles show time in lock functions.

### Context-switch tax

Each switch costs ~µs directly plus cold caches/TLB for the incoming thread ([Context Switching](lesson:os-context-switch)). Oversubscribed thread pools and lock convoys multiply switches. Measure with `vmstat cs`, `pidstat -w`, `perf sched`.

## Internal Mechanism

### Locality: the other half of cache performance

- **Spatial locality**: sequential access uses every byte of each line and lets the prefetcher run ahead. Arrays of structs vs structs of arrays: if a loop touches only one field, a struct-of-arrays layout wastes no bandwidth.
- **Temporal locality**: reuse data while it's hot — blocking/tiling in matrix operations, processing a batch before moving on.
- **Pointer chasing** (linked lists, trees of small nodes, hash maps with chained buckets) defeats prefetchers — every hop can be a DRAM miss (~100 ns).

:::depth{level=advanced}
### Diagnosing with hardware counters

`perf stat -e cycles,instructions,cache-misses,LLC-load-misses ./app` gives **IPC** (instructions per cycle): > 2 means compute-efficient; < 0.5 often means memory-bound (stalled on misses). `perf c2c` ("cache to cache") specifically detects false sharing by reporting cache lines with heavy cross-core HITM (hit-modified) traffic and the code offsets touching them. Intel's top-down analysis (`perf stat --topdown` / VTune) classifies stalls as frontend, backend-memory, backend-core, bad speculation or retiring.
:::

## Example

Scaling a request counter in a web service across 32 threads:

| Implementation | Throughput (relative) |
|---|---|
| `synchronized` increment of a global long | 1× (lock contention + line bouncing) |
| `AtomicLong.incrementAndGet()` | ~3–5× (no lock, still one hot line) |
| `LongAdder` (striped, padded cells) | ~20–30× (mostly core-local lines) |
| Per-thread counter, summed on read | ~30×+ |

(Illustrative orders of magnitude; the pattern is robust across hardware.)

## Complexity & Performance

| Event | Approximate cost |
|---|---|
| L1 hit | ~1 ns |
| Line transfer between cores, same socket | ~40–80 ns |
| Line transfer across sockets | ~100–200 ns |
| DRAM miss | ~80–100 ns local, more remote |
| Uncontended lock | ~20 ns |
| Contended lock with sleep/wake | µs |

## Trade-offs

- Padding eliminates false sharing but wastes memory and can hurt locality for read-mostly data.
- Sharding (per-thread/per-CPU state) scales writes but makes reads more expensive and approximate.
- Fine-grained locking improves parallelism but increases complexity and lock overhead; coarse locks are simple but contended.

## Failure Modes

- Performance that **drops** when adding cores/threads.
- Benchmarks that look fine on a laptop (few cores, one socket) and collapse on a 2-socket server.
- Hot shared data structures (a global cache map, a metrics registry, a shared allocator arena).
- Reference counting on shared objects (`shared_ptr` copies, `Arc::clone`) creating hidden hot lines.

## In Production

- Allocators (jemalloc, tcmalloc) and runtime schedulers are designed around per-CPU/per-thread structures precisely to avoid contention.
- Databases partition hot structures (buffer pool hash partitions, lock manager partitions, WAL insertion locks in PostgreSQL) for the same reason.
- Case study: [Thread contention](case:thread-contention).

## Deeper Connections

- Atomics and memory ordering: [Atomic Instructions](lesson:os-atomic-instructions), [Race Conditions](lesson:os-race-conditions).
- Hot rows in databases are the same phenomenon one level up: many transactions updating one row serialize on its lock ([Locking](lesson:db-locking)); hot partitions in distributed systems likewise ([Sharding](lesson:db-sharding)).

## Common Misconceptions

- **"If threads don't share variables, they don't interfere."** False sharing makes adjacent variables interfere.
- **"Atomics are free, locks are expensive."** Contended atomics serialize on a cache line just like locks do.
- **"More cores = linear speedup for thread-parallel code."** Only when threads mostly touch core-local data.

## Interview Questions

### [L2 · conceptual] What is false sharing?

When threads on different cores modify different variables that happen to reside on the same cache line, the coherence protocol treats the whole line as shared: each write invalidates the other cores' copies, so the line bounces between cores, drastically slowing both threads even though they share no data logically. Fix by padding/aligning per-thread data to separate cache lines.

### [L2 · how] How does cache coherence work at a high level?

Each cache line in each core's cache has a state (e.g., MESI). Before a core writes a line, it must obtain exclusive ownership, invalidating other copies; reads of a line modified elsewhere fetch the latest data from the owner. This keeps all cores consistent at the cost of inter-core traffic for shared, written data.

### [L3 · debugging] A multithreaded aggregation job gets slower when you go from 4 to 16 threads, with CPU at 100%. How do you investigate?

Suspect contention: false sharing on per-thread accumulators, a shared atomic counter, a contended lock, or allocator contention. Use `perf c2c` to find cache lines with heavy cross-core modified hits, `perf top`/flame graphs for time in lock/atomic functions, and check IPC. Fix with per-thread accumulators padded to cache lines, sharded structures, and merging results at the end.

### [L3 · why] Why can a linked list be slower than an array by an order of magnitude for the same number of elements?

Array elements are contiguous: each cache line holds several elements and the prefetcher streams them. List nodes are scattered, so each traversal step is a dependent load that likely misses cache (~100 ns) and the prefetcher can't predict the next address.

### [L4 · design] Design a metrics library that records counters and histograms from thousands of request threads with negligible overhead.

Per-thread (or per-CPU) buffers of counters/histogram buckets, cache-line padded, updated with plain or relaxed atomic operations without locks; a background collector periodically aggregates and resets or reads cumulative values. Avoid string lookups in the hot path (pre-registered handles). Keep histograms as fixed bucket arrays (HDR-style). Accept slightly stale reads. This moves all sharing to the rare aggregation step.

## Practice

### [mcq] Two threads increment `stats.hits` and `stats.misses`, adjacent 8-byte fields in one struct. What is the most likely performance problem?

- [ ] Data race on the same variable
- [x] False sharing of one cache line
- [ ] TLB misses
- [ ] Priority inversion

Different variables, same 64-byte line.

### [mcq] A program has IPC of 0.3 and a high last-level cache miss rate. It is most likely:

- [ ] Branch-misprediction bound
- [x] Memory-bound
- [ ] I/O-bound
- [ ] Syscall-bound

Low IPC with many LLC misses means cores stall waiting on memory.

## Quick Revision

- Cache line = 64 B unit; coherence (MESI) invalidates other copies on writes.
- **True sharing** vs **false sharing** (different variables, same line) → pad/align to 64 B.
- Contended locks/atomics serialize on one line; shard (per-thread/per-CPU) and merge.
- Locality: sequential > pointer chasing; struct-of-arrays for field scans.
- Diagnose: `perf stat` (IPC, misses), `perf c2c` (false sharing), `vmstat cs`, lock profiles.
