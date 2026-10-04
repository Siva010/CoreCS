---
title: "Concurrency vs Parallelism, Amdahl's Law and Why More Threads Isn't Faster"
subject: os
level: 2
order: 2
summary: "Dealing with many things at once vs doing many things at once — and the laws that cap how much speed parallelism can ever buy."
depth: core
difficulty: 3
minutes: 30
relevance: high
stage: 2
prerequisites: [os-threads]
related: [os-thread-pools, os-cpu-caches-contention, os-performance-method, os-io-models]
tags: [concurrency, parallelism, amdahl's law, gustafson, cpu-bound, io-bound, scalability, little's law]
---

## Mental Model

- **Concurrency** is about **structure**: a single barista taking orders, steaming milk and pulling shots by switching between tasks. Many tasks are *in progress* at once.
- **Parallelism** is about **execution**: three baristas working at the same time. Many tasks *execute* at the same instant.

You can have concurrency without parallelism (one core interleaving threads, a Node.js event loop), and parallelism without much concurrency (a matrix multiply split across 32 cores, each doing the same thing). Rob Pike's phrase: *concurrency is dealing with lots of things at once; parallelism is doing lots of things at once.*

## Definition

- **Concurrency**: the composition of independently progressing tasks whose lifetimes overlap. It is a property of the program's design.
- **Parallelism**: the simultaneous execution of computations on multiple processing units. It is a property of the execution.
- **Speedup** `S(N) = T(1) / T(N)` — how much faster a job finishes on N processors.

## Why It Exists

**The problem.** The two words get mixed up because they're answers to two *different* problems that look alike from far away. Two different pressures:

1. **Waiting is everywhere** — for disks, networks, users. Concurrency lets a program make progress on other tasks while one waits, even on a single core. This is why servers handle thousands of clients.
2. **Single cores stopped getting much faster** (~2005, the end of Dennard scaling). Performance growth moved to more cores. Parallelism is the only way a single job can use them.

The first is about *not sitting idle while waiting*; the second is about *doing more work per second*. Confusing them leads to the classic mistakes: adding cores to a program that's just waiting on a database (no help), or adding threads to a CPU-bound job on 4 cores (no help past 4).

:::callout[That's all it is]{type=insight}
Concurrency: many tasks started, taking turns — useful when tasks wait. Parallelism: many tasks running at the same instant — useful when tasks compute. One is how you organise the work; the other is how much hardware runs it.
:::

## How It Works

### CPU-bound vs I/O-bound

| Workload | Bottleneck | What helps | Rough thread count |
|---|---|---|---|
| **CPU-bound** (compression, image processing, JSON parsing at scale) | Cores | Parallelism: one thread per core | ≈ number of cores |
| **I/O-bound** (web handlers calling DBs and APIs) | Waiting on I/O | Concurrency: many tasks in flight | Many more than cores, or async I/O |

A useful sizing heuristic for a pool doing mixed work: `threads ≈ cores × (1 + wait_time / compute_time)`. A handler that computes 5 ms and waits 45 ms on the database: `cores × 10`.

### Amdahl's Law — the ceiling on speedup

The intuition before the formula: adding workers only speeds up the part of the job that *can* be split. The part that can't is done by one worker regardless, so it eventually becomes the whole wait. If a fraction **p** of a job can be parallelized and **(1 − p)** is inherently serial:

```text
S(N) = 1 / ((1 − p) + p / N)          and as N → ∞,  S → 1 / (1 − p)
```

| Parallel fraction p | Speedup on 8 cores | on 64 cores | Maximum possible |
|---|---|---|---|
| 50% | 1.78× | 1.97× | 2× |
| 90% | 4.7× | 8.8× | 10× |
| 95% | 5.9× | 15.4× | 20× |
| 99% | 7.5× | 39.3× | 100× |

A 5% serial portion — a single lock, a sequential merge step, one coordinator — caps the job at **20×** no matter how many cores you buy.

:::depth{level=advanced}
### Gustafson's Law — the optimistic view

Amdahl fixes the problem size. In practice, bigger machines are used for bigger problems: the parallel part grows while the serial part often stays constant. Gustafson's scaled speedup `S = N − (1 − p)(N − 1)` is closer to how HPC and data systems scale (process 10× more data in the same time). Both are true; they answer different questions.

### Beyond Amdahl: contention and coherence

Real systems do worse than Amdahl because of **contention** (waiting for shared resources) and **coherence** costs (keeping shared data consistent across cores — cache-line bouncing, cross-node chatter). Neil Gunther's **Universal Scalability Law** adds a term that grows with N²: past some point, adding workers makes throughput **go down**. This is what you see when a thread pool or cluster is "scaled up" past its optimum.
:::

## Internal Mechanism

On a single core, "concurrent" threads are interleaved by the scheduler via [context switches](lesson:os-context-switch) — no two instructions run at the same instant, but the interleaving is arbitrary, so race conditions are still possible. On multiple cores, threads run truly simultaneously and additional hazards appear: stale cached values, reordered memory operations ([Race Conditions](lesson:os-race-conditions)), and cache-line contention ([CPU Caches & Contention](lesson:os-cpu-caches-contention)).

## Example

A report job: load data (serial, 2 s), compute per-customer statistics (parallelizable, 18 s), write the result (serial, 1 s). Total 21 s, p = 18/21 ≈ 0.857.

- On 8 cores: 2 + 18/8 + 1 = **5.25 s** (4× speedup, not 8×).
- On 64 cores: 2 + 18/64 + 1 ≈ **3.28 s** (6.4×).
- Infinite cores: **3 s** (7× cap). To go faster, parallelize the load and write phases.

## Complexity & Performance

- **Throughput** (jobs/second) and **latency** (time per job) respond differently: concurrency mostly increases throughput for I/O-bound work; parallelism can reduce latency of a single CPU-bound job.
- [Little's Law](lesson:os-performance-method) connects them: `in-flight requests = throughput × latency`. To sustain 1,000 req/s at 200 ms each, you need ~200 requests in flight — i.e., ~200 concurrent tasks, whether threads or async tasks.

## Trade-offs

- More parallelism → more coordination overhead (locks, merging results, communication). Past a point, overhead exceeds gains.
- More concurrency (threads) → memory and context-switch overhead; async concurrency → code complexity.
- Parallel speedup vs **efficiency**: 64 cores giving 15× speedup is only 23% efficient — maybe fine for latency, wasteful for cost.

## Failure Modes

- **Oversubscription**: more CPU-bound threads than cores → switching overhead, cache thrash, worse throughput.
- **Hidden serialization**: a global lock, a single DB row everyone updates, a synchronized logger — parallel code that runs serially.
- **Nested parallelism**: a parallel library (BLAS, a parallel stream) called from an already-parallel pool spawns cores² threads.
- **Container CPU limits**: runtimes that size pools from the host's core count (e.g., 64) inside a container limited to 2 CPUs get throttled heavily.

## In Production

- Kubernetes CPU limits use CFS quotas; a Go or Java process that ignores them and runs 64 threads on a 2-CPU quota exhausts its quota early in each 100 ms period and is **throttled**, causing latency spikes. Modern JVMs and Go (1.25+ adjusts GOMAXPROCS for cgroup CPU limits) are container-aware; older versions needed explicit settings.
- Databases parallelize large queries (parallel sequential scans, parallel hash joins) but only benefit analytical queries; OLTP relies on concurrency across many small queries instead.

## Deeper Connections

- Amdahl's serial fraction is often a **lock**: shrinking critical sections is the same as increasing p ([Synchronization Primitives](lesson:os-sync-primitives)).
- In distributed systems the serial fraction is a **coordinator** or **consensus leader** ([Consensus](lesson:db-quorums-consensus)) — the same law at a larger scale.
- Event loops give concurrency without parallelism; production Node.js clusters add parallelism with multiple processes ([epoll & Event Loops](lesson:os-epoll-event-loops)).

## Common Misconceptions

- **"Concurrency and parallelism are the same."** Concurrency is structure; parallelism is simultaneous execution.
- **"More threads = more performance."** Only while they have independent work and free cores; beyond that, overhead dominates.
- **"Single-core concurrency can't have race conditions."** Preemption can interleave threads at any instruction.
- **"Doubling cores halves the runtime."** Only if the job is 100% parallel with no contention — never true in practice.

## Interview Questions

### [L1 · compare] What is the difference between concurrency and parallelism?

Concurrency is when multiple tasks are in progress during overlapping time periods — they may be interleaved on one core. Parallelism is when multiple tasks execute at the same instant on multiple cores. Concurrency is a way to structure a program to handle many things; parallelism is a way to execute faster. You can have either without the other.

### [L2 · numerical] A program is 80% parallelizable. What is the maximum speedup on 4 cores, and with infinitely many?

4 cores: 1 / (0.2 + 0.8/4) = 1 / 0.4 = **2.5×**. Infinite cores: 1 / 0.2 = **5×**.

### [L2 · how] How would you size a thread pool for a service that spends 10 ms computing and 90 ms waiting on a database per request, on 8 cores?

`threads ≈ cores × (1 + wait/compute) = 8 × (1 + 90/10) = 80`. Then validate with load tests: watch CPU utilization, queueing, and — critically — the database, which may not tolerate 80 concurrent queries from each instance. The downstream capacity often sets the real limit.

### [L3 · why] Why can adding threads to a CPU-bound service reduce throughput?

Beyond the core count, threads compete for cores: the scheduler time-slices them, adding context-switch overhead and evicting each thread's working set from caches and the TLB. Shared locks and cache lines become more contended (coherence traffic). The Universal Scalability Law captures this: throughput peaks and then declines.

### [L3 · debugging] A batch job on a 32-core machine uses only ~3 cores' worth of CPU despite a 32-thread pool. What would you check?

A serial bottleneck: a global lock (profile with `perf lock`/thread dumps showing BLOCKED threads), a single-threaded stage feeding the pool (producer too slow), I/O waits (iostat, `%iowait`), a synchronized shared resource (logger, connection pool of size 4), or container CPU limits. Also check whether the work is actually partitioned — e.g., all tasks hashing to one queue.

### [L4 · design] Your nightly ETL takes 6 hours on 16 cores; the business wants 1 hour. How do you reason about whether more hardware helps?

Profile the stages and measure the serial fraction: if loading, sorting or writing is single-threaded, Amdahl caps the benefit of more cores. Parallelize those stages (partitioned reads, parallel writes, merge-sort in parallel), remove shared bottlenecks (one DB table with a hot index, one output file), and consider scaling out (partitioning data across machines) — with Gustafson in mind: work that grows with data can scale. Estimate using the measured p before buying hardware; also check I/O and database capacity, which often become the new bottleneck.

## Practice

### [numeric 4.71 ±0.05] A job is 90% parallelizable. What speedup does it achieve on 8 cores? (2 decimals)

:::answer
S = 1 / (0.1 + 0.9/8) = 1 / (0.1 + 0.1125) = 1 / 0.2125 ≈ **4.71×**.
:::

### [numeric 20] What is the maximum speedup (infinite cores) for a job that is 95% parallel?

:::answer
1 / (1 − 0.95) = **20×**.
:::

### [mcq] A Node.js server handles 10,000 connections on one thread. This is an example of:

- [x] Concurrency without parallelism
- [ ] Parallelism without concurrency
- [ ] Both concurrency and parallelism
- [ ] Neither

Many tasks are in progress, interleaved on one thread via an event loop — nothing executes simultaneously.

## Quick Revision

- **Concurrency** = structure (many tasks in progress); **parallelism** = simultaneous execution.
- CPU-bound → threads ≈ cores. I/O-bound → many tasks or async; `threads ≈ cores × (1 + wait/compute)`.
- **Amdahl**: `S = 1 / ((1−p) + p/N)`, max `1/(1−p)`. 5% serial → ≤ 20×.
- **Gustafson**: bigger machines → bigger problems. **USL**: contention/coherence make throughput fall past a peak.
- Hidden serialization (global locks, hot rows) kills parallel speedup.
- Container CPU limits + host-sized thread pools → throttling.
