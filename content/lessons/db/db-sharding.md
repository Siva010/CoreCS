---
title: "Sharding: Splitting Data Across Machines"
subject: db
level: 13
order: 2
summary: "Horizontal scaling of writes and storage: choosing a shard key, range vs hash vs directory-based sharding, routing, cross-shard queries and transactions, hot partitions and celebrity keys, and resharding without downtime."
depth: advanced
difficulty: 4
minutes: 50
relevance: high
stage: 3
prerequisites: [db-partitioning, db-replication]
related: [db-consistent-hashing, db-distributed-transactions, db-distributed-sql, db-schema-design, db-wide-column, db-cap-pacelc]
labs: [consistent-hashing]
tags: [sharding, shard key, horizontal partitioning, range sharding, hash sharding, directory based sharding, lookup service, hot partition, hot key, celebrity problem, scatter gather, cross shard join, resharding, rebalancing, vitess, citus]
---

## Mental Model

When one database server can't hold all the data or absorb all the writes, you split the data **by key** across several independent databases — **shards** — each responsible for a subset (customers A–F on shard 1, …). Every shard is a full database (usually with its own replicas). The application or a routing layer sends each query to the shard that owns its key.

Sharding trades one hard problem (vertical limits of a single machine) for several (routing, cross-shard operations, uneven load, rebalancing). The **shard key** decides whether those problems are rare or constant.

## Definition

- **Shard**: an independent database holding a subset of rows.
- **Shard key**: the attribute determining a row's shard (customer_id, tenant_id, user_id).
- **Range sharding**: contiguous key ranges per shard.
- **Hash sharding**: shard = hash(key) mod N (or consistent hashing — [Consistent Hashing](lesson:db-consistent-hashing)).
- **Directory (lookup) sharding**: a mapping service records key → shard explicitly.
- **Hot shard / hot key**: disproportionate load on one shard/key.
- **Scatter-gather**: sending a query to all shards and merging results.
- **Resharding / rebalancing**: moving data when adding shards or fixing imbalance.

## Why It Exists

**The problem.** Replication scales reads, but **every replica applies every write** ([Replication](lesson:db-replication)). Beyond the write throughput, storage, memory or connection capacity of the largest practical machine, the only way to scale is to split the data so each machine handles a fraction.

**The idea.** Give each server a *different* slice of the data, chosen by a key, so each handles only its slice's reads and writes. The cost is that anything spanning slices — joins, transactions, uniqueness, global queries — now crosses machines.

Before sharding, exhaust the cheaper options: query and index optimization, caching, read replicas, vertical scaling (a much larger server), archiving old data, and moving specific workloads (search, analytics) elsewhere. Sharding is a one-way door in complexity.

:::callout[That's all it is]{type=insight}
Sharding splits rows across independent databases by a key. Queries that include the key go to one shard and stay simple; anything that doesn't becomes a multi-shard problem. Choosing that key is the whole design.
:::

## How It Works

### Choosing a shard key

Everything that crosses shards is expensive, so the goal is a key that keeps each request — and each transaction — inside one shard, while spreading load evenly. A good shard key:

1. **Appears in almost every query** (so each query goes to one shard).
2. **Groups data that's accessed or transacted together** (a tenant's users, orders, invoices on one shard → local joins and ACID transactions).
3. **Has high cardinality and even load** (many keys, no single key dominating).
4. **Doesn't change** for a row (changing it means moving the row).

For multi-tenant SaaS, `tenant_id` usually satisfies all four — until one tenant becomes huge. For consumer apps, `user_id`.

### Strategies

| Strategy | Routing | Strengths | Weaknesses |
|---|---|---|---|
| Range | find range containing key | range scans on the key are local; easy splits of a range | sequential keys (time, auto-increment) send all new writes to the last shard — hotspot |
| Hash | hash(key) → shard | even distribution | range queries scatter to all shards; naive `mod N` moves most keys when N changes |
| Directory | lookup table key → shard | total flexibility (move one tenant at a time, isolate big tenants) | lookup service is critical infrastructure (cache it; make it highly available) |
| Geographic/entity | by region/tenant tier | data residency, locality | uneven sizes |

### Routing

- **Application-level**: a library computes the shard and picks the connection.
- **Proxy/middleware**: Vitess (MySQL), Citus (PostgreSQL extension), ProxySQL, custom gateways — the app sees one logical database.
- **Built-in distributed databases**: range-sharded storage with automatic splitting and rebalancing (CockroachDB, TiDB, Spanner, YugabyteDB) — [Distributed SQL](lesson:db-distributed-sql).

### What gets hard

| Operation | Single DB | Sharded |
|---|---|---|
| Query by shard key | index lookup | same, on one shard |
| Query by another attribute (`WHERE email = ?`) | index lookup | scatter-gather to all shards, or a **global secondary index** (a separate table keyed by email → shard key), maintained asynchronously or transactionally |
| Join across entities on different shards | local join | application-side join or denormalization |
| Transaction across shards | ACID | 2PC or sagas ([Distributed Transactions](lesson:db-distributed-transactions)) |
| Unique constraint on non-shard-key column | UNIQUE index | global uniqueness service or a lookup table |
| Aggregates across all data | one query | scatter-gather + merge, or a warehouse |
| Auto-increment ids | sequence | globally unique ids: UUIDv7, Snowflake-style (timestamp + node + sequence), per-shard ranges |

## Internal Mechanism

:::depth{level=advanced}
### Hot partitions and celebrity keys

Even with hashing, load follows keys: one celebrity account's posts, one mega-tenant, one viral product. Mitigations:

- **Split the hot key**: append a suffix (`product_42#0..#9`) to spread writes across 10 sub-keys, reading all 10 and combining (counters, likes).
- **Isolate**: move the whale tenant to its own shard (directory sharding makes this easy).
- **Cache** reads of hot keys ([Redis & Caching](lesson:db-redis-caching)).
- **Queue/batch** writes to the hot key.

### Resharding without downtime

Typical online move of a key range/tenant:

1. Copy existing data to the target shard (snapshot).
2. Stream ongoing changes (CDC/logical replication) until caught up.
3. Briefly block writes for the moving keys (or use dual-writes), verify, flip the routing entry.
4. Clean up the source.

Using many **logical shards** (e.g., 4,096 virtual shards mapped onto 16 physical servers) turns resharding into moving whole virtual shards between servers instead of re-hashing every row — the same idea as virtual nodes in consistent hashing.

### Shards are replicated too

Each shard is a leader with followers; availability, failover and replication lag apply per shard ([Failover](lesson:db-failover)). A 32-shard cluster with 3 replicas each is 96 database servers to operate.
:::

## Example

Sharding a SaaS ticketing system by `tenant_id` via a directory:

```text
tenant_directory: tenant_id → shard
  1..40,000 small tenants → hashed across shards 1–8 (virtual shard map)
  tenant 7 (enterprise, 30% of all traffic) → dedicated shard 9
```

- `GET /tickets?tenant=123&status=open` → directory lookup (cached) → shard 4 → normal indexed query.
- Global admin report "tickets created per day across all tenants" → runs on the warehouse fed by CDC from all shards, not on the shards.
- Login by email (email isn't the shard key) → `user_lookup(email → tenant_id, user_id)` table in a small, replicated global database.

## Complexity & Performance

- Single-shard operations: same as a single database of that shard's size.
- Scatter-gather: latency = slowest shard (tail latency amplification — [Tail Latency](lesson:cn-tail-latency)); load × number of shards.
- Capacity scales roughly linearly with shards **if** the workload is shard-local and balanced.

## Trade-offs

- Scale-out of writes/storage vs loss of cross-shard joins, transactions and constraints.
- Hash (balance) vs range (locality, range scans) vs directory (flexibility, extra dependency).
- Application-level sharding (control, simplicity of each piece) vs distributed SQL (transparency, newer operational model).

## Failure Modes

- **Wrong shard key**: most queries scatter; cross-shard transactions everywhere.
- **Monotonic keys with range sharding**: all inserts hit the last shard.
- **Hot shards** from skewed tenants or celebrity keys.
- **Resharding under pressure** (disk nearly full) — plan capacity well ahead.
- **Cross-shard inconsistency** from multi-shard writes without 2PC/sagas.

## In Production

- Instagram (user-id-based logical shards on PostgreSQL), Slack, Shopify and GitHub run large application-level sharded MySQL/PostgreSQL fleets; Vitess (YouTube) and Citus provide middleware.
- Most companies never need sharding; many that do shard only their few largest tables or tenants.

## Deeper Connections

- Consistent hashing minimizes data movement when shards change ([Consistent Hashing](lesson:db-consistent-hashing)).
- Wide-column and key-value stores are sharded by partition key by design ([Wide-Column Stores](lesson:db-wide-column)).
- Cross-shard writes are distributed transactions ([Distributed Transactions](lesson:db-distributed-transactions)).

## Common Misconceptions

- **"Sharding is the first step to scale."** It's the last: optimize, cache, replicate, scale up first.
- **"Hash sharding eliminates hotspots."** It balances keys, not load per key.
- **"Sharding is just partitioning."** Partitioning is within one server; sharding adds network routing, partial failure and distributed consistency.

## Interview Questions

### [L2 · design] How do you choose a shard key?

Pick an attribute present in nearly all queries so they route to one shard, which groups data that's accessed and transacted together (so joins/transactions stay local), has high cardinality with even load (no dominant values), and never changes. Validate against the top queries and the growth distribution of the largest keys; plan for outliers (isolate large tenants).

### [L2 · compare] Range vs hash sharding?

Range sharding assigns contiguous key ranges to shards — efficient range scans and easy splitting of ranges, but sequential keys concentrate writes on one shard. Hash sharding spreads keys uniformly — even distribution, but range queries must hit every shard, and naive modulo hashing moves most data when shard count changes (use consistent hashing or many virtual shards).

### [L3 · scenario] Your user table is sharded by user_id, but login looks users up by email. How do you handle it?

Maintain a global lookup table/index mapping email → user_id (itself sharded by email, or small enough to be replicated), updated in the same flow as user creation (with a unique constraint to enforce global email uniqueness). Login queries the lookup first, then the user's shard. Handle consistency between the lookup and the user record (transactional outbox or 2PC for creation; periodic reconciliation).

### [L3 · design] One tenant generates 40% of the traffic on a tenant-sharded database. What do you do?

Move that tenant to a dedicated shard (directory-based routing makes it a routing change after an online data move), possibly with more powerful hardware or further sharding within the tenant by a secondary key (e.g., project_id). Add caching and rate limits for its hottest paths. Longer-term: design routing so any tenant can be relocated without code changes.

## Practice

### [numeric 75 unit=%] With naive `hash(key) mod N` sharding, you grow from 3 to 4 shards. What percentage of keys must move to a different shard? (Assume uniform hashes.)

:::answer
A key stays only if `h mod 3 = h mod 4`. In each block of 12 consecutive hash values (the lcm of 3 and 4) that holds for h = 0, 1, 2: 3 of 12 = 25% stay, so **75%** move. Consistent hashing would move only about 1/4 of the keys — the share the new shard takes over.
:::

### [mcq] Which shard key is the worst choice for range sharding a high-volume orders table?

- [ ] customer_id
- [ ] tenant_id
- [x] created_at (timestamp)
- [ ] region

With range sharding, monotonically increasing keys send every new insert to the last range's shard.

## Quick Revision

- Shard = independent database with a subset of keys; scales writes and storage (replicas scale reads).
- Shard key: in most queries, groups co-accessed data, high cardinality and even load, immutable.
- Range (locality, hotspot risk with monotonic keys) vs hash (balance, scattered ranges) vs directory (flexible, extra service).
- Hard parts: non-key lookups (global indexes), cross-shard joins/transactions/uniqueness, global ids, hot keys, resharding.
- Use many logical shards on few servers; move tenants online via copy + CDC + routing flip. Shard last, not first.
