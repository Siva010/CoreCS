---
title: "SQL Interview Patterns: The Dozen Problems Behind Most Questions"
subject: db
level: 4
order: 4
summary: "Nth highest, duplicates, top-N per group, never/always, gaps and islands, running totals, period-over-period, pivots, medians, cohorts and hierarchies — how to recognize each pattern and the robust solution for it."
depth: core
difficulty: 3
minutes: 60
relevance: essential
stage: 1
prerequisites: [sql-window-functions, sql-subqueries-ctes, sql-semi-anti-joins]
related: [sql-aggregation, sql-joins, sql-null-logic, sql-set-operations, db-query-optimization]
labs: [sql-playground]
tags: [sql interview, nth highest salary, duplicates, delete duplicates, top n per group, gaps and islands, consecutive days, running total, month over month, pivot, median, percentile, cohort, retention, relational division]
---

## Mental Model

SQL interview questions look endless but reduce to about a dozen **patterns**. The skill is recognition: read the question, name the pattern, then apply the known-correct shape — and check the edge cases (ties, NULLs, empty groups, duplicates) that interviewers deliberately plant.

A reliable way to work through any SQL question:

1. **Grain**: what does one output row represent? (one customer? one customer-month?)
2. **Sources**: which tables, and at what grain are they? Watch for one-to-many joins that multiply rows.
3. **Pattern**: filter → group → rank → compare?
4. **Edge cases**: ties, NULLs, missing rows (months with no sales), duplicates.
5. **Write it in steps** with CTEs, then check each step.

Schema used below: `employees(id, name, department_id, manager_id, salary, hired_at)`, `departments(id, name)`, `customers(id, name, city, created_at)`, `orders(id, customer_id, order_date, status, total)`, `order_items(order_id, product_id, quantity, unit_price)`, `products(id, name, category, price)`, `logins(user_id, login_date)`. All runnable in the [SQL Playground](lab:sql-playground).

## Definition

| # | Pattern | Recognition cue | Core tool |
|---|---|---|---|
| 1 | Nth highest | "second/Nth highest", "excluding the max" | `DENSE_RANK`, `OFFSET`, `max < max` |
| 2 | Duplicates | "duplicate emails", "delete duplicates keeping one" | `GROUP BY … HAVING count(*) > 1`, `row_number` |
| 3 | Top-N per group | "top 3 per department", "latest per customer" | `row_number`/`dense_rank` + filter, LATERAL |
| 4 | Never / not in | "customers who never…", "products not sold" | `NOT EXISTS` |
| 5 | All / every | "bought every product in…" | double `NOT EXISTS` or count compare |
| 6 | Gaps & islands | "consecutive days", "streak", "sessions" | `row_number` difference, `lag` + running sum |
| 7 | Running totals | "cumulative", "running balance" | `sum() OVER (ORDER BY … ROWS …)` |
| 8 | Period over period | "month-over-month", "compared to previous" | `lag()` over a pre-aggregated series |
| 9 | Pivot | "one column per status/month" | conditional aggregation |
| 10 | Median / percentile | "median salary", "p95 latency" | `percentile_cont` |
| 11 | Cohorts / retention | "customers who returned the next month" | first-event CTE + join |
| 12 | Hierarchy | "all reports under", "chain of command" | self join, recursive CTE |

## Why It Exists

Interviewers use SQL problems to test whether you can think in sets and handle edge cases, not whether you remember syntax. Knowing the patterns frees your attention for the edge cases — which is where most candidates lose points.

## How It Works

### 1. Nth highest salary

```sql
-- Robust: handles ties (distinct salary values) and returns NULL if there is no Nth value
SELECT max(salary) AS nth_highest
FROM (SELECT salary, dense_rank() OVER (ORDER BY salary DESC) AS r FROM employees) t
WHERE r = 2;
```

Alternatives: `SELECT DISTINCT salary FROM employees ORDER BY salary DESC OFFSET 1 LIMIT 1` (returns no row rather than NULL when absent); `SELECT max(salary) FROM employees WHERE salary < (SELECT max(salary) FROM employees)` (second highest only). The `max(...)` wrapper turns "no rows" into a single NULL row — some graders expect exactly that.

### 2. Duplicates: find and delete

```sql
-- Find emails used by more than one customer
SELECT lower(email) AS email, count(*) FROM customers
GROUP BY lower(email) HAVING count(*) > 1;

-- Delete duplicates, keeping the lowest id per email
DELETE FROM customers c
USING (SELECT id, row_number() OVER (PARTITION BY lower(email) ORDER BY id) AS rn
       FROM customers) d
WHERE c.id = d.id AND d.rn > 1;
```

Then add `UNIQUE (lower(email))` (a unique expression index) so it can't happen again. In an interview, mention checking foreign keys that reference the rows you delete.

### 3. Top-N per group

```sql
SELECT department_id, name, salary
FROM (SELECT e.*, row_number() OVER (PARTITION BY department_id ORDER BY salary DESC, id) AS rn
      FROM employees e) t
WHERE rn <= 3;
```

Ask: should ties be included? (`dense_rank`/`rank` include them; `row_number` returns exactly N.) "Latest order per customer" is top-1 per group: `DISTINCT ON (customer_id) … ORDER BY customer_id, order_date DESC` in PostgreSQL.

### 4. Never / 5. Every

```sql
-- Never ordered
SELECT c.* FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);

-- Ordered from every category
SELECT o.customer_id
FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
GROUP BY o.customer_id
HAVING count(DISTINCT p.category) = (SELECT count(DISTINCT category) FROM products);
```

Never use `NOT IN` against a nullable column ([Semi & Anti Joins](lesson:sql-semi-anti-joins)).

### 6. Gaps and islands: consecutive days

"Users who logged in on at least 3 consecutive days." Trick: for consecutive dates, `login_date − row_number` is constant within a streak.

```text
login_date   row_number   login_date - rn
2024-03-01   1            2024-02-29   ┐
2024-03-02   2            2024-02-29   │ island A (3 days)
2024-03-03   3            2024-02-29   ┘
2024-03-07   4            2024-03-03   ─ island B
```

```sql
WITH d AS (SELECT DISTINCT user_id, login_date FROM logins),    -- one row per user-day
g AS (
  SELECT user_id, login_date,
         login_date - (row_number() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp
  FROM d
)
SELECT user_id, min(login_date) AS streak_start, max(login_date) AS streak_end, count(*) AS days
FROM g
GROUP BY user_id, grp
HAVING count(*) >= 3;
```

The `DISTINCT` step matters: two logins on the same day would break the arithmetic. For **sessions** ("new session after 30 minutes of inactivity"), flag starts with `lag` and number them with a running sum:

```sql
SELECT *, sum(is_new) OVER (PARTITION BY user_id ORDER BY ts) AS session_no
FROM (SELECT user_id, ts,
             CASE WHEN ts - lag(ts) OVER (PARTITION BY user_id ORDER BY ts) <= INTERVAL '30 minutes'
                  THEN 0 ELSE 1 END AS is_new
      FROM events) e;
```

### 7. Running totals and 8. Period over period

```sql
WITH monthly AS (
  SELECT date_trunc('month', order_date)::date AS month, sum(total) AS revenue
  FROM orders WHERE status = 'paid' GROUP BY 1
)
SELECT month, revenue,
       sum(revenue) OVER (ORDER BY month ROWS UNBOUNDED PRECEDING) AS ytd_running,
       revenue - lag(revenue) OVER (ORDER BY month)               AS change,
       round(100.0 * (revenue / NULLIF(lag(revenue) OVER (ORDER BY month), 0) - 1), 1) AS pct_change
FROM monthly ORDER BY month;
```

Edge case: months with **no** orders don't appear, so `lag` compares with a non-adjacent month. Generate a calendar (`generate_series`) and `LEFT JOIN` the data onto it, using `COALESCE(revenue, 0)`.

### 9. Pivot

```sql
SELECT date_trunc('month', order_date)::date AS month,
       count(*) FILTER (WHERE status = 'paid')      AS paid,
       count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
       count(*) FILTER (WHERE status = 'pending')   AS pending
FROM orders GROUP BY 1 ORDER BY 1;
```

The column list is fixed in the query; truly dynamic pivots need dynamic SQL or client-side pivoting.

### 10. Median and percentiles

```sql
SELECT department_id,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY salary) AS median_salary,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY salary) AS p95_salary
FROM employees GROUP BY department_id;
```

`percentile_cont` interpolates between values (median of 1, 2, 3, 4 is 2.5); `percentile_disc` returns an actual value from the data. Without these functions (MySQL), use `row_number` and `count` to pick the middle row(s).

### 11. Cohorts and retention

"For each signup month, what fraction of customers ordered again in the following month?"

```sql
WITH first_order AS (
  SELECT customer_id, date_trunc('month', min(order_date))::date AS cohort
  FROM orders GROUP BY customer_id
),
activity AS (
  SELECT DISTINCT customer_id, date_trunc('month', order_date)::date AS month FROM orders
)
SELECT f.cohort,
       count(*) AS cohort_size,
       count(a.customer_id) AS returned_next_month,
       round(100.0 * count(a.customer_id) / count(*), 1) AS retention_pct
FROM first_order f
LEFT JOIN activity a
       ON a.customer_id = f.customer_id AND a.month = f.cohort + INTERVAL '1 month'
GROUP BY f.cohort ORDER BY f.cohort;
```

### 12. Hierarchies

Self join for one level (employee → manager), recursive CTE for arbitrary depth ([Subqueries & CTEs](lesson:sql-subqueries-ctes)).

## Internal Mechanism

:::depth{level=advanced}
How these patterns execute:

- Ranking patterns → Sort (or ordered index scan) + WindowAgg + Filter. Filtering on `rn` happens *after* ranking every row that passed `WHERE`; for huge groups, `LATERAL (… ORDER BY … LIMIT n)` with an index reads only n rows per group.
- Gaps-and-islands → one sort per user, window pass, then HashAggregate on `(user_id, grp)`.
- Anti/semi joins → Hash Anti Join / Semi Join nodes.
- `percentile_cont` → sorts each group's values (ordered-set aggregate); expensive on large groups, where approximate percentiles (t-digest, HDR histograms) are used in analytics systems.

When an interviewer asks "how would this perform on 1 billion rows?", talk about the sort behind the window, which indexes remove it, and whether the job belongs on a replica or warehouse.
:::

## Example

A full worked question: *"Find the department(s) with the highest average salary. Return the department name and the average, rounded to 2 decimals."*

```sql
WITH dept_avg AS (
  SELECT d.name, avg(e.salary) AS avg_salary
  FROM employees e JOIN departments d ON d.id = e.department_id
  GROUP BY d.id, d.name
)
SELECT name, round(avg_salary, 2) AS avg_salary
FROM dept_avg
WHERE avg_salary = (SELECT max(avg_salary) FROM dept_avg);
```

Points an interviewer looks for: returns **all** tied departments (a `LIMIT 1` wouldn't), groups by `d.id` (department names might not be unique), rounds only for display (comparison uses the unrounded value).

## Complexity & Performance

- Most patterns cost one or two sorts/hashes over the filtered data: O(n log n).
- Correlated-subquery versions of the same patterns (e.g., "count employees with higher salary" for ranking) are O(n²) — mention the window-function alternative.

## Trade-offs

- `row_number` vs `rank` vs `dense_rank` is a **semantics** decision (ties), not style — say which you chose and why.
- Readability (CTEs) vs brevity: interviewers value clear, step-wise SQL over clever one-liners.

## Failure Modes

These are the planted traps:

- Ties (Nth highest, top-N, "the" highest department).
- NULLs (NOT IN, AVG, COUNT(col)).
- Missing periods (no rows for a month → wrong lag, missing zero rows).
- Duplicate events (two logins per day breaking consecutive-day logic).
- Join fan-out inflating sums.
- Integer division in percentages.

## In Production

- The same patterns power real features: leaderboards (ranking), streaks (islands), dashboards (period over period, pivots), deduplication jobs, retention analysis.
- In production, add the index that supports the window's `PARTITION BY … ORDER BY` or run heavy analytics off the primary.

## Deeper Connections

- Every pattern is a combination of the primitives: filter, join, group, window, set operation ([Window Functions](lesson:sql-window-functions), [Aggregation](lesson:sql-aggregation)).
- Duplicate-prevention is ultimately a constraint problem ([Keys & Constraints](lesson:db-keys-constraints)).

## Common Misconceptions

- **"`LIMIT 1` gives the highest."** Only if there are no ties you care about.
- **"`OFFSET n-1 LIMIT 1` on salary gives the Nth highest salary."** Only with `DISTINCT` — duplicates shift positions.
- **"Consecutive means lag = previous day."** Checking only one step finds pairs, not streaks of length k; the row_number-difference trick finds whole islands.

## Interview Questions

### [L1 · sql] Find the second highest salary; return NULL if it doesn't exist.

:::answer
```sql
SELECT max(salary) AS second_highest
FROM employees
WHERE salary < (SELECT max(salary) FROM employees);
```

If all salaries are equal (or the table has one row), the WHERE matches nothing and `max` returns NULL. Generalize with `dense_rank() … WHERE r = N`.
:::

### [L2 · sql] Delete duplicate rows from `customers` (same email, case-insensitive), keeping the earliest-created one.

:::answer
```sql
DELETE FROM customers c
USING (
  SELECT id, row_number() OVER (PARTITION BY lower(email) ORDER BY created_at, id) AS rn
  FROM customers
) d
WHERE c.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX customers_email_lower_uq ON customers (lower(email));
```

The `id` tiebreaker makes "earliest" deterministic when timestamps are equal. Before deleting, re-point or check foreign keys (orders referencing the duplicates), and do it in a transaction.
:::

### [L2 · sql] Find users who logged in on 3 or more consecutive days.

:::answer
```sql
WITH d AS (SELECT DISTINCT user_id, login_date FROM logins),
g AS (
  SELECT user_id, login_date,
         login_date - (row_number() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp
  FROM d)
SELECT DISTINCT user_id
FROM g
GROUP BY user_id, grp
HAVING count(*) >= 3;
```

Consecutive dates minus their row numbers are equal within a streak, so each streak forms one group. Deduplicate same-day logins first.
:::

### [L2 · sql] For each customer, return their most recent order (one row per customer, including customers with no orders).

:::answer
```sql
SELECT c.id, c.name, o.id AS order_id, o.order_date, o.total
FROM customers c
LEFT JOIN LATERAL (
  SELECT id, order_date, total FROM orders
  WHERE customer_id = c.id
  ORDER BY order_date DESC, id DESC
  LIMIT 1) o ON true;
```

Window alternative: `row_number() OVER (PARTITION BY customer_id ORDER BY order_date DESC, id DESC) = 1` on orders, LEFT JOINed to customers.
:::

### [L3 · sql] Month-over-month revenue growth, including months with zero revenue.

:::answer
```sql
WITH months AS (
  SELECT generate_series(date '2024-01-01', date '2024-12-01', interval '1 month')::date AS month
),
rev AS (
  SELECT date_trunc('month', order_date)::date AS month, sum(total) AS revenue
  FROM orders WHERE status = 'paid' GROUP BY 1
),
series AS (
  SELECT m.month, COALESCE(r.revenue, 0) AS revenue
  FROM months m LEFT JOIN rev r ON r.month = m.month
)
SELECT month, revenue,
       lag(revenue) OVER (ORDER BY month) AS prev,
       round(100.0 * (revenue - lag(revenue) OVER (ORDER BY month))
             / NULLIF(lag(revenue) OVER (ORDER BY month), 0), 1) AS growth_pct
FROM series ORDER BY month;
```

The calendar guarantees `lag` compares adjacent months; `NULLIF` avoids division by zero after a zero-revenue month.
:::

## Practice

### [mcq] Which query returns exactly 3 employees per department even when salaries tie?

- [x] Filter on `row_number() OVER (PARTITION BY department_id ORDER BY salary DESC, id) <= 3`
- [ ] Filter on `rank() OVER (PARTITION BY department_id ORDER BY salary DESC) <= 3`
- [ ] Filter on `dense_rank() OVER (PARTITION BY department_id ORDER BY salary DESC) <= 3`
- [ ] `ORDER BY salary DESC LIMIT 3`

rank/dense_rank include all tied rows (possibly more than 3); LIMIT 3 is global, not per department.

### [exercise] Write a query that pivots order counts per customer into columns `paid`, `cancelled`, `pending`, and also returns customers with zero orders.

:::solution
```sql
SELECT c.id, c.name,
       count(o.id) FILTER (WHERE o.status = 'paid')      AS paid,
       count(o.id) FILTER (WHERE o.status = 'cancelled') AS cancelled,
       count(o.id) FILTER (WHERE o.status = 'pending')   AS pending
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
ORDER BY c.id;
```

`count(o.id)` (not `count(*)`) makes customers without orders show 0 instead of 1: the NULL-padded row has `o.id` NULL.
:::

## Quick Revision

- Work method: grain → sources (fan-out?) → pattern → edge cases → CTE steps.
- Nth highest: DENSE_RANK or `max < max`; wrap in max() to return NULL.
- Duplicates: GROUP BY HAVING; delete with row_number > 1; then add a unique index.
- Top-N per group: row_number/dense_rank + filter; LATERAL; DISTINCT ON.
- Never: NOT EXISTS. Every: double NOT EXISTS / count compare.
- Islands: date − row_number; sessions: lag flag + running sum.
- Period over period: lag over a complete calendar. Pivot: FILTER/CASE. Median: percentile_cont.
