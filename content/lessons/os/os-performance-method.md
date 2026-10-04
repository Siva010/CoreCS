---
title: "Performance Fundamentals: Latency, Throughput, Utilization, Saturation and Little's Law"
subject: os
level: 10
order: 1
summary: "The vocabulary and laws engineers use to reason about performance — USE method, Little's Law, queueing near saturation, load average — and a systematic way to find CPU, memory and I/O bottlenecks."
depth: core
difficulty: 3
minutes: 45
relevance: high
stage: 3
prerequisites: [os-scheduling-basics, os-thread-pools, os-page-cache]
related: [os-profiling-observability, os-cpu-caches-contention, cn-tail-latency, x-overloaded-server, x-slow-query]
tags: [performance, latency, throughput, utilization, saturation, use method, little's law, queueing theory, load average, bottleneck, iowait, psi]
---

## Mental Model

Every system is a network of **queues in front of resources**: CPU run queues, disk request queues, socket buffers, thread pools, connection pools, lock wait queues. A request's latency is the sum of the time it spends **being served** plus the time it spends **waiting in queues**.

At low load, queues are empty and latency ≈ service time. As a resource approaches 100% busy, queues grow **non-linearly** — the last 20% of utilization can multiply latency many times over. Most performance work is: *find the resource whose queue is growing, and either make it faster, give it less work, or add more of it.*

## Definition

- **Latency**: time to complete one operation (report percentiles, not just averages).
- **Throughput**: operations completed per unit time.
- **Utilization**: fraction of time a resource is busy (or fraction of capacity used).
- **Saturation**: degree to which a resource has more work than it can service — i.e., queued work.
- **Errors**: failed operations (often the first sign of overload: timeouts, rejections).
- **Bottleneck**: the resource that limits throughput.
- **Little's Law**: `L = λ × W` — average number of items in a stable system equals arrival rate times average time in the system.

## Why It Exists

**The problem.** "The system is slow" has hundreds of possible causes, and during an incident you can't try them all.

**Without it.** Without a method, performance debugging becomes guesswork ("add more threads", "it's probably the database") — and the fix for the wrong guess often makes things worse.

**The idea.** Every slowdown is some request waiting in some queue in front of some resource. So you don't need to understand the whole system — only to *list the resources* and check each one for the same three signs (busy, queued, failing). The vocabulary lets you ask precise questions; the laws let you check answers with arithmetic before touching production.

:::callout[That's all it is]{type=insight}
Latency = time being served + time waiting in line. Lines grow sharply as a resource nears 100% busy. Find the resource with the growing line, and make it faster, give it less work, or add more of it.
:::

## How It Works

### The USE method (Brendan Gregg)

For **every resource**, check **U**tilization, **S**aturation and **E**rrors:

| Resource | Utilization | Saturation | Errors |
|---|---|---|---|
| CPU | `mpstat` %usr+%sys per CPU | Run-queue length (`vmstat r` > cores), PSI cpu, cgroup throttling | Machine check errors (rare) |
| Memory | Used vs available (`MemAvailable`) | Swapping (`si/so`), major faults, PSI memory, OOM kills | Allocation failures, OOM events |
| Disk | `iostat %util` (for single-queue devices), throughput vs limits | Queue size (`aqu-sz`), `await` rising, PSI io | Device errors in `dmesg` |
| Network | Throughput vs link/instance limits | Drops, retransmits, socket backlog overflows, buffer full | Interface errors, resets |
| Software resources | Thread/connection pool busy fraction | Pool wait queue length and wait time | Rejections, timeouts |

It's a checklist that quickly rules resources in or out.

### Little's Law in practice

The intuition: if 2,000 people arrive per second and each stays 50 ms, then at any instant about 100 of them are inside. That's all the law says — and it's enough to size pools and catch impossible numbers. `L = λ × W` holds for any stable system regardless of distribution:

- A service handles **λ = 2,000 req/s** with average latency **W = 50 ms** → on average **L = 100** requests in flight → you need at least 100 concurrent workers (threads, connections, async slots).
- A DB connection pool of 20 with average query time 10 ms supports at most **λ = L/W = 20 / 0.01 = 2,000 queries/s**. Beyond that, requests queue for connections.
- If latency doubles (slow downstream) at the same arrival rate, in-flight requests double — pools exhaust, memory grows.

### Utilization and queueing delay

Why "80% busy" is already dangerous: arrivals are random, so they bunch up. At low utilization a burst finds the server idle and clears quickly; near 100%, there's no idle time left to absorb bursts, so each one adds to a backlog that never drains. For a simple single-server queue with random arrivals (M/M/1), average time in system:

```text
W = S / (1 − ρ)        S = service time, ρ = utilization
```

| Utilization ρ | Latency multiplier 1/(1−ρ) |
|---|---|
| 50% | 2× |
| 70% | 3.3× |
| 80% | 5× |
| 90% | 10× |
| 95% | 20× |
| 99% | 100× |

Real systems differ in detail, but the shape — a "hockey stick" — is universal. That's why capacity planners target 60–75% utilization for latency-sensitive resources, and why **tail latency** explodes long before average utilization reaches 100% ([Tail Latency](lesson:cn-tail-latency)).

### Load average, precisely

Linux load average = exponentially-damped moving average (1, 5, 15 minutes) of the number of tasks **runnable or in uninterruptible sleep (D state)**. So:

- load 16 on a 16-core box with high `%usr` → CPU fully used, no queue;
- load 40 on 16 cores with idle CPUs → many tasks in D state — **I/O** (or NFS, or kernel locks), not CPU.

Load average alone is ambiguous; always pair it with CPU utilization and `vmstat`'s `r` (runnable) and `b` (blocked) columns.

## Internal Mechanism

### Classifying bottlenecks

| Symptom | Likely bottleneck | Confirm with |
|---|---|---|
| High %usr, run queue > cores | CPU-bound application code | `perf top`, flame graphs |
| High %sys | Syscalls, page faults, network stack, kernel locks | `perf`, `strace -c`, `mpstat` |
| High %iowait, high `await` | Storage | `iostat -x`, `biolatency` |
| High si/so, major faults | Memory pressure | `vmstat`, PSI, `sar -B` |
| Low CPU, low I/O, high latency | Waiting on locks, downstream services, pools, timeouts | Thread dumps, tracing, pool metrics |
| CPU throttled despite idle host | Container CPU quota | cgroup `cpu.stat` |

`%iowait` is subtle: it's idle time during which at least one task was waiting on I/O. It can drop when CPU gets busier even though the I/O problem is unchanged — treat it as a hint, not a measure.

:::depth{level=advanced}
### Coordinated omission

Load generators that send the next request only after the previous completes **stop sending while the system is stalled**, so the stall is represented by one slow sample instead of the hundreds of requests that real users would have queued. Result: dramatically understated tail latencies. Use constant-rate (open-loop) load generators (wrk2, k6 arrival-rate executors, Gatling) and HDR histograms to measure what users experience.
:::

## Example

**Symptom**: API p99 latency rose from 120 ms to 2 s during the afternoon peak.

1. **USE on CPU**: 45% utilized, run queue small → not CPU.
2. **Memory**: no swapping, no PSI → fine.
3. **Disk**: app disk idle.
4. **Software resources**: DB connection pool — 20/20 busy, wait queue 180, average wait 1.6 s. **Saturated.**
5. **Little's Law**: peak 1,500 req/s, each holds a connection ~15 ms → needs 22.5 connections on average; pool of 20 → saturation → queueing explodes latency.
6. **Why did hold time rise?** A new endpoint runs a slow query (40 ms) and holds a connection while calling an external API inside the transaction.
7. **Fix**: move the external call outside the transaction, add an index for the slow query, then resize the pool based on the DB's capacity — not just the app's demand.

## Complexity & Performance

Rules of thumb:

- Target ~60–75% peak utilization for latency-critical resources.
- Remove queues you don't need; bound the ones you do.
- Optimize the bottleneck; optimizing anything else doesn't change throughput.

## Trade-offs

- **Throughput vs latency**: batching and high utilization improve throughput but raise latency; low utilization buys latency with cost.
- **Efficiency vs headroom**: running hot saves money until a traffic spike or a failover pushes utilization past the knee.

## Failure Modes

- Measuring averages and missing tail latency.
- Optimizing the wrong resource (a CPU micro-optimization when the bottleneck is a pool).
- Reading `%iowait`, load average or "free memory" naively.
- Load tests with coordinated omission or unrealistic data distributions.

## In Production

- Dashboards organized by the **RED** method for services (Rate, Errors, Duration) and **USE** for resources.
- Autoscaling on utilization must leave headroom for startup time; scaling on queue length/latency reacts to saturation directly.
- Case studies: [High CPU](case:high-cpu), [Connection pool exhaustion](case:pool-exhaustion).

## Deeper Connections

- Tools to measure each resource: [Profiling & Observability](lesson:os-profiling-observability).
- Queues stacked across layers under overload: [Overloaded Servers](lesson:x-overloaded-server).
- A database-specific version of this investigation: [Why a Query Gets Slow](lesson:x-slow-query).

## Common Misconceptions

- **"100% CPU utilization is efficient."** For latency-sensitive services, it means queueing and huge tail latency.
- **"Load average = CPU usage."** It counts runnable and D-state tasks.
- **"If average latency is fine, users are fine."** The tail (p99, p99.9) is what many users experience on multi-call pages.

## Interview Questions

### [L1 · compare] Latency vs throughput?

Latency is how long one operation takes; throughput is how many operations complete per unit time. They're related but distinct: batching can raise throughput while increasing latency; adding parallel servers raises throughput without reducing per-request latency.

### [L2 · numerical] A service receives 500 req/s and each request spends 80 ms in the service on average. How many requests are in the system on average?

Little's Law: L = λW = 500 × 0.08 = **40** concurrent requests.

### [L2 · how] What is the USE method?

A methodology for performance analysis: for every resource (CPU, memory, disks, network, and software resources like pools and locks), check Utilization, Saturation and Errors. It quickly identifies bottlenecks by exhaustively checking each resource rather than guessing.

### [L2 · conceptual] Why does latency increase sharply as utilization approaches 100%?

Queueing: with variable arrivals and service times, requests start arriving while the resource is busy and must wait. As utilization ρ rises, the expected wait grows roughly as 1/(1−ρ): 2× at 50%, 10× at 90%, 100× at 99%. Near saturation, small increases in load cause huge latency increases.

### [L3 · debugging] Load average is 60 on a 16-core server, but CPU utilization is 25%. What does this tell you and what do you check next?

Most of the load comes from tasks in uninterruptible sleep (D state), typically waiting on disk or network filesystem I/O (or certain kernel locks). Check `vmstat 1` (b column, wa), `iostat -x` (await, aqu-sz, util per device), `ps -eo stat,wchan,comm | grep '^D'` for what tasks wait on, NFS mounts, and PSI io.

### [L3 · numerical] A connection pool has 10 connections; each query holds a connection for 25 ms on average. What's the maximum sustainable query rate?

λ_max = L / W = 10 / 0.025 = **400 queries/s**. Beyond that, requests queue for connections and latency grows unbounded.

### [L4 · incident] A service's p99 latency degrades every day at 14:00, while CPU peaks at only 55%. How do you run the investigation?

Correlate with the traffic pattern and deploys. Apply USE across resources, not just CPU: per-core CPU (one hot core?), cgroup throttling, memory PSI, disk await, network retransmits, and software resources — thread pools, DB connection pools, locks. Use tracing to break down where p99 requests spend time (queue wait vs downstream calls). Check scheduled jobs at 14:00 (batch jobs, cache expirations, cron backups, GC patterns). Form hypotheses, verify each with a metric, fix the saturated resource, and add alerts on saturation signals (queue depth, wait time) rather than utilization alone.

## Practice

### [numeric 40] Arrival rate 500 req/s, average time in system 80 ms. How many requests are in the system on average?

:::answer
L = λW = 500 × 0.08 = **40**.
:::

### [numeric 10] In an M/M/1 queue at 90% utilization, by what factor does average time in system exceed the service time?

:::answer
1 / (1 − 0.9) = **10×**.
:::

### [mcq] Linux load average counts:

- [ ] Only running processes
- [ ] CPU utilization percentage
- [x] Runnable tasks plus tasks in uninterruptible sleep
- [ ] Processes with open network connections

That's why disk or NFS stalls raise load average with idle CPUs.

## Quick Revision

- Latency (percentiles!), throughput, utilization, saturation, errors.
- **USE**: for each resource, check Utilization, Saturation, Errors — including pools and locks.
- **Little's Law** `L = λW` for sizing pools and concurrency.
- Queueing: `W ≈ S/(1−ρ)` → hockey stick; target 60–75% for latency-sensitive resources.
- Load average = runnable + D-state tasks (not CPU%).
- Optimize the bottleneck; beware coordinated omission in load tests.
