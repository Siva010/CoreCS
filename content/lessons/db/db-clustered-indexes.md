---
title: "Clustered vs Secondary Indexes: Where the Rows Actually Live"
subject: db
level: 7
order: 3
summary: "Index-organized tables (InnoDB, SQL Server) versus heap tables with separate indexes (PostgreSQL); why InnoDB secondary lookups go through the primary key; how primary-key choice shapes insert speed, locality and index size; and what CLUSTER actually does."
depth: advanced
difficulty: 3
minutes: 35
relevance: high
stage: 3
prerequisites: [db-index-fundamentals]
related: [db-btree, db-pages-records, db-schema-design, db-composite-covering-indexes, db-mvcc]
tags: [clustered index, index organized table, heap table, secondary index, primary key lookup, innodb, bookmark lookup, key lookup, cluster command, uuid primary key, page splits, locality]
---

## Mental Model

There are two ways to store a table:

- **Heap + indexes (PostgreSQL, Oracle default)**: rows live in an unordered heap; *every* index, including the primary key's, is a separate B+ tree whose leaves point at row locations (TIDs).
- **Index-organized / clustered (InnoDB, SQL Server clustered index)**: the table **is** a B+ tree keyed by the primary key; leaves hold the full rows. Secondary indexes store the **primary key** of each row, not its location.

"Clustered" means *the rows are physically stored in the index's order*. A table can be clustered by at most one key.

## Definition

- **Clustered index**: the index whose leaf level contains the table rows, ordered by its key.
- **Secondary (non-clustered) index**: an index whose leaves contain the key plus a row reference (TID in heap-based systems, the primary key in InnoDB).
- **Bookmark / key lookup**: fetching the rest of a row after finding it through a secondary index.

## Why It Exists

**The problem.** With a heap, every index lookup ends with a jump to wherever the row happens to sit — and rows you usually read together (one customer's orders) may be scattered across thousands of pages.

**The idea.** If the table must be stored in *some* order anyway, store it in the order you most often read it: make the primary-key index *be* the table. Clustering makes access by the clustering key extremely fast: a point lookup lands directly on the row, and a range scan reads rows that are physically adjacent — a handful of pages instead of one random page per row. Rows frequently accessed together (all of one customer's orders) can be stored together by choosing the key well.

**The bill.** Rows can only be in one order, so every other index must find rows *through* the clustering key — and the clustering key's size and insert pattern now affect the whole table.

:::callout[That's all it is]{type=insight}
In a clustered table the rows live inside the primary-key B+ tree, in key order. Secondary indexes store the primary key and look the row up there. That's why InnoDB wants a short, ever-increasing primary key.
:::

## How It Works

### InnoDB: two lookups for a secondary index

```mermaid
flowchart LR
    Q["WHERE email = 'a@x.com'"] --> S["secondary B+ tree (email → PK)"]
    S -->|"PK = 7731"| C["clustered B+ tree (PK → full row)"]
    C --> R["row"]
```

1. Search the secondary index for the key → get the primary key value.
2. Search the clustered index by that primary key → get the row.

Two tree traversals per row (unless the secondary index covers the query — every InnoDB secondary index implicitly contains the PK columns).

### PostgreSQL: index → heap

A secondary index lookup yields a TID (page, slot) → one direct heap page read. No second tree traversal, but rows matching a range are generally scattered across the heap (unless correlated with insert order).

### Consequences of the primary key choice (InnoDB and other clustered designs)

| PK choice | Insert pattern | Effect |
|---|---|---|
| Auto-increment / time-ordered (UUIDv7) | always at the right edge | Full pages, few splits, hot insert page stays cached |
| Random (UUIDv4, hash) | random leaves | Page splits everywhere, ~50–70% fill, every insert may read a random page from disk — the table *and* all secondary indexes grow |
| Wide PK (composite of long strings) | — | **Every secondary index stores it** → all secondary indexes bloat |
| Natural key that changes | — | Updating the PK physically moves the row and updates every secondary index |

So in InnoDB: keep the PK **short, stable and monotonically increasing**, unless you deliberately cluster by something else for locality (e.g., `(tenant_id, id)` to keep each tenant's rows together).

### CLUSTER in PostgreSQL

`CLUSTER orders USING orders_customer_id_idx` rewrites the heap in that index's order, once. New rows go wherever there's space, so the order decays over time. It takes an exclusive lock — `pg_repack` can do it online. Useful for mostly-static tables with a dominant range-access pattern.

## Internal Mechanism

:::depth{level=advanced}
### Updates and MVCC in both designs

- InnoDB updates rows in place in the clustered index and keeps old versions in the **undo log**; secondary indexes are updated only if their columns change (plus delete-marking old entries).
- PostgreSQL writes a new heap tuple version for every update; unless it's a **HOT** update (no indexed column changed and space on the same page), *every* index gets a new entry — the "write amplification" criticism of PostgreSQL for wide, heavily indexed, update-heavy tables ([MVCC](lesson:db-mvcc)).

### Why InnoDB secondaries store the PK, not a physical location

Rows in a clustered B+ tree move when pages split. If secondary indexes held physical addresses, every split would require updating pointers in every secondary index. Storing the logical PK makes secondary indexes immune to splits — at the price of the second traversal.

### SQL Server specifics

A table without a clustered index is a heap with RID-based nonclustered indexes; with one, nonclustered indexes carry the clustering key. The same trade-offs apply, and "key lookup" operators in plans are the second traversal.
:::

## Example

InnoDB table: `orders(id BIGINT AUTO_INCREMENT PRIMARY KEY, customer_id, …)`, secondary index on `customer_id`.

`SELECT * FROM orders WHERE customer_id = 42` (40 rows):

- Secondary index range scan: 1 traversal + 1 leaf page → 40 PKs.
- 40 clustered-index lookups: each ~3–4 levels, upper levels cached → up to 40 leaf-page reads (orders of one customer are scattered by `id`).

Alternative: `PRIMARY KEY (customer_id, id)` clusters each customer's orders together → the same query reads 1–2 adjacent leaf pages. The trade-off: inserts are no longer purely append-only (they go into each customer's region), and other secondary indexes now carry the wider two-column PK.

## Complexity & Performance

| Operation | Heap (PostgreSQL) | Clustered (InnoDB) |
|---|---|---|
| Lookup by PK | index traversal + heap page | one traversal (row in leaf) |
| Range by PK | index + scattered heap pages (unless correlated) | contiguous leaf pages |
| Lookup by secondary | index traversal + heap page | secondary traversal + clustered traversal |
| Insert | heap append (anywhere with space) + each index | insert into clustered position + each index |

## Trade-offs

- Clustered tables make PK-ordered access excellent and secondary access costlier; heaps make all indexes equal-ish and rely on caching for locality.
- The clustering key is a one-time strategic choice: it decides which queries get locality for free.

## Failure Modes

- **Random UUID primary keys in InnoDB** → insert throughput collapses once the table outgrows the buffer pool; index size balloons.
- **Wide composite PKs** → every secondary index inflated.
- **Mutable PKs** → expensive row moves and cascaded FK updates.
- **Assuming PostgreSQL tables are ordered by PK** → they're heaps; `CLUSTER` order decays.

## In Production

- MySQL performance guidance centers on PK design for exactly these reasons.
- In PostgreSQL, `pg_stats.correlation` shows how well physical order matches a column; high correlation makes range scans on that column cheap even without clustering (e.g., append-only time-series tables).

## Deeper Connections

- Clustering is data locality — the same principle as keeping hot data in the same cache lines or pages ([CPU Caches](lesson:os-cpu-caches-contention)).
- Choosing the clustering key is closely related to choosing a partition or shard key: both decide which rows live together ([Sharding](lesson:db-sharding)).

## Common Misconceptions

- **"The primary key is always the clustered index."** True in InnoDB; not in PostgreSQL (heap) or SQL Server (you can cluster on another key).
- **"A table can have several clustered indexes."** Rows have one physical order.
- **"Secondary index lookups are the same cost everywhere."** InnoDB pays a second traversal via the PK.

## Interview Questions

### [L2 · compare] Clustered vs non-clustered index?

A clustered index stores the table rows themselves in its leaf level, ordered by the key, so there's at most one per table and range scans by that key read contiguous pages. A non-clustered (secondary) index is a separate structure whose leaves hold the key and a reference to the row — a physical location in heap-based systems or the clustering key in InnoDB — requiring an extra lookup to fetch the row.

### [L2 · why] Why is a random UUID a poor primary key for a large InnoDB table?

InnoDB clusters rows by primary key. Random keys insert into random leaf pages, causing frequent page splits, half-empty pages and a working set spanning the whole index — once it exceeds the buffer pool, most inserts need disk reads. And every secondary index stores the 16-byte PK. Sequential or time-ordered keys (auto-increment, UUIDv7) append at the right edge instead.

### [L3 · design] In InnoDB, orders are mostly read per customer. Would you change the primary key from `id` to `(customer_id, id)`?

It clusters each customer's orders together, turning per-customer reads into a few contiguous page reads. Costs: inserts land in each customer's region (more splits than pure appends), every secondary index stores the wider PK, lookups by `id` alone need a secondary unique index on `id`, and foreign keys referencing orders must use the composite key or that unique index. Worth it when per-customer range reads dominate and the table far exceeds memory; measure first.

## Practice

### [mcq] In InnoDB, what do secondary index leaf entries contain besides the indexed columns?

- [ ] The row's physical page and slot
- [x] The row's primary key columns
- [ ] A copy of the entire row
- [ ] A pointer to the undo log

That's why secondary lookups take a second traversal and why wide PKs bloat every index.

### [mcq] What does PostgreSQL's CLUSTER command do?

- [ ] Creates a clustered index maintained on every insert
- [x] Rewrites the table once in the order of an index; later inserts are not kept in order
- [ ] Distributes the table across several servers
- [ ] Groups similar rows onto the same page continuously

PostgreSQL tables remain heaps; CLUSTER is a one-time reorder.

## Quick Revision

- Clustered = table stored in the index's leaves, ordered by its key (one per table). InnoDB: the PK.
- Heap (PostgreSQL): all indexes point to TIDs; CLUSTER is a one-time reorder.
- InnoDB secondary lookup = secondary traversal → PK → clustered traversal; secondaries store the PK.
- PK choice (InnoDB): short, stable, increasing. Random UUIDs → splits and bloat; wide PKs → fat secondaries.
- Clustering key = free locality for one access pattern — choose it deliberately.
