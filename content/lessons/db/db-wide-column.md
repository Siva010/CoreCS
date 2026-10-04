---
title: "Wide-Column Stores: Cassandra-Style Query-First Modeling"
subject: db
level: 14
order: 4
summary: "Partition keys and clustering columns, one table per query, time bucketing to bound partitions, tunable consistency with quorums, tombstones and TTLs, and why Cassandra/ScyllaDB/Bigtable excel at massive write-heavy workloads yet punish ad-hoc queries."
depth: advanced
difficulty: 4
minutes: 45
relevance: medium
stage: 4
prerequisites: [db-nosql-landscape, db-lsm-trees, db-consistent-hashing]
related: [db-quorums-consensus, db-sharding, db-cap-pacelc, db-consistency-models]
visualizations: [quorum]
tags: [wide column, cassandra, scylladb, bigtable, hbase, partition key, clustering key, cql, query first design, denormalization, time bucketing, wide partitions, tunable consistency, quorum, tombstones, ttl, lightweight transactions]
---

## Mental Model

A wide-column table is a **distributed, sorted map of maps**:

```text
partition key  →  sorted by clustering columns  →  column values
"conv:42"      →  2024-06-01T10:00 → {sender: "asha", text: "hi"}
                  2024-06-01T10:02 → {sender: "ravi", text: "hey"}
                  …
```

The **partition key** decides which nodes store the data (via a hash ring — [Consistent Hashing](lesson:db-consistent-hashing)). Within a partition, rows are **sorted by clustering columns**, so "the latest 50 messages in conversation 42" is one sequential read on one set of replicas.

Everything else follows: queries must supply the partition key; you design **one table per query pattern**; you duplicate data freely; writes are cheap (LSM trees — [LSM Trees](lesson:db-lsm-trees)).

## Definition

- **Primary key** = `((partition key columns), clustering columns…)`.
- **Partition**: all rows sharing a partition key; stored together, replicated together.
- **Clustering columns**: sort order within a partition; enable range queries and ordering inside it.
- **Replication factor (RF)**: copies of each partition (e.g., 3 across racks/zones).
- **Consistency level (CL)**: per-query number of replicas that must respond (`ONE`, `QUORUM`, `LOCAL_QUORUM`, `ALL`).
- **Tombstone**: a deletion marker ([LSM Trees](lesson:db-lsm-trees)).
- **TTL**: per-row/column expiry.

## Why It Exists

**The problem.** Some workloads are huge and write-heavy with simple, known read patterns: messaging, activity feeds, IoT telemetry, metrics, fraud signals. They need linear horizontal scale, multi-datacenter availability, no single leader to fail over, and predictable latency — at the cost of joins, ad-hoc queries and (by default) strong consistency. Bigtable (2006) and Dynamo (2007) inspired Cassandra (2008), which combined Bigtable's data model with Dynamo's leaderless distribution.

**The idea.** Make the key do two jobs: one part chooses *which machines* hold the data (the partition key), and the rest decides *the sort order inside* (clustering columns). If every query names a partition and reads a sorted slice of it, every query is one sequential read on a few machines — no matter how big the cluster grows.

:::callout[That's all it is]{type=insight}
A wide-column table is a giant sorted map split across machines by partition key. Design one table per query so each query reads one partition's sorted slice; writes are cheap appends; consistency is chosen per query by how many replicas must answer.
:::

## How It Works

### Query-first modeling

List the queries, then create a table for each:

```sql
-- Q1: messages in a conversation, newest first
CREATE TABLE messages_by_conversation (
  conversation_id uuid,
  day             date,          -- time bucket to bound partition size
  sent_at         timeuuid,
  sender_id       uuid,
  body            text,
  PRIMARY KEY ((conversation_id, day), sent_at)
) WITH CLUSTERING ORDER BY (sent_at DESC);

-- Q2: a user's conversations, most recently active first
CREATE TABLE conversations_by_user (
  user_id          uuid,
  last_activity    timestamp,
  conversation_id  uuid,
  title            text,
  PRIMARY KEY ((user_id), last_activity, conversation_id)
) WITH CLUSTERING ORDER BY (last_activity DESC);
```

Sending a message writes to both tables (a *logged batch* can make multi-table writes eventually all-or-nothing, at a cost). There is no join between them.

### Rules the model enforces

- `WHERE` must specify the full partition key (otherwise the query needs `ALLOW FILTERING` — a cluster-wide scan, almost never acceptable).
- Range conditions and ordering only on clustering columns, in order.
- Secondary indexes exist but are local per node → a query on them contacts many nodes; use them sparingly (or materialized views/denormalized tables).

### Bounding partition size

The design's weak spot: everything for one partition key lives together forever, so a partition can grow without limit. A partition lives on RF nodes and is read/compacted as a unit. Unbounded partitions (all messages of a conversation forever, all readings of a sensor) grow to gigabytes → slow reads, compaction pain, hot nodes. **Time bucketing** — adding `day` or `month` to the partition key — caps them; queries spanning buckets read several partitions.

### Tunable consistency

With RF = 3:

| Write CL | Read CL | W + R > RF? | Result |
|---|---|---|---|
| ONE | ONE | 2 > 3? no | fastest; reads may be stale |
| QUORUM (2) | QUORUM (2) | 4 > 3 yes | read overlaps the latest successful write → read-your-writes (per key) |
| ALL | ONE | 4 > 3 yes | writes fail if any replica is down |
| LOCAL_QUORUM | LOCAL_QUORUM | yes within a DC | the multi-DC default: strong-ish locally, async across DCs |

Why W + R > RF works, and its caveats, are in [Quorums & Consensus](lesson:db-quorums-consensus). Conflicting concurrent writes to the same cell resolve by **last-write-wins** using timestamps — clock skew can silently drop a newer write.

::viz{id=quorum}

## Internal Mechanism

:::depth{level=advanced}
### Write path per replica

Commit log append → memtable → flush to SSTables → compaction ([LSM Trees](lesson:db-lsm-trees)). The coordinator node forwards the write to all RF replicas and waits for CL acknowledgements; unreachable replicas get **hinted handoff** (the coordinator stores the write and replays it later).

### Read path and repair

The coordinator asks enough replicas to satisfy CL (one full data read + digests), compares, returns the newest (by timestamp), and may perform **read repair** on stale replicas. Background **anti-entropy repair** (Merkle-tree comparison) is needed regularly so replicas converge — and must run within `gc_grace_seconds`, or deleted data can be resurrected from a replica that missed the tombstone.

### Lightweight transactions

`INSERT … IF NOT EXISTS` / `UPDATE … IF col = x` run Paxos among replicas: linearizable compare-and-set for one partition, at ~4 round trips. Use for rare uniqueness checks (usernames), not for every write. Newer versions (Cassandra 5 with Accord) move toward general transactions.

### Bigtable/HBase contrast

Bigtable/HBase range-partition sorted row keys into tablets/regions served by one server at a time (strong consistency per row, leader-based), with storage on a distributed filesystem. Same data model, different distribution design — row-key design (avoiding monotonically increasing keys) matters for hotspots.
:::

## Example

IoT telemetry: 50,000 sensors, one reading per second each (50k writes/s), queries "sensor S between t1 and t2", 30-day retention.

```sql
CREATE TABLE readings (
  sensor_id  text,
  day        date,
  ts         timestamp,
  value      double,
  PRIMARY KEY ((sensor_id, day), ts)
) WITH CLUSTERING ORDER BY (ts DESC)
  AND default_time_to_live = 2592000                        -- 30 days
  AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};
```

Each partition holds one sensor-day (86,400 rows — bounded). TTL + time-window compaction drops whole expired SSTables without tombstone scans. A 6-node cluster with RF 3 handles this comfortably; adding nodes scales linearly.

## Complexity & Performance

- Partition-key reads/writes: single-digit milliseconds at any cluster size.
- Writes are cheaper than reads (append-only); reads may touch several SSTables.
- Anything without the partition key: scatter across the cluster.

## Trade-offs

- Linear write scalability, multi-DC active-active, no leader failover vs no joins, no ad-hoc queries, denormalization maintenance, eventual consistency by default.
- Quorum consistency vs latency and availability (CL ONE survives more failures and is faster).
- Wide partitions (fewer reads for range queries) vs bounded partitions (health).

## Failure Modes

- **Relational modeling** (normalized tables, filtering queries) → ALLOW FILTERING scans and timeouts.
- **Unbounded or hot partitions** (celebrity user, one busy sensor) → hot nodes, GC pressure, slow compactions.
- **Tombstone-heavy patterns** (queues, frequent deletes of wide rows) → reads scanning thousands of tombstones, failures past thresholds.
- **Skipped repairs** → zombie data resurrected after gc_grace.
- **Clock skew** → last-write-wins losing newer writes.

## In Production

- Model with the query list and partition-size estimates up front; use nodetool/metrics to watch partition sizes, tombstones per read, pending compactions, and repair status.
- Managed options: Amazon Keyspaces, Astra, ScyllaDB Cloud, Bigtable.

## Deeper Connections

- The storage engine is an LSM tree ([LSM Trees](lesson:db-lsm-trees)); distribution is consistent hashing ([Consistent Hashing](lesson:db-consistent-hashing)); consistency is quorum-based ([Quorums & Consensus](lesson:db-quorums-consensus)); the availability choice is AP in CAP terms ([CAP & PACELC](lesson:db-cap-pacelc)).

## Common Misconceptions

- **"Wide-column = columnar analytics."** Wide-column stores are row-oriented within partitions; columnar warehouses are a different design ([Column Stores](lesson:db-column-stores)).
- **"QUORUM gives strong consistency."** It gives overlap between successful reads and writes per key; with failed partial writes, LWW and clock skew, it's not linearizable.
- **"Secondary indexes make any query fast."** They're local per node and fan out across the cluster.

## Interview Questions

### [L2 · design] How would you model chat messages in Cassandra?

Design for the queries: messages by conversation newest-first → partition key (conversation_id, time bucket such as day), clustering key message time (timeuuid) descending; a separate table for a user's conversations ordered by last activity. Writes go to both tables. Bucketing bounds partition size; TTLs handle retention if needed; LOCAL_QUORUM for reads/writes within a datacenter.

### [L2 · how] How does tunable consistency work, and what does W + R > N give you?

Each partition has N replicas. A write succeeds when W replicas acknowledge; a read queries R replicas and returns the newest value. If W + R > N, every read set overlaps every successful write set in at least one replica, so a read sees the latest successfully written value for that key (assuming no concurrent-write conflicts and correct timestamps). Lower W/R trade consistency for latency and availability.

### [L3 · incident] Deleted records reappeared in a Cassandra cluster weeks after deletion. Why?

A replica missed the delete (was down or dropped the write). Tombstones on other replicas were garbage-collected after gc_grace_seconds, but repair hadn't run within that window, so the replica still holding the old data propagated it back via read repair or anti-entropy — "zombie" data. Fix: run repairs more frequently than gc_grace_seconds, and avoid delete-heavy designs.

## Practice

### [mcq] With RF = 3, which read/write consistency combination guarantees read-write overlap?

- [ ] Write ONE, read ONE
- [ ] Write ONE, read QUORUM
- [x] Write QUORUM, read QUORUM
- [ ] Write ANY, read ONE

2 + 2 = 4 > 3; the other combinations sum to at most 3.

### [mcq] Why add a `day` column to the partition key of a sensor-readings table?

- [ ] To enable joins with other tables
- [x] To bound partition size so no partition grows forever
- [ ] Because timestamps can't be clustering columns
- [ ] To make secondary indexes work

Time bucketing keeps partitions manageable; queries spanning days read several partitions.

## Quick Revision

- Primary key = ((partition key), clustering columns): partition → nodes; clustering → sort within partition.
- Query-first: one table per query, duplicate data, full partition key in every query.
- Bound partitions (time buckets); avoid tombstone-heavy designs; use TTL + TWCS for time series.
- Tunable CL; W + R > RF for overlap; LWW conflicts depend on clocks; repair within gc_grace.
- LSM storage + consistent hashing + leaderless replication = linear write scale, weak ad-hoc querying.
