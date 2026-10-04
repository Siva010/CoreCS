---
title: "Working Sets, Thrashing, Memory Pressure, Swapping and the OOM Killer"
subject: os
level: 7
order: 3
summary: "Why a system can suddenly grind to a halt when memory runs short, how the working-set model explains it, and how Linux reacts: reclaim, swap, PSI and the OOM killer."
depth: core
difficulty: 3
minutes: 40
relevance: high
stage: 3
prerequisites: [os-page-replacement]
related: [os-page-faults, os-page-cache, os-performance-method, os-virtualization-containers]
visualizations: [page-replacement]
tags: [thrashing, working set, page fault frequency, memory pressure, swapping, swap, oom killer, psi, reclaim, kswapd, overcommit, cgroups memory]
---

## Mental Model

Imagine a desk that can hold 10 open books, and you're working on a task that needs 12 books *at the same time*. Every time you reach for one, it isn't on the desk, so you fetch it — and put another away, which you then need a moment later. You spend almost all your time fetching and almost none reading. That's **thrashing**: the system is busy, the disk is busy, but useful work collapses.

The **working set** is the set of books you need right now. As long as each process's working set fits in memory, paging is cheap. The moment the sum of working sets exceeds RAM, performance doesn't degrade gently — it falls off a cliff.

## Definition

- **Working set W(t, Δ)**: the set of pages a process referenced in the last Δ time units (or references) — an estimate of the pages it currently needs.
- **Thrashing**: a state where the system spends more time servicing page faults than executing useful work, because active working sets don't fit in physical memory.
- **Swapping**: moving anonymous (not file-backed) pages to a swap area on disk to free RAM; historically, moving entire processes out.
- **Memory pressure**: the degree to which tasks stall waiting for memory (reclaim, faults).
- **OOM killer**: the kernel mechanism that kills a process when memory can't be reclaimed to satisfy an allocation.

## Why It Exists

**The problem.** Demand paging and overcommit let the OS run more than fits in RAM — valuable because most processes don't use all their memory at once. But "more than fits" only works up to a point, and the OS needs to know where that point is.

**Without it.** The system keeps admitting work until everyone is waiting on the disk. Nothing crashes; everything just becomes thousands of times slower — the worst kind of failure, because it looks like "busy".

**The idea.** What matters isn't how much memory a process *has*, but how much it's *using right now* — its working set. If the working sets fit, paging is nearly free; if they don't, no algorithm can save you, so the OS must reduce demand (reclaim, swap, suspend, kill). The working-set model explains when this stops being safe, and the mechanisms (reclaim, swap, OOM) are the OS's escalating responses as it gets unsafe.

:::callout[That's all it is]{type=insight}
Thrashing = the pages everyone needs right now don't fit in RAM, so the machine spends its time swapping instead of working. The cure is never a smarter eviction policy; it's less demand or more memory.
:::

## How It Works

### The thrashing spiral (classic)

1. Memory is tight; processes page-fault more.
2. Processes block on disk I/O; **CPU utilization drops**.
3. A naive scheduler sees low CPU utilization and **admits more processes** to raise it.
4. More processes → less memory each → even more faults → CPU utilization drops further.

```text
CPU utilization
   ▲
   │          ╭───╮
   │        ╭─╯   ╰╮
   │      ╭─╯      ╰╮      ← thrashing
   │    ╭─╯          ╰─╮
   │  ╭─╯               ╰──────
   └──────────────────────────────▶ degree of multiprogramming
```

### Working-set model

For each process, track the pages touched in the last Δ references. If the total demand `D = Σ |WSᵢ|` exceeds the available frames, **suspend (swap out) a process** until demand fits, rather than letting everyone thrash. Choosing Δ matters: too small misses the true locality; too large includes stale pages.

### Page-fault frequency (PFF)

Tracking every page each process touched is expensive. But the *symptom* of too few frames — a high fault rate — is cheap to measure. So steer by the symptom instead. A cheaper control loop: measure each process's fault rate.

- Fault rate above an upper bound → give it more frames.
- Below a lower bound → take frames away.
- If no free frames exist for processes above the bound → suspend one.

### Swapping and reclaim on Linux

When free memory falls below watermarks, **kswapd** reclaims in the background; if allocations can't wait, the allocating task does **direct reclaim** itself (a latency spike). Reclaim takes:

- **clean file-backed pages** (page cache, code): just drop them — they can be re-read;
- **dirty file pages**: write them back first;
- **anonymous pages**: only by writing them to **swap** (or compressing them into RAM with zswap/zram).

`vm.swappiness` (0–200) biases between reclaiming file pages and swapping anonymous ones.

### The OOM killer

Because memory was promised lazily (overcommit), the kernel can end up unable to keep a promise it already made. At that point there's no polite option left. If reclaim fails, the kernel must free memory by force. It computes an **oom_score** per process (proportional to memory usage, adjusted by `oom_score_adj` from −1000 to 1000) and sends **SIGKILL** to the highest. Kernel log:

```text
Out of memory: Killed process 23714 (java) total-vm:9123456kB, anon-rss:7800123kB, ...
```

In containers, hitting the cgroup's `memory.max` triggers a **cgroup OOM kill** of a process in that container, even if the host has free memory — Kubernetes reports `OOMKilled` (exit code 137 = 128 + SIGKILL 9).

## Internal Mechanism

### Measuring pressure: PSI

To act before the cliff, you need a signal that measures *harm*, not just usage. Load average and "free memory" are poor signals (Linux uses spare RAM for the page cache, so "free" is always low on a healthy box). **Pressure Stall Information** (`/proc/pressure/memory`) reports the share of time tasks were stalled on memory:

```text
some avg10=12.50 avg60=8.10 avg300=3.02 total=...
full avg10=4.30  avg60=2.00 avg300=0.70 total=...
```

`some` = at least one task stalled; `full` = all non-idle tasks stalled (true thrashing). Tools like `systemd-oomd` act on PSI before the kernel OOM killer does, killing workloads earlier and more predictably.

:::depth{level=advanced}
### Swap: friend or foe?

Swap is not "slow RAM" — it's a place to put **cold anonymous pages** (e.g., initialization data never touched again) so the RAM can serve hot file pages. Modest swap usually *improves* performance and gives reclaim room to maneuver before OOM. The danger is **hot** pages being swapped (latency spikes of 100 µs–10 ms per fault) and slow death spirals instead of fast OOM kills. Many latency-sensitive deployments disable swap (Kubernetes historically required it off; newer versions support it with limits) and rely on memory limits + fast OOM, while desktops use zram/zswap (compressed swap in RAM).
:::

## Example

Diagnosing a thrashing server:

```bash
$ vmstat 1
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 2 14 8123452  61232   1204  98340 8120 9340 12030 10220 9012 12011  4  6 12 78  0
```

- `b` = 14 tasks blocked (uninterruptible, typically on I/O).
- `si`/`so` = thousands of KB/s swapped in and out **simultaneously** — pages evicted and immediately needed again.
- `wa` = 78% of CPU time waiting on I/O; `us` only 4%.
- `cache` tiny — even the page cache has been squeezed out.

That's thrashing. The fix is not more CPU — it's less memory demand (fewer processes/containers per node, smaller heaps) or more RAM.

## Complexity & Performance

- The cliff is dramatic: an application whose working set fits runs at memory speed; exceeding it by 10–20% can make it 10–100× slower because each extra fault costs ~10⁴–10⁵ memory accesses.
- Direct reclaim adds latency to *every* allocating task — including ones unrelated to the memory hog.

## Trade-offs

| Policy | Benefit | Cost |
|---|---|---|
| Generous overcommit | High density, more processes fit | OOM kills, thrashing risk |
| Strict limits (cgroups) | Isolation, predictable failure | Earlier OOM for bursty apps |
| Swap enabled | Cold pages out of RAM, smoother degradation | Latency spikes if hot pages swap, slow death spirals |
| Swap disabled | Fast failure, no swap latency | Wasted RAM on cold anonymous pages, earlier OOM |

## Failure Modes

- **Thrashing**: high `wa`, high `si/so`, low useful CPU, requests timing out.
- **OOM kill of the wrong process** (the database instead of the leaking cron job) — protect critical processes with `oom_score_adj = -1000` (carefully) or cgroup isolation.
- **Page-cache starvation**: large anonymous usage squeezes out the page cache, turning cached file reads into disk reads.
- **JVM/GC + swap**: GC scans the whole heap; if parts are swapped, each GC takes seconds to minutes.

## In Production

- Kubernetes: set memory `requests` realistically and `limits` to what the app can actually use; `OOMKilled` pods mean the limit is too low *or* the app leaks. Node-level eviction (kubelet) happens before kernel OOM when node memory is low.
- Watch PSI memory, major faults, swap in/out rates, and cgroup `memory.events` (`oom`, `oom_kill`, `high`).
- Case study: [Memory Leak & OOM](case:memory-leak).

## Deeper Connections

- Thrashing is a cache-overload phenomenon; the same cliff occurs in DB buffer pools when the working set outgrows `shared_buffers`/`innodb_buffer_pool_size` ([Buffer Pool](lesson:db-buffer-pool)), and in CPU caches ([CPU Caches & Contention](lesson:os-cpu-caches-contention)).
- The "admit more work when utilization drops" mistake reappears in overloaded servers: adding threads or retries to a saturated system worsens it ([Overloaded Servers](lesson:x-overloaded-server)).

## Common Misconceptions

- **"Free memory near zero means memory trouble."** Linux deliberately fills RAM with page cache; look at `MemAvailable`, PSI and fault rates.
- **"Swap usage > 0 means the system is thrashing."** Swapped-out cold pages are fine; *active* swap-in/out traffic is the problem.
- **"Adding CPU fixes thrashing."** The bottleneck is memory; CPU sits idle waiting on I/O.
- **"The OOM killer picks the process that caused the problem."** It picks by score (mostly size); the biggest process may be innocent.

## Interview Questions

### [L1 · conceptual] What is thrashing?

A condition where the system spends most of its time paging — servicing page faults and swapping — rather than doing useful work, because the combined working sets of active processes exceed physical memory. CPU utilization drops, disk I/O saturates, and throughput collapses.

### [L2 · how] What is the working-set model and how does it prevent thrashing?

A process's working set is the set of pages it referenced in the most recent window Δ. The OS tracks working-set sizes and ensures their total fits in physical memory; if not, it suspends (swaps out) some processes instead of letting all of them fault continuously. This keeps each running process's locality in memory.

### [L2 · why] Why does increasing the degree of multiprogramming beyond a point decrease CPU utilization?

Each added process takes frames from the others; once working sets no longer fit, processes page-fault constantly and block on I/O, so the CPU idles. A scheduler that responds to low utilization by admitting even more processes deepens the thrashing.

### [L3 · debugging] A server's CPU shows 75% iowait, vmstat shows high si/so, and requests time out. What's happening and what would you do immediately and long-term?

The system is thrashing: active pages are being swapped out and back in. Immediately: reduce memory demand — stop or restart the biggest/non-critical consumers, shed load, or drain the node. Long-term: find the cause (a leak, oversized heaps, too many containers per node, a cache without limits), set correct memory limits/requests, add RAM, consider disabling or reducing swap for latency-critical services, and alert on PSI memory pressure and major faults before users notice.

### [L3 · compare] What decides which process the Linux OOM killer kills?

The `oom_score` of each process, mostly proportional to its memory footprint (RSS + swap + page tables), adjusted by `oom_score_adj` (−1000 exempts, +1000 prefers). The highest score is killed with SIGKILL. In cgroup-limited environments, the victim is chosen within the cgroup that exceeded its limit.

### [L4 · incident] Pods of a Java service are repeatedly OOMKilled (exit 137) with -Xmx equal to the container limit. Explain and fix.

The Java heap is only part of the process's memory: metaspace, thread stacks, code cache, GC structures, direct buffers and native allocations add hundreds of MB or more. With Xmx equal to the limit, total RSS exceeds `memory.max` and the cgroup OOM killer strikes. Fix: size the heap to ~60–75% of the limit (`-XX:MaxRAMPercentage`), measure with Native Memory Tracking, cap direct memory and thread counts, and set limits from observed peak RSS plus headroom.

## Practice

### [mcq] Which vmstat pattern most strongly indicates thrashing?

- [ ] High `us`, low `wa`
- [x] High `si` and `so` simultaneously, high `wa`
- [ ] Large `cache`, zero `swpd`
- [ ] High `cs` with idle disk

Pages continuously moving in and out of swap while CPU waits on I/O.

### [mcq] A Kubernetes container exits with code 137 and reason OOMKilled. What does 137 mean?

- [ ] The app called exit(137)
- [x] The process was killed by signal 9 (128 + 9)
- [ ] A segmentation fault
- [ ] The liveness probe failed

Exit codes above 128 mean "terminated by signal N−128"; 9 is SIGKILL.

## Quick Revision

- **Working set** = pages used in the last Δ; if Σ working sets > RAM → **thrashing**.
- Thrashing spiral: faults → I/O wait → low CPU → admit more → worse.
- Controls: working-set model (suspend processes), page-fault frequency (adjust frames).
- Linux reclaim: drop clean file pages, write back dirty, swap anonymous; kswapd vs direct reclaim; `swappiness`.
- **OOM killer**: highest `oom_score` gets SIGKILL; cgroup limits → container OOMKilled (exit 137).
- Measure with **PSI**, `vmstat` (si/so/wa/b), major faults — not "free" memory.
