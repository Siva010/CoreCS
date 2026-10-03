---
title: "Joins: Inner, Outer, Cross and Self — and Why Rows Multiply"
subject: db
level: 3
order: 1
summary: "Joins as 'pair up matching rows', every join type traced on real rows, the ON-vs-WHERE trap in outer joins, self joins for hierarchies, and the fan-out effect behind double-counted totals."
depth: core
difficulty: 2
minutes: 45
relevance: essential
stage: 1
prerequisites: [sql-select-basics, db-keys-constraints]
related: [sql-semi-anti-joins, sql-aggregation, sql-null-logic, db-scans-joins, db-index-fundamentals, sql-interview-patterns]
visualizations: [sql-joins]
labs: [sql-playground]
tags: [join, inner join, left join, right join, full outer join, cross join, self join, on vs where, fan-out, row multiplication, cartesian product, natural join, using]
---

## Mental Model

A join **pairs up rows from two tables whenever the join condition is true**. Conceptually: take every combination of a row from the left and a row from the right (the Cartesian product), keep the pairs where `ON` is true. Outer joins then **add back** rows that found no partner, padding the other side with NULLs.

Two consequences follow directly:

1. **Rows multiply.** One customer with five orders appears five times after joining customers to orders. That's not a bug — it's what a join means — but it's the root cause of double-counted totals.
2. **Venn diagrams are misleading.** Joins don't intersect sets of values; they pair rows. A left row can match zero, one or *many* right rows.

## Definition

| Join | Result |
|---|---|
| `INNER JOIN` | Pairs where the condition is true |
| `LEFT [OUTER] JOIN` | Inner pairs + every unmatched left row (right side NULL) |
| `RIGHT [OUTER] JOIN` | Inner pairs + every unmatched right row (left side NULL) |
| `FULL [OUTER] JOIN` | Inner pairs + unmatched rows from both sides |
| `CROSS JOIN` | Every combination (Cartesian product), no condition |
| Self join | A table joined with itself under two aliases |

`USING (col)` is shorthand for equality on same-named columns (and outputs the column once). `NATURAL JOIN` joins on *all* same-named columns — avoid it: adding a column (e.g., `updated_at` to both tables) silently changes the join.

## Why It Exists

Normalized schemas store each fact once — customers in one table, orders in another ([Normalization](lesson:db-normalization)). Joins reassemble related facts at query time. They're the price, and the power, of the relational model: any relationship can be queried, including ones nobody anticipated.

## How It Works

Sample data:

```text
customers                orders
id | name                id | customer_id | total
 1 | Asha                10 | 1           | 500
 2 | Ravi                11 | 1           | 300
 3 | Meera               12 | 2           | 900
                         13 | NULL        | 50     ← guest checkout
```

**INNER JOIN** — `customers c JOIN orders o ON o.customer_id = c.id`:

```text
Asha  10 500
Asha  11 300      ← Asha appears twice: two matches
Ravi  12 900
```

Meera (no orders) and order 13 (no customer) disappear.

**LEFT JOIN** — `customers c LEFT JOIN orders o ON o.customer_id = c.id`:

```text
Asha  10   500
Asha  11   300
Ravi  12   900
Meera NULL NULL   ← kept, padded with NULLs
```

**FULL JOIN** adds order 13 with a NULL customer as well. **CROSS JOIN** gives 3 × 4 = 12 rows.

::viz{id=sql-joins}

### ON vs WHERE in outer joins — the classic trap

```sql
-- Intent: all customers, with their PAID orders if any.
SELECT c.name, o.id
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid';           -- ✗ turns the LEFT JOIN into an INNER JOIN
```

`WHERE` runs after the join. For customers with no paid orders, `o.status` is NULL, `NULL = 'paid'` is UNKNOWN, and the row is dropped — Meera vanishes. Put conditions on the *optional* table in `ON`:

```sql
SELECT c.name, o.id
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid';   -- ✓
```

Rule: in a `LEFT JOIN`, conditions on the **right** table belong in `ON` (they decide what matches); conditions on the **left** table belong in `WHERE` (they decide which left rows appear at all).

### Self join: relationships within one table

```sql
-- Each employee with their manager's name
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id;

-- Employees who earn more than their manager
SELECT e.name
FROM employees e
JOIN employees m ON m.id = e.manager_id
WHERE e.salary > m.salary;
```

### Fan-out: why totals double

```sql
-- ✗ Wrong: orders.total is repeated once per item row
SELECT c.name, sum(o.total)
FROM customers c
JOIN orders o       ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id = o.id
GROUP BY c.name;
```

Fix by aggregating each one-to-many branch **before** joining, at its own grain:

```sql
SELECT c.name, o_sum.revenue, i_sum.items
FROM customers c
LEFT JOIN (SELECT customer_id, sum(total) AS revenue FROM orders GROUP BY customer_id) o_sum
       ON o_sum.customer_id = c.id
LEFT JOIN (SELECT o.customer_id, sum(oi.quantity) AS items
           FROM orders o JOIN order_items oi ON oi.order_id = o.id
           GROUP BY o.customer_id) i_sum
       ON i_sum.customer_id = c.id;
```

Joining two independent one-to-many tables to the same parent (customer → orders and customer → addresses) multiplies them against each other: 5 orders × 3 addresses = 15 rows per customer.

## Internal Mechanism

:::depth{level=advanced}
The logical definition (Cartesian product then filter) is never how a real engine executes a join. Physical join algorithms:

- **Nested loop**: for each outer row, look up matches in the inner input — fast when the outer side is small and the inner side has an index on the join key.
- **Hash join**: build a hash table on the smaller input's join key, probe it with each row of the larger input — O(n + m), equality conditions only.
- **Merge join**: both inputs sorted on the key, advance through them in step — great when indexes already supply sorted order.

The optimizer also chooses the **join order** for multi-table queries — with n tables there are exponentially many orders, so it uses dynamic programming for small n and heuristics/genetic search for large n ([Scans & Joins](lesson:db-scans-joins)).

Outer joins restrict reordering (A LEFT JOIN B LEFT JOIN C can't be freely rearranged), and a `WHERE` condition that rejects NULLs lets the optimizer *legally* convert an outer join into an inner join — precisely the ON/WHERE trap, seen from the optimizer's side.
:::

## Example

"Every product with the number of units sold in 2024, including products that sold nothing":

```sql
SELECT p.name, COALESCE(sum(oi.quantity), 0) AS units_2024
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
LEFT JOIN orders o
       ON o.id = oi.order_id
      AND o.order_date >= DATE '2024-01-01' AND o.order_date < DATE '2025-01-01'
GROUP BY p.id, p.name
ORDER BY units_2024 DESC;
```

This has a subtle bug: items from orders outside 2024 still join to `oi` (only `o` becomes NULL), so their quantities are counted. Filter at the item level instead:

```sql
SELECT p.name, COALESCE(sum(oi.quantity) FILTER (WHERE o.id IS NOT NULL), 0) AS units_2024
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
LEFT JOIN orders o ON o.id = oi.order_id
     AND o.order_date >= DATE '2024-01-01' AND o.order_date < DATE '2025-01-01'
GROUP BY p.id, p.name;
```

or pre-aggregate 2024 sales in a subquery (usually clearer). Try both in the [SQL Playground](lab:sql-playground).

## Complexity & Performance

- Hash join: O(n + m) time, O(smaller side) memory. Nested loop with an index: O(n log m). Nested loop without an index: O(n × m) — the disaster case.
- **Index the foreign-key columns you join on** (e.g., `orders.customer_id`); the referenced primary key is already indexed.
- Result size can exceed both inputs (fan-out); filter early and join at the right grain.

## Trade-offs

- Joins at read time (normalized) vs pre-joined, duplicated data (denormalized): joins keep one source of truth; denormalization avoids join cost for hot read paths at the price of keeping copies in sync.
- One big join vs several queries: a single join lets the optimizer pick algorithms and avoids round trips; ORMs issuing a query per row (N+1) are the opposite extreme ([Query Optimization](lesson:db-query-optimization)).

## Failure Modes

- **ON/WHERE confusion** silently converts LEFT JOIN to INNER JOIN.
- **Fan-out** double counting when aggregating across one-to-many joins.
- **Accidental Cartesian products** from a missing or wrong join condition (row counts explode, queries run for hours).
- **Joining on nullable columns** and expecting NULL to match NULL.
- **Type mismatches** (`text` vs `bigint`) that force casts and prevent index use.

## In Production

- The `rows` estimate on joins in EXPLAIN is where plans go wrong: if the planner thinks a join yields 10 rows but it yields 1 million, it chooses a nested loop that runs for minutes ([EXPLAIN](lesson:db-explain)).
- Sharded systems make cross-shard joins expensive; data that is joined frequently is co-located by shard key ([Sharding](lesson:db-sharding)).

## Deeper Connections

- Semi-joins (`EXISTS`) and anti-joins (`NOT EXISTS`) answer "does a match exist?" without multiplying rows ([Semi & Anti Joins](lesson:sql-semi-anti-joins)).
- Hash joins are hash tables; merge joins are the merge step of merge sort; nested loops with indexes are B+ tree lookups in a loop — data-structure knowledge applied.

## Common Misconceptions

- **"A join returns at most one row per left row."** It returns one row per *matching pair*.
- **"LEFT JOIN always returns every left row."** Only if no `WHERE` condition on the right table removes the NULL-padded rows.
- **"Joins are slow; avoid them."** Indexed joins are fast. Slow joins are missing indexes, bad estimates or fan-out.

## Interview Questions

### [L1 · compare] Explain INNER, LEFT, RIGHT and FULL OUTER joins.

INNER returns only pairs of rows satisfying the join condition. LEFT returns those plus every left row without a match, with NULLs for the right columns; RIGHT is the mirror image; FULL returns matched pairs plus unmatched rows from both sides.

### [L2 · trace] Table A has 3 rows with key 1, 1, 2. Table B has rows with key 1, 1, 1, 3. How many rows does A INNER JOIN B ON key return? And LEFT JOIN?

INNER: each of A's two key-1 rows matches B's three key-1 rows → 2 × 3 = 6; key 2 matches nothing → 6 rows. LEFT: the 6 matched rows plus A's unmatched key-2 row → 7 rows.

### [L2 · debugging] A LEFT JOIN query stopped returning customers who have no orders after someone added `WHERE o.status <> 'cancelled'`. Why?

For customers without orders, `o.status` is NULL; `NULL <> 'cancelled'` is UNKNOWN, so WHERE removes those rows — the LEFT JOIN now behaves like an INNER JOIN. Move the condition into the ON clause, or write `WHERE o.id IS NULL OR o.status <> 'cancelled'`, depending on the intended semantics.

### [L2 · sql] Find employees who earn more than their managers.

:::answer
```sql
SELECT e.name, e.salary, m.name AS manager, m.salary AS manager_salary
FROM employees e
JOIN employees m ON m.id = e.manager_id
WHERE e.salary > m.salary;
```

A self join with two aliases; the inner join excludes employees without a manager.
:::

### [L3 · debugging] A dashboard shows revenue per customer 2–4× higher than finance's numbers. The query joins customers, orders, order_items and shipments, then sums orders.total. Diagnose and fix.

Joining several one-to-many tables multiplies rows: each order appears once per (item × shipment) combination, so its total is summed repeatedly. Aggregate at the correct grain — compute revenue from `orders` alone (or from items as quantity × unit_price), aggregate each child table separately in subqueries/CTEs, then join the aggregates. Verify by comparing `count(*)` against `count(DISTINCT o.id)`.

## Practice

### [numeric 6] customers has 3 rows; orders has 5 rows: customer 1 has 3 orders, customer 2 has 2, customer 3 has none. How many rows does customers LEFT JOIN orders return?

:::answer
The 5 orders each pair with their customer (3 + 2 = 5 rows), and customer 3 appears once padded with NULLs: 5 + 1 = 6.
:::

### [mcq] You want all customers and, where present, their orders from 2024. Which is correct?

- [ ] `… LEFT JOIN orders o ON o.customer_id = c.id WHERE o.order_date >= '2024-01-01'`
- [x] `… LEFT JOIN orders o ON o.customer_id = c.id AND o.order_date >= '2024-01-01'`
- [ ] `… JOIN orders o ON o.customer_id = c.id AND o.order_date >= '2024-01-01'`
- [ ] `… RIGHT JOIN orders o ON o.customer_id = c.id WHERE o.order_date >= '2024-01-01'`

Conditions on the optional side of a LEFT JOIN go in ON; in WHERE they discard the NULL-padded customers.

## Quick Revision

- Join = pair rows where ON is true; outer joins add unmatched rows padded with NULL.
- Rows multiply: 1 customer × 5 orders = 5 rows. Aggregate at the right grain before joining.
- LEFT JOIN: right-table conditions in ON, left-table conditions in WHERE.
- Self join for hierarchies/comparisons within a table. Avoid NATURAL JOIN.
- Physical algorithms: nested loop (+index), hash, merge. Index FK join columns.
