---
title: "Multilevel Queues, MLFQ and Real Schedulers (Linux CFS/EEVDF)"
subject: os
level: 3
order: 3
summary: "How schedulers approximate SJF without knowing the future, how Linux shares CPU fairly among thousands of threads, and what multicore scheduling adds."
depth: advanced
difficulty: 4
minutes: 40
relevance: medium
stage: 4
prerequisites: [os-scheduling-algorithms]
related: [os-scheduling-basics, os-virtualization-containers, os-hugepages-numa, os-context-switch]
visualizations: [cpu-scheduler]
tags: [multilevel queue, mlfq, cfs, eevdf, nice, vruntime, real-time scheduling, sched_fifo, affinity, load balancing, cgroups cpu, rate monotonic, edf, cpu throttling]
---

## Mental Model

Classic SJF is optimal but needs to know each job's length in advance. **MLFQ learns it by watching.** Every new job is assumed to be short and interactive and gets top priority. If it uses its whole time slice, it's probably CPU-bound — demote it. If it gives up the CPU quickly (I/O), keep it high. Short jobs finish before they sink; long jobs drift to lower queues where they still run, just less urgently.

Linux takes a different angle: rather than guessing burst lengths, it tracks how much CPU each thread has **received** relative to its fair share, and always runs the one that's most "owed". Interactive threads that sleep a lot naturally become the most owed.

## Definition

- **Multilevel queue**: ready queue split into fixed classes (e.g., system, interactive, batch), each with its own algorithm and a policy between queues (fixed priority or time-sharing among queues). Processes don't move between queues.
- **Multilevel feedback queue (MLFQ)**: multiple priority queues where processes **move** between levels based on observed behavior.
- **CFS (Completely Fair Scheduler)**: Linux's general-purpose scheduler from 2.6.23 to 6.5, which runs the task with the smallest weighted *virtual runtime*.
- **EEVDF (Earliest Eligible Virtual Deadline First)**: CFS's successor since Linux 6.6; keeps weighted fairness but adds explicit per-task virtual deadlines for better latency control.

## Why It Exists

**The problem.** Real workloads mix interactive, server, batch and real-time tasks whose burst lengths are unknown and change over time. A good general-purpose scheduler must:

- keep interactive/I/O-bound tasks responsive,
- give CPU-bound tasks good throughput,
- avoid starvation,
- respect priorities and administrator-defined shares,
- scale to hundreds of cores.

No single classic algorithm does all of this. SJF needs the future; Round Robin ignores what it has learned; Priority starves.

**The idea.** The future is unknown, but the *past* is visible. A job that used its whole slice last time will probably do so again; a job that blocked quickly is probably interactive. So let the scheduler *learn* each job's nature from its behaviour (MLFQ), or sidestep prediction entirely by tracking who is owed CPU time (CFS/EEVDF).

:::callout[That's all it is]{type=insight}
MLFQ: start everyone at top priority and demote whoever hogs the CPU. CFS: always run whoever has had the least CPU so far. Both make interactive programs fast without anyone telling the OS which programs are interactive.
:::

## How It Works

### MLFQ rules (the OSTEP formulation)

1. If Priority(A) > Priority(B), A runs.
2. If Priority(A) = Priority(B), they run round-robin (with the quantum for that level).
3. A new job enters at the **highest** priority.
4. Once a job uses up its **time allotment** at a level (regardless of how many times it gave up the CPU), it moves down one level.
5. After some period **S**, move all jobs back to the top (**priority boost**).

```mermaid
flowchart TB
    N["New job"] --> Q0["Q0: highest priority, quantum 8 ms"]
    Q0 -->|"used full allotment"| Q1["Q1: quantum 16 ms"]
    Q1 -->|"used full allotment"| Q2["Q2: lowest priority, FCFS or long quantum"]
    Q2 -.->|"periodic priority boost"| Q0
    Q1 -.->|"periodic priority boost"| Q0
```

Why each rule exists:

- Rule 3 **approximates SJF**: every job gets a chance to prove it's short.
- Rule 4 (allotment accounting, not "gave up the CPU before the slice ended") prevents **gaming**: a job that yields at 99% of its slice would otherwise stay on top forever.
- Rule 5 prevents **starvation** of low-level jobs and lets jobs whose behavior changed (a batch job becoming interactive) climb back.

Lower levels typically get **longer quanta** — CPU-bound jobs benefit from fewer switches.

### Linux CFS: fair share via virtual runtime

A different philosophy from MLFQ: instead of guessing burst lengths with a pile of tunable rules, define "fair" precisely. Each task should get CPU in proportion to its weight, so always run whoever is furthest behind. Each runnable task accumulates **vruntime**: actual runtime scaled inversely by its weight. The weight comes from the nice value; each nice step is about a 10% CPU share difference, a weight ratio of about 1.25:

```text
vruntime += delta_exec × (weight_of_nice_0 / weight_of_task)
```

The scheduler always picks the task with the **smallest vruntime**, stored in a red-black tree (O(log n) insert, leftmost cached for O(1) pick). A task that sleeps doesn't accumulate vruntime, so when it wakes it is near the left of the tree and runs soon — interactivity emerges from fairness. (On wakeup, its vruntime is clamped to roughly the current minimum so long sleepers can't hoard credit.)

The time slice isn't fixed: the scheduler targets a **scheduling latency** period (e.g., a few ms) divided among runnable tasks in proportion to weight, with a minimum granularity to avoid thrashing.

:::depth{level=advanced}
### EEVDF (Linux 6.6+)

EEVDF keeps weighted fair sharing but schedules by **virtual deadline**. Each task has a requested slice. A task is *eligible* if it hasn't received more than its fair share (its "lag" is not negative), and among eligible tasks the one with the earliest virtual deadline runs. Latency-sensitive tasks can request shorter slices (earlier deadlines) without getting more total CPU. It replaced a pile of CFS heuristics with a principled rule.
:::

### Scheduling classes and real-time

Fairness is the wrong goal for some tasks: an audio thread that misses a 5 ms deadline produces a glitch no matter how "fair" the schedule was. Those tasks need *guarantees*, not shares, so they live in separate classes that always win over fair tasks. Linux checks classes in strict priority order:

| Class | Policies | Behavior |
|---|---|---|
| Stop / deadline | `SCHED_DEADLINE` | EDF with CPU reservations (runtime, period, deadline) |
| Real-time | `SCHED_FIFO`, `SCHED_RR` | Fixed priority 1–99; FIFO runs until it blocks/yields; RR time-slices within a priority |
| Fair | `SCHED_OTHER` (normal), `SCHED_BATCH` | CFS/EEVDF with nice −20…19 |
| Idle | `SCHED_IDLE` | Runs only when nothing else wants the CPU |

A runaway `SCHED_FIFO` thread can lock up a core; Linux reserves a little CPU for normal tasks by default (`sched_rt_runtime_us` = 950 ms per second).

:::depth{level=advanced}
### Real-time theory: rate-monotonic vs EDF

Textbooks model real-time work as **periodic tasks**: task *i* needs *Cᵢ* ms of CPU every *Pᵢ* ms and must finish before its next period starts. The CPU utilization is U = Σ Cᵢ / Pᵢ.

- **Rate-monotonic (RM)**: fixed priorities, where a shorter period means a higher priority. It is guaranteed to meet every deadline if U ≤ n(2^(1/n) − 1), which is 82.8% for two tasks and approaches 69% for many.
- **Earliest deadline first (EDF)**: dynamic priorities, where the task whose deadline is nearest runs. On one CPU it meets every deadline whenever U ≤ 100%.

Example: T1 needs 25 ms every 50 ms, T2 needs 35 ms every 80 ms. U = 25/50 + 35/80 = 0.5 + 0.4375 = 93.75%, above RM's 82.8% bound. Under RM, T1 always preempts T2, and T2 misses its first deadline at 80 ms. EDF meets all deadlines because the total is under 100%. Linux's `SCHED_DEADLINE` is EDF with admission control: it refuses a task whose reservation would push total utilization too high.
:::

### Multiprocessor scheduling

- **Per-CPU run queues** avoid a global lock.
- **Load balancing** periodically migrates tasks from busy to idle CPUs, respecting the topology hierarchy (hyperthread siblings → cores sharing L3 → NUMA nodes), because migrating across NUMA nodes loses cache and memory locality.
- **Processor affinity**: soft (the scheduler prefers the last CPU) and hard (`taskset`, `sched_setaffinity`, cpusets) — pinning.
- **Group scheduling**: with cgroups, CPU is shared fairly among *groups* first (e.g., containers), then among the tasks within each group. So a container with 100 threads doesn't get 100× the CPU of one with 1 thread. `cpu.weight` sets relative shares; `cpu.max` sets a hard quota per period.

## Example

MLFQ in action with three levels (quanta 10/20/40 ms), a CPU-bound job A (long) and an interactive job B (runs 1 ms, then waits for a keystroke):

- A starts in Q0, uses 10 ms → Q1, uses 20 ms → Q2 where it runs with 40 ms slices whenever nothing else is ready.
- B arrives, enters Q0, runs 1 ms per keystroke and never exhausts its allotment → stays in Q0 and preempts A immediately each time. Keystroke latency ≈ 1 ms.
- Every S = 1 s, the boost moves A back to Q0 briefly so it can't starve even if many interactive jobs appear.

### The JVM inside a CPU quota

A container's `cpu.max` is enforced per 100 ms period, and it counts CPU time from all threads together. A JVM has many threads: request handlers, GC workers, JIT compilers. With a 2-CPU limit, the container gets 200 ms of CPU time per 100 ms period. If 8 threads are busy at once, they use it up in 200 / 8 = 25 ms, and then every thread waits 75 ms for the next period, even if the host is idle. That is the p99 spike in the debugging question below.

Since JDK 10 the JVM reads the cgroup limit: `Runtime.getRuntime().availableProcessors()` returns 2 here, and default pool sizes, GC thread counts and the common `ForkJoinPool` follow it. Application pools sized by hand (`newFixedThreadPool(64)`) don't, and they are what burns through the quota.

## Visualization

The scheduler simulator includes an MLFQ mode — watch jobs demote and boost:

::viz{id=cpu-scheduler}

## Complexity & Performance

- CFS/EEVDF: O(log n) per enqueue/dequeue; decisions in well under a microsecond.
- Load balancing and migrations cost cache warmth; that's why latency-critical services pin threads and why `perf sched` and `/proc/schedstat` track migrations.

## Trade-offs

- **MLFQ**: adapts without prior knowledge; needs tuning (number of levels, quanta, boost period S) and anti-gaming accounting.
- **Fair-share (CFS/EEVDF)**: predictable proportional sharing; interactivity is emergent, which occasionally needs latency hints.
- **Real-time policies**: bounded latency for critical threads; can starve everything else if misused.
- **Hard CPU quotas (cgroups)**: isolation and cost control; can cause throttling latency even when the host is idle.

## Failure Modes

- **CFS quota throttling**: a multi-threaded process burns its `cpu.max` quota in the first part of each 100 ms period and then sleeps for the rest — p99 latency spikes of tens of milliseconds. Common in Kubernetes with CPU limits.
- **RT priority lockups**: a `SCHED_FIFO` busy loop starves kernel threads on that core.
- **Cross-NUMA migrations**: a thread moved away from its memory runs slower.
- **Gaming**: without allotment accounting, a job can yield just before its quantum ends to stay high priority.

## In Production

- Kubernetes: `requests.cpu` → `cpu.weight` (shares), `limits.cpu` → `cpu.max` (quota). Many teams set requests but avoid CPU limits on latency-sensitive services to prevent throttling; others use the static CPU manager to give Guaranteed pods exclusive cores.
- Databases and trading systems use `taskset`/cpusets, IRQ affinity and sometimes `SCHED_FIFO` for critical threads.
- Observability: `/proc/<pid>/sched`, `schedstat`, `perf sched latency`, cgroup `cpu.stat` (`nr_throttled`, `throttled_usec`).

## Deeper Connections

- Group scheduling via cgroups is the CPU half of container isolation ([VMs & Containers](lesson:os-virtualization-containers)).
- NUMA-aware balancing connects to [Huge Pages & NUMA](lesson:os-hugepages-numa).
- Weighted fair queuing is the same idea used by network schedulers and multi-tenant query admission.

## Common Misconceptions

- **"Linux uses round robin."** Normal tasks use weighted fair scheduling (CFS, now EEVDF); `SCHED_RR` exists only for real-time tasks.
- **"nice -20 makes a process real-time."** It only increases its fair-share weight; real-time is a separate class with strict priority.
- **"CPU limits only matter when the node is busy."** Quotas throttle even on an idle node.

## Interview Questions

### [L2 · how] How does MLFQ approximate SJF without knowing burst times?

It assumes every new job is short by placing it in the highest-priority queue. Jobs that use their full time allotment are demoted to lower priority, so long CPU-bound jobs sink while short and I/O-bound jobs stay high and get quick service. Periodic priority boosts prevent starvation and let jobs whose behavior changes move back up.

### [L2 · compare] What is the difference between a multilevel queue and a multilevel feedback queue?

In a multilevel queue, processes are permanently assigned to a queue (e.g., by type) and never move. In MLFQ, processes move between queues based on their observed CPU usage, letting the scheduler adapt to behavior.

### [L3 · why] Why does MLFQ account for total time used at a level rather than resetting when a job yields?

Otherwise a job could game the scheduler by issuing a trivial I/O or yield just before its quantum expires, staying at the top priority forever while consuming nearly all the CPU. Tracking the cumulative allotment at each level closes that loophole.

### [L3 · how] How does Linux CFS decide which task runs next?

Each task tracks virtual runtime — CPU time consumed, scaled by the inverse of its weight (from its nice value). Runnable tasks sit in a red-black tree ordered by vruntime, and the scheduler picks the one with the smallest vruntime (the one that has received the least weighted CPU). Sleeping tasks don't accumulate vruntime, so they run soon after waking, giving interactivity. (Since Linux 6.6, EEVDF refines this with eligibility and virtual deadlines.)

### [L3 · debugging] A Java service in Kubernetes with a 2-CPU limit shows p99 spikes of ~80 ms although average CPU use is 40%. What might be happening?

CFS bandwidth throttling: the JVM runs many threads (GC, JIT, request threads); in bursts they consume the 200 ms-per-100 ms quota early in the period, and then all threads are throttled until the next period starts. Check `cpu.stat` (`nr_throttled`, `throttled_usec`) and container throttling metrics. Mitigations: raise or remove the CPU limit (keep requests), reduce parallelism (GC threads, pool sizes) to match the quota, or use exclusive CPU pinning.

### [L4 · design] You must run a latency-critical packet-processing thread and general workloads on the same Linux host. How would you configure scheduling?

Isolate cores: cpusets or `isolcpus`/`nohz_full` for the critical thread's cores; pin the thread (affinity) and route IRQs for its NIC queue to that core or away as appropriate; consider `SCHED_FIFO` with a sane priority (and ensure it blocks or yields, or busy-polls on a dedicated core); keep general workloads on remaining cores with cgroup weights; watch NUMA locality for its memory. Validate with latency histograms and `perf sched`.

## Practice

### [mcq] In MLFQ, where does a newly arriving job start?

- [x] The highest-priority queue
- [ ] The lowest-priority queue
- [ ] A queue chosen by its predicted burst
- [ ] The queue with the fewest jobs

Every job is initially assumed to be short/interactive.

### [numeric 75 unit=ms] A Java service runs in a container limited to 2 CPUs (`cpu.max` = 200 ms per 100 ms period). During a burst, 8 of its threads are runnable and the host has plenty of idle cores. For how many milliseconds of each 100 ms period are its threads throttled?

:::answer
The quota is 200 ms of CPU time per period. 8 threads running in parallel use 8 ms of quota per millisecond of wall time, so it is gone after 200 / 8 = 25 ms. All threads then wait for the rest of the period: 100 − 25 = **75** ms of throttling, which shows up as latency spikes.
:::

### [numeric 5 unit=ms] Under CFS, task A has nice 0 (weight 1024) and task B has weight 2048. Each runs for 10 ms of real time. By how much does B's vruntime increase?

:::answer
vruntime grows by delta × (1024 / weight). For A: 10 × 1024/1024 = 10 ms. For B: 10 × 1024/2048 = **5** ms. B's vruntime grows half as fast, so the scheduler picks it twice as often, giving it two thirds of the CPU when both are runnable.
:::

### [numeric 25 unit=%] Two CPU-bound tasks share one core under CFS: A has weight 1024 and B has weight 3072. What share of the CPU does A get?

:::answer
CPU is split in proportion to weight: 1024 / (1024 + 3072) = 1024 / 4096 = **25**%. B gets 75%.
:::

### [exercise] An MLFQ has three levels: Q0 with quantum 2, Q1 with quantum 4, and Q2 run first-come-first-served. Job A arrives at 0 needing 7 units of CPU; job B arrives at 1 needing 2 units. A job that uses its full quantum is demoted; there is no boost. Draw the schedule and give each job's completion and response time. Then check it in the [CPU scheduling lab](lab:cpu-scheduler) in MLFQ mode.

:::solution
```text
| A (Q0) | B (Q0) | A (Q1)          | A (Q2) |
0        2        4                 8        9
```

- A starts in Q0 and runs 0–2. B arrives at 1, also in Q0; same level means round robin, so A keeps its quantum. A used all of it, so it drops to Q1 with 5 units left.
- B runs 2–4 and finishes within its first quantum, never demoted.
- A runs in Q1 from 4 to 8, uses the whole quantum again and drops to Q2 with 1 unit left. It finishes at 9.

Completion: A 9, B 4. Response time (first run − arrival): A 0, B 2 − 1 = 1. The short job finished almost immediately, and the long job sank to the lower levels — MLFQ discovered which was which without being told.
:::

### [mcq] Which Linux scheduling class preempts normal (CFS/EEVDF) tasks regardless of their nice value?

- [ ] SCHED_BATCH
- [x] SCHED_FIFO
- [ ] SCHED_IDLE
- [ ] SCHED_OTHER with nice −20

Real-time classes always run before the fair class.

## Quick Revision

- **Multilevel queue**: fixed classes. **MLFQ**: move by behavior — new jobs start high; using full allotment demotes; periodic boost prevents starvation; allotment accounting prevents gaming.
- **CFS**: pick smallest weighted **vruntime** (red-black tree); sleepers wake with low vruntime → interactive. **EEVDF** (6.6+): fairness + virtual deadlines.
- Classes: deadline > real-time (FIFO/RR, 1–99) > fair (nice −20…19) > idle.
- Multicore: per-CPU queues, load balancing by topology, affinity/pinning, NUMA.
- cgroups: `cpu.weight` = shares; `cpu.max` = quota → **throttling** latency. N busy threads burn a Q ms quota in Q/N ms.
- JVM: `availableProcessors()` follows the container limit since JDK 10; hand-sized pools don't.
- Real-time: RM (fixed, shorter period = higher priority) guaranteed if U ≤ n(2^(1/n) − 1) (82.8% for 2 tasks); EDF up to 100%.
