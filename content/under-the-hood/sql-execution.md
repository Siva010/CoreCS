---
title: "What Happens When the Database Executes a SELECT"
summary: "Inside the database backend: the wire-protocol message, parse and analysis against the catalog, rewrite, cost-based planning with statistics, the executor pulling rows through a plan tree, buffer-pool page reads, MVCC visibility, and streaming the result back."
subjects: [db]
order: 11
related: [db-query-lifecycle, db-scans-joins, db-explain, db-buffer-pool, db-mvcc, x-sql-query-journey]
---

The application sends `SELECT id, total FROM orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;` to PostgreSQL over a pooled connection.

## [driver] The message on the wire

The driver sends a `Parse` (with `$1` instead of 42), `Bind` (the parameter value), `Describe` and `Execute` message — or a single `Query` message for unparameterized SQL. The bytes reach the backend process that owns this connection.

## [db] Parse

The parser tokenizes and builds a parse tree using the SQL grammar. Syntax errors stop here. No tables are consulted yet.

## [db] Analyze and rewrite

The analyzer resolves `orders` via the catalog (which schema? does it exist? does this role have SELECT?), resolves columns and types (`customer_id` is `bigint`, so `$1` is bigint), and produces a query tree. The rewriter expands views and applies row-level security policies ([Query Lifecycle](lesson:db-query-lifecycle)).

## [planner] Plan

The planner enumerates access paths: a sequential scan, an index scan on `orders_customer_id_idx`, or an index scan on `orders_customer_created_idx (customer_id, created_at DESC)` that returns rows already in the requested order. Using statistics (customer 42 has ~40 orders), it estimates costs and chooses the composite index with a `Limit` on top — no sort needed ([Scans & Joins](lesson:db-scans-joins)).

## [executor] Execute: pull rows through the tree

The executor calls `Limit.next()`, which calls `IndexScan.next()`. The index scan descends the B+ tree to the first entry for customer 42 ([Index Lookup](uth:index-lookup)) and returns entries in order.

## [buffer] Pages through the buffer pool

Each index page and heap page is requested from the buffer pool: a hit returns a pointer; a miss evicts a victim frame and reads the page via the OS ([Buffer Pool](lesson:db-buffer-pool)). The page is pinned and share-latched while being read.

## [db] MVCC visibility

For each heap tuple, the executor checks `xmin`/`xmax` against the transaction's snapshot: skip versions created by uncommitted or later transactions, skip versions deleted before the snapshot. Only visible rows go up the tree ([MVCC](lesson:db-mvcc)).

## [executor] Stop early

After 20 rows reach the `Limit` node, it stops pulling: the scan never reads the rest of customer 42's orders. Pipelined execution + an index that provides order = minimal work.

## [driver] Stream the result

The backend sends `RowDescription`, 20 `DataRow` messages and `CommandComplete`, then `ReadyForQuery`. The driver converts them to language objects. `EXPLAIN (ANALYZE, BUFFERS)` of this query would show exactly these nodes, their row counts and the buffer hits/reads ([EXPLAIN](lesson:db-explain)).
