---
title: "Set Operations: UNION, INTERSECT, EXCEPT"
subject: db
level: 4
order: 3
summary: "Combining whole result sets vertically: UNION vs UNION ALL, INTERSECT and EXCEPT, their duplicate and NULL semantics, column compatibility rules, and when a join or EXISTS is the better tool."
depth: core
difficulty: 2
minutes: 20
relevance: high
stage: 1
prerequisites: [sql-select-basics]
related: [sql-semi-anti-joins, sql-null-logic, sql-joins, sql-subqueries-ctes]
labs: [sql-playground]
tags: [union, union all, intersect, except, minus, set operations, duplicates, bag semantics, column compatibility]
---

## Mental Model

Joins combine tables **side by side** (more columns). Set operations stack results **on top of each other** (more rows) or compare them row by row. Each input must have the same number of columns with compatible types, and rows are compared as whole tuples.

## Definition

| Operation | Result | Duplicates |
|---|---|---|
| `A UNION B` | rows in A or B | removed |
| `A UNION ALL B` | all rows of A followed by all rows of B | kept |
| `A INTERSECT B` | rows in both | removed (`INTERSECT ALL` keeps min count) |
| `A EXCEPT B` (Oracle: `MINUS`) | rows in A not in B | removed (`EXCEPT ALL` subtracts counts) |

Rules:

- Column names come from the **first** query.
- Matching is **positional**, not by name — `SELECT id, name` UNION `SELECT name, id` is an error or, worse, a silent mix-up if types happen to be compatible.
- `ORDER BY`/`LIMIT` apply to the whole combined result (put them at the end; parenthesize branches to limit individually).
- For duplicate elimination, **NULLs are treated as equal** (unlike `=`).
- Precedence: `INTERSECT` binds tighter than `UNION` and `EXCEPT`.

## Why It Exists

Some questions are naturally about combining result sets: "all contacts, from customers and from suppliers", "users active in both January and February", "products in the catalog but never sold". Set operations express them directly.

## How It Works

```sql
-- One mailing list from two tables; UNION removes people present in both
SELECT email, name FROM customers
UNION
SELECT email, name FROM newsletter_subscribers;

-- Customers who ordered in both January and February 2024
SELECT customer_id FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2024-02-01'
INTERSECT
SELECT customer_id FROM orders WHERE order_date >= '2024-02-01' AND order_date < '2024-03-01';

-- Products never ordered
SELECT id FROM products
EXCEPT
SELECT product_id FROM order_items;
```

### UNION vs UNION ALL — the performance rule

`UNION` must detect duplicates, which means sorting or hashing the entire combined result. `UNION ALL` just concatenates. **Default to `UNION ALL`** unless you actually need deduplication — and when branches can't overlap (e.g., different `status` filters, or a "source" literal column), `UNION ALL` is both correct and cheaper.

```sql
SELECT 'customer' AS source, email FROM customers
UNION ALL
SELECT 'supplier', email FROM suppliers;     -- rows can't collide: the source column differs
```

## Internal Mechanism

:::depth{level=advanced}
- `UNION ALL` → an **Append** node: run each branch, stream rows through. Branches can run in parallel.
- `UNION`/`INTERSECT`/`EXCEPT` → Append followed by **HashSetOp/HashAggregate** or **Sort + Unique/SetOp**: the executor tags each row with its branch and counts occurrences per distinct row, then emits according to the operation (INTERSECT: count in both > 0; EXCEPT: count in A > 0 and in B = 0).
- The optimizer can push `WHERE` conditions from an outer query into each `UNION ALL` branch — which is how partitioned tables work internally: a query on the parent becomes an Append over partitions, and pruning removes branches ([Partitioning](lesson:db-partitioning)).
:::

## Example

"Customers who ordered in 2023 but not in 2024" — as `EXCEPT` and as an anti join:

```sql
SELECT customer_id FROM orders WHERE order_date >= '2023-01-01' AND order_date < '2024-01-01'
EXCEPT
SELECT customer_id FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01';
```

```sql
SELECT DISTINCT o.customer_id
FROM orders o
WHERE o.order_date >= '2023-01-01' AND o.order_date < '2024-01-01'
  AND NOT EXISTS (SELECT 1 FROM orders o2
                  WHERE o2.customer_id = o.customer_id
                    AND o2.order_date >= '2024-01-01' AND o2.order_date < '2025-01-01');
```

Both are correct. `EXCEPT` is shorter; the anti join lets you return other columns (name, email) without a further join, and NULL `customer_id`s behave differently (`EXCEPT` treats them as equal and removes a NULL if both years have one).

## Complexity & Performance

- UNION ALL: O(n + m), streaming.
- UNION/INTERSECT/EXCEPT: plus a hash (O(n + m) memory) or sort (O(N log N)) over all rows.
- Replacing an `OR` across different columns with `UNION ALL` of two index-friendly queries can turn a sequential scan into two index scans (be careful to avoid double counting rows that satisfy both).

## Trade-offs

- `EXCEPT`/`INTERSECT` vs `NOT EXISTS`/`EXISTS`: set operations compare *all selected columns* and deduplicate; semi/anti joins compare on chosen keys and can return extra columns. Use set ops for key lists, joins for rich results.
- `UNION` to deduplicate vs fixing the source of duplicates: `UNION` hides data-quality problems at a cost.

## Failure Modes

- Using `UNION` where `UNION ALL` was meant — silently dropping legitimate duplicate rows (two identical ₹500 payments become one) and paying for a sort.
- Positional column mismatch between branches.
- `ORDER BY` placed in the first branch (syntax error, or an unexpected meaning when the branch is parenthesized).

## In Production

- Reporting queries often `UNION ALL` several sources (current table + archive table) — the same pattern as manual partitioning.
- Large `UNION`s on OLTP systems can spill sorts to disk; check `work_mem` and EXPLAIN.

## Deeper Connections

- Set operations are the relational algebra's ∪, ∩, − operators under bag semantics ([Relational Model](lesson:db-relational-model)).
- Anti joins and EXCEPT solve the same problem with different NULL and duplicate semantics ([Semi & Anti Joins](lesson:sql-semi-anti-joins)).

## Common Misconceptions

- **"UNION and UNION ALL differ only in speed."** They differ in results whenever duplicates exist.
- **"Set operations match columns by name."** They match by position.
- **"EXCEPT and NOT IN are equivalent."** EXCEPT treats NULLs as equal and deduplicates; NOT IN collapses to no rows when a NULL is present.

## Interview Questions

### [L1 · compare] UNION vs UNION ALL?

UNION concatenates results and removes duplicate rows (requiring a sort or hash over the combined result). UNION ALL concatenates and keeps all rows, streaming them. Use UNION ALL unless deduplication is required.

### [L2 · sql] Find customers who placed orders in both 2023 and 2024.

:::answer
```sql
SELECT customer_id FROM orders WHERE order_date >= '2023-01-01' AND order_date < '2024-01-01'
INTERSECT
SELECT customer_id FROM orders WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01';
```

Alternative with aggregation: `GROUP BY customer_id HAVING count(DISTINCT extract(year FROM order_date)) = 2` over orders filtered to those two years.
:::

## Practice

### [numeric 6] A has rows 1, 1, 2 and B has rows 2, 3, 3. How many rows does A UNION ALL B return?

:::answer
UNION ALL concatenates without removing anything: 3 + 3 = **6** rows (1, 1, 2, 2, 3, 3).
:::

### [mcq] Using the same A (1, 1, 2) and B (2, 3, 3), what does A UNION B return?

- [ ] 1, 1, 2, 3, 3
- [x] 1, 2, 3
- [ ] 2
- [ ] 1, 1

UNION removes duplicates from the combined result.

### [mcq] Using the same A (1, 1, 2) and B (2, 3, 3), what does A EXCEPT B return?

- [x] 1
- [ ] 1, 1
- [ ] 1, 3
- [ ] Nothing

EXCEPT removes rows present in B (2) and deduplicates what remains. `EXCEPT ALL` would return 1, 1.

## Quick Revision

- Set operations stack or compare whole rows; columns match by position; names come from the first query.
- UNION (dedupe, costs a sort/hash) vs UNION ALL (concatenate) — default to UNION ALL.
- INTERSECT = in both; EXCEPT = in A not in B; `ALL` variants keep multiplicities.
- NULLs are equal for set-operation deduplication (unlike `=`).
- Use EXISTS/NOT EXISTS when you need to compare on keys and return other columns.
