---
title: "Distributed SQL: Spanner, CockroachDB and the NewSQL Design"
subject: db
level: 15
order: 5
summary: "How modern distributed SQL databases combine range sharding, Raft/Paxos replication per range, distributed transactions over consensus, and clock-based ordering (TrueTime, hybrid logical clocks) to offer serializable SQL at scale — and what that costs in latency and operations."
depth: senior
difficulty: 5
minutes: 45
relevance: medium
stage: 4
prerequisites: [db-distributed-transactions, db-sharding]
related: [db-quorums-consensus, db-consistency-models, db-cap-pacelc, db-lsm-trees, db-mvcc, db-isolation-levels]
tags: [distributed sql, newsql, spanner, cockroachdb, tidb, yugabytedb, range sharding, raft groups, truetime, commit wait, hybrid logical clock, external consistency, follower reads, leaseholder, geo partitioning, parallel commits]
---

## Mental Model

Distributed SQL databases present **one logical SQL database with ACID transactions** while internally being many machines. The recipe combines everything in this track:

1. **Split** tables (and indexes) into key ranges — shards that split and move automatically ([Sharding](lesson:db-sharding)).
2. **Replicate** each range with its own consensus group (Raft/Paxos) — every range is a small fault-tolerant log ([Quorums & Consensus](lesson:db-quorums-consensus)).
3. Run **transactions across ranges** with a 2PC variant whose coordinator state is itself replicated — so it doesn't block ([Distributed Transactions](lesson:db-distributed-transactions)).
4. Order transactions with **timestamps** (MVCC) from carefully managed clocks, to provide serializable (often strictly serializable) isolation without a single global sequencer ([MVCC](lesson:db-mvcc)).

The price: every write pays consensus round trips, and cross-region deployments pay speed-of-light latency.

## Definition

- **Range (tablet/split/region)**: a contiguous span of the sorted key space (~hundreds of MB), the unit of replication and rebalancing.
- **Raft group per range**: typically 3 or 5 replicas; one replica holds the **lease** (leaseholder/leader) and serves consistent reads and coordinates writes.
- **TrueTime** (Spanner): a clock API returning an interval [earliest, latest] with bounded uncertainty (GPS + atomic clocks, typically a few ms).
- **Commit wait**: Spanner waits out the uncertainty before making a commit visible, guaranteeing that timestamp order matches real-time order (**external consistency** = strict serializability).
- **Hybrid logical clocks (HLC)**: physical time + logical counter (CockroachDB, YugabyteDB); combined with a maximum clock offset and uncertainty restarts instead of specialized hardware.
- **Follower reads**: reads at a slightly past timestamp served by any replica (bounded staleness, low latency).

## Why It Exists

**The problem.** Application-level sharding scales but pushes cross-shard joins, transactions, uniqueness and resharding onto every team. NoSQL scales but gives up SQL and transactions. Google built Spanner (2012) because even its engineers struggled with eventually consistent systems for business data; CockroachDB, TiDB and YugabyteDB brought the architecture to everyone. The goal: **scale out without giving up SQL, joins and serializable transactions**.

**The idea.** None of the parts are new; they're the previous lessons stacked:

- range sharding to split the data;
- consensus to replicate each piece safely;
- 2PC with a replicated coordinator for cross-piece transactions;
- MVCC timestamps to order everything.

The database does the sharding work so applications don't have to.

:::callout[That's all it is]{type=insight}
Distributed SQL = sorted key ranges, each replicated by its own Raft group, plus transactions that span ranges using a fault-tolerant 2PC and timestamp-ordered MVCC. One SQL database on the outside; many consensus groups inside.
:::

## How It Works

### Data layout

```text
table orders, primary key (region, id)
  ├── range [ (ap, 0) … (ap, 50000) )   → Raft group {n1, n4, n7}, lease on n4
  ├── range [ (ap, 50000) … (eu, 0) )  → Raft group {n2, n5, n8}, lease on n2
  └── range [ (eu, 0) … ∞ )            → Raft group {n3, n6, n9}, lease on n6
secondary index orders_by_customer     → its own ranges and Raft groups
```

Ranges split when they grow or get hot and are rebalanced across nodes automatically. A SQL layer on every node plans queries and routes key lookups to the right leaseholders.

### A write transaction

1. The gateway node starts a transaction with a timestamp.
2. Writes become **intents** (provisional MVCC versions) replicated through each affected range's Raft group.
3. Commit: the transaction record is marked committed (itself replicated via Raft) — with optimizations like **parallel commits** (CockroachDB) that commit in one round of consensus.
4. Intents are resolved into committed versions asynchronously; readers encountering an intent check the transaction record.

Because the coordinator's state lives in a consensus-replicated record, a node crash doesn't leave participants blocked indefinitely — another node can determine the outcome.

### Ordering with clocks

Without a single machine handing out transaction numbers, nodes must agree on order using clocks, and real clocks disagree by milliseconds. MVCC needs timestamps that agree with causality: if T2 starts after T1 finished, T2 must get a larger timestamp, or it won't see T1's writes. Each system handles the clock uncertainty differently.

**Spanner (TrueTime).** Its clock API returns an interval guaranteed to contain the true time, say ±4 ms.

1. To commit T1, pick the timestamp `s` at the *top* of the interval: `s = TT.now().latest`.
2. **Commit wait**: don't reply until `TT.now().earliest > s`, about 2 × 4 = 8 ms later. Now every clock in the world is past `s`.
3. Any T2 that starts after the reply therefore gets a timestamp above `s` and sees T1.

**CockroachDB (hybrid logical clocks).** No special hardware. It assumes clocks differ by at most a configured offset (500 ms by default). When a read finds a value written "slightly in its future" (inside that uncertainty window), it can't tell which came first, so it **restarts** at a higher timestamp. This gives serializability, though not strict serializability in every case.

### Latency geography

| Deployment | Write commit latency (roughly) |
|---|---|
| 3 replicas in one region (3 zones) | a few ms (inter-zone round trip + fsync) |
| Replicas across 3 regions | 50–150 ms (majority crosses regions) |
| Geo-partitioned: each row's replicas/leaseholder in its "home" region | local latency for local rows; cross-region only for global data |

Features like regional tables, partition pinning and follower reads exist to keep most operations inside one region.

## Internal Mechanism

:::depth{level=advanced}
### Storage engines

Each node stores its range replicas in an LSM engine (Pebble for CockroachDB, RocksDB for TiKV/YugabyteDB's DocDB), with MVCC versions as key suffixes (key@timestamp) ([LSM Trees](lesson:db-lsm-trees)). Garbage collection of old versions runs after a configurable TTL — which also bounds how far back "AS OF SYSTEM TIME" historical reads can go.

### Contention handling

Serializable isolation with optimistic timestamp ordering means contended transactions restart (`RETRY_SERIALIZABLE`/40001). Hot rows (counters, sequences) are as bad as ever — worse, because every conflict costs consensus round trips. Use UUIDs or hash-sharded indexes instead of sequential keys to avoid a single hot range at the end of the keyspace.

### Distributed query execution

Joins and aggregations are pushed to the nodes holding the data (DistSQL, TiDB's coprocessor on TiKV), with results streamed back — distributed hash joins when data must be shuffled.

### Compatibility

CockroachDB and YugabyteDB speak the PostgreSQL wire protocol; TiDB speaks MySQL's. Compatibility is broad but not complete (extensions, some DDL and isolation behaviors, performance characteristics of sequences and foreign keys).
:::

## Example

A global payments platform with users in India and Europe:

- Table `accounts` geo-partitioned by `region`: Indian accounts' leaseholders and a majority of replicas in Mumbai-area zones; European ones in Frankfurt. Local transfers commit in ~5 ms.
- A cross-region transfer (India → Europe) is a distributed transaction touching both partitions: ~100–150 ms, but atomic and serializable without application-level sagas.
- Reference data (currencies, fee tables) as "global tables": replicated everywhere, fast local reads, slow writes (which are rare).

Compare with the alternative: two regional PostgreSQL clusters + a saga + reconciliation — lower infrastructure cost and latency for local work, more application complexity for cross-region work.

## Complexity & Performance

- Point reads: one hop to the leaseholder (or local follower read); ~1–2 ms in-region.
- Writes: consensus round trip(s) per transaction; higher than single-node PostgreSQL (~0.1–1 ms local commit).
- Throughput scales horizontally for well-distributed workloads; single hot keys don't.

## Trade-offs

- Transparent scale-out, automatic failover (per range) and SQL/ACID vs higher per-transaction latency, operational newness, cost, and compatibility gaps.
- Single-node PostgreSQL is faster per operation and simpler until you truly need multi-node writes, multi-region survivability, or larger-than-one-machine data.

## Failure Modes

- Deploying across regions without geo-partitioning → every write crosses oceans.
- Sequential primary keys → one hot range absorbs all inserts.
- High-contention workloads → retry storms; applications without retry loops fail.
- Clock problems (CockroachDB nodes exceeding max offset shut themselves down to protect consistency).

## In Production

- Model locality explicitly (regional by row, global tables); test with realistic latency between regions.
- Always implement transaction retry loops; monitor contention, range hotspots, lease distribution.

## Deeper Connections

- This lesson is the capstone: sharding + consensus + MVCC + 2PC + clocks + LSM storage in one system ([Sharding](lesson:db-sharding), [Quorums & Consensus](lesson:db-quorums-consensus), [MVCC](lesson:db-mvcc), [Distributed Transactions](lesson:db-distributed-transactions)).
- External consistency is strict serializability, the top of the consistency ladder ([Consistency Models](lesson:db-consistency-models)).

## Common Misconceptions

- **"Distributed SQL beats CAP."** It's CP: minority partitions stop serving writes (and consistent reads) for their ranges.
- **"It's a drop-in replacement for PostgreSQL."** Protocol-compatible, not performance- or feature-identical.
- **"Adding nodes makes every query faster."** It adds capacity; individual transaction latency is dominated by consensus and geography.

## Interview Questions

### [L3 · how] How does a distributed SQL database like CockroachDB or Spanner execute a transaction across shards?

Data is split into key ranges, each replicated with its own Raft/Paxos group. A transaction writes provisional MVCC versions (intents) through each range's consensus group, and records its status in a transaction record that is itself replicated. Commit marks that record committed (2PC-like, but the coordinator state is fault-tolerant), after which intents are resolved. Timestamps from TrueTime or hybrid logical clocks order transactions for serializable isolation.

### [L3 · why] What is TrueTime's commit wait and why is it needed?

TrueTime exposes clock uncertainty as an interval. Spanner assigns a commit timestamp at or above the interval's upper bound and then waits until the lower bound of the current time exceeds that timestamp before making the commit visible. This ensures any transaction that starts after the commit completes gets a larger timestamp, so timestamp order matches real-time order — external consistency — at the cost of a few milliseconds per commit.

### [L3 · design] When would you choose distributed SQL over sharded PostgreSQL?

When you need multi-node write scale or datasets beyond one machine *and* want to keep cross-shard ACID transactions, joins, secondary indexes and automatic rebalancing/failover — especially for multi-region survivability with data locality. Stay with PostgreSQL (possibly with application sharding or Citus) when one node suffices, latency per transaction matters most, you rely on PostgreSQL-specific features/extensions, or the team's operational experience is there.

### [L2 · compare] Spanner vs CockroachDB — how do they order transactions?

Spanner uses TrueTime, a clock API with bounded uncertainty backed by GPS and atomic clocks, and waits out that uncertainty at commit (commit wait) to give external consistency (strict serializability). CockroachDB runs on ordinary clocks with hybrid logical clocks and a configured maximum offset; when a read encounters a value inside its uncertainty window it restarts at a higher timestamp. It provides serializable isolation without specialized hardware, with strict serializability not guaranteed in every case.

### [L2 · how] What are follower reads and when would you use them?

Reads served by any replica (not just the leaseholder) at a timestamp slightly in the past — e.g. 5 seconds ago — that every replica is guaranteed to have. They avoid cross-region round trips to the leader, so they're fast and cheap, at the cost of bounded staleness. Good for dashboards, catalogs and analytics; not for reads that decide a write.

### [L2 · debugging] Inserts into a distributed SQL table with an auto-incrementing primary key are slow and one node is hot. Why?

The table is range-partitioned by primary key, so increasing keys always land in the last range, owned by one leaseholder: every insert goes to the same node and that range splits repeatedly. Use a random or hashed key (UUIDs, a hash-sharded index on the sequential column) so inserts spread across ranges and nodes.

## Practice

### [mcq] In range-sharded distributed SQL, what is the unit of replication and consensus?

- [ ] The whole cluster
- [ ] Each table
- [x] Each key range (split/tablet)
- [ ] Each row

Every range has its own Raft/Paxos group, so the system scales by adding more groups.

### [mcq] Why can sequential primary keys hurt write throughput in distributed SQL?

- [ ] They can't be indexed
- [x] All new rows land in the last key range, making one range (and its leaseholder) a hotspot
- [ ] They break MVCC
- [ ] They require TrueTime

Hash-sharded indexes or UUIDs spread inserts across ranges.

### [numeric 8 unit=ms] A Spanner-style system has a clock uncertainty interval of ±4 ms. Up to how long does commit wait delay acknowledging a write?

:::answer
The commit timestamp is chosen at the top of the uncertainty interval, and the system waits until every clock must have passed it: about 2 × 4 = **8** ms. Better clocks (GPS and atomic references) directly reduce this cost.
:::

### [mcq] What do "follower reads" in distributed SQL trade?

- [ ] Durability for speed
- [x] Freshness for latency: a nearby replica serves a read at a slightly older timestamp instead of going to the range's leaseholder
- [ ] Consistency of writes for availability of writes
- [ ] They make every read linearizable

Reads at a timestamp a few seconds in the past are safe on any replica that has applied up to that time — perfect for dashboards and lists, wrong for read-after-write flows.

### [mcq] A CockroachDB range grows beyond its size limit. What happens?

- [ ] Writes to it are rejected
- [x] It splits into two ranges, each with its own Raft group, which can then be rebalanced onto different nodes
- [ ] The whole table is resharded
- [ ] It moves to a bigger node

Automatic splitting (by size, and by load for hot ranges) and rebalancing are what let range-sharded systems grow without manual resharding.

### [exercise] Users in India and the EU must have their personal data stored in their own region, and their everyday requests should be fast. Sketch a distributed SQL design.

:::solution
Add a `region` column to user-owned tables and **geo-partition** by it: rows with `region = 'in'` keep their replicas (and their leaseholder) in Indian zones, `region = 'eu'` in EU zones. Most requests touch one user's rows, so their reads and consensus writes stay in-region: a few milliseconds.

Global reference data that everyone reads (product catalogue, configuration) goes in **global tables** replicated everywhere, optimized for fast reads with slower writes. Cross-region operations (an Indian user messaging an EU user) pay the cross-region round trip and must not copy personal data into the wrong region. Within each region, use three zones so a zone failure keeps a majority; decide explicitly what happens if an entire region fails (data residency may forbid failing over elsewhere).
:::

## Quick Revision

- Ranges (auto split/move) × consensus group per range × distributed transactions with replicated coordinator state × MVCC timestamps.
- Spanner: TrueTime + commit wait → external consistency. CockroachDB: HLC + max offset + uncertainty restarts.
- Latency = consensus round trips × geography; geo-partition to keep writes local; follower reads for bounded staleness.
- CP under partitions; retries required under contention; avoid sequential keys.
- Choose it when you truly need scale-out + SQL/ACID; single-node PostgreSQL is faster per operation.
- Spanner: TrueTime + commit wait → strict serializability. CockroachDB: HLC + max offset + uncertainty restarts → serializable. Follower reads = bounded-staleness, local, cheap. Sequential PKs → one hot range.
