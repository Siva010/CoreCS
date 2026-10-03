---
title: "Index Design in Practice: From Query Patterns to a Minimal Index Set"
subject: db
level: 7
order: 5
summary: "A repeatable method for choosing indexes from real workloads, the classic reasons an index is ignored (functions, casts, OR, leading wildcards, low selectivity, stale statistics), foreign-key and pagination indexes, and pruning unused or redundant ones."
depth: advanced
difficulty: 3
minutes: 45
relevance: high
stage: 3
prerequisites: [db-composite-covering-indexes, db-clustered-indexes]
related: [db-specialized-indexes, db-explain, db-query-optimization, db-keys-constraints, x-slow-query, db-partitioning]
labs: [query-plan]
tags: [index design, workload analysis, pg_stat_statements, sargable, implicit cast, or condition, index usage, redundant index, unused index, foreign key index, pagination index, write overhead, hypothetical index]
---

## Mental Model

Index design is **workload-driven, not schema-driven**. You don't ask "which columns should be indexed?" — you ask "which queries matter, and what is the smallest set of indexes that lets each of them touch only the rows it returns?"

Think of each important query as a request for **one contiguous slice of one sorted structure**. If some index provides that slice (right leading columns, right order), the query is cheap. If not, you either add or adjust an index, rewrite the query to fit an existing one, or accept a scan because the query is rare or returns most of the table anyway.

## Definition

- **Workload**: the set of queries with their frequency and latency requirements (from `pg_stat_statements`, slow-query logs, APM traces).
- **Sargable predicate**: one an index can use to seek ([SELECT Basics](lesson:sql-select-basics)).
- **Redundant index**: one whose uses are all served by another (e.g., `(a)` next to `(a, b)`).
- **Unused index**: zero or negligible scans over a representative period.

## Why It Exists

Indexes are the most effective and the most over-applied performance tool. Too few and queries scan; too many and every write pays for all of them, memory fills with rarely used index pages, and replication lags ([Index Fundamentals](lesson:db-index-fundamentals)). A method prevents both.

## How It Works

### A repeatable method

1. **Collect the workload**: top queries by total time (`pg_stat_statements` sorted by `total_exec_time`), plus latency-critical ones even if rare.
2. **Normalize each query's access pattern**: equality columns, range columns, sort columns, returned columns, `LIMIT`.
3. **Design the ideal index per query**: equality columns → range/sort column → (optionally) covering columns in `INCLUDE` ([Composite Indexes](lesson:db-composite-covering-indexes)).
4. **Merge**: indexes whose leading columns overlap can often serve several queries — one `(tenant_id, status, created_at)` may serve three queries.
5. **Check write cost**: how write-heavy is the table? Each index adds cost to every insert and many updates.
6. **Verify with EXPLAIN ANALYZE on production-like data**, then deploy with `CREATE INDEX CONCURRENTLY`.
7. **Prune periodically**: drop unused and redundant indexes.

### Why an index isn't used: the checklist

| Cause | Example | Fix |
|---|---|---|
| Function on the column | `WHERE date(created_at) = '2024-05-01'` | range on the bare column, or expression index |
| Implicit cast on the column | `varchar` column compared with an integer / `uuid` compared with `text` | pass correctly typed parameters |
| Leading wildcard | `LIKE '%son'` | trigram GIN index, full text, or reversed-string index |
| OR across different columns | `WHERE email = ? OR phone = ?` | separate indexes (BitmapOr) or `UNION ALL` of two queries |
| Not a leftmost prefix | index `(a, b)`, query on `b` | reorder or add an index |
| Low selectivity | `WHERE is_active = true` (95% of rows) | usually nothing — or a partial index on the rare value |
| Stale/insufficient statistics | estimates way off after bulk load | `ANALYZE`, extended statistics ([Query Optimization](lesson:db-query-optimization)) |
| Collation mismatch for prefix LIKE | `LIKE 'abc%'` with a non-C collation | `text_pattern_ops` index |
| Negation | `status <> 'done'` | rewrite as `status IN (…)` or a partial index |
| Parameterized generic plan | prepared statement planned for "average" parameter | depends; see plan caching |

### Indexes you almost always need

- **Foreign-key columns** on the referencing side (`orders.customer_id`): serve joins and make parent deletes/updates fast ([Keys & Constraints](lesson:db-keys-constraints)).
- **Pagination/sort paths** for list endpoints: `(filter cols, sort col, id)` for keyset pagination.
- **Uniqueness** where the business requires it (these also serve lookups).
- **Queue/polling predicates** (`WHERE status = 'pending' ORDER BY created_at`) as partial indexes ([Specialized Indexes](lesson:db-specialized-indexes)).

### Indexes you should question

- Single-column indexes on every column "just in case".
- `(a)` when `(a, b)` exists (redundant, unless `(a)` is unique or much hotter and smaller).
- Indexes on low-cardinality columns alone (`gender`, `is_deleted`).
- Indexes built for a one-off report that ran once.
- Near-duplicate indexes created by different teams/ORM migrations.

## Internal Mechanism

:::depth{level=advanced}
### Measuring usage

```sql
-- Unused indexes (since stats reset), largest first
SELECT s.relname AS table, s.indexrelname AS index, s.idx_scan,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0 AND NOT i.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC;
```

Check replicas too (their read queries may be the index's only users), and cover a full business cycle (month-end jobs!). Before dropping, you can make an index invisible in some systems (MySQL 8 invisible indexes, Oracle) to test impact safely; in PostgreSQL, drop with `DROP INDEX CONCURRENTLY` and keep the DDL handy.

### Hypothetical indexes

Extensions like `hypopg` let you ask the planner "would you use this index?" without building it — handy for exploring options on large tables.

### Write overhead estimate

For an insert-heavy table, each additional B-tree index adds roughly one index insertion (O(log n) page access, WAL record, possible split) per row. With random keys, each may be a buffer miss. The marginal index on a 50k-insert/s table is a capacity decision, not a style choice.

### Index maintenance and bloat

High-churn indexes bloat; `REINDEX CONCURRENTLY` (PostgreSQL 12+) rebuilds without blocking writes. Monitor index size relative to table size and live rows.
:::

## Example

Workload for `tickets(id, tenant_id, assignee_id, status, priority, created_at, subject, …)`:

| Query | Frequency | Ideal index |
|---|---|---|
| Q1: `WHERE tenant_id=? AND status='open' ORDER BY created_at DESC LIMIT 50` | very high | `(tenant_id, status, created_at DESC)` |
| Q2: `WHERE tenant_id=? AND assignee_id=? AND status='open' ORDER BY priority DESC` | high | `(tenant_id, assignee_id, status, priority DESC)` |
| Q3: `WHERE tenant_id=? AND created_at >= ?` (reports) | low | served by Q1's index? No — status sits between tenant_id and created_at |
| Q4: `WHERE id = ?` | very high | primary key |

Decisions: create indexes for Q1 and Q2. For Q3, either accept a scan of the tenant's rows via `(tenant_id, status, …)` (usually fine if it's a nightly report on a replica) or add `(tenant_id, created_at)` if it's latency-sensitive. Don't add single-column indexes on `status` or `priority` — nothing needs them. Verify each with EXPLAIN in the [Query Plan lab](lab:query-plan).

## Complexity & Performance

- The goal per query: rows examined ≈ rows returned. EXPLAIN ANALYZE's "Rows Removed by Filter" measures the gap.
- Index count × write rate = maintenance load; watch WAL generation and replication lag when adding indexes to hot tables.

## Trade-offs

- Serve rare queries with scans on replicas instead of permanent indexes on the primary.
- Merge indexes to reduce write cost, at the price of some queries using a slightly less ideal index.
- Covering indexes speed hot reads; they enlarge the index and cost more per write.

## Failure Modes

- The query that's "indexed" but still scans millions of entries because of column order or a range on the leading column.
- A deploy adds an index without `CONCURRENTLY` → writes blocked for minutes.
- Dropping an "unused" index that a monthly job or a replica relied on.
- ORMs sending parameters with the wrong type, silently disabling indexes.

## In Production

- Make index review part of code review for new queries: "Which index serves this? What does EXPLAIN say on production-sized data?"
- Track top queries by total time weekly; most wins come from the top 10.

## Deeper Connections

- Index design and query rewriting are two halves of the same job ([Query Optimization](lesson:db-query-optimization)).
- A slow-query incident usually ends with an index change ([Slow Query](lesson:x-slow-query)).

## Common Misconceptions

- **"Index every column used in WHERE."** Index access patterns, not columns.
- **"Unused index = harmless."** It costs every write and memory.
- **"Adding an index is always safe."** It can block writes (non-concurrent build), raise write latency, or change plans for other queries.

## Interview Questions

### [L2 · debugging] An index exists on `orders(created_at)` but `WHERE to_char(created_at, 'YYYY-MM') = '2024-05'` does a sequential scan. Why and how do you fix it?

Wrapping the column in a function makes the predicate non-sargable; the index is ordered by created_at, not by the function's output. Rewrite as a range: `created_at >= '2024-05-01' AND created_at < '2024-06-01'`. (Alternatively an expression index on exactly that expression, but the range rewrite is simpler and serves other queries too.)

### [L2 · design] How do you decide which indexes a table needs?

Start from the workload: identify the most expensive and latency-critical queries, derive each one's equality/range/sort/returned columns, design the ideal composite index per query, merge overlapping ones, weigh write overhead against read benefit, verify with EXPLAIN ANALYZE on realistic data, build concurrently, and periodically remove unused or redundant indexes.

### [L3 · scenario] `WHERE email = $1 OR phone = $2` is slow on a 40M-row users table with single-column indexes on both. What's happening and what can you do?

With OR across different columns, a single index can't satisfy the predicate. The planner can combine both indexes via BitmapOr — if it doesn't (bad estimates, types), it falls back to a sequential scan. Ensure parameter types match the columns, check estimates with EXPLAIN, and if needed rewrite as `SELECT … WHERE email = $1 UNION SELECT … WHERE phone = $2`, which uses each index directly. Also consider whether the API should look up by one identifier at a time.

## Practice

### [mcq] Which index is redundant given the others: (a), (a, b), (b), (a, b, c)?

- [x] (a) and (a, b) — both are leftmost prefixes of (a, b, c)
- [ ] (b)
- [ ] (a, b, c)
- [ ] None

(b) is not a prefix of anything else; (a) and (a, b) are served by (a, b, c) unless they're unique or much smaller and hotter.

### [mcq] EXPLAIN ANALYZE shows an Index Scan returning 50 rows with "Rows Removed by Filter: 480,000". What does this most likely indicate?

- [ ] The index is corrupt
- [ ] Statistics are too precise
- [x] The index matches only part of the predicate (e.g., a leading range), so most scanned entries are filtered afterwards
- [ ] The query returns too few rows to use an index

Rows examined ≫ rows returned means the index isn't the right shape for the query.

## Quick Revision

- Design from the workload: equality → range/sort → covering; merge overlapping indexes; verify with EXPLAIN.
- Ignored-index checklist: functions, casts, leading %, OR, non-prefix, low selectivity, stale stats, collation, negation.
- Always consider: FK columns, pagination paths, uniqueness, partial indexes for queues.
- Prune unused/redundant indexes (check replicas and monthly jobs first). Build/drop CONCURRENTLY.
- Target: rows examined ≈ rows returned.
