---
title: "Semaphores, Monitors and Condition Variables in Depth"
subject: os
level: 4
order: 3
summary: "Dijkstra's P and V, how semaphores are implemented without busy waiting, monitors with Hoare vs Mesa semantics, and how to reason about signaling correctly."
depth: core
difficulty: 4
minutes: 40
relevance: high
stage: 2
prerequisites: [os-atomic-instructions, os-sync-primitives]
related: [os-classic-sync-problems, os-sync-primitives, os-deadlocks]
visualizations: [producer-consumer]
tags: [semaphore, p v operations, wait signal, binary semaphore, counting semaphore, monitor, condition variable, hoare, mesa, spurious wakeup]
---

## Mental Model

A **semaphore** is a bowl of tokens. `wait()` (P) takes a token — if the bowl is empty, you sleep next to it until someone drops one in. `signal()` (V) drops a token in and wakes one sleeper. The count tells you how many things are available (free buffer slots, connections, permits); a negative count in many implementations tells you how many are waiting.

A **monitor** is a room with a single door and a guard: only one thread inside at a time (mutual exclusion is automatic). Inside, a thread that can't proceed sits on a named bench (a **condition variable**) and gives up the room until another thread says "the thing you're waiting for might have happened".

## Definition

**Semaphore** `S`: an integer with two atomic operations:

```text
wait(S) / P(S) / down(S):   S = S − 1;  if S < 0: block this thread on S's queue
signal(S) / V(S) / up(S):   S = S + 1;  if S ≤ 0: wake one thread from S's queue
```

(Equivalent textbook form: `wait` blocks while `S ≤ 0`, then decrements.)

- **Counting semaphore**: any non-negative initial value (number of resources).
- **Binary semaphore**: initial value 1, used as a lock (but ownerless).

**Monitor**: an abstract data type whose procedures execute with mutual exclusion, plus **condition variables** with `wait()` (release the monitor and sleep), `signal()` (wake one waiter), and `broadcast()` (wake all).

## Why It Exists

**The problem.** Busy-waiting locks waste CPU and don't express *waiting for a condition*. **First answer: the semaphore.** Dijkstra (1965) introduced semaphores as a single primitive for both mutual exclusion and ordering/signaling between processes — one counter that can mean "free slots", "items available" or "the lock is free", with sleeping built in.

**Second answer: the monitor.** Monitors (Hoare, Brinch Hansen, 1970s) came next because semaphore code is error-prone — a single misplaced `P` or missing `V` causes deadlock — and monitors let the compiler/runtime handle the mutual exclusion part. The programmer only writes the *waiting* logic; locking happens automatically on entry and exit.

:::callout[That's all it is]{type=insight}
A semaphore is a counter you can sleep on. A monitor is an object where only one thread runs at a time, with "wait here until..." benches inside. The second exists because people kept getting the first wrong.
:::

## How It Works

### Three canonical semaphore uses

```c
// 1) Mutual exclusion (binary semaphore)
semaphore mutex = 1;
wait(mutex);   /* critical section */   signal(mutex);

// 2) Resource counting
semaphore slots = 5;          // 5 identical resources
wait(slots);   use_one();     signal(slots);

// 3) Ordering: ensure S1 (in thread A) runs before S2 (in thread B)
semaphore done = 0;
// Thread A:  S1;  signal(done);
// Thread B:  wait(done);  S2;
```

Pattern 3 shows the power of initializing to 0: the semaphore records that an event happened, even if the signal occurs before the wait (unlike condition variables, which have no memory).

### Implementation without busy waiting

The whole point of a semaphore is that waiters *sleep* instead of spinning. That needs two pieces: a queue of sleeping threads, and a tiny internal lock so the count and the queue change together.

```c
typedef struct { int value; queue_t waiters; spinlock_t guard; } semaphore;

void wait(semaphore *s) {
    spin_lock(&s->guard);
    s->value--;
    if (s->value < 0) {
        enqueue(&s->waiters, current_thread);
        sleep_and_unlock(&s->guard);    // atomically release guard and block
    } else spin_unlock(&s->guard);
}

void signal(semaphore *s) {
    spin_lock(&s->guard);
    s->value++;
    if (s->value <= 0) wakeup(dequeue(&s->waiters));
    spin_unlock(&s->guard);
}
```

Busy waiting isn't eliminated entirely — it moves to the tiny internal guard (held for a few instructions) instead of the application's critical section. The "release guard and sleep atomically" step prevents lost wakeups.

### Monitor with condition variables (bounded buffer)

```java
class BoundedBuffer<T> {
    private final Object[] items; private int head, tail, count;
    BoundedBuffer(int n) { items = new Object[n]; }

    public synchronized void put(T x) throws InterruptedException {
        while (count == items.length) wait();        // buffer full → wait
        items[tail] = x; tail = (tail + 1) % items.length; count++;
        notifyAll();                                  // someone may be waiting for "not empty"
    }

    @SuppressWarnings("unchecked")
    public synchronized T take() throws InterruptedException {
        while (count == 0) wait();                    // buffer empty → wait
        T x = (T) items[head]; head = (head + 1) % items.length; count--;
        notifyAll();                                  // someone may be waiting for "not full"
        return x;
    }
}
```

Java objects have **one** condition queue, so producers and consumers wait on the same queue — hence `notifyAll()` (with `notify()`, you might wake a producer when a consumer was needed, and everyone goes back to sleep: a lost wakeup in effect). `ReentrantLock` with two `Condition`s (`notFull`, `notEmpty`) lets you `signal()` precisely.

### Hoare vs Mesa semantics

The question this answers: when thread A signals "the buffer is no longer empty" and wakes B, who runs next — A or B? If A keeps going, something could change before B runs.

| | Hoare (signal-and-wait) | Mesa (signal-and-continue) |
|---|---|---|
| On `signal()` | Signaler immediately hands the monitor to the woken thread and waits | Signaler continues; woken thread moves to the ready queue and re-competes for the monitor |
| Condition on wakeup | Guaranteed true | **May no longer be true** |
| Waiting idiom | `if (!cond) wait();` suffices | `while (!cond) wait();` required |
| Used by | Theory, some languages | pthreads, Java, C#, Go's `sync.Cond` — virtually all real systems |

Mesa won because it's simpler to implement, allows spurious wakeups and `broadcast`, and doesn't force an extra context switch on every signal.

## Internal Mechanism

### Semaphore vs condition variable: memory

- A semaphore **remembers** signals (the count). A `signal()` with no waiters increments the count; a later `wait()` passes through.
- A condition variable **forgets**: `signal()` with no waiters does nothing. That's why condition waits must be guarded by checking the actual shared state (a predicate) under the mutex, never by assuming a signal will come later.

### Ownership and priority inheritance

Mutexes know their owner, so the OS can apply priority inheritance and detect errors (unlocking a mutex you don't own). Semaphores don't, so a binary semaphore used as a lock can't prevent priority inversion or catch misuse. Use mutexes for mutual exclusion and semaphores for counting/signaling.

## Example

Order three threads so they print A, then B, then C, regardless of scheduling:

```c
semaphore sAB = 0, sBC = 0;
// T1: print("A"); signal(sAB);
// T2: wait(sAB); print("B"); signal(sBC);
// T3: wait(sBC); print("C");
```

## Visualization

A bounded buffer with `empty`, `full` and `mutex` semaphores — step producers and consumers and watch the counts and blocked queues:

::viz{id=producer-consumer}

## Complexity & Performance

- `wait`/`signal` without contention: a few atomic ops (futex-based semaphores stay in user space).
- Every blocking wait costs a context switch pair; `broadcast`/`notifyAll` can wake many threads that immediately go back to sleep (**thundering herd**).

## Trade-offs

- **Semaphores**: flexible, low-level, remember signals; easy to misuse (wrong order, missing V).
- **Monitors**: structured; mutual exclusion can't be forgotten; condition logic still needs care.
- **Higher-level constructs** (blocking queues, futures, channels, actors) encapsulate these patterns and should be the first choice in application code.

## Failure Modes

- **Wrong order of waits** (e.g., in producer–consumer, `wait(mutex)` before `wait(empty)`) → deadlock: a producer holds the mutex while sleeping on "empty", so no consumer can enter to free a slot.
- **Missing signal** → threads sleep forever.
- **Extra signal** on a binary semaphore → two threads in the critical section.
- **`if` instead of `while`** with Mesa semantics → acting on a false condition.
- **`notify()` with multiple condition types sharing one queue** → wrong thread woken.

## In Production

- `java.util.concurrent.Semaphore`, Python `threading.Semaphore`/`BoundedSemaphore` (raises on over-release), POSIX `sem_t` (also usable across processes in shared memory — PostgreSQL uses semaphores to wake sleeping backends).
- Kubernetes/cloud "concurrency limits" are semaphores in spirit; so are database connection pools.
- Go's channels generalize semaphores: a buffered channel of capacity N is a counting semaphore.

## Deeper Connections

- Classic problems built from these primitives: [Producer–Consumer, Readers–Writers, Dining Philosophers](lesson:os-classic-sync-problems).
- Misordered waits are circular waits → [Deadlocks](lesson:os-deadlocks).
- The "check predicate under lock, then wait" discipline is the same as database `SELECT … FOR UPDATE` then decide.

## Common Misconceptions

- **"A binary semaphore and a mutex are interchangeable."** Semantically close for exclusion, but a mutex has ownership (priority inheritance, error checking, reentrancy options).
- **"signal() wakes a thread that will definitely find the condition true."** Not under Mesa semantics.
- **"Condition variables remember signals like semaphores."** They don't.

## Interview Questions

### [L1 · conceptual] What is a semaphore? Explain wait and signal.

An integer variable accessed only through two atomic operations. `wait` (P) decrements it and blocks the caller if the result is negative (no resource available). `signal` (V) increments it and, if threads are waiting, wakes one. It's used for mutual exclusion (initial value 1), counting resources (initial value N) and ordering events (initial value 0).

### [L1 · compare] Counting vs binary semaphore?

A counting semaphore ranges over any non-negative value and represents N available resources. A binary semaphore takes values 0/1 and is used like a lock or a one-shot signal.

### [L2 · compare] What's the difference between Hoare and Mesa monitor semantics?

Under Hoare semantics, `signal` immediately transfers the monitor to the woken thread, so the condition it waited for is guaranteed to hold when it resumes. Under Mesa semantics, the signaler continues and the woken thread merely becomes runnable; by the time it reacquires the monitor, the condition may have changed. Mesa therefore requires waiting in a `while` loop; almost all real systems use Mesa.

### [L2 · how] How can a semaphore enforce that statement S1 in thread A runs before S2 in thread B?

Initialize a semaphore to 0. A executes S1 then `signal(s)`; B executes `wait(s)` then S2. If B arrives first it blocks until A signals; if A signals first, the count becomes 1 and B passes through.

### [L3 · what-if] In producer–consumer, what happens if the producer does wait(mutex) before wait(empty)?

If the buffer is full, the producer acquires the mutex and then blocks on `empty` while still holding the mutex. Consumers can't enter to remove items (they need the mutex), so `empty` is never signaled — deadlock. Always acquire the counting semaphore first, then the mutex.

### [L3 · why] Why must Java code use notifyAll() rather than notify() in a bounded buffer using the object's intrinsic lock?

Producers and consumers wait on the same single condition queue. `notify()` wakes an arbitrary waiter: a producer might wake another producer when the buffer is still full; that producer re-checks, waits again, and the consumer that should have been woken sleeps on — the system can stall. `notifyAll()` wakes everyone to re-check; separate `Condition` objects with `signal()` are the efficient alternative.

### [L4 · design] You need to cap concurrent uploads to object storage at 16 per process, and shutdown must wait for in-flight uploads. Which primitives, and how?

A counting semaphore (16 permits) acquired before each upload and released in `finally` — with a timeout to avoid waiting forever. For shutdown, stop accepting new uploads, then wait until all permits return (acquire all 16, or track in-flight tasks with a latch/WaitGroup). Add per-upload timeouts and cancellation so shutdown is bounded. In async code, use the runtime's async semaphore so waiting doesn't block threads.

## Practice

### [numeric -2] A counting semaphore initialized to 3 undergoes 7 wait() operations and 2 signal() operations (in the "value may go negative" implementation). What is its final value?

:::answer
3 − 7 + 2 = **−2**, meaning two threads are blocked waiting.
:::

### [mcq] Which is TRUE about condition variables?

- [ ] A signal with no waiting threads is saved for the next wait
- [x] A waiting thread must re-check its condition after waking under Mesa semantics
- [ ] They provide mutual exclusion by themselves
- [ ] They can be used without any associated mutex

Condition variables have no memory, need a mutex, and Mesa wakeups don't guarantee the condition.

## Quick Revision

- Semaphore: `wait/P` (decrement, block if negative), `signal/V` (increment, wake one). Initial 1 = mutex, N = resources, 0 = ordering.
- Implemented with a guard spinlock + wait queue; sleep-and-release is atomic.
- Semaphores **remember** signals; condition variables **don't**.
- Monitor = implicit mutual exclusion + condition variables.
- **Hoare**: signal hands over; condition true. **Mesa** (real world): signal-and-continue → `while (!cond) wait()`.
- Producer–consumer: wait on the counting semaphore **before** the mutex.
- Java intrinsic monitors have one condition queue → `notifyAll()`.
