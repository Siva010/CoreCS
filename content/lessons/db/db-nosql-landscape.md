---
title: "The NoSQL Landscape: Choosing a Data Model by Access Pattern"
subject: db
level: 14
order: 1
summary: "Key-value, document, wide-column, graph, time-series and search engines: the data model each offers, the queries it makes cheap or impossible, the consistency and scaling trade-offs behind the 'NoSQL' label, and how to choose (often: Postgres plus one specialized store)."
depth: core
difficulty: 2
minutes: 35
relevance: high
stage: 3
prerequisites: [db-relational-model, db-transactions-acid]
related: [db-redis-caching, db-document-stores, db-wide-column, db-graph-databases, db-cap-pacelc, db-sharding, db-column-stores]
tags: [nosql, key value store, document database, wide column, graph database, time series database, search engine, polyglot persistence, schema on read, schema on write, access patterns, newsql]
---

## Mental Model

"NoSQL" isn't one thing; it's a family of databases that each **give up some relational generality to make a specific access pattern cheap at scale** — usually lookups by a known key, or a particular shape of data (documents, graphs, time series).

The decision rule is not "SQL vs NoSQL"; it's: **what questions will I ask of this data, how often, at what scale, and with what consistency?** Relational databases answer unanticipated questions well. Specialized stores answer *their* questions extremely well and others poorly or not at all.

## Definition

| Model | Data shape | Cheap operations | Examples |
|---|---|---|---|
| Key-value | opaque value per key | get/put/delete by key; TTL; atomic counters | Redis, Memcached, DynamoDB (KV use), etcd |
| Document | nested JSON-like documents | fetch/update a whole aggregate by id; queries on document fields with indexes | MongoDB, Couchbase, Firestore, PostgreSQL jsonb |
| Wide-column | rows by partition key, sorted clustering columns | write-heavy ingest; range reads within a partition | Cassandra, ScyllaDB, HBase, Bigtable |
| Graph | nodes and edges with properties | multi-hop traversals, path queries | Neo4j, Amazon Neptune, JanusGraph |
| Time-series | (series, timestamp, value) | append, downsample, range aggregates over time | InfluxDB, TimescaleDB, Prometheus |
| Search | inverted index over documents | full-text relevance, faceting, fuzzy matching | Elasticsearch, OpenSearch, Solr |
| Columnar analytics | columns of huge tables | scans and aggregates | ClickHouse, BigQuery ([Column Stores](lesson:db-column-stores)) |

## Why It Exists

Around 2005–2012, web companies hit limits of single-server relational databases (write throughput, dataset size, global availability) and of rigid schemas for rapidly changing products. Systems like Bigtable, Dynamo, Cassandra and MongoDB traded joins, multi-row transactions and sometimes strong consistency for **horizontal scalability, high availability and flexible schemas**. Since then the line has blurred: relational databases gained JSON, sharding (Citus, Vitess) and distributed SQL; many NoSQL systems gained transactions and SQL-like languages.

## How It Works

### Design by access pattern (query-first modeling)

Relational modeling: normalize the data, then write any query. NoSQL modeling (especially key-value and wide-column): **list the queries first**, then shape the data so each query is a single-key or single-partition read — often duplicating data per query ([Wide-Column Stores](lesson:db-wide-column)).

```text
Query: "latest 20 messages in conversation X"
Relational: messages(conversation_id, created_at, …) + index (conversation_id, created_at)
Wide-column: partition key = conversation_id, clustering key = created_at DESC  → one partition read
Key-value:  key = "conv:X:recent" → list of the last 20 messages (maintained on write)
```

### Schema-on-write vs schema-on-read

- Relational: the database enforces types and constraints at write time.
- Document/KV: the database stores what you give it; every reader interprets and validates — the schema lives in application code and must handle every historical shape of the data. (Most document databases now offer optional schema validation.)

### Consistency and transactions

Many NoSQL systems were designed for availability during partitions with **eventual consistency** and single-key atomicity ([CAP & PACELC](lesson:db-cap-pacelc)). Today the spectrum is wide: MongoDB offers multi-document ACID transactions; DynamoDB offers transactions and strongly consistent reads (at a cost); Cassandra offers tunable consistency per query and lightweight transactions (Paxos-based compare-and-set).

## Internal Mechanism

:::depth{level=advanced}
### Common building blocks

Most distributed NoSQL stores combine the same mechanisms covered elsewhere in this track:

- Partitioning by key hash or range, often with consistent hashing ([Consistent Hashing](lesson:db-consistent-hashing)).
- Replication — leaderless with quorums (Dynamo lineage) or leader-per-partition with consensus (Bigtable/Spanner lineage) ([Quorums & Consensus](lesson:db-quorums-consensus)).
- LSM-tree storage engines for write throughput ([LSM Trees](lesson:db-lsm-trees)).
- Secondary indexes that are local to a partition (cheap writes, scatter-gather reads) or global (single lookup, asynchronous or costly writes).

### Polyglot persistence

Mature systems usually have a relational system of record plus specialized stores fed from it: Redis for caching/sessions/rate limits, Elasticsearch for search, a warehouse for analytics — kept in sync via change data capture. Every extra store adds operational load and a consistency boundary.
:::

## Example

Choosing stores for a food-delivery app:

| Need | Choice | Reason |
|---|---|---|
| Orders, payments, restaurants, users | PostgreSQL | transactions, constraints, ad-hoc queries |
| Sessions, rate limits, hot menus cache | Redis | sub-ms key lookups, TTLs, atomic counters |
| Courier GPS pings (100k/s) | Cassandra or a time-series DB | write-heavy, partitioned by courier + time bucket, TTL |
| Restaurant/dish search with typos | Elasticsearch/OpenSearch | relevance, fuzzy matching, facets |
| "Customers who ordered X also ordered Y" | batch jobs in a warehouse, or a graph store if traversal-heavy | analytics/graph access patterns |

The system of record stays relational; the others are derived and rebuildable.

## Complexity & Performance

- Key-value/partition-key reads: O(1)/single partition, predictable at any scale.
- Queries outside the designed access paths: scatter-gather, full scans, or impossible.
- Horizontal scale: near-linear for partition-local workloads.

## Trade-offs

| Relational (single node / distributed SQL) | Specialized NoSQL |
|---|---|
| Flexible queries, joins, constraints, transactions | Very fast designed access paths; poor or no ad-hoc queries |
| Schema enforced | Schema flexibility (and schema debt) |
| Scale-up first; scale-out with effort (or distributed SQL) | Scale-out by design |
| Strong consistency by default | Often tunable/eventual consistency |

## Failure Modes

- Choosing a NoSQL store for "scale" the product never reaches, then reimplementing joins, transactions and constraints in application code.
- Modeling a document/wide-column store relationally (normalized, needing joins it doesn't have).
- Unanticipated queries requiring full-cluster scans.
- Data drift across polyglot stores with no reconciliation.

## In Production

- The pragmatic default for most products: PostgreSQL (with jsonb for flexible attributes) + Redis; add specialized stores when a specific access pattern demands it and you can operate it.
- When you do adopt a NoSQL store, write down its access patterns and consistency settings as part of the design.

## Deeper Connections

- Each model is covered in depth: [Redis & Caching](lesson:db-redis-caching), [Document Stores](lesson:db-document-stores), [Wide-Column Stores](lesson:db-wide-column), [Graph Databases](lesson:db-graph-databases).
- The consistency trade-offs are formalized in [CAP & PACELC](lesson:db-cap-pacelc) and [Consistency Models](lesson:db-consistency-models).

## Common Misconceptions

- **"NoSQL scales, SQL doesn't."** Single-node PostgreSQL handles very large workloads; sharded and distributed SQL scale out; NoSQL scales specific access patterns.
- **"NoSQL means no schema."** It means the schema isn't enforced by the database.
- **"NoSQL means no transactions."** Many now support them, with varying scope and cost.

## Interview Questions

### [L1 · compare] SQL vs NoSQL — how do you choose?

Start from the data and access patterns. Relational databases suit structured, related data with evolving/ad-hoc queries, strong consistency and multi-row transactions. NoSQL stores suit specific patterns at scale: key-value for simple fast lookups and caching, document stores for self-contained aggregates with flexible schemas, wide-column for massive write-heavy partitioned data, graph for deep relationship traversal, search engines for full text. Consider consistency needs, scale, team expertise and operational cost; many systems use a relational core plus specialized stores.

### [L2 · conceptual] What does "design your schema around your queries" mean for NoSQL stores?

Without joins and with efficient access only by key/partition, each important query should be answerable by reading one key or one partition. You enumerate queries first and create a table/collection per query pattern, duplicating data as needed and keeping copies consistent on writes — the opposite of normalizing first and querying flexibly later.

### [L2 · scenario] A team wants MongoDB "because it scales" for an accounting system with many cross-entity reports. Your advice?

The domain is relational (accounts, journal entries, invoices), needs multi-entity transactions, constraints and flexible reporting — strengths of a relational database. Scale needs can be met by PostgreSQL with good indexing, replicas, partitioning, and later sharding/distributed SQL. Use document features (jsonb) for flexible attributes; reserve a document store for aggregates that are genuinely self-contained.

## Practice

### [mcq] Which store best fits "show a user's feed of friends-of-friends who like the same bands", queried interactively with variable depth?

- [ ] Key-value store
- [ ] Columnar warehouse
- [x] Graph database
- [ ] Time-series database

Multi-hop traversals over relationships are what graph stores optimize.

### [mcq] 200,000 sensor readings per second, queried as "readings for sensor S in the last hour", kept 30 days. Best fit?

- [ ] Graph database
- [x] Wide-column or time-series database partitioned by sensor and time bucket, with TTL
- [ ] A single relational table with a UUID primary key and no partitioning
- [ ] A document store with one document per sensor containing all readings

Write-heavy, append-only, partition-local range reads with expiry.

## Quick Revision

- NoSQL = models that make specific access patterns cheap at scale: KV, document, wide-column, graph, time-series, search.
- Query-first modeling; duplicate data per query; schema lives in code.
- Consistency ranges from eventual to strong; transactions vary in scope.
- Default: relational system of record + specialized derived stores (Redis, search, warehouse) via CDC.
- Choose by access pattern, consistency and operational cost — not hype.
