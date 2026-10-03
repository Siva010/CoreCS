---
title: "Scan and Join Algorithms: How the Executor Actually Works"
subject: db
level: 8
order: 2
summary: "Sequential, index, index-only and bitmap scans; nested-loop, hash and merge joins with their costs and memory needs; sorting and aggregation strategies — the building blocks every query plan is made of."
depth: core
difficulty: 3
minutes: 45
relevance: high
stage: 2
prerequisites: [db-query-lifecycle, sql-joins]
related: [db-explain, db-query-optimization, db-index-fundamentals, db-composite-covering-indexes, sql-aggregation, db-buffer-pool]
visualizations: [join-algorithms]
labs: [query-plan]
tags: [sequential scan, index scan, index only scan, bitmap heap scan, nested loop join, hash join, merge join, sort, external sort, work_mem, hash aggregate, spill to disk, join algorithms]
---

## Mental Model

Every query plan is assembled from a small toolbox:

- **Ways to read a table**: all of it (sequential scan), a slice via an index (index scan), just the index (index-only scan), or a sorted list of pages from an index (bitmap scan).
- **Ways to join**: for each row look up matches (nested loop), build a hash table and probe it (hash join), or walk two sorted inputs in step (merge join).
- **Ways to sort and group**: in-memory quicksort, external merge sort, hashing.

The planner picks tools by estimated row counts. If you know when each tool is cheap, you can read any plan and predict what will go wrong.

## Definition

| Operator | Idea | Cheap when |
|---|---|---|
| Seq Scan | read every page in order | large fraction of the table needed; small tables |
| Index Scan | walk index, fetch each row | few rows; order needed |
| Index Only Scan | answer from the index | all needed columns in the index; pages all-visible |
| Bitmap Heap Scan | collect TIDs from index(es), read pages in physical order | moderate selectivity; AND/OR of several indexes |
| Nested Loop | for each outer row, find inner matches | small outer side + indexed inner; tiny inputs; non-equi joins |
| Hash Join | build hash table on smaller side, probe with the larger | large unsorted inputs, equality join |
| Merge Join | both inputs sorted on the key, advance in step | inputs already sorted (indexes) or needed sorted anyway |

## Why It Exists

No single algorithm is best for all data sizes. A nested loop with an index is unbeatable for "one customer's orders" and catastrophic for "all customers × all orders"; a hash join is the reverse. Having several algorithms and a cost model to choose among them is what lets one declarative query stay efficient as data changes.

## How It Works

### Scans

- **Sequential scan**: reads pages 0..N, checking the filter on each row. Sequential I/O is efficient and benefits from read-ahead; cost ∝ table size.
- **Index scan**: descends the B+ tree, walks matching leaf entries in key order, fetching each row (random I/O unless cached/correlated). Provides sorted output.
- **Index-only scan**: like an index scan, but skips the table when the visibility map allows ([Covering Indexes](lesson:db-composite-covering-indexes)).
- **Bitmap scan**: Bitmap Index Scan builds a bitmap of matching TIDs (or pages, if memory is short — "lossy"), optionally combines bitmaps with BitmapAnd/BitmapOr, then Bitmap Heap Scan reads each page once in physical order and **rechecks** conditions. No sorted output.

### Nested loop join

```text
for each row r in outer:
    for each row s in inner where s.key = r.key:    ← index lookup if inner is indexed
        emit (r, s)
```

- With an index on the inner key: cost ≈ |outer| × (index lookup) — excellent when outer is small.
- Without an index: |outer| × |inner| comparisons — the disaster case, usually only chosen when estimates say the outer side has ~1 row (and it actually has 100,000).
- Supports any join condition (`<`, `LIKE`, function calls), not just equality.

### Hash join

```text
build:  for each row s in inner (smaller side): table[hash(s.key)].append(s)
probe:  for each row r in outer: for s in table[hash(r.key)] if s.key = r.key: emit (r, s)
```

- Cost O(|inner| + |outer|); memory ∝ inner size (must fit in `work_mem` × `hash_mem_multiplier`).
- If the build side doesn't fit, it's partitioned into **batches** spilled to disk (grace hash join): both sides are partitioned by hash, then each batch pair is joined — more I/O, still linear.
- Equality joins only. Output is unordered. Blocking on the build side (nothing is emitted until the hash table is complete).

### Merge join

```text
sort both inputs on key (or read them in key order from indexes)
advance two cursors; emit pairs when keys match; handle runs of duplicates
```

- O(|A| + |B|) once sorted; sorting costs O(n log n) if needed.
- Excellent when both sides come pre-sorted from indexes, or when the result must be sorted by the join key anyway.

::viz{id=join-algorithms}

### Sorting and aggregation

- **Sort**: in-memory quicksort if the data fits in `work_mem`; otherwise **external merge sort** (sorted runs written to temp files, then merged). `ORDER BY … LIMIT k` uses a **top-N heapsort**, keeping only k rows.
- **Aggregation**: HashAggregate (hash table of groups) or GroupAggregate over sorted input ([Aggregation](lesson:sql-aggregation)).

## Internal Mechanism

:::depth{level=advanced}
### Costing, in brief

PostgreSQL's cost for a sequential scan ≈ `pages × seq_page_cost + rows × cpu_tuple_cost + rows × cpu_operator_cost × (filter ops)`. An index scan adds `random_page_cost` for table fetches, discounted by correlation and expected caching (`effective_cache_size`). Joins multiply by estimated input rows. These abstract units only need to be *relatively* right to rank plans.

### Memory limits per operator

`work_mem` applies **per operator per query** (and per parallel worker). A query with 4 hash joins and 2 sorts can use 6 × work_mem; 200 concurrent such queries can exhaust RAM. That's why work_mem is modest globally and raised per session for known heavy queries.

### Semi, anti and outer variants

Each join algorithm has semi (stop at first match), anti (emit when no match) and outer (emit unmatched with NULLs) variants — how `EXISTS`, `NOT EXISTS` and `LEFT JOIN` are executed ([Semi & Anti Joins](lesson:sql-semi-anti-joins)).

### Parallel execution

Parallel Seq Scan splits pages among workers; Parallel Hash Join builds one shared hash table; partial aggregates are combined in a Finalize step above a Gather node.
:::

## Example

Two plans for "orders of customers in Pune":

```text
-- 30 Pune customers out of 1M; orders indexed on customer_id
Nested Loop  (rows=1200)
  ->  Index Scan using customers_city_idx on customers c  (rows=30)
        Index Cond: (city = 'Pune')
  ->  Index Scan using orders_customer_id_idx on orders o  (rows=40 loops=30)
        Index Cond: (customer_id = c.id)
```

```text
-- Same query, but "city = 'Mumbai'" matches 200,000 customers
Hash Join  (rows=8,000,000)
  Hash Cond: (o.customer_id = c.id)
  ->  Seq Scan on orders o
  ->  Hash
        ->  Seq Scan on customers c
              Filter: (city = 'Mumbai')
```

Same SQL, different constants, different optimal algorithms: 30 × 40 index lookups is trivial; 200,000 × index lookups into orders would be far slower than one sequential pass with a hash table. Explore the switch point in the [Join Algorithms visualization](viz:join-algorithms) and [Query Plan lab](lab:query-plan).

## Complexity & Performance

| Algorithm | Time | Memory | Needs |
|---|---|---|---|
| Nested loop (indexed inner) | O(n log m) | O(1) | index on inner key |
| Nested loop (no index) | O(n × m) | O(1) | — |
| Hash join | O(n + m) | O(smaller) (spills in batches) | equality |
| Merge join | O(n + m) + sorts | O(1) streaming | sorted inputs |
| External sort | O(n log n), multiple passes | work_mem + temp files | — |

## Trade-offs

- Nested loops start producing rows immediately (good for LIMIT) but degrade badly with big outer inputs.
- Hash joins are robust for large inputs but blocking and memory-hungry.
- Merge joins are cheap with pre-sorted inputs and produce sorted output, but sorting unsorted inputs can dominate.

## Failure Modes

- **Nested loop on a misestimate**: planner expects 1 outer row, gets 500k → minutes instead of milliseconds. The #1 plan pathology.
- **Hash join spilling**: `Batches: 64` in EXPLAIN ANALYZE, temp files, disk I/O spikes.
- **Sorts spilling**: `Sort Method: external merge  Disk: 2.1GB`.
- **Memory blow-ups** from many concurrent queries each using several × work_mem.

## In Production

- `log_temp_files` reveals queries spilling sorts/hashes to disk; `EXPLAIN (ANALYZE, BUFFERS)` shows where time and I/O go.
- Fixes are usually: better estimates (ANALYZE, extended statistics), an index enabling a cheaper path, or per-query `work_mem`.

## Deeper Connections

- Hash joins are hash tables, merge joins are merge sort's merge step, nested loops are loops with B+ tree lookups — core data structures under real load ([B+ Trees](lesson:db-btree)).
- Every scan is ultimately page reads through the buffer pool ([Buffer Pool](lesson:db-buffer-pool)).

## Common Misconceptions

- **"Nested loops are bad."** With an indexed inner side and a small outer side, they're the fastest join.
- **"Hash joins need no memory tuning."** They spill to disk when the build side exceeds work_mem.
- **"Seq scans mean a missing index."** For large result fractions, a seq scan is the right choice.

## Interview Questions

### [L2 · compare] Compare nested loop, hash and merge joins.

Nested loop: for each outer row, find matching inner rows — ideal with a small outer input and an index on the inner key; supports any condition; O(n × m) without an index. Hash join: build a hash table on the smaller input and probe it with the larger — O(n + m), equality only, needs memory (spills in batches). Merge join: walk two inputs sorted on the key — O(n + m) when inputs are pre-sorted (indexes), produces sorted output; sorting unsorted inputs costs O(n log n).

### [L2 · how] What is a bitmap heap scan and when is it chosen?

The database first collects matching row locations from one or more indexes into a bitmap (possibly combining indexes with AND/OR), then reads the table pages in physical order, each page once, rechecking conditions. It's chosen for medium selectivity, where a plain index scan would hit the same pages repeatedly in random order but a sequential scan would read too much.

### [L3 · debugging] A query normally takes 20 ms; today it takes 4 minutes. EXPLAIN ANALYZE shows `Nested Loop (rows=1) (actual rows=380000)`. What happened?

The planner estimated one row from the outer side (so a nested loop looked cheap) but got 380,000, executing the inner lookup 380,000 times. Causes: stale statistics after a data change, correlated predicates the planner assumes independent, or a skewed parameter value with a generic plan. Fix the estimate: ANALYZE the tables, add extended statistics for correlated columns, raise the statistics target, or rewrite/split the query; as a stopgap, force a different plan for that query.

## Practice

### [mcq] Which join algorithm can evaluate `ON a.ts BETWEEN b.start AND b.end`?

- [x] Nested loop
- [ ] Hash join
- [ ] Merge join on ts only
- [ ] None of them

Hash joins need equality; nested loops handle arbitrary conditions (ideally with an index or GiST range support on the inner side).

### [numeric 10500] A hash join builds on a 500-row table and probes with a 10,000-row table. Roughly how many rows does it process in total (build + probe)?

:::answer
Each input is read once: 500 (build) + 10,000 (probe) = **10,500** rows — linear, versus 5,000,000 comparisons for a nested loop without an index.
:::

## Quick Revision

- Scans: seq (much of the table), index (few rows/ordered), index-only (covering + all-visible), bitmap (medium selectivity, AND/OR).
- Joins: nested loop (small outer + indexed inner, any condition), hash (large, equality, memory), merge (sorted inputs).
- Sorts/hashes spill to disk beyond work_mem; work_mem is per operator.
- Misestimated nested loops are the #1 plan disaster.
