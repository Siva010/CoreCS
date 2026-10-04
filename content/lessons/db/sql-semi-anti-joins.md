---
title: "Semi Joins and Anti Joins: EXISTS, IN, NOT EXISTS"
subject: db
level: 3
order: 2
summary: "Asking 'is there a match?' instead of 'give me the matches': EXISTS and IN as semi joins, NOT EXISTS / LEFT JOIN … IS NULL as anti joins, the NOT IN null trap, and how the optimizer executes them."
depth: core
difficulty: 3
minutes: 30
relevance: essential
stage: 1
prerequisites: [sql-joins, sql-null-logic]
related: [sql-subqueries-ctes, sql-interview-patterns, db-scans-joins, db-query-optimization]
labs: [sql-playground]
tags: [semi join, anti join, exists, not exists, in, not in, left join is null, correlated subquery, except, duplicates]
---

## Mental Model

A regular join answers **"pair me with every match"** — and multiplies rows. Often you only want to know **whether** a match exists:

- **Semi join**: rows of A that have *at least one* match in B. Each A row appears **once**, no matter how many matches. (`EXISTS`, `IN`)
- **Anti join**: rows of A that have *no* match in B. (`NOT EXISTS`, `LEFT JOIN … WHERE b.key IS NULL`, `NOT IN` with care)

Neither returns columns from B. They're filters on A.

## Definition

```sql
-- Semi join: customers who have placed at least one order
SELECT c.* FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);

SELECT c.* FROM customers c
WHERE c.id IN (SELECT customer_id FROM orders);

-- Anti join: customers who have never ordered
SELECT c.* FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);

SELECT c.* FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;
```

`EXISTS (subquery)` is TRUE if the subquery returns any row; the select list inside is irrelevant (`SELECT 1` is convention).

## Why It Exists

**The problem.** Many questions are yes/no about related rows: "customers who *have* ordered", "products *never* sold". A regular join answers a different question — "pair each customer with each order".

**Without it.** Using an inner join for "customers who ordered" returns each customer once per order; adding `DISTINCT` to fix it forces a sort/hash over the whole result.

**The idea.** Ask the question you actually mean: "does at least one match exist?" A semi join states the real question, so the database can **stop at the first match** per row and never produces duplicates. An anti join is the same question with the answer flipped.

:::callout[That's all it is]{type=insight}
Semi join = keep A rows that have a match in B (EXISTS). Anti join = keep A rows that have no match (NOT EXISTS). Neither adds B's columns or duplicates A's rows. Avoid NOT IN when the subquery can contain NULLs.
:::

## How It Works

### Semi join: JOIN + DISTINCT vs EXISTS

```sql
-- Works, but produces one row per order, then deduplicates
SELECT DISTINCT c.id, c.name FROM customers c JOIN orders o ON o.customer_id = c.id;

-- States the intent; stops at the first matching order
SELECT c.id, c.name FROM customers c
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

`DISTINCT` also collapses genuinely distinct customers who happen to share all selected column values; `EXISTS` never does.

### Anti join: three ways, one trap

| Form | NULL-safe? | Notes |
|---|---|---|
| `NOT EXISTS (correlated subquery)` | ✔ | Clearest intent; planner turns it into a hash/merge anti join |
| `LEFT JOIN … WHERE b.pk IS NULL` | ✔ | Test a column that can't be NULL in a real match (the PK or join key) |
| `NOT IN (subquery)` | ✘ | If the subquery yields any NULL, **no rows** are returned |

The `NOT IN` trap in one line: `3 NOT IN (1, 2, NULL)` → `3<>1 AND 3<>2 AND 3<>NULL` → `TRUE AND TRUE AND UNKNOWN` → UNKNOWN → row filtered out ([NULL Logic](lesson:sql-null-logic)).

`IN` has no such trap: `3 IN (3, NULL)` is TRUE because `OR` with a TRUE term is TRUE. (But `4 IN (3, NULL)` is UNKNOWN rather than FALSE — harmless in `WHERE`, surprising in `SELECT` output.)

### Correlated subqueries

`EXISTS` subqueries are usually **correlated**: they reference the outer row (`o.customer_id = c.id`). Logically, the subquery is evaluated per outer row. Physically, the optimizer rewrites it into a join-like operator — so correlated `EXISTS` is not "slow by definition".

### Set-based alternative

```sql
SELECT id FROM customers
EXCEPT
SELECT customer_id FROM orders;
```

`EXCEPT` compares whole rows and treats NULLs as equal, removing duplicates. Handy for IDs, less so when you need other columns ([Set Operations](lesson:sql-set-operations)).

## Internal Mechanism

:::depth{level=advanced}
PostgreSQL's planner converts `EXISTS`/`IN` into **Semi Join** nodes and `NOT EXISTS` into **Anti Join** nodes, using the same physical algorithms as joins:

- **Hash Semi/Anti Join**: build a hash table on the subquery's join keys; probe with each outer row; emit (semi) or suppress (anti) on the first hit.
- **Nested Loop Semi Join** with an index on `orders.customer_id`: one index probe per customer, stopping at the first entry.
- **Merge Semi/Anti Join** when both inputs are sorted.

`NOT IN (subquery)` usually **can't** be converted into an anti join because its NULL semantics differ; PostgreSQL executes it as a "hashed SubPlan" (fine when the subquery fits in memory) or, worse, re-scans the subquery per outer row. That — besides correctness — is why `NOT EXISTS` is the recommended form.

Older MySQL versions executed `IN (subquery)` as a dependent subquery per outer row; modern MySQL (5.6+/8.0) also uses semi-join strategies (materialization, first-match, loose scan).
:::

## Example

"Products that have never been ordered by any customer from Pune":

```sql
SELECT p.id, p.name
FROM products p
WHERE NOT EXISTS (
  SELECT 1
  FROM order_items oi
  JOIN orders o     ON o.id = oi.order_id
  JOIN customers c  ON c.id = o.customer_id
  WHERE oi.product_id = p.id
    AND c.city = 'Pune'
);
```

The correlated condition `oi.product_id = p.id` links each product to the subquery; everything else is ordinary filtering inside it.

## Complexity & Performance

- Hash semi/anti join: O(n + m). Nested-loop semi join with an index: O(n log m), stopping at the first match.
- `JOIN + DISTINCT` materializes all matches, then deduplicates — more work than a semi join, especially with many matches per row.
- Index the correlated column (`orders.customer_id`) — it serves both nested-loop probes and FK checks.

## Trade-offs

- `NOT EXISTS` vs `LEFT JOIN … IS NULL`: equivalent results and usually identical plans in modern optimizers; `NOT EXISTS` states intent more clearly and can't be broken by a join that multiplies rows.
- `IN (list of literals)` is fine for short lists; for thousands of IDs, pass an array (`= ANY($1)`) or join to a temporary table/`VALUES` list.

## Failure Modes

- **`NOT IN` over a nullable column** — correct for years until one NULL appears, then the query returns nothing.
- **Testing a nullable column in the LEFT JOIN anti pattern** — `WHERE o.coupon_code IS NULL` also matches real orders without coupons. Test the key.
- **`JOIN` where `EXISTS` was meant** — duplicate rows, "fixed" with DISTINCT, masking the error.

## In Production

- "Find records with no related records" (users without profiles, orders without payments) is a routine data-quality and cleanup query; use `NOT EXISTS` and run it in batches on large tables.
- Anti joins against a large table without an index on the correlated column can trigger huge hash builds; EXPLAIN will show it.

## Deeper Connections

- A semi join is a join whose output has the left table's cardinality — which is why it composes safely with aggregation, unlike an inner join ([Aggregation](lesson:sql-aggregation)).
- Semi-join reduction is used in distributed databases: send only the join keys to the other node, filter there, return matches — cutting network traffic ([Distributed SQL](lesson:db-distributed-sql)).

## Common Misconceptions

- **"EXISTS is slow because it runs the subquery for each row."** Modern optimizers convert it to a semi join.
- **"NOT IN and NOT EXISTS are interchangeable."** Only when the subquery can't produce NULL.
- **"SELECT * inside EXISTS is wasteful."** The select list is ignored; `SELECT 1` is just convention.

## Interview Questions

### [L2 · compare] What's the difference between IN and EXISTS? Between NOT IN and NOT EXISTS?

`IN` compares a value against the set of values a subquery returns; `EXISTS` tests whether a (usually correlated) subquery returns any row. For positive checks they're usually planned identically as semi joins. The negations differ: `NOT IN` returns no rows if the subquery produces any NULL (three-valued logic), while `NOT EXISTS` is unaffected by NULLs and plans as an anti join. Prefer `NOT EXISTS`.

### [L2 · sql] Find customers who have never placed an order.

:::answer
```sql
SELECT c.id, c.name
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

Equivalent: `LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL`. Avoid `NOT IN (SELECT customer_id FROM orders)` — guest orders with NULL customer_id would make it return nothing.
:::

### [L2 · why] Why is `SELECT DISTINCT c.* FROM customers c JOIN orders o …` a worse way to find customers with orders than EXISTS?

The join produces one row per order (possibly millions), then DISTINCT sorts or hashes them to remove duplicates. EXISTS is a semi join: each customer is emitted once and matching can stop at the first order. DISTINCT can also merge genuinely distinct rows that share the selected values.

### [L3 · sql] Find customers who bought every product in the 'Books' category (relational division).

:::answer
"No Books product exists that the customer hasn't bought" — a double anti join:

```sql
SELECT c.id, c.name
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.category = 'Books'
    AND NOT EXISTS (
      SELECT 1 FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.customer_id = c.id AND oi.product_id = p.id));
```

Counting alternative: group each customer's distinct Books products and compare with the total number of Books products:

```sql
SELECT o.customer_id
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id AND p.category = 'Books'
GROUP BY o.customer_id
HAVING count(DISTINCT p.id) = (SELECT count(*) FROM products WHERE category = 'Books');
```
:::

## Practice

### [mcq] orders.customer_id contains some NULLs. What does `SELECT count(*) FROM customers WHERE id NOT IN (SELECT customer_id FROM orders)` return?

- [ ] The number of customers without orders
- [x] 0
- [ ] An error
- [ ] The number of customers

Any NULL in the NOT IN list makes the predicate UNKNOWN for every row.

### [mcq] Which anti-join is WRONG if orders.coupon_code is nullable?

- [ ] `WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)`
- [ ] `LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL`
- [x] `LEFT JOIN orders o ON o.customer_id = c.id WHERE o.coupon_code IS NULL`
- [ ] `WHERE c.id NOT IN (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL)`

Testing a nullable column also matches customers whose real orders lack a coupon.

## Quick Revision

- Semi join = "has a match" (EXISTS/IN), anti join = "has no match" (NOT EXISTS / LEFT JOIN … key IS NULL).
- They never multiply rows — prefer them to JOIN + DISTINCT.
- NOT IN + NULL → empty result. Use NOT EXISTS.
- Optimizers plan EXISTS/NOT EXISTS as hash/merge/nested-loop semi/anti joins; index the correlated column.
- Relational division ("bought all") = double NOT EXISTS or count comparison.
