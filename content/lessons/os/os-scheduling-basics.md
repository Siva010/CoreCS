---
title: "CPU Scheduling Fundamentals: Goals, Metrics and Preemption"
subject: os
level: 3
order: 1
summary: "What a scheduler is optimizing, the metrics used to judge it (turnaround, waiting, response, throughput, utilization), and why preemption changes everything."
depth: core
difficulty: 2
minutes: 30
relevance: essential
stage: 2
prerequisites: [os-processes, os-context-switch]
related: [os-scheduling-algorithms, os-mlfq-real-schedulers, os-thread-pools]
visualizations: [cpu-scheduler]
tags: [scheduling, preemptive, non-preemptive, turnaround time, waiting time, response time, throughput, cpu utilization, dispatcher, burst]
---

## Mental Model

The scheduler is the **bouncer at a single-door club** with a line of people (the ready queue). Every few milliseconds it decides who goes in next and whether the person inside must come out. Different bouncers optimize different things:

- *"Get the most people through per hour"* → **throughput**.
- *"Nobody waits too long for their first moment inside"* → **response time**.
- *"Everyone finishes as early as possible on average"* → **turnaround time**.
- *"Nobody is kept out forever"* → **fairness / no starvation**.

These goals **conflict**. Every scheduling algorithm is a particular compromise between them.

## Definition

**CPU scheduling** is the kernel's policy for choosing which ready thread runs on each CPU, and for how long. The **dispatcher** is the mechanism that performs the chosen switch (context switch, mode switch, jump to the resumed instruction). The time it takes is **dispatch latency**.

A scheduler is **preemptive** if it can take the CPU away from a running thread (e.g., on a timer interrupt or when a higher-priority thread wakes); **non-preemptive** (cooperative) if a thread keeps the CPU until it blocks, yields or exits.

## Why It Exists

**The problem.** There are almost always more runnable threads than cores. Something has to decide who runs next.

**Without it.** Without a policy, one compute-heavy task could hog the CPU while an interactive program freezes, or short tasks could wait behind long ones.

**The idea.** Since the context switch already lets the OS stop and resume anything, the only remaining question is *whom to pick, and for how long*. That choice is the scheduler. Scheduling is how the OS turns "a few cores" into a responsive, fair, efficient illusion of "a CPU for everyone".

**Why there's no single right answer.** Picking the shortest job first minimises average waiting but can starve long jobs. Taking turns is fair but makes everyone finish later. So "a scheduling algorithm" is really "a choice of which goal to favour".

:::callout[That's all it is]{type=insight}
The scheduler is a function called every few milliseconds that answers: "of everyone who could run right now, who goes next?" Every algorithm is a different answer, tuned for a different goal.
:::

## How It Works

### The CPU–I/O burst cycle

Programs alternate between **CPU bursts** (computing) and **I/O bursts** (waiting). Most bursts are short: interactive and server workloads are dominated by many short CPU bursts between I/O waits; batch jobs have fewer, longer bursts.

- **I/O-bound** threads: short CPU bursts, frequent waits. They should get the CPU quickly when they wake, so the devices stay busy.
- **CPU-bound** threads: long bursts. They can tolerate waiting but shouldn't starve.

### When does the scheduler run?

1. Running → Blocked (I/O request, lock wait) — **must** choose another thread.
2. Running → Ready (timer interrupt, preemption) — **preemptive only**.
3. Blocked → Ready (I/O completion) — may preempt the current thread if the woken one is more urgent.
4. Running → Terminated — must choose another thread.

Non-preemptive scheduling acts only on cases 1 and 4.

### The metrics

You can only compare schedulers if you agree what "better" means — hence these measurements. For each process: **arrival time (AT)**, **burst time (BT)**, **completion time (CT)**, and the time it **first** gets the CPU.

| Metric | Formula | What it measures |
|---|---|---|
| **Turnaround time (TAT)** | `CT − AT` | Total time from submission to completion |
| **Waiting time (WT)** | `TAT − BT` | Time spent ready but not running |
| **Response time (RT)** | `first run − AT` | Time until the first response (interactivity) |
| **Throughput** | completed jobs / time | System productivity |
| **CPU utilization** | busy time / total time | How well the CPU is kept busy |

(If processes also do I/O, WT counts only time in the ready queue; the formula `TAT − BT` assumes pure CPU jobs, which is the textbook convention for numericals.)

### A worked example (FCFS)

| Process | Arrival | Burst |
|---|---|---|
| P1 | 0 | 24 |
| P2 | 1 | 3 |
| P3 | 2 | 3 |

FCFS runs them in arrival order:

```text
| P1                       | P2  | P3  |
0                         24    27    30
```

| | CT | TAT = CT−AT | WT = TAT−BT | RT |
|---|---|---|---|---|
| P1 | 24 | 24 | 0 | 0 |
| P2 | 27 | 26 | 23 | 23 |
| P3 | 30 | 28 | 25 | 25 |
| **Average** | | **26** | **16** | **16** |

Two short jobs wait behind one long job — the **convoy effect**. Running P2 and P3 first (SJF) would give WT = (6 + 0 + 2)/3 ≈ 2.67. Algorithms are compared next in [Scheduling Algorithms](lesson:os-scheduling-algorithms).

::viz{id=cpu-scheduler}

## Internal Mechanism

### Preemption is driven by interrupts

The problem: a running thread will never volunteer to stop if it's in a loop. The kernel needs a way to get the CPU back that the thread can't prevent — a hardware alarm clock. The timer (local APIC timer on x86) interrupts each core periodically or at programmed deadlines. The interrupt handler updates the running thread's accounting; if its **time slice** is used up or a more deserving thread is runnable, it sets a "need reschedule" flag. On the way back to user mode the kernel checks the flag and calls the scheduler. Wakeups (e.g., a packet arriving for a blocked thread) can also set the flag.

### Context-switch overhead is a scheduling cost

Each switch costs ~1–3 µs plus cache/TLB effects ([Context Switching](lesson:os-context-switch)). A time slice (quantum) that is too small wastes CPU in switching; too large makes the system feel unresponsive. If a quantum is `q` and the switch cost is `s`, the fraction of CPU wasted on switching is roughly `s / (q + s)` when every quantum is used fully — 1 µs of switching on a 1 ms quantum is ~0.1%, but on a 10 µs quantum it's ~9%.

### Multiprocessor scheduling

With multiple cores, each core usually has its own run queue (avoiding a global lock), and the kernel periodically **load-balances** by migrating threads. Migration costs cache warmth, so schedulers prefer **affinity** — keeping a thread on the core where its data is cached. Details in [Real Schedulers](lesson:os-mlfq-real-schedulers).

## Example

Interactive vs batch in one machine: your IDE (I/O-bound: waits for keystrokes, runs briefly) and a compiler (CPU-bound). A good scheduler lets the IDE run *immediately* whenever you type (low response time) even though the compiler is using most of the CPU. Linux achieves this because the IDE's thread has accumulated little CPU time, so it's favored when it wakes.

## Complexity & Performance

- Scheduler decisions must be cheap: Linux's CFS/EEVDF picks the next task from a red-black tree in O(log n); older O(1) schedulers used bitmaps of priority queues.
- Minimizing *average* waiting time (SJF) and minimizing *worst-case* waiting (fairness) are different objectives; you can't have both perfectly.

## Trade-offs

| Goal | Favors | Hurts |
|---|---|---|
| Throughput | Long quanta, fewer switches, batching | Response time |
| Response time | Short quanta, preemption, priority to I/O-bound | Throughput (switch overhead) |
| Average turnaround | Shortest-job-first | Fairness (long jobs starve) |
| Fairness | Round robin, fair share | Average turnaround |
| Predictability | Real-time priorities, reservations | Utilization |

## Failure Modes

- **Convoy effect**: short tasks stuck behind a long task (FCFS, or a single lock).
- **Starvation**: low-priority tasks never run under strict priority scheduling (fixed by **aging**).
- **Priority inversion** with locks ([Synchronization Primitives](lesson:os-sync-primitives)).
- **Thrashing on context switches** with tiny quanta or too many runnable threads.

## In Production

- Linux exposes run-queue pressure as **load average**, `procs_running`, and **PSI** (pressure stall information: `/proc/pressure/cpu`) — the latter directly measures time tasks spent waiting for CPU.
- `nice` values and cgroup `cpu.weight` adjust shares; CPU quotas (`cpu.max`) cap usage and cause throttling ([VMs & Containers](lesson:os-virtualization-containers)).
- The same scheduling vocabulary applies to **thread pools and request queues**: FIFO queues cause convoys, priority queues can starve, and response time = wait + service.

## Deeper Connections

- Waiting time is queueing delay — the same concept that drives latency in [overloaded servers](lesson:x-overloaded-server) and [tail latency](lesson:cn-tail-latency).
- Network devices schedule packets with the same trade-offs (FIFO vs fair queuing), and databases schedule queries and I/O.

## Common Misconceptions

- **"Waiting time is time spent blocked on I/O."** In scheduling, waiting time is time spent **ready** but not running.
- **"Response time = turnaround time."** Response time is until *first* execution; turnaround is until *completion*.
- **"Preemptive scheduling is always better."** It improves responsiveness but adds switches and makes shared-data code need synchronization; some real-time and embedded systems deliberately use cooperative scheduling.

## Interview Questions

### [L1 · compare] What is the difference between preemptive and non-preemptive scheduling?

Non-preemptive: once a thread gets the CPU it keeps it until it blocks, yields or finishes. Preemptive: the OS can take the CPU away — on a timer interrupt when the time slice expires, or when a higher-priority thread becomes ready. Preemption gives responsiveness and prevents a runaway thread from monopolizing the CPU, at the cost of more context switches and the need to synchronize shared data.

### [L1 · conceptual] Define turnaround time, waiting time and response time.

Turnaround = completion − arrival (total time in system). Waiting = turnaround − burst (time spent in the ready queue). Response = first time on CPU − arrival (how quickly it first runs).

### [L2 · numerical] P1(AT 0, BT 5), P2(AT 1, BT 3), P3(AT 2, BT 1) under FCFS. Compute average waiting time.

Order P1 [0–5], P2 [5–8], P3 [8–9]. WT: P1 = 0, P2 = 5−1 = 4, P3 = 8−2 = 6. Average = 10/3 ≈ **3.33**.

### [L2 · why] What is the convoy effect?

When short jobs queue behind a long job under FCFS (or behind a long-held lock), they all wait for it, increasing average waiting time and leaving I/O devices idle while I/O-bound jobs wait for the CPU. It's why FCFS performs poorly with mixed workloads.

### [L3 · compare] How does the time quantum affect Round Robin performance?

Too large → RR degenerates to FCFS: poor response time. Too small → excessive context switches: overhead dominates and throughput falls. A common guideline is that ~80% of CPU bursts should be shorter than the quantum, so most jobs finish within one slice, and the quantum should be much larger than the context-switch cost.

### [L3 · debugging] Users report a UI stutters while a background indexing job runs, though CPU is only at 60%. What scheduling issues might be involved?

The indexer may run at the same or higher priority, making the UI thread wait in the run queue after each wakeup (response time), or it may hold locks the UI needs (priority inversion), or cause I/O contention (the UI blocks on disk). Check with scheduling latency tools (`perf sched latency`, PSI), lower the indexer's priority (`nice`, `ionice`, cgroup weights), and ensure the UI thread doesn't share locks with it.

### [L4 · design] You run latency-sensitive API servers and batch analytics on the same Kubernetes nodes. How do you keep API tail latency low?

Isolate via scheduling policy: give API pods guaranteed CPU requests (and consider static CPU manager policy to pin exclusive cores), put batch in a lower QoS class with lower cgroup `cpu.weight`, avoid CPU limits that cause CFS throttling on the API pods, watch PSI/throttling metrics, and consider separate node pools if interference persists (caches, memory bandwidth and I/O are shared too — CPU scheduling alone can't isolate them).

## Practice

### [numeric 16] For P1(AT 0, BT 24), P2(AT 1, BT 3), P3(AT 2, BT 3) under FCFS, what is the average waiting time?

:::answer
P1 waits 0, P2 waits 24 − 1 = 23, P3 waits 27 − 2 = 25 → (0 + 23 + 25)/3 = **16**.
:::

### [mcq] Which metric matters most for an interactive text editor?

- [ ] Throughput
- [ ] CPU utilization
- [x] Response time
- [ ] Turnaround time

Users perceive delay until the editor reacts to input.

## Quick Revision

- Scheduler = policy; dispatcher = mechanism (context switch).
- **Preemptive** (timer/priority can take CPU) vs **non-preemptive** (run until block/exit).
- TAT = CT − AT; WT = TAT − BT; RT = first run − AT; throughput; utilization.
- I/O-bound → short bursts, needs quick response; CPU-bound → long bursts.
- **Convoy effect** (FCFS), **starvation** (priority → aging), quantum too small = overhead, too large = FCFS.
- Goals conflict: throughput vs response vs fairness vs average turnaround.
