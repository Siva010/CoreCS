---
title: "Document Stores: Modeling Aggregates, Embedding vs Referencing"
subject: db
level: 14
order: 3
summary: "The document model (MongoDB, Firestore, PostgreSQL jsonb): aggregates as the unit of storage and atomicity, when to embed and when to reference, indexing nested fields, the aggregation pipeline, transactions, and the failure modes of unbounded documents."
depth: advanced
difficulty: 3
minutes: 40
relevance: medium
stage: 3
prerequisites: [db-nosql-landscape]
related: [db-normalization, db-schema-design, db-specialized-indexes, db-sharding, db-transactions-acid]
tags: [document database, mongodb, bson, json, jsonb, aggregate, embedding, referencing, denormalization, schema validation, aggregation pipeline, multikey index, unbounded arrays, lookup]
---

## Mental Model

A document store saves each **aggregate** — a cluster of data that's read and written together, like an order with its line items and shipping address — as **one JSON-like document**. Loading the order is one read; updating it atomically is one write. No joins needed for the common path.

The design question is always: **what goes inside the document (embed) and what lives in its own document (reference)?** Embed what you read together and what belongs to the parent; reference what's shared, large, unbounded, or independently updated.

## Definition

- **Document**: a nested structure of fields, arrays and sub-documents (BSON in MongoDB), identified by `_id`.
- **Collection**: a group of documents (analogous to a table, without an enforced schema by default).
- **Embedding**: storing related data inside the parent document.
- **Referencing**: storing an id pointing to another document, resolved with a second query or `$lookup`.
- **Aggregation pipeline**: a sequence of stages (`$match`, `$group`, `$sort`, `$lookup`, `$unwind`, `$project`) for queries and transformations.
- **Schema validation**: optional JSON Schema rules enforced on writes.

## Why It Exists

Object-oriented applications naturally hold aggregates (an order object with a list of items). Mapping them to normalized tables and back requires joins and ORMs; the document model stores them as the application sees them. Since a single-document write is atomic and a document lives on one shard, aggregates also shard cleanly by their id or owner.

## How It Works

### Embed vs reference

```json
{
  "_id": "order_9001",
  "customer": { "id": "cust_42", "name": "Asha", "city": "Pune" },
  "status": "paid",
  "items": [
    { "sku": "A-17", "name": "Headphones", "qty": 1, "unit_price": 1499 },
    { "sku": "C-02", "name": "Cable",      "qty": 2, "unit_price": 199 }
  ],
  "shipping": { "line1": "…", "pincode": "411001" },
  "created_at": "2024-06-01T10:12:00Z"
}
```

| Embed when… | Reference when… |
|---|---|
| Data is read together with the parent (order + items) | Data is shared by many parents (product catalog, customer profile) |
| The child belongs to one parent (1:few) | The relationship is 1:many-thousands or unbounded (a user's all-time events) |
| The child's copy should be a snapshot (price at purchase, address at shipping) | The child must always reflect the latest value everywhere |
| Updated together with the parent (atomic) | Updated independently and frequently |

Note the deliberate duplication: `customer.name` inside the order is a historical snapshot (like `unit_price` in a relational order_items table — [Normalization](lesson:db-normalization)). Duplicating data that *should* stay in sync (a user's avatar in every comment) creates fan-out updates.

### Indexing and queries

```javascript
db.orders.createIndex({ "customer.id": 1, created_at: -1 });
db.orders.createIndex({ "items.sku": 1 });          // multikey: one index entry per array element

db.orders.find({ "customer.id": "cust_42" }).sort({ created_at: -1 }).limit(20);

db.orders.aggregate([
  { $match: { status: "paid", created_at: { $gte: ISODate("2024-06-01") } } },
  { $unwind: "$items" },
  { $group: { _id: "$items.sku", units: { $sum: "$items.qty" } } },
  { $sort: { units: -1 } }, { $limit: 10 }
]);
```

Indexes are B-trees over (possibly nested) fields, with the same leftmost-prefix and selectivity rules as relational indexes ([Composite Indexes](lesson:db-composite-covering-indexes)).

### Atomicity and transactions

A single-document update is atomic (even across nested fields and arrays). MongoDB 4.0+ supports multi-document ACID transactions (4.2+ across shards) — correct, but slower and with limits; a design needing them constantly is a signal the data may be relational.

## Internal Mechanism

:::depth{level=advanced}
### Storage

MongoDB's WiredTiger engine stores documents compressed in B-trees with document-level concurrency control and MVCC snapshots; a journal (WAL) provides durability. Replication uses replica sets with an elected primary (Raft-like protocol) and an oplog; write concern (`w: "majority"`) and read concern (`majority`, `linearizable`) tune durability and consistency per operation ([Quorums & Consensus](lesson:db-quorums-consensus)).

### Document size and update cost

Documents have a size limit (16 MB in MongoDB) and are rewritten on update at the storage level; very large documents make every small update expensive and increase replication traffic. Unbounded arrays (all comments of a post, all events of a user) are the classic anti-pattern — use a separate collection or bucketing (one document per user per day).

### Relational databases as document stores

PostgreSQL `jsonb` stores parsed binary JSON with GIN indexes for containment (`@>`) and expression indexes for specific paths ([Specialized Indexes](lesson:db-specialized-indexes)). A hybrid — relational columns for core, constrained fields plus a `jsonb` column for variable attributes — covers many "we need a document database" cases while keeping joins and constraints.
:::

## Example

Blog platform modeling:

| Entity | Choice | Why |
|---|---|---|
| Post with title, body, tags, author snapshot (name, avatar URL at time of posting) | one document | read together; tags small and bounded |
| Comments | separate `comments` collection, `post_id` indexed, bucketed if very numerous | unbounded; paginated independently |
| Author profile | separate `users` document, referenced by id | shared by all posts; updated independently |
| Like counts | counter field on post, updated with `$inc` | atomic single-document update |

A relational design would store the same entities in tables and join; the document design optimizes "render a post page" into one or two reads.

## Complexity & Performance

- Aggregate by id: one read (single document), fast and predictable.
- Queries across documents by indexed fields: like relational indexes.
- `$lookup` joins: possible but less optimized than relational joins; avoid on hot paths.
- Updates to large documents: cost ∝ document size.

## Trade-offs

- Fast aggregate access and natural sharding vs weaker support for cross-aggregate queries, constraints and joins.
- Schema flexibility vs schema drift (every reader must handle every historical shape; use validation and migrations anyway).
- Embedded snapshots (fast reads) vs update fan-out when shared data changes.

## Failure Modes

- **Unbounded arrays** growing documents until updates are slow or hit size limits.
- **Relational data forced into documents** → application-side joins, inconsistent duplicated data, multi-document transactions everywhere.
- **Missing indexes on nested fields** → collection scans.
- **Schema drift**: fields with inconsistent types across documents breaking readers.
- **Weak write concerns** (`w: 1`) losing acknowledged writes on failover.

## In Production

- Use schema validation and explicit migration scripts; document the expected shape in code (types/ODM models).
- Choose write/read concerns per operation deliberately; `majority` for data you can't lose.

## Deeper Connections

- Embedding is deliberate denormalization; referencing is normalization ([Normalization](lesson:db-normalization)).
- Sharding a document store by the aggregate's owner keeps most operations single-shard ([Sharding](lesson:db-sharding)).

## Common Misconceptions

- **"Document databases have no schema."** They have implicit schemas enforced by application code (or optional validation).
- **"Document stores can't do transactions."** Single-document operations are atomic; multi-document transactions exist with costs.
- **"Embed everything to avoid joins."** Unbounded or shared data must be referenced.

## Interview Questions

### [L2 · design] When would you embed related data in a document, and when would you reference it?

Embed data read together with its parent, owned by it, bounded in size and updated together (order items, an address snapshot). Reference data shared across many parents, unbounded in number, large, or updated independently (users, product catalog, comments). Snapshots that must not change (price at purchase) are embedded deliberately.

### [L2 · compare] PostgreSQL jsonb vs MongoDB — when is each a good fit?

jsonb suits systems that are mostly relational but need flexible attributes: you keep joins, constraints and transactions, with GIN/expression indexes on JSON paths. MongoDB suits aggregate-centric workloads where most access is whole-document by id or owner, schemas evolve quickly, and built-in horizontal sharding of aggregates is valuable. Cross-aggregate reporting and strict integrity favor PostgreSQL.

### [L3 · debugging] Updates to user documents have become slow and replication lag is growing. Documents contain an `activity` array of all past events. What's wrong?

The unbounded array makes documents huge: every small update rewrites and replicates a large document, and indexes on array elements grow with it (multikey entries). Move activity to its own collection (one document per event, or bucketed per user per day), keep only a small bounded summary (e.g., last 10 events) on the user document, and backfill with a migration.

## Practice

### [mcq] Which is an anti-pattern in document modeling?

- [ ] Embedding an order's line items in the order document
- [ ] Referencing a shared product by id from order items (plus a price snapshot)
- [x] Storing every comment ever made on a popular post inside the post document
- [ ] Indexing a nested field used in queries

Unbounded arrays grow without limit and make every update expensive.

### [mcq] What does a single-document update guarantee in MongoDB?

- [x] Atomicity for all changes within that document
- [ ] Atomicity across all documents in the collection
- [ ] Serializable isolation across collections
- [ ] Durability without any write concern

Multi-document atomicity requires transactions.

## Quick Revision

- Document = aggregate stored as nested JSON; one read/one atomic write for the common path.
- Embed: read together, owned, bounded, snapshot. Reference: shared, unbounded, independently updated.
- Index nested fields (multikey for arrays); aggregation pipeline for analytics; $lookup sparingly.
- Transactions exist but signal relational needs if used everywhere. Avoid unbounded arrays; validate schemas.
- PostgreSQL jsonb covers many hybrid needs.
