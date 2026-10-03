---
title: "What Happens When You COMMIT"
summary: "The moment a transaction becomes permanent: the commit record in the WAL buffer, group commit, write() and fdatasync through the OS and the device, optional synchronous replication, the commit-log bit that makes row versions visible, and lock release."
subjects: [db, os]
order: 13
related: [db-wal-durability, db-transactions-acid, db-mvcc, db-locking, db-replication, x-durability-chain]
---

A transaction has updated two rows (transfer from account A to B) and the application sends `COMMIT`.

## [db] Changes already exist — invisibly

During the transaction, each UPDATE created new row versions stamped with the transaction's xid in buffer-pool pages (dirty, in memory) and appended WAL records describing them. Other sessions can't see the new versions: the xid isn't committed ([MVCC](lesson:db-mvcc)).

## [wal] Append the commit record

The backend appends a commit record (xid, timestamp) to the in-memory WAL buffer, at LSN, say, `0/5A3F2C80`.

## [wal] Group commit

Before flushing, the backend briefly checks whether a flush is already in progress; if so it waits for the next one, which will include its record. One `fdatasync` often covers dozens of concurrent commits.

## [kernel] write() then fdatasync()

The WAL writer (or the backend) calls `write()` on the current WAL segment file — bytes go into the OS page cache — then `fdatasync()`, which pushes them through the filesystem and block layer and issues a cache flush / FUA to the device ([Page Cache](lesson:os-page-cache)).

## [disk] The device persists

The NVMe drive writes the data to flash or to power-loss-protected cache and acknowledges. Typical latency: 20 µs–1 ms. This is the moment of durability: a crash after this point can't lose the transaction ([Durability Chain](lesson:x-durability-chain)).

## [replica] Synchronous replication (if configured)

With `synchronous_commit = on` and synchronous standbys, the backend also waits until a standby reports that it has flushed WAL up to the commit record's LSN (`remote_apply` would wait until it's replayed and visible there) ([Replication](lesson:db-replication)).

## [db] Mark the transaction committed

The xid's status is set to committed in the commit log (`pg_xact`) and the transaction is removed from the list of running transactions. From now on, new snapshots see the new row versions — atomically, both rows at once ([Transactions](lesson:db-transactions-acid)).

## [locks] Release locks and wake waiters

Row locks (held via the xid) and any table locks are released; transactions waiting on this xid wake up and continue (re-checking the rows they wanted) ([Locking](lesson:db-locking)).

## [driver] Acknowledge

The backend sends `CommandComplete: COMMIT` and `ReadyForQuery`. The data pages holding the new versions are still only in memory; the checkpointer or background writer will write them minutes later — and if the server crashes first, WAL replay will recreate them ([Crash Recovery](uth:crash-recovery)).
