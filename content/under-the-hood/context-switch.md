---
title: "What Happens During a Context Switch"
summary: "A timer interrupt fires while thread A runs; microseconds later thread B is running. The trap into the kernel, saving registers, the scheduler's decision, switching stacks and address spaces, and the hidden cost paid afterwards in cold caches."
subjects: [os]
order: 3
related: [os-context-switch, os-syscalls-interrupts, os-scheduling-algorithms, os-mlfq-real-schedulers, os-tlb, os-cpu-caches-contention]
---

Thread A (in process P) is computing on CPU 3. Thread B (in process Q) is runnable and waiting. Here's how the CPU goes from running A to running B.

## [cpu] A timer interrupt arrives

The local APIC timer fires (the kernel programs it for the scheduler tick or a precise deadline). The CPU finishes the current instruction, then traps: it switches to kernel mode, switches to A's kernel stack, and pushes the user instruction pointer, stack pointer and flags ([Syscalls & Interrupts](lesson:os-syscalls-interrupts)).

## [kernel] Save the rest of A's state

The interrupt entry code saves A's general-purpose registers onto its kernel stack. Floating-point/SIMD state (which can be kilobytes with AVX-512) is saved lazily or eagerly depending on the kernel's policy.

## [scheduler] Decide whether to switch

The timer handler updates A's accounting — under CFS/EEVDF, its virtual runtime. The scheduler checks whether A has used its fair share relative to other runnable tasks; if B should run now, it sets a "need reschedule" flag. On the way out of the interrupt, the kernel sees the flag and calls `schedule()` ([Real Schedulers](lesson:os-mlfq-real-schedulers)).

## [scheduler] Pick the next task

`schedule()` puts A back into the run queue (it's still runnable) and picks the task with the earliest deadline / smallest virtual runtime on this CPU's run queue — B.

## [kernel] Switch kernel stacks and registers

`context_switch()` saves A's kernel stack pointer and callee-saved registers in A's task structure, loads B's, and from this instruction on the CPU is executing on B's kernel stack — returning into wherever B was when it last stopped (usually inside `schedule()` itself).

## [mmu] Switch address spaces (if processes differ)

A and B belong to different processes, so the kernel loads Q's page-table root into CR3. Without address-space tags, this flushes the TLB; with PCID, entries are tagged and some survive — but B's translations are probably no longer cached anyway ([TLB](lesson:os-tlb)). Switching between threads of the **same** process skips this step, which is why thread switches are cheaper.

## [kernel] Return to user mode as B

The kernel restores B's user registers from its kernel stack and executes the return-from-interrupt instruction: privilege drops to user mode, and B continues from the exact instruction where it was preempted, unaware it was ever stopped.

## [cpu] The hidden cost: cold caches

The direct cost so far is ~1–3 µs. The larger cost comes next: B's working set isn't in L1/L2 (A's data is), TLB entries must be refilled with page walks, and branch predictors are trained for A. B runs slower for a while — which is why thousands of switches per second per core measurably reduce throughput ([CPU Caches](lesson:os-cpu-caches-contention)). `perf stat -e context-switches,cache-misses` shows both.
