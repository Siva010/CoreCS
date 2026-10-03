---
title: "The Concurrency Toolbox: Mutex, Spinlock, RW Lock, Semaphore, Condition Variable, Monitor, Barrier"
subject: os
level: 2
order: 4
summary: "What each synchronization primitive is for, how it behaves under contention, and how to pick the right one — the practical guide before the theory."
depth: core
difficulty: 3
minutes: 45
relevance: essential
stage: 2
prerequisites: [os-race-conditions]
related: [os-semaphores-monitors, os-atomic-instructions, os-classic-sync-problems, os-deadlocks, db-locking]
visualizations: [race-condition]
tags: [mutex, spinlock, read-write lock, semaphore, condition variable, monitor, barrier, futex, synchronized, lock contention]
---

## Mental Model

Every primitive answers one question about shared state:

| Question | Primitive |
|---|---|
| "Only one of us may touch this at a time." | **Mutex** (or **spinlock** if the wait is tiny) |
| "Many may read at once, but a writer needs it alone." | **Read-write lock** |
| "At most N of us may use this pool at once." | **Counting semaphore** |
| "Wait until some condition about the state becomes true." | **Condition variable** (always with a mutex) |
| "Bundle the lock and the conditions into the object itself." | **Monitor** (`synchronized` + `wait/notify`) |
| "Nobody continues until all of us arrive." | **Barrier** |

Most real bugs come from using the right primitive incorrectly (forgetting the `while` loop around a condition wait) or the wrong primitive (a semaphore where a mutex was meant).

## Definition

- **Mutex (mutual-exclusion lock)**: a lock with an **owner**; `lock()` blocks until free, `unlock()` by the owner releases it.
- **Spinlock**: a lock where waiters **busy-wait** (spin) instead of sleeping.
- **Read-write lock**: allows either multiple concurrent readers or one exclusive writer.
- **Semaphore**: an integer counter with atomic `wait/P/down` (decrement, block if it would go below zero) and `signal/V/up` (increment, wake a waiter). **Binary semaphore** = counter limited to 0/1.
- **Condition variable**: a queue of threads waiting for a condition; used with a mutex via `wait(mutex)`, `signal()`, `broadcast()`.
- **Monitor**: an object whose methods execute under one implicit mutex, with condition variables for waiting.
- **Barrier**: blocks threads until a fixed number have reached it.

## Why It Exists

Race conditions ([previous lesson](lesson:os-race-conditions)) need two capabilities: **mutual exclusion** (don't interleave inside critical sections) and **coordination** (wait for something another thread will do). Mutexes and RW locks provide exclusion; semaphores, condition variables and barriers provide coordination. Busy-waiting on a flag would waste CPU and still have visibility/ordering issues — primitives solve both correctly and efficiently.

## How It Works

### Mutex

```c
pthread_mutex_lock(&account->lock);
if (account->balance >= amount) account->balance -= amount;   // critical section
pthread_mutex_unlock(&account->lock);
```

Rules: lock, do the minimum, unlock — **on every path** (use RAII `std::lock_guard`, `try/finally`, `with` blocks). Keep critical sections short; never call slow or unknown code (I/O, callbacks) while holding a lock.

### Spinlock vs sleeping mutex

- A **spinlock** waiter loops on an atomic test until the lock is free. Excellent when the lock is held for less time than a context switch (~µs) *and* the holder is running on another core. Terrible if the holder is descheduled — waiters burn their whole time slice.
- A **sleeping mutex** puts the waiter to sleep (kernel involvement) and wakes it on unlock.
- Modern mutexes are **adaptive**: spin briefly, then sleep. On Linux they're built on **futexes** — the uncontended lock/unlock is a single atomic instruction in user space; only contended cases enter the kernel.

In the kernel, spinlocks are common (and interrupts may be disabled while holding one) because kernel code often *can't* sleep. In user space, prefer mutexes.

### Read-write lock

Useful when reads dominate and critical sections are long enough for reader parallelism to matter (e.g., a routing table read on every request, updated every minute). Pitfalls:

- **Writer starvation** with reader-preferring locks (a continuous stream of readers means the writer never gets in); writer-preferring locks can starve readers.
- For very short critical sections, an RW lock can be *slower* than a mutex — the readers still contend on the lock's internal counter cache line.
- Upgrading a read lock to a write lock usually deadlocks if two readers try simultaneously.

### Semaphore

```python
db_slots = threading.Semaphore(10)      # at most 10 concurrent queries

def query(sql):
    with db_slots:                       # wait(): blocks when 10 are in use
        return conn_pool.execute(sql)    # signal() on exit
```

Semaphores have **no owner**: any thread can signal. That makes them good for **signaling between threads** (producer signals "item available") and for **limiting concurrency** — and makes them a poor mutex replacement (no ownership checks, no priority inheritance, easy to signal twice).

### Condition variable — the correct pattern

```c
pthread_mutex_lock(&m);
while (queue_empty(&q))              // WHILE, not IF
    pthread_cond_wait(&not_empty, &m);   // atomically: unlock m + sleep; relock on wake
item = dequeue(&q);
pthread_mutex_unlock(&m);

// producer
pthread_mutex_lock(&m);
enqueue(&q, item);
pthread_cond_signal(&not_empty);
pthread_mutex_unlock(&m);
```

Why `while`: **spurious wakeups** are permitted, and with **Mesa semantics** (used by pthreads, Java) a signaled thread doesn't run immediately — another thread may grab the item first. The waiter must re-check the condition after waking. The atomic "release the mutex and sleep" inside `wait` prevents a **lost wakeup** (signal arriving between checking the condition and going to sleep).

### Monitor

Java's `synchronized` methods plus `wait()/notify()/notifyAll()` form a monitor: one intrinsic lock per object and one condition queue. `java.util.concurrent.locks.ReentrantLock` with multiple `Condition`s is the explicit version (e.g., separate `notFull` and `notEmpty` conditions for a bounded buffer). Details and Hoare vs Mesa semantics: [Semaphores & Monitors](lesson:os-semaphores-monitors).

### Barrier

```java
CyclicBarrier barrier = new CyclicBarrier(4, () -> mergePartialResults());
// each of 4 workers: compute phase k on its partition, then
barrier.await();     // wait for all 4 before starting phase k+1
```

Used in parallel algorithms with phases (simulations, iterative solvers, parallel sort merges).

## Internal Mechanism

:::depth{level=advanced}
### Futex-based mutex in a nutshell

A futex is a 32-bit integer in user memory plus a kernel wait queue keyed by its address.

1. **Lock fast path**: atomic CAS `0 → 1` succeeds → you own it. No syscall.
2. **Contended**: set the word to 2 ("locked, has waiters") and call `futex(FUTEX_WAIT, addr, 2)` — the kernel sleeps the thread only if the word is still 2 (prevents lost wakeups).
3. **Unlock**: atomic exchange to 0; if the old value was 2, call `futex(FUTEX_WAKE, addr, 1)`.

Uncontended lock+unlock ≈ two atomic instructions (~20 ns). This design (Drepper, "Futexes Are Tricky") is why "locks are slow" is mostly false — *contended* locks are slow.
:::

### Fairness and convoys

Most mutexes are **not fair**: a thread that just unlocked can re-acquire before a woken waiter runs ("barging"). This boosts throughput but can starve waiters. Fair (FIFO) locks avoid starvation but can cause **lock convoys**: every handoff requires a context switch to the next waiter, so throughput collapses to the rate of context switches.

### Priority inversion

A low-priority thread holds a mutex; a high-priority thread waits for it; a medium-priority thread preempts the low one — so the high-priority thread effectively waits for the medium one. (This famously reset the Mars Pathfinder lander.) Fix: **priority inheritance** — the holder temporarily inherits the waiter's priority. Mutexes support this; semaphores (no owner) can't.

## Example

Choosing primitives for a web service's in-memory cache:

| Need | Choice |
|---|---|
| Protect a small map with frequent writes | Mutex (or a concurrent map with striped locks) |
| Config map read on every request, replaced every minute | Read-mostly: RW lock, or better, **copy-on-write**: build a new immutable map and swap an atomic reference — readers need no lock at all |
| Limit concurrent calls to a fragile downstream API to 20 | Semaphore(20) |
| Worker waits for jobs | Blocking queue (mutex + two condition variables inside) |
| Wait until 8 shards finished loading before serving | CountDownLatch / barrier |

## Visualization

::viz{id=race-condition}

## Complexity & Performance

| Primitive | Uncontended cost | Contended behavior |
|---|---|---|
| Atomic op | ~5–20 ns | Cache-line ping-pong |
| Spinlock | ~10–20 ns | Burns CPU while waiting |
| Futex mutex | ~20–25 ns | Sleep/wake via kernel: µs + context switches |
| RW lock | ~25–50 ns | Readers contend on the counter; writer waits for all readers |
| Condition variable wait/signal | µs (always sleeps) | Thundering herd with `broadcast` |

**Contention, not the primitive, is the performance problem.** Reduce it by shrinking critical sections, sharding locks (lock striping), using per-thread data, or lock-free structures.

## Trade-offs

- **Coarse-grained locking** (one big lock): simple and correct; poor parallelism.
- **Fine-grained locking** (lock per bucket/row): parallelism; risk of deadlock and complexity.
- **Lock-free**: no blocking, progress guarantees; very hard to get right (ABA, memory ordering) — see [Atomic Instructions](lesson:os-atomic-instructions).

## Failure Modes

- **Deadlock**: two threads acquire two locks in opposite orders ([Deadlocks](lesson:os-deadlocks)).
- **Forgotten unlock** on an exception path → everyone blocks forever.
- **`if` instead of `while`** around `cond.wait()` → acting on a condition that is no longer true.
- **Lost wakeup**: signaling before the waiter waits when the condition isn't re-checked under the mutex.
- **Holding a lock during I/O** → throughput collapses; a slow disk or network call serializes all threads.
- **Semaphore as mutex** → extra `signal()` makes the "mutex" admit two threads.
- **Reentrancy surprises**: non-reentrant mutex locked twice by the same thread deadlocks itself; Java `synchronized` is reentrant.

## In Production

- Java: `synchronized`, `ReentrantLock`, `ReentrantReadWriteLock`, `StampedLock` (optimistic reads), `Semaphore`, `CountDownLatch`, `CyclicBarrier`, `Phaser`; most code should use higher-level `java.util.concurrent` collections and executors.
- Go: `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup` (a barrier-like join), plus channels — "share memory by communicating".
- Databases implement the same ideas as **latches** (short-term mutexes on in-memory pages) vs **locks** (transaction-duration locks on rows) — see [Locking](lesson:db-locking).
- Distributed systems reinvent them as distributed locks and leases (with the extra problem that the holder can pause or crash).

## Deeper Connections

- Semaphores and monitors are formalized in [Semaphores & Monitors](lesson:os-semaphores-monitors); classic uses in [Producer–Consumer, Readers–Writers, Dining Philosophers](lesson:os-classic-sync-problems).
- Every lock is built from [atomic instructions](lesson:os-atomic-instructions).
- Shared vs exclusive locks in databases are RW locks at the row level ([Locking](lesson:db-locking)).

## Common Misconceptions

- **"Locks are slow."** Uncontended locks cost ~20 ns; contention is what's slow.
- **"A binary semaphore is the same as a mutex."** A mutex has an owner (only the locker unlocks; enables priority inheritance and error checking); a semaphore doesn't.
- **"RW locks are always faster for read-heavy workloads."** Not for short critical sections; the lock's own counter becomes the bottleneck.
- **"notify() wakes the thread that will get the item."** With Mesa semantics, any thread may get there first — always re-check in a loop.

## Interview Questions

### [L1 · compare] What is the difference between a mutex and a semaphore?

A mutex provides mutual exclusion and has an owner: the thread that locked it must unlock it. A semaphore is a counter: `wait` decrements (blocking at zero) and `signal` increments, and any thread may signal. Mutexes protect critical sections; counting semaphores limit concurrent access to N resources and signal events between threads. A binary semaphore resembles a mutex but lacks ownership (so no priority inheritance or misuse detection).

### [L1 · compare] What is a spinlock and when would you use it instead of a mutex?

A lock whose waiters busy-wait in a loop instead of sleeping. Use it when critical sections are extremely short (shorter than the cost of sleeping and waking), the holder runs on another core, and the waiter can't or shouldn't sleep — typical in kernels and interrupt handlers. In user space, adaptive mutexes (spin briefly, then sleep) are usually better.

### [L2 · why] Why must you call condition-variable wait inside a while loop?

Because a woken thread isn't guaranteed that the condition holds: spurious wakeups are allowed, and with Mesa semantics other threads can run between the signal and the waiter reacquiring the mutex, invalidating the condition (e.g., another consumer takes the item). Re-checking in a loop ensures the thread proceeds only when the condition is true.

### [L2 · how] How does a condition variable avoid the lost-wakeup problem?

The waiter checks the condition while holding the mutex, and `wait` atomically releases the mutex and puts the thread to sleep. A signaler must hold the same mutex to change the state, so it can't slip its signal in between the waiter's check and its sleep.

### [L3 · compare] When is a read-write lock worse than a plain mutex?

When critical sections are very short: every reader still performs atomic updates on the shared reader count, so the lock's cache line bounces between cores just like a mutex, with extra bookkeeping. Also when writes are frequent (readers block behind writers), and when writer or reader starvation hurts latency. Alternatives: a mutex, sharded locks, or copy-on-write with an atomic reference swap for read-mostly data.

### [L3 · what-if] What is priority inversion and how is it solved?

A high-priority task waits on a lock held by a low-priority task, which in turn is preempted by medium-priority tasks — so the high-priority task is indirectly blocked by medium-priority work. Solutions: priority inheritance (the lock holder temporarily inherits the highest waiter priority), priority ceiling protocols, or avoiding shared locks across priority levels.

### [L3 · debugging] A service's throughput drops sharply as you add threads; profiles show threads mostly BLOCKED on one lock. What do you do?

This is lock contention making the critical section the serial bottleneck (Amdahl). Measure hold times and what's done under the lock. Shrink the critical section (move I/O, allocation, logging out), split the data and use per-shard locks, use a concurrent data structure, replace read-heavy access with copy-on-write snapshots, or eliminate sharing via per-thread accumulation. Verify the fix with lock profiling (JFR, `perf lock`, mutex profiles in Go).

### [L4 · design] Design a rate limiter that allows at most 50 concurrent requests to a downstream service across 32 worker threads, with a 200 ms wait timeout.

Use a counting semaphore with 50 permits: `tryAcquire(200ms)` before the call, release in `finally` so errors and timeouts always return permits. On timeout, fail fast (return 503 or a fallback) rather than queuing unbounded work — that's backpressure. Monitor permit wait times and rejections. For a limit across multiple instances, the semaphore must live elsewhere (a token bucket in Redis, or per-instance limits = global/instances) with the usual distributed caveats.

## Practice

### [mcq] Which primitive best limits a pool to at most 10 concurrent database queries?

- [ ] Mutex
- [x] Counting semaphore initialized to 10
- [ ] Barrier with 10 parties
- [ ] Spinlock

A counting semaphore tracks available slots.

### [mcq] A consumer calls `if (queue.isEmpty()) cond.wait();` and then dequeues. What bug can occur?

- [ ] Deadlock is guaranteed
- [x] It may dequeue from an empty queue after a spurious wakeup or another consumer's steal
- [ ] Nothing — `if` is fine with Mesa semantics
- [ ] The producer can never signal

Always use `while`.

## Quick Revision

- **Mutex**: exclusion, has owner. **Spinlock**: busy-wait, only for tiny critical sections. **RW lock**: many readers or one writer (starvation, short-section overhead).
- **Semaphore**: counter, no owner — limiting concurrency and signaling.
- **Condition variable**: `while (!cond) wait(mutex)`; wait atomically unlocks + sleeps; Mesa semantics → re-check.
- **Monitor** = lock + condition(s) bundled (Java `synchronized` + `wait/notify`). **Barrier** = all arrive before any proceeds.
- Futex: uncontended lock/unlock stays in user space (~20 ns).
- Contention is the cost; reduce sharing, shrink critical sections, shard locks.
- Pitfalls: deadlock, lock held during I/O, priority inversion (fix: inheritance), unfair locks vs convoys.
