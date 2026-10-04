---
title: "MVCC: How Readers and Writers Stop Blocking Each Other"
subject: db
level: 10
order: 4
summary: "Multi-version concurrency control from the inside: row versions with xmin/xmax, snapshots and visibility rules, PostgreSQL's heap versions vs InnoDB's undo logs, vacuum and purge, transaction-id wraparound, and why long transactions cause bloat."
depth: advanced
difficulty: 4
minutes: 50
relevance: high
stage: 3
prerequisites: [db-isolation-levels]
related: [db-locking, db-pages-records, db-transactions-acid, db-optimistic-pessimistic, os-cow-mmap, db-lsm-trees]
visualizations: [isolation]
labs: [isolation]
tags: [mvcc, multi version concurrency control, snapshot, xmin, xmax, visibility, vacuum, autovacuum, bloat, dead tuples, undo log, purge, history list length, transaction id wraparound, hot update, long running transaction]
---

## Mental Model

Instead of overwriting a row, an update **creates a new version** and marks the old one as ended. Each transaction reads with a **snapshot** — a rule for deciding which versions existed "as of" its start. A reader looks at the version valid in its snapshot; a writer creates a newer version nobody else can see until it commits.

Result: **readers never block writers and writers never block readers.** The cost is garbage: old versions must be cleaned up once no snapshot can see them.

It's copy-on-write for rows ([Copy-on-Write](lesson:os-cow-mmap)).

## Definition

- **Row version (tuple)**: one version of a logical row, stamped with the creating transaction (`xmin`) and, once superseded or deleted, the ending transaction (`xmax`).
- **Snapshot**: (xmin horizon, xmax horizon, list of in-progress transaction ids) captured at statement start (Read Committed) or transaction start (Repeatable Read).
- **Visibility rule**: a version is visible if its creator committed before the snapshot and its deleter hadn't committed before the snapshot (or doesn't exist, or aborted).
- **Dead version**: invisible to every current and future snapshot → reclaimable.
- **Vacuum (PostgreSQL) / purge (InnoDB)**: background removal of dead versions.

## Why It Exists

**The problem.** A database has one copy of each row, and two kinds of users want it at the same time: a reader who needs a *consistent* picture ("total of all balances right now") and a writer who is halfway through changing it. If the reader sees the half-changed state, the answer is wrong. So something has to keep them apart.

**Without it.** The obvious tool is locking: readers take shared locks, writers take exclusive ones. With pure locking, a long report holding shared locks blocks every writer, and writers block readers — throughput collapses under mixed workloads. A 10-minute analytics query would freeze checkout for 10 minutes.

**The idea.** The reader doesn't need the *current* row; it needs a row that was true at one moment. So don't make the writer wait — let it write a *new* copy, and leave the old copy where the reader can still find it. Keep a little history instead of making anyone wait. MVCC keeps enough history that every transaction can read a consistent past state without locks, which is what makes Read Committed and Snapshot Isolation cheap.

**From idea to mechanism.** Once you decide "keep old copies", three questions fall out, and each part of MVCC answers one:

| Question | Answer |
|---|---|
| How do we know which copy belongs to which moment? | Stamp each version with who created it (`xmin`) and who ended it (`xmax`) |
| How does a reader pick "its" copy? | A **snapshot**: the list of transactions that had committed when it started |
| Old copies pile up forever — then what? | **Vacuum / purge** deletes versions no snapshot can see any more |

:::callout[That's all it is]{type=insight}
Writers add new versions instead of overwriting; readers pick the version that matches their start time; a janitor removes versions nobody can see. Every MVCC detail — bloat, wraparound, HOT, undo chains — is a consequence of one of those three.
:::

## How It Works

### PostgreSQL: versions in the heap

The first design decision is *where to keep the old copy*. PostgreSQL's answer is the simplest possible one: don't move anything. The new version goes into the table next to the old one, and both carry their stamps.

```text
UPDATE accounts SET balance = 400 WHERE id = 1;   -- run by xid 105

heap page:
  slot 1: (id=1, balance=500)  xmin=100  xmax=105   ← old version, ended by 105
  slot 7: (id=1, balance=400)  xmin=105  xmax=0     ← new version, created by 105
          old version's ctid → (page, 7)             ← update chain
```

Who sees what:

| Reader snapshot | Is 105 committed as of the snapshot? | Sees |
|---|---|---|
| started before 105 committed (or 105 in progress) | no | balance = 500 (slot 1) |
| started after 105 committed | yes | balance = 400 (slot 7) |
| 105 itself | own writes | 400 |

A `DELETE` just sets `xmax`. A rollback doesn't touch the tuples: xid 105 is marked aborted in the commit log, so its versions are ignored forever (and later vacuumed).

### InnoDB: latest version in place + undo log

The opposite answer to "where does the old copy go": keep the table holding only the newest version (so the common reader, who wants the latest, finds it immediately) and push old copies out to a side log. InnoDB updates the row **in place** in the clustered index and writes the previous values to the **undo log**, linking them via a roll pointer. A reader whose read view shouldn't see the latest version follows the roll pointer chain, reconstructing older versions from undo records. The **purge** thread discards undo records no read view needs.

| | PostgreSQL | InnoDB |
|---|---|---|
| Where old versions live | in the table (heap) | in the undo log |
| Update | new tuple (+ index entries unless HOT) | in place + undo record |
| Rollback | mark xid aborted (instant) | apply undo records (cost ∝ changes) |
| Cleanup | VACUUM removes dead tuples, index entries | purge removes undo; delete-marked records |
| Symptom of lagging cleanup | table/index **bloat** | growing **history list length**, slower reads following long undo chains |

### Vacuum

Why it's needed: every update in PostgreSQL leaves the old version behind in the table. Nothing else ever deletes it, so without a cleaner a table updated 100 times per row would hold 100 copies of every row, and every scan would wade through them. VACUUM is that cleaner (autovacuum runs it in the background):

1. Finds dead tuples (xmax committed and older than the oldest snapshot still in use — the **xmin horizon**).
2. Removes their index entries, then frees their space in the page for reuse.
3. Updates the **visibility map** (all-visible pages → index-only scans, skipped by future vacuums) and the free space map.
4. **Freezes** old tuples (see below).

Plain VACUUM doesn't shrink files; it makes space reusable. `VACUUM FULL`/`pg_repack` rewrite the table compactly.

### The long-transaction problem

This follows directly from the rule "delete a version only when no snapshot can see it". Vacuum can only remove versions older than the **oldest running snapshot**. One transaction open for 6 hours (a forgotten `BEGIN` in a console, a stuck report, an idle-in-transaction connection, an abandoned replication slot with `hot_standby_feedback`) pins the horizon: every update in those 6 hours leaves garbage that can't be reclaimed. Tables bloat, indexes bloat, queries slow down — on tables that transaction never touched.

## Internal Mechanism

:::depth{level=advanced}
### Transaction-id wraparound

The problem: visibility is decided by comparing transaction ids, and ids are a finite counter. Sooner or later the counter wraps around, and "older than me" stops being answerable by a plain comparison. PostgreSQL xids are 32-bit and compared modulo 2³² (each xid sees ~2 billion as past and ~2 billion as future). A tuple whose xmin is more than ~2 billion transactions old would suddenly appear to be "in the future" — invisible. To prevent this, vacuum **freezes** old tuples (marks them as visible to everyone regardless of xid). If freezing falls too far behind, PostgreSQL emits warnings and eventually refuses new writes to protect data ("database is not accepting commands to avoid wraparound data loss"). Aggressive anti-wraparound autovacuums on huge tables are a well-known operational event. (64-bit xids in some forks remove the issue.)

### HOT updates

The problem: a new version lives at a new physical address, so in principle *every index* on the table needs a new entry pointing at it — even when the update only changed a column no index covers (say, `last_seen_at`). On a table with five indexes, one tiny update becomes six writes. HOT avoids that. If an update changes no indexed column and the new version fits on the same page, PostgreSQL creates a **heap-only tuple**: no new index entries; index entries still point to the chain's root, and a page-level prune can clean dead HOT versions without a full vacuum. Keeping indexes off frequently updated columns and leaving free space (`fillfactor`) maximize HOT updates ([Pages & Records](lesson:db-pages-records)).

### Snapshot contents

A PostgreSQL snapshot = xmin (all xids below are finished), xmax (all xids at or above had not started), and the in-progress xid list between them. Taking a snapshot scans the list of running transactions — cheap, but noticeable with thousands of connections, one reason for connection poolers ([Connection Management](lesson:x-connection-management)).

### MVCC elsewhere

Oracle and SQL Server (with snapshot isolation enabled, versions in tempdb) use undo/version stores; LSM engines keep sequence-numbered versions until compaction ([LSM Trees](lesson:db-lsm-trees)). The pattern is universal: versions + snapshots + garbage collection.
:::

## Example

Observing versions directly (PostgreSQL):

```sql
CREATE TABLE t (id int PRIMARY KEY, v int);
INSERT INTO t VALUES (1, 10);
SELECT ctid, xmin, xmax, * FROM t;       -- (0,1) | 731 | 0 | 1 | 10

UPDATE t SET v = 11 WHERE id = 1;
SELECT ctid, xmin, xmax, * FROM t;       -- (0,2) | 732 | 0 | 1 | 11   ← new version, new ctid
```

The old tuple (0,1) still exists with `xmax = 732` until vacuum removes it. The [Isolation lab](lab:isolation) shows two sessions reading different versions of the same row at the same moment.

## Complexity & Performance

- Reads: no lock waits; visibility checks per tuple (cheap, helped by hint bits).
- Updates: PostgreSQL writes a whole new tuple (+ index entries unless HOT); InnoDB writes in place + undo.
- Cleanup work is proportional to the update/delete rate; if it lags, every scan pays for dead tuples.

## Trade-offs

- MVCC buys concurrency with storage and cleanup work.
- PostgreSQL's design: instant rollback and simple crash recovery, but update-heavy workloads bloat and write more index entries. InnoDB's design: compact tables and cheaper updates, but long undo chains slow old snapshots and rollbacks of big transactions are slow.

## Failure Modes

- **Bloat** from autovacuum not keeping up (large tables with default thresholds, too few workers, I/O throttling too strict).
- **Long-running or idle-in-transaction sessions** pinning the xmin horizon.
- **Wraparound emergencies** on huge, rarely vacuumed tables.
- **InnoDB history list growth** from long transactions → slower queries, undo tablespace growth.

## In Production

- Monitor dead tuples and last autovacuum per table (`pg_stat_user_tables`), the oldest transaction age (`age(backend_xmin)` in `pg_stat_activity`), replication slots' xmin, and `age(datfrozenxid)` for wraparound.
- Tune autovacuum per hot table (lower scale factors), and set `idle_in_transaction_session_timeout`.

## Deeper Connections

- Snapshot isolation is MVCC's consistency guarantee; SSI adds dependency tracking on top ([Isolation Levels](lesson:db-isolation-levels)).
- Copy-on-write in fork() and filesystems is the same "never modify shared data in place" idea ([Copy-on-Write](lesson:os-cow-mmap)).
- Version checks for optimistic concurrency are MVCC at application level ([Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).

## Common Misconceptions

- **"MVCC means no locks."** Writers still lock rows against other writers; DDL still takes table locks.
- **"DELETE frees space."** It marks versions dead; vacuum/purge reclaims space later, and files rarely shrink.
- **"An idle transaction costs nothing."** It pins snapshots and blocks cleanup database-wide.

## Interview Questions

### [L2 · how] How does MVCC allow readers and writers not to block each other?

Writers create new row versions instead of overwriting (or keep old versions in an undo log). Each reader uses a snapshot and a visibility rule based on transaction ids and commit status to pick the version that was committed as of its snapshot. Readers never wait for writers' locks, and writers don't wait for readers; only writer–writer conflicts on the same row block.

### [L2 · why] Why can a single long-running transaction slow down an entire PostgreSQL database?

Vacuum can only remove row versions that no active snapshot might need. A long-running (or idle-in-transaction) session holds an old snapshot, pinning the cleanup horizon for all tables. Dead tuples accumulate everywhere, tables and indexes bloat, index-only scans lose effectiveness and queries read more pages. InnoDB has the analogous growing undo history.

### [L3 · compare] Compare PostgreSQL's and InnoDB's MVCC implementations.

PostgreSQL stores every version in the heap with xmin/xmax; updates insert new tuples (and index entries unless HOT); rollback is instant (mark xid aborted); vacuum removes dead tuples, and 32-bit xids require freezing to avoid wraparound. InnoDB updates rows in place in the clustered index and keeps prior versions in the undo log; old snapshots reconstruct versions by walking undo chains; rollback applies undo; purge cleans undo. PostgreSQL is more prone to bloat under heavy updates; InnoDB to undo growth and slow reads for old snapshots.

## Practice

### [mcq] A tuple has xmin = 200 (committed) and xmax = 250 (committed). A snapshot taken when 200 had committed but 250 was still running sees…

- [x] The tuple (its deletion isn't visible to this snapshot)
- [ ] Nothing: the tuple is deleted
- [ ] An error
- [ ] The newer version created by 250

From this snapshot's point of view, 250 hasn't committed, so the version is still current.

### [mcq] Which is the most likely cause of steadily growing table bloat despite autovacuum running?

- [ ] Too many indexes
- [x] A long-running or idle-in-transaction session holding an old snapshot
- [ ] Using Read Committed
- [ ] Hot updates

Vacuum can't remove versions newer than the oldest snapshot's horizon.

## Quick Revision

- Updates create versions (PG heap tuples with xmin/xmax; InnoDB in place + undo). Snapshots + visibility rules pick the right version.
- Readers don't block writers and vice versa; writers still block writers.
- Cleanup: VACUUM (dead tuples, visibility map, freezing) / purge (undo). Space is reused, rarely returned.
- Long transactions pin the horizon → bloat / history growth everywhere.
- PostgreSQL: HOT updates, xid wraparound and freezing. InnoDB: slow rollback of big transactions, long undo chains.
