---
title: "Practical Schema Design: Decisions That Outlive the Code"
subject: db
level: 5
order: 4
summary: "The decisions real schemas turn on: key types (bigint, UUIDv4, UUIDv7), time and money, soft deletes, audit history, enums, JSON columns, multi-tenancy, EAV and polymorphic traps — with the reasoning to defend each choice."
depth: advanced
difficulty: 3
minutes: 45
relevance: high
stage: 2
prerequisites: [db-normalization]
related: [db-keys-constraints, db-clustered-indexes, db-index-design-practice, db-partitioning, db-sharding, sql-dml-ddl, db-document-stores]
tags: [schema design, uuid, uuidv7, bigint, surrogate key, soft delete, audit table, temporal data, timestamptz, money, enum, jsonb, multi-tenancy, eav, polymorphic association, naming conventions]
---

## Mental Model

Code is rewritten every few years; **schemas and data live for decades**. Every column you add will be read by services, reports and migrations you haven't imagined. Good schema design is mostly about choosing representations that stay **correct, constrainable and cheap to change** as requirements grow.

A useful test for every design choice: *"What happens in two years, at 100× the data, when a second team starts using this table?"*

## Definition

Key decisions covered here:

- **Identifiers**: integer identity vs UUIDv4 vs time-ordered UUIDv7/ULID.
- **Temporal data**: `timestamptz`, created/updated timestamps, history tables, validity ranges.
- **Money and quantities**: exact numerics or integer minor units.
- **Deletion**: hard delete vs soft delete vs archive.
- **Flexible attributes**: columns vs `jsonb` vs EAV.
- **Enumerations**: CHECK constraint vs enum type vs lookup table.
- **Multi-tenancy**: shared tables with `tenant_id` vs schema-per-tenant vs database-per-tenant.

## Why It Exists

Normalization tells you *which facts go in which table*. It doesn't tell you what type an id should be, how to represent "deleted", how to keep history, or how to serve 10,000 customers from one database. Those choices dominate day-to-day schema work and interviews for backend roles.

## How It Works

### Identifiers

| Option | Pros | Cons |
|---|---|---|
| `bigint GENERATED … AS IDENTITY` | 8 bytes; sequential → compact, append-only B+ tree inserts; readable | Needs central generation; leaks counts/growth (enumerable URLs); merging databases collides |
| UUIDv4 (random) | Generate anywhere (clients, offline, many services); unguessable | 16 bytes; **random inserts scatter across the index** → page splits, poor cache locality, write amplification |
| UUIDv7 / ULID (time-ordered) | Generated anywhere *and* roughly sequential → B+ tree friendly | 16 bytes; embeds creation time (may leak it) |

A common pattern: `bigint` primary key internally, plus a random public identifier (UUID or opaque slug) exposed in URLs ([Clustered Indexes](lesson:db-clustered-indexes)).

### Time

- Store instants as **`timestamptz`** (PostgreSQL stores UTC and converts on display). Store *local* times (a store's opening hour, a birthday) as `time`/`date` plus a time-zone name when the meaning is local.
- `created_at DEFAULT now()` and `updated_at` (maintained by the app or a trigger) on nearly every table — invaluable for debugging and incremental syncs.
- `now()` is the transaction start time — all rows in one transaction share it.

### Money

`numeric(19,4)` or integer minor units (`amount_paise bigint`) plus a `currency char(3)`. Never floating point. Decide rounding rules (banker's rounding?) in one place.

### Deletion strategies

| Strategy | How | Costs |
|---|---|---|
| Hard delete | `DELETE` | History lost; FKs must be handled |
| Soft delete | `deleted_at timestamptz NULL`; filter `WHERE deleted_at IS NULL` everywhere | Every query and every **unique constraint** must account for it: use partial unique indexes `… WHERE deleted_at IS NULL`; table grows forever; privacy laws may still require real erasure |
| Archive | Move rows to `orders_archive` / cold storage | Two places to query; move jobs |

Soft delete is often a proxy for "we want history or undo" — an audit/history table may meet that need more cleanly.

### History and audit

- **Audit log table** (who changed what, when; old/new values) via trigger or application ([Views & Triggers](lesson:sql-views-programmability)).
- **Temporal (validity) tables**: `price_history(product_id, price, valid_from, valid_to)` with an exclusion constraint preventing overlapping periods; queries ask "price as of date X".
- **Event sourcing**: store every change as an immutable event and derive current state — powerful and complex; use when history *is* the product (ledgers).

### Flexible attributes

| Approach | Use when | Watch out |
|---|---|---|
| Real columns | Attribute is known, queried, constrained | Migrations to add columns (usually cheap now) |
| `jsonb` column | Attributes genuinely vary (product specs per category, webhook payloads) | Weak typing; constraints need CHECKs; GIN indexes for containment queries ([Specialized Indexes](lesson:db-specialized-indexes)) |
| EAV (`entity, attribute, value` rows) | Almost never | Every query becomes self joins/pivots; no types; no constraints — the classic anti-pattern |

Rule: if you filter, join, aggregate or constrain on it regularly, it deserves a column.

### Enumerations

- `CHECK (status IN ('pending','paid','shipped'))` — simple; changing it is a quick constraint swap.
- Enum type — compact and typed; adding values is easy, removing/renaming is hard.
- Lookup table with FK — values carry metadata (label, sort order, active flag); best when values change or are user-managed.

### Multi-tenancy

| Model | Isolation | Operational cost | Typical fit |
|---|---|---|---|
| Shared tables + `tenant_id` column | Logical (every query must filter; add row-level security) | Lowest; one schema to migrate | Many small tenants (SaaS default) |
| Schema per tenant | Stronger; per-tenant backup/restore easier | Migrations × N schemas; catalog bloat at thousands | Hundreds of mid-size tenants |
| Database per tenant | Strongest; noisy neighbours isolated | Highest; connection and fleet management | Few large or regulated tenants |

With shared tables, put `tenant_id` **first** in composite indexes and keys, so each tenant's data is clustered in index order and queries never cross tenants; it's also the natural shard key later ([Sharding](lesson:db-sharding)).

## Internal Mechanism

:::depth{level=advanced}
### Why random UUIDs hurt B+ trees

A sequential key always inserts at the rightmost leaf, which stays in memory; pages fill to ~100%. A random key inserts into a random leaf: with an index larger than RAM, most inserts read a leaf from disk, and leaves split at ~50% fill, leaving the index ~30–40% larger. In InnoDB the **table itself** is clustered by the primary key, so random PKs scatter the table too. Time-ordered UUIDs restore append-mostly behavior.

### Column order and row width

Rows are stored with alignment padding; wide rows mean fewer rows per 8 KB page and more I/O for scans. Large values (text, jsonb over ~2 KB) are moved out of line (TOAST in PostgreSQL) ([Pages & Records](lesson:db-pages-records)). Keeping hot tables narrow — moving rarely used large columns to a side table — can speed up scans substantially.

### Naming and conventions

Consistency matters more than any particular convention: singular or plural table names (pick one), `snake_case`, `<table>_id` for FKs, `_at` for timestamps, `is_`/`has_` for booleans. Future readers (and ORMs) depend on predictability.
:::

## Example

Designing `subscriptions` for a SaaS product:

```sql
CREATE TABLE subscriptions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     uuid   NOT NULL DEFAULT gen_random_uuid() UNIQUE,  -- exposed externally
  tenant_id     bigint NOT NULL REFERENCES tenants(id),
  plan_code     text   NOT NULL REFERENCES plans(code),
  status        text   NOT NULL CHECK (status IN ('trialing','active','past_due','cancelled')),
  price_minor   bigint NOT NULL CHECK (price_minor >= 0),   -- snapshot at purchase
  currency      char(3) NOT NULL,
  current_period daterange NOT NULL,
  cancelled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb NOT NULL DEFAULT '{}'
);

-- One non-cancelled subscription per tenant and plan
CREATE UNIQUE INDEX ON subscriptions (tenant_id, plan_code) WHERE status <> 'cancelled';
CREATE INDEX ON subscriptions (tenant_id, status);
```

Each line is a decision you should be able to defend: internal vs public id, price snapshot, CHECK vs lookup, partial uniqueness, tenant-first indexes.

## Complexity & Performance

- Key width multiplies through every secondary index (InnoDB secondary indexes store the PK) and every FK column.
- Soft deletes grow tables and indexes forever; partial indexes on live rows keep lookups small.
- `jsonb` queries without an appropriate index scan and parse every row.

## Trade-offs

Design is a sequence of trade-offs: integrity (constraints) vs flexibility (json), history (soft delete/audit) vs simplicity, isolation (DB per tenant) vs operability (shared tables), global uniqueness (UUIDs) vs index locality (sequential ids). State the trade-off explicitly — interviewers care more about that than about the choice.

## Failure Modes

- `int` ids overflowing at 2,147,483,647 — a real, recurring outage class. Use `bigint`.
- Money in floats; timestamps without time zones; local times stored as UTC instants (a 9 a.m. meeting shifts at DST).
- Soft-deleted rows breaking unique constraints ("email already taken" by a deleted account).
- EAV or "one table to rule them all" designs that make every query a puzzle.
- Missing `tenant_id` filter in one query → cross-tenant data leak. Row-level security is the safety net.

## In Production

- Schema reviews catch most of these before they ship; after launch, fixing a key type or tenancy model means a large migration.
- Data retention and privacy (erasure requests) must be designed in: know where personal data lives, and whether soft delete satisfies the law (often not).

## Deeper Connections

- Key choice affects B+ tree behavior and clustering ([Clustered Indexes](lesson:db-clustered-indexes)), and later the shard key ([Sharding](lesson:db-sharding)).
- Time-partitioned tables make retention a cheap `DROP PARTITION` ([Partitioning](lesson:db-partitioning)).

## Common Misconceptions

- **"UUIDs are always better for distributed systems."** Random UUIDs cost index locality; time-ordered ones or bigint + public id often serve better.
- **"jsonb means we don't need migrations."** The schema still exists — implicitly, in every reader.
- **"Soft delete is free undo."** It taxes every query, constraint and index.

## Interview Questions

### [L2 · compare] Auto-increment integer vs UUID primary keys?

Integers are compact (8 bytes), sequential (append-friendly B+ tree inserts, good cache locality) and readable, but need central generation and expose counts. Random UUIDs can be generated anywhere and are unguessable, but are twice the size and scatter inserts, causing page splits and poor locality — especially bad for clustered primary keys (InnoDB). Time-ordered UUIDs (v7) or integer PKs with a separate public UUID combine the benefits.

### [L2 · design] How would you implement soft deletes, and what problems do you anticipate?

A nullable `deleted_at` column; application queries filter `deleted_at IS NULL` (often via a view or ORM default scope). Problems: every query must remember the filter; unique constraints must become partial (`WHERE deleted_at IS NULL`); tables and indexes grow (use partial indexes on live rows); foreign keys still point at deleted rows; privacy regulations may require true deletion. Consider audit/history tables if the real need is history.

### [L3 · design] Design multi-tenancy for a B2B SaaS with 5,000 small customers and 10 very large ones.

Default to shared tables with `tenant_id` on every tenant-owned table, tenant-first composite keys/indexes, and row-level security as a guard against missing filters. Route the few large tenants to dedicated databases (or shards) behind the same schema, using a tenant → database directory in the application. This keeps migrations uniform, isolates noisy neighbours, and makes `tenant_id` the future shard key.

## Practice

### [mcq] Why can random UUIDv4 primary keys slow down inserts on a large InnoDB table?

- [ ] UUID comparison is slow
- [x] Inserts land in random B+ tree pages, causing page splits and cache misses (and InnoDB clusters the table by PK)
- [ ] UUIDs can't be indexed
- [ ] UUID generation requires a network call

Random keys destroy append locality; time-ordered UUIDs avoid it.

### [mcq] With soft deletes, how do you keep "email must be unique among active users"?

- [ ] UNIQUE(email)
- [ ] UNIQUE(email, deleted_at)
- [x] A partial unique index on email WHERE deleted_at IS NULL
- [ ] A CHECK constraint

UNIQUE(email, deleted_at) allows duplicates among active rows because NULLs are distinct in unique indexes.

## Quick Revision

- Ids: bigint internal (+ public UUID) or UUIDv7; random UUIDv4 hurts B+ tree locality. Never `int`.
- `timestamptz` for instants; money as numeric or integer minor units.
- Soft delete taxes every query and unique constraint → partial unique indexes; consider audit tables instead.
- Columns for queried/constrained data; jsonb for genuinely variable data; avoid EAV.
- Multi-tenancy: shared + tenant_id (+ RLS) by default; tenant-first indexes; dedicated DBs for giants.
