---
title: "Views, Materialized Views, Stored Procedures and Triggers"
subject: db
level: 4
order: 5
summary: "Named queries (views), cached query results (materialized views), and code that runs inside the database (functions, procedures, triggers) — what each is for, how they execute, and why teams often limit logic in the database."
depth: core
difficulty: 3
minutes: 35
relevance: medium
stage: 2
prerequisites: [sql-subqueries-ctes]
related: [sql-aggregation, db-keys-constraints, db-query-optimization, db-transactions-acid, x-caching-everywhere]
labs: [sql-playground]
tags: [view, materialized view, refresh materialized view, stored procedure, function, trigger, plpgsql, security definer, row level security, updatable view, audit trigger]
---

## Mental Model

- A **view** is a saved query with a name. Querying it re-runs the query; it stores no data. Think *macro*.
- A **materialized view** stores the query's *result*. Reading it is fast; it's stale until refreshed. Think *cache*.
- **Functions/procedures** are code that runs inside the database, next to the data. Think *server-side logic without a network hop*.
- **Triggers** are functions that run automatically on `INSERT/UPDATE/DELETE`. Think *hidden side effects* — powerful and easy to forget.

## Definition

```sql
CREATE VIEW active_customers AS
SELECT id, name, email FROM customers WHERE deleted_at IS NULL;

CREATE MATERIALIZED VIEW monthly_revenue AS
SELECT date_trunc('month', order_date)::date AS month, sum(total) AS revenue
FROM orders WHERE status = 'paid' GROUP BY 1;

REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue;  -- needs a unique index on the matview
```

- **Function**: returns a value or a set of rows; callable inside queries (`SELECT f(x)`).
- **Procedure** (`CALL p()`): can't be used inside expressions; in PostgreSQL 11+ can `COMMIT` inside its body (useful for batch jobs).
- **Trigger**: `BEFORE`/`AFTER`/`INSTEAD OF` an event, `FOR EACH ROW` or `FOR EACH STATEMENT`.

## Why It Exists

- **Views**: encapsulation and security — give an analyst or service a stable interface (`active_customers`) or a restricted subset of columns/rows, while the underlying tables evolve.
- **Materialized views**: expensive aggregations queried often but tolerable when minutes stale (dashboards).
- **Database-side code**: keep invariants next to the data (audit logs, derived columns), or cut round trips for multi-statement operations.

## How It Works

### Views are expanded into the query

```sql
SELECT * FROM active_customers WHERE city = 'Pune';
-- becomes, before planning:
SELECT id, name, email FROM customers WHERE deleted_at IS NULL AND city = 'Pune';
```

The planner optimizes the combined query (the view's text is merged in), so a simple view costs nothing extra. Views stacked on views on views, however, produce enormous merged queries that are hard to reason about.

**Updatable views**: simple single-table views (no aggregates, DISTINCT, GROUP BY) accept INSERT/UPDATE/DELETE, which are rewritten against the base table. `WITH CHECK OPTION` rejects writes through the view that would produce rows the view can't see.

### Materialized views are snapshots

`REFRESH` re-runs the whole query and replaces the stored result. Plain `REFRESH` locks out readers during the rebuild; `CONCURRENTLY` computes the new result, diffs it and applies changes, so readers keep reading (requires a unique index and costs more). There's no automatic incremental maintenance in PostgreSQL — you schedule refreshes (cron, pg_cron) or maintain summary tables yourself with triggers or jobs.

### A trigger for audit logging

```sql
CREATE TABLE orders_audit (
  order_id bigint, changed_at timestamptz DEFAULT now(),
  old_status text, new_status text, changed_by text DEFAULT current_user
);

CREATE FUNCTION log_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO orders_audit (order_id, old_status, new_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orders_status_audit
AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION log_status_change();
```

The audit insert happens **in the same transaction** as the update: if the update rolls back, so does the audit row. That atomicity is the main argument for triggers.

## Internal Mechanism

:::depth{level=advanced}
- PostgreSQL implements views with the **rule system**: the view's `SELECT` is stored as a rewrite rule, and the rewriter substitutes it into queries before planning ([Query Lifecycle](lesson:db-query-lifecycle)).
- A materialized view is a real heap table plus the stored defining query; it can have its own indexes.
- Functions have volatility categories — `IMMUTABLE` (same inputs → same result forever; usable in indexes), `STABLE` (constant within one statement), `VOLATILE` (default; re-evaluated per row, blocks some optimizations). Mislabeling a function `IMMUTABLE` when it reads tables or the clock leads to wrong index contents.
- `SECURITY DEFINER` functions run with the *owner's* privileges — a controlled way to expose one privileged operation, and a classic privilege-escalation risk if `search_path` isn't pinned.
- **Row-level security** policies (`CREATE POLICY … USING (tenant_id = current_setting('app.tenant')::int)`) are appended to every query on the table — a view-like filter enforced for all access paths.
:::

## Example

A dashboard reads "revenue by month" 500 times a minute; the underlying aggregate scans 50 million orders. Options:

| Approach | Freshness | Read cost | Write cost |
|---|---|---|---|
| Plain view | real time | full aggregation each read | none |
| Materialized view, refreshed every 5 min | ≤ 5 min stale | index lookup | periodic full recompute |
| Summary table maintained by trigger on `orders` | real time | lookup | extra write per order; hot-row contention on the current month |
| Summary table maintained by a job from a change stream | seconds stale | lookup | asynchronous |

Most teams pick the materialized view or the asynchronous summary: the trigger version turns every order insert into an update of the *same* monthly row — a lock hotspot ([Locking](lesson:db-locking)).

## Complexity & Performance

- Views: zero overhead beyond the query they expand to.
- Materialized views: read = table scan/index lookup; refresh = full query + write of all rows.
- Row-level triggers execute per affected row: a bulk `UPDATE` of 1 million rows runs the trigger 1 million times inside the transaction.

## Trade-offs

**Logic in the database** (procedures, triggers):

- ✔ Atomic with the data change, enforced for every client, no network round trips.
- ✘ Harder to test, version, debug and deploy; scales with the database (the hardest component to scale); hidden side effects surprise developers; vendor lock-in.

A common, pragmatic split: constraints and simple integrity/audit triggers in the database; business workflows in the application.

## Failure Modes

- **Trigger cascades**: triggers that update tables with their own triggers — surprising performance and occasional infinite recursion.
- **Stale materialized views** mistaken for live data; refresh jobs that silently stopped.
- **Views hiding expensive joins** — innocent-looking `SELECT * FROM v WHERE id = 5` runs a 7-table join.
- **Dependency lock-in**: you can't alter a column type that a view depends on without dropping and recreating the view.

## In Production

- Migrations must recreate dependent views; tools like `pg_depend` show what depends on what.
- Materialized view refreshes are scheduled and monitored like any batch job; `CONCURRENTLY` avoids blocking readers.
- Audit triggers and `updated_at` triggers are the most common trigger uses in application databases; change-data-capture (logical replication to Kafka) is the modern alternative for downstream consumers.

## Deeper Connections

- A materialized view is a cache with explicit invalidation — the same freshness trade-off as HTTP caching ([Caching Everywhere](lesson:x-caching-everywhere)).
- Trigger-written audit rows are atomic because they ride in the same transaction and WAL records ([Transactions](lesson:db-transactions-acid)).

## Common Misconceptions

- **"Views store data / make queries faster."** Plain views store only the query; they're neither faster nor slower than writing it out.
- **"Materialized views update automatically."** Not in PostgreSQL or MySQL — you refresh them (some databases, e.g., Oracle and several warehouses, support incremental refresh).
- **"Stored procedures are always faster."** They save round trips, but the SQL inside runs with the same plans.

## Interview Questions

### [L1 · compare] View vs materialized view?

A view is a stored query, expanded into each query that uses it; it always reflects current data and costs whatever the underlying query costs. A materialized view stores the query result as a table; reads are fast and can be indexed, but data is stale until refreshed and refreshes cost a full recomputation (or an incremental diff where supported).

### [L2 · design] When would you use a trigger, and what are the risks?

For invariants that must be atomic with every write regardless of the client: audit logs, maintaining `updated_at`, enforcing complex cross-row rules, or keeping a derived table in sync. Risks: hidden side effects, per-row overhead on bulk operations, cascading triggers, lock contention if many writes update the same derived row, and harder testing/debugging. Prefer constraints where possible and asynchronous change streams for downstream derivations.

### [L2 · why] Why can views be used for security?

A view can expose only certain columns and rows of a table; granting SELECT on the view but not the base table limits what a role can read (use `security_barrier` views in PostgreSQL to stop leaks via user-defined functions in WHERE clauses). Row-level security generalizes this with per-row policies on the table itself.

## Practice

### [mcq] You query a plain view 1,000 times. How many times is its underlying query executed?

- [ ] Once, at view creation
- [ ] Once, then cached
- [x] 1,000 times (merged into each query)
- [ ] Only when the base tables change

A view is a stored definition, not stored data.

### [mcq] What does REFRESH MATERIALIZED VIEW CONCURRENTLY require in PostgreSQL?

- [ ] A trigger on the base table
- [x] A unique index on the materialized view
- [ ] That the view has no aggregates
- [ ] Exclusive access to the base tables

The unique index lets PostgreSQL diff the old and new results row by row while readers continue.

## Quick Revision

- View = named query, expanded at plan time; no storage, no speedup; updatable when simple.
- Materialized view = stored result; fast reads, stale until REFRESH (CONCURRENTLY needs a unique index).
- Functions (in expressions) vs procedures (CALL, can commit); volatility labels matter.
- Triggers run inside the writing transaction: atomic audit/derivation, but hidden per-row cost and cascades.
- Keep integrity close to the data; keep complex business workflows in the application.
