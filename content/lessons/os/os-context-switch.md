---
title: "Context Switching: What It Is and What It Really Costs"
subject: os
level: 1
order: 4
summary: "Exactly what the kernel saves and restores when it switches from one task to another, why thread switches are cheaper than process switches, and why the indirect costs dominate."
depth: core
difficulty: 3
minutes: 30
relevance: essential
stage: 1
prerequisites: [os-processes, os-hardware-model]
related: [os-threads, os-scheduling-basics, os-tlb, os-cpu-caches-contention, os-syscalls-interrupts]
visualizations: [context-switch]
tags: [context switch, mode switch, pcb, tlb flush, cache pollution, voluntary, involuntary, cs]
---

## Mental Model

A context switch is a **chess grandmaster playing 30 simultaneous games**. To move from board A to board B, they must remember exactly where A stood (save context), walk to B, re-read B's position (restore context), and only then think about B. The walk itself is quick — the expensive part is that the grandmaster's head was full of A's tactics, and it takes a while to "load" B's position mentally.

For a CPU, saving and restoring registers is the walk (~a microsecond). **Re-warming caches and the TLB for the new task is the mental reload** — and it can cost far more.

## Definition

A **context switch** is the kernel suspending the currently running task (thread) on a CPU, saving its execution state, and resuming a different task by restoring its previously saved state.

Two related but distinct terms:

- **Mode switch**: user mode → kernel mode and back (every system call or interrupt). The same task keeps running; no context switch necessarily happens.
- **Process switch vs thread switch**: switching between threads of *different* processes also switches the address space; switching between threads of the *same* process does not.

## Why It Exists

It is the mechanism that implements multitasking. Without it, a CPU could run only one task until that task finished. Context switches let the OS:

- run another task while one waits for I/O (**voluntary** switch — the task blocked);
- share the CPU fairly among runnable tasks (**involuntary** switch — preemption by the timer or by a higher-priority wakeup).

## How It Works

::::steps[A timer-driven switch from task A to task B]
1. Task A is running in user mode. The **timer interrupt** fires.
2. The CPU switches to kernel mode, onto A's **kernel stack**, and saves A's user registers (PC, SP, flags, general registers) there.
3. The kernel's interrupt handler updates accounting and asks the **scheduler**: should A keep running? A has used its time slice and B is runnable, so: switch.
4. The kernel saves A's remaining kernel-side state (callee-saved registers, kernel stack pointer; FPU/SIMD state may be saved lazily or eagerly) into A's task structure. A goes back to the run queue (**Ready**).
5. If B belongs to a **different process**, the kernel loads B's page-table root (CR3 on x86). Without PCID/ASID support, this flushes non-global TLB entries.
6. The kernel switches to B's kernel stack and restores B's saved registers.
7. Return from interrupt to user mode — B continues exactly where it was paused, unaware that anything happened.
::::

::viz{id=context-switch}

## Internal Mechanism

### Direct vs indirect cost

| Cost | Typical magnitude | Where it comes from |
|---|---|---|
| **Direct** — save/restore registers, scheduler decision, kernel entry/exit | ~1–3 µs | Kernel code path, mitigations (KPTI, IBPB) |
| **TLB** — address-space change invalidates cached translations | Up to tens of µs of extra misses | Every memory access in B re-walks page tables until the TLB is warm |
| **CPU caches** — B's working set isn't in L1/L2 (and A's gets evicted) | Can be 10s–100s of µs of slowdown | Cache misses at ~100 ns each |
| **Pipeline/branch predictor state** | Smaller but real | Predictors trained on A |

So a switch can "cost" 1–3 µs in isolation but slow down the next stretch of execution much more. That's why systems with **hundreds of thousands of switches per second** show high CPU usage without doing more work.

### Thread switch vs process switch

Threads of the same process share one address space, so step 5 is skipped: no page-table change, no TLB flush, and shared data may still be cache-warm. That's the main reason thread switches are cheaper than process switches. Modern CPUs soften the process-switch penalty with **PCID/ASID** tags so TLB entries of different address spaces can coexist.

### Mode switch ≠ context switch

A `getpid()` system call enters and leaves the kernel without switching tasks — the same task continues. A context switch happens only if the scheduler chooses a different task (because the current one blocked, was preempted, or yielded).

### Voluntary vs involuntary

- **Voluntary**: the task blocked (I/O, lock, sleep, `futex` wait). High counts → lots of waiting (I/O-bound, lock contention).
- **Involuntary**: the task was preempted while runnable. High counts → CPU oversubscription (more runnable threads than cores).

```bash
$ grep ctxt /proc/<pid>/status
voluntary_ctxt_switches:        1523
nonvoluntary_ctxt_switches:     87
$ pidstat -w 1        # per-process cswch/s and nvcswch/s
$ vmstat 1            # "cs" column: system-wide switches per second
```

## Example

A thread pool with 400 threads on an 8-core machine serving CPU-bound requests:

- 400 runnable threads compete for 8 cores → constant preemption → `nvcswch/s` in the tens of thousands.
- Each switch pollutes caches; throughput *drops* compared to a pool of ~8–16 threads, and tail latency rises because each request's work is time-sliced among many others.

Shrinking the pool to roughly the core count (for CPU-bound work) or moving I/O waits to async I/O reduces switches and improves both throughput and P99. See [Thread Pools](lesson:os-thread-pools).

## Complexity & Performance

- Direct cost scales with the amount of state (AVX-512 registers are large; FPU state saving is a notable part).
- Rule of thumb: **10k switches/s per core is fine; 100k+/s per core is a smell** worth investigating.
- Blocking I/O with a thread per connection generates two switches per request wait (block + wake). Event loops (epoll) replace many of these with a few syscalls — see [epoll & Event Loops](lesson:os-epoll-event-loops).

## Trade-offs

- **Short time slices** → better responsiveness, more switches, more cache pollution. **Long slices** → better throughput, worse latency for interactive tasks. Schedulers tune this ([Scheduling](lesson:os-scheduling-basics)).
- **Many threads** simplify blocking-style code; **few threads + async I/O** reduce switches but complicate code.
- **User-level threads** (goroutines, Java virtual threads) switch in user space without kernel involvement — ~100–200 ns — by multiplexing many lightweight tasks onto few kernel threads.

## Failure Modes

- **Context-switch storms** from oversized thread pools, lock convoys (many threads waking to fight over one lock), or busy `sched_yield` loops.
- **Priority/affinity mistakes** that bounce a thread between cores, destroying cache locality (migrations are visible in `perf sched`).
- **Noisy neighbors** in containers: CPU throttling from cgroup quotas causes involuntary descheduling and latency spikes.

## In Production

- Case study: [High context switching](case:context-switch-storm).
- Latency-sensitive systems (trading, high-performance networking) **pin** threads to cores, isolate CPUs from the scheduler (`isolcpus`, `nohz_full`), and busy-poll to avoid switches entirely.
- Databases: PostgreSQL's process-per-connection model means thousands of connections → thousands of processes → heavy switching; poolers keep the number of active backends near the core count.

## Deeper Connections

- The saved state lives in the [PCB](lesson:os-processes); the choice of the next task is the [scheduler](lesson:os-scheduling-basics).
- The TLB cost links to [TLB](lesson:os-tlb); cache pollution links to [CPU Caches & Contention](lesson:os-cpu-caches-contention).
- Every blocking network or disk operation in a thread-per-request server implies context switches — the root motivation for [I/O models](lesson:os-io-models).

## Common Misconceptions

- **"Every system call is a context switch."** It's a mode switch; a context switch happens only if the scheduler runs a different task.
- **"A context switch costs a few microseconds, so it's negligible."** The indirect cost (cold TLB and caches) often dominates.
- **"Thread switches are free."** They are cheaper than process switches but still involve the kernel (for kernel threads) and cache effects.

## Interview Questions

### [L1 · conceptual] What is a context switch?

The kernel saving the state (registers, program counter, stack pointer, and for a different process the address-space pointer) of the currently running task into its PCB/task structure and restoring the saved state of another task so it continues where it left off. It is how one CPU is multiplexed among many tasks.

### [L1 · compare] What triggers a context switch?

Voluntary: the running task blocks (I/O, lock, sleep) or yields. Involuntary: the timer interrupt ends its time slice, or a higher-priority task becomes runnable and preempts it. Also, a task exiting causes a switch to the next one.

### [L2 · compare] Why is switching between threads of the same process cheaper than switching between processes?

Threads share an address space, so the kernel doesn't change the page-table root, avoiding TLB invalidation, and shared data may remain cache-warm. A process switch changes CR3, which (without PCID/ASID) flushes the TLB, and the new process's working set is likely cold in caches. Register save/restore is similar in both cases.

### [L2 · compare] What's the difference between a mode switch and a context switch?

A mode switch is a CPU privilege change (user ↔ kernel) during a syscall, interrupt or exception; the same task continues. A context switch replaces the running task with another. A syscall always involves mode switches; it causes a context switch only if the task blocks or the scheduler decides to preempt it.

### [L3 · debugging] vmstat shows 400,000 context switches per second on a 16-core API server and throughput is lower than expected. How do you investigate?

Determine voluntary vs involuntary with `pidstat -w 1`. Mostly involuntary → too many runnable threads for the cores (oversized pools, CPU throttling by cgroup quotas): check run-queue length (`vmstat r` column, load average), thread counts, and cgroup throttling stats. Mostly voluntary → threads blocking and waking frequently: lock contention (`perf lock`, futex syscalls in `strace -c`), tiny blocking I/O operations, or wake-up storms (condition variable broadcast). Fixes: right-size pools, reduce lock granularity, batch I/O, move to async I/O.

### [L3 · why] Why can reducing the number of threads increase throughput for CPU-bound work?

With more runnable threads than cores, the scheduler time-slices them: each switch costs direct time and evicts cache/TLB state, so each thread runs with colder caches. With threads ≈ cores, each thread keeps a core and warm caches, and no CPU time is wasted switching. Total useful work per second rises and latency becomes more predictable.

### [L4 · design] You need sub-10 µs p99 processing latency for a market-data handler on Linux. How do you minimize context-switch effects?

Pin the processing thread to a dedicated core, isolate that core from the general scheduler (`isolcpus`/cpusets, `nohz_full` to stop the tick, move IRQs away with IRQ affinity), busy-poll the NIC or a lock-free queue instead of blocking (no voluntary switches), avoid syscalls in the hot path (kernel-bypass networking), pre-fault and lock memory (`mlockall`, huge pages) to avoid page faults, and keep other threads off that core. Accept the cost: dedicated cores at 100% utilization regardless of load.

## Practice

### [mcq] Which step is skipped when switching between two threads of the same process?

- [ ] Saving the program counter
- [ ] Choosing the next task
- [x] Switching the page-table root (address space)
- [ ] Restoring the stack pointer

Same process → same address space → no page-table switch and no TLB flush.

### [mcq] A process shows mostly *involuntary* context switches. What does that most likely indicate?

- [ ] It frequently waits on disk I/O
- [x] It is often preempted while still runnable — CPU contention
- [ ] It holds a lock for a long time
- [ ] It makes many system calls

Involuntary switches happen when a runnable task is preempted — typically more runnable tasks than CPUs, or cgroup throttling.

## Quick Revision

- Context switch = save task A's registers/state, (switch address space if different process), restore task B.
- Triggers: **voluntary** (block/yield) vs **involuntary** (preemption).
- **Direct cost** ~1–3 µs; **indirect cost** (cold TLB + caches) often larger.
- Thread switch < process switch because no page-table/TLB change.
- Mode switch (syscall) ≠ context switch.
- Diagnose with `vmstat` (cs), `pidstat -w`, `/proc/<pid>/status`.
- Fix storms: right-size thread pools, reduce lock contention, async I/O, pinning for latency-critical work.
