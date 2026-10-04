---
title: "Keys and Constraints: Making Invalid Data Impossible"
subject: db
level: 1
order: 2
summary: "Super, candidate, primary, alternate, foreign and composite keys; NOT NULL, UNIQUE, CHECK and referential actions — and why constraints belong in the database, not only in application code."
depth: beginner
difficulty: 2
minutes: 35
relevance: essential
stage: 1
prerequisites: [db-relational-model]
related: [db-er-modeling, db-functional-dependencies, db-schema-design, sql-dml-ddl, db-index-fundamentals, db-optimistic-pessimistic]
labs: [sql-playground]
tags: [primary key, foreign key, candidate key, super key, composite key, surrogate key, natural key, unique, not null, check constraint, referential integrity, on delete cascade, deferrable constraints]
---

## Mental Model

Constraints are **invariants the database enforces for every writer, forever**. Application code checks rules when *that code path* runs; a constraint checks them for every path — the new microservice, the migration script, the engineer running a manual `UPDATE` at 2 a.m., and two requests racing each other.

Keys are the most important constraints: they define **identity** (which row is which) and **relationships** (which row refers to which).

## Definition

- **Super key**: any set of attributes whose values uniquely identify a row. `{id}`, `{id, name}` and `{email}` may all be super keys of `customers`.
- **Candidate key**: a *minimal* super key — remove any attribute and it's no longer unique. `{id}` and `{email}` are candidates; `{id, name}` is not minimal.
- **Primary key**: the candidate key chosen as the main identifier. Unique and NOT NULL; one per table.
- **Alternate key**: a candidate key not chosen as primary — enforce it with `UNIQUE`.
- **Composite key**: a key made of several columns, e.g. `(order_id, product_id)` in `order_items`.
- **Foreign key**: columns whose values must match a candidate key in another (or the same) table — **referential integrity**.
- **Natural key** (meaningful: email, ISBN) vs **surrogate key** (meaningless, generated: `bigint` identity, UUID).

Other constraints: `NOT NULL`, `UNIQUE`, `CHECK (expression)`, `DEFAULT`, and exclusion constraints (PostgreSQL: "no two bookings overlap for the same room").

## Why It Exists

**The problem.** Data has rules — emails are unique, orders belong to real customers, quantities are positive. The obvious place to enforce them is application code. Consider enforcing "emails are unique" in application code:

```text
Request A: SELECT 1 FROM customers WHERE email='x@y.com'  → none
Request B: SELECT 1 FROM customers WHERE email='x@y.com'  → none
Request A: INSERT … email='x@y.com'
Request B: INSERT … email='x@y.com'          ← duplicate created
```

Check-then-act across two statements is a race condition ([Race Conditions](lesson:os-race-conditions)). A `UNIQUE` constraint is enforced atomically inside the database (via a unique index and locking), so exactly one insert succeeds and the other fails with a unique-violation error your code can handle.

The same logic applies to foreign keys: without them, deleting a customer can leave "orphan" orders pointing to nothing, and nobody notices until a report joins them.

**The idea.** A rule checked by *some* code paths is a suggestion; a rule checked by the one component *every* write passes through is a guarantee. Declare the rules on the table, and the database enforces them atomically for every writer, now and in the future.

:::callout[That's all it is]{type=insight}
A key says "this identifies a row" (and the database refuses duplicates). A foreign key says "this value must exist over there". A CHECK says "this must be true". The database checks them on every write, so no code path can skip them.
:::

## How It Works

```sql
CREATE TABLE customers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- surrogate key
  email       text   NOT NULL UNIQUE,                            -- alternate (natural) key
  name        text   NOT NULL,
  city        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status       text   NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled')),
  total        numeric(12,2) NOT NULL CHECK (total >= 0),
  order_date   date   NOT NULL
);

CREATE TABLE order_items (
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  bigint NOT NULL REFERENCES products(id),
  quantity    int    NOT NULL CHECK (quantity > 0),
  unit_price  numeric(12,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)                               -- composite key
);

CREATE INDEX ON orders (customer_id);  -- FKs are not indexed automatically in PostgreSQL
```

### How each constraint is enforced

| Constraint | Enforcement mechanism |
|---|---|
| PRIMARY KEY / UNIQUE | A **unique index**; an insert probes it and fails if a live matching entry exists. Concurrent inserts of the same value wait on each other, then one fails. |
| FOREIGN KEY (child side) | On insert/update of the child, look up the parent row by key and lock it (shared) so it can't be deleted concurrently. |
| FOREIGN KEY (parent side) | On delete/update of the parent, search for referencing children — a **full scan of the child table if the FK column is not indexed**. |
| CHECK | Evaluated on the new row at insert/update time; only sees that row. |
| NOT NULL | Checked on the new row. |

### Referential actions

A foreign key creates a question the database must answer whenever a parent row goes away: what about the rows pointing at it? What happens to children when a parent row is deleted (or its key updated):

| Action | Effect |
|---|---|
| `RESTRICT` / `NO ACTION` (default) | Reject the delete while children exist (`NO ACTION` checks at end of statement, or at commit if deferred) |
| `CASCADE` | Delete the children too |
| `SET NULL` / `SET DEFAULT` | Clear/replace the child's FK value |

`CASCADE` fits ownership (an order owns its items). It is dangerous across aggregates: deleting one customer silently deleting years of orders is rarely intended.

## Internal Mechanism

:::depth{level=advanced}
### NULLs and UNIQUE

In SQL, `NULL` is not equal to anything — including another `NULL` — so a `UNIQUE` column normally allows **many NULLs**. PostgreSQL 15+ supports `UNIQUE NULLS NOT DISTINCT` if you want at most one. SQL Server historically allowed only one NULL in a unique index ([NULL Logic](lesson:sql-null-logic)).

### Deferrable constraints

By default a constraint is checked at the end of each statement. `DEFERRABLE INITIALLY DEFERRED` postpones the check to `COMMIT`, which lets a transaction pass through temporarily invalid states — for example swapping two rows' unique positions, or inserting two rows that reference each other.

### Uniqueness under concurrency

Two transactions inserting the same key: the second finds the first's uncommitted index entry and **waits** for it to commit or abort. If the first commits, the second gets a unique violation; if it aborts, the second succeeds. That wait is a lock — which is why "insert if not exists" patterns can deadlock or queue under load ([Locking](lesson:db-locking)). `INSERT … ON CONFLICT DO NOTHING/UPDATE` handles this atomically ([DML](lesson:sql-dml-ddl)).

### Partial unique indexes

"Only one *active* subscription per user": `CREATE UNIQUE INDEX ON subscriptions(user_id) WHERE status = 'active';` — a constraint that applies to a subset of rows ([Specialized Indexes](lesson:db-specialized-indexes)).
:::

## Example

Finding candidate keys. Table `enrollment(student_id, course_id, semester, grade)`, where a student can take a course once per semester:

- `{student_id, course_id, semester}` identifies a row → super key.
- No proper subset does (the same student takes different courses; the same course has many students; a course can be repeated in another semester) → minimal → **candidate key**.
- It becomes the composite primary key, or you add a surrogate `id` **and keep `UNIQUE (student_id, course_id, semester)`** — a surrogate key never replaces the business rule.

## Complexity & Performance

- Each `UNIQUE`/`PRIMARY KEY` is an index: inserts pay O(log n) per unique index plus the write amplification of maintaining it.
- FK checks on the child side are cheap index lookups on the parent's primary key. On the parent side, **an unindexed FK column turns every parent delete into a sequential scan of the child table** — and holds locks while doing it.
- `CHECK` and `NOT NULL` are nearly free.

## Trade-offs

- **Surrogate vs natural keys**: natural keys carry meaning but change (people change emails; ISBN formats changed) and can be wide; surrogate keys are stable and compact but need an extra `UNIQUE` constraint for the business rule ([Schema Design](lesson:db-schema-design)).
- **Integer identity vs UUID**: integers are compact and sequential (good B+ tree locality) but reveal counts and need central generation; random UUIDs can be generated anywhere but scatter inserts across the index — time-ordered UUIDv7 gets most of both ([Clustered Indexes](lesson:db-clustered-indexes)).
- **Foreign keys at scale**: they cost a lookup per write and complicate sharding (can't reference rows on another shard), so some very large systems drop them and enforce integrity asynchronously. That's a deliberate trade, not a default.

## Failure Modes

- **Unindexed foreign keys**: deleting one parent row scans millions of child rows; cascades lock large ranges; deadlocks appear under concurrent deletes.
- **Uniqueness enforced only in code**: duplicates appear under concurrency or from other writers — and cleaning them up later is painful.
- **Case/whitespace duplicates**: `UNIQUE(email)` treats `A@x.com` and `a@x.com` as different. Use a unique index on `lower(email)` or a case-insensitive type.
- **Surprise cascades**: an `ON DELETE CASCADE` chain deletes far more than intended.

## In Production

- Adding a constraint to a large existing table must validate every row. PostgreSQL lets you add it as `NOT VALID` (enforced for new writes) and `VALIDATE CONSTRAINT` later with a weaker lock; unique indexes are built with `CREATE INDEX CONCURRENTLY`.
- Unique-violation errors (SQLSTATE `23505`) are expected control flow: catch them to implement idempotency ("this payment id was already processed").

## Deeper Connections

- A unique constraint is the database's atomic compare-and-set: the check and the insert happen as one indivisible step ([Atomic Instructions](lesson:os-atomic-instructions)).
- Candidate keys come from functional dependencies — the formal basis of normalization ([Functional Dependencies](lesson:db-functional-dependencies)).
- Idempotency keys in APIs are unique constraints on a request id ([Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).

## Common Misconceptions

- **"A primary key is just an index."** It's a constraint (unique + not null + identity) that happens to be implemented with an index.
- **"Foreign keys are indexed automatically."** The *referenced* key is (it's a PK/UNIQUE); the *referencing* column is not in PostgreSQL. MySQL/InnoDB does create one.
- **"UNIQUE means at most one NULL."** Most databases allow many NULLs in a unique column.

## Interview Questions

### [L1 · compare] What's the difference between a super key, candidate key and primary key?

A super key is any attribute set that uniquely identifies rows. A candidate key is a minimal super key (no attribute can be removed). The primary key is the candidate key chosen as the table's main identifier; it must be unique and non-null. Other candidate keys become alternate keys enforced with UNIQUE.

### [L1 · compare] Primary key vs unique constraint?

Both enforce uniqueness via an index. A table has one primary key, its columns are NOT NULL, and it's the default target of foreign keys and the row's identity (in InnoDB also the clustered index). A table can have many unique constraints, which usually allow NULLs.

### [L2 · why] Why enforce uniqueness in the database if the application already checks it?

The application check is check-then-act across separate statements, so two concurrent requests can both pass the check and both insert. The database enforces the unique constraint atomically with the insert, covers every writer (other services, scripts, manual fixes), and turns a race into a clean error the application can handle.

### [L2 · debugging] Deleting a single customer row takes 40 seconds. What do you check first?

Foreign keys that reference `customers`: for each referencing table, the database must find child rows. If the referencing column (e.g., `orders.customer_id`) is not indexed, each delete does a sequential scan of that table — possibly with cascades doing the same further down. Check with EXPLAIN ANALYZE on the DELETE (triggers show FK check time) and add indexes on the FK columns.

### [L3 · scenario] Users can have many addresses but exactly one default address. How do you enforce "at most one default" in the database?

A partial unique index: `CREATE UNIQUE INDEX ON addresses(user_id) WHERE is_default;`. It only indexes default rows, so a second default for the same user violates uniqueness. To switch defaults atomically, update the old default to false and the new one to true in one transaction (in that order, or make the constraint deferrable if implemented as a constraint).

## Practice

### [mcq] Table R(A, B, C) where {A} and {B, C} are both unique and minimal. Which statement is true?

- [ ] {A, B} is a candidate key
- [x] {A} and {B, C} are candidate keys; {A, B} is a super key but not a candidate key
- [ ] Only the chosen primary key is a candidate key
- [ ] {B} alone must be unique

{A, B} contains the key {A}, so it's unique but not minimal.

### [mcq] In PostgreSQL, which index is NOT created automatically?

- [ ] The index behind a PRIMARY KEY
- [ ] The index behind a UNIQUE constraint
- [x] An index on a foreign-key (referencing) column
- [ ] The index behind a composite PRIMARY KEY

Referencing columns must be indexed manually — a common production mistake.

### [exercise] Write the DDL for a `bookings` table where a room cannot be booked twice for the same date, the check-out must be after check-in, and bookings disappear when their room is deleted.

:::solution
```sql
CREATE TABLE bookings (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id    bigint NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_id   bigint NOT NULL REFERENCES guests(id),
  check_in   date NOT NULL,
  check_out  date NOT NULL,
  CHECK (check_out > check_in)
);
CREATE INDEX ON bookings (guest_id);
```

"No two bookings of the same room overlap" is not expressible with UNIQUE (ranges overlap without being equal). In PostgreSQL use an exclusion constraint:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (room_id WITH =, daterange(check_in, check_out) WITH &&);
```

The exclusion constraint's index also serves lookups by `room_id`.
:::

## Quick Revision

- Super key ⊇ candidate key (minimal) → one chosen as primary; others are alternate keys (UNIQUE).
- FK = referential integrity; actions RESTRICT/NO ACTION, CASCADE, SET NULL. **Index your FK columns.**
- UNIQUE/PK are enforced by unique indexes, atomically — code-only checks race.
- UNIQUE usually allows multiple NULLs. Partial unique indexes enforce rules on subsets.
- Surrogate keys don't replace business uniqueness — keep the UNIQUE constraint.
