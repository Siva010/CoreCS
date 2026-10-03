---
title: "Reading EXPLAIN and EXPLAIN ANALYZE"
subject: db
level: 8
order: 3
summary: "How to read a query plan: the tree, cost and row estimates, actual times and loops, buffers, and the handful of red flags — estimate vs actual gaps, rows removed by filter, spills, heap fetches — that locate almost every slow query."
depth: core
difficulty: 3
minutes: 40
relevance: essential
stage: 2
prerequisites: [db-scans-joins]
related: [db-query-optimization, db-index-design-practice, db-query-lifecycle, db-buffer-pool, x-slow-query]
labs: [query-plan]
tags: [explain, explain analyze, query plan, cost, estimated rows, actual rows, loops, buffers, rows removed by filter, heap fetches, sort method, hash batches, auto_explain, explain format json]
---

## Mental Model

`EXPLAIN` shows the plan the optimizer **intends** to run and what it **expects** at each step. `EXPLAIN ANALYZE` **runs** the query and adds what **actually** happened. Performance debugging is mostly comparing the two:

- Where did the time go? (the node with the largest *exclusive* time)
- Where were the estimates wrong? (estimated rows vs actual rows)
- How much work was wasted? (rows read vs rows kept; pages read)

## Definition

```sql
EXPLAIN SELECT …;                          -- plan + estimates, doesn't run the query
EXPLAIN (ANALYZE, BUFFERS) SELECT …;       -- runs it; actual rows/time/loops + page counts
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) …; -- machine-readable, for visualizers
```

Each node line:

```text
Index Scan using orders_customer_id_idx on orders o  (cost=0.43..152.10 rows=38 width=48) (actual time=0.031..0.210 rows=37 loops=1)
                                                      └── estimates ──────────────────┘  └── reality ──────────────────────────┘
```

| Field | Meaning |
|---|---|
| `cost=a..b` | estimated startup cost .. total cost (abstract units), **including children** |
| `rows` | estimated rows output by this node (per loop) |
| `width` | estimated average row width in bytes |
| `actual time=a..b` | ms to first row .. ms to last row, **per loop**, including children |
| `actual rows` | rows actually output, **per loop** |
| `loops` | how many times the node was executed |
| `Buffers: shared hit=H read=R` | pages found in the buffer pool vs read from outside it |

⚠ `EXPLAIN ANALYZE` executes the statement. For `UPDATE`/`DELETE`/`INSERT`, wrap it: `BEGIN; EXPLAIN ANALYZE …; ROLLBACK;`.

## Why It Exists

The planner's decisions are invisible from SQL. Without EXPLAIN, tuning is guesswork ("add an index and hope"). With it, you can see exactly which step is slow and why the planner chose it.

## How It Works

### Read the tree bottom-up, inside-out

Indentation shows the tree; children are indented under parents with `->`. Data flows from the most indented nodes up to the root.

```text
Limit  (actual time=812.4..812.4 rows=10 loops=1)
  ->  Sort  (actual time=812.4..812.4 rows=10 loops=1)
        Sort Key: o.total DESC
        Sort Method: top-N heapsort  Memory: 26kB
        ->  Hash Join  (actual time=95.1..790.6 rows=412330 loops=1)
              Hash Cond: (o.customer_id = c.id)
              ->  Seq Scan on orders o  (actual time=0.01..402.7 rows=9800000 loops=1)
                    Filter: (status = 'paid')
                    Rows Removed by Filter: 200000
              ->  Hash  (actual time=94.8..94.8 rows=41233 loops=1)
                    Buckets: 65536  Batches: 1  Memory Usage: 2890kB
                    ->  Seq Scan on customers c  (actual time=0.02..88.1 rows=41233 loops=1)
                          Filter: (city = 'Pune')
                          Rows Removed by Filter: 958767
```

Story: scan all customers, keep 41k in Pune, hash them; scan 9.8M paid orders and probe; 412k joined rows; top-10 sort. Most time is the 9.8M-row orders scan (~400 ms) plus probing (~390 ms). A fix would target reading fewer orders — e.g., join from the Pune customers into an index on `orders(customer_id)` if Pune were a small fraction, or pre-aggregating.

### Computing where time goes

- `actual time` of a node **includes its children**. Exclusive time ≈ node's total − children's totals.
- Multiply by `loops`: a node with `actual time=0.05..0.08 rows=3 loops=200000` took ~0.08 ms × 200,000 ≈ **16 seconds** in total — the classic hidden cost inside a nested loop.

### The red flags

| Signal | Meaning | Typical fix |
|---|---|---|
| estimated `rows=1`, actual `rows=250000` | cardinality misestimate → wrong algorithm/join order | ANALYZE, extended statistics, rewrite ([Query Optimization](lesson:db-query-optimization)) |
| `Rows Removed by Filter: 9,999,962` | reading far more rows than returned | an index matching the predicate; better column order |
| `Seq Scan` on a large table for a selective predicate | no usable index or non-sargable predicate | index / rewrite predicate |
| large `loops` on an inner Index Scan | nested loop executed many times | hash join via better estimates; fewer outer rows |
| `Sort Method: external merge  Disk: …` | sort spilled | more work_mem for this query; index providing order |
| `Batches: 16` in Hash | hash join spilled | more work_mem; smaller build side |
| `Heap Fetches: 480000` in Index Only Scan | visibility map not set | VACUUM; check long transactions |
| `Buffers: … read=` huge | cold cache / data larger than memory | less data touched; more RAM; warm-up |
| `Recheck Cond … Rows Removed by Index Recheck` | lossy bitmap (too many pages for work_mem) | more work_mem; more selective index |

::lab{id=query-plan}

## Internal Mechanism

:::depth{level=advanced}
### Why estimates go wrong

Estimates come from `pg_statistic`: per-column most-common values and frequencies, histograms, distinct counts, null fraction, correlation. The planner assumes **independence** between predicates (`city = 'Pune' AND state = 'MH'` is estimated as P(city) × P(state), a huge underestimate since Pune implies MH), assumes uniformity outside the MCV list, and can't see through functions or complex expressions (defaults like 0.5% selectivity). Joins multiply errors: an error of 10× at each of three joins becomes 1000×.

### Timing overhead

`ANALYZE` instruments each row with clock reads; for queries processing hundreds of millions of rows, `EXPLAIN (ANALYZE, TIMING OFF)` reduces overhead while keeping row counts.

### auto_explain and plan capture

Slow plans are often transient (parameter-specific or after a statistics change). `auto_explain.log_min_duration` logs the actual plan of slow executions in production, including nested statements inside functions.
:::

## Example

Before and after an index (10M-row `orders`):

```text
-- before
Seq Scan on orders  (cost=0.00..198530.00 rows=40 width=48) (actual time=0.9..812.3 rows=38 loops=1)
  Filter: (customer_id = 42)
  Rows Removed by Filter: 9999962
  Buffers: shared hit=2112 read=71418
Execution Time: 812.4 ms

-- after CREATE INDEX ON orders(customer_id)
Index Scan using orders_customer_id_idx on orders  (cost=0.43..152.10 rows=40 width=48) (actual time=0.03..0.19 rows=38 loops=1)
  Index Cond: (customer_id = 42)
  Buffers: shared hit=41
Execution Time: 0.21 ms
```

The Buffers line tells the physical story: 73,530 pages touched (≈ 575 MB) versus 41 pages. Practice reading real plans in the [Query Plan lab](lab:query-plan).

## Complexity & Performance

`EXPLAIN` costs a planning pass (~ms). `EXPLAIN ANALYZE` costs a full execution plus instrumentation — don't run it casually on a production primary for heavy queries; use a replica or a copy with production-like statistics.

## Trade-offs

- Plain `EXPLAIN` is safe and fast but shows only beliefs; `ANALYZE` shows truth at the cost of running the query.
- Testing plans on small dev databases is misleading: the planner picks different plans for different data sizes. Test on production-sized data.

## Failure Modes

- Running `EXPLAIN ANALYZE DELETE …` without a transaction — it deletes.
- Reading `actual time` without multiplying by `loops`.
- Comparing cost units across different queries or databases as if they were milliseconds.
- Optimizing the wrong node (largest cumulative time rather than exclusive time).

## In Production

- The workflow: find expensive queries (`pg_stat_statements`), capture plans (`auto_explain` or EXPLAIN on a replica), locate the red flag, fix (index, statistics, rewrite), verify with before/after Buffers and timings.
- Plan visualizers (explain.depesz.com, explain.dalibo.com, PEV2) make large plans readable.

## Deeper Connections

- Each node is an algorithm from [Scans & Joins](lesson:db-scans-joins); the choice among them is the cost model from [Query Optimization](lesson:db-query-optimization).
- Buffers hit vs read are the buffer pool at work ([Buffer Pool](lesson:db-buffer-pool)).

## Common Misconceptions

- **"Cost is in milliseconds."** It's an abstract unit; only `actual time` is time.
- **"EXPLAIN shows what happened."** Only EXPLAIN ANALYZE does.
- **"The top node's time is the slow part."** It includes everything below it; find the node with the largest exclusive time.

## Interview Questions

### [L2 · how] How do you investigate a slow SQL query?

Reproduce it with representative parameters, run `EXPLAIN (ANALYZE, BUFFERS)` (inside a rolled-back transaction for writes, ideally on a replica), find the node with the most exclusive time, compare estimated vs actual rows to spot misestimates, look for rows removed by filter, large loops, spills and heavy buffer reads, then fix the cause — an index matching the predicate/order, refreshed or extended statistics, or a query rewrite — and verify the new plan.

### [L2 · conceptual] What's the difference between EXPLAIN and EXPLAIN ANALYZE?

EXPLAIN shows the chosen plan with the planner's estimated costs and row counts without executing. EXPLAIN ANALYZE executes the query and reports actual rows, timing and loop counts per node (plus buffer usage with BUFFERS), so you can compare estimates with reality — but it really runs the statement, including writes.

### [L3 · debugging] An inner Index Scan shows `actual time=0.02..0.03 rows=1 loops=850000`. The query takes 30 seconds. Explain.

The node is cheap per execution (~0.03 ms) but runs 850,000 times inside a nested loop: 850,000 × 0.03 ms ≈ 25 s. The outer side produced far more rows than the planner likely expected. Check the outer node's estimated vs actual rows; better estimates (ANALYZE, extended stats) or a rewrite should lead to a hash join or a smaller outer input.

## Practice

### [numeric 12 unit=s] A plan node shows `actual time=0.010..0.024 rows=2 loops=500000`. Approximately how many seconds does it account for in total?

:::answer
Per-loop time is up to 0.024 ms; 0.024 ms × 500,000 = 12,000 ms ≈ **12 s**.
:::

### [mcq] Which EXPLAIN ANALYZE line most directly indicates a missing or mismatched index?

- [ ] `Sort Method: quicksort  Memory: 25kB`
- [x] `Rows Removed by Filter: 4,812,330` on a node returning 12 rows
- [ ] `Buffers: shared hit=18`
- [ ] `Planning Time: 0.4 ms`

Reading millions of rows to return a dozen means no index narrowed the search.

## Quick Revision

- EXPLAIN = estimates only; EXPLAIN (ANALYZE, BUFFERS) = runs it, adds actual rows/time/loops/pages. Roll back writes.
- Read bottom-up; times include children; multiply per-loop numbers by loops.
- Red flags: estimate ≠ actual, Rows Removed by Filter, big loops, spills (external merge, Batches > 1), heap fetches, large buffer reads.
- Fix causes: indexes, statistics, rewrites — and verify with before/after plans.
