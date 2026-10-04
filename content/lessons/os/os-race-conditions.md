---
title: "Race Conditions: Atomicity, Visibility and Ordering"
subject: os
level: 2
order: 3
summary: "Why counter++ breaks with two threads, the three separate things that go wrong with shared memory, and what memory models and happens-before actually mean."
depth: core
difficulty: 3
minutes: 45
relevance: essential
stage: 2
prerequisites: [os-threads]
related: [os-sync-primitives, os-critical-section-problem, os-atomic-instructions, os-cpu-caches-contention, db-anomalies]
visualizations: [race-condition]
tags: [race condition, data race, critical section, atomicity, visibility, ordering, memory model, happens-before, volatile, check-then-act]
---

## Mental Model

Two cashiers share one notebook with the day's total. Each sale: **read** the total, **add** the sale in their head, **write** the new total. If both read "100" at the same moment, one adds 5 and writes 105, the other adds 7 and writes 107 — and the 5 is lost forever.

That's a race condition: **the result depends on the timing of operations that you didn't control.** With threads, three different things can betray you, and it's worth separating them:

1. **Atomicity** — an operation you think of as one step is actually several, and another thread can slip in between.
2. **Visibility** — a write by one thread may not be seen by another thread (for a while, or ever), because it's sitting in a register, a cache or a store buffer.
3. **Ordering** — the compiler and CPU may reorder your reads and writes; another thread can observe them in an order your code never "wrote".

Locks fix all three at once, which is why they're the default tool. Understanding the three separately is what lets you reason about atomics, `volatile`, lock-free code, and double-checked locking.

## Definition

- **Race condition**: a situation where correctness depends on the relative timing or interleaving of concurrent operations.
- **Data race** (in C/C++/Java memory models): two threads access the same memory location concurrently, at least one is a write, and they are not ordered by synchronization. A data race is a specific, formally-defined kind of race; in C/C++ it is *undefined behavior*.
- **Critical section**: a region of code that accesses shared state and must not be executed by more than one thread at a time.

Not every race condition is a data race: two properly locked operations can still race at a higher level (check-then-act across two locked calls).

## Why It Exists

Race conditions aren't a feature someone designed; they're the bill for two decisions that were each sensible on their own.

**Decision 1: share memory.** Shared memory makes communication between threads cheap — no copies, no syscalls.

**Decision 2: make one thread fast.** The hardware and compiler were optimized for **single-threaded** speed: they cache values in registers, buffer writes, and reorder instructions whenever a *single* thread couldn't tell the difference.

**The collision.** Another thread can tell. Each of the three failure kinds maps to one of those speed tricks: operations split into several steps (atomicity), values parked in registers and buffers (visibility), and instructions shuffled (ordering).

**The fix, in one idea.** Mark the places where threads interact, and at those places — *only* there — switch the speed tricks off. That's what locks, atomics and `volatile` do; the rest of the code stays fast.

:::callout[That's all it is]{type=insight}
A race is two threads touching the same data with nothing saying who goes first. Every fix is a way of saying who goes first, and of making sure the second one sees what the first one wrote.
:::

## How It Works

### Atomicity: counter++ is three instructions

```c
int counter = 0;              // shared
void *work(void *_) {
    for (int i = 0; i < 1000000; i++) counter++;
    return NULL;
}
// two threads run work(); expected 2,000,000 — typically prints something like 1,294,712
```

`counter++` compiles to roughly:

```text
mov  eax, [counter]    ; LOAD
add  eax, 1            ; ADD
mov  [counter], eax    ; STORE
```

A lost update happens with this interleaving:

| Time | Thread A | Thread B | counter in memory |
|---|---|---|---|
| 1 | LOAD → 5 | | 5 |
| 2 | | LOAD → 5 | 5 |
| 3 | ADD → 6 | | 5 |
| 4 | | ADD → 6 | 5 |
| 5 | STORE 6 | | 6 |
| 6 | | STORE 6 | **6** (should be 7) |

::viz{id=race-condition}

### Check-then-act and read-modify-write

The same pattern appears at every level of software:

```java
// check-then-act: two threads can both see "absent" and both insert
if (!map.containsKey(key)) {
    map.put(key, compute(key));
}

// lazy initialization race: two instances get created
if (instance == null) instance = new Singleton();
```

Each individual call may be thread-safe (e.g., a `ConcurrentHashMap`), yet the **combination** isn't. Fixes: make the compound action atomic (`map.computeIfAbsent(...)`), or hold one lock across the check and the act.

### Visibility: the flag that never changes

```java
boolean running = true;              // NOT volatile
// Thread 1
while (running) { doWork(); }
// Thread 2
running = false;                      // Thread 1 may loop forever
```

The JIT is allowed to hoist the read of `running` out of the loop (it never changes *within this thread*), so Thread 1 never re-reads it. Declaring it `volatile` (Java) or `std::atomic<bool>` (C++) forbids that and guarantees the write becomes visible.

### Ordering: publication without happens-before

```c
// Thread 1                          // Thread 2
data = 42;                           while (!ready) ;
ready = 1;                           print(data);   // may print 0!
```

Without synchronization, the compiler or CPU may make `ready = 1` visible before `data = 42` (store reordering, or the reader's loads reordered). Thread 2 then sees `ready` but stale `data`. Making `ready` an atomic with **release** semantics on the write and **acquire** on the read establishes a **happens-before** edge: everything Thread 1 wrote before the release is visible to Thread 2 after its acquire.

## Internal Mechanism

### Why hardware reorders

Each of these exists because waiting is slow: a core that waited for every write to reach shared cache, or executed strictly one instruction after another, would be several times slower.

- **Store buffers**: a core's writes go into a private store buffer and drain to cache later, so its *own* reads see them but other cores don't yet. On x86 this allows store→load reordering; ARM and POWER are weaker and allow more reorderings.
- **Out-of-order execution and speculation**: loads may execute before earlier loads/stores if the core predicts no dependency.
- **Compiler optimizations**: register allocation, hoisting, dead-store elimination, instruction scheduling — all legal for single-threaded semantics.

### Memory models and happens-before

The problem: if hardware and compilers may reorder anything a single thread can't notice, programmers need a *contract* stating which orderings other threads are guaranteed to see. A **memory model** (Java JMM, C/C++11, Go) specifies which values a read may observe. The key relation is **happens-before**:

- program order within a thread;
- unlock of a mutex → subsequent lock of the same mutex;
- write to a `volatile`/atomic (release) → a read that sees that value (acquire);
- thread start → actions in the started thread; actions in a thread → `join` returning.

If every conflicting pair of accesses is ordered by happens-before, the program is **data-race-free**, and the model guarantees **sequential consistency** for it (DRF-SC): you can reason as if all operations interleaved in some single order. That's the deal locks give you.

:::depth{level=advanced}
### Memory barriers

Atomics and locks are implemented with **fences/barriers** — instructions that restrict reordering (`mfence`, locked instructions on x86; `dmb` on ARM; load-acquire/store-release instructions `ldar`/`stlr` on ARMv8). A mutex's lock acts as an acquire barrier and unlock as a release barrier, which is why code inside a critical section sees everything the previous holder wrote. Lock-free code chooses weaker orderings (`memory_order_relaxed`, `acquire`, `release`) for speed — correctly doing so is expert territory.
:::

## Example

Three fixes for the counter, with different costs:

```c
// 1) Mutex — general, slower under contention
pthread_mutex_lock(&m);  counter++;  pthread_mutex_unlock(&m);

// 2) Atomic read-modify-write — one hardware instruction (lock xadd on x86)
atomic_fetch_add(&counter, 1);

// 3) No sharing — each thread counts locally, combine at the end (fastest)
long local = 0;  for (...) local++;  atomic_fetch_add(&counter, local);
```

The third is a general principle: **the best synchronization is no sharing.** Partition work, use thread-local accumulation, and merge.

## Complexity & Performance

- An uncontended mutex or atomic costs ~10–25 ns; a contended one can cost microseconds (cache-line transfers, kernel futex waits).
- Many threads doing `atomic_fetch_add` on one counter still serialize on its cache line — thousands of cycles of coherence traffic per operation under heavy contention. Striped counters (`LongAdder` in Java) spread the updates across cells.

## Trade-offs

| Approach | Guarantees | Cost | Risk |
|---|---|---|---|
| Mutex around shared state | Atomicity + visibility + ordering | Blocking, contention | Deadlock, convoys |
| Atomics | Single-variable atomicity + chosen ordering | Cheap-ish | Compound invariants still unprotected |
| `volatile` (Java) | Visibility + ordering for that variable | Cheap | Doesn't make `x++` atomic |
| Immutability | No writes → nothing to race | Allocation | None for the shared data |
| Confinement / no sharing | Nothing to race | Design effort | None |

## Failure Modes

- **Heisenbugs**: races that vanish under a debugger or with logging (which adds synchronization and changes timing).
- **Rare corruption** of data structures (a `HashMap` resized by two threads in older Java versions could create a cycle, causing infinite loops at 100% CPU).
- **Security**: TOCTOU (time-of-check to time-of-use) — checking a file's permissions, then opening it, while an attacker swaps it via a symlink in between.
- **Database-level races**: lost updates and write skew are the same pattern across transactions ([Anomalies](lesson:db-anomalies)).

## In Production

- Tools: ThreadSanitizer (`-fsanitize=thread`) for C/C++/Go (`go test -race`), Java's jcstress for memory-model tests, and code review rules ("every field is either final, volatile, confined, or guarded by a named lock").
- Double-checked locking for singletons is correct in Java only with a `volatile` field — otherwise another thread can see a non-null reference to a partially constructed object (ordering!).
- Rate limiters, inventory counters and idempotency checks in services are all check-then-act problems; the robust fix is an atomic operation in the data store (`UPDATE ... SET stock = stock - 1 WHERE stock > 0`, Redis `INCR`, `SETNX`).

## Deeper Connections

- The critical-section requirements (mutual exclusion, progress, bounded waiting) are formalized in [The Critical-Section Problem](lesson:os-critical-section-problem).
- Atomic instructions (CAS, fetch-and-add) are the hardware foundation of every lock ([Atomic Instructions](lesson:os-atomic-instructions)).
- The same three problems recur in distributed systems: atomicity (transactions), visibility (replication lag), ordering (causal consistency) — see [Consistency Models](lesson:db-consistency-models).

## Common Misconceptions

- **"x++ is atomic."** It's a read-modify-write of three steps.
- **"volatile makes code thread-safe."** In Java it gives visibility and ordering for single reads/writes, not atomic compound operations. In C/C++, `volatile` has *nothing* to do with threads (it's for memory-mapped I/O); use `std::atomic`.
- **"Races can't happen on a single core."** Preemption can interleave threads between any two instructions.
- **"Using a thread-safe collection makes my code thread-safe."** Compound operations across calls still race.
- **"If it passed tests, there's no race."** Races are timing-dependent; tests rarely hit the bad interleaving.

## Interview Questions

### [L1 · conceptual] What is a race condition? Give an example.

A bug where the outcome depends on the uncontrolled timing or interleaving of concurrent operations. Example: two threads increment a shared counter; `counter++` is load-add-store, so both can load the same value and one increment is lost.

### [L1 · conceptual] What is a critical section?

A section of code that accesses shared mutable state and must be executed by at most one thread at a time to keep that state consistent — e.g., the code that updates a shared account balance. It's protected by a mutual-exclusion mechanism such as a mutex.

### [L2 · compare] Explain atomicity, visibility and ordering in the context of multithreading.

Atomicity: an operation executes as an indivisible unit — no other thread can observe or interleave with a partial state (`x++` isn't atomic). Visibility: a write by one thread is eventually and reliably seen by others (values can linger in registers/caches/store buffers). Ordering: the order in which one thread's memory operations become visible to another matches the program order where it matters (compilers and CPUs reorder). Locks provide all three; `volatile` in Java provides visibility and ordering but not compound atomicity.

### [L2 · trace] Two threads each execute counter++ once, starting from 0. What final values are possible and why?

2 (if one completes its load-add-store before the other loads) or 1 (if both load 0 before either stores). It can't be 0 because both stores write at least 1.

### [L3 · why] Why is double-checked locking broken in Java without volatile?

`instance = new Singleton()` involves allocating memory, running the constructor, and publishing the reference. Without `volatile`, the reference write can become visible to another thread before the constructor's field writes. A second thread passes the unsynchronized `if (instance == null)` check, sees a non-null reference and uses a partially constructed object. `volatile` makes the publication a release/acquire pair, ordering the constructor writes before the reference.

### [L3 · what-if] A worker thread loops on `while (!stop) {}` and another thread sets `stop = true`, but the worker never exits. Why?

Visibility and compiler optimization: `stop` isn't volatile/atomic, so the compiler/JIT may read it once and keep it in a register (or hoist it out of the loop), since nothing in the loop changes it from this thread's perspective. Make it `volatile` (Java) or `std::atomic<bool>` (C++), or read it under a lock.

### [L3 · debugging] An e-commerce service occasionally oversells the last item in stock. Code: `if (stock > 0) { stock = stock - 1; createOrder(); }`. What's wrong and how would you fix it across multiple app instances?

Check-then-act race: two requests both read `stock = 1`, both pass the check, both decrement. With multiple instances, in-process locks don't help. Make the check-and-decrement atomic in the database: `UPDATE items SET stock = stock - 1 WHERE id = ? AND stock > 0` and create the order only if one row was updated — or use `SELECT ... FOR UPDATE` in a transaction, or optimistic concurrency with a version column. This is the lost-update anomaly at the database level.

### [L4 · design] How would you design a high-throughput counter (millions of increments per second from 64 threads) where reads are rare?

Avoid a single contended cache line. Use striped/sharded counters: each thread (or CPU) increments its own padded cell (avoid false sharing with cache-line padding); reads sum the cells (Java's `LongAdder`, Linux per-CPU counters). Reads are approximate at the moment of summation, which is fine for metrics. If exact reads are needed at high frequency, reconsider the design (batch updates, a single writer thread consuming a queue).

## Practice

### [mcq] Which Java construct guarantees that a write to a boolean flag by one thread becomes visible to another thread that reads it in a loop?

- [ ] Declaring the flag `static`
- [x] Declaring the flag `volatile`
- [ ] Declaring the flag `final` and reassigning it
- [ ] Wrapping the read in a try/catch

`volatile` reads/writes establish happens-before and forbid caching the value in a register.

### [mcq] Which of these is a check-then-act race even if `map` is a ConcurrentHashMap?

- [x] `if (!map.containsKey(k)) map.put(k, v);`
- [ ] `map.putIfAbsent(k, v);`
- [ ] `map.computeIfAbsent(k, f);`
- [ ] `map.get(k);`

Each call is thread-safe individually, but the pair isn't atomic.

### [exercise] Two threads each run `for (i=0;i<3;i++) x++;` on a shared x starting at 0, where x++ is load/add/store. What is the minimum possible final value?

:::solution
**2**. It is not 3 as many guess. One schedule: A loads 0 (holds it). B completes two full iterations (x = 2). A stores 1 (x = 1). B loads 1 for its last iteration. A completes its remaining two iterations (x = 3). B stores 2. Final x = 2. The intuition "at least one thread's increments survive" is wrong: stale stores can overwrite each other's progress.
:::

## Quick Revision

- Race condition = outcome depends on timing. Data race = unsynchronized conflicting accesses (UB in C/C++).
- Three problems: **atomicity** (`x++` = load/add/store), **visibility** (registers, caches, store buffers), **ordering** (compiler + CPU reordering).
- **Happens-before**: unlock→lock, volatile/atomic release→acquire, thread start/join. Data-race-free programs behave sequentially consistently.
- Fixes: mutex (all three), atomics (single variable), `volatile` (visibility/ordering only), immutability, confinement.
- **Check-then-act** races survive thread-safe collections; make the compound operation atomic.
- Same pattern in DBs: lost update, write skew.
