---
title: "Consistency Models: Linearizable, Sequential, Causal, Eventual"
subject: db
level: 15
order: 2
summary: "A precise ladder of guarantees about what reads may return in replicated systems — linearizability, sequential and causal consistency, session guarantees (read-your-writes, monotonic reads), eventual consistency — and how they relate to serializability and strict serializability."
depth: senior
difficulty: 4
minutes: 45
relevance: medium
stage: 4
prerequisites: [db-cap-pacelc]
related: [db-replication, db-isolation-levels, db-quorums-consensus, db-anomalies, os-race-conditions, db-distributed-sql]
tags: [consistency models, linearizability, sequential consistency, causal consistency, eventual consistency, read your writes, monotonic reads, monotonic writes, writes follow reads, session guarantees, strict serializability, crdt, happens before]
---

## Mental Model

With one copy of data, "read the latest value" is obvious. With replicas, clocks and in-flight messages, "latest" is ambiguous, so systems promise one of several **contracts about which values a read may return**. Stronger contracts behave more like a single copy; weaker ones allow more surprises but need less coordination (lower latency, higher availability).

A useful picture: each client's operations are events on a timeline. A consistency model says which **orderings of those events** the system is allowed to make visible.

## Definition

From strongest to weakest (single-object models):

| Model | Guarantee | Intuition |
|---|---|---|
| **Linearizability** (atomic/strong consistency) | Each operation appears to take effect at a single instant between its invocation and response; reads return the most recent completed write in that real-time order | behaves like one copy |
| **Sequential consistency** | All clients see operations in one total order consistent with each client's program order — but not necessarily real time | one agreed order, possibly lagging |
| **Causal consistency** | Operations that are causally related (A happened-before B) are seen in that order by everyone; concurrent operations may be seen in different orders | no reply before its question |
| **Session guarantees** | Per client: read-your-writes, monotonic reads, monotonic writes, writes-follow-reads | a single user's view makes sense |
| **Eventual consistency** | If writes stop, all replicas eventually converge | anything goes in the meantime |

Transaction models (multi-object) are a different axis: **serializability** (transactions equivalent to some serial order, no real-time requirement) and **strict serializability** (serializable + linearizable: the serial order respects real time).

## Why It Exists

**The problem.** "Consistent" is used loosely; engineers and databases mean different things by it. With copies on several machines, "the latest value" stops being obvious — and making every copy agree on every read is expensive.

**The idea.** Instead of one vague promise, define a ladder of precise ones, from "behaves like a single copy" down to "copies agree eventually". Precise models let you state what an application needs ("users must see their own posts immediately" = read-your-writes, not full linearizability) and choose the cheapest system/configuration that provides it.

:::callout[That's all it is]{type=insight}
A consistency model is a promise about which values a read may return. Linearizable: as if there's one copy. Causal: causes before effects. Session guarantees: your own view makes sense. Eventual: copies agree once writes stop.
:::

## How It Works

### Linearizability example and violation

```text
Client A:  |—— write x=1 ——|
Client B:                      |— read x → 0 —|     ✗ not linearizable (write completed before read started)
Client C:          |———— read x → 1 or 0 ————|      ✓ either is fine (overlaps the write)
```

Once any read returns the new value, all later reads (in real time) must also return it — no "flip-flopping" back to old values.

Needed for: leader election, locks, uniqueness checks, "compare-and-set", balances that must not be double-spent. Provided by: single-leader reads from the leader (with care during failover), consensus systems (etcd, ZooKeeper sync reads, Spanner), quorum reads with read repair under restrictions.

### Session guarantees in practice

| Guarantee | Violation users notice | Typical implementation |
|---|---|---|
| Read-your-writes | "I updated my name but still see the old one" | read from leader after writes; track the write's LSN/version and wait for a replica that has it |
| Monotonic reads | refresh shows a newer comment, next refresh it's gone | sticky replica per session |
| Monotonic writes | edits applied out of order | route a session's writes to one leader |
| Writes-follow-reads | reply stored before the post it replies to becomes visible elsewhere | attach dependencies (causal metadata) |

These are cheap and cover most user-facing expectations without global coordination ([Replication](lesson:db-replication)).

### Causal consistency

Tracks *happened-before*: if you read a post and then reply, anyone who sees your reply must also be able to see the post. Implemented with version vectors / dependency metadata; achievable while staying available during partitions — the strongest model with that property.

### Eventual consistency and conflicts

The bill for letting every replica accept writes without coordinating: two of them may accept *different* writes to the same item. Replicas accept writes independently and exchange them later. Concurrent writes to the same item conflict; resolution strategies:

- **Last-write-wins** (by timestamp): simple, silently loses data, sensitive to clock skew.
- **Version vectors (vector clocks) + siblings**: track per-replica counters to detect whether two writes are causally ordered or genuinely concurrent, return all concurrent versions, and let the application merge them (Dynamo/Riak).
- **CRDTs** (conflict-free replicated data types): counters, sets, maps and text designed so concurrent updates merge deterministically (collaborative editors, presence, carts).

## Internal Mechanism

:::depth{level=advanced}
### Linearizability vs serializability

- **Serializability** is about *transactions over many objects*: there exists some serial order. It may not match real time — a read-only transaction may observe a state that's slightly in the past.
- **Linearizability** is about *single operations on single objects* matching real time.
- **Strict serializability** combines both; it's what Spanner provides (using TrueTime commit-wait) and what "external consistency" means ([Distributed SQL](lesson:db-distributed-sql)).

A single-node PostgreSQL at Serializable is strictly serializable for its clients; its asynchronous replicas are not even read-your-writes for a client that wrote to the primary.

### Why linearizability is expensive

It requires coordination on (almost) every operation: a read must confirm it's not stale — contact a quorum or hold a lease that guarantees no newer leader exists. Across regions that's 100+ ms per operation. Hence techniques like leader leases (fast local reads, dependent on bounded clock drift) and follower reads at a chosen timestamp (bounded staleness).

### Memory models echo this

CPU memory models are consistency models for cores: x86's TSO, ARM's weaker ordering, and C++/Java's sequentially consistent atomics. The same questions — which writes can a reader see, in what order — apply ([Race Conditions](lesson:os-race-conditions)).
:::

## Example

A social app on a primary + async read replicas:

| Feature | Needed guarantee | Implementation |
|---|---|---|
| Username uniqueness at signup | linearizable | unique constraint on the primary |
| User sees their own new post | read-your-writes | read the author's own feed from the primary for 10 s after posting |
| Feed doesn't "go back in time" on refresh | monotonic reads | sticky replica per session |
| Replies appear after the posts they answer | causal | read replies and parent from the same replica / include parent in reply |
| Like counts | eventual | async counters, periodic reconciliation |

## Complexity & Performance

Stronger models require waiting for coordination (quorums, leaders, clock uncertainty); weaker models answer locally. Latency and availability costs rise going up the ladder.

## Trade-offs

Pick the weakest model that keeps the application correct and users unsurprised; pay for linearizability only where invariants demand it (uniqueness, money, locks, leader election).

## Failure Modes

- Assuming "strong consistency" from a system configured for eventual consistency (replica reads, CL ONE).
- Linearizability broken during failover (a deposed leader serving reads).
- Last-write-wins with skewed clocks silently discarding newer writes.
- Session guarantees lost when load balancers spread one user's requests across replicas.

## In Production

- Document which consistency each read path uses; many "flaky" bugs are consistency-model mismatches.
- Jepsen analyses are the best public source for which guarantees databases actually provide under faults.

## Deeper Connections

- Isolation levels describe transaction anomalies on one node; consistency models describe what replicas expose — related vocabularies for concurrency ([Isolation Levels](lesson:db-isolation-levels)).
- Consensus is the tool for linearizable operations ([Quorums & Consensus](lesson:db-quorums-consensus)).

## Common Misconceptions

- **"Eventual consistency means data is usually consistent within milliseconds."** It gives no bound; lag can be seconds or hours under failure.
- **"Serializable implies linearizable."** Serializable transactions can observe stale-but-consistent states unless the system is strictly serializable.
- **"Strong consistency is binary."** There's a ladder, and session guarantees cover most user expectations cheaply.

## Interview Questions

### [L2 · compare] Linearizability vs eventual consistency?

Linearizability makes a replicated object behave like a single copy: every operation takes effect at one instant between its start and end, so after a write completes all subsequent reads see it. Eventual consistency only promises that replicas converge if writes stop; reads may return stale or out-of-order values meanwhile. Linearizability needs coordination (latency, reduced availability under partitions); eventual consistency allows local, always-available operations.

### [L3 · compare] Serializability vs linearizability vs strict serializability?

Serializability: concurrent transactions over multiple objects produce the same result as some serial order — not necessarily respecting real time. Linearizability: single operations on single objects appear atomic and respect real-time order. Strict serializability: transactions are serializable in an order consistent with real time — the strongest common guarantee (Spanner's external consistency, single-node databases at Serializable).

### [L2 · scenario] Users comment and then don't see their comment after refreshing. Name the guarantee being violated and fix it.

Read-your-writes (a session guarantee): the write went to the primary, but the read went to a lagging replica. Fix by routing the user's reads to the primary for a short period after writes, or by tracking the write's log position/version and only reading from replicas that have applied it; sticky sessions additionally give monotonic reads.

## Practice

### [mcq] A client reads x = 5, then later reads x = 3 (an older value) from another replica. Which guarantee is violated?

- [ ] Read-your-writes
- [x] Monotonic reads
- [ ] Monotonic writes
- [ ] None — this is always allowed

Monotonic reads forbid going back in time within a session; eventual consistency alone allows it.

### [mcq] Which is the strongest model that can remain available during network partitions?

- [ ] Linearizability
- [ ] Sequential consistency
- [x] Causal consistency
- [ ] Strict serializability

Causal consistency can be provided with local operations and asynchronous propagation.

## Quick Revision

- Ladder: linearizable > sequential > causal > session guarantees > eventual.
- Linearizable = single copy in real time; needed for locks, uniqueness, leader election, money.
- Session guarantees (read-your-writes, monotonic reads/writes, writes-follow-reads) fix most UX issues cheaply.
- Eventual: converge eventually; conflicts via LWW (lossy), version vectors, CRDTs.
- Serializable (transactions, any order) vs strict serializable (+ real time).
