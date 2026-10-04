---
title: "System Calls, Interrupts, Exceptions and Traps"
subject: os
level: 9
order: 1
summary: "The precise mechanics of crossing the user/kernel boundary: the syscall instruction, interrupt handling with top and bottom halves, exceptions vs traps, the vDSO, and what each crossing costs."
depth: core
difficulty: 3
minutes: 40
relevance: high
stage: 2
prerequisites: [os-what-an-os-does, os-context-switch]
related: [os-io-models, os-file-descriptors, os-signals, os-hardware-model]
tags: [system call, syscall, interrupt, exception, trap, fault, abort, interrupt handler, top half, bottom half, softirq, vdso, kpti, dma, irq]
---

## Mental Model

The kernel is a building with guarded doors. There are three ways in:

- **System call** — you knock on the front door deliberately with a request form ("please read this file"). *Synchronous and intentional.*
- **Exception** — you trip an alarm by doing something the CPU can't complete (dividing by zero, touching an unmapped page); the guard comes to deal with it. *Synchronous but unintentional.*
- **Interrupt** — someone outside rings the bell (a disk finished, a packet arrived, the timer ticked). The guard stops whatever you were doing to answer it. *Asynchronous — unrelated to your current instruction.*

In all three cases, the CPU switches to kernel mode and jumps to an address **the kernel chose in advance**, never one you chose. That rule is the entire basis of OS protection.

## Definition

- **System call**: a request by a user program for a kernel service, invoked with a dedicated instruction (`syscall` on x86-64, `svc` on ARM64). Arguments pass in registers.
- **Exception**: a synchronous event caused by the executing instruction:
  - **Fault** — correctable; the instruction is re-executed after the handler (page fault).
  - **Trap** — reported after the instruction completes; execution continues at the next instruction (breakpoint `int3`, and historically `int 0x80` system calls).
  - **Abort** — severe, unrecoverable (machine check, double fault).
- **Interrupt**: an asynchronous signal from hardware (device, timer, another CPU via IPI) delivered through the interrupt controller (APIC).

Terminology varies between textbooks ("trap" sometimes means any synchronous kernel entry, including syscalls). Know the distinctions; don't fight about the words.

## Why It Exists

**The problem.** User programs must not access devices, other processes' memory or kernel data directly — yet they need I/O and services. And separately, the kernel must regain control when something happens *outside* the program — a packet arrives, a timer fires — even if the program never asks.

**Without it.** Either programs get full access to hardware (no protection at all), or they're sealed off with no way to do I/O (useless). And without hardware interrupts, the kernel would only run when a program happened to call it.

**The idea.** Make the *only* ways into privileged mode go through doors the kernel installed in advance. Controlled entry points let the kernel validate every request. Hardware events must interrupt whatever is running so devices are serviced promptly and the scheduler can preempt tasks. Program asks → system call. Program trips → exception. World knocks → interrupt. Same door mechanism, three reasons to use it.

:::callout[That's all it is]{type=insight}
There are exactly three ways into the kernel — ask (syscall), stumble (exception), or get interrupted (device/timer) — and all three jump to an address the kernel chose. That one rule is what keeps user programs from taking over the machine.
:::

## How It Works

### Anatomy of a system call (x86-64 Linux)

```c
ssize_t n = read(fd, buf, 4096);
```

::::steps[read() from user mode to kernel and back]
1. **libc wrapper** puts the syscall number (`read` = 0) in `rax` and arguments in `rdi`, `rsi`, `rdx` (then `r10`, `r8`, `r9`).
2. **`syscall` instruction**: the CPU saves the user RIP in `rcx` and flags in `r11`, switches to kernel mode (CPL 0), and jumps to the entry point stored in the `LSTAR` MSR — set by the kernel at boot.
3. **Kernel entry**: switch to the thread's kernel stack, save user registers (building `pt_regs`), apply mitigations (e.g., KPTI page-table switch, speculation barriers).
4. **Dispatch**: index the **system call table** with `rax` → `ksys_read()`. Validate the fd, check that `buf` is a user-space address it's allowed to write, perform the operation (possibly sleeping if data isn't available).
5. **Copy results** to user memory with `copy_to_user` (which handles faults safely).
6. **Exit path**: check for pending signals and whether a reschedule is needed; restore registers; `sysret` returns to user mode at the saved RIP with `rax` = return value (negative errno values become `-1` + `errno` in libc).
::::

### Interrupt handling: top half and bottom half

The tension: an interrupt must be answered *immediately* (or the device's buffer overflows), but processing the data properly (running TCP) takes a while — and while one handler runs, other interrupts wait. The solution is to split the work in two. When a NIC receives packets:

1. The device raises an interrupt; the CPU finishes the current instruction, saves minimal state, switches to kernel mode and jumps through the **IDT** (interrupt descriptor table) to the handler for that vector.
2. **Top half (hard IRQ handler)**: runs with that interrupt line masked, must be **very fast** — acknowledge the device, grab minimal data, schedule deferred work.
3. **Bottom half (softirq / tasklet / workqueue)**: does the heavy lifting later with interrupts enabled — e.g., processing the received packets through the TCP/IP stack (`NET_RX` softirq, with NAPI polling under load).
4. Wake any process waiting for the data (e.g., blocked in `recv`); return to the interrupted code (possibly rescheduling).

Why split? While the top half runs, further interrupts on that line (sometimes all interrupts) are blocked; long handlers would add latency to every other device and could drop events.

### Exceptions in action

- **Page fault** (#PF): the CPU stores the faulting address in CR2; the kernel resolves it or sends SIGSEGV ([Page Faults](lesson:os-page-faults)).
- **Divide error** (#DE): kernel sends `SIGFPE`.
- **Invalid opcode** (#UD): `SIGILL`.
- **Breakpoint** (`int3`): debuggers replace an instruction byte with `0xCC`; the trap lets `gdb` take control.
- **General protection** (#GP): privileged instruction in user mode, bad segment, etc. → `SIGSEGV`.

## Internal Mechanism

### The vDSO: system calls without the kernel

If crossing into the kernel costs ~100 ns+, the cheapest syscall is one you never make. Some calls are frequent and read-only, like `clock_gettime()` and `gettimeofday()`. The kernel maps a small shared library, the **vDSO**, into every process, containing code and a data page the kernel keeps updated (current time, clock parameters). Calling `clock_gettime` then costs ~20 ns with no mode switch. That's why timing calls are cheap on Linux.

:::depth{level=advanced}
### Cost of the boundary and ways around it

A bare syscall round trip costs on the order of 100 ns; with Spectre/Meltdown mitigations (KPTI switching page tables, IBRS/retpolines, clearing buffers on return) it can be several hundred ns. Techniques that reduce crossings:

- **Batching**: `readv`/`writev`, `sendmmsg`/`recvmmsg`, buffered I/O.
- **io_uring**: shared submission/completion rings let a process submit many operations with one syscall — or none, with kernel-side polling (SQPOLL).
- **Kernel bypass**: DPDK (networking) and SPDK (storage) run drivers in user space, polling devices directly.
- **eBPF**: run small verified programs *inside* the kernel (packet filtering with XDP, tracing) instead of shipping data out to user space.
:::

## Example

Counting and timing crossings:

```bash
$ strace -c -f ./server     # per-syscall counts and time
$ perf stat -e 'syscalls:sys_enter_*' -a sleep 5 2>&1 | sort -k1 -n | tail
$ cat /proc/interrupts | head -5   # per-CPU interrupt counts per device
            CPU0       CPU1   ...
  24:   18234871          0   IR-PCI-MSI  nvme0q0
  61:    9123411    8812234   IR-PCI-MSI  eth0-TxRx-0
$ grep -E 'softirq|NET_RX' /proc/softirqs
```

Uneven `/proc/interrupts` columns (all NIC interrupts on CPU0) point to a missing IRQ affinity/RSS configuration — one core saturated with packet processing while others idle.

## Complexity & Performance

| Crossing | Approximate cost |
|---|---|
| vDSO call (clock_gettime) | ~20 ns |
| Simple syscall (getpid) | ~100–300 ns with mitigations |
| Syscall that blocks (read on empty socket) | + context switch out and back (µs) |
| Interrupt handling (top half) | ~1–5 µs including cache effects |
| Page fault (minor) | ~0.5–5 µs |

## Trade-offs

- **Safety vs speed**: every validation and mitigation at the boundary costs time — the reason for batching, io_uring and bypass techniques.
- **Interrupts vs polling**: interrupts are efficient at low rates; polling wins at very high rates (NAPI, DPDK, io_uring SQPOLL).
- **Work in top vs bottom half**: fast top halves improve latency for all devices; deferring work adds a little latency to that device's processing.

## Failure Modes

- **Syscall-heavy code**: tiny unbuffered writes (e.g., `write` per log line or per byte) spending most CPU in `%sys`.
- **Interrupt storms / single-core IRQ saturation**: packet processing pinned to one CPU (`si` time 100% on one core).
- **Long non-preemptible kernel paths** causing latency spikes.
- **EINTR** handling bugs when signals interrupt blocking syscalls ([Signals](lesson:os-signals)).

## In Production

- `%sys` vs `%usr` and `%si`/`%hi` (softirq/hardirq) columns in `mpstat -P ALL 1` locate kernel overhead.
- High-throughput network services configure RSS/RPS, IRQ affinity and NAPI budgets; databases use io_uring (e.g., RocksDB, PostgreSQL's recent async I/O work) to cut syscall overhead.
- `seccomp` filters restrict which syscalls a process may make — the container sandboxing boundary.

## Deeper Connections

- The exit path (signal delivery, rescheduling) connects to [Signals](lesson:os-signals) and [Context Switching](lesson:os-context-switch).
- Blocking inside a syscall is what the [I/O models](lesson:os-io-models) are about.
- Network packet arrival → interrupt → softirq → TCP → socket wakeup is the receive half of every request ([What happens when a socket receives data](uth:tcp-connect)).

## Common Misconceptions

- **"A system call is a context switch."** It's a mode switch; a context switch happens only if the task blocks or is preempted.
- **"Interrupts are only for I/O."** Timers (scheduling), inter-processor interrupts (TLB shootdowns, rescheduling), and error reporting also use them.
- **"gettimeofday is a system call so it's slow."** On Linux it's usually served by the vDSO without entering the kernel.

## Interview Questions

### [L1 · compare] What is the difference between an interrupt and a system call?

A system call is a synchronous, deliberate request from the running program to the kernel via a special instruction. An interrupt is an asynchronous signal from hardware (device, timer, another CPU), unrelated to the current instruction, that makes the CPU run a kernel handler. Both switch to kernel mode and enter at kernel-defined addresses.

### [L1 · compare] What's the difference between a trap/exception and an interrupt?

Exceptions (faults, traps, aborts) are synchronous — caused by the instruction being executed (page fault, divide by zero, breakpoint). Interrupts are asynchronous — caused by external events. Faults re-execute the instruction after handling; traps continue at the next instruction; aborts are unrecoverable.

### [L2 · trace] Walk through what happens when a program calls read() on a file descriptor.

libc places the syscall number and arguments in registers and executes `syscall`. The CPU switches to kernel mode and jumps to the kernel's entry point; the kernel saves user registers, looks up the handler in the syscall table, validates the fd and buffer, and performs the read — from the page cache or by issuing I/O and sleeping until it completes. It copies data to the user buffer, checks for pending signals/rescheduling, restores registers and returns to user mode with the byte count (or −1/errno via libc).

### [L2 · why] Why are interrupt handlers split into a top half and a bottom half?

While the top half runs, the interrupt line (or all interrupts) may be masked, so it must be as short as possible to keep latency low for other devices and avoid lost events. It does minimal work (acknowledge, capture data, schedule processing) and defers heavy work to the bottom half (softirq/tasklet/workqueue), which runs later with interrupts enabled and can be scheduled or throttled.

### [L3 · debugging] A network-heavy service is capped at ~40% of expected throughput; one CPU core shows 100% softirq time while others are idle. What's wrong?

All NIC queues' interrupts and receive processing are landing on a single core — missing or misconfigured RSS (multi-queue NIC), IRQ affinity, or RPS/RFS. Distribute queues across cores (enable multiple queues, set IRQ affinity or irqbalance, enable RPS for single-queue NICs), and align application threads with the cores handling their flows.

### [L3 · why] Why is clock_gettime() so fast on Linux?

It's implemented in the vDSO: the kernel maps a read-only data page with time information into every process and keeps it updated; the vDSO code computes the time in user space without a mode switch, costing tens of nanoseconds.

### [L4 · design] A logging library does one write() syscall per log line; at 200k lines/s per process, %sys dominates. How would you redesign it?

Buffer log lines in memory (per-thread buffers or a lock-free ring) and flush in batches — by size (e.g., 64 KB) or time (e.g., every 100 ms) — using a single `write`/`writev` per batch from a background thread. Bound the buffer and choose a policy when full (drop with a counter, or block). Consider io_uring for asynchronous submission. Trade-off: logs from the last flush interval can be lost on crash — acceptable for most application logs, not for audit logs (which need explicit fsync policy).

## Practice

### [mcq] A page fault is best classified as:

- [ ] An asynchronous interrupt
- [x] A synchronous exception of the fault type (the instruction is restarted)
- [ ] A system call
- [ ] An abort

It's caused by the executing instruction and, once handled, the instruction re-executes.

### [mcq] Which mechanism lets gettimeofday() avoid entering the kernel on Linux?

- [ ] io_uring
- [ ] Signals
- [x] The vDSO
- [ ] DMA

The kernel maps time data and code into user space.

## Quick Revision

- Three kernel entries: **syscall** (sync, deliberate), **exception** (sync, fault/trap/abort), **interrupt** (async, hardware) — all at kernel-chosen addresses.
- Syscall: number + args in registers → `syscall` → kernel stack → syscall table → validate → work (maybe sleep) → check signals/resched → `sysret`.
- Interrupts: IDT → fast **top half** → deferred **bottom half** (softirq/tasklet/workqueue).
- Fault = restart instruction (page fault); trap = continue after (breakpoint); abort = fatal.
- vDSO: time calls without a syscall. Cost of a syscall ~100s of ns → batch, io_uring, bypass.
- Watch `%sys`, `%si`, `/proc/interrupts`.
