---
title: "Scheduling Algorithms: FCFS, SJF, SRTF, Round Robin and Priority"
subject: os
level: 3
order: 2
summary: "The classic algorithms, worked numerically with Gantt charts — and what each one gets right, gets wrong, and assumes."
depth: core
difficulty: 3
minutes: 50
relevance: essential
stage: 2
prerequisites: [os-scheduling-basics]
related: [os-mlfq-real-schedulers, os-context-switch]
visualizations: [cpu-scheduler]
tags: [fcfs, sjf, srtf, round robin, priority scheduling, starvation, aging, gantt chart, exponential averaging]
---

## Mental Model

Every classic algorithm answers "who next?" with one rule:

| Rule | Algorithm | Personality |
|---|---|---|
| Whoever came first | **FCFS** | Fair in a naive way; convoys |
| Whoever needs the least time | **SJF** (non-preemptive) | Optimal average wait; needs the future |
| Whoever has the least time *remaining* (preempt if a shorter one arrives) | **SRTF** | Even better average; starves long jobs |
| Everyone gets a fixed slice in turn | **Round Robin** | Responsive, fair; more switches |
| Whoever is most important | **Priority** | Expresses importance; starvation without aging |

Real schedulers ([next lesson](lesson:os-mlfq-real-schedulers)) combine these ideas and *estimate* the future from the past.

## Definition

- **FCFS** (First-Come, First-Served): non-preemptive, run in arrival order.
- **SJF** (Shortest Job First): non-preemptive, when the CPU frees up, run the ready job with the smallest next CPU burst.
- **SRTF** (Shortest Remaining Time First): preemptive SJF — if a newly arriving job's burst is shorter than the running job's remaining time, preempt.
- **Round Robin (RR)**: preemptive FCFS with a time quantum `q`; a job that doesn't finish within `q` goes to the back of the ready queue.
- **Priority scheduling**: run the highest-priority ready job (preemptive or not). **Aging** gradually raises the priority of waiting jobs to prevent starvation.

## Why It Exists

Each algorithm optimizes a different metric from [Scheduling Fundamentals](lesson:os-scheduling-basics). Studying them separately exposes the trade-offs cleanly, and interviews test them with numericals because the computation reveals whether you understand preemption and waiting.

## How It Works

We'll use one workload throughout:

| Process | Arrival | Burst | Priority (lower = higher) |
|---|---|---|---|
| P1 | 0 | 8 | 3 |
| P2 | 1 | 4 | 1 |
| P3 | 2 | 9 | 4 |
| P4 | 3 | 5 | 2 |

### FCFS

```text
| P1       | P2   | P3          | P4    |
0          8      12            21      26
```

WT: P1 0, P2 8−1 = 7, P3 12−2 = 10, P4 21−3 = 18 → **average 8.75**.

### SJF (non-preemptive)

At t=0 only P1 is ready → runs to 8. At t=8, ready: P2(4), P3(9), P4(5) → pick P2, then P4, then P3.

```text
| P1       | P2   | P4    | P3          |
0          8      12      17            26
```

WT: P1 0, P2 8−1 = 7, P4 12−3 = 9, P3 17−2 = 15 → **average 7.75**.

### SRTF (preemptive SJF)

- t=0: P1 runs (remaining 8).
- t=1: P2 arrives (4) < P1's remaining 7 → **preempt**, run P2.
- t=2: P3 (9) arrives — not shorter than P2's remaining 3. t=3: P4 (5) — not shorter than P2's remaining 2.
- t=5: P2 done. Ready: P1(7), P3(9), P4(5) → P4.
- t=10: P4 done → P1 (7) → t=17 → P3 → t=26.

```text
|P1| P2   | P4    | P1        | P3          |
0  1      5       10          17            26
```

Completion: P1 17, P2 5, P3 26, P4 10. TAT: 17, 4, 24, 7. WT = TAT − BT: 9, 0, 15, 2 → **average 6.5**.

### Round Robin (q = 4)

Queue discipline: on the same tick, newly arrived processes enter the queue **before** the preempted process is re-appended (the most common textbook convention — always state your convention in an interview).

- 0–4 P1 (rem 4). Arrivals P2(1), P3(2), P4(3) queued; P1 re-appended → queue: P2, P3, P4, P1
- 4–8 P2 done. 8–12 P3 (rem 5) → queue: P4, P1, P3
- 12–16 P4 (rem 1) → queue: P1, P3, P4
- 16–20 P1 done. 20–24 P3 (rem 1) → queue: P4, P3
- 24–25 P4 done. 25–26 P3 done.

```text
| P1  | P2  | P3  | P4  | P1  | P3  |P4|P3|
0     4     8     12    16    20    24 25 26
```

Completion: P1 20, P2 8, P3 26, P4 25. WT: P1 20−0−8 = 12, P2 8−1−4 = 3, P3 26−2−9 = 15, P4 25−3−5 = 17 → **average 11.75**. Worse average waiting than SJF — but look at **response time**: every process got the CPU within 12 time units (P4 first ran at 12), and none waited behind a long job for its first slice.

### Priority (non-preemptive, lower number = higher priority)

t=0 only P1 → runs to 8. Then P2 (1), P4 (2), P3 (4).

```text
| P1       | P2   | P4    | P3          |
0          8      12      17            26
```

Same schedule as SJF here by coincidence: WT average **7.75**. Preemptive priority would preempt P1 at t=1 for P2.

### Summary for this workload

| Algorithm | Avg WT | Preemptive? | Starvation possible? |
|---|---|---|---|
| FCFS | 8.75 | No | No |
| SJF | 7.75 | No | Yes (long jobs) |
| SRTF | **6.5** | Yes | Yes (long jobs) |
| RR (q=4) | 11.75 | Yes | No |
| Priority (non-preemptive) | 7.75 | No | Yes (low priority) |

::viz{id=cpu-scheduler}

## Internal Mechanism

### SJF is optimal — for average waiting time

Proof sketch (exchange argument): if a longer job runs immediately before a shorter one, swapping them reduces the short job's wait by the long job's burst and increases the long job's wait by the short job's burst — a net decrease. Repeating until sorted gives SJF. SRTF is optimal among preemptive policies for average waiting time.

### The catch: nobody knows burst lengths

The OS can't see the future. It **predicts** the next CPU burst from past bursts with **exponential averaging**:

```text
τ(n+1) = α · t(n) + (1 − α) · τ(n)        0 ≤ α ≤ 1
```

`t(n)` is the actual length of the most recent burst, `τ(n)` the previous prediction. α = 0.5 weighs recent and past history equally. With τ₀ = 10, α = 0.5 and observed bursts 6, 4, 6: τ₁ = 8, τ₂ = 6, τ₃ = 6.

### Starvation and aging

Under SJF/SRTF, a long job can wait indefinitely if short jobs keep arriving; under priority scheduling, low-priority jobs can starve. **Aging**: increase a waiting job's priority over time (e.g., +1 every 15 minutes in the classic example), so every job eventually becomes the highest priority. Modern schedulers achieve the same effect by tracking accumulated runtime (a job that has waited has used less CPU, so it's favored).

:::depth{level=advanced}
### Round Robin quantum math

With `n` ready processes and quantum `q`, each gets 1/n of the CPU in chunks of at most `q`, and no process waits more than `(n − 1) × q` before its next slice — a bounded response time that no other classic algorithm guarantees. Adding context-switch cost `s`, the worst-case wait becomes `(n − 1)(q + s)`, and useful CPU fraction is `q / (q + s)`.
:::

## Example

Why web servers don't use FCFS for requests: a single 30-second report request at the head of a FIFO queue delays hundreds of 10 ms requests (convoy). Production systems separate classes of work (separate pools for slow endpoints — effectively multilevel queues) or time-slice via async I/O and preemptive threads.

## Complexity & Performance

| Algorithm | Selection cost | Needs burst knowledge | Context switches |
|---|---|---|---|
| FCFS | O(1) | No | Minimal |
| SJF | O(log n) with a heap | Yes (predicted) | Minimal |
| SRTF | O(log n) | Yes (predicted) | More (on arrivals) |
| RR | O(1) | No | Many (every quantum) |
| Priority | O(log n) or O(1) with bitmaps | No | Depends |

## Trade-offs

- **FCFS**: simplest, no starvation, terrible with mixed job lengths.
- **SJF/SRTF**: best average waiting/turnaround; unfair to long jobs, needs predictions.
- **RR**: best response time and fairness; worse turnaround; quantum tuning.
- **Priority**: expresses importance; requires aging and invites priority inversion.

## Failure Modes

- Starvation of long or low-priority jobs.
- Bad burst predictions → SJF behaves like FCFS or worse.
- RR with too small a quantum → overhead; too large → FCFS convoys.
- Priority inversion when high-priority jobs wait for locks held by low-priority ones.

## In Production

- No general-purpose OS uses pure versions of these; Linux's EEVDF/CFS is a weighted fair scheduler with latency-oriented tweaks, and Windows uses priority classes with dynamic boosts ([Real Schedulers](lesson:os-mlfq-real-schedulers)).
- The ideas are alive in **application-level** scheduling: request queues (FIFO), shortest-job-first for query admission, weighted fair queuing in load balancers and Kubernetes' API priority and fairness, and priority queues in job systems (with aging to avoid starvation).

## Deeper Connections

- SRTF vs RR is the throughput-vs-latency trade-off you'll meet again in network packet scheduling and database admission control.
- Head-of-line blocking in HTTP/1.1 is the network version of the convoy effect ([HTTP/2](lesson:cn-http2)).

## Common Misconceptions

- **"SJF is the best algorithm."** It's optimal for average waiting time only, requires unknowable burst lengths, and starves long jobs.
- **"Round Robin has the lowest waiting time."** It usually has *higher* average waiting/turnaround than SJF; its strength is response time and fairness.
- **"Priority scheduling is inherently unfair."** With aging, every job eventually runs.

## Interview Questions

### [L1 · compare] Compare FCFS, SJF and Round Robin.

FCFS runs jobs in arrival order, non-preemptively: simple, no starvation, but short jobs wait behind long ones (convoy effect). SJF picks the shortest next burst: minimizes average waiting time but needs burst prediction and can starve long jobs. Round Robin gives each job a fixed time quantum in rotation: good response time and fairness, more context switches and higher average turnaround.

### [L1 · compare] What is the difference between SJF and SRTF?

SJF is non-preemptive: once a job starts it runs to completion of its burst. SRTF is the preemptive version: when a new job arrives with a burst shorter than the running job's remaining time, the running job is preempted.

### [L2 · numerical] P1(0,6), P2(1,2), P3(2,8), P4(3,3) as (arrival, burst). Compute average waiting time under SRTF.

t0 P1 (rem 6). t1 P2(2) < 5 → preempt; P2 runs 1–3 done. At t3 ready: P1(5), P3(8), P4(3) → P4 3–6. Then P1 6–11, P3 11–19. CT: P1 11, P2 3, P3 19, P4 6. TAT: 11, 2, 17, 3. WT: 5, 0, 9, 0 → average **3.5**.

### [L2 · how] How can an OS implement SJF when it doesn't know burst lengths?

By predicting the next CPU burst from history using exponential averaging: τ(n+1) = α·t(n) + (1−α)·τ(n). Recent behavior is weighted by α; older history decays geometrically.

### [L2 · conceptual] What is starvation and how does aging solve it?

Starvation: a ready process waits indefinitely because others are always preferred (lower priority, longer burst). Aging increases a process's priority the longer it waits, so eventually it becomes the highest priority and runs.

### [L3 · numerical] With 5 ready processes, Round Robin quantum 20 ms and 1 ms context-switch cost, what is the maximum time a process waits before getting its next turn?

At most (n − 1)(q + s) = 4 × 21 = **84 ms**.

### [L3 · why] Why is Round Robin's average turnaround often worse than FCFS for equal-length jobs?

With equal bursts, RR interleaves all jobs so they all finish near the end, while FCFS finishes them one by one. E.g., three 10-unit jobs with q=1: FCFS completion times 10, 20, 30 (avg 20); RR completes them at ~28, 29, 30 (avg ~29). RR buys response time with turnaround.

### [L4 · design] You're designing a job scheduler for a shared analytics cluster where some queries take seconds and others hours. What policy would you choose?

Avoid FCFS convoys and SJF starvation: use multilevel queues or fair sharing — e.g., weighted fair share per team/user (like Linux's CFS at the job level, or YARN's fair scheduler), with preemption or time-slicing for short interactive queries, admission control to cap concurrency, and aging or deadlines so long jobs make guaranteed progress. Predict query cost from the plan or history to route short queries to a fast lane. Measure queue wait per class.

## Practice

### [numeric 6.5] Using the lesson's workload P1(0,8), P2(1,4), P3(2,9), P4(3,5) under SRTF, what is the average waiting time?

:::answer
Schedule: P1 0–1, P2 1–5, P4 5–10, P1 10–17, P3 17–26. WT = P1 9, P2 0, P3 15, P4 2 → 26/4 = **6.5**.
:::

### [numeric 4.67 ±0.01] P1(0,5), P2(0,3), P3(0,1) all arrive at time 0. Under non-preemptive SJF, what is the average turnaround time? (2 decimals)

:::answer
SJF order: P3, P2, P1 → completion times 1, 4, 9. Since all arrive at 0, TAT = CT: (1 + 4 + 9) / 3 = 14/3 ≈ **4.67**.
:::

### [numeric 5] Exponential averaging with α = 0.5, initial prediction τ₀ = 10, observed bursts 6 then 2. What is the prediction τ₂?

:::answer
τ₁ = 0.5·6 + 0.5·10 = 8. τ₂ = 0.5·2 + 0.5·8 = 1 + 4 = **5**.
:::

## Quick Revision

- **FCFS**: arrival order; convoy effect.
- **SJF**: shortest burst next; optimal average WT; needs prediction; starves long jobs.
- **SRTF**: preemptive SJF; best average WT; more switches; starvation.
- **RR**: quantum q; bounded response `(n−1)(q+s)`; fair; worse turnaround.
- **Priority**: starvation → **aging**; priority inversion with locks.
- Prediction: `τ(n+1) = α·t(n) + (1−α)·τ(n)`.
- In interviews, draw the Gantt chart and state tie-breaking/queue conventions.
