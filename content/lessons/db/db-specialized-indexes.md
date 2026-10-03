---
title: "Beyond B-Trees: Hash, Partial, Expression, GIN, GiST, BRIN and Bitmap Indexes"
subject: db
level: 7
order: 4
summary: "The index types for questions a sorted B+ tree can't answer well: equality-only hash indexes, partial and expression indexes, inverted indexes for full text and JSON, spatial and range indexes, block-range indexes for huge append-only tables, and bitmap indexes in warehouses."
depth: advanced
difficulty: 3
minutes: 40
relevance: medium
stage: 3
prerequisites: [db-index-fundamentals]
related: [db-composite-covering-indexes, db-index-design-practice, db-schema-design, db-keys-constraints, db-column-stores]
tags: [hash index, partial index, expression index, functional index, gin, inverted index, full text search, jsonb, trigram, gist, spatial index, r-tree, brin, block range index, bitmap index, exclusion constraint]
---

## Mental Model

A B+ tree answers "find keys equal to / between / starting with" in **one sort order**. Some questions don't fit a single sort order:

- "Documents containing the word *latency*" — a document has many words (**inverted index**: GIN).
- "Shapes overlapping this rectangle", "bookings overlapping this date range" — no linear order preserves 2-D or interval overlap (**GiST**, R-trees).
- "Rows from last Tuesday in a 5 TB append-only log" — the data is already physically ordered; you only need a coarse map (**BRIN**).
- "Only the 0.1% of rows with status = 'failed'" — index a subset (**partial index**).
- "Case-insensitive email lookups" — index a computed value (**expression index**).

Each specialized index trades generality for a much better fit to one question.

## Definition

| Index | Structure | Answers | Typical use |
|---|---|---|---|
| **Hash** | hash table on disk | `=` only | Equality on long keys (PostgreSQL 10+ is WAL-logged and safe); rarely better than B-tree |
| **Partial** | any index with `WHERE` predicate | queries whose condition implies the predicate | rare values, "active rows only", partial uniqueness |
| **Expression** | index on `f(col)` | queries using exactly `f(col)` | `lower(email)`, `date(created_at)`, JSON field extraction |
| **GIN** (inverted) | value → posting list of rows | contains / overlaps / full-text match | `tsvector` full text, `jsonb @>`, arrays, trigram `LIKE '%x%'` |
| **GiST / SP-GiST** | balanced tree of bounding predicates | overlap, containment, nearest-neighbour | geometry (PostGIS), ranges, exclusion constraints, kNN |
| **BRIN** | min/max per block range | ranges on naturally ordered data | huge append-only tables (logs, time series) |
| **Bitmap** (Oracle, warehouses) | one bitmap per distinct value | AND/OR on low-cardinality columns | analytics; poor for concurrent OLTP writes |

## Why It Exists

Without these, the options for such queries are sequential scans (slow) or external systems (a search engine, a spatial service). The right index often turns a 30-second scan into a 5-ms lookup inside the same database, with transactional consistency.

## How It Works

### Partial indexes: index only what you query

```sql
-- 50M orders, only ~20k are 'pending' at any time; the worker polls them constantly
CREATE INDEX orders_pending_idx ON orders (created_at) WHERE status = 'pending';

SELECT id FROM orders WHERE status = 'pending' ORDER BY created_at LIMIT 100;
```

The index holds ~20k entries instead of 50M: tiny, always cached, cheap to maintain (rows enter/leave as status changes). The query's `WHERE` must **imply** the index predicate for the planner to use it. Partial **unique** indexes express conditional uniqueness ("one active subscription per user") ([Keys & Constraints](lesson:db-keys-constraints)).

### Expression indexes: index the value you search by

```sql
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
SELECT * FROM users WHERE lower(email) = lower($1);   -- uses the index
SELECT * FROM users WHERE email = $1;                 -- does not
```

The expression must be deterministic (`IMMUTABLE`). The planner matches the query expression textually/structurally — `lower(email)` matches, `upper(email)` doesn't.

### GIN: inverted indexes

An inverted index maps each **element** (word, JSON key/value, array element, trigram) to the list of rows containing it — exactly like a search engine.

```sql
-- Full-text search
ALTER TABLE articles ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED;
CREATE INDEX articles_tsv_gin ON articles USING gin (tsv);
SELECT id, title FROM articles WHERE tsv @@ to_tsquery('english', 'latency & tail');

-- JSONB containment
CREATE INDEX products_attrs_gin ON products USING gin (attrs jsonb_path_ops);
SELECT * FROM products WHERE attrs @> '{"color": "red", "size": "M"}';

-- Substring search with trigrams (pg_trgm)
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);
SELECT * FROM customers WHERE name ILIKE '%sharma%';
```

GIN lookups intersect posting lists; they're fast to query but **expensive to update** (one row touches many posting lists). PostgreSQL buffers new entries in a "pending list" (`fastupdate`) and merges them later.

### GiST: overlap and nearest-neighbour

GiST generalizes the B-tree: each internal entry is a *predicate covering its subtree* (e.g., a bounding box). Search descends into every child whose predicate might match. Uses: PostGIS geometry, range types, `ORDER BY location <-> point LIMIT 10` (k-nearest-neighbour), and **exclusion constraints**:

```sql
ALTER TABLE bookings ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at) WITH &&);
```

### BRIN: a tiny index for huge, ordered tables

BRIN stores, for each range of (say) 128 pages, the **min and max** of the column. For `WHERE created_at >= '2024-06-01'`, it skips every block range whose max is earlier. On an append-only events table where `created_at` correlates with physical order, a BRIN index on 1 TB of data is a few MB and prunes almost everything. If rows aren't physically ordered by the column, BRIN is useless — every range spans everything. (It's the zone-map idea from column stores — [Column Stores](lesson:db-column-stores).)

## Internal Mechanism

:::depth{level=advanced}
### Why hash indexes are rarely chosen

B-trees do equality lookups in ~3–4 cached page reads and also support ranges, ordering and uniqueness everywhere; hash indexes save a little on very long keys but support only `=` (and historically weren't crash-safe in PostgreSQL before version 10). In-memory systems (Redis, hash joins) are where hashing dominates.

### Bitmap indexes vs bitmap scans

A **bitmap index** (Oracle, many warehouses) permanently stores one bitmap per distinct value — superb for combining low-cardinality filters (`gender = 'F' AND region = 'W' AND status = 'active'` becomes bitwise AND), terrible for concurrent row updates (one update locks/rewrites large bitmap segments). PostgreSQL has no bitmap *indexes*; it builds **bitmaps at query time** from ordinary indexes (Bitmap Index/Heap Scan, BitmapAnd/BitmapOr) ([Scans & Joins](lesson:db-scans-joins)).

### Vector indexes

Similarity search over embeddings uses approximate nearest-neighbour indexes (HNSW graphs, IVF) — e.g., `pgvector` in PostgreSQL. They trade exactness for speed: a query returns *probably* the nearest vectors. Recall vs latency is tuned per index.
:::

## Example

A support-ticket table (80M rows) needs:

| Query | Index |
|---|---|
| Open tickets for an agent, oldest first | partial: `(assignee_id, created_at) WHERE status = 'open'` |
| Case-insensitive email lookup | expression: `lower(requester_email)` |
| Search ticket text | GIN on a `tsvector` column |
| Tickets with tag X (`tags text[]`) | GIN on `tags` |
| Reporting by month across years | BRIN on `created_at` (append-only) |

Five indexes, each small and targeted, instead of wide B-trees that serve none of these well.

## Complexity & Performance

| Index | Lookup | Update cost | Size |
|---|---|---|---|
| B-tree | O(log n) | moderate | ~table-sized for wide keys |
| Partial | O(log k), k ≪ n | only for qualifying rows | small |
| GIN | intersect posting lists | high (many entries per row) | medium–large |
| GiST | tree descent, may visit several branches | moderate | medium |
| BRIN | scan the small summary + matching blocks | tiny | tiny |

## Trade-offs

- Specialized indexes answer one question very well; each still adds write cost.
- In-database full text (GIN) vs a search engine (Elasticsearch/OpenSearch): the database gives transactional consistency and simplicity; a search engine gives relevance tuning, fuzziness, facets and horizontal scale at the cost of a sync pipeline.

## Failure Modes

- **Expression mismatch**: index on `lower(email)`, query on `email ILIKE $1` — not used.
- **Partial index predicate not implied** by the query (e.g., parameterized `status = $1` can't prove `status = 'pending'` at plan time for a generic plan).
- **GIN write amplification** on frequently updated large documents; pending lists growing until a slow merge hits a random insert.
- **BRIN on unordered data** — present but useless.

## In Production

- Partial indexes are one of the highest-leverage PostgreSQL features for queue-like and "active subset" workloads.
- `pg_trgm` GIN indexes rescue `LIKE '%term%'` search features that would otherwise scan whole tables.

## Deeper Connections

- BRIN and zone maps are the same pruning idea ([Column Stores](lesson:db-column-stores)); GIN is a search-engine inverted index; GiST generalizes B-trees to arbitrary "might contain" predicates.
- Exclusion constraints extend uniqueness to overlap ([Keys & Constraints](lesson:db-keys-constraints)).

## Common Misconceptions

- **"Hash indexes are faster than B-trees for equality."** Marginally at best, with far fewer capabilities.
- **"An index on a JSON column indexes its fields."** A plain B-tree on `jsonb` indexes whole values; you need GIN (containment) or expression indexes on specific paths.
- **"LIKE '%x%' can never use an index."** Not a B-tree — but a trigram GIN/GiST index can.

## Interview Questions

### [L2 · design] How would you speed up `WHERE lower(email) = ?` and `WHERE status = 'failed'` (0.01% of rows)?

An expression index on `lower(email)` (unique if emails must be unique case-insensitively), and a partial index `… WHERE status = 'failed'` on whatever column the query orders or filters by next (e.g., created_at). The partial index stays tiny and cheap to maintain because only failed rows are indexed.

### [L2 · compare] When would you use GIN vs GiST vs BRIN?

GIN: inverted index for "contains element" queries — full text, jsonb containment, arrays, trigram substring search; fast reads, costly updates. GiST: tree of bounding predicates for overlap/containment/nearest-neighbour — geometry, ranges, exclusion constraints. BRIN: min/max summaries per block range for huge tables whose physical order correlates with the column (append-only time series) — tiny and cheap, useless if data isn't ordered.

### [L3 · scenario] A product search box does `WHERE name ILIKE '%' || $1 || '%'` on 30M rows and takes 8 seconds. Options?

A B-tree can't help a leading wildcard. Options: a pg_trgm GIN index on `name` (supports ILIKE '%x%' via trigram matching; fast for terms of 3+ characters), full-text search with a tsvector GIN index if word-based matching is acceptable (with ranking), or an external search engine if relevance, typo tolerance and facets are needed. Also limit results and require a minimum query length.

## Practice

### [mcq] Which index is ideal for an append-only 2 TB events table queried by time ranges?

- [ ] Hash index on created_at
- [x] BRIN index on created_at
- [ ] GIN index on created_at
- [ ] Partial index WHERE created_at IS NOT NULL

Physical order correlates with time, so min/max per block range prunes almost everything with a tiny index.

### [mcq] Index: `CREATE INDEX ON orders (created_at) WHERE status = 'pending'`. Which query can use it?

- [ ] `WHERE status = 'paid' ORDER BY created_at`
- [x] `WHERE status = 'pending' AND created_at < now() - interval '1 hour'`
- [ ] `WHERE created_at < now()`
- [ ] `WHERE status IN ('pending', 'paid')`

The query's condition must imply the index predicate `status = 'pending'`.

## Quick Revision

- Partial = index a subset (rare values, active rows, conditional uniqueness).
- Expression = index `f(col)`; query must use the same expression.
- GIN = inverted index: full text, jsonb @>, arrays, trigrams. Fast reads, costly writes.
- GiST = overlap/containment/kNN: geometry, ranges, exclusion constraints.
- BRIN = min/max per block range: tiny, great for physically ordered append-only data.
- Hash = equality only; bitmap indexes = warehouses; bitmap scans = PostgreSQL's runtime combination of indexes.
