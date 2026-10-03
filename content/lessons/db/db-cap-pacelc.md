---
title: "CAP and PACELC: The Real Trade-offs of Replicated Data"
subject: db
level: 15
order: 1
summary: "What the CAP theorem actually says (and the common ways it's misquoted), why partitions force a choice between consistency and availability, and PACELC's more useful everyday question: latency versus consistency when there is no partition."
depth: advanced
difficulty: 3
minutes: 35
relevance: high
stage: 3
prerequisites: [db-replication]
related: [db-consistency-models, db-quorums-consensus, db-failover, db-wide-column, db-distributed-sql, cn-tail-latency]
visualizations: [quorum]
tags: [cap theorem, consistency, availability, partition tolerance, pacelc, latency, linearizability, cp, ap, network partition, eventual consistency, trade-offs]
---

## Mental Model

Replicas are connected by a network, and networks fail. When a **partition** separates replicas, a request arrives at one side. That side can either:

- **refuse or wait** until it can coordinate with the other side (stay **consistent**, sacrifice **availability**), or
- **answer with what it knows** (stay **available**, risk returning or accepting data that disagrees with the other side — sacrifice **consistency**).

That's CAP: during a partition, choose C or A. And PACELC adds the part that matters every day: **E**lse (no partition), you still choose between **L**atency and **C**onsistency, because coordinating replicas takes round trips.

## Definition

- **C (consistency) in CAP** = **linearizability**: every operation appears to take effect atomically at a single point in time; after a write completes, every read sees it or a later value ([Consistency Models](lesson:db-consistency-models)). (Not the "C" in ACID.)
- **A (availability)** = every request to a non-failed node receives a non-error response (eventually).
- **P (partition tolerance)** = the system keeps operating despite arbitrary message loss between nodes.
- **CAP theorem** (Brewer's conjecture, proved by Gilbert & Lynch, 2002): a distributed system can't guarantee both C and A in the presence of a partition.
- **PACELC** (Abadi, 2012): if **P**artition → trade **A** vs **C**; **E**lse → trade **L**atency vs **C**onsistency.

## Why It Exists

Engineers needed a way to reason about why distributed databases behave so differently under failure — why one returns errors during a network split while another keeps accepting writes that later conflict. CAP names the unavoidable choice; PACELC explains the performance differences you see even when nothing is broken.

## How It Works

### The two-replica argument

Replicas R1 and R2 of key x (value 1). The network between them fails.

```text
client A → R1: write x = 2        client B → R2: read x
```

- If R1 accepts the write without reaching R2 and R2 answers B's read, B sees x = 1 after x = 2 was acknowledged → **not linearizable** (chose A).
- To stay linearizable, R1 must refuse/hold the write or R2 must refuse/hold the read until the partition heals → **not available** (chose C).

No clever algorithm avoids this; it's a limit of information: R2 can't know about a write it never received.

### "Pick two of three" is misleading

P isn't optional — partitions happen (switch failures, misconfigured firewalls, GC pauses that look like partitions). The real statement: **when a partition happens**, choose C or A. When there's no partition, a system can offer both.

And systems choose per operation, not globally: many databases let you choose consistency per query (Cassandra CL, DynamoDB strongly consistent reads, MongoDB read/write concerns).

### Classifying systems (roughly)

| System (default config) | During partition (PA/PC) | Normal operation (EL/EC) |
|---|---|---|
| Single-leader SQL with sync replica + consensus failover | PC — minority side refuses writes | EC — waits for replica acks |
| Single-leader async replication, reads from replicas | writes: PC on the leader side; replica reads: PA (stale) | EL for replica reads |
| Cassandra / Dynamo-style (CL ONE) | PA — any replica accepts | EL — respond from one replica |
| Cassandra (QUORUM) | PC for operations lacking a quorum | EC-ish — waits for majority |
| Spanner / CockroachDB | PC — majority side only | EC — consensus round trips (Spanner also waits out clock uncertainty) |
| ZooKeeper / etcd | PC | EC |

Labels are simplifications; real systems mix behaviors per operation and failure type.

### PACELC in numbers

A write acknowledged after a majority of three replicas in three availability zones pays one inter-zone round trip (~1–2 ms). Across three continents it pays ~100+ ms. Asynchronous replication pays nothing — but a region failure can lose acknowledged writes, and remote reads are stale. That latency-vs-consistency decision is made on **every request**, not just during rare partitions — which is why PACELC is the more practical lens.

## Internal Mechanism

:::depth{level=advanced}
### What "available" costs in practice

CAP-availability demands that *every* non-failed node answer. Many "CP" systems remain highly available in practice: the majority side of a partition keeps serving; only the minority side (often a small fraction of clients) gets errors. Conversely, "AP" systems that promise answers still suffer outages from other causes. CAP is about a narrow formal property, not overall uptime.

### Partitions that aren't network failures

A leader stuck in a 30-second GC pause is indistinguishable from a partitioned one; so is an overloaded node timing out. Timeouts turn slowness into perceived partitions — and CAP-style choices kick in (failover, refusing writes, serving stale data) ([Failover](lesson:db-failover)).

### Beyond CAP

CAP considers only linearizability vs availability. Weaker models (causal consistency, read-your-writes) **can** be provided while remaining available under partitions — which is why they're attractive for geo-distributed systems ([Consistency Models](lesson:db-consistency-models)).
:::

## Example

A shopping cart vs a bank balance during a partition between two data centers:

- **Cart (choose A)**: accept "add item" on both sides; merge carts when the partition heals (union of items — Amazon's Dynamo paper example). An occasional resurrected deleted item is acceptable.
- **Balance (choose C)**: only the side holding the majority/leader accepts debits; the other side refuses ("try again later"). Overdrafts from two sides each spending the full balance are not acceptable.

Same company, same partition, different correct choices — decided by the cost of inconsistency versus the cost of unavailability.

## Complexity & Performance

- Strong consistency across replicas: at least one round trip to a quorum per write (and per linearizable read, unless leases are used).
- Eventual consistency: local latency, plus conflict resolution work later.

## Trade-offs

Choose per data type and operation: what does an error or delay cost the business, versus what does a stale or conflicting value cost? Money, inventory, uniqueness, locks → consistency. Feeds, carts, counters, presence → availability/latency.

## Failure Modes

- Believing a system is "CA" (no such thing once data is replicated over a network).
- Assuming quorum reads/writes are linearizable in all failure cases (sloppy quorums, LWW with skewed clocks break it).
- Choosing AP for data whose conflicts can't be merged (balances), or CP for data where unavailability hurts more than staleness (product catalog).

## In Production

- Make the choice explicit in design docs: which operations must be linearizable, what happens on the minority side of a partition, how conflicts are resolved.
- Test with fault injection (partition two AZs, pause the leader) — Jepsen-style tests have found many databases violating their documented guarantees.

## Deeper Connections

- Quorums and consensus are the machinery behind CP systems ([Quorums & Consensus](lesson:db-quorums-consensus)); leaderless replication with tunable CL implements the AP side ([Wide-Column Stores](lesson:db-wide-column)).
- Tail latency grows with the number of replicas you wait for ([Tail Latency](lesson:cn-tail-latency)).

## Common Misconceptions

- **"Pick any two of C, A, P."** Partitions aren't optional; the choice is C vs A *during* one.
- **"CAP consistency = ACID consistency."** CAP's C is linearizability; ACID's C is constraint preservation.
- **"NoSQL = AP, SQL = CP."** Behavior depends on configuration and operation, not the query language.

## Interview Questions

### [L2 · conceptual] Explain the CAP theorem correctly.

In a replicated system, if a network partition prevents replicas from communicating, the system must either keep responding on both sides — risking inconsistent (non-linearizable) results — or refuse/delay some requests to keep a single consistent view. You can't have both linearizable consistency and full availability during a partition. Without partitions, both are possible.

### [L2 · compare] What does PACELC add to CAP?

It points out that even without partitions there's a trade-off: to keep replicas consistent, operations must wait for coordination (latency); to be fast, respond before coordinating (weaker consistency). So systems are classified as PA/EL (e.g., Dynamo-style with low CL), PC/EC (Spanner, etcd), etc. This latency–consistency trade-off affects every request, which makes it more relevant day to day than the partition case.

### [L3 · design] A global app stores user profiles and account balances. How do you apply CAP/PACELC?

Profiles: prioritize availability and latency — replicate asynchronously to all regions, serve reads locally, accept writes in the home region (or multi-region with last-write-wins/merge), tolerate brief staleness. Balances: prioritize consistency — a single home region/leader per account (or a consensus-replicated database), synchronous/majority writes, and refuse or redirect writes when the owning quorum isn't reachable. Different data, different choices, stated explicitly.

## Practice

### [mcq] In CAP, what does "C" mean?

- [ ] Database constraints are never violated
- [x] Linearizability: all operations appear to happen atomically in one global order consistent with real time
- [ ] Every replica eventually converges
- [ ] Transactions are serializable

It's a single-object recency guarantee, not ACID consistency.

### [mcq] During a partition, a 5-node CP system with majority quorums is split 3 / 2. What happens?

- [x] The 3-node side can continue; the 2-node side rejects operations requiring a quorum
- [ ] Both sides continue normally
- [ ] Both sides stop
- [ ] The 2-node side elects its own leader

Only a majority can form quorums, so consistency is preserved at the cost of the minority side's availability.

## Quick Revision

- Partition ⇒ choose linearizable consistency (refuse on one side) or availability (answer, risk divergence).
- P isn't optional; "CA" doesn't exist for replicated systems.
- PACELC: else, latency vs consistency — the everyday trade-off.
- CAP's C = linearizability ≠ ACID's C.
- Choose per data/operation by the cost of errors vs the cost of stale/conflicting data.
