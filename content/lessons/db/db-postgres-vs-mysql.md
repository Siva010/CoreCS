---
title: "PostgreSQL vs MySQL (InnoDB): The Differences That Actually Matter"
subject: db
level: 16
order: 4
summary: "The two most common open-source databases make different choices in storage (heap vs clustered index), MVCC (in-table versions + VACUUM vs undo logs + purge), default isolation and locking, replication, connections and DDL. Knowing why explains their performance, their failure modes — and how to answer \"which would you pick?\"."
depth: advanced
difficulty: 3
minutes: 40
relevance: high
stage: 3
prerequisites: [db-mvcc, db-clustered-indexes, db-replication, db-isolation-levels]
related: [db-wal-durability, db-locking, db-index-fundamentals, db-specialized-indexes, x-connection-management, db-schema-design]
tags: [postgresql, mysql, innodb, heap table, clustered index, secondary index, mvcc, vacuum, undo log, purge, history list length, hot update, write amplification, repeatable read, gap lock, next key lock, binlog, logical replication, process per connection, pgbouncer, transactional ddl, online ddl, uuid primary key, collation]
---

## Mental Model

Both are relational, ACID, MVCC databases that speak SQL and store data in B+ trees and pages with a write-ahead log. The differences come from **a handful of early design decisions**, and almost every practical difference follows from one of them:

| Decision | PostgreSQL | MySQL (InnoDB) |
|---|---|---|
| Where rows live | a **heap**; every index points to a tuple's physical location (ctid) | the **primary-key B+ tree** (clustered index); secondary indexes store the primary key |
| Where old versions live | **in the table**, as extra tuples; `VACUUM` removes dead ones | **in undo logs**; rows are updated in place, a purge thread cleans undo |
| Default isolation | Read Committed | Repeatable Read (with gap locks for locking reads) |
| Logs | one WAL for crash recovery *and* replication | InnoDB redo log for crash recovery + server-level **binlog** for replication |
| Connections | a **process** per connection | a **thread** per connection |

Learn these five rows and you can derive most of the rest.

## Why It Exists

**The problem.** "Postgres or MySQL?" is a real decision teams make and a common interview question. It's also a source of production surprises when people move between them:

- a UUID primary key that was fine in one is slow in the other;
- a transaction that raised a serialization error in one silently loses an update in the other;
- a server that handled 5,000 connections in one falls over in the other.

**Without it.** Engineers apply one engine's mental model to the other — tuning autovacuum on MySQL, ignoring primary-key design on InnoDB, assuming DDL can be rolled back everywhere.

**The idea.** Compare the *mechanisms*, not feature checklists: storage layout, versioning, locking, logging and process model. Features change every release; these foundations haven't changed in decades.

:::callout[That's all it is]{type=insight}
PostgreSQL keeps old row versions in the table and cleans them up later; InnoDB updates rows in place and keeps old versions in a separate undo log. PostgreSQL tables are heaps with indexes beside them; InnoDB tables *are* their primary-key index. Most differences you'll hear about are consequences of those two choices.
:::

## Definition

- **Heap table**: rows stored in insertion/free-space order; indexes map keys to a physical tuple id (`ctid` = page, slot).
- **Clustered index (InnoDB)**: the table is a B+ tree ordered by primary key, with full rows in the leaves. A **secondary index** leaf stores the indexed columns plus the primary key.
- **Dead tuple / bloat** (PostgreSQL): a row version no longer visible to any transaction, occupying space until `VACUUM` reclaims it.
- **Undo log / history list length** (InnoDB): old versions needed by open read views; **purge** removes them once no transaction needs them.
- **HOT update** (PostgreSQL): heap-only tuple — an update that changes no indexed column and fits on the same page, so no index entries are added.
- **Next-key / gap lock** (InnoDB): a lock on an index record plus the gap before it, used by locking reads at Repeatable Read to prevent phantoms.
- **Binlog**: MySQL's server-level, engine-independent log of changes (row-based by default) used for replication and point-in-time recovery.

## How It Works

### Storage: heap vs clustered index

In PostgreSQL every index, including the primary key, is a separate B+ tree whose leaves hold `ctid`s. A lookup by any index: traverse the index, then one heap page read.

In InnoDB the primary key *is* the table. A lookup by primary key ends at the leaf that holds the row — no extra read. A lookup by a secondary index ends at a leaf holding the primary key, so InnoDB then traverses the primary-key tree as well (a "double lookup", unless the secondary index covers the query) ([Clustered Indexes](lesson:db-clustered-indexes)).

Consequences:
- **Primary-key choice matters much more in InnoDB.** Random keys (UUIDv4) insert all over the clustered tree. That causes page splits, half-empty pages and a working set that no longer fits in memory. Sequential keys (auto-increment, UUIDv7, ULID) append at the right edge instead. A wide primary key is also copied into **every secondary index**. In PostgreSQL a random primary key only affects the PK index itself.
- **Range scans by primary key** are very efficient in InnoDB (rows are physically ordered); PostgreSQL's heap is ordered only by insertion unless you `CLUSTER` (one-off) or use BRIN-friendly append patterns.
- If you don't declare a primary key, InnoDB uses the first `UNIQUE NOT NULL` index or generates a hidden 6-byte row id — declare one.

### MVCC: versions in the table vs versions in undo

**PostgreSQL**: an `UPDATE` writes a **new tuple** and marks the old one with `xmax`; readers pick the version their snapshot can see ([MVCC](lesson:db-mvcc)). Unless the update is HOT, each index also gets a new entry pointing to the new tuple — **write amplification** for tables with many indexes. Dead tuples stay until `VACUUM` (normally autovacuum) marks the space reusable. Long-running transactions or forgotten replication slots stop vacuum from removing anything newer than them, and tables bloat. VACUUM also freezes old transaction ids to prevent **transaction-id wraparound**.

**InnoDB**: an `UPDATE` changes the row **in place** in the clustered index and writes the previous version to the **undo log**, linked from the row. A consistent read that needs an older version follows the undo chain back. Secondary indexes are updated only if their columns change (old entries are delete-marked and purged later). The **purge** thread discards undo that no read view needs. A long-running transaction makes undo grow (the **history list length** metric) and slows reads that must walk long version chains — the same root problem as PostgreSQL bloat, showing up in a different place.

| | PostgreSQL | InnoDB |
|---|---|---|
| Update cost | new tuple (+ index entries unless HOT) | in-place + undo record |
| Rollback cost | cheap (new tuples just become dead) | must apply undo |
| Old versions cleaned by | VACUUM / autovacuum | purge threads |
| Long transaction symptom | table and index bloat, vacuum can't keep up | huge history list length, slow consistent reads |

This difference was central to Uber's widely discussed 2016 move from PostgreSQL to MySQL: with many secondary indexes and frequent updates, PostgreSQL's new-tuple-per-update design amplified writes and WAL volume. PostgreSQL has since improved (HOT and fillfactor tuning, better vacuum), but the mechanism is the same.

### Isolation and locking defaults

- **PostgreSQL defaults to Read Committed**: each statement sees a fresh snapshot. Its **Repeatable Read** is true snapshot isolation: if two transactions update the same row, the second fails with `could not serialize access due to concurrent update` and must retry. **Serializable** is SSI (serializable snapshot isolation): no read locks, detects dangerous read-write dependency patterns and aborts one transaction ([Isolation Levels](lesson:db-isolation-levels)).
- **InnoDB defaults to Repeatable Read**: plain `SELECT`s read from a snapshot taken at the first read. But `UPDATE`, `DELETE` and locking reads (`SELECT … FOR UPDATE / FOR SHARE`) read the **latest committed** version (a "current read") and take **next-key locks** on the index ranges they scan, blocking inserts into those gaps. Two consequences:
  - A read-modify-write done as a plain `SELECT` then an `UPDATE … SET balance = <value computed in the app>` can lose an update at InnoDB's Repeatable Read, where PostgreSQL's Repeatable Read would raise an error. Use `SELECT … FOR UPDATE` or an atomic `UPDATE … SET balance = balance - 10`.
  - Gap locks prevent phantoms for locking reads but cause surprising waits and deadlocks on inserts, especially with range conditions or non-unique indexes. Many MySQL deployments switch to Read Committed to reduce gap locking.
- InnoDB's **Serializable** turns plain `SELECT`s into `SELECT … FOR SHARE` when autocommit is off — it's locking-based, not SSI.

### Logging and replication

PostgreSQL has one WAL, used three ways:

- crash recovery replays it;
- **physical streaming replication** ships it byte for byte, so replicas are exact copies (same major version required);
- **logical replication** (publications/subscriptions, since PostgreSQL 10) decodes it into row changes, for selective or cross-version replication.

MySQL has two logs: InnoDB's **redo log** for crash recovery, and the server's **binlog** for replication and PITR. A commit must be durable in both, so MySQL coordinates them with an internal two-phase commit (`innodb_flush_log_at_trx_commit = 1` and `sync_binlog = 1` — both defaults in modern versions — for full durability). The binlog is logical (row-based by default), which makes replicating across versions, and to non-MySQL consumers via CDC, natural. GTIDs identify transactions across a topology; Group Replication / InnoDB Cluster add consensus-based replication.

### Connections

PostgreSQL forks a **process per connection**. Each one costs memory (several MB, more with large `work_mem` sorts), and thousands of mostly idle connections slow down snapshot computation and scheduling. So production PostgreSQL almost always sits behind a pooler such as PgBouncer ([Connection Management](lesson:x-connection-management)). MySQL uses a **thread per connection**, which is cheaper to create and hold, and offers thread pooling (Enterprise, Percona Server, MariaDB) for very high counts. Either way, a few dozen active connections per core is the useful limit.

### SQL features and DDL

- **PostgreSQL**:
  - transactional DDL: `CREATE`, `ALTER` and `DROP` can be rolled back inside a transaction, so migrations either fully apply or not at all;
  - rich types (arrays, `jsonb` with GIN indexes, ranges, enums, custom types), partial and expression indexes, GiST/GIN/BRIN/SP-GiST;
  - `RETURNING`, `INSERT … ON CONFLICT`, `CREATE INDEX CONCURRENTLY`;
  - an extension ecosystem (PostGIS, pgvector, TimescaleDB);
  - no optimizer hints in core (the `pg_hint_plan` extension adds them); major-version upgrades need `pg_upgrade` or logical replication.
- **MySQL**:
  - DDL causes an implicit commit: since 8.0 each DDL statement is atomic, but it can't be part of a larger transaction;
  - **online DDL** with `ALGORITHM=INSTANT` / `INPLACE` adds many columns and indexes without copying the table;
  - invisible indexes for safely testing index removal; optimizer and index hints (`FORCE INDEX`);
  - `INSERT … ON DUPLICATE KEY UPDATE`, but no `RETURNING`;
  - window functions and CTEs arrived in 8.0, hash joins in 8.0.18 (there is no merge join).
- **Strings**: MySQL 8's default collation `utf8mb4_0900_ai_ci` is accent- and case-insensitive. So `'abc' = 'ABC'` is true, and unique indexes treat them as duplicates. PostgreSQL compares case-sensitively by default (use `citext`, `lower()` expression indexes or nondeterministic ICU collations). MySQL's old `utf8` charset is the 3-byte `utf8mb3` and can't store emoji — use `utf8mb4`.

## Example

The same change — one row's `status` updated, on a table with a primary key and four secondary indexes:

```text
PostgreSQL
  status not indexed, room on page → HOT update: new tuple on the same page, no index writes, WAL for one page
  status indexed (or no room)      → new tuple + 5 new index entries (every index points at the new ctid)
  old tuple                        → dead until VACUUM
InnoDB
  status not indexed               → row changed in place in the clustered index, old value to undo
  status indexed                   → plus: delete-mark old entry and insert new entry in that one secondary index
  old version                      → in undo until purge
```

And a lookup through a secondary index, on a table whose B+ trees are three levels deep:

- PostgreSQL reads 3 index pages + 1 heap page = 4;
- InnoDB reads 3 secondary-index pages + 3 clustered-index pages = 6, or just 3 if the secondary index covers the query.

## Complexity & Performance

- **Point reads by primary key**: InnoDB slightly ahead (the row is in the leaf). **Secondary-index reads**: PostgreSQL slightly ahead (one heap fetch vs a second B+ tree traversal).
- **Update-heavy tables with many indexes**: InnoDB tends to write less; PostgreSQL needs HOT-friendly design (`fillfactor`, fewer indexes on hot columns) and healthy autovacuum.
- **Analytical and complex queries**: PostgreSQL's planner (hash, merge and nested-loop joins, parallel query, richer statistics) usually handles them better.
- **Many short connections**: MySQL cheaper per connection; PostgreSQL needs a pooler.

## Trade-offs

- PostgreSQL buys simple, cheap rollbacks and a single log with VACUUM work and write amplification; InnoDB buys in-place updates with undo management and two logs to keep consistent.
- Clustered primary keys make PK range scans and lookups fast and secondary lookups and random PK inserts slower.
- PostgreSQL's richer types and extensions vs MySQL's operational simplicity, online DDL and widely known replication tooling.
- Both are excellent defaults; for a new application with no constraints, PostgreSQL's feature set and planner make it the more common choice today, while existing MySQL expertise, tooling (Vitess for sharding) or a managed offering are good reasons to choose MySQL.

## Failure Modes

- **PostgreSQL**: bloat from long transactions, idle-in-transaction sessions or abandoned replication slots; transaction-id wraparound if vacuum can't freeze; connection storms without a pooler; WAL growth from slots.
- **InnoDB**: random UUIDv4 primary keys fragmenting the clustered index; huge history list length from a forgotten transaction; gap-lock deadlocks on concurrent inserts; lost updates assumed impossible at Repeatable Read; case-insensitive uniqueness surprises.
- **Both**: misconfigured durability (`synchronous_commit = off`, `innodb_flush_log_at_trx_commit = 2`, `sync_binlog = 0`) silently trading committed data for speed.

## In Production

- PostgreSQL: monitor autovacuum and dead tuples (`pg_stat_user_tables`), oldest transaction age (`age(datfrozenxid)`), idle-in-transaction sessions and replication slots; run PgBouncer.
- MySQL: monitor history list length (`SHOW ENGINE INNODB STATUS`), deadlocks, replication lag and GTID consistency; pick sequential primary keys; consider Read Committed for insert-heavy workloads with range locks.
- Migrations: test lock behaviour — PostgreSQL `ALTER TABLE` can queue behind a long query and block everyone ([Locking](lesson:db-locking)); MySQL online DDL varies by operation and version.

## Deeper Connections

- The heap-vs-clustered choice is the clustered-index trade-off at the engine level ([Clustered Indexes](lesson:db-clustered-indexes)).
- VACUUM and purge are two garbage collectors for the same MVCC idea ([MVCC](lesson:db-mvcc)).
- One log or two: the durability chain from commit to disk to replica ([WAL & Durability](lesson:db-wal-durability), [Replication](lesson:db-replication)).
- Process vs thread per connection is the OS trade-off between isolation and creation cost ([Threads](lesson:os-threads), [Process Creation](lesson:os-process-creation)).

## Common Misconceptions

- **"MySQL doesn't have MVCC."** InnoDB has had MVCC for decades; it stores versions in undo instead of in the table.
- **"Repeatable Read means the same thing everywhere."** PostgreSQL's is snapshot isolation that aborts conflicting updates; InnoDB's mixes snapshot reads with current reads and gap locks.
- **"PostgreSQL is always slower at writes."** HOT updates and good index design avoid most write amplification; workload matters more than the engine.
- **"Primary keys are just identifiers."** In InnoDB they decide the physical layout and are embedded in every secondary index.

## Interview Questions

### [L2 · compare] How do PostgreSQL and MySQL store tables and indexes differently?

PostgreSQL stores rows in an unordered heap, and every index — primary key included — is a separate B+ tree pointing at a physical tuple location. InnoDB stores the table as the primary-key B+ tree itself, with full rows in its leaves, and secondary indexes store the primary-key value instead of a physical pointer. So InnoDB primary-key lookups and range scans are very efficient, secondary lookups need a second traversal, and the primary key's size and insertion order affect every index and page split.

### [L2 · why] Why does PostgreSQL need VACUUM, and what's the InnoDB equivalent?

Because PostgreSQL implements MVCC by writing a new tuple for every update and leaving the old one in the table; once no transaction can see the old version it's dead space that VACUUM must reclaim (and VACUUM also freezes old transaction ids to prevent wraparound). InnoDB updates rows in place and keeps old versions in undo logs, so the cleanup job is the purge thread discarding undo no read view needs. Both are blocked by long-running transactions — showing up as bloat in PostgreSQL and a growing history list in InnoDB.

### [L2 · why] Why is a random UUID primary key worse in MySQL than in PostgreSQL?

In InnoDB the primary key orders the table itself, so random keys insert into random leaf pages of the clustered index: frequent page splits, half-full pages, poor cache locality and a much larger working set. The 16-byte key is also stored in every secondary index. In PostgreSQL rows go to the heap wherever there's space and only the primary-key index suffers from random inserts. Time-ordered identifiers (UUIDv7, ULID) or an auto-increment surrogate fix it in both.

### [L2 · compare] Both default to MVCC — so what's different about their default isolation?

PostgreSQL defaults to Read Committed (a fresh snapshot per statement). MySQL InnoDB defaults to Repeatable Read, where plain reads use one snapshot for the whole transaction, but updates and locking reads see the latest committed data and take next-key (gap) locks on the ranges they scan to stop phantoms. PostgreSQL's Repeatable Read instead aborts a transaction whose row was concurrently updated, so the same application code can lose an update on MySQL and get a retryable error on PostgreSQL.

### [L2 · why] Why do PostgreSQL deployments almost always use a connection pooler like PgBouncer?

PostgreSQL forks a backend process per connection, which costs memory and makes connection setup expensive; thousands of mostly idle connections also add overhead to snapshot computation and scheduling. A pooler multiplexes many client connections onto a small number of server connections. MySQL's thread-per-connection model is cheaper per connection, though it also benefits from limiting concurrency.

### [L3 · compare] Compare their replication architectures.

PostgreSQL's physical replication streams the same WAL used for crash recovery, so replicas are byte-identical, cheap to keep in sync, but must run the same major version; logical replication decodes WAL into row changes for selective or cross-version use. MySQL replicates through the binlog, a separate logical (row-based) log kept consistent with InnoDB's redo log by an internal two-phase commit; that makes cross-version replication and CDC natural, at the cost of writing two logs. Both support asynchronous and (semi-)synchronous modes; MySQL adds Group Replication, PostgreSQL relies on external tools like Patroni for automatic failover.

### [L3 · design] A team asks you to choose between PostgreSQL and MySQL for a new product. How do you answer?

Start from requirements rather than reputation: data model and query complexity (PostgreSQL's types, JSONB, extensions and planner help complex or analytical queries), write patterns (update-heavy tables with many indexes favour InnoDB's in-place updates unless designed for HOT), connection patterns (PostgreSQL needs a pooler), the team's operational experience, the managed service and tooling available (Vitess for sharding MySQL, Citus for PostgreSQL), and required extensions like PostGIS or pgvector. For a typical new web application both work; PostgreSQL is the common default today for its features and correctness defaults, and existing MySQL expertise is a legitimate reason to pick MySQL.

## Practice

### [mcq] In InnoDB, what does a secondary index leaf entry contain besides the indexed columns?

- [ ] The physical page and slot of the row
- [x] The row's primary-key value
- [ ] The full row
- [ ] A pointer into the undo log

Secondary indexes store the primary key, so a lookup continues through the clustered index (unless the secondary index covers the query).

### [mcq] A long-running transaction stays open for six hours. What do you expect to see?

- [ ] PostgreSQL: nothing unusual; InnoDB: table bloat
- [x] PostgreSQL: dead tuples that VACUUM can't remove; InnoDB: a growing history list length
- [ ] Both: automatic cancellation after one hour
- [ ] Both: no effect, because MVCC never keeps old versions

Both engines must keep every version the old snapshot might read: PostgreSQL in the table, InnoDB in undo.

### [mcq] Which PostgreSQL update avoids writing any new index entries?

- [ ] Any update, because indexes point to the primary key
- [x] A HOT update: no indexed column changes and the new version fits on the same heap page
- [ ] An update inside a Serializable transaction
- [ ] None; every update rewrites every index

HOT (heap-only tuple) updates chain the new version from the old one on the same page, so indexes still find it through the original entry.

### [numeric 6 unit=page reads] Every B+ tree in a database is 3 levels deep. How many page reads does InnoDB need to fetch a full row through a non-covering secondary index?

:::answer
3 reads down the secondary index to find the primary key, then 3 reads down the clustered (primary-key) index to the row: **6**. PostgreSQL needs 3 index reads + 1 heap read = 4.
:::

### [numeric 4 unit=GB] An InnoDB table has 100 million rows and 5 secondary indexes. Switching the primary key from an 8-byte BIGINT to a 16-byte UUID adds how many GB to the secondary indexes alone? (1 GB = 10⁹ bytes.)

:::answer
Each secondary index entry carries the primary key: 8 extra bytes × 5 indexes × 100,000,000 rows = 4 × 10⁹ bytes = **4** GB — before counting the clustered index's extra fragmentation from random inserts.
:::

### [exercise] Two sessions run the same code concurrently on a `wallets` row with balance 100, at Repeatable Read: `BEGIN; SELECT balance FROM wallets WHERE id = 1;` (app computes balance − 30) `UPDATE wallets SET balance = 70 WHERE id = 1; COMMIT;`. What happens on PostgreSQL and on MySQL, and how do you fix it for both?

:::solution
**PostgreSQL (Repeatable Read = snapshot isolation):** the second `UPDATE` finds the row was changed by a transaction committed after its snapshot and fails with "could not serialize access due to concurrent update"; the application must retry, and the retry sees 70 and writes 40. No update is lost.

**MySQL InnoDB (Repeatable Read):** the plain `SELECT`s both read 100 from their snapshots. The second `UPDATE` waits for the first's row lock, then performs a current read of the latest committed row and writes 70 again. Final balance 70 instead of 40 — a lost update, with no error.

**Fix for both:** make the read-modify-write atomic — `UPDATE wallets SET balance = balance - 30 WHERE id = 1 AND balance >= 30` — or lock the row when reading it with `SELECT … FOR UPDATE`, or use optimistic concurrency with a version column.
:::

## Quick Revision

- PostgreSQL: heap + separate indexes (ctid). InnoDB: table = primary-key B+ tree; secondary indexes hold the PK → double lookup; PK choice drives layout (avoid random UUIDv4).
- MVCC: PostgreSQL new tuple per update, dead tuples → VACUUM (also freezes xids), HOT avoids index writes. InnoDB in-place + undo → purge; long transactions → history list length.
- Defaults: PostgreSQL Read Committed (RR = SI, aborts conflicting updates; Serializable = SSI). InnoDB Repeatable Read with current reads + next-key/gap locks; RR can lose app-level read-modify-write updates.
- Logs: PostgreSQL one WAL (physical + logical replication). MySQL redo log + binlog with internal 2PC; row-based binlog, GTIDs.
- Process per connection (pooler needed) vs thread per connection. Transactional DDL (PostgreSQL) vs online/atomic but auto-committing DDL (MySQL). Case-insensitive default collation in MySQL; use utf8mb4.
