---
title: "The Critical-Section Problem and Peterson's Algorithm"
subject: os
level: 4
order: 1
summary: "The formal requirements any lock must satisfy — mutual exclusion, progress, bounded waiting — why naive software locks fail, and why Peterson's elegant solution breaks on modern CPUs."
depth: core
difficulty: 4
minutes: 40
relevance: high
stage: 2
prerequisites: [os-race-conditions]
related: [os-atomic-instructions, os-semaphores-monitors, os-sync-primitives]
visualizations: [race-condition]
tags: [critical section, mutual exclusion, progress, bounded waiting, peterson's algorithm, dekker, busy waiting, entry section, exit section]
---

## Mental Model

Two trains share a single-track bridge. We need a protocol so that:

- **never two trains on the bridge at once** (mutual exclusion),
- **if the bridge is empty and a train wants it, some train gets it** — nobody is stuck arguing politely forever (progress),
- **no train waits forever while others keep crossing** (bounded waiting).

Designing such a protocol using only ordinary reads and writes of shared variables — no special hardware — turns out to be surprisingly subtle. Studying the failed attempts shows exactly what a correct lock must guarantee.

## Definition

A program's code for each process/thread is structured as:

```text
do {
    [entry section]      // acquire permission
        critical section // access shared state
    [exit section]       // release permission
        remainder section
} while (true);
```

A solution to the **critical-section problem** must satisfy:

1. **Mutual exclusion** — at most one process is in its critical section at a time.
2. **Progress** — if no process is in its critical section and some want to enter, only processes not in their remainder section participate in the decision, and the decision can't be postponed indefinitely.
3. **Bounded waiting** — there is a bound on the number of times other processes can enter their critical sections after a process has requested entry and before that request is granted.

(Assumption: each process runs at non-zero speed; no assumption about relative speeds or number of CPUs.)

## Why It Exists

**The problem.** Two threads must take turns on shared data — but the only tools are ordinary reads and writes of shared variables, which can themselves interleave.

**Why study a "solved" problem.** Every lock you'll ever use implements an entry and exit section. The three requirements are the specification. Knowing them lets you evaluate any synchronization mechanism — including database lock managers and distributed locks — by asking: *can two holders coexist? can the system stall with nobody holding? can someone starve?*

**The idea.** Before building any lock, write down what "works" means — the three requirements. Then each failed attempt below teaches which requirement is easy to break, and Peterson's algorithm shows the smallest design that satisfies all three.

:::callout[That's all it is]{type=insight}
A lock has to do three things: keep a second thread out, let someone in when it's free, and not make anyone wait forever. Every attempt below is judged on just those three questions.
:::

## How It Works

### Attempt 1: a shared turn variable

```c
int turn = 0;                 // whose turn: 0 or 1
// process i (other is j = 1 - i)
while (turn != i) ;           // entry: wait for my turn
/* critical section */
turn = j;                     // exit: give turn away
```

- Mutual exclusion ✔ — only the process whose turn it is may enter.
- Progress ✘ — strict alternation. If P0 wants to enter twice in a row while P1 is busy in its remainder section (not interested), P0 waits forever for P1 to take and pass back its turn.

### Attempt 2: interest flags

```c
bool flag[2] = {false, false};
// process i
flag[i] = true;               // I want in
while (flag[j]) ;             // wait while the other wants in
/* critical section */
flag[i] = false;
```

- Mutual exclusion ✔.
- Progress ✘ — if both set their flags simultaneously, each sees the other's flag and both spin forever (**livelock**-like deadlock: nobody enters).

(Checking first and then setting the flag breaks mutual exclusion instead: both check, both see false, both enter.)

### Peterson's algorithm (1981)

Combine both ideas: express interest, then **politely give the turn to the other**.

```c
bool flag[2] = {false, false};
int  turn;
// process i, other j = 1 - i
flag[i] = true;               // I'm interested
turn = j;                     // but you go first if you want
while (flag[j] && turn == j)  // wait only if you want in AND it's your turn
    ;
/* critical section */
flag[i] = false;              // I'm done
```

**Mutual exclusion**: suppose both are in the critical section. Then each saw either `flag[other] == false` or `turn == self`. Both flags are true (each set its own before the loop), so each must have seen `turn == self` — but `turn` has one value; whoever wrote `turn` last gave it to the other, so that process could not have seen `turn == self`. Contradiction.

**Progress**: if only P0 wants in, `flag[1]` is false and P0 enters immediately. If both want in, `turn` holds one value, so exactly one of them exits its loop.

**Bounded waiting**: if P0 is waiting and P1 exits and tries to re-enter, P1 sets `turn = 0` — handing priority to P0. P0 waits for at most one entry by P1.

## Internal Mechanism

### Why Peterson's algorithm fails on modern hardware

A correct proof can still fail in practice if it assumes something the hardware doesn't promise. Peterson's proof assumes **sequential consistency**: every process sees reads and writes in program order, interleaved. Real CPUs don't provide that by default ([Race Conditions](lesson:os-race-conditions)). On x86, a core's store to `flag[i]` can sit in its **store buffer** while its subsequent load of `flag[j]` reads memory — both processes can read the other's flag as `false` and both enter the critical section. Compilers may also reorder or cache the loads.

Fix: insert a full **memory barrier** (`atomic_thread_fence(memory_order_seq_cst)`) after the writes, or declare the variables as sequentially-consistent atomics. At that point you're relying on hardware support anyway — so practical locks use atomic read-modify-write instructions directly ([Atomic Instructions](lesson:os-atomic-instructions)).

Peterson also only works for **two** processes (generalizations like the filter lock and Lamport's bakery algorithm exist for N) and **busy-waits**.

:::depth{level=advanced}
### Lamport's bakery algorithm

For N processes: each process "takes a number" one greater than the maximum number it sees, then waits until every process with a smaller number (ties broken by process ID) has finished. It satisfies all three requirements with only reads and writes, and — notably — even tolerates reads that overlap writes returning arbitrary values. Its cost is O(N) work per entry and unbounded ticket numbers. It remains a classic illustration that mutual exclusion is possible with only reads and writes, but needs Ω(N) shared variables.
:::

### Hardware-assisted solutions

The lesson of Peterson and Bakery: doing this with plain reads and writes is possible but slow, limited and fragile. The easier path is to have the hardware provide one operation that reads *and* writes in a single indivisible step.

- **Disabling interrupts** on a uniprocessor makes a critical section atomic (no preemption) — used inside kernels for very short sections; useless on multiprocessors and forbidden in user mode.
- **Atomic instructions** (test-and-set, compare-and-swap, fetch-and-add) give simple, correct locks on any number of cores. A spinlock with test-and-set satisfies mutual exclusion and progress but **not bounded waiting** — a thread can lose the race repeatedly. A **ticket lock** (fetch-and-add a ticket, wait for your number) adds FIFO fairness and bounded waiting.

## Example

Checking a proposed lock against the requirements is a classic interview exercise:

```c
// Proposed: lock = 0 means free
while (lock == 1) ;   // wait
lock = 1;             // take it
/* critical section */
lock = 0;
```

Fails mutual exclusion: both threads can read `lock == 0` before either writes 1 (check-then-act). The fix is to make "test and set" a single atomic instruction.

## Visualization

The same "check then act" interleaving that breaks naive locks, shown on a counter:

::viz{id=race-condition}

## Complexity & Performance

- Peterson/bakery: busy-waiting burns CPU; O(N) for bakery.
- Hardware-atomic spinlocks: O(1) instructions uncontended, but under contention all waiters hammer one cache line; ticket locks give fairness but every release invalidates all waiters' cached copy; **queue locks** (MCS, CLH) let each waiter spin on its own cache line — used in the Linux kernel's qspinlock.

## Trade-offs

| Solution | Hardware needed | Mutual exclusion | Progress | Bounded waiting | Practical? |
|---|---|---|---|---|---|
| Strict alternation (turn) | None | ✔ | ✘ | ✔ | No |
| Flags only | None | ✔ | ✘ (can deadlock) | ✘ | No |
| Peterson (2 procs) | Sequential consistency | ✔ | ✔ | ✔ | Only with fences |
| Bakery (N procs) | Reads/writes | ✔ | ✔ | ✔ (FIFO) | Rarely |
| Test-and-set spinlock | Atomic RMW | ✔ | ✔ | ✘ | Yes (short sections) |
| Ticket lock | Fetch-and-add | ✔ | ✔ | ✔ | Yes |
| Futex mutex | CAS + kernel | ✔ | ✔ | Usually (not strict FIFO) | Default in user space |

## Failure Modes

- Believing a software-only algorithm works without memory barriers — it will fail rarely and unreproducibly on real hardware.
- Busy-waiting on a uniprocessor or when the holder is descheduled: waiters burn their whole slice.
- Starvation under unfair locks (violated bounded waiting).

## In Production

- Nobody ships Peterson's algorithm; the value is the **specification** and the lesson about memory ordering.
- The three properties map to how you evaluate distributed locks: can two nodes believe they hold the lock after a network partition (mutual exclusion — needs fencing tokens)? can the lock get stuck if the holder crashes (progress — needs leases/TTLs)? can clients starve (bounded waiting — needs fair queues)?

## Deeper Connections

- The requirements reappear in [deadlocks](lesson:os-deadlocks) (progress failure) and [starvation](lesson:os-deadlock-handling).
- Memory ordering is why Peterson breaks — the same reason double-checked locking breaks ([Race Conditions](lesson:os-race-conditions)).
- Database concurrency control faces the same trio: serializability (exclusion), no deadlock stalls (progress), no transaction starvation.

## Common Misconceptions

- **"Mutual exclusion is the only requirement."** A lock that never lets anyone in satisfies it trivially; progress and bounded waiting matter.
- **"Peterson's algorithm works on any computer."** Only under sequential consistency; modern CPUs need fences.
- **"A spinlock guarantees fairness."** Plain test-and-set spinlocks don't satisfy bounded waiting.

## Interview Questions

### [L1 · conceptual] What are the three requirements for a solution to the critical-section problem?

Mutual exclusion (at most one process in the critical section), progress (if none is inside and some want to enter, the choice can't be postponed indefinitely and only interested processes take part), and bounded waiting (a limit on how many times others can enter before a waiting process gets in — no starvation).

### [L2 · trace] Explain Peterson's algorithm and why it guarantees mutual exclusion.

Each process sets its flag to show interest, then sets `turn` to the other process and waits while the other is interested and it's the other's turn. If both try, both flags are true, and `turn` ends up holding one value — the one written last defers to the other — so exactly one proceeds. Mutual exclusion holds because for both to be inside, each would need `turn` to equal its own ID simultaneously.

### [L2 · why] Why does the naive "while (lock) ; lock = 1;" fail?

Checking and setting are separate operations. Two threads can both read `lock == 0` before either writes 1, then both set it and both enter the critical section. The test and set must be one atomic operation.

### [L3 · why] Why can Peterson's algorithm fail on a modern multicore processor?

It assumes sequentially consistent memory. CPUs reorder memory operations: on x86, a store can be buffered while a later load executes, so each process can set its flag and then read the other's flag as still false; both enter. Compilers can also reorder or cache the variables. A full memory fence between the writes and the loop (or seq_cst atomics) is required.

### [L3 · compare] Does a test-and-set spinlock satisfy bounded waiting? What does?

No: when the lock is released, any spinning thread may win the next test-and-set; an unlucky thread can lose repeatedly and starve. A ticket lock (each thread takes a number with fetch-and-add and waits for its turn) or queue lock (MCS) provides FIFO ordering and thus bounded waiting.

### [L4 · design] You're asked to implement a distributed lock for a job that must run on only one of five servers. Map the three critical-section requirements onto the design.

Mutual exclusion: acquire via a linearizable store (etcd/ZooKeeper, or a database row with a unique constraint), and because holders can pause (GC, network) beyond their lease, protect the resource with **fencing tokens** (monotonically increasing lock versions checked by the resource). Progress: holders can crash, so locks are **leases with TTLs**, renewed by heartbeat. Bounded waiting: use a fair queue (ZooKeeper sequential ephemeral nodes) if starvation matters. Also define what happens during partitions — prefer safety (no two holders) over availability.

## Practice

### [mcq] The "strict alternation" solution using a single turn variable violates which requirement?

- [ ] Mutual exclusion
- [x] Progress
- [ ] Bounded waiting
- [ ] None

A process not interested in entering can block the other from entering twice in a row.

### [mcq] Two processes use flags only: `flag[i]=true; while(flag[j]);`. What can happen if both set their flags at the same time?

- [ ] Both enter the critical section
- [x] Both wait forever
- [ ] One enters, the other starves permanently
- [ ] Nothing — it's correct

Each waits for the other to lower its flag.

## Quick Revision

- Structure: entry → critical section → exit → remainder.
- Requirements: **mutual exclusion**, **progress**, **bounded waiting**.
- Turn variable → strict alternation (no progress). Flags only → both wait forever.
- **Peterson**: `flag[i]=true; turn=j; while(flag[j] && turn==j);` — correct for 2 processes under sequential consistency.
- Modern CPUs reorder → needs memory fences → practical locks use atomic RMW instructions.
- Test-and-set lock: no bounded waiting; ticket/queue locks: FIFO.
