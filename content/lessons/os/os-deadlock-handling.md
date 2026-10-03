---
title: "Deadlock Prevention, Avoidance (Banker's Algorithm), Detection and Recovery"
subject: os
level: 5
order: 2
summary: "Four strategies for living with deadlock — break a condition, stay in safe states, detect and recover, or ignore it — with fully worked Banker's algorithm numericals."
depth: core
difficulty: 4
minutes: 50
relevance: essential
stage: 2
prerequisites: [os-deadlocks]
related: [db-locking, os-sync-primitives, x-concurrency-everywhere]
labs: [bankers]
tags: [deadlock prevention, deadlock avoidance, banker's algorithm, safe state, safety algorithm, resource request algorithm, deadlock detection, recovery, ostrich algorithm, lock ordering]
---

## Mental Model

There are four attitudes toward deadlock, like four ways to handle traffic gridlock:

1. **Prevention — design the roads so gridlock is impossible.** One-way streets, roundabouts: break one of the four Coffman conditions by construction.
2. **Avoidance — a traffic controller who only lets a car enter if every car can still get out.** Requires knowing each car's route in advance (Banker's algorithm).
3. **Detection and recovery — let traffic flow freely, watch for gridlock, then tow a car.** Databases do this.
4. **Ignore it — the "ostrich algorithm".** If gridlock is rare and a reboot is cheap, do nothing. General-purpose OSes mostly do this for application locks.

## Definition

- **Deadlock prevention**: constrain how resources are requested so at least one Coffman condition can never hold.
- **Deadlock avoidance**: dynamically grant requests only if the resulting state is **safe**, using advance knowledge of each process's maximum demand.
- **Safe state**: there exists a **safe sequence** ⟨P₁…Pₙ⟩ such that each Pᵢ's remaining need can be satisfied by currently available resources plus those held by all Pⱼ with j < i. Safe ⇒ no deadlock; unsafe ⇏ deadlock (but it's possible).
- **Deadlock detection**: allow deadlocks, periodically run an algorithm to find them.
- **Recovery**: break a detected deadlock by terminating processes or preempting resources (rollback).

## Why It Exists

Each strategy fits a different environment. Kernels and embedded systems can enforce lock ordering (prevention). Systems with known maximum demands (some batch or real-time systems) can use avoidance. Databases can't predict which rows transactions will lock but can abort and retry transactions, so they detect and recover. Desktop OSes can't abort arbitrary application threads safely and deadlocks are rare, so they ignore it.

## How It Works

### Prevention: break one condition

| Condition | How to break it | Practicality |
|---|---|---|
| Mutual exclusion | Make resources shareable (read-only data, lock-free structures, MVCC reads) | Only for some resources |
| Hold and wait | Acquire **all** resources at once before starting, or release everything before requesting more | Low utilization, possible starvation, needs knowing needs up front |
| No preemption | If a request can't be granted, release what you hold and retry (`tryLock` + back off); or let the system preempt (rollback) | Works for state that can be saved/restored; risks livelock |
| **Circular wait** | **Impose a total order on resources; always acquire in increasing order** | **The standard practical fix** |

Lock ordering is by far the most common technique in real code: order locks by address, by ID, or by a documented hierarchy (Linux kernel documents lock nesting order; `lockdep` verifies it at runtime).

### Avoidance: the Banker's algorithm

Data structures for n processes and m resource types:

- `Available[m]` — free instances of each type.
- `Max[n][m]` — maximum demand of each process.
- `Allocation[n][m]` — currently allocated.
- `Need[n][m] = Max − Allocation` — remaining possible demand.

**Safety algorithm:**

```text
Work = Available; Finish[i] = false for all i
repeat:
    find i with Finish[i] == false and Need[i] ≤ Work
    if found: Work += Allocation[i]; Finish[i] = true; append Pi to sequence
until no such i
safe ⇔ all Finish[i] == true
```

**Resource-request algorithm** for request `Req` from Pᵢ:

1. If `Req > Need[i]` → error (exceeds declared maximum).
2. If `Req > Available` → Pᵢ must wait.
3. Pretend to allocate: `Available −= Req; Allocation[i] += Req; Need[i] −= Req`.
4. Run the safety algorithm. Safe → grant. Unsafe → roll back the pretend allocation; Pᵢ waits.

### Worked example (the classic 5-process, 3-resource instance)

Resources A, B, C with totals 10, 5, 7.

| Process | Allocation (A B C) | Max (A B C) | Need (A B C) |
|---|---|---|---|
| P0 | 0 1 0 | 7 5 3 | 7 4 3 |
| P1 | 2 0 0 | 3 2 2 | 1 2 2 |
| P2 | 3 0 2 | 9 0 2 | 6 0 0 |
| P3 | 2 1 1 | 2 2 2 | 0 1 1 |
| P4 | 0 0 2 | 4 3 3 | 4 3 1 |

Allocated total = (7, 2, 5), so **Available = (10,5,7) − (7,2,5) = (3, 3, 2)**.

Safety check, Work = (3,3,2):

1. P1 Need (1,2,2) ≤ (3,3,2) ✔ → Work = (3,3,2) + (2,0,0) = (5,3,2)
2. P3 Need (0,1,1) ≤ (5,3,2) ✔ → Work = (5,3,2) + (2,1,1) = (7,4,3)
3. P4 Need (4,3,1) ≤ (7,4,3) ✔ → Work = (7,4,3) + (0,0,2) = (7,4,5)
4. P0 Need (7,4,3) ≤ (7,4,5) ✔ → Work = (7,5,5)
5. P2 Need (6,0,0) ≤ (7,5,5) ✔ → Work = (10,5,7)

**Safe sequence: ⟨P1, P3, P4, P0, P2⟩** (other safe sequences exist, e.g. ⟨P1, P3, P4, P2, P0⟩).

**Request from P1: (1, 0, 2).** Need[P1] = (1,2,2) ✔, Available (3,3,2) ✔. Pretend: Available = (2,3,0), Allocation[P1] = (3,0,2), Need[P1] = (0,2,0). Safety: P1 (0,2,0) ≤ (2,3,0) → Work (5,3,2); P3 → (7,4,3); P4 → (7,4,5); P0 → (7,5,5); P2 → (10,5,7). **Safe → grant.**

**Then a request from P0: (0, 2, 0).** Available is now (2,3,0) ≥ (0,2,0) ✔. Pretend: Available = (2,1,0). Now no process's Need fits: P0 (7,2,3), P1 (0,2,0)? B needed 2 > 1 ✘, P2 (6,0,0) ✘, P3 (0,1,1) — C needed 1 > 0 ✘, P4 (4,3,1) ✘. **Unsafe → P0 must wait** even though the resources are physically available.

::lab{id=bankers}

### Detection

For single-instance resources: maintain a **wait-for graph**, detect cycles with DFS in O(n + e).

For multi-instance resources: a variant of the safety algorithm using **current Request** instead of Need:

```text
Work = Available; Finish[i] = (Allocation[i] == 0)
repeat: find i with !Finish[i] and Request[i] ≤ Work → Work += Allocation[i]; Finish[i] = true
deadlocked processes = those with Finish[i] == false at the end
```

(Optimistic assumption: a process whose current request can be satisfied will finish and release everything.)

**When to run detection?** On every blocked request (immediate but costly), periodically, or when CPU utilization drops / throughput stalls. PostgreSQL checks only after a lock wait exceeds `deadlock_timeout` (default 1 s) — most waits resolve on their own, so it avoids running the detector constantly.

### Recovery

- **Process/transaction termination**: abort all deadlocked processes (simple, expensive) or abort one at a time until the cycle breaks. Choose a **victim** by cost: least work done, fewest resources held, lowest priority, youngest transaction.
- **Resource preemption / rollback**: take resources away and roll the victim back to a safe point (databases roll back the transaction).
- **Starvation risk**: the same transaction may be picked repeatedly — include the number of past rollbacks in the victim cost.

## Internal Mechanism

### Why avoidance is rare in practice

Banker's requires each process to declare its **maximum** needs in advance, a fixed number of processes and resources, and O(m·n²) work per request. Real programs don't know their maximum lock or memory needs, and the conservatism (refusing requests in unsafe-but-not-deadlocked states) reduces utilization. It's taught because it cleanly shows the idea of **safe states** — the same idea behind admission control and capacity reservations.

:::depth{level=advanced}
### Timestamp-based prevention in databases

Some databases prevent deadlocks without detection using transaction timestamps:

- **Wait-die**: an older transaction may wait for a younger one; a younger requester that conflicts with an older holder **dies** (aborts and restarts with its original timestamp).
- **Wound-wait**: an older requester **wounds** (aborts) a younger holder; a younger requester waits for an older holder.

Both guarantee no cycles (waits only go in one timestamp direction) and no starvation (a restarted transaction keeps its old timestamp, eventually becoming the oldest). Google Spanner uses wound-wait.
:::

## Example

Lock ordering in a bank transfer:

```java
void transfer(Account from, Account to, long amount) {
    Account first  = from.id < to.id ? from : to;   // global order by id
    Account second = from.id < to.id ? to   : from;
    synchronized (first) {
        synchronized (second) {
            from.withdraw(amount);
            to.deposit(amount);
        }
    }
}
```

In SQL, the equivalent is locking rows in a consistent order: `SELECT ... FROM accounts WHERE id IN (?, ?) ORDER BY id FOR UPDATE`.

## Complexity & Performance

| Strategy | Runtime cost | Utilization | Needs advance knowledge |
|---|---|---|---|
| Prevention (ordering) | ~0 | High | Resource order only |
| Prevention (all-at-once) | Low | Low | Full needs |
| Avoidance (Banker's) | O(m·n²) per request | Moderate | Maximum needs |
| Detection | O(n + e) or O(m·n²) per check | High | None |
| Ignore | 0 | High | None — pay with occasional restarts |

## Trade-offs

Prevention is cheapest when the resource set is known (code locks). Detection plus retry fits systems where aborting is safe (transactions). Avoidance fits systems with explicit reservations. Timeouts are a pragmatic hybrid used everywhere: they don't prevent deadlocks, but they bound how long one lasts.

## Failure Modes

- Inconsistent lock ordering introduced by a new code path — "works for years, then deadlocks after a refactor".
- Retry storms after deadlock aborts if clients retry immediately without backoff.
- Victim selection starving the same long transaction repeatedly.
- Timeouts set too short → false positives abort healthy work; too long → deadlocks hang requests.

## In Production

- **Databases**: PostgreSQL and MySQL/InnoDB detect deadlocks (wait-for graph) and abort a victim; applications must catch the error and **retry the whole transaction**. InnoDB can also rely on `innodb_lock_wait_timeout`.
- **Java**: `ReentrantLock.tryLock(timeout)` for back-off-and-retry; thread dumps detect monitor deadlocks.
- **Linux kernel**: `lockdep` validates lock ordering at runtime in debug builds.
- **Case study**: [Database deadlocks in production](case:db-deadlocks).

## Deeper Connections

- Two-phase locking and deadlock detection in DBs: [Locking](lesson:db-locking).
- Safe-state reasoning is the ancestor of admission control and capacity planning ([Overloaded Servers](lesson:x-overloaded-server)).
- Optimistic concurrency avoids lock-based deadlocks entirely by detecting conflicts at commit ([Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).

## Common Misconceptions

- **"Unsafe state means deadlock."** Unsafe means deadlock *may* occur; it might not.
- **"Banker's algorithm is used by operating systems."** Mainstream OSes don't use it; they ignore application deadlocks or rely on developers' lock ordering.
- **"Deadlock detection prevents deadlocks."** It finds them after they happen; recovery then sacrifices work.

## Interview Questions

### [L1 · compare] Compare deadlock prevention, avoidance and detection.

Prevention designs the system so one of the four Coffman conditions can never hold (e.g., global lock ordering breaks circular wait). Avoidance allows requests only if the system remains in a safe state, which requires knowing maximum demands in advance (Banker's algorithm). Detection lets deadlocks happen, finds them (wait-for graph cycles or a safety-style algorithm) and recovers by aborting or rolling back a victim.

### [L1 · conceptual] What is a safe state?

A state in which there's at least one ordering of all processes such that each can obtain its maximum remaining need from the currently available resources plus those released by the processes before it. From a safe state the system can always avoid deadlock; an unsafe state doesn't guarantee deadlock but allows it.

### [L2 · numerical] Available = (3,3,2). Needs: P0 (7,4,3), P1 (1,2,2), P2 (6,0,0), P3 (0,1,1), P4 (4,3,1). Allocations: P0 (0,1,0), P1 (2,0,0), P2 (3,0,2), P3 (2,1,1), P4 (0,0,2). Is the state safe?

Yes. Work (3,3,2) → P1 fits → (5,3,2) → P3 → (7,4,3) → P4 → (7,4,5) → P0 → (7,5,5) → P2 → (10,5,7). Safe sequence ⟨P1, P3, P4, P0, P2⟩.

### [L2 · how] How does the Banker's algorithm handle a resource request?

Check the request doesn't exceed the process's declared remaining need (else error) and is available (else wait). Tentatively allocate it, then run the safety algorithm on the new state. If safe, commit the allocation; if unsafe, roll it back and make the process wait.

### [L2 · compare] Why is lock ordering the most widely used deadlock prevention technique?

It breaks circular wait with zero runtime overhead, needs no knowledge of maximum demands, and doesn't reduce concurrency the way acquiring everything up front does. It only requires a consistent global order (by ID, address, or a documented hierarchy) and discipline in code review or tooling like lockdep.

### [L3 · why] Why don't general-purpose operating systems use the Banker's algorithm?

Processes don't declare maximum resource needs in advance; the number of processes and resources is dynamic; running the safety check on every request is expensive; and conservative refusals reduce utilization. The cost is unjustified given that deadlocks among application locks are rare and application-specific — so OSes typically ignore them (the ostrich approach) and leave prevention to developers.

### [L3 · incident] Your app logs frequent "deadlock detected" errors from PostgreSQL on an order-processing endpoint. What do you do?

Short term: ensure the application retries the aborted transaction (with jittered backoff) — deadlock errors are expected and recoverable. Root cause: find the conflicting statements (PostgreSQL logs both queries in the deadlock report); typically two transactions update the same rows in different orders (e.g., order items updated in request order, inventory rows locked in different sequences). Fix by locking rows in a consistent order (`ORDER BY id FOR UPDATE`), shortening transactions, avoiding mixed lock escalation paths, or restructuring to touch fewer rows.

### [L4 · design] Design deadlock handling for an in-memory transactional key-value store where transactions lock keys dynamically.

You can't predict keys, so avoidance is out; ordering isn't possible when keys are discovered during execution. Options: (1) detection — maintain a wait-for graph in the lock manager, run cycle detection when a wait exceeds a threshold, abort the youngest/cheapest victim; (2) prevention via wait-die or wound-wait using transaction timestamps (no graph needed, simpler in distributed settings, some unnecessary aborts); (3) optimistic concurrency — no locks, validate at commit, abort on conflict. Choose by contention level: optimistic for low contention, wound-wait for distributed simplicity, detection for maximum concurrency. Expose abort reasons and make clients retry idempotently.

## Practice

### [exercise] Using the lesson's example state (Available = (3,3,2)), can P4's request (3,3,0) be granted immediately?

:::solution
Check Need[P4] = (4,3,1) ≥ (3,3,0) ✔ and Available (3,3,2) ≥ (3,3,0) ✔. Pretend: Available = (0,0,2), Allocation[P4] = (3,3,2), Need[P4] = (1,0,1). Safety: Work = (0,0,2). P0 (7,4,3) ✘, P1 (1,2,2) ✘, P2 (6,0,0) ✘, P3 (0,1,1) ✘ (needs B=1), P4 (1,0,1) ✘ (needs A=1). No process can finish → **unsafe → the request is not granted; P4 waits.**
:::

### [numeric 3] In the lesson's example, how many instances of resource A are available initially (total A = 10)?

:::answer
Allocated A = 0 + 2 + 3 + 2 + 0 = 7, so Available A = 10 − 7 = **3**.
:::

### [mcq] Which statement about unsafe states is correct?

- [ ] An unsafe state is always a deadlocked state
- [x] An unsafe state may lead to deadlock, but is not necessarily deadlocked
- [ ] A safe state may contain a deadlock
- [ ] Unsafe states cannot occur if Banker's algorithm is used

Banker's keeps the system in safe states; unsafe states are the ones where deadlock becomes possible.

## Quick Revision

- **Prevention**: break a Coffman condition — in practice, **global lock ordering** (circular wait).
- **Avoidance**: grant only if the result is **safe**; Banker's: `Need = Max − Allocation`; safety: repeatedly find `Need ≤ Work`, add its Allocation to Work.
- Safe ⇒ no deadlock; unsafe ⇏ deadlock.
- **Detection**: wait-for-graph cycle (single instance) or safety-style check with Request (multi-instance). PostgreSQL waits `deadlock_timeout` first.
- **Recovery**: abort/rollback a victim (cheapest; avoid repeat victims).
- DBs: detect + abort → **apps must retry**. Wait-die / wound-wait use timestamps.
- OSes mostly ignore application deadlocks (ostrich).
