---
title: "Write-Ahead Logging: How COMMIT Becomes Durable"
subject: db
level: 9
order: 2
summary: "The WAL rule, log sequence numbers, what a COMMIT physically waits for, group commit, checkpoints and full-page writes, fsync and the storage stack, and how the same log feeds replication and point-in-time recovery."
depth: core
difficulty: 3
minutes: 45
relevance: high
stage: 2
prerequisites: [db-transactions-acid, db-pages-records]
related: [os-journaling, os-page-cache, os-storage-devices, db-buffer-pool, db-crash-recovery, db-replication, x-durability-chain, db-lsm-trees]
labs: [wal-recovery]
tags: [wal, write ahead log, redo log, lsn, log sequence number, fsync, group commit, checkpoint, full page writes, synchronous_commit, innodb redo log, binlog, wal archiving, pitr, durability]
---

## Mental Model

Updating data pages in place at every commit would mean many random writes scattered across the disk, and a crash mid-way would leave some pages new and some old. Instead:

> **First append a description of the change to a sequential log and make *the log* durable. Apply the change to data pages in memory, and write those pages to disk later, lazily.**

If the machine crashes, the log contains everything needed to redo committed changes that hadn't reached the data files yet. The log is the source of truth; data files are a cache of the log's effects, periodically caught up.

## Definition

- **WAL (write-ahead log)** / redo log (InnoDB) / transaction log (SQL Server): an append-only sequence of records describing changes ("page 812: insert tuple at slot 5 with bytes …"; "xid 901 committed").
- **LSN (log sequence number)**: a record's position in the log (a byte offset). Every data page stores the LSN of the last record that changed it.
- **The WAL rule**: a dirty data page may be written to disk only after all log records up to its page LSN are durable.
- **Commit rule**: a transaction is committed when its commit record is durable.
- **Checkpoint**: a point after which recovery can start; all pages dirtied before it have been flushed.
- **Group commit**: one flush covering many transactions' commit records.

## Why It Exists

- **Sequential beats random**: appending to one file is far cheaper than updating scattered pages, especially on disks — and even on SSDs it reduces write amplification.
- **Small beats big**: a log record describing a 20-byte change is much smaller than the 8 KB page it modifies.
- **Crash consistency**: the log orders all changes; recovery can deterministically reconstruct state.

## How It Works

### The path of a committed update

```mermaid
sequenceDiagram
    participant C as Client
    participant B as Backend
    participant BP as Buffer pool (RAM)
    participant W as WAL buffer → WAL files
    participant D as Data files
    C->>B: UPDATE … ; COMMIT
    B->>BP: modify page 812 in memory (dirty), page LSN = 5000
    B->>W: append change record (LSN 5000)
    B->>W: append commit record (LSN 5080)
    B->>W: flush WAL up to 5080 (write + fsync)
    W-->>B: durable
    B-->>C: COMMIT OK
    Note over BP,D: later: checkpointer/background writer<br/>writes page 812 (after WAL ≥ 5000 is durable)
```

The client's commit waited for **one sequential log flush**. The data page was written seconds or minutes later.

### Group commit

A flush takes ~0.1–2 ms on SSDs (more with network storage). While one flush is in progress, other transactions' commit records accumulate in the WAL buffer; the next flush makes them all durable at once. At high concurrency, thousands of commits per second share a few hundred flushes.

### Checkpoints

Without checkpoints, recovery would replay the log from the beginning of time and the log would grow forever. A checkpoint:

1. Writes all dirty pages (spread over time to avoid I/O bursts — `checkpoint_completion_target`).
2. Records the checkpoint's redo start position.
3. Allows WAL segments before that position to be recycled (unless needed for replication or archiving).

Trade-off: frequent checkpoints → shorter recovery, more I/O (and more full-page writes); infrequent → longer recovery, less I/O.

### Full-page writes

After each checkpoint, the first change to a page logs a **full image** of the page, protecting against torn pages ([Pages & Records](lesson:db-pages-records)). This is why WAL volume spikes right after checkpoints.

### fsync and the storage stack

`write()` only copies data into the OS page cache ([Page Cache](lesson:os-page-cache)). Durability requires `fsync()`/`fdatasync()` (or `O_DSYNC` writes), which must travel through the filesystem, the block layer and the device — whose volatile write cache must honor flush commands (or be battery/capacitor-backed). A device that lies about flushes silently breaks durability.

## Internal Mechanism

:::depth{level=advanced}
### Physical, logical and physiological logging

- **Physical**: byte-level page diffs — simple, idempotent, large.
- **Logical**: "insert row (…) into table T" — compact, but replay requires consistent page state.
- **Physiological** (most engines): physical to a page, logical within it ("page 812: insert this tuple into slot 5") — compact and page-local.

PostgreSQL's WAL is page-oriented; for logical decoding (CDC) it adds enough information to reconstruct row-level changes.

### One log, many uses

- **Crash recovery**: redo from the last checkpoint ([Crash Recovery](lesson:db-crash-recovery)).
- **Physical replication**: ship WAL to standbys, which replay it continuously ([Replication](lesson:db-replication)).
- **Point-in-time recovery (PITR)**: base backup + archived WAL → replay up to any moment ("restore to 14:31:59, just before the bad DELETE").
- **Logical decoding / CDC**: turn WAL into row change events for Kafka, search indexes, warehouses.

### MySQL's two logs

InnoDB has its own redo log (crash recovery) while the server layer writes the **binlog** (replication, PITR). Committing consistently across both uses an internal two-phase commit (prepare in redo, write binlog, commit in redo) — with `sync_binlog = 1` and `innodb_flush_log_at_trx_commit = 1` for full durability.

### WAL volume management

WAL is retained until checkpoints pass it *and* all consumers (replicas via replication slots, archivers) have it. An abandoned replication slot or a failing archive command makes WAL accumulate until the disk fills — a classic outage ([Replication](lesson:db-replication)).
:::

## Example

A crash timeline:

```text
t0  checkpoint (redo starts here)
t1  T1: UPDATE page 12 (LSN 100), COMMIT (LSN 120) — WAL flushed; page 12 still only in RAM
t2  T2: UPDATE page 40 (LSN 140) — not committed; page 40 flushed to disk by background writer (steal)
t3  power loss
```

Recovery: start at t0's redo point; replay LSN 100 onto page 12 (disk copy's LSN < 100 → apply) → T1's change restored; see T1's commit record → T1 committed. Replay LSN 140 on page 40 (already on disk, idempotent via LSN check); no commit record for T2 → T2 is aborted: its change is invisible (PostgreSQL) or undone (InnoDB). Step through this in the [WAL & Recovery lab](lab:wal-recovery).

## Complexity & Performance

- Commit cost: one sequential flush (shared via group commit).
- WAL throughput often limits bulk writes: every change, every index entry and full-page images are logged. Unlogged tables (no WAL) are much faster to write — and are truncated after a crash.
- Put WAL on fast, low-latency storage; its fsync latency is every commit's latency floor.

## Trade-offs

- `synchronous_commit` / flush settings: latency vs a bounded window of lost recent commits.
- Checkpoint frequency: recovery time vs steady-state I/O and WAL volume.
- WAL retention for replicas/PITR: safety vs disk usage.

## Failure Modes

- **Disk fills with WAL**: stuck replication slot, failing archiver, long-running backup.
- **Storage that ignores flushes** (consumer SSDs without power-loss protection, misconfigured virtual disks/RAID controllers): "committed" data lost on power failure.
- **Checkpoint storms**: large bursts of page writes and full-page-image WAL causing latency spikes.
- **fsync error handling**: after a failed fsync, Linux may drop dirty pages and report success on retry; PostgreSQL now crashes and recovers from WAL rather than trusting a retried fsync ("fsyncgate").

## In Production

- Monitor WAL generation rate, replication slot lag, archive success, checkpoint frequency and duration (`pg_stat_bgwriter`, `pg_stat_wal`).
- Backups = base backup + continuous WAL archive; test restores regularly — a backup that has never been restored is a hope, not a backup.

## Deeper Connections

- Filesystem journaling is the same idea for metadata ([Journaling](lesson:os-journaling)); LSM trees put a WAL in front of their memtable ([LSM Trees](lesson:db-lsm-trees)); consensus protocols replicate a log ([Quorums & Consensus](lesson:db-quorums-consensus)).
- The full chain from `COMMIT` to physical media is the [Durability Chain](lesson:x-durability-chain).

## Common Misconceptions

- **"COMMIT writes my rows to the table files."** It makes the log durable; table pages are written later.
- **"The WAL is only for crash recovery."** It also drives replication, PITR and change data capture.
- **"SSD writes are durable immediately."** Only when flushed through a cache that's power-loss safe.

## Interview Questions

### [L2 · how] What is write-ahead logging and why is it needed?

Changes are first recorded in an append-only log, and the log is flushed to durable storage before the transaction is acknowledged as committed; data pages are updated in memory and written later, but never before the log records describing them are durable. This makes commits cheap (one sequential flush), keeps changes ordered, and lets recovery redo committed changes and discard uncommitted ones after a crash.

### [L2 · how] What does a checkpoint do and what's the trade-off in its frequency?

It flushes all pages dirtied before a certain log position and records that position as the recovery starting point, letting older WAL be recycled. Frequent checkpoints shorten crash recovery but increase I/O and WAL volume (more full-page images); infrequent checkpoints reduce I/O but lengthen recovery and retain more WAL.

### [L3 · incident] The database disk fills up although table sizes are stable. `pg_wal` is 400 GB. What are the likely causes?

WAL isn't being recycled because something still needs it: an inactive or lagging replication slot (a replica or CDC consumer down), a failing `archive_command`, or `wal_keep_size`/max_wal_size settings. Check `pg_replication_slots` (restart_lsn far behind) and `pg_stat_archiver` failures. Fix the consumer or drop the abandoned slot (accepting that consumer must resync), and alert on slot lag and archive failures.

## Practice

### [mcq] Which must be durable before a transaction's COMMIT returns (with default durability settings)?

- [ ] All data pages it modified
- [ ] All index pages it modified
- [x] The WAL records up to and including its commit record
- [ ] A checkpoint covering the transaction

Data and index pages are written later; the log alone guarantees redo.

### [mcq] What does the WAL rule forbid?

- [ ] Writing WAL records before data pages
- [x] Writing a dirty data page to disk before the WAL records describing its changes are durable
- [ ] Committing more than one transaction per flush
- [ ] Reading pages that haven't been checkpointed

Otherwise a crash could leave a page change on disk with no log record to undo or explain it.

## Quick Revision

- Log first, apply lazily: COMMIT = commit record durable (fsync); pages written later.
- WAL rule: page may hit disk only after WAL up to its page LSN is durable.
- Group commit amortizes flushes; checkpoints bound recovery and recycle WAL; full-page writes defeat torn pages.
- Durability depends on the whole storage stack honoring flushes.
- One log → crash recovery, physical replication, PITR, CDC. Watch WAL retention (slots, archiving).
