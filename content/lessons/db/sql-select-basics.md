---
title: "SELECT Fundamentals and the Logical Order of a Query"
subject: db
level: 2
order: 1
summary: "SELECT, WHERE, ORDER BY, LIMIT, DISTINCT, CASE and pattern matching — organized around the one idea that explains most SQL errors: the order in which clauses are logically evaluated."
depth: beginner
difficulty: 1
minutes: 35
relevance: essential
stage: 1
prerequisites: [db-relational-model]
related: [sql-null-logic, sql-aggregation, sql-joins, db-index-fundamentals, db-query-lifecycle]
labs: [sql-playground]
tags: [sql, select, where, order by, limit, offset, distinct, case, like, in, between, alias, logical query processing order, sargable]
---

## Mental Model

A SQL query *reads* top-down but is **evaluated in a different order**:

```text
FROM / JOIN   → which rows exist (build the working table)
WHERE         → keep rows that match
GROUP BY      → collapse rows into groups
HAVING        → keep groups that match
SELECT        → compute output columns (and aliases)
DISTINCT      → remove duplicate output rows
ORDER BY      → sort
LIMIT/OFFSET  → cut
```

Almost every beginner error — "column alias doesn't exist in WHERE", "must appear in GROUP BY", "can't use aggregate in WHERE" — is a consequence of this order. Learn the order, and those errors become predictable.

## Definition

- `SELECT` lists output expressions; `FROM` names the source; `WHERE` filters rows with a boolean condition.
- `ORDER BY` sorts (ASC default); without it **row order is undefined**.
- `LIMIT n OFFSET m` (PostgreSQL/MySQL/SQLite) or `FETCH FIRST n ROWS ONLY` (standard) restricts output.
- `DISTINCT` removes duplicate *output rows* (over all selected columns).
- `CASE WHEN … THEN … ELSE … END` is SQL's conditional expression.

## Why It Exists

SQL was designed to read like an English request ("select name from customers where city is Pune") while compiling to relational algebra. The price of that readability is the mismatch between written and evaluated order — which is exactly why you must know the evaluation order explicitly.

## How It Works

Using the playground schema (`customers`, `orders`, `employees`, …):

```sql
SELECT id, name, city
FROM customers
WHERE city IN ('Pune', 'Mumbai')
  AND created_at >= DATE '2024-01-01'
ORDER BY created_at DESC, id
LIMIT 10;
```

### Filtering toolbox

| Predicate | Meaning | Notes |
|---|---|---|
| `=, <>, <, <=, >, >=` | comparison | `<>` is standard; `!=` widely supported |
| `BETWEEN a AND b` | `>= a AND <= b` | **inclusive at both ends** — careful with timestamps |
| `IN (…)` | equals any listed value | `NOT IN` + NULL is a trap ([NULL Logic](lesson:sql-null-logic)) |
| `LIKE 'Pu%'`, `'_b%'` | pattern: `%` any string, `_` one char | `ILIKE` is case-insensitive (PostgreSQL) |
| `IS NULL`, `IS NOT NULL` | null test | `= NULL` is never true |

### The alias rule, explained by the order

```sql
-- ERROR: column "yearly" does not exist
SELECT salary * 12 AS yearly FROM employees WHERE yearly > 1000000;
```

`WHERE` runs before `SELECT`, so the alias doesn't exist yet. Repeat the expression, or wrap it:

```sql
SELECT * FROM (SELECT name, salary * 12 AS yearly FROM employees) e
WHERE yearly > 1000000;
```

`ORDER BY` runs *after* `SELECT`, so `ORDER BY yearly` works.

### CASE: computed categories

```sql
SELECT name, salary,
       CASE WHEN salary >= 150000 THEN 'senior band'
            WHEN salary >= 80000  THEN 'mid band'
            ELSE 'junior band' END AS band
FROM employees
ORDER BY salary DESC;
```

`CASE` returns the first matching branch; without `ELSE` it returns NULL.

### Sorting details

- Sort by several keys: `ORDER BY department_id, salary DESC`.
- NULLs sort **last in ascending order in PostgreSQL and first in MySQL**; control with `NULLS FIRST/LAST`.
- **Pagination needs a unique tiebreaker**: `ORDER BY created_at DESC, id DESC`. Without it, rows with equal timestamps can appear on two pages or none.

## Internal Mechanism

:::depth{level=advanced}
### Logical order ≠ physical order

The evaluation order above is *logical* — it defines the result. The optimizer may execute things differently as long as the result is the same: it pushes filters into scans, uses an index that returns rows already sorted (so no sort step), or stops early for `ORDER BY … LIMIT 10` using a top-N heap instead of sorting everything ([Scans & Joins](lesson:db-scans-joins)).

### Sargable predicates

A predicate is **sargable** (Search ARGument-able) if an index can be used to evaluate it: `created_at >= '2024-01-01'` is; `date_part('year', created_at) = 2024` is not (the function hides the column), and neither is `name LIKE '%sha'` (no fixed prefix). Rewrite as a range on the bare column, or index the expression ([Index Design](lesson:db-index-design-practice)).

### OFFSET cost

`OFFSET 100000` still produces and discards 100,000 rows. For deep pagination use **keyset (seek) pagination**: `WHERE (created_at, id) < ($last_created_at, $last_id) ORDER BY created_at DESC, id DESC LIMIT 20` — each page is an index range scan.
:::

## Example

"The 5 most recent paid orders over ₹2,000, newest first, showing a size label":

```sql
SELECT id, customer_id, order_date, total,
       CASE WHEN total >= 10000 THEN 'large' ELSE 'regular' END AS size
FROM orders
WHERE status = 'paid' AND total > 2000
ORDER BY order_date DESC, id DESC
LIMIT 5;
```

Try it in the [SQL Playground](lab:sql-playground), then remove the `id DESC` tiebreaker and think about what could go wrong with paging.

## Complexity & Performance

- Without a usable index, `WHERE` means scanning every row: O(n).
- `ORDER BY` without a matching index costs O(n log n) (spilling to disk when it exceeds `work_mem`); with `LIMIT k` the database can use a top-k heap, O(n log k).
- `SELECT *` fetches every column — more I/O, more network, and it defeats index-only scans ([Covering Indexes](lesson:db-composite-covering-indexes)).

## Trade-offs

- `DISTINCT` fixes duplicate rows but costs a sort or hash over the whole result — and often hides a join that multiplies rows unintentionally. Fix the join rather than papering over it.
- `OFFSET` pagination is simple and supports "jump to page 50"; keyset pagination is fast at any depth but only supports next/previous.

## Failure Modes

- **Relying on implicit order** — results change after a plan change.
- **`BETWEEN` with timestamps**: `BETWEEN '2024-01-01' AND '2024-01-31'` misses everything after midnight on the 31st. Use half-open ranges: `>= '2024-01-01' AND < '2024-02-01'`.
- **Functions on indexed columns** in `WHERE` → full scans.
- **Operator precedence**: `a OR b AND c` means `a OR (b AND c)`. Parenthesize.

## In Production

- ORMs generate `SELECT` statements; performance problems usually come from what they generate (N+1 queries, `SELECT *`, `OFFSET` pagination). Always be able to see and read the SQL they emit.
- Parameterize queries (`WHERE email = $1`) — never concatenate user input into SQL (SQL injection), and parameters let the database reuse plans.

## Deeper Connections

- Filters and sorts become scan and sort operators in the plan ([EXPLAIN](lesson:db-explain)).
- `ORDER BY … LIMIT` is where indexes shine twice: finding and ordering ([Composite Indexes](lesson:db-composite-covering-indexes)).

## Common Misconceptions

- **"SQL executes top to bottom."** Logically, FROM comes first and SELECT late.
- **"Rows come back in primary-key order."** Only if a plan happens to produce them that way.
- **"DISTINCT applies to the first column."** It applies to the entire output row.

## Interview Questions

### [L1 · trace] In what logical order are the clauses of a SELECT statement evaluated?

FROM (and JOINs), WHERE, GROUP BY, HAVING, SELECT (including window functions), DISTINCT, ORDER BY, LIMIT/OFFSET. Consequences: SELECT aliases can't be used in WHERE/GROUP BY (standard SQL; some databases relax GROUP BY), aggregates can't appear in WHERE, and ORDER BY can use aliases.

### [L1 · why] Why can't you use a column alias defined in SELECT inside WHERE?

WHERE is evaluated before SELECT, so the alias doesn't exist yet. Repeat the expression, use a subquery/CTE that defines it, or (PostgreSQL) a LATERAL subquery.

### [L2 · debugging] A paginated API sometimes shows the same item on two consecutive pages. Why?

The ORDER BY isn't deterministic — for example ordering only by `created_at` when several rows share a timestamp. Rows with equal sort keys may come back in different orders on each query, so page boundaries shift. Add a unique tiebreaker (`ORDER BY created_at DESC, id DESC`); for deep pages use keyset pagination, which also avoids items shifting when new rows are inserted.

### [L2 · optimization] Why is `WHERE date(created_at) = '2024-03-01'` slow on a large table with an index on created_at, and how do you fix it?

Applying a function to the column makes the predicate non-sargable: the index is ordered by `created_at`, not by `date(created_at)`, so the database must scan all rows. Rewrite as a half-open range on the bare column: `created_at >= '2024-03-01' AND created_at < '2024-03-02'`, or create an expression index on `date(created_at)` if that form is required.

## Practice

### [mcq] Which query fails?

- [ ] `SELECT salary * 12 AS yearly FROM employees ORDER BY yearly;`
- [x] `SELECT salary * 12 AS yearly FROM employees WHERE yearly > 100000;`
- [ ] `SELECT name FROM employees ORDER BY salary DESC LIMIT 3;`
- [ ] `SELECT DISTINCT department_id FROM employees;`

WHERE is evaluated before SELECT defines the alias; ORDER BY comes after.

### [exercise] Using `employees(id, name, department_id, manager_id, salary, hired_at)`, list names and salaries of employees hired in 2023 (any time that year), highest paid first, ties broken by name.

:::solution
```sql
SELECT name, salary
FROM employees
WHERE hired_at >= DATE '2023-01-01'
  AND hired_at <  DATE '2024-01-01'
ORDER BY salary DESC, name;
```

The half-open range works for both `date` and `timestamp` columns and remains sargable.
:::

## Quick Revision

- Logical order: FROM → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT.
- No ORDER BY → no guaranteed order. Paginate with a unique tiebreaker; keyset beats deep OFFSET.
- Half-open ranges for time; `BETWEEN` is inclusive.
- Keep predicates sargable: no functions on indexed columns, no leading `%`.
- DISTINCT is over the whole row and often hides a bad join.
