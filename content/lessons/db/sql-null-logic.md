---
title: "NULL and Three-Valued Logic"
subject: db
level: 2
order: 2
summary: "Why NULL = NULL is not true, how TRUE/FALSE/UNKNOWN propagate through WHERE, NOT IN, aggregates, joins and constraints — the source of more wrong SQL answers than any other feature."
depth: core
difficulty: 2
minutes: 30
relevance: essential
stage: 1
prerequisites: [sql-select-basics]
related: [sql-aggregation, sql-semi-anti-joins, sql-joins, db-keys-constraints, sql-interview-patterns]
labs: [sql-playground]
tags: [null, three-valued logic, unknown, is null, coalesce, nullif, not in null trap, count star vs count column, is distinct from, null ordering]
---

## Mental Model

`NULL` means **"unknown / missing"**, not zero, not empty string. Any comparison with an unknown value has an unknown result: is an unknown salary greater than 50,000? Unknown. Is it equal to another unknown salary? Also unknown.

SQL therefore uses **three truth values**: TRUE, FALSE and UNKNOWN. The one rule that matters most:

> **`WHERE` (and `ON`, and `HAVING`) keep a row only if the condition is TRUE.** FALSE and UNKNOWN are both discarded.

## Definition

Truth tables (U = UNKNOWN):

| AND | T | F | U |
|---|---|---|---|
| **T** | T | F | U |
| **F** | F | F | F |
| **U** | U | F | U |

| OR | T | F | U |
|---|---|---|---|
| **T** | T | T | T |
| **F** | T | F | U |
| **U** | T | U | U |

`NOT U = U`. Intuition: FALSE AND anything is FALSE; TRUE OR anything is TRUE; otherwise unknown stays unknown.

Tools:

- `x IS NULL`, `x IS NOT NULL` — the only correct null tests.
- `COALESCE(a, b, c)` — first non-null argument.
- `NULLIF(a, b)` — NULL if a = b, else a (classic use: avoid division by zero, `x / NULLIF(y, 0)`).
- `a IS DISTINCT FROM b` — null-safe inequality (NULL vs NULL → not distinct). MySQL: `<=>` for null-safe equality.

## Why It Exists

Real data has gaps: a customer without a phone, an employee without a manager, an order not yet shipped. Codd introduced NULL so that missing information wouldn't be encoded as fake values like `0` or `'N/A'` that silently corrupt averages and comparisons. The cost is three-valued logic, which surprises nearly everyone.

## How It Works

### Comparisons

```sql
SELECT NULL = NULL;        -- NULL (unknown), not true
SELECT NULL <> 1;          -- NULL
SELECT 1 + NULL;           -- NULL: arithmetic propagates
SELECT 'a' || NULL;        -- NULL in PostgreSQL (use concat() to skip NULLs)
SELECT NULL IS NULL;       -- true
```

So `WHERE manager_id = NULL` returns **no rows, ever**. Write `WHERE manager_id IS NULL`.

### Negation doesn't partition the table

For a column containing NULLs:

```sql
SELECT count(*) FROM employees WHERE salary > 50000;       -- say 40
SELECT count(*) FROM employees WHERE NOT (salary > 50000); -- say 55
SELECT count(*) FROM employees;                             -- 100 — five rows are in neither!
```

Rows with NULL salary evaluate to UNKNOWN in both queries.

### The NOT IN trap

```sql
-- Customers who never placed an order?
SELECT name FROM customers
WHERE id NOT IN (SELECT customer_id FROM orders);
```

If **any** `orders.customer_id` is NULL, this returns **zero rows**. `x NOT IN (1, 2, NULL)` means `x <> 1 AND x <> 2 AND x <> NULL`, and the last term is UNKNOWN, so the whole condition is never TRUE. Use `NOT EXISTS`, which only asks "is there a matching row?" and is unaffected by NULLs ([Semi & Anti Joins](lesson:sql-semi-anti-joins)):

```sql
SELECT c.name FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);
```

### Aggregates ignore NULLs

| Expression | Counts / uses |
|---|---|
| `COUNT(*)` | all rows |
| `COUNT(col)` | rows where col is not NULL |
| `SUM`, `AVG`, `MIN`, `MAX` | non-NULL values only |
| `SUM` over zero non-NULL values | NULL (not 0) — wrap in `COALESCE(SUM(x), 0)` |

`AVG(bonus)` averages only employees who *have* a bonus; `AVG(COALESCE(bonus, 0))` averages over everyone. These answer different questions — choose deliberately.

### Where NULLs *are* treated as equal

- `GROUP BY` puts all NULLs in one group.
- `DISTINCT` and `UNION` treat NULLs as duplicates of each other.
- `UNIQUE` constraints usually do **not** (many NULLs allowed) ([Keys & Constraints](lesson:db-keys-constraints)).
- Join conditions `a.x = b.x` never match NULL to NULL.

## Internal Mechanism

:::depth{level=advanced}
### How NULL is stored

Rows carry a **null bitmap**: one bit per column marking NULL; the value itself takes no space. In PostgreSQL the bitmap is only present when the row has at least one NULL. So NULL is usually cheaper to store than a placeholder value.

### Indexes and NULL

B+ tree indexes in PostgreSQL store NULL entries, so `IS NULL` can use an index; Oracle's single-column B-tree indexes don't store all-NULL keys. `NOT IN` with a nullable subquery also prevents the planner from converting it into an efficient anti-join, one more reason to prefer `NOT EXISTS`.
:::

## Example

"Employees with their manager's name; show '—' for the CEO":

```sql
SELECT e.name, COALESCE(m.name, '—') AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id;
```

The CEO's `manager_id` is NULL; the join condition is UNKNOWN, so the LEFT JOIN keeps the row with `m.*` NULL; `COALESCE` supplies the label.

## Complexity & Performance

NULL handling costs nothing at run time; the cost is correctness. The performance angle is plan quality: `NOT IN` over a nullable column blocks anti-join optimization, and `OR col IS NULL` conditions can prevent index use.

## Trade-offs

- NULL vs sentinel values (`0`, `''`, `'1970-01-01'`): sentinels avoid three-valued logic but pollute aggregates and are ambiguous. Prefer NULL plus `NOT NULL` wherever a value is genuinely required.
- Nullable columns are flexible; `NOT NULL` + defaults make queries simpler and bugs rarer. Default to `NOT NULL` and relax deliberately.

## Failure Modes

- `= NULL` comparisons that silently match nothing.
- `NOT IN (subquery)` returning empty results once a NULL appears in the subquery's data — often months after the query was written.
- Averages that ignore NULLs when the business meant "treat missing as zero" (or vice versa).
- String concatenation yielding NULL for the whole value because one part is NULL.

## In Production

- Reports that "lost" rows after a schema change often trace to a newly nullable column participating in a `WHERE`, `NOT IN` or join.
- Application languages map NULL to `null`/`None`; code that doesn't expect it throws at runtime. Constraints at the schema level (`NOT NULL`) prevent a whole class of errors in every consumer.

## Deeper Connections

- The same "unknown is not false" behavior appears in `CHECK` constraints: a `CHECK (price > 0)` **passes** when price is NULL, because only FALSE violates a check.
- Outer joins manufacture NULLs for missing matches — the source of NULLs you never inserted ([Joins](lesson:sql-joins)).

## Common Misconceptions

- **"NULL = NULL is true."** It's UNKNOWN.
- **"COUNT(col) counts rows."** It counts non-NULL values.
- **"A CHECK constraint rejects NULL."** It rejects only FALSE; add `NOT NULL` to forbid NULL.

## Interview Questions

### [L1 · conceptual] Why does `WHERE col = NULL` return no rows?

Comparing anything with NULL yields UNKNOWN, and WHERE keeps only rows where the condition is TRUE. Use `col IS NULL`.

### [L2 · debugging] `SELECT * FROM a WHERE id NOT IN (SELECT a_id FROM b)` returns nothing, though you know some rows of `a` have no match in `b`. Why?

`b.a_id` contains at least one NULL. `NOT IN` expands to a conjunction of `<>` comparisons; the comparison with NULL is UNKNOWN, so the whole predicate is never TRUE. Use `NOT EXISTS (SELECT 1 FROM b WHERE b.a_id = a.id)` or filter NULLs out of the subquery.

### [L1 · compare] COUNT(*) vs COUNT(column) vs COUNT(DISTINCT column)?

COUNT(*) counts rows. COUNT(column) counts rows where the column is non-NULL. COUNT(DISTINCT column) counts distinct non-NULL values.

### [L2 · trace] A table has salaries 100, 200, NULL. What do SUM, AVG, COUNT(*), COUNT(salary) return?

SUM = 300, AVG = 150 (300 / 2 non-NULL values), COUNT(*) = 3, COUNT(salary) = 2.

## Practice

### [numeric 150] Salaries are 100, 200 and NULL. What does AVG(salary) return?

:::answer
AVG ignores NULLs: (100 + 200) / 2 = 150. `AVG(COALESCE(salary, 0))` would be 100.
:::

### [mcq] What is the value of `NULL OR TRUE`?

- [x] TRUE
- [ ] FALSE
- [ ] NULL (UNKNOWN)
- [ ] An error

TRUE OR anything is TRUE, whatever the unknown value is.

### [mcq] Which predicate is true when both a and b are NULL?

- [ ] `a = b`
- [ ] `a <> b`
- [x] `a IS NOT DISTINCT FROM b`
- [ ] `NOT (a <> b)`

Only the null-safe comparison treats two NULLs as equal; the others evaluate to UNKNOWN.

## Quick Revision

- NULL = unknown → comparisons give UNKNOWN; WHERE/ON/HAVING keep only TRUE.
- `IS NULL`, `COALESCE`, `NULLIF`, `IS DISTINCT FROM`.
- `NOT IN` + a NULL in the list → no rows. Prefer `NOT EXISTS`.
- Aggregates skip NULLs; `COUNT(*)` counts rows; `SUM` of nothing is NULL.
- GROUP BY/DISTINCT group NULLs together; joins and UNIQUE don't equate them. CHECK passes on NULL.
