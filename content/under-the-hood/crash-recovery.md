---
title: "What Happens When the Database Restarts After a Crash"
summary: "The power came back. The database finds it wasn't shut down cleanly, reads its control file, locates the last checkpoint, replays WAL onto pages using LSN comparisons, handles torn pages with full-page images, treats unfinished transactions as aborted, and opens for connections."
subjects: [db]
order: 14
related: [db-crash-recovery, db-wal-durability, db-pages-records, db-mvcc, db-buffer-pool]
---

PostgreSQL was killed by a power loss mid-workload. Some committed changes existed only in the buffer pool; some pages were being written when power failed.

## [db] Startup: was the shutdown clean?

The postmaster reads `pg_control`: state `in production` (not `shut down`) → crash recovery is needed. It also reads the location of the **last checkpoint** and its redo pointer.

## [wal] Find the redo starting point

Recovery must start at the checkpoint's redo pointer: every change before it is guaranteed to be in the data files; changes after it may or may not be ([Crash Recovery](lesson:db-crash-recovery)).

## [wal] Read WAL records in order

The startup process reads WAL segments sequentially from the redo point, validating each record's CRC. The end of valid WAL (a zeroed or torn record) marks where the log stops — anything after it never became durable, so no committed transaction was acknowledged beyond it.

## [buffer] Replay each record onto its page

For each record: read the target page into the buffer pool; if the record carries a **full-page image** (first change after the checkpoint), restore the whole page — repairing a torn write; otherwise compare the page's LSN with the record's LSN and apply the change only if the page is older ([Pages & Records](lesson:db-pages-records)). Redo is idempotent.

## [db] Transactions without commit records

Replay also re-creates the commit-log state. Transactions whose commit record is present are committed; those without one (in progress at the crash) are marked aborted. Their row versions stay in the pages but are **invisible** to every snapshot and will be vacuumed — no undo pass is needed in PostgreSQL ([MVCC](lesson:db-mvcc)). (InnoDB would now roll them back using undo logs.)

## [db] End-of-recovery checkpoint

When the WAL is exhausted, the database performs a checkpoint so a second crash wouldn't need to replay the same WAL again, then marks itself `in production`.

## [server] Accept connections

The postmaster starts accepting connections. Time spent ≈ amount of WAL since the last checkpoint ÷ replay speed — typically seconds to a few minutes. Every transaction that received "COMMIT OK" before the crash is present; none of the unfinished ones are ([WAL & Durability](lesson:db-wal-durability)).
