---
title: "Changing Data and Schema: INSERT, UPDATE, DELETE, UPSERT and DDL"
subject: db
level: 2
order: 4
summary: "Data modification that is correct under concurrency (UPSERT, RETURNING, set-based updates), DELETE vs TRUNCATE vs DROP, choosing data types, and changing schemas on live tables without taking the site down."
depth: core
difficulty: 2
minutes: 40
relevance: essential
stage: 1
prerequisites: [sql-select-basics, db-keys-constraints]
related: [db-transactions-acid, db-locking, db-optimistic-pessimistic, db-schema-design, db-mvcc]
labs: [sql-playground]
tags: [insert, update, delete, upsert, on conflict, merge, returning, truncate, drop, ddl, dml, data types, alter table, migrations, online schema change]
---

## Mental Model

DML statements (`INSERT`, `UPDATE`, `DELETE`) are **queries that also write**: an `UPDATE` first finds rows exactly like a `SELECT … WHERE` would, then changes each one. So everything about finding rows (indexes, plans) also governs how fast writes are — and the `WHERE` clause is the only thing standing between you and updating every row in the table.

DDL statements (`CREATE`, `ALTER`, `DROP`) change the **schema**, and usually need strong locks on the table — which is why schema changes on busy tables are an operational skill in their own right.

## Definition

- **DML** (data manipulation): `INSERT`, `UPDATE`, `DELETE`, `MERGE`, and upserts (`INSERT … ON CONFLICT` in PostgreSQL/SQLite, `INSERT … ON DUPLICATE KEY UPDATE` in MySQL).
- **DDL** (data definition): `CREATE`/`ALTER`/`DROP` for tables, indexes, views, etc.
- **`RETURNING`** (PostgreSQL, SQLite, MariaDB): return the affected rows' values from a DML statement.
- **`TRUNCATE`**: remove all rows by discarding the table's storage, rather than deleting row by row.

## Why It Exists

Applications must record changes safely: create an order, mark it paid, remove an item. The subtle part is doing so **correctly when many clients act simultaneously** — which is why atomic single-statement operations (`UPDATE … SET stock = stock - 1 WHERE stock > 0`, upserts) matter more than the syntax.

## How It Works

### INSERT

```sql
INSERT INTO customers (email, name, city)
VALUES ('asha@example.com', 'Asha', 'Pune'),
       ('ravi@example.com', 'Ravi', 'Delhi')
RETURNING id, created_at;           -- get generated values without a second query

INSERT INTO archived_orders (id, customer_id, total)
SELECT id, customer_id, total FROM orders WHERE order_date < DATE '2020-01-01';
```

Always list columns explicitly — `INSERT INTO t VALUES (…)` breaks when a column is added.

### UPDATE — set-based and atomic

```sql
-- Atomic decrement: the check and the change happen in one statement.
UPDATE products
SET stock = stock - 1
WHERE id = 42 AND stock > 0
RETURNING stock;                     -- 0 rows returned ⇒ out of stock
```

Compare the racy version: `SELECT stock` in the app, check `> 0`, then `UPDATE … SET stock = <value computed in app>`. Two concurrent requests read the same stock and one decrement is lost ([Anomalies](lesson:db-anomalies)).

Update using another table:

```sql
UPDATE orders o
SET status = 'flagged'
FROM customers c
WHERE c.id = o.customer_id AND c.city = 'Unknown';
```

### DELETE

```sql
DELETE FROM sessions WHERE expires_at < now();
```

In MVCC databases a deleted row is only *marked* dead; its space is reclaimed later by vacuum/purge ([MVCC](lesson:db-mvcc)). Deleting 100 million rows in one statement creates a giant transaction, huge WAL volume and long-held locks — delete in batches instead.

### UPSERT: insert-or-update atomically

```sql
INSERT INTO daily_stats (day, page, views)
VALUES (CURRENT_DATE, '/home', 1)
ON CONFLICT (day, page)
DO UPDATE SET views = daily_stats.views + EXCLUDED.views;
```

`ON CONFLICT` requires a unique constraint or index on the conflict target. It resolves the "check if exists, then insert or update" race inside the database. `EXCLUDED` refers to the row you tried to insert. `ON CONFLICT DO NOTHING` implements idempotent inserts.

### DELETE vs TRUNCATE vs DROP

| | DELETE | TRUNCATE | DROP |
|---|---|---|---|
| Removes | matching rows | all rows | the table itself (data + definition) |
| WHERE clause | yes | no | — |
| Mechanism | marks each row deleted, logs each | swaps in new empty storage | removes catalog entries and files |
| Speed on big tables | slow (per row) | fast (constant-ish) | fast |
| Fires row triggers | yes | no | no |
| Transactional / rollback | yes | yes in PostgreSQL; **implicit commit in MySQL** | yes in PostgreSQL; implicit commit in MySQL |
| Lock | row locks | exclusive table lock | exclusive table lock |

### Choosing data types

| Data | Use | Avoid |
|---|---|---|
| Money | `numeric(12,2)` or integer minor units (paise/cents) | `float`/`double` — 0.1 + 0.2 ≠ 0.3 |
| Timestamps | `timestamptz` (stores an instant, UTC internally) | `timestamp` without time zone for real events |
| Identifiers | `bigint` identity or UUID (v7 for locality) | `int` for tables that might pass 2.1 billion rows |
| Text | `text`/`varchar` | `char(n)` (pads with spaces) |
| Booleans | `boolean` | `'Y'/'N'` strings |
| Semi-structured | `jsonb` for genuinely variable attributes | JSON for core, queried, constrained fields |

## Internal Mechanism

:::depth{level=advanced}
### What an UPDATE physically does

- **PostgreSQL**: writes a new row version and marks the old one expired (MVCC). Every index must get a new entry pointing to the new version — unless the update is **HOT** (heap-only tuple): no indexed column changed and the new version fits on the same page. Leaving free space in pages (`fillfactor`) increases HOT updates.
- **InnoDB (MySQL)**: updates the row in place in the clustered index and writes the old version to the **undo log** for rollback and consistent reads ([MVCC](lesson:db-mvcc)).

Either way, every change is first described in the write-ahead log ([WAL](lesson:db-wal-durability)).

### Online schema changes

`ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock in PostgreSQL. Even a fast `ALTER` can cause an outage: it **queues behind** a long-running query holding a weaker lock, and every new query then queues behind the `ALTER`. Mitigations:

- `SET lock_timeout = '2s'` on migration sessions and retry.
- Prefer metadata-only changes: adding a nullable column or a column with a constant default is instant in modern PostgreSQL and MySQL 8; changing a column type usually rewrites the whole table.
- `CREATE INDEX CONCURRENTLY` (PostgreSQL) / online DDL (MySQL) / tools such as gh-ost and pt-online-schema-change that copy the table in the background.
- **Expand–contract migrations**: add the new column → dual-write → backfill in batches → switch reads → stop writing old → drop old. Each step is backward compatible with the running application version.
:::

## Example

Idempotent payment recording — a retried request must not double-charge:

```sql
CREATE TABLE payments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text   NOT NULL UNIQUE,
  order_id        bigint NOT NULL REFERENCES orders(id),
  amount          numeric(12,2) NOT NULL
);

INSERT INTO payments (idempotency_key, order_id, amount)
VALUES ($1, $2, $3)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;          -- no row returned ⇒ this request was already processed
```

## Complexity & Performance

- An `UPDATE`/`DELETE` costs finding the rows (index or scan) plus, per row: a new version or undo record, WAL, and index maintenance for every affected index.
- Batch inserts (multi-row `VALUES`, `COPY`) are 10–100× faster than row-at-a-time inserts with a commit each, because each commit waits for a durable WAL flush.
- Large deletes: batch by key ranges (`DELETE … WHERE id IN (SELECT id … LIMIT 10000)`), or partition by time and drop whole partitions ([Partitioning](lesson:db-partitioning)).

## Trade-offs

- Upsert vs separate insert/update: upsert is atomic and concise, but `DO UPDATE` always writes (bloat) even if values didn't change — add a `WHERE` to the `DO UPDATE` to skip no-op updates.
- Soft delete (`deleted_at`) keeps history and allows undo but pushes `WHERE deleted_at IS NULL` into every query and every unique constraint ([Schema Design](lesson:db-schema-design)).

## Failure Modes

- **`UPDATE`/`DELETE` without `WHERE`** — run destructive statements inside a transaction, check the affected row count, then commit.
- **Read-modify-write in application code** → lost updates.
- **Huge single-transaction deletes/updates** → replication lag, lock pile-ups, bloat.
- **Migrations that lock hot tables** → site-wide outage during a deploy.
- **Floats for money** → rounding discrepancies in totals.

## In Production

- Safety habits: `BEGIN; UPDATE …; -- check "UPDATE 3"; COMMIT;`. Many teams require peer review for manual production writes.
- `RETURNING` removes a round trip and a race: you get exactly the rows your statement changed.
- Migration tooling (Flyway, Liquibase, Rails/Django migrations) versions schema changes; the operational skill is making each change safe for a live, concurrently accessed table.

## Deeper Connections

- The atomic conditional `UPDATE` is a database compare-and-swap, the same pattern as optimistic concurrency ([Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).
- Every write passes through the WAL before data pages — the durability chain ([Durability Chain](lesson:x-durability-chain)).

## Common Misconceptions

- **"TRUNCATE is just a fast DELETE."** It bypasses row-level processing: no row triggers, takes an exclusive lock, and in MySQL it can't be rolled back.
- **"UPDATE changes rows in place."** In PostgreSQL every update creates a new row version.
- **"Adding a column always rewrites the table."** Many additions are metadata-only now; type changes usually aren't.

## Interview Questions

### [L1 · compare] DELETE vs TRUNCATE vs DROP?

DELETE removes rows matching a condition, row by row, fully logged, fires triggers, transactional. TRUNCATE removes all rows by replacing the table's storage — much faster, no row triggers, exclusive lock, and (in MySQL) an implicit commit. DROP removes the table definition and its data entirely.

### [L2 · design] How do you implement "insert the row, or update it if it already exists" safely under concurrency?

Use the database's atomic upsert backed by a unique constraint: `INSERT … ON CONFLICT (key) DO UPDATE SET …` (PostgreSQL/SQLite), `INSERT … ON DUPLICATE KEY UPDATE` (MySQL) or MERGE with appropriate locking. A select-then-insert in application code races: two requests both see "not exists" and both insert (or one fails with a unique violation).

### [L2 · scenario] Two users buy the last item simultaneously and both succeed. How do you fix it?

The purchase likely reads stock, checks it in code, then writes. Make the check and decrement atomic: `UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0` and treat "0 rows updated" as sold out. Alternatives: lock the row with `SELECT … FOR UPDATE` inside a transaction, or add `CHECK (stock >= 0)` as a safety net.

### [L3 · incident] A deploy ran `ALTER TABLE orders ADD COLUMN note text` — normally instant — and the site went down for 4 minutes. Why?

ALTER TABLE needs an ACCESS EXCLUSIVE lock. A long-running query (e.g., an analytics report) held a lock on `orders`, so the ALTER waited — and every subsequent query on `orders` queued behind the waiting ALTER's pending exclusive lock. The table was effectively locked until the report finished. Fix: set `lock_timeout` for migrations and retry, cancel long queries before migrating, and monitor lock waits.

## Practice

### [mcq] Which statement correctly and atomically prevents stock from going negative when two requests race?

- [ ] `SELECT stock FROM products WHERE id = 42;` then, in code, `UPDATE products SET stock = 4 WHERE id = 42;`
- [x] `UPDATE products SET stock = stock - 1 WHERE id = 42 AND stock > 0;`
- [ ] `UPDATE products SET stock = stock - 1 WHERE id = 42;` then check for negative stock in code
- [ ] `DELETE FROM products WHERE id = 42 AND stock = 0;`

The conditional update checks and decrements in one atomic statement; the row lock serializes the racers.

### [exercise] Write an upsert that maintains per-customer order counts in `customer_stats(customer_id PRIMARY KEY, order_count int)` when a new order arrives for customer `$1`.

:::solution
```sql
INSERT INTO customer_stats (customer_id, order_count)
VALUES ($1, 1)
ON CONFLICT (customer_id)
DO UPDATE SET order_count = customer_stats.order_count + 1;
```

The primary key is the conflict target. The increment reads the current stored value inside the database, so concurrent upserts for the same customer serialize on the row instead of losing counts.
:::

## Quick Revision

- DML finds rows like SELECT, then writes: indexes matter for writes too.
- Atomic patterns: conditional `UPDATE … WHERE stock > 0`, `ON CONFLICT` upserts, `RETURNING`.
- DELETE (rows, logged) vs TRUNCATE (storage swap) vs DROP (table gone).
- Types: numeric for money, timestamptz, bigint ids, text.
- DDL takes strong locks: lock_timeout, CONCURRENTLY, expand–contract migrations, batch big changes.
